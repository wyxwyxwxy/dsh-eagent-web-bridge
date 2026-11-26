import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.js'
import type { Store } from './store.js'
import { AccountManager } from './accounts.js'
import { TaskScheduler } from './scheduler.js'
import { History } from './history.js'
import { HumanTyper } from './typing.js'
import { WebAdapter } from './webadapter.js'
import { ModelProvider, parseProviderConfig } from './model-provider.js'
import type { CookieBridge } from './cookie-bridge.js'
import type { DshCapability } from './compat.js'
import { describeCapabilities } from './compat.js'

export interface ToolDeps {
  ctx: Context
  config: Config
  store: Store
  accounts: AccountManager
  scheduler: TaskScheduler
  history: History
  web: WebAdapter
  typer: HumanTyper
  modelProvider: ModelProvider
  cookieBridge?: CookieBridge
  cap: DshCapability
  /** 真正执行一次网页任务：注入账号 Cookie、输入文本、等待回复并抓取。 */
  executeOnWeb: (accountId: string, text: string, taskId: string) => Promise<string>
}

const textOut = {
  schema: { type: 'string' },
  render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
}

/** 注册全部 eagent_* 工具。返回清理函数（虽然 ctx 注册随 fiber 自动撤销，这里显式返回便于测试）。 */
export function registerTools(d: ToolDeps): () => void {
  const { ctx } = d

  // ---------- 多账号 ----------
  ctx.tools.register(defineTool({
    name: 'eagent_accounts',
    description: '列出所有 DeepSeek 网页账号及其状态（启用/额度耗尽/冷却）。',
    parameters: {},
    output: textOut,
    async execute() {
      const list = await d.accounts.list()
      return list.map(a => ({
        id: a.id, label: a.label, enabled: a.enabled,
        quotaExhausted: !!a.quotaExhausted, note: a.note,
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'eagent_account_add',
    description: '新增或更新一个账号。传 cookie（完整 Cookie 串）与 label。',
    parameters: {
      label: { type: 'string', required: true, description: '账号展示名' },
      cookie: { type: 'string', required: true, description: '从浏览器复制的 Cookie 串' },
      id: { type: 'string', description: '可选，指定账号 id' },
      note: { type: 'string', description: '备注' },
    },
    output: textOut,
    async execute(args: any) {
      const a = await d.accounts.upsert(args)
      return `已保存账号 ${a.label} (id=${a.id})`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'eagent_account_import',
    description: '批量导入 Cookie，每行一个，可用「标签|cookie」格式。',
    parameters: { text: { type: 'string', required: true, description: '多行 Cookie 文本' } },
    output: textOut,
    async execute(args: any) {
      const added = await d.accounts.importCookies(args.text)
      return `已导入 ${added.length} 个账号`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'eagent_account_toggle',
    description: '启用或停用某账号。',
    parameters: {
      id: { type: 'string', required: true },
      enabled: { type: 'boolean', required: true },
    },
    output: textOut,
    async execute(args: any) {
      const ok = await d.accounts.setEnabled(args.id, !!args.enabled)
      return ok ? `账号 ${args.id} 已${args.enabled ? '启用' : '停用'}` : `未找到账号 ${args.id}`
    },
  }))

  // ---------- 并发任务 ----------
  ctx.tools.register(defineTool({
    name: 'eagent_submit',
    description: '向 DeepSeek 网页端提交一个任务（自动选可用账号、并发受控）。返回 taskId。',
    parameters: {
      text: { type: 'string', required: true, description: '发送给 DeepSeek 的提示词' },
      accountId: { type: 'string', description: '可选，指定账号；不指定则自动选取' },
    },
    output: textOut,
    async execute(args: any) {
      let accountId = args.accountId
      if (!accountId) {
        const acc = await d.accounts.pickAvailable()
        if (!acc) return '没有可用账号（可能全部停用/额度耗尽/处于冷却）'
        accountId = acc.id
      }
      const r = d.scheduler.submit(accountId, args.text)
      return r.accepted ? `任务已入队：${r.taskId}（账号 ${accountId}）` : `提交失败：${r.reason}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'eagent_tasks',
    description: '查看任务队列及各任务状态。',
    parameters: {},
    output: textOut,
    async execute() { return d.scheduler.snapshot() },
  }))

  ctx.tools.register(defineTool({
    name: 'eagent_cancel',
    description: '取消一个排队中或运行中的任务。',
    parameters: { taskId: { type: 'string', required: true } },
    output: textOut,
    async execute(args: any) {
      return d.scheduler.cancel(args.taskId) ? `已取消 ${args.taskId}` : `未找到任务 ${args.taskId}`
    },
  }))

  // ---------- 输入延迟 / 并发配置（热更新）----------
  ctx.tools.register(defineTool({
    name: 'eagent_set_rate',
    description: '运行时调整输入延迟与并发上限。typingDelayMs=每字平均毫秒；maxConcurrency=全局最大并发；perAccountConcurrency=单账号并发。',
    parameters: {
      typingDelayMs: { type: 'number', description: '每字符平均输入延迟（ms）' },
      typingJitter: { type: 'number', description: '抖动比例 0~1' },
      maxConcurrency: { type: 'number', description: '全局最大并发（≥1）' },
      perAccountConcurrency: { type: 'number', description: '单账号最大并发（≥1）' },
    },
    output: textOut,
    async execute(args: any) {
      const out: string[] = []
      if (typeof args.typingDelayMs === 'number') {
        d.config.typingDelayMs = Math.max(0, args.typingDelayMs)
        out.push(`typingDelayMs=${d.config.typingDelayMs}`)
      }
      if (typeof args.typingJitter === 'number') {
        d.config.typingJitter = Math.max(0, Math.min(1, args.typingJitter))
        out.push(`typingJitter=${d.config.typingJitter}`)
      }
      if (typeof args.maxConcurrency === 'number') {
        d.scheduler.setMaxConcurrency(args.maxConcurrency)
        out.push(`maxConcurrency=${d.config.maxConcurrency = Math.max(1, Math.floor(args.maxConcurrency))}`)
      }
      if (typeof args.perAccountConcurrency === 'number') {
        d.scheduler.setPerAccountConcurrency(args.perAccountConcurrency)
        out.push(`perAccountConcurrency=${d.config.perAccountConcurrency = Math.max(1, Math.floor(args.perAccountConcurrency))}`)
      }
      return out.length ? `已更新：${out.join(', ')}` : '未提供任何参数'
    },
  }))

  ctx.tools.register(defineTool({
    name: 'eagent_estimate_typing',
    description: '预估一段文本在当前输入延迟设置下的总耗时（ms）。',
    parameters: { text: { type: 'string', required: true } },
    output: textOut,
    async execute(args: any) {
      const ms = d.typer.estimate(String(args.text ?? ''), {
        delayMs: d.config.typingDelayMs,
        jitter: d.config.typingJitter,
        chunked: d.config.chunkedTyping,
      })
      return `预计输入耗时 ${Math.round(ms)} ms（每字平均 ${d.config.typingDelayMs} ms，抖动 ${d.config.typingJitter}）`
    },
  }))

  // ---------- 历史对话 ----------
  ctx.tools.register(defineTool({
    name: 'eagent_history',
    description: '查看历史对话，可按关键词搜索、按会话 id 过滤。',
    parameters: {
      keyword: { type: 'string', description: '搜索关键词（支持正则）' },
      sessionId: { type: 'string', description: '会话 id' },
      limit: { type: 'number', description: '返回条数，默认 50' },
    },
    output: textOut,
    async execute(args: any) {
      if (args.keyword) return d.history.search(String(args.keyword), args.sessionId)
      if (args.sessionId) return d.history.bySession(args.sessionId)
      return d.history.list(Math.max(1, Number(args.limit) || 50))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'eagent_history_clear',
    description: '清空历史对话，或按保留天数裁剪。',
    parameters: { retentionDays: { type: 'number' } },
    output: textOut,
    async execute(args: any) {
      const n = typeof args.retentionDays === 'number'
        ? await d.history.enforceRetention()
        : await d.history.clear()
      return `已清理 ${n} 条历史`
    },
  }))

  // ---------- 网页端信息 ----------
  ctx.tools.register(defineTool({
    name: 'eagent_web_profile',
    description: '返回当前网页端适配配置（选择器、统一智能模式、额度轮询、聊天搜索开关）。',
    parameters: {},
    output: textOut,
    async execute() {
      return {
        profile: d.web.profile,
        injectedSnippet: d.web.injectSnippet(),
        config: {
          typingDelayMs: d.config.typingDelayMs,
          maxConcurrency: d.config.maxConcurrency,
          perAccountConcurrency: d.config.perAccountConcurrency,
        },
      }
    },
  }))

  // ---------- 模型提供方注册（加入模型选择器）----------
  ctx.tools.register(defineTool({
    name: 'eagent_model_register',
    description: '注册一个 OpenAI 兼容模型到 DSH Web 端模型选择器。参数：providerId/displayName/baseUrl/apiKey/models（模型 id 数组或 [{id,label,capabilities}]）/protocol。兼容 0.2.2-rc.5 与 0.2.3-alpha。',
    parameters: {
      providerId: { type: 'string', required: true, description: '小写字母开头的唯一 Provider ID' },
      displayName: { type: 'string', description: '选择器显示名称' },
      baseUrl: { type: 'string', required: true, description: 'OpenAI 兼容 Base URL（不含 /chat/completions）' },
      apiKey: { type: 'string', required: true, description: 'API Key' },
      protocol: { type: 'string', description: 'openai-completions | openai-responses | anthropic-messages，默认 openai-completions' },
      models: { type: 'array', required: true, description: '模型列表' },
      defaultModel: { type: 'string', description: '可选，默认模型 id' },
    },
    output: textOut,
    async execute(args: any) {
      const cfg = parseProviderConfig(args)
      const r = d.modelProvider.register(cfg)
      return r.message
    },
  }))

  ctx.tools.register(defineTool({
    name: 'eagent_model_list',
    description: '列出本插件已注册到选择器的模型 Provider。',
    parameters: {},
    output: textOut,
    async execute() {
      const list = d.modelProvider.list()
      return list.length ? `已注册 Provider：${list.join(', ')}` : '尚未注册任何 Provider'
    },
  }))

  ctx.tools.register(defineTool({
    name: 'eagent_cookie_sync',
    description: '返回本地 Cookie 桥接服务的地址与 token，供浏览器扩展自动同步 deepseek.com 登录态（无需手动导入）。扩展向 bridgeUrl/cookie POST Bearer token + cookies 即可。',
    parameters: {},
    output: textOut,
    async execute() {
      if (!d.cookieBridge) return 'Cookie 桥接服务未启用'
      // 连接信息由 index 写入模块级变量，这里从 ctx 取
      return (d.ctx as any).__EAGENT_BRIDGE_INFO__ || 'Cookie 桥接服务启动信息暂不可用'
    },
  }))

  ctx.tools.register(defineTool({
    name: 'eagent_compat',
    description: '返回当前 DSH 版本能力探测结果（deepseekAuth / llm 注册形态 / agents 结构），用于核对跨版本兼容。',
    parameters: {},
    output: textOut,
    async execute() { return describeCapabilities(d.cap) },
  }))

  return () => { /* ctx 注册随 fiber 自动撤销，无需手动移除 */ }
}
