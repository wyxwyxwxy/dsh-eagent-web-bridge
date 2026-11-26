/**
 * 内容脚本：运行在 chat.deepseek.com 页面。
 * 检测到登录态（页面出现输入框/会话区，且无登录引导）后通知后台同步 Cookie。
 */
(function () {
  const MAX_WAIT = 15000
  const CHECK_INTERVAL = 1000
  let elapsed = 0

  function looksLoggedIn() {
    // 登录后页面有输入框与会话入口；登录页通常是独login/register 按钮。
    const hasComposer = !!document.querySelector(
      'textarea, div[contenteditable="true"][role="textbox"], [data-testid="chat-input"]'
    )
    const loginOnly = !!document.querySelector(
      'a[href*="login"], button[type="submit"][class*="login"]'
    ) && !hasComposer
    return hasComposer && !loginOnly
  }

  const timer = setInterval(() => {
    elapsed += CHECK_INTERVAL
    if (looksLoggedIn()) {
      clearInterval(timer)
      try {
        chrome.runtime.sendMessage({
          type: 'DEEPSEEK_LOGIN_DETECTED',
          url: location.href,
          label: '网页自动识别',
        })
      } catch { /* 扩展上下文失效 */ }
    } else if (elapsed >= MAX_WAIT) {
      clearInterval(timer)
    }
  }, CHECK_INTERVAL)
})()
