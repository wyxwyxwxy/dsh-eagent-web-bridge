import crypto from 'node:crypto'
import type { Account } from './types.js'
import type { Store } from './store.js'

/** 多账号管理：增删改查、启用停用、Cookie 导入、额度状态、冷却。 */
export class AccountManager {
  constructor(private store: Store, private cooldownMs: number) {}

  async list(): Promise<Account[]> { return this.store.readAccounts() }

  async get(id: string): Promise<Account | undefined> {
    return (await this.list()).find(a => a.id === id)
  }

  private hash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)
  }

  /** 新增或按 id 覆盖账号。 */
  async upsert(input: {
    id?: string
    label: string
    cookie: string
    enabled?: boolean
    note?: string
  }): Promise<Account> {
    const list = await this.list()
    const id = input.id || this.hash(input.cookie || input.label)
    const idx = list.findIndex(a => a.id === id)
    const now = Date.now()
    const account: Account = {
      id,
      label: input.label || id,
      cookie: input.cookie,
      enabled: input.enabled ?? true,
      note: input.note,
      createdAt: idx >= 0 ? list[idx].createdAt : now,
      quotaExhausted: idx >= 0 ? list[idx].quotaExhausted : false,
      lastRunAt: idx >= 0 ? list[idx].lastRunAt : undefined,
    }
    if (idx >= 0) list[idx] = account
    else list.push(account)
    await this.store.writeAccounts(list)
    return account
  }

  /** 批量导入 Cookie（每行一个，支持 "label|cookie" 或纯 cookie）。 */
  async importCookies(raw: string): Promise<Account[]> {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
    const added: Account[] = []
    for (const line of lines) {
      const sep = line.indexOf('|')
      const label = sep > 0 ? line.slice(0, sep).trim() : ''
      const cookie = sep > 0 ? line.slice(sep + 1).trim() : line
      if (!cookie) continue
      added.push(await this.upsert({ label: label || `账号-${this.hash(cookie).slice(0, 6)}`, cookie }))
    }
    return added
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const list = await this.list()
    const a = list.find(x => x.id === id)
    if (!a) return false
    a.enabled = enabled
    await this.store.writeAccounts(list)
    return true
  }

  async setQuotaExhausted(id: string, exhausted: boolean): Promise<void> {
    const list = await this.list()
    const a = list.find(x => x.id === id)
    if (!a) return
    a.quotaExhausted = exhausted
    await this.store.writeAccounts(list)
  }

  /** 标记账号已运行（写 lastRunAt），用于冷却。 */
  async markRun(id: string): Promise<void> {
    const list = await this.list()
    const a = list.find(x => x.id === id)
    if (!a) return
    a.lastRunAt = Date.now()
    await this.store.writeAccounts(list)
  }

  /** 账号是否处于冷却中。 */
  async isCoolingDown(id: string): Promise<{ cooling: boolean; waitMs: number }> {
    const a = await this.get(id)
    if (!a?.lastRunAt) return { cooling: false, waitMs: 0 }
    const elapsed = Date.now() - a.lastRunAt
    const wait = this.cooldownMs - elapsed
    return wait > 0 ? { cooling: true, waitMs: wait } : { cooling: false, waitMs: 0 }
  }

  /** 选出一个可用账号：启用、未额度耗尽、不在冷却。 */
  async pickAvailable(exclude?: Set<string>): Promise<Account | undefined> {
    const list = await this.list()
    for (const a of list) {
      if (!a.enabled || a.quotaExhausted) continue
      if (exclude?.has(a.id)) continue
      const cd = await this.isCoolingDown(a.id)
      if (!cd.cooling) return a
    }
    return undefined
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.list()
    const next = list.filter(a => a.id !== id)
    if (next.length === list.length) return false
    await this.store.writeAccounts(next)
    return true
  }
}
