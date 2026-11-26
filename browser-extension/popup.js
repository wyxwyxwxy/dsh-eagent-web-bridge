const $ = id => document.getElementById(id)
const msg = t => { $('msg').textContent = t || '' }

function send(type, payload = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, ...payload }, r => resolve(r))
  })
}

async function refresh() {
  const s = await send('GET_STATUS')
  if (!s) return
  $('bridge').textContent = s.bridgeUrl || '—'
  $('cookies').textContent = s.cookies ?? '—'
  $('status').innerHTML = s.token
    ? '<span class="ok">已连接</span>'
    : '<span class="off">未连接</span>'
  $('lastSync').textContent = s.lastSyncAt
    ? new Date(s.lastSyncAt).toLocaleString('zh-CN')
    : '尚未同步'
  $('bridgeUrl').value = s.bridgeUrl || ''
  $('token').value = s.token || ''
}

$('btnOpen').onclick = async () => {
  msg('正在打开 DeepSeek 网页…')
  const r = await send('OPEN_DEEPSEEK')
  msg(r?.ok ? '已打开，登录后会自动识别 Cookie' : `失败：${r?.reason || '未知'}`)
}

$('btnSync').onclick = async () => {
  msg('正在同步 Cookie…')
  const r = await send('SYNC_NOW')
  msg(r?.ok ? `已同步，账号 ${r.accountId}` : `失败：${r?.reason || '未知'}`)
  refresh()
}

$('btnConnect').onclick = async () => {
  msg('正在连接本地服务…')
  const r = await send('AUTO_CONNECT')
  msg(r?.token ? `已连接 ${r.bridgeUrl}` : `已探测 ${r?.bridgeUrl}，但未取到 token（请在下方手动填写）`)
  refresh()
}

$('btnSave').onclick = async () => {
  await chrome.storage.local.set({
    bridgeUrl: $('bridgeUrl').value.trim(),
    token: $('token').value.trim(),
  })
  msg('连接信息已保存')
  refresh()
}

refresh()
