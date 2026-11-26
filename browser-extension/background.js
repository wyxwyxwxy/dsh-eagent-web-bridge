/**
 * EAgent Cookie Bridge —— 后台服务
 * 职责：
 *  1) 监听用户打开/刷新 chat.deepseek.com，自动读取登录态 Cookie 并推送到本地 DSH 插件桥接服务；
 *  2) 提供“自动连接”：探测本地桥接服务地址并获取 token（仅 127.0.0.1）；
 *  3) 支持“自动跳转网页”：主动打开 DeepSeek 网页触发登录态识别。
 */

const DEFAULT_BRIDGE = 'http://127.0.0.1:17890'
const DEEPSEEK_HOSTS = ['chat.deepseek.com', 'www.deepseek.com', 'deepseek.com']

// ---------- 连接配置 ----------
async function getConfig() {
  const s = await chrome.storage.local.get(['bridgeUrl', 'token', 'autoSync', 'allowOpen'])
  return {
    bridgeUrl: s.bridgeUrl || DEFAULT_BRIDGE,
    token: s.token || '',
    autoSync: s.autoSync !== false,
    allowOpen: s.allowOpen !== false,
  }
}

async function setConfig(patch) {
  await chrome.storage.local.set(patch)
}

/** 自动连接：探测本地桥接服务，取其地址与 token。 */
async function autoConnect() {
  // 1) 先尝试默认端口的 /health
  let base = DEFAULT_BRIDGE
  try {
    const r = await fetch(`${base}/health`, { method: 'GET' })
    if (r.ok) {
      const j = await r.json()
      if (j.port) base = `http://127.0.0.1:${j.port}`
    }
  } catch { /* 默认端口不通，继续尝试从粘贴的连接信息 */ }

  // 2) 尝试从本地桥接服务获取 token（仅 localhost，见服务端 /token 说明）
  let token = ''
  try {
    const r = await fetch(`${base}/token`, { method: 'GET' })
    if (r.ok) {
      const j = await r.json()
      token = j.token || ''
    }
  } catch { /* 无 /token 端点时需手动粘贴 */ }

  await setConfig({ bridgeUrl: base, token })
  return { bridgeUrl: base, token }
}

// ---------- Cookie 同步 ----------
function isDeepseekHost(hostname) {
  return DEEPSEEK_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h))
}

async function readDeepseekCookies() {
  const all = await chrome.cookies.getAll({})
  const ds = all.filter(c => isDeepseekHost((c.domain || '').replace(/^\./, '')))
  return ds.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
  }))
}

/** 判断是否为“已登录”状态：存在 session/token 类 Cookie。 */
function looksLoggedIn(cookies) {
  const names = cookies.map(c => c.name.toLowerCase())
  return names.some(n => /session|token|auth|uid|user|sid|sessionid/.test(n))
}

/** 推送 Cookie 到本地桥接服务。 */
async function syncCookies(url, label) {
  const cfg = await getConfig()
  if (!cfg.autoSync) return { ok: false, reason: 'autoSync disabled' }
  const cookies = await readDeepseekCookies()
  if (!cookies.length) return { ok: false, reason: 'no deepseek cookies' }
  if (!looksLoggedIn(cookies)) return { ok: false, reason: 'not logged in (no session cookie)' }

  try {
    const resp = await fetch(`${cfg.bridgeUrl}/cookie`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({
        label: label || '浏览器自动导入',
        cookies,
        url: url || 'https://chat.deepseek.com/',
      }),
    })
    const j = await resp.json().catch(() => ({}))
    if (!resp.ok) return { ok: false, reason: j.error || `HTTP ${resp.status}` }
    await setConfig({ lastSyncAt: Date.now(), lastAccountId: j.accountId })
    return { ok: true, accountId: j.accountId }
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) }
  }
}

// ---------- 事件监听 ----------
// 打开/刷新 DeepSeek 页面时自动识别登录态
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return
  try {
    const u = new URL(tab.url)
    if (!isDeepseekHost(u.hostname)) return
    // 稍等确保登录态 Cookie 已写入
    setTimeout(() => { void syncCookies(tab.url, `自动识别 · ${u.hostname}`) }, 1200)
  } catch { /* 非 http(s) URL */ }
})

// 内容脚本通知：检测到登录态
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'DEEPSEEK_LOGIN_DETECTED') {
      const r = await syncCookies(msg.url || sender.tab?.url, msg.label)
      sendResponse(r)
    } else if (msg?.type === 'AUTO_CONNECT') {
      sendResponse(await autoConnect())
    } else if (msg?.type === 'GET_STATUS') {
      const cfg = await getConfig()
      sendResponse({ ...cfg, cookies: (await readDeepseekCookies()).length })
    } else if (msg?.type === 'SYNC_NOW') {
      sendResponse(await syncCookies('https://chat.deepseek.com/', '手动同步'))
    } else if (msg?.type === 'OPEN_DEEPSEEK') {
      const cfg = await getConfig()
      if (!cfg.allowOpen) { sendResponse({ ok: false, reason: 'allowOpen disabled' }); return }
      await chrome.tabs.create({ url: 'https://chat.deepseek.com/', active: true })
      sendResponse({ ok: true })
    } else {
      sendResponse({ ok: false, reason: 'unknown message' })
    }
  })()
  return true // 异步 sendResponse
})

// 安装后尝试自动连接一次
chrome.runtime.onInstalled.addListener(() => { void autoConnect() })
