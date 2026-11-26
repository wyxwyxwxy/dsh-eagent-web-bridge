#!/usr/bin/env node
/**
 * 本地自检：在不依赖真实 DSH 运行时的情况下，验证插件结构、契约与破坏性变更规避。
 * 用法：node scripts/verify.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

// 1) 必需文件
for (const f of ['package.json', 'cordis.patch.yml', 'src/index.ts', 'src/config.ts',
  'src/tools.ts', 'src/scheduler.ts', 'src/accounts.ts', 'src/typing.ts',
  'src/history.ts', 'src/webadapter.ts', 'src/store.ts', 'README.md']) {
  check(`文件存在: ${f}`, existsSync(join(root, f)))
}

// 2) package.json 的 dsh.bundle 契约
const pkg = JSON.parse(read('package.json'))
check('dsh.bundle.patch 声明', pkg?.dsh?.bundle?.patch === './cordis.patch.yml')
check('type=module（ESM）', pkg.type === 'module')
check('engines Node >=24.22.3 / >=26.13.1',
  /24\.22\.3/.test(pkg.engines?.node || '') && /26\.13\.1/.test(pkg.engines?.node || ''))
check('peerDependencies 含 cordis/dsh-tools/schemastery',
  ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery']
    .every(k => Object.keys(pkg.peerDependencies || {}).includes(k)))
check('dsh-plugin topic 在 keywords', (pkg.keywords || []).includes('dsh-plugin'))
check('files 包含 cordis.patch.yml', (pkg.files || []).includes('cordis.patch.yml'))

// 3) patch 格式
const patch = read('cordis.patch.yml')
check('patch 使用 insert 行', /- insert:/.test(patch))
check('patch 指向包名', /name:\s*['"]?@eagent\/dsh-web-bridge/.test(patch))
for (const key of ['typingDelayMs', 'maxConcurrency', 'perAccountConcurrency',
  'historyEnabled', 'unifiedSmartMode', 'quotaPollingMs', 'enableHistorySearch']) {
  check(`patch 暴露配置: ${key}`, new RegExp(`\\b${key}\\b`).test(patch))
}

// 4) 插件入口契约
const idx = read('src/index.ts')
check('导出 name', /export const name\s*=/.test(idx))
check('导出 inject=[tools]', /export const inject\s*=\s*\['tools'\]/.test(idx))
check('导出 apply(ctx, config)', /export function apply\(ctx:\s*Context,\s*config:/.test(idx))
check('导出 Config schema', /export \{ Config \}/.test(idx))
check('默认导出对象形态', /export default \{ name, inject, Config, apply \}/.test(idx))
check('使用 ctx.effect 清理', /ctx\.effect\(/.test(idx))

// 5) 工具注册
const tools = read('src/tools.ts')
check('使用 ctx.tools.register(defineTool)', /ctx\.tools\.register\(defineTool\(/.test(tools))
for (const t of ['eagent_accounts', 'eagent_account_add', 'eagent_account_import',
  'eagent_submit', 'eagent_tasks', 'eagent_set_rate', 'eagent_history']) {
  check(`注册工具: ${t}`, new RegExp(`name:\\s*'${t}'`).test(tools))
}

// 6) 功能点
const typing = read('src/typing.ts')
check('输入延迟含 jitter 与分段', /jitter/.test(typing) && /chunked/.test(typing))
const sched = read('src/scheduler.ts')
check('全局并发上限', /runningCount\s*<\s*this\.maxConcurrency/.test(sched))
check('单账号并发上限', /perAccountConcurrency/.test(sched))
const wa = read('src/webadapter.ts')
check('统一智能模式适配（三模式合并）', /unifiedSmartMode/.test(wa) && /智能模式/.test(wa))
check('额度耗尽检测（quotas.is_exhausted）', /is_exhausted/.test(wa))
check('聊天记录搜索适配', /enableHistorySearch/.test(wa))

// 7) v0.2.3 破坏性变更规避
check('v0.2.3: 使用 ctx.deepseekAuth 授权', /deepseekAuth/.test(wa))
check('v0.2.3: list_agents 从 agents 字段读', /raw\.agents/.test(wa))
check('v0.2.3: 标注 Node PTC 保留 / Python PTC 移除', /Python PTC/.test(wa) && /Node PTC/.test(wa))
check('未硬编码旧模式按钮为默认', /modeButtons:\s*\[\]/.test(wa))

// 汇总
const pass = results.filter(r => r.ok).length
const fail = results.filter(r => !r.ok).length
console.log(`\n结果：${pass} 通过 / ${fail} 失败 / 共 ${results.length} 项`)
process.exit(fail ? 1 : 0)
