import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.js'
import type { Config as ConfigType } from './config.js'
import { Store } from './store.js'
import { AccountManager } from './accounts.js'
import { TaskScheduler } from './scheduler.js'
import { History } from './history.js'
import { HumanTyper } from './typing.js'
import { WebAdapter, readAgents, readDeepseekAuth } from './webadapter.js'
import { registerTools } from './tools.js'
import type { TaskRecord } from './types.js'

/** DSH 插件唯一 id（也用于 patch 定位）。 */
export const name = 'eagent-web-bridge'

/** 依赖：等待工具注册表就绪后再 apply（v0.2.3 契约）。 */
export const inject = ['tools']

/** 配置 schema —— 导出同名 Config（Schemastery），供 Cordis 校验并填充默认值。 */
export { Config }

/**
 * 插件入口。
 * apply(ctx, config) 在依赖就绪后执行；凡经 ctx 注册的资源随 fiber 卸载自动清理，
 * 手动资源（定时器/子进程/文件句柄）用 ctx.effect 注册清理。
 */
export function apply(ctx: Context, config: ConfigType) {
  const log = (...a: any[]) => console.log(`[${name}]`, ...a)
  log('loading (DSH compat >=0.2.3-alpha.1)')

  // v0.2.3 授权适配点：保留读取入口，不在插件内硬编码 DeepSeek 凭据。
  const auth = readDeepseekAuth(ctx)
  if (auth) log('deepseekAuth available via ctx')

  // 1) 基础设施
  const store = new Store(config.storeDir)
  const accounts = new AccountManager(store, config.accountCooldownMs)
  const history = new History(store, config.historyRetentionDays)
  const typer = new HumanTyper()
  const web = new WebAdapter(ctx, config.web)

  // 2) 任务执行体：真正把一条任务写到 DeepSeek 网页并取回结果。
  //    这里做成可替换钩子：默认实现通过 CDP/WebView 注入脚本；
  //    若本机挂了 dsh-browser 桥，可改用其 browser_* 工具。
  const executeOnWeb = async (accountId: string, text: string, taskId: string): Promise<string> => {
    const acc = await accounts.get(accountId)
    if (!acc) throw new Error(`账号不存在: ${accountId}`)
    if (!acc.enabled) throw new Error(`账号已停用: ${accountId}`)
    if (acc.quotaExhausted) throw new Error(`账号额度耗尽: ${accountId}`)

    const cd = await accounts.isCoolingDown(accountId)
    if (cd.cooling) await new Promise(r => setTimeout(r, cd.waitMs))

    // 拟人化输入：每个字符按 config.typingDelayMs 延迟写入网页输入框。
    const typed: string[] = []
    await typer.type(text, {
      delayMs: config.typingDelayMs,
      jitter: config.typingJitter,
      chunked: config.chunkedTyping,
      onSegment: (seg) => { typed.push(seg) },
    })

    await accounts.markRun(accountId)
    const joined = typed.join('')

    // 记录历史（输入侧）。输出侧由宿主在拿到回复后调用 eagent_history.add。
    if (config.historyEnabled) {
      await history.add({ accountId, role: 'user', content: joined, sessionId: taskId })
    }

    // 说明：真实网页交互由宿主桥接层（CDP/WebView）完成；
    // 这里返回给调度器的 canonical value 是已按拟人节奏输入的内容与元信息。
    return JSON.stringify({
      taskId, accountId, typedChars: typed.length,
      estimatedDelayMs: config.typingDelayMs,
      content: joined,
      note: 'text typed with human-like pacing; deliver to web bridge for send+capture',
    })
  }

  // 3) 并发调度器（全局上限 + 单账号上限）
  const scheduler = new TaskScheduler(
    store, config.maxConcurrency, config.perAccountConcurrency, async (task: TaskRecord) => {
      const result = await executeOnWeb(task.accountId, task.text, task.id)
      if (config.historyEnabled) {
        await history.add({ accountId: task.accountId, role: 'assistant', content: result, sessionId: task.id })
      }
      return result
    },
  )

  // 4) 网页端额度轮询（v0.2.3 / 网页端 2026-11 改动）：命中额度耗尽则标记账号。
  const stopQuota = web.startQuotaPolling(
    async () => false, // 宿主注入真实检测（读取 quotas[].is_exhausted / 提示条）
    () => log('quota exhausted detected on some account'),
  )

  // 5) 注册模型工具
  registerTools({
    ctx, config, store, accounts, scheduler, history, web, typer, executeOnWeb,
  })

  log(`ready | typingDelay=${config.typingDelayMs}ms maxConcurrency=${config.maxConcurrency} perAccount=${config.perAccountConcurrency}`)

  // 6) 生命周期清理（手动资源）
  ctx.effect(() => {
    stopQuota()
    scheduler.dispose()
    log('unloaded')
  })
}

/** 默认导出（对象形态插件，便于在 cordis.yml 中以 name 挂载）。 */
export default { name, inject, Config, apply }
