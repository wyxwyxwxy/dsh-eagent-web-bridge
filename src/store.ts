import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Account, HistoryEntry, TaskRecord } from './types.js'

/**
 * 轻量 JSON 持久化层。
 * 存储目录位于 DSH_HOME/<storeDir>（未设置 DSH_HOME 时回退到 ~/.dsh/<storeDir>）。
 * 所有写操作串行化，避免并发任务写坏文件。
 */
export class Store {
  readonly dir: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(storeDir: string) {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    this.dir = path.join(home, storeDir)
  }

  private get accountsFile() { return path.join(this.dir, 'accounts.json') }
  private get historyFile() { return path.join(this.dir, 'history.jsonl') }
  private get tasksFile() { return path.join(this.dir, 'tasks.json') }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    for (const f of [this.accountsFile, this.tasksFile]) {
      try { await fs.access(f) } catch { await fs.writeFile(f, '[]', 'utf8') }
    }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  async readAccounts(): Promise<Account[]> {
    try { return JSON.parse(await fs.readFile(this.accountsFile, 'utf8')) as Account[] }
    catch { return [] }
  }

  async writeAccounts(list: Account[]): Promise<void> {
    await this.serialize(() => fs.writeFile(this.accountsFile, JSON.stringify(list, null, 2), 'utf8'))
  }

  async readTasks(): Promise<TaskRecord[]> {
    try { return JSON.parse(await fs.readFile(this.tasksFile, 'utf8')) as TaskRecord[] }
    catch { return [] }
  }

  async writeTasks(list: TaskRecord[]): Promise<void> {
    await this.serialize(() => fs.writeFile(this.tasksFile, JSON.stringify(list, null, 2), 'utf8'))
  }

  async appendHistory(entries: HistoryEntry[]): Promise<void> {
    if (!entries.length) return
    const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    await this.serialize(() => fs.appendFile(this.historyFile, lines, 'utf8'))
  }

  async readHistory(): Promise<HistoryEntry[]> {
    try {
      const text = await fs.readFile(this.historyFile, 'utf8')
      return text.split('\n').filter(Boolean).map(l => JSON.parse(l) as HistoryEntry)
    } catch { return [] }
  }

  async clearHistory(beforeTs?: number): Promise<number> {
    const all = await this.readHistory()
    const kept = beforeTs === undefined ? [] : all.filter(e => e.ts >= beforeTs)
    await this.serialize(() => fs.writeFile(this.historyFile,
      kept.map(e => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''), 'utf8'))
    return all.length - kept.length
  }
}
