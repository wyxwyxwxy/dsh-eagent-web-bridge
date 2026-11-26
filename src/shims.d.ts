// 开发期类型垫片。真实运行时由 DSH 提供这些包；此处仅为本地 typecheck 提供最小声明。
declare module '@deepseek-ai/cordis' {
  export interface Context {
    on(event: string, handler: (...args: any[]) => void): void
    effect(cleanup: () => void): void
    [key: string]: any
  }
}
declare module '@deepseek-ai/dsh-tools' {
  export interface ToolDefinition {
    name: string
    description: string
    parameters: Record<string, { type: string; required?: boolean; description?: string; [k: string]: any }>
    output?: {
      schema?: Record<string, any>
      render?: (args: any, value: any) => Array<{ type: string; text?: string; [k: string]: any }>
    }
    execute: (args: any, ctx?: any) => any
  }
  export function defineTool(def: ToolDefinition): ToolDefinition
}
declare module '@deepseek-ai/schemastery' {
  namespace Schema {
    function object(shape: Record<string, any>): any
    function string(): any
    function number(): any
    function integer(): any
    function boolean(): any
    function union(values: any[]): any
    function array(item: any): any
    function dict(item: any): any
  }
  export default Schema
}
