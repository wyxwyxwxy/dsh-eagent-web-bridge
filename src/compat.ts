import type { Context } from '@deepseek-ai/cordis'

/**
 * DSH 多版本兼容层。
 *
 * 背景：DSH 处于 developer preview，0.2.2-rc.x 与 0.2.3-alpha.x 的插件接口有差异。
 * 本插件不硬依赖某个版本，而是运行时“能力探测”（capability detection），
 * 对差异点做分支适配。这样一份代码可同时跑在 0.2.2-rc.5 与 0.2.3-alpha.x。
 *
 * 已知差异（据官方 changelog）：
 * - v0.2.3-alpha.1：模型/搜索/网页抓取授权走 ctx.deepseekAuth；
 * - v0.2.3-alpha.1：list_agents 成员从 `agents` 字段读（旧版可能是数组）；
 * - v0.2.3-alpha.1：Python PTC 移除，Node PTC 变量默认跨调用保留；
 * - v0.2.3-alpha.1：Cordis/Loader/Include 与配置校验升级；
 * - v0.2.2-rc.5：ctx.llm.registerAdapter 可用（模型提供方注册）。
 */
export type DshCapability = {
  /** 是否具备 v0.2.3 的 ctx.deepseekAuth 授权入口 */
  hasDeepseekAuth: boolean
  /** ctx.llm 注册适配器的形态 */
  llmRegister: 'registerAdapter' | 'registerProvider' | 'register' | 'none'
  /** list_agents 返回结构 */
  agentsShape: 'agents-field' | 'array' | 'unknown'
  /** 是否支持 ctx.jobs（后台任务） */
  hasJobs: boolean
  /** 探测到的版本字符串（尽力而为，可能为空） */
  versionHint: string
}

/** 尽力读取 DSH 版本：从 ctx 暴露的元信息里找，找不到返回空串。 */
function detectVersion(ctx: Context): string {
  const c = ctx as any
  const candidates = [
    c.version,
    c.dshVersion,
    c.meta?.version,
    c.app?.version,
    c.env?.DSH_VERSION,
    typeof process !== 'undefined' ? process.env?.DSH_VERSION : undefined,
  ]
  for (const v of candidates) if (typeof v === 'string' && v.trim()) return v.trim()
  return ''
}

/** 判定版本 >= 0.2.3-alpha.1（含 alpha 后缀的粗略比较）。 */
export function isAtLeast023(version: string): boolean {
  const m = version.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return false
  const [, maj, min, pat] = m.map(Number) as any
  if (maj > 0) return true
  if (maj === 0 && min > 2) return true
  if (maj === 0 && min === 2 && pat > 3) return true
  // 0.2.3 本身视为“新版”（含 alpha）
  if (maj === 0 && min === 2 && pat === 3) return true
  return false
}

export function detectCapabilities(ctx: Context): DshCapability {
  const c = ctx as any
  const llm = c.llm
  let llmRegister: DshCapability['llmRegister'] = 'none'
  if (llm) {
    if (typeof llm.registerAdapter === 'function') llmRegister = 'registerAdapter'
    else if (typeof llm.registerProvider === 'function') llmRegister = 'registerProvider'
    else if (typeof llm.register === 'function') llmRegister = 'register'
  }
  return {
    hasDeepseekAuth: !!c.deepseekAuth || typeof c.deepseekAuth === 'function',
    llmRegister,
    agentsShape: typeof c.list_agents === 'function' ? 'agents-field' : 'unknown',
    hasJobs: !!c.jobs,
    versionHint: detectVersion(ctx),
  }
}

/** 统一的 list_agents 读取：兼容 `agents` 字段结构与旧数组结构。 */
export function readAgentsSafe(ctx: Context): { members: any[]; occupied?: number; total?: number } {
  const raw = (ctx as any).list_agents?.()
  if (!raw) return { members: [] }
  if (Array.isArray(raw)) return { members: raw }
  return { members: (raw as any).agents ?? [], occupied: (raw as any).occupied, total: (raw as any).total }
}

/** 统一获取 DeepSeek 授权（v0.2.3）或回退到 undefined（旧版自行配置）。 */
export function getDeepseekAuth(ctx: Context): unknown | undefined {
  const c = ctx as any
  if (typeof c.deepseekAuth === 'function') {
    try { return c.deepseekAuth() } catch { return c.deepseekAuth }
  }
  return c.deepseekAuth
}

/** 打印能力矩阵日志，便于用户核对当前跑在哪个版本。 */
export function describeCapabilities(cap: DshCapability): string {
  return [
    `version=${cap.versionHint || 'unknown'}`,
    `deepseekAuth=${cap.hasDeepseekAuth}`,
    `llm.register=${cap.llmRegister}`,
    `agents.shape=${cap.agentsShape}`,
    `jobs=${cap.hasJobs}`,
  ].join(' | ')
}
