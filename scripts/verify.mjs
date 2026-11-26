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
  'src/history.ts', 'src/webadapter.ts', 'src/store.ts', 'src/compat.ts',
  'src/model-provider.ts', 'src/cookie-bridge.ts', 'README.md',
  'browser-extension/manifest.json', 'browser-extension/background.js',
  'browser-extension/content.js', 'browser-extension/popup.html',
  'browser-extension/popup.js', 'browser-extension/sidepanel.html',
  'browser-extension/README.md', 'browser-extension/install.sh']) {
  check(`文件存在: ${f}`, existsSync(join(root, f)))
}

// 2) package.json 的 dsh.bundle 契约
const pkg = JSON.parse(read('package.json'))
check('dsh.bundle.patch 声明', pkg?.dsh?.bundle?.patch === './cordis.patch.yml')
check('type=module（ESM）', pkg.type === 'module')
check('engines Node >=24.9.0（兼容 rc.5 与 alpha.2）',
  /24\.9\.0/.test(pkg.engines?.node || ''))
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
  'historyEnabled', 'unifiedSmartMode', 'quotaPollingMs', 'enableHistorySearch', 'cookieBridge']) {
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
  'eagent_submit', 'eagent_tasks', 'eagent_set_rate', 'eagent_history',
  'eagent_model_register', 'eagent_model_list', 'eagent_cookie_sync', 'eagent_compat']) {
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

// 8) 新功能：模型注册 / Cookie 自动识别 / 多版本兼容
const mp = read('src/model-provider.ts')
check('模型注册用 ctx.llm.registerAdapter', /registerAdapter/.test(mp))
check('模型含 Provider ID/端点/协议/模型列表', /baseURL/.test(mp) && /protocol/.test(mp) && /models/.test(mp))
check('模型兼容多种 llm 注册形态', /registerProvider/.test(mp) && /'register'/.test(mp))
const cb = read('src/cookie-bridge.ts')
check('Cookie 桥接 POST /cookie 自动 upsert', /\/cookie/.test(cb) && /upsert/.test(cb))
check('Cookie 桥接 Bearer token 校验', /Bearer/.test(cb))
check('Cookie 桥接仅监听 127.0.0.1', /127\.0\.0\.1/.test(cb))
const compat = read('src/compat.ts')
check('兼容层探测 deepseekAuth', /hasDeepseekAuth/.test(compat))
check('兼容层探测 llm 注册形态', /llmRegister/.test(compat))
check('兼容层覆盖 0.2.2-rc.5', /0\.2\.2-rc\.5/.test(compat))
check('兼容层 list_agents 双结构', /agents-field/.test(compat) && /array/.test(compat))
const idx2 = read('src/index.ts')
check('index 接入 capability 探测', /detectCapabilities/.test(idx2))
check('index 接入 Cookie 桥接启动', /cookieBridge\.start/.test(idx2))
check('index 接入模型 provider', /new ModelProvider/.test(idx2))
// 浏览器扩展
const manifest = JSON.parse(read('browser-extension/manifest.json'))
check('扩展 Manifest V3', manifest.manifest_version === 3)
check('扩展含 cookies 权限', (manifest.permissions || []).includes('cookies'))
check('扩展 host 权限含 deepseek.com', (manifest.host_permissions || []).some(h => /deepseek\.com/.test(h)))
const bg = read('browser-extension/background.js')
check('后台自动读取 Cookie 并 POST', /chrome\.cookies\.getAll/.test(bg) && /\/cookie/.test(bg))
check('后台自动连接桥接服务', /autoConnect/.test(bg))
// package.json 多版本声明
check('package 兼容 >=0.2.2-rc.5', /0\.2\.2-rc\.5/.test(pkg?.dsh?.compat?.dsh || ''))
check('package Node >=24.9.0', /24\.9\.0/.test(pkg.engines?.node || ''))

// 汇总
const pass = results.filter(r => r.ok).length
const fail = results.filter(r => !r.ok).length
console.log(`\n结果：${pass} 通过 / ${fail} 失败 / 共 ${results.length} 项`)
process.exit(fail ? 1 : 0)
