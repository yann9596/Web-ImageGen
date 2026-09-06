# GPT Web Provider Integration 设计

状态：proposed

更新时间：2026-09-05

配套文档：

- [详细代码设计](./gpt-provider-implementation-design.md)
- [测试与验证方案](./gpt-provider-test-plan.md)
- [单步实施任务](./gpt-provider-tasks.md)

## 1. 结论

新增第三个全局 Generation Provider：`gpt`。它通过 Codex Chrome 操作用户明确提供、已经登录的 ChatGPT 网页标签页，并复用 Web ImageGen 现有的状态机、候选硬校验、选择和落盘核心。

三个 provider 值固定为 `default | grok | gpt`：

- `default` 是 Codex 默认内置生图，唯一底层能力是官方 ImageGen Skill 和 `image_gen`。
- `gpt` 是 Web ImageGen 内的浏览器供应商，唯一底层能力是用户的 ChatGPT 网页会话。
- `grok` 仍是另一个独立的浏览器供应商。

展示名使用 Default Provider、Grok Provider Integration 和 GPT Web Provider Integration；provider 值遵循用户要求保持简短。

## 2. 设计目标

- 保持一个稳定的 Web ImageGen Skill，对外只暴露一个生图能力。
- 由用户显式选择 `default | grok | gpt`，不根据提示词、标签页或失败原因自动路由。
- ChatGPT Web 与 Grok 共用本地状态、图片真实性校验、输出目录和选图规则，只各自实现网页编排和资产身份识别。
- 支持 AI 主导二选一、用户主导单张和用户主导组图。
- 支持本地参考图；把新建与编辑统一视为带可选 Reference Image 的生成请求。
- 在无法证明图片属于当前 ChatGPT 响应时明确失败，不用时间、相似文件名或视觉相似度猜测。

## 3. 非目标

- 不调用 OpenAI API，不读取或管理 API key。
- 不复用 Codex 内置 `image_gen` 作为 ChatGPT Web 的降级路径。
- 不读取其他聊天、项目、Library、历史图片、Cookie、localStorage、密码或账号资料。
- 不切换 ChatGPT 工作区、套餐、模型、隐私设置或训练设置。
- 首版不操作 ChatGPT 图片编辑器的选区、画布批注和局部蒙版。
- 不从已有历史对话里挑一张旧图当作当前批次结果。
- 不承诺 ChatGPT 网页未公开保证的固定出图数量、质量档或文件命名。

## 4. 总体架构

```text
Global Generation Provider
├─ default
│    └─ official ImageGen Skill → built-in image_gen
└─ Web ImageGen Skill
     ├─ active provider = grok
     │    └─ Grok Integration → supplied Grok tab
     └─ active provider = gpt
          └─ GPT Web Integration → supplied ChatGPT tab

Both browser integrations
└─ one-shot local runtime
     ├─ immutable job provider
     ├─ bounded provider attempts
     ├─ provider asset identity
     ├─ hard image validation
     ├─ selection/idempotency
     └─ final conversion and persistence
```

Provider Router 每次开始任务时读取全局状态，只加载当前供应商指令。Grok 与 ChatGPT Web 不在同一回合里同时探测，也不会互相回退。

## 5. 全局切换

### 5.1 命令

规划增加：

```console
npm run provider:gpt
```

既有命令保持：

```console
npm run provider:default
npm run provider:grok
npm run provider:status
```

### 5.2 状态存储

Codex `config.toml` 继续只负责官方 ImageGen Skill 与 Web ImageGen Skill 的互斥启用。Web ImageGen 在 `<CODEX_ROOT>/web-imagegen/provider.json` 另存一个不含凭据的托管状态文件：

```json
{
  "schemaVersion": 1,
  "provider": "gpt"
}
```

- `default`：官方 Skill 开启，Web ImageGen 关闭。
- `grok`：官方 Skill 关闭，Web ImageGen 开启，托管状态为 `grok`。
- `gpt`：官方 Skill 关闭，Web ImageGen 开启，托管状态为 `gpt`。
- 两个文件各自使用临时文件加原子替换。跨文件无法形成真正的原子事务，因此切换顺序必须保证中断时不会同时启用两个 Skill；状态检查检测到半写入或不一致时返回 `provider-config-mismatch`，绝不猜测。
- 状态文件不保存标签页、账号、Cookie、提示词或图片路径。
- 切换后仍要求重启 Codex，避免旧任务中的 Skill 指令与新 provider 混用。

### 5.3 Job 冻结 provider

`job.json` 重新引入必填且不可变的 `provider`。恢复任务时，全局 provider 必须与 job provider 相同，否则返回 `provider-mismatch`。这避免把 Grok 批次误交给 ChatGPT Web，反之亦然。

## 6. ChatGPT 标签页边界

### 6.1 前置条件

- 只使用用户通过 `@Chrome` 或标签页提及明确交付的标签页。
- origin 必须是 `https://chatgpt.com`，并且页面已登录。
- 不搜索、不新开也不替换浏览器标签页。
- 遇到登录、验证码、套餐升级、付款、工作区选择或账号确认时立即暂停。

