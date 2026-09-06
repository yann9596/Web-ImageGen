# GPT Web Provider 代码设计

状态：ready-for-implementation

更新时间：2026-09-05

本文把 [GPT Web Provider Integration 设计](./gpt-provider-design.md)落实为模块、数据结构和一次性 CLI 契约。当前只定义实现边界，不修改真实 Codex 配置，也不操作浏览器。

## 1. 当前基线与必须拆开的耦合

| 当前位置 | 当前行为 | GPT 接入前的处理 |
|---|---|---|
| `scripts/skill-provider.mjs` | 只认识 `openai | grok`，从启用的 Skill 猜 provider | 改成 `default | grok | gpt`，增加独立 provider 状态和一致性检查 |
| `src/contract.mjs` | init 没有 provider，数量和质量规则默认是 Grok 规则 | provider 成为显式输入；数量预算由 provider policy 计算 |
| `src/jobs.mjs` | `job.json` 没有 schema/provider/attempt | 引入 schema v2、不可变 provider 和 Provider Attempt |
| `src/select.mjs` | 包含 Grok Post URL/UUID 解析 | 只保留 provider-neutral 选择；Grok/GPT 身份验证进入独立模块 |
| `src/browser-downloads.mjs` | 文件名必须匹配 `grok-image-<uuid>` | 拆成通用快照、Grok resolver、GPT resolver |
| `src/runtime.mjs` | 一次 `collect` 同时隐含提交、响应和候选阶段 | 增加 `attempt-start`、`attempt-bind`，`collect` 只处理已绑定响应的文件 |
| `skill/web-imagegen/SKILL.md` | 顶层直接写 Grok 操作 | 顶层只路由；Grok 与 GPT 指令分文件按需读取 |

迁移原则：先把 Grok 通过新边界跑通，再增加 GPT。任何一步失败时，现有 Grok 离线行为都应能单独定位和回退该步改动。

## 2. 目标文件结构

```text
src/
├─ provider-config.mjs        provider 值、状态编解码、切换计划（纯函数）
├─ atomic-file.mjs            同目录临时文件与原子替换
├─ contract.mjs               CLI 输入、错误闭集、provider policy
├─ jobs.mjs                   job schema v2、迁移、状态转移
├─ attempts.mjs               attempt 生命周期、预算和幂等
├─ runtime.mjs                一次性命令编排，不接触浏览器
├─ download-snapshot.mjs      provider-neutral 下载目录差异
├─ providers/
│  ├─ grok-identity.mjs       Post/response/asset 身份
│  ├─ gpt-identity.mjs        conversation/turn/asset 身份
│  ├─ grok-download.mjs       Grok UUID 文件匹配
│  └─ gpt-download.mjs        GPT 唯一下载差异匹配
└─ select.mjs                 选择门、用户意图、幂等

scripts/
├─ skill-provider.mjs         状态 I/O 与 provider CLI
└─ web-imagegen.mjs           job/attempt CLI

skill/web-imagegen/
├─ SKILL.md                   provider-neutral router
├─ scripts/
│  ├─ cli.mjs
│  ├─ provider.mjs
│  └─ downloads.mjs
└─ references/
   ├─ runtime.md
   ├─ ai-led.md
   ├─ user-led.md
   └─ providers/
      ├─ grok.md
      └─ gpt.md
```

不新增 MCP、daemon、Playwright、CDP、HTTP 客户端或第二套本地 runtime。

## 3. Provider 配置模型

### 3.1 规范值

`src/provider-config.mjs` 导出：

```js
export const PROVIDERS = Object.freeze(["default", "grok", "gpt"])
export const WEB_PROVIDERS = Object.freeze(["grok", "gpt"])

export function validateProvider(value) {}
export function parseProviderState(text) {}
export function renderProviderState(provider) {}
export function deriveProviderStatus({ managedConfig, providerState }) {}
export function planProviderSwitch({ from, to }) {}
```

约束：

- `default` 只启用官方 ImageGen Skill。
- `grok` 和 `gpt` 只启用 Web ImageGen Skill。
- Web ImageGen runtime 只接受 `grok | gpt`；`default` 不产生 Web ImageGen job。
- 所有公开输出只返回规范值。旧字符串 `openai` 不进入 job 或 provider 状态。
- 三值切换先作为纯函数和隔离目录能力实现；在 GPT runtime 与 Skill 路由完成前，公开 CLI 必须对 `gpt` 返回 `provider-not-ready`，`package.json` 也不暴露 `provider:gpt`。

