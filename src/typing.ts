export interface TypingOptions {
  /** 每字符平均延迟（ms）。 */
  delayMs: number
  /** 抖动比例 0~1。 */
  jitter: number
  /** 是否按词/标点分段。 */
  chunked: boolean
  /** 可取消检查：返回 true 则中止。 */
  shouldAbort?: () => boolean
  /** 每输入一段的回调（用于驱动网页 type/paste）。 */
  onSegment?: (segment: string) => void | Promise<void>
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * 拟人化输入：把一段文本切成“视觉上像人手打出来”的片段，
 * 每段之间按 delayMs ± jitter 延迟后通过 onSegment 输出。
 *
 * 用途：在网页端逐字/逐词输入，避免瞬时填充被判为机器人；
 * delayMs 即用户要求的“每个字平均要输入多久”。
 */
export class HumanTyper {
  private jittered(delayMs: number, jitter: number): number {
    const span = delayMs * Math.max(0, Math.min(1, jitter))
    return Math.max(0, delayMs + (Math.random() * 2 - 1) * span)
  }

  /** 将文本切成段：chunked 时按标点和词边界，否则逐字符。 */
  static segment(text: string, chunked: boolean): string[] {
    if (!chunked) return [...text]
    // 中文逐字、英文按单词，遇到标点单独成段并在其后稍作停顿
    const tokens = text.match(/[\u4e00-\u9fa5]|[A-Za-z0-9_']+|[^\s]/g) ?? []
    return tokens
  }

  async type(text: string, opts: TypingOptions): Promise<void> {
    const delay = Math.max(0, opts.delayMs)
    const segments = HumanTyper.segment(text, opts.chunked)
    for (const seg of segments) {
      if (opts.shouldAbort?.()) break
      await opts.onSegment?.(seg)
      // 标点处多停顿一点，更接近真人
      const pause = /[，。！？,.!?;；:\n]/.test(seg) ? delay * 3 : delay
      await sleep(this.jittered(pause, opts.jitter))
    }
  }

  /** 仅计算预计耗时（ms），便于在工具里预估/展示。 */
  estimate(text: string, opts: Pick<TypingOptions, 'delayMs' | 'jitter' | 'chunked'>): number {
    const segs = HumanTyper.segment(text, opts.chunked)
    return segs.reduce((sum, seg) => {
      const base = /[，。！？,.!?;；:\n]/.test(seg) ? opts.delayMs * 3 : opts.delayMs
      return sum + this.jittered(base, opts.jitter)
    }, 0)
  }
}
