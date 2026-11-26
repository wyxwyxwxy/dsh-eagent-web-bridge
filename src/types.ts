/** 一个 DeepSeek 网页账号。 */
export interface Account {
  /** 账号唯一 id（用户自定义或邮箱哈希）。 */
  id: string
  /** 展示名。 */
  label: string
  /** Cookie 字符串（形如 "key=value; key2=value2"），用于复用网页登录态。 */
  cookie: string
  /** 账号是否启用。 */
  enabled: boolean
  /** 账号当前是否额度耗尽（由额度轮询更新）。 */
  quotaExhausted?: boolean
  /** 上次成功运行时间戳（ms），用于冷却计算。 */
  lastRunAt?: number
  /** 备注。 */
  note?: string
  createdAt: number
}

/** 一条历史对话记录。 */
export interface HistoryEntry {
  id: string
  accountId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 会话/线程 id，便于按会话分组与搜索。 */
  sessionId?: string
  ts: number
}

/** 任务状态。 */
export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface TaskRecord {
  id: string
  accountId: string
  text: string
  status: TaskStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  error?: string
  result?: string
}
