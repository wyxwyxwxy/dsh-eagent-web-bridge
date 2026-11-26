import type { Context } from '@deepseek-ai/cordis'
import path from 'node:path'
import { Config } from './config.js'
import type { Config as ConfigType } from './config.js'
import { Store } from './store.js'
import { AccountManager } from './accounts.js'
import { TaskScheduler } from './scheduler.js'
import { History } from './history.js'
import { HumanTyper } from './typing.js'
import { WebAdapter } from './webadapter.js'
import { registerTools } from './tools.js'
import { ModelProvider } from './model-provider.js'
import { CookieBridge } from './cookie-bridge.js'
import {
  detectCapabilities, describeCapabilities, getDeepseekAuth, readAgentsSafe, isAtLeast023,
} from './compat.js'
import type { TaskRecord } from './types.js'

/** DSH 插件唯一 id（也用于 patch 定位）。 */
export const name = 'eagent-web-bridge'

/** 依赖：等待工具注册表就绪后再 apply（v0.2.3 / 0.2.2 均支持）。 */
export const inject = ['tools']

/** 配置 schema —— 导出同名 Config（Schemastery），供 Cordis 校验并填充默认值。 */
export { Config }

/**
 * 插件入口。兼容 DSH 0.2.2-rc.5 与 0.2.3-alpha.x。
 * 通过运行时能力探测（而非硬编码版本）适配 API 差异。
 */
export function apply(ctx: Context, config: ConfigType) {
  const log = (...a: any[]) => console.log(`[${name}]`, ...a)
  log('loading')

  // 0) 版本能力探测
  const cap = detectCapabilities(ctx)
  log('capabilities:', describeCapabilities(cap))
  if (cap.versionHint) log('detected DSH version:', cap.versionHint, isAtLeast023(cap.versionHint) ? '(new >=0.2.3)' : '(legacy 0.2.2)')
  const auth = getDeepseekAuth(ctx)
  if (auth) log('DeepSeek auth available via', cap.hasDeepseekAuth ? 'ctx.deepseekAuth' : 'legacy config')

  // 1) 基础设施
  const store = new Store(config.storeDir)
  const accounts = new AccountManager(store, config.accountCooldownMs)
  const history = new History(store, config.historyRetentionDays)
  const typer = new HumanTyper()
  const web = new WebAdapter(ctx, config.web)
  const modelProvider = new ModelProvider(ctx, cap)

  // 2) 任务执行体（可替换钩子：CDP/WebView 由宿主桥接层落地）
  const executeOnWeb = async (accountId: string, text: string, taskId: string): Promise<string> => {
    const acc = await accounts.get(accountId)
    if (!acc) throw new Error(`账号不存在: ${accountId}`)
    if (!acc.enabled) throw new Error(`账号已停用: ${accountId}`)
    if (acc.quotaExhausted) throw new Error(`账号额度耗尽: ${accountId}`)

    const cd = await accounts.isCoolingDown(accountId)
    if (cd.cooling) await new Promise(r => setTimeout(r, cd.waitMs))

    const typed: string[] = []
    await typer.type(text, {
      delayMs: config.typingDelayMs,
      jitter: config.typingJitter,
      chunked: config.chunkedTyping,
      onSegment: (seg) => { typed.push(seg) },
    })

    await accounts.markRun(accountId)
    const joined = typed.join('')
    if (config.historyEnabled) {
      await history.add({ accountId, role: 'user', content: joined, sessionId: taskId })
    }
    return JSON.stringify({
      taskId, accountId, typedChars: typed.length,
      estimatedDelayMs: config.typingDelayMs,
      content: joined,
      note: 'text typed with human-like pacing; deliver to web bridge for send+capture',
    })
  }

  // 3) 并发调度器
  const scheduler = new TaskScheduler(
    store, config.maxConcurrency, config.perAccountConcurrency, async (task: TaskRecord) => {
      const result = await executeOnWeb(task.accountId, task.text, task.id)
      if (config.historyEnabled) {
        await history.add({ accountId: task.accountId, role: 'assistant', content: result, sessionId: task.id })
      }
      return result
    },
  )

  // 4) 网页端额度轮询
  const stopQuota = web.startQuotaPolling(
    async () => false,
    () => log('quota exhausted detected on some account'),
  )

  // 5) Cookie 自动识别桥接服务（浏览器扩展免手动导入）
  let cookieBridge: CookieBridge | undefined
  let bridgeInfo: any
  if (config.cookieBridge?.enabled) {
    cookieBridge = new CookieBridge(accounts, {
      port: config.cookieBridge.port ?? 0,
      host: '127.0.0.1',
      allowOpen: config.cookieBridge.allowOpen ?? true,
    }, log)
    const tokenFile = path.join(store.dir, 'bridge-token')
    const connFile = path.join(store.dir, 'bridge-connection.json')
    void cookieBridge.start(tokenFile).then(async info => {
      await cookieBridge!.writeConnectionFile(connFile, info)
      bridgeInfo = {
        bridgeUrl: `http://127.0.0.1:${info.port}`,
        token: info.token,
        connectionFile: connFile,
        tokenFile: info.tokenFile,
        endpoints: { health: '/health', cookie: '/cookie' },
        note: '浏览器扩展读取 connectionFile 或调用 eagent_cookie_sync 获取地址与 token',
      }
      ;(ctx as any).__EAGENT_BRIDGE_INFO__ = JSON.stringify(bridgeInfo, null, 2)
      log(`cookie bridge ready at ${bridgeInfo.bridgeUrl} (conn: ${connFile})`)
    }).catch(e => log('cookie bridge failed to start:', e?.message ?? e))
  }

  // 6) 注册工具
  registerTools({
    ctx, config, store, accounts, scheduler, history, web, typer,
    modelProvider, cookieBridge, cap, executeOnWeb,
  })

  log(`ready | typingDelay=${config.typingDelayMs}ms maxConcurrency=${config.maxConcurrency} perAccount=${config.perAccountConcurrency}`)

  // 7) 生命周期清理
  ctx.effect(() => {
    stopQuota()
    scheduler.dispose()
    modelProvider.dispose()
    cookieBridge?.stop()
    log('unloaded')
  })

  // 暴露内部实例，便于宿主/其他插件通过 ctx 组合（可选）
  ;(ctx as any).eagent = { accounts, scheduler, history, modelProvider, cookieBridge, cap, readAgentsSafe }
}

/** 默认导出（对象形态插件）。 */
export default { name, inject, Config, apply }
