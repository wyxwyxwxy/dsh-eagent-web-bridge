# @eagent/dsh-web-bridge

> DeepSeek Harness（DSH）网页端桥接插件：**多账号管理 · 免导入 Cookie 自动识别 · 模型加入选择器 · 拟人化输入延迟 · 全局/单账号并发限制 · 会话历史 · 最新网页端适配 · 多版本兼容**。

它是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 **Cordis 插件**：一个导出 `name` / `Config` / `apply(ctx)` 的 TypeScript 模块，通过 `package.json` 的 `dsh.bundle` 声明为可安装 Bundle。**不是**独立 App，也不是反向代理。

配套浏览器扩展见 [`browser-extension/`](./browser-extension/)。

---

## 兼容性（重要）

| 项目 | 要求 |
|---|---|
| DeepSeek Harness | **0.2.2-rc.5 ~ 0.2.3-alpha.x**（一份代码兼容，运行时能力探测） |
| Node.js | `>= 24.9.0`（rc.5 门槛）或 `>= 26.0.0` |
| Profile | `web` |
| 浏览器扩展 | Chrome 125+ / Firefox 140+（Manifest V3） |
| 许可证 | MIT |

**多版本兼容机制**：插件不做硬编码版本判断，而是运行时探测能力（`src/compat.ts`）：

- `ctx.deepseekAuth` 存在与否 → v0.2.3 新授权 / v0.2.2 旧配置；
- `ctx.llm` 的注册方法名（`registerAdapter` / `registerProvider` / `register`）→ 自动选模型注册形态；
- `list_agents` 结构（`agents` 字段 vs 旧数组）→ 双结构兼容；
- 用 `eagent_compat` 工具可随时查看当前探测到的版本能力矩阵。

> ⚠️ DSH 仍是 developer preview，0.2.3 的 Cordis/Loader/Include、配置校验、Session status、fork API 都在变。建议**独立 Profile + 固定版本**先验证。

---

## 安装

**web profile：**

```sh
dsh plugin --profile web add github:wyxwyxwxy/dsh-eagent-web-bridge
# 固定版本（alpha 期推荐）
dsh plugin --profile web add github:wyxwyxwxy/dsh-eagent-web-bridge#<commit-sha>
```

**desktop profile（Windows 桌面版同样支持）：**

```sh
dsh plugin --profile desktop add github:wyxwyxwxy/dsh-eagent-web-bridge
```

验证加载：

```sh
dsh --profile web --dump-config      # web
dsh --profile desktop --dump-config  # desktop
```

### Windows 排错：`ERR_PNPM_GIT_RESOLVE_FAILED` / `'git' 不是内部或外部命令`

`dsh plugin add github:...` 底层靠 pnpm 调用 `git ls-remote` 解析 GitHub 依赖。**如果 Windows 没装 Git，就会报**：

```
Failed to resolve git dependency "https://github.com/...":
git ls-remote failed: 'git' 不是内部或外部命令，也不是可运行的程序
```

这与插件版本无关。二选一解决：

**方案 A（推荐，一劳永逸）：安装 Git for Windows**
1. 下载安装 https://git-scm.com/download/win
2. 安装时"Adjusting your PATH"选 **Git from the command line and also from 3rd-party software**（默认项）
3. **完全关闭并重新打开** PowerShell / 终端（让 PATH 生效）
4. 验证：`git --version` 能输出版本号即可
5. 重新运行 `dsh plugin --profile desktop add github:wyxwyxwxy/dsh-eagent-web-bridge`

> 报错里建议的 `git config --global url."git@github.com:".insteadOf ...` 是给"能连 SSH 但连不上 HTTPS"的情况；你是 git 命令根本不存在，配了也没用，先装 Git。

**方案 B（不装 Git，用本地 link 装）：**
1. 下载源码包 `dsh-eagent-web-bridge-source.zip`（或仓库 `Code → Download ZIP`），解压到本地目录，例如 `C:\Users\admin\dsh-eagent-web-bridge`
2. 运行（用**你自己解压后的实际路径**）：

```powershell
dsh plugin --profile desktop add link:C:\Users\admin\dsh-eagent-web-bridge
```

`link:` 走本地文件系统，完全不调用 git，可绕过该错误。

> 另注：0.2.2-rc.5 官方要求 **Node.js ≥ 24.9.0**；若装完 Git 后又提示 Node 版本，请先升级 Node 到 24.9.0+。

---