### 3.2 托管状态文件

路径：`<CODEX_ROOT>/web-imagegen/provider.json`

```json
{
  "schemaVersion": 1,
  "provider": "gpt"
}
```

文件保持最小、确定性和无凭据，不写时间戳。相同 provider 重复切换时内容不变并返回 `changed=false`。

### 3.3 配置一致性

`deriveProviderStatus` 同时读取托管 `config.toml` 块和 `provider.json`：

| 官方 Skill | Web Skill | provider.json | 结果 |
|---|---|---|---|
| on | off | `default` | `default` |
| off | on | `grok` | `grok` |
| off | on | `gpt` | `gpt` |
| on | on | 任意 | `provider-config-mismatch` |
| off | off | 任意 | `provider-config-mismatch` |
| on | off | `grok/gpt` | `provider-config-mismatch` |
| off | on | `default/缺失` | `provider-config-mismatch` |

只允许两条兼容读取规则：旧托管块启用官方 Skill 且不存在 `provider.json` 时报告 `provider=default, migrationRequired=true`；旧托管块启用 Web ImageGen 且不存在状态文件时报告 `provider=grok, migrationRequired=true`。后者成立是因为旧版本唯一 Web Provider 是 Grok。兼容读取不会写盘，首次显式切换再创建状态文件。

### 3.4 安全写入顺序

两个文件不能组成真正的跨文件原子事务，因此 `planProviderSwitch` 返回有序步骤：

- `default → grok/gpt`：先原子写 provider 状态，再原子启用 Web Skill。
- `grok/gpt → default`：先原子启用官方 Skill并禁用 Web Skill，再写 `default` 状态。
- `grok ↔ gpt`：Skill 开关不变，只原子写 provider 状态。

任一步中断后最多得到“安全但不一致”的状态，`provider:status` 会停止；不能得到两个 Skill 同时启用的状态。`atomic-file.mjs` 只允许同目录临时文件，完成写入后 rename，失败时保留原目标并清理本次临时文件。

### 3.5 CLI 输出

成功：

```json
{
  "status": "configured",
  "provider": "gpt",
  "changed": true,
  "restartRequired": true
}
```

状态：

```json
{
  "status": "ok",
  "provider": "gpt",
  "officialSkillEnabled": false,
  "webSkillEnabled": true,
  "migrationRequired": false,
  "restartRequired": false
}
```

路径只在 `--debug` 时输出；普通状态不暴露用户目录。

## 4. Job schema v2

### 4.1 持久化结构

```json
{
  "schemaVersion": 2,
  "batchKey": "opaque-batch-key",
  "provider": "gpt",
  "workflow": "ai",
  "state": "generating",
  "prompt": "submitted prompt",
  "requestedCount": 2,
  "attemptPolicy": {
    "baseLimit": 2,
    "recoveryLimit": 1
  },
  "attempts": [
    {
      "attemptId": "a1",
      "ordinal": 1,
      "purpose": "initial",
      "status": "bound",
      "prompt": "submitted prompt",
      "promptDigest": "sha256:...",
      "browserContext": {
        "origin": "https://chatgpt.com",
        "conversationKey": "opaque",
        "beforeResponseAnchor": "opaque"
      },
      "response": {
        "userTurnKey": "opaque",
        "responseKey": "opaque",
        "assetKeys": ["gpt:opaque:0"]
      },
      "failure": null
    }
  ],
  "activeAttemptId": "a1",
  "candidates": []
}
```

禁止持久化浏览器 tab 对象、DOM、Cookie、完整 HTML、签名媒体 URL 和 data URI。

### 4.2 Provider 不可变

- `validateInit` 要求 `provider` 为 `grok | gpt`。
- `job.provider` 创建后不可变。
- 后续每个 mutating command 都要求 `--provider`，与 job 不同则返回 `provider-mismatch`。
- `redraw` 继承原 provider，不允许借重画切供应商。
- 切换全局 provider 后，旧 job 可读但不可由另一 provider 继续操作。

### 4.3 v1 迁移

`readJobFile` 读取无 `schemaVersion/provider` 的旧 job 时使用纯函数 `migrateJobV1`：

