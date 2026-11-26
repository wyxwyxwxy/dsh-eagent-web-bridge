import type { Context } from '@deepseek-ai/cordis'
import type { WebAdaptConfig } from './config.js'

/**
 * 网页端适配层（对齐 chat.deepseek.com 2026 年最新改动）：
 *
 * 1) 2026-04-08 首次引入「快速 / 专家」模式分层，06 增「识图」，
 *    2026-09-10 三者合并为统一「智能模式」，鲸鱼图标下的模式按钮移除。
 *    => unifiedSmartMode=true 时，快照与点击逻辑不再寻找旧的模式切换按钮。
 * 2) 2026-11 前端出现额度管理：quotas[] 含 is_exhausted，页可见时每 5 分钟轮询；
 *    额度耗尽时输入框上方出现提示条、首页欢迎区被服务端文案替换。
 *    => detectQuotaExhausted / quotaPollingMs。
 * 3) 2026-05 上线聊天记录搜索（灰度）。=> historySearch 查询串。
 * 4) 会话输入框：空输入框按 ↑ 召回本会话已发送文本；消息在宿主确认后才显示并清空草稿。
 *
 * v0.2.3-alpha.1 破坏性变更规避：
 * - 模型/搜索/网页抓取的 DeepSeek 授权统一走 ctx.deepseekAuth（本插件不自行硬编码鉴权）。
 * - list_agents 成员从 `agents` 字段读取（occupied/total 槽位）。
 * - 不使用已移除的 Python PTC；Node PTC 变量默认跨调用保留。
 */
export interface PageSnapshotProfile {
  /** 统一智能模式：无需点击模式按钮。 */
  modeButtons: string[]
  /** 输入框选择器（多候选，按优先级）。 */
  composerSelectors: string[]
  /** 发送按钮选择器。 */
  sendSelectors: string[]
  /** 额度耗尽提示选择器。 */
  quotaExhaustedSelectors: string[]
  /** 空输入框召回上一条（↑）。 */
  recallShortcut: string
  /** 聊天搜索触发选择器。 */
  historySearchSelectors: string[]
}

export function buildSnapshotProfile(cfg: WebAdaptConfig): PageSnapshotProfile {
  const profile: PageSnapshotProfile = {
    modeButtons: [],
    composerSelectors: [
      'textarea[data-testid="chat-input"]',
      'textarea[placeholder*="发送消息"]',
      '#chat-input textarea',
      'div[contenteditable="true"][role="textbox"]',
      'textarea',
    ],
    sendSelectors: [
      'button[data-testid="send-button"]',
      'button[aria-label*="发送"]',
      'div[contenteditable="true"] ~ button',
    ],
    quotaExhaustedSelectors: [],
    recallShortcut: 'ArrowUp',
    historySearchSelectors: [],
  }

  // 旧版（< 0.2.3 / 网页 2026-09 前）才需要这些模式按钮；统一智能模式后清空。
  if (!cfg.unifiedSmartMode) {
    profile.modeButtons = [
      'button[data-mode="fast"]',
      'button[data-mode="expert"]',
      'button[data-mode="vision"]',
    ]
  }

  // 额度耗尽提示（对应 quotas[].is_exhausted 与服务端文案）。
  if (cfg.detectQuotaExhausted) {
    profile.quotaExhaustedSelectors = [
      '[data-testid="quota-limit-banner"]',
      '.quota-exhausted-tip',
      // 文案匹配作为兜底：使用「额度已达上限」最近一次 commit 的提示
      'text=使用额度已达上限',
    ]
  }

  // 聊天记录搜索（2026-05 灰度入口）。
  if (cfg.enableHistorySearch) {
    profile.historySearchSelectors = [
      '[data-testid="chat-history-search"]',
      '[aria-label*="搜索聊天记录"]',
    ]
  }
  return profile
}

/**
 * 从 DSH Context 读取 DeepSeek 授权信息（v0.2.3 起统一入口）。
 * 本插件不直接调用模型，但保留适配点：若将来需要网页抓取/模型调用，
 * 通过这里获取凭据，而不是硬编码。
 */
export function readDeepseekAuth(ctx: Context): unknown | undefined {
  // v0.2.3-alpha.1：models/search/web fetch 通过 ctx.deepseekAuth 获取授权。
  return (ctx as any).deepseekAuth
}

/** 读取 Agent 列表（v0.2.3 起成员在 `agents` 字段，含 occupied/total 槽位）。 */
export function readAgents(ctx: Context): { members: any[]; occupied?: number; total?: number } {
  const raw = (ctx as any).list_agents?.()
  if (!raw) return { members: [] }
  if (Array.isArray(raw)) return { members: raw }          // 旧结构兼容
  return { members: raw.agents ?? [], occupied: raw.occupied, total: raw.total }
}

export class WebAdapter {
  readonly profile: PageSnapshotProfile

  constructor(private ctx: Context, private cfg: WebAdaptConfig) {
    this.profile = buildSnapshotProfile(cfg)
  }

  /** 额度轮询：可注入检测函数，命中则回调（由上层标记账号 quotaExhausted）。 */
  startQuotaPolling(detect: () => Promise<boolean>, onExhausted: () => void): () => void {
    if (!this.cfg.detectQuotaExhausted) return () => {}
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try { if (await detect()) onExhausted() } catch { /* 忽略单次失败 */ }
    }
    const timer = setInterval(tick, Math.max(1000, this.cfg.quotaPollingMs))
    return () => { stopped = true; clearInterval(timer) }
  }

  /** 生成给网页注入的辅助脚本片段（供 CDP/WebView evaluate 使用）。 */
  injectSnippet(): string {
    const p = this.profile
    return [
      `window.__EAGENT_COMPOSER__ = ${JSON.stringify(p.composerSelectors)};`,
      `window.__EAGENT_SEND__ = ${JSON.stringify(p.sendSelectors)};`,
      `window.__EAGENT_QUOTA__ = ${JSON.stringify(p.quotaExhaustedSelectors)};`,
      `window.__EAGENT_RECALL__ = ${JSON.stringify(p.recallShortcut)};`,
      `window.__EAGENT_MODE_BUTTONS__ = ${JSON.stringify(p.modeButtons)};`,
    ].join('\n')
  }
}
