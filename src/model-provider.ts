import type { Context } from '@deepseek-ai/cordis'
import type { DshCapability } from './compat.js'

export interface ModelDef {
  id: string
  label: string
  /** 是否支持工具调用 / 视觉 / 推理（写入能力声明） */
  capabilities?: {
    tools?: boolean
    vision?: boolean
    reasoning?: boolean
    contextWindow?: number
  }
}

export interface ProviderConfig {
  /** 唯一 Provider ID（小写字母开头，路由名）。 */
  providerId: string
  /** 模型选择器里显示的名称。 */
  displayName: string
  /** OpenAI 兼容端点 Base URL（系统自动拼 /chat/completions）。 */
  baseUrl: string
  /** API 协议：openai-completions | openai-responses | anthropic-messages。 */
  protocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages'
  /** API Key（只写保存，不回显）。 */
  apiKey: string
  /** 要加入选择器的模型列表。 */
  models: ModelDef[]
  /** 是否设为默认模型。 */
  defaultModel?: string
}

/**
 * 把自定义模型注册进 DSH Web 端模型选择器。
 *
 * 依据多份官方/云厂商文档交叉验证：ctx.llm 是 Harness 模型服务，
 * 通过 ctx.llm.registerAdapter() 注册 Provider 路由；请求的 provider
 * 用于选择路由，model 交给适配器解释。同一 Provider 路由不可重复注册。
 *
 * 对 0.2.2-rc.5 / 0.2.3-alpha.x 的 API 形态差异做分支：
 * registerAdapter / registerProvider / register。
 */
export class ModelProvider {
  private registered: string[] = []

  constructor(private ctx: Context, private cap: DshCapability) {}

  /** 注册单个 Provider（含其模型列表）。返回是否成功。 */
  register(cfg: ProviderConfig): { ok: boolean; message: string } {
    const llm = (this.ctx as any).llm
    if (!llm || this.cap.llmRegister === 'none') {
      return { ok: false, message: '当前 DSH 未提供 ctx.llm 模型服务，无法注册模型' }
    }
    if (!cfg.providerId || !/^[a-z]/.test(cfg.providerId)) {
      return { ok: false, message: 'providerId 必须小写字母开头' }
    }
    if (!cfg.models?.length) {
      return { ok: false, message: 'models 列表为空' }
    }

    // 构造适配器描述（尽力贴合 DSH 的注册契约；未知字段由适配器忽略）
    const adapter = this.buildAdapter(cfg)

    try {
      switch (this.cap.llmRegister) {
        case 'registerAdapter':
          llm.registerAdapter(cfg.providerId, adapter)
          break
        case 'registerProvider':
          llm.registerProvider({ id: cfg.providerId, ...adapter })
          break
        case 'register':
          llm.register(cfg.providerId, adapter)
          break
      }
      this.registered.push(cfg.providerId)
      const modelIds = cfg.models.map(m => m.id).join(', ')
      return {
        ok: true,
        message: `已在模型选择器注册 ${cfg.displayName} (provider=${cfg.providerId}, models=${modelIds})`,
      }
    } catch (e: any) {
      // 重复注册是已知错误：同一 Provider 路由不能注册到不同适配器
      return { ok: false, message: `注册失败：${e?.message ?? String(e)}` }
    }
  }

  private buildAdapter(cfg: ProviderConfig) {
    return {
      provider: cfg.providerId,
      label: cfg.displayName,
      baseURL: cfg.baseUrl,
      protocol: cfg.protocol,
      // 凭据通过独立字段提供，适配器应避免写入日志
      credentials: { apiKey: cfg.apiKey },
      models: cfg.models.map(m => ({
        id: m.id,
        name: m.label,
        capabilities: {
          tools: m.capabilities?.tools ?? true,
          vision: m.capabilities?.vision ?? false,
          reasoning: m.capabilities?.reasoning ?? false,
          contextWindow: m.capabilities?.contextWindow ?? 128000,
        },
      })),
      ...(cfg.defaultModel ? { defaultModel: cfg.defaultModel } : {}),
    }
  }

  /** 已注册的 Provider 列表（便于工具查询/回滚）。 */
  list(): string[] { return [...this.registered] }

  /** 卸载时注销（若适配器提供 unregister）。ctx.effect 亦会兜底清理 ctx 注册项。 */
  dispose(): void {
    const llm = (this.ctx as any).llm
    for (const id of this.registered) {
      try { llm?.unregisterAdapter?.(id) ?? llm?.unregister?.(id) } catch { /* 忽略 */ }
    }
    this.registered = []
  }
}

/** 从普通对象解析并校验 ProviderConfig（供工具 execute 调用）。 */
export function parseProviderConfig(raw: any): ProviderConfig {
  const models: ModelDef[] = (raw.models ?? []).map((m: any) =>
    typeof m === 'string'
      ? { id: m, label: m }
      : { id: m.id, label: m.label ?? m.id, capabilities: m.capabilities })
  return {
    providerId: String(raw.providerId ?? '').trim(),
    displayName: String(raw.displayName ?? raw.providerId ?? '').trim(),
    baseUrl: String(raw.baseUrl ?? '').trim(),
    protocol: (raw.protocol ?? 'openai-completions') as ProviderConfig['protocol'],
    apiKey: String(raw.apiKey ?? ''),
    models,
    defaultModel: raw.defaultModel,
  }
}