## 功能与配置

### 1. 免导入 Cookie 自动识别（新增）

装好配套浏览器扩展后：打开/刷新 `chat.deepseek.com` → 扩展自动读取登录态 Cookie → POST 到本地桥接服务 → 插件自动创建/更新账号，**无需手动粘贴 Cookie**。

- 桥接服务默认 `http://127.0.0.1:17890`，仅本机、Bearer token 校验；
- 连接信息写入 `$DSH_HOME/eagent/bridge-connection.json`；
- 配置项（`cordis.patch.yml`）：`cookieBridge.enabled` / `cookieBridge.port` / `cookieBridge.allowOpen`；
- 扩展安装与原理见 [`browser-extension/README.md`](./browser-extension/README.md)。

仍保留手动导入：`eagent_account_import`（每行 `标签|cookie`）。

### 2. 模型加入选择器（新增）

通过 `eagent_model_register` 注册 OpenAI 兼容模型到 Web 端模型选择器（底层 `ctx.llm.registerAdapter()`，自动适配三种注册形态）：

```
eagent_model_register({
  providerId: "myp",
  displayName: "我的模型",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-...",
  protocol: "openai-completions",   // openai-completions | openai-responses | anthropic-messages
  models: [{ id: "model-x", label: "模型X", capabilities: { tools: true, vision: true } }]
})
```

保存后在 Web UI 模型选择器即可看到。`eagent_model_list` 查看已注册 Provider。凭据不写入日志/源码。

### 3. 输入延迟（每字平均输入多久）

| 字段 | 默认 | 含义 |
|---|---|---|
| `typingDelayMs` | `45` | 每字符平均延迟（ms），0=瞬时 |
| `typingJitter` | `0.35` | 抖动比例，实际 = 延迟 ×(1±抖动) |
| `chunkedTyping` | `true` | 按词/标点分段，标点停顿×3 |

推荐：求稳 60–120ms，吞吐 20–40ms。`eagent_estimate_typing` 可预估耗时。

### 4. 并发限制（最大并发多少）

| 字段 | 默认 | 含义 |
|---|---|---|
| `maxConcurrency` | `3` | 全局最大并发 |
| `perAccountConcurrency` | `1` | 单账号并发（防风控） |
| `accountCooldownMs` | `2000` | 账号任务冷却间隔 |

`eagent_set_rate` 可热更新，无需改代码。

### 5. 网页端适配与历史

- 统一「智能模式」（2026-09 三模式合并）、额度轮询 `quotas.is_exhausted`（2026-11）、聊天记录搜索（2026-05）；
- 会话历史 `eagent_history`（关键词/正则搜索）、保留天数 `historyRetentionDays`（默认 30）。

---

## 工具一览

| 工具 | 作用 |
|---|---|
| `eagent_accounts` / `_add` / `_import` / `_toggle` | 多账号管理 |
| `eagent_cookie_sync` | 返回 Cookie 桥接地址与 token（扩展用） |
| `eagent_model_register` / `_list` | 注册模型到选择器 / 查看 |
| `eagent_submit` / `_tasks` / `_cancel` | 任务提交与并发队列 |
| `eagent_set_rate` / `_estimate_typing` | 热更新延迟与并发 / 预估耗时 |
| `eagent_history` / `_clear` | 历史对话查看与清理 |
| `eagent_web_profile` / `eagent_compat` | 网页端配置 / 版本能力矩阵 |

---

## 验证与限制

```sh
node scripts/verify.mjs   # 结构与契约自检（86 项）
```

本地自检与 TypeScript 类型检查均通过。**真机仍需验证**：真实 DSH（0.2.2-rc.5 或 0.2.3-alpha）下的加载、工具执行、模型选择器显示、扩展 Cookie 同步、卸载。alpha 期 DOM 与接口可能继续变化，选择器集中在 `src/webadapter.ts`。

如实说明：
- 这是 Cordis 插件，不是之前的 Android APP；网页交互需宿主桥接层（CDP/WebView 或 dsh-browser），`executeOnWeb` 已留可替换钩子；
- 完整 Node/npm 运行时由 DSH 提供，不塞进插件；
- 不含任何账号凭据，Cookie 由用户浏览器本地产生并只发往 127.0.0.1；
- 浏览器扩展无法在本沙箱"装到你的浏览器"，需你按扩展 README 加载一次（脚本可自动打开扩展管理页）。

## License

MIT © AgentEcosystem