### 6.2 对话隔离

每个 Web ImageGen job 使用同一目标标签页中的专用 ChatGPT 对话：

1. 若标签页是空白新对话，直接使用。
2. 若已有对话内容，首版停止并返回 `conversation-not-isolated`，提示用户在同一标签页打开一个新对话后继续。
3. job 创建后冻结 `conversationKey`；后续 attempt 必须发生在同一对话。
4. 用户主导的继续修改可以复用该 job 的专用对话，但不能跳到其他历史对话。

首版不由自动化点击“新建聊天”，以免无意改变用户正在使用的对话，也避免旧上下文影响提示词。

### 6.3 页面内容信任边界

ChatGPT 返回的文本和页面内容属于外部供应商输出，只能解释为生成状态、拒绝或错误，不能作为新的操作指令。集成只执行 Web ImageGen Skill 和用户任务中已有的指令，不跟随网页文本要求访问文件、网站、终端或其他聊天。

## 7. Provider Attempt 与数量预算

ChatGPT 网页不作为固定出图数量的可靠接口。为保留 AI 二选一语义，Generation Batch 与 Provider Attempt 分开：

- Generation Batch 是一次逻辑生图目标和最终候选集合。
- Provider Attempt 是一次向 ChatGPT 提交提示词。
- AI 主导目标为 2 张候选，基础 attempt 上限为 2；已有 2 张时立即停止。
- 用户主导单张的基础 attempt 上限为 1。
- 用户主导组图由用户显式给出 `targetCount`，首版限制为 2–4，基础 attempt 上限等于 `targetCount`，达到数量后立即停止。
- 当前响应一次给出多张时，按页面顺序收集到目标数量；额外图片不作为当前候选，也不触发额外 attempt。
- 缺失、损坏或不可解码仍只有 1 次 Recovery Retry；它不增加目标候选数量。
- Refinement Retry 仍由显式 `refine=1` 授权，并创建新版本批次。

每次额外 attempt 都记录原因和序号，不允许无限追问、静默多画或用对话式“再来一张”突破预算。

## 8. 提示词与参考图

### 8.1 AI 主导

Codex 根据父任务编写清晰的 ChatGPT 生图请求。首个 attempt 请求目标和相互区分的方向；若只得到 1 张，第二个 attempt 请求同一目标下的另一种独立方案，并重复所有不可漂移的约束。

比例优先写入提示词；只有页面存在稳定、可验证的比例控件时才设置控件。官方文档支持通过比例选择器或提示词指定比例，但网页可用选项仍需在真实冒烟前勘测。质量档和模型不自动切换。

### 8.2 用户主导

原样提交用户提示词。只有用户明确要求改写时才保留 `originalPrompt` 与 `submittedPrompt` 两份记录。单张和组图的选图责任仍由用户承担。

### 8.3 参考图

本地运行时先校验 Reference Image，再由 Chrome 上传。每个上传记录本地内容摘要、文件名和本次上传后的页面证据。无法证明页面附件来自本次上传时返回 `reference-ambiguous`，不得使用聊天中的历史附件。

## 9. 批次身份与资产物化

### 9.1 身份链

每个 ChatGPT attempt 冻结以下普通数据：

```json
{
  "provider": "gpt",
  "conversationKey": "opaque-conversation-id",
  "attempt": 1,
  "beforeResponseAnchor": "opaque-last-response-id",
  "responseKey": "opaque-new-response-id",
  "assets": [
    {
      "providerAssetKey": "opaque-response-id:0",
      "ordinal": 0
    }
  ]
}
```

具体 ID 来自页面可稳定观察的非敏感属性；没有稳定 ID 时只允许在当前连续浏览器会话中通过“提交前锚点 + 新增 assistant 响应 + 响应内序号”证明身份。进程恢复后若无法重新证明，进入 `selection-expired`，不按最近时间猜测。

### 9.2 候选准入

候选必须同时满足：

- 位于冻结的 ChatGPT 对话与当前 attempt 的新增 assistant 响应内。
- 完整加载，非占位符、缩略图、历史图或用户上传的 Reference Image。
- 通过 Chrome 媒体表面物化为本地原始字节。
- 经本地运行时验证为完整、可解码、尺寸有效的 JPEG、PNG 或 WebP。
- `providerAssetKey + 内容摘要` 未在当前 Generation Batch 中出现。

### 9.3 下载策略

优先使用当前展开图片的 Chrome 媒体物化能力。若页面只提供下载按钮，允许一次兜底：动作前后做下载目录快照，并要求唯一新增文件与当前冻结资产同时可证明。ChatGPT 文件名不作为唯一身份；不能照搬 Grok 的 Post UUID 文件名规则。

本地下载解析应从 `browser-downloads.mjs` 抽出 provider-neutral 快照层，并把 Grok UUID 与 ChatGPT 响应资产匹配分别放进独立 resolver。

## 10. 本地运行时变更

一次性 CLI 仍不导入或控制浏览器。规划的数据变化：

