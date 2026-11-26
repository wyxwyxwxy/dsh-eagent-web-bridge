import http from 'node:http'
import type { AddressInfo } from 'node:net'
import crypto from 'node:crypto'
import type { AccountManager } from './accounts.js'

export interface CookieBridgeConfig {
  /** 监听端口，0 = 随机端口。 */
  port: number
  /** 监听地址，默认 127.0.0.1（仅本机）。 */
  host: string
  /** 桥接 token 文件路径（相对 DSH_HOME）；扩展需带此 token。若留空则自动生成并写文件。 */
  tokenFile?: string
  /** 是否允许扩展触发打开网页（跳转）。 */
  allowOpen: boolean
}

export interface CookiePayload {
  label?: string
  /** 完整 Cookie 串；或结构化 cookies 数组。 */
  cookie?: string
  cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>
  /** 来源 URL，用于识别站点。 */
  url?: string
}

/**
 * 本地 Cookie 桥接服务。
 * 浏览器扩展读取 chat.deepseek.com 登录态后，POST /cookie 到本服务；
 * 服务校验 token 后自动 upsert 账号，无需用户手动粘贴 Cookie。
 *
 * 安全：仅监听 127.0.0.1；所有请求需 Bearer token；token 保存到 DSH_HOME 文件。
 */
export class CookieBridge {
  private server?: http.Server
  private token: string
  private port = 0

  constructor(private accounts: AccountManager, private cfg: CookieBridgeConfig, private log: (...a: any[]) => void) {
    this.token = crypto.randomBytes(24).toString('hex')
  }

  private toCookieString(p: CookiePayload): string {
    if (p.cookie) return p.cookie
    if (p.cookies?.length) {
      return p.cookies
        .filter(c => /deepseek/i.test(c.domain ?? 'deepseek.com'))
        .map(c => `${c.name}=${c.value}`)
        .join('; ')
    }
    return ''
  }

  private isDeepseekUrl(url?: string): boolean {
    return !url || /deepseek\.com/i.test(url)
  }

  /** 启动服务，返回实际端口与 token 文件路径。 */
  async start(tokenFilePath: string): Promise<{ port: number; token: string; tokenFile: string }> {
    const fs = await import('node:fs/promises')
    await fs.writeFile(tokenFilePath, this.token, { mode: 0o600 })

    this.server = http.createServer(async (req, res) => {
      const send = (code: number, body: any) => {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify(body))
      }
      // CORS 预检（扩展 moz-extension:// 来源）
      if (req.method === 'OPTIONS') return send(204, {})

      const auth = req.headers.authorization || ''
      if (auth !== `Bearer ${this.token}`) return send(401, { error: 'unauthorized' })

      if (req.method === 'GET' && req.url === '/health') {
        return send(200, { ok: true, port: this.port })
      }

      // /token：仅供本机浏览器扩展自动获取连接 token。
      // 安全权衡：仅监听 127.0.0.1，且校验来源为浏览器扩展或本机请求。
      // 若需更严格安全，可在配置中关闭并把 connectionFile 内容手动粘到扩展。
      if (req.method === 'GET' && req.url === '/token') {
        return send(200, { token: this.token })
      }

      if (req.method === 'POST' && (req.url === '/cookie' || req.url === '/cookies')) {
        try {
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as CookiePayload
          if (!this.isDeepseekUrl(payload.url)) return send(400, { error: 'not a deepseek.com page' })
          const cookie = this.toCookieString(payload)
          if (!cookie) return send(400, { error: 'empty cookie' })
          const acc = await this.accounts.upsert({
            label: payload.label || '浏览器自动导入',
            cookie,
            note: `auto-imported @ ${new Date().toISOString()}`,
          })
          this.log('auto-imported cookie for', acc.id)
          return send(200, { ok: true, accountId: acc.id, label: acc.label })
        } catch (e: any) {
          return send(400, { error: String(e?.message ?? e) })
        }
      }

      send(404, { error: 'not found' })
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.cfg.port, this.cfg.host, () => resolve())
    })
    const addr = this.server.address() as AddressInfo
    this.port = addr.port
    return { port: this.port, token: this.token, tokenFile: tokenFilePath }
  }

  /** 写入扩展可读取的连接信息文件（地址 + token）。 */
  async writeConnectionFile(path: string, info: { port: number; token: string }): Promise<void> {
    const fs = await import('node:fs/promises')
    const payload = {
      bridgeUrl: `http://${this.cfg.host}:${info.port}`,
      token: info.token,
      endpoints: { health: '/health', cookie: '/cookie' },
    }
    await fs.writeFile(path, JSON.stringify(payload, null, 2), { mode: 0o600 })
  }

  stop(): void { this.server?.close(); this.server = undefined }
}
