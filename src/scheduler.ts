import type { TaskRecord, TaskStatus } from './types.js'
import type { Store } from './store.js'

export interface SubmitResult {
  taskId: string
  accepted: boolean
  reason?: string
}

/**
 * 并发调度器：
 * - 全局 maxConcurrency 上限
 * - 单账号 perAccountConcurrency 上限
 * - 提交即入队，byId 可查状态，失败可重试
 * 执行体由外部注入（runTask），调度器只负责闸门与记录。
 */
export class TaskScheduler {
  private queue: TaskRecord[] = []
  private active = new Map<string, TaskRecord>() // taskId -> record
  private activeByAccount = new Map<string, Set<string>>()
  private runningCount = 0
  private disposed = false
  private wake?: () => void

  constructor(
    private store: Store,
    private maxConcurrency: number,
    private perAccountConcurrency: number,
    private runTask: (task: TaskRecord) => Promise<string>,
  ) {}

  /** 当前快照。 */
  snapshot(): TaskRecord[] {
    const all = [...this.active.values(), ...this.queue]
    return all.sort((a, b) => a.createdAt - b.createdAt)
  }

  private async setStatus(task: TaskRecord, status: TaskStatus, extra?: Partial<TaskRecord>) {
    Object.assign(task, { status }, extra)
    await this.persist()
  }

  private async persist() {
    // 合并内存中的活动任务到已持久化任务
    const stored = await this.store.readTasks()
    const map = new Map(stored.map(t => [t.id, t]))
    for (const t of [...this.active.values(), ...this.queue]) map.set(t.id, t)
    await this.store.writeTasks([...map.values()].slice(-500)) // 只保留最近 500 条
  }

  submit(accountId: string, text: string): SubmitResult {
    if (this.disposed) return { taskId: '', accepted: false, reason: 'scheduler disposed' }
    if (!Number.isFinite(this.maxConcurrency) || this.maxConcurrency < 1) {
      return { taskId: '', accepted: false, reason: 'invalid maxConcurrency' }
    }
    const task: TaskRecord = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      accountId, text, status: 'queued', createdAt: Date.now(),
    }
    this.queue.push(task)
    void this.setStatus(task, 'queued')
    this.kick()
    return { taskId: task.id, accepted: true }
  }

  /** 取消排队中或运行中的任务。 */
  cancel(taskId: string): boolean {
    const inQueue = this.queue.find(t => t.id === taskId)
    if (inQueue) {
      this.queue = this.queue.filter(t => t.id !== taskId)
      void this.setStatus(inQueue, 'cancelled')
      return true
    }
    const active = this.active.get(taskId)
    if (active) {
      void this.setStatus(active, 'cancelled')
      return true // 真正终止执行体需 runTask 协作式检查 status
    }
    return false
  }

  private kick() {
    if (this.disposed) return
    while (this.runningCount < this.maxConcurrency && this.queue.length > 0) {
      // 找一个其账号未达单账号上限的任务
      const idx = this.queue.findIndex(t =>
        (this.activeByAccount.get(t.accountId)?.size ?? 0) < this.perAccountConcurrency)
      if (idx < 0) break
      const [task] = this.queue.splice(idx, 1)
      this.active.set(task.id, task)
      this.runningCount++
      let set = this.activeByAccount.get(task.accountId)
      if (!set) { set = new Set(); this.activeByAccount.set(task.accountId, set) }
      set.add(task.id)
      void this.execute(task)
    }
  }

  private async execute(task: TaskRecord) {
    task.startedAt = Date.now()
    await this.setStatus(task, 'running')
    try {
      const result = await this.runTask(task)
      await this.setStatus(task, 'done', { result, finishedAt: Date.now() })
    } catch (e: any) {
      await this.setStatus(task, 'error', { error: String(e?.message ?? e), finishedAt: Date.now() })
    } finally {
      this.runningCount--
      this.active.delete(task.id)
      this.activeByAccount.get(task.accountId)?.delete(task.id)
      this.kick() // 有空位，继续消费队列
    }
  }

  /** 动态调整全局并发上限（热更新配置时调用）。 */
  setMaxConcurrency(n: number) {
    this.maxConcurrency = Math.max(1, Math.floor(n))
    this.kick()
  }

  setPerAccountConcurrency(n: number) {
    this.perAccountConcurrency = Math.max(1, Math.floor(n))
    this.kick()
  }

  /** 等待所有当前队列排空（用于测试/优雅退出）。 */
  waitIdle(timeoutMs = 0): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (this.queue.length === 0 && this.runningCount === 0) return resolve()
        this.wake = check
        if (timeoutMs > 0) setTimeout(resolve, timeoutMs)
      }
      check()
    })
  }

  dispose() { this.disposed = true; this.wake?.() }
}