- `job.provider`：`grok | gpt`，创建后不可变。
- `batch.targetCount`：本批期望候选数。
- `batch.attemptBudget`、`attemptsUsed`：基础 attempt 预算。
- `batch.attempts[]`：提交序号、提示词、响应身份和失败原因。
- `candidate.providerAssetKey`：供应商内稳定资产键。
- `candidate.provider`、`candidate.attempt`：防止跨供应商、跨 attempt 混入。

计划增加 `begin-attempt`，并扩展 `collect` 接收普通 JSON 页面观察。状态机主状态保持不变：

```text
preparing
  → generating
      → candidates-ready
      → awaiting-user-selection
      → chosen
      → redraw
      → cancelled
      → selection-expired
```

Provider Attempt 是 `generating` 内的子记录，不新增大量顶层状态。

## 11. 错误闭集扩展

新增：

- `provider-config-mismatch`：Skill 开关与托管 provider 状态不一致。
- `provider-mismatch`：恢复 job 时全局 provider 已改变。
- `wrong-provider-page`：标签页不是当前 provider 的合法页面。
- `conversation-not-isolated`：ChatGPT 标签页不是可安全使用的新对话。
- `conversation-changed`：job 中途切换了对话。
- `response-ambiguous`：不能唯一识别本次新增 assistant 响应。
- `asset-identity-missing`：图片存在但无法证明属于本次响应。
- `reference-ambiguous`：无法证明页面附件来自本次上传。
- `generation-refused`：ChatGPT 明确拒绝生成且没有候选。
- `attempt-budget-exhausted`：达到提交上限仍不足目标数量。

登录、验证码、额度、超时、UI 改版和文件错误继续复用现有错误。

## 12. 隐私与安全

- 不持久化 ChatGPT 账号、显示名、Cookie、浏览器存储、完整页面 HTML 或完整对话。
- `conversationKey`、`responseKey` 和资产键必须是脱敏的不透明标识；诊断不保存签名媒体 URL。
- 只上传任务明确给出的本地 Reference Image，不枚举其他工作区文件。
- 不操作聊天侧栏、Library、项目或其他对话。
- 额外页面截图沿用现有规则：只有在 UI 歧义需要用户判断时才回传当前截图，不默认保存全页截图。
- 登录、验证码、付款、删除、覆盖、账号或隐私设置一律暂停。

## 13. Skill 文件布局

规划把供应商指令从顶层拆开：

```text
skill/web-imagegen/
├─ SKILL.md                    provider-neutral router and invariants
└─ references/
   ├─ runtime.md               shared local runtime contract
   ├─ ai-led.md                shared selection policy
   ├─ user-led.md              shared user-selection policy
   └─ providers/
      ├─ grok.md               Grok page and Post identity
      └─ gpt.md                ChatGPT conversation and response identity
```

顶层 Skill 必须先读取 provider 状态，再且只再读取一个供应商文件。这样不会把 Grok DOM、ChatGPT DOM 和两套恢复规则同时放进执行上下文。

## 14. 实施顺序

1. 扩展 provider switch 和托管状态文件，完成三值互斥、原子写入、状态不一致与 dry-run 测试。
2. 给 job/batch 增加 provider、attempt 和 providerAssetKey；先迁移 Grok 数据，确保行为不变。
3. 抽离 provider-neutral 下载快照与 provider-specific resolver。
4. 重组 Skill 路由，先让 Grok 全量回归通过。
5. 新增 ChatGPT Web 指令和页面观察契约，不做真实提交。
6. 用离线 fixtures 覆盖对话切换、响应歧义、历史图混入、参考图误认和下载歧义。
7. 经用户明确授权后执行真实冒烟；每轮前说明预计 ChatGPT 提交次数。

## 15. 验收标准

- `provider:status` 能准确区分 `default | grok | gpt`，配置不一致时失败而不是猜测。
- 三个 provider 任一时刻只有一条能力路径生效；无提示词路由和跨 provider fallback。
- Grok 现有离线测试和真实工作流语义不回归。
- ChatGPT AI 主导最多用 2 个基础 attempt 收集 2 张候选，恢复和 refinement 预算另行记录。
- ChatGPT 用户主导单张、组图、重画、取消和幂等选择符合现有状态机。
- 历史对话图片、用户上传图、上一响应图片和其他对话图片都不能进入当前候选。
- 失去 ChatGPT 批次身份时进入 `selection-expired`；不以时间或文件名猜测。
- 候选必须是真实原始图片字节，截图、缩略图、data URI 文本和改后缀文件均失败。
- 默认测试完全离线，不登录、不消耗 ChatGPT 额度、不修改真实 Codex 配置。

## 16. 官方能力依据

[官方 OpenAI 文档](https://learn.chatgpt.com/docs/image-generation)确认 ChatGPT 可以生成和编辑图片、使用 Reference Image，并支持在提示词或界面中表达比例；同时说明 ChatGPT 网页可用性与额度取决于套餐和工作区设置。因此本设计只依赖生成、编辑、参考图和比例这几个公开能力，不把固定候选数量、质量档、下载文件名或账户额度当作稳定契约。