- provider 固定为 `grok`，因为 v1 只有 Grok Integration。
- `chosen/cancelled/redraw/selection-expired` 保持终态与幂等数据。
- `candidates-ready/awaiting-user-selection` 保留候选和身份键，并增加 synthetic legacy attempt。
- `generating` 且无可证明候选身份时标记 `migrationUnprovable=true`；恢复时进入 `selection-expired`，禁止自动再次提交。
- 只在下一次成功 mutation 时写回 schema v2；只读 status 不改用户文件。

## 5. Provider Attempt

### 5.1 Policy

`src/attempts.mjs` 导出：

```js
export const ATTEMPT_PURPOSES = Object.freeze(["initial", "fill", "recovery"])
export const ATTEMPT_STATES = Object.freeze(["prepared", "bound", "collected", "failed"])

export function attemptPolicy({ provider, workflow, selection, requestedCount }) {}
export function startAttempt(job, input) {}
export function bindAttempt(job, input) {}
export function failAttempt(job, input) {}
export function remainingAttemptBudget(job, purpose) {}
```

预算矩阵：

| Provider | Workflow | 基础 attempt | Recovery |
|---|---|---:|---:|
| `grok` | AI | 1（页面明确 ×2） | 1 |
| `gpt` | AI | 最多 2 | 1 |
| `grok` | user/single | 1 | 0 |
| `gpt` | user/single | 1 | 0 |
| `grok` | user/group | 1 | 0 |
| `gpt` | user/group | `targetCount`，上限 4 | 0 |

基础 attempt 达到候选目标立即停止。Recovery 只补无效、缺失或损坏，不扩大 `requestedCount`。Refinement 仍创建新 Generation Batch，不计入当前 attempt policy。

### 5.2 Attempt 状态流

```text
prepared
  ├─ bind unique response → bound
  │                         ├─ collect originals → collected
  │                         └─ provider/file failure → failed
  └─ definite provider failure → failed
```

同一 job 同时最多一个 `prepared/bound` attempt。重复 `attempt-start` 在输入相同且 active attempt 未结束时幂等返回原 attempt；输入不同则返回 `attempt-pending`。

### 5.3 提交崩溃窗口

浏览器点击与磁盘写入无法形成事务，采用“先留锚点，后绑定响应”：

1. `attempt-start` 在点击提交前保存 `beforeResponseAnchor` 和 `promptDigest`。
2. 浏览器提交提示词。
3. 页面出现唯一的新 user turn/assistant response 后调用 `attempt-bind`。
4. 若第 2、3 步之间中断，恢复时只在同一 conversation、锚点之后查找与 prompt 对应的新 turn。
5. 能唯一证明则绑定；明确未提交则允许继续原 prepared attempt；无法证明则返回 `submission-ambiguous`，绝不重复提交。

## 6. 一次性 CLI 契约

所有 JSON 输入文件仍必须位于 `<workspace>/.web-imagegen/`，成功消费后删除，失败时保留供调试。

### 6.1 init

```json
{
  "workspace": "D:/work/project",
  "provider": "gpt",
  "prompt": "Create ...",
  "workflow": "ai",
  "selection": "single",
  "sessionID": "task-id",
  "refFiles": []
}
```

```console
node scripts/web-imagegen.mjs init --request <request.json>
```

返回 provider、attempt policy、jobDir 和 batchKey。

### 6.2 attempt-start

```json
{
  "batchKey": "...",
  "provider": "gpt",
  "purpose": "initial",
  "prompt": "Create ...",
  "browserContext": {
    "origin": "https://chatgpt.com",
    "conversationKey": "opaque",
    "beforeResponseAnchor": "opaque"
  }
}
```

```console
node scripts/web-imagegen.mjs attempt-start --job <job-dir> --input <attempt-start.json> --provider gpt
```

该命令只记账，不声称页面已经提交。

### 6.3 attempt-bind

```json
{
  "batchKey": "...",
  "attemptId": "a1",
  "provider": "gpt",
  "observation": {
    "origin": "https://chatgpt.com",
    "conversationKey": "opaque",
    "userTurnKey": "opaque",
    "responseKey": "opaque",
    "assetKeys": ["gpt:opaque:0"]
  }
}
```

```console
node scripts/web-imagegen.mjs attempt-bind --job <job-dir> --input <attempt-bind.json> --provider gpt
```

