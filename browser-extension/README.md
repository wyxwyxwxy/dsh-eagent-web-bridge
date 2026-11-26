# EAgent Cookie Bridge 浏览器扩展

自动识别 `chat.deepseek.com` 登录态 Cookie 并同步到本地 DSH 插件 `eagent-web-bridge`，**无需手动导入 Cookie**。支持 Chrome 125+ 与 Firefox 140+（Manifest V3）。

## 功能

- 打开/刷新 DeepSeek 网页 → 自动检测登录态 → 读取 `*.deepseek.com` Cookie → POST 到本地桥接服务 → 插件自动 upsert 账号
- "打开 DeepSeek 网页并识别"一键跳转
- 侧边栏会话入口 + 弹窗状态面板
- 本地桥接服务仅监听 `127.0.0.1`，带 Bearer token 校验

## 安装（加载已解压扩展）

**Chrome / Edge：**
1. 打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录（`browser-extension/`）
4. 点击扩展图标 → 「自动连接本地服务」

**Firefox：**
1. 打开 `about:debugging#/runtime/this-firefox`
2. 点「加载临时附加组件」，选择本目录的 `manifest.json`
3. 点击扩展图标 → 「自动连接本地服务」

也可运行安装脚本自动打开扩展管理页：

```sh
bash install.sh        # macOS / Linux，自动探测 chrome/chromium/firefox
powershell -File install.ps1   # Windows
```

## 连接原理

1. DSH 插件启动后，在本地起桥接服务（默认 `http://127.0.0.1:17890`，可用 `cookieBridge.port` 配置）。
2. 插件把连接信息写到 `$DSH_HOME/eagent/bridge-connection.json`，并写到 `bridge-token`。
3. 扩展「自动连接」：请求 `/health` 探测端口，`/token` 获取 token（仅 localhost）。
4. 检测到登录态后，扩展 `POST /cookie`，Header `Authorization: Bearer <token>`，Body 含 cookies 数组。
5. 插件校验 token 后自动创建/更新账号，无需手动粘贴 Cookie。

> 若桥接端口非默认且 `/token` 不可用，可在 popup「高级」里手动填写 `bridgeUrl` 与 `token`（二者来自 `bridge-connection.json`）。

## 权限说明

- `cookies`：读取 `*.deepseek.com` Cookie（仅此域名）
- `tabs`/`activeTab`：检测页面加载完成触发识别
- `sidePanel`：侧边栏会话入口
- `host_permissions`：`*.deepseek.com` 与 `127.0.0.1`（本地桥接）

不上传任何数据到远端；Cookie 只发往本机桥接服务。
