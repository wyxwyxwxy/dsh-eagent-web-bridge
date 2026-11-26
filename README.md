# @eagent/dsh-web-bridge

> DeepSeek Harness（DSH）网页端桥接插件：**多账号管理 · 拟人化输入延迟 · 全局/单账号并发限制 · 会话历史 · Cookie 管理 · 最新网页端适配**。

它是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 **Cordis 插件**：一个导出 `name` / `Config` / `apply(ctx)` 的 TypeScript 模块，通过 `package.json` 的 `dsh.bundle` 声明为可安装 Bundle。**不是**独立 App，也不是反向代理。

---

## 兼容性（重要）

| 项目 | 要求 |
|---|---|
| DeepSeek Harness | `>= v0.2.3-alpha.1`（含 alpha.2） |
| Node.js | `>= 24.22.3`（24.x）或 `>= 26.13.1`（26.x）—— 对齐 v0.2.3-alpha.2 运行门槛 |
| Profile | `web` |
| 许可证 | MIT |

本插件按 **v0.2.3-alpha.1 的破坏性变更**编写：

- 授权统一走 `ctx.deepseekAuth`，不在插件内硬编码 DeepSeek 凭据；
- `list_agents` 成员从 **`agents`** 字段读取（并检查 occupied/total 槽位），兼容旧数组结构；
- 仅用 Node PTC（变量默认跨调用保留），**不使用已移除的 Python PTC**；
- 经 `ctx` 注册的工具/监听随 fiber 卸载自动清理；手动资源（额度轮询定时器、调度器）用 `ctx.effect()` 清理。

> ⚠️ v0.2.3 仍是 **alpha 预发布**，Cordis / Loader / Include / 配置校验、Session status、module exports、fork API 都在变。建议在**独立 Profile + 固定版本**中先验证，再迁移日常环境。

---

## 安装

在 DSH 终端（web profile）执行：

```sh
dsh plugin --profile web add github:AgentEcosystem/dsh-eagent-web-bridge
```

首次加载后检查：

```sh
dsh --profile web --dump-config   # 确认 eagent-web-bridge 出现在插件树
```

复现固定版本（推荐，alpha 期避免漂移）：

```sh
dsh plugin --profile web add github:AgentEcosystem/dsh-eagent-web-bridge#<commit-sha>
```

> 安装插件等于以你的权限运行第三方代码。安装前请阅读源码与 MIT 许可证；本插件不请求 sudo、不访问无关域名、无 install 脚本。

---

## 配置

配置写在 `cordis.patch.yml` 或上层 Profile/用户 Patch 中，Cordis 会用导出的 Schemastery schema 校验并填默认值。

### 输入延迟（每字平均输入多久）

| 字段 | 默认 | 含义 |
|---|---|---|
| `typingDelayMs` | `45` | 每个字符的**平均输入延迟（毫秒）**。0 = 瞬时输入 |
| `typingJitter` | `0.35` | 抖动比例 0~1，实际延迟 = 延迟 ×(1±抖动)，模拟真人手速波动 |
| `chunkedTyping` | `true` | 按词/标点分段输入（中文逐字、英文按词），标点处额外停顿 |

推荐：求稳用 `60~120ms`；追求吞吐用 `20~40ms`；`0` 仅用于测试（易被判为机器）。可用 `eagent_estimate_typing` 预估一段文本的总耗时。

### 并发限制（最大并发多少）

| 字段 | 默认 | 含义 |
|---|---|---|
| `maxConcurrency` | `3` | **全局最大并发任务数** |
| `perAccountConcurrency` | `1` | **单个账号同时最多任务数**（防同账号风控） |
| `accountCooldownMs` | `2000` | 同账号两次任务的最小间隔（冷却） |

推荐：单账号 `1`、全局不超过账号数；账号多且分散时再逐步上调。可用 `eagent_set_rate` 热更新，无需改代码。

### 网页端适配（对齐 2026 年改动）

| 字段 | 默认 | 对应改动 |
|---|---|---|
| `web.unifiedSmartMode` | `true` | 2026-09-10「快速/专家/识图」三模式合并为统一「智能模式」，不再寻找旧模式按钮 |
| `web.quotaPollingMs` | `300000` | 2026-11 额度管理：页可见时每 5 分钟轮询 `quotas[].is_exhausted` |
| `web.detectQuotaExhausted` | `true` | 命中额度耗尽则暂停该账号并上报 |
| `web.enableHistorySearch` | `true` | 2026-05 上线的聊天记录搜索入口 |

其他：`storeDir`（默认 `eagent`，位于 `$DSH_HOME/eagent`）、`historyEnabled`、`historyRetentionDays`（默认 30 天，0=永久）。

---

## 工具一览

模型可直接调用以下工具：

| 工具 | 作用 |
|---|---|
| `eagent_accounts` | 列出账号与状态（启用/额度耗尽/冷却） |
| `eagent_account_add` / `eagent_account_import` | 新增账号 / 批量导入 Cookie（`标签\|cookie` 每行） |
| `eagent_account_toggle` | 启用/停用账号 |
| `eagent_submit` | 提交任务（自动选可用账号，并发受控），返回 taskId |
| `eagent_tasks` / `eagent_cancel` | 查看队列 / 取消任务 |
| `eagent_set_rate` | 热更新输入延迟与并发上限 |
| `eagent_estimate_typing` | 预估输入耗时 |
| `eagent_history` / `eagent_history_clear` | 查看/搜索历史 / 清理 |
| `eagent_web_profile` | 查看网页端适配配置与注入脚本 |

---

## 运行机制

```
模型工具 eagent_submit
        │
        ▼
TaskScheduler（全局 maxConcurrency + 单账号 perAccountConcurrency + 冷却）
        │  选中可用账号（启用 / 未额度耗尽 / 不在冷却）
        ▼
HumanTyper（每字 typingDelayMs ± jitter，标点停顿，分段输入）
        │  经 CDP / WebView 注入脚本写入网页输入框
        ▼
网页端（统一智能模式、额度轮询、聊天搜索）—— 结果回写 History
```

Cookie 与任务写入 `$DSH_HOME/eagent/accounts.json` / `tasks.json` / `history.jsonl`，JSONL 与 DSH 默认 Session 存储一致。

---

## 验证

无需真实 DSH 运行时即可做结构与契约自检：

```sh
node scripts/verify.mjs
```

它会检查：必需文件、`dsh.bundle` 契约、`inject`/`Config`/`apply` 入口、工具注册、功能开关、以及 v0.2.3 破坏性变更规避项。

**真机仍需验证**（本环境无法替代）：在真实 DSH v0.2.3 + web profile 下执行加载、配置热更新、工具执行、卸载，以及网页 DOM 选择器是否匹配你的 DeepSeek 页面版本。alpha 期 DOM 与接口可能继续变化，选择器集中在 `src/webadapter.ts`，便于跟进。

---

## 限制与如实说明

- 这是 **Cordis 插件**，不是之前的 Android APP；网页交互需要宿主桥接层（如 `dsh-browser` 或 CDP/WebView）落地，`executeOnWeb` 已留可替换钩子。
- 完整的 Node.js/npm 运行时不能塞进插件本身；依赖由 DSH 提供（`peerDependencies`）。
- 本仓库**不含**任何账号凭据；Cookie 由用户自行导入并本地存储。
- 未承诺“开箱即用于生产”：v0.2.3 为 alpha，按官方建议隔离 Profile + 固定版本验证后再用。

## License

MIT © AgentEcosystem