身份模块验证后才把 attempt 置为 `bound`。重复绑定同一 response 幂等成功；不同 response 返回 `response-ambiguous`。

### 6.4 attempt-fail

```console
node scripts/web-imagegen.mjs attempt-fail --job <job-dir> --attempt a1 --error timeout --provider gpt
```

只接受错误闭集，不接受任意网页文本。输出是否允许 recovery/fill 以及剩余预算。

### 6.5 collect

```json
{
  "batchKey": "...",
  "attemptId": "a1",
  "provider": "gpt",
  "files": [
    {
      "path": "D:/downloads/image.png",
      "providerAssetKey": "gpt:opaque:0"
    }
  ]
}
```

`collect` 拒绝未绑定 attempt、错误 provider、未冻结 asset key、重复内容、历史图片、Reference Image、缩略图和不可解码文件。候选写入成功后 attempt 变为 `collected`。

### 6.6 其余命令

`choose/redraw/cancel/expire/status/debug` 保持现有职责，并增加 `--provider` 比较。`status` 与 `debug` 返回 provider 和 attempt 计数；`debug` 只返回 attemptId、purpose、status、候选数量与错误码，不返回 prompt、conversationKey、responseKey 或本地参考图路径。

## 7. Provider 身份模块

### 7.1 统一结果

两个 identity 模块只接收普通对象并返回：

```js
{
  ok: true,
  provider: "gpt",
  contextKey: "opaque",
  responseKey: "opaque",
  assetKeys: ["gpt:opaque:0"]
}
```

失败只返回闭集错误，不执行 UI 动作。

### 7.2 Grok

`grok-identity.mjs` 接管当前 `select.mjs` 中的：

- `parsePostId`
- `validatePostSelection`
- Post UUID 与 generated asset 的 identity expansion

迁移后用原测试逐条证明行为不变，再从 `select.mjs` 删除 Grok URL 知识。

### 7.3 GPT

`gpt-identity.mjs` 验证：

- origin 精确为 `https://chatgpt.com`。
- conversationKey 与 job/attempt 冻结值一致。
- responseKey 位于 `beforeResponseAnchor` 之后并且唯一。
- assetKeys 属于该 response，不属于用户上传附件或锚点之前的历史响应。
- asset key 规范为 `gpt:<responseKey>:<ordinal>`；ordinal 为非负整数。
- 同一 response/ordinal 重放得到同一 key。

模块不依赖 DOM selector。Chrome 编排把语义观察转换为普通 JSON；UI 改版导致观察字段缺失时返回 `ui-changed` 或 `asset-identity-missing`。

## 8. 下载边界

### 8.1 通用快照

`download-snapshot.mjs` 只枚举普通文件并记录内部比较所需的绝对路径、size、mtimeMs；公开 debug 只显示计数。它不按最近时间选择文件。

```js
export function snapshotDownloadFiles(directory) {}
export function changedDownloads(before, after, { extensions }) {}
```

### 8.2 Grok resolver

`grok-download.mjs` 保留精确 UUID 文件名规则和 `allowExisting=true` 的唯一复用规则。现有 `browser-downloads.test.mjs` 先搬迁再重命名，输出必须与当前版本一致。

### 8.3 GPT resolver

GPT 文件名不作为资产身份。优先顺序：

1. Chrome 媒体物化直接返回本地文件路径；页面仍必须处于冻结 response/asset 上。
2. 页面下载按钮一次兜底；前后快照必须只有一个新增或变化的支持图片文件。
3. 零变化返回 `download-missing`；多变化返回 `download-ambiguous`。
4. GPT 不允许仅凭已有同名文件执行 `allowExisting`；只有 Chrome 直接返回的精确路径可重放，并仍需内容校验与 providerAssetKey 匹配。

下载 resolver 只证明“哪一个文件由这次动作产生”；最终真实性仍由 `assertSourceFile` 和 `acceptCandidate` 决定。

## 9. Workflow 编排

### 9.1 GPT AI 主导

```text
init(provider=gpt, requestedCount=2)
→ attempt-start(initial)
→ Chrome submit
→ bind response
→ materialize + collect
→ if 2 candidates: choose
→ if 1 candidate: attempt-start(fill)
→ bind + collect
→ if still insufficient and invalid/missing occurred: optional recovery attempt
→ choose or fail attempt-budget-exhausted
```

