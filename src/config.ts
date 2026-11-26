import Schema from '@deepseek-ai/schemastery'

export interface WebAdaptConfig {
  /** 2026-09-10 起三模式合并为统一「智能模式」，不再依赖旧的模式切换按钮。 */
  unifiedSmartMode: boolean
  /** 额度状态轮询间隔（ms），页面可见时生效。默认 5 分钟。 */
  quotaPollingMs: number
  /** 检测 quotas[].is_exhausted，命中时暂停该账号任务并上报。 */
  detectQuotaExhausted: boolean
  /** 聊天记录搜索（2026-05 灰度）。 */
  enableHistorySearch: boolean
}

export interface Config {
  /** 每个字符的平均输入延迟（ms）。0 = 瞬时。 */
  typingDelayMs: number
  /** 抖动比例 0~1。 */
  typingJitter: number
  /** 按词/标点分段输入。 */
  chunkedTyping: boolean
  /** 全局最大并发任务数。 */
  maxConcurrency: number
  /** 单账号最大并发。 */
  perAccountConcurrency: number
  /** 同账号任务冷却间隔（ms）。 */
  accountCooldownMs: number
  /** 存储目录（相对 DSH_HOME）。 */
  storeDir: string
  /** 是否记录历史。 */
  historyEnabled: boolean
  /** 历史保留天数，0=永久。 */
  historyRetentionDays: number
  /** 网页端适配。 */
  web: WebAdaptConfig
}

/**
 * Schemastery schema —— Cordis 在加载时用其校验配置并填充默认值。
 * 注意：必须是 Schema.object(...)，不能导出普通对象。
 */
export const Config = Schema.object({
  typingDelayMs: Schema.number().default(45),
  typingJitter: Schema.number().default(0.35),
  chunkedTyping: Schema.boolean().default(true),
  maxConcurrency: Schema.number().default(3),
  perAccountConcurrency: Schema.number().default(1),
  accountCooldownMs: Schema.number().default(2000),
  storeDir: Schema.string().default('eagent'),
  historyEnabled: Schema.boolean().default(true),
  historyRetentionDays: Schema.number().default(30),
  web: Schema.object({
    unifiedSmartMode: Schema.boolean().default(true),
    quotaPollingMs: Schema.number().default(300000),
    detectQuotaExhausted: Schema.boolean().default(true),
    enableHistorySearch: Schema.boolean().default(true),
  }).default({}),
})
