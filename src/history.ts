import type { HistoryEntry } from './types.js'
import type { Store } from './store.js'

/** 会话历史：追加、按会话取、按关键词搜索（对应网页端聊天搜索能力）、按 retention 裁剪。 */
export class History {
  constructor(private store: Store, private retentionDays: number) {}

  async add(entry: Omit<HistoryEntry, 'id' | 'ts'>): Promise<HistoryEntry> {
    const full: HistoryEntry = {
      ...entry,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
    }
    await this.store.appendHistory([full])
    return full
  }

  async addMany(entries: Array<Omit<HistoryEntry, 'id' | 'ts'>>): Promise<void> {
    const now = Date.now()
    await this.store.appendHistory(entries.map((e, i) => ({
      ...e,
      id: `${now.toString(36)}-${i}`,
      ts: now + i,
    })))
  }

  async list(limit = 100): Promise<HistoryEntry[]> {
    const all = await this.store.readHistory()
    return all.slice(-limit)
  }

  async bySession(sessionId: string): Promise<HistoryEntry[]> {
    return (await this.store.readHistory()).filter(e => e.sessionId === sessionId)
  }

  /** 关键词搜索（支持正则字符串，失败则退化为子串）。 */
  async search(keyword: string, accountId?: string): Promise<HistoryEntry[]> {
    const all = await this.store.readHistory()
    let re: RegExp | undefined
    try { re = new RegExp(keyword, 'i') } catch { /* 退化 */ }
    return all.filter(e => {
      if (accountId && e.accountId !== accountId) return false
      return re ? re.test(e.content) : e.content.toLowerCase().includes(keyword.toLowerCase())
    })
  }

  /** 按保留天数裁剪，返回删除条数。 */
  enforceRetention(): Promise<number> {
    if (!this.retentionDays) return Promise.resolve(0)
    const cutoff = Date.now() - this.retentionDays * 86400000
    return this.store.clearHistory(cutoff)
  }

  clear(): Promise<number> { return this.store.clearHistory() }
}