fill prompt 重复所有硬约束，并明确请求另一种独立方案。它是基础 attempt，不冒充 recovery。任何响应一次给出两张有效候选时立即停止，不做第二次提交。

### 9.2 GPT 用户单张

一次 attempt 后只 `attempt-bind` 并冻结 response 中的 assetKeys，job 进入 `awaiting-user-selection`。用户选好后，Skill 再验证当前展开资产仍在冻结集合中，物化一张并 `choose --source post`。重复选择同一资产幂等；切换对话或响应则 `selection-stale/expired`。

### 9.3 GPT 用户组图

`targetCount=2..4`。每次 attempt 后收集新资产，达到 targetCount 立即停止；基础预算耗尽但至少有一张时进入 `candidates-ready, incomplete=true`，零张则失败。不会自动使用 recovery，因为组图数量由用户控制。

### 9.4 Grok

Grok 仍以一次页面 `×2` 满足 AI 基础候选，现有 recovery/refine 行为不变。它也通过 attempt API 记录一次 initial attempt，使 runtime 不再有 provider 特判散落在 `collectJob` 中。

## 10. 错误和调试输出

在 `contract.mjs` 增加：

```text
invalid-provider
provider-not-ready
provider-config-mismatch
provider-mismatch
attempt-pending
attempt-not-ready
attempt-budget-exhausted
submission-ambiguous
wrong-provider-page
conversation-not-isolated
conversation-changed
response-ambiguous
asset-identity-missing
reference-ambiguous
generation-refused
```

每个错误必须在一个纯函数或一个 I/O 边界产生，不允许同一错误同时表示多个阶段。

`debug` 示例：

```json
{
  "status": "ok",
  "debug": {
    "provider": "gpt",
    "state": "generating",
    "requestedCount": 2,
    "actualCount": 1,
    "attempts": [
      { "attemptId": "a1", "purpose": "initial", "status": "collected", "assetCount": 1, "error": null }
    ],
    "baseRemaining": 1,
    "recoveryRemaining": 1,
    "lastError": null
  }
}
```

## 11. Skill 路由

顶层 `SKILL.md` 执行顺序固定：

1. 运行 `scripts/provider.mjs status`。
2. 若 `default`，停止 Web ImageGen，避免与官方 Skill 重叠。
3. 若 `provider-config-mismatch`，报告配置问题，不打开浏览器。
4. 若 `grok`，只读取 `references/providers/grok.md`。
5. 若 `gpt`，只读取 `references/providers/gpt.md`。
6. 再按 workflow 只读取 `ai-led.md` 或 `user-led.md`。

只有以上路由、GPT runtime 和离线总门同时通过后，才增加公开 `npm run provider:gpt`。这是发布门，不允许仅因底层 switch 函数已能写入 `gpt` 状态就提前开放。

`gpt.md` 只描述语义动作：验证用户提供的标签页、确认空白专用对话、记录锚点、提交、绑定新响应、展开目标图片和物化原图。不得写死 CSS/XPath，也不得在页面结构不确定时试点多个按钮。

## 12. 依赖方向与禁止项

```text
scripts → provider-config / atomic-file
runtime → contract / jobs / attempts / candidates / provider identity
provider identity → plain data helpers only
skill → one-shot scripts + Computer Use
```

禁止：

- `src/providers/*` 导入浏览器对象或文件系统。
- `runtime.mjs` 读取全局 Codex 配置；active provider 必须由 Skill 显式传入。
- `select.mjs` 识别供应商 URL。
- GPT resolver 使用文件名、mtime 最近值或图片相似度证明资产身份。
- 任何失败调用 `default` 或另一个 Web Provider。

## 13. 实现完成定义

- 所有公开 provider 值只出现 `default | grok | gpt`。
- Web runtime 中 job provider 只出现 `grok | gpt`。
- provider 配置、job、attempt、identity、download 各有独立纯函数测试。
- Grok 的 23 个现有测试语义全部保留，并扩展到新模块路径。
- 默认测试不打开浏览器、不读真实 Codex 配置、不消耗供应商额度。
- 真实 GPT 验证必须按测试计划逐阶段授权和留证。
- `provider:gpt` 只在 GPT runtime、identity、download 和 Skill 路由全部通过后公开。
