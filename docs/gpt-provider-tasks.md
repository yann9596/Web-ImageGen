# GPT Web Provider 单步实施任务

状态：ready

规则：每个 task 只引入一个主要行为，单独测试通过后才进入下一项。每个 task 都是一个可独立 review/commit 的停止点。

## Phase A：Provider 命名与切换

状态：done（YZT-12）

### GPT-001 定义 provider 规范值

- 改动：新增 `src/provider-config.mjs`，只导出 `default | grok | gpt` 常量与 `validateProvider`。
- 测试：新增 PC-01；未知值和旧值拒绝。
- 调试：直接调用纯函数，不读写文件。
- 完成：`node --test tests/provider-config.test.mjs` 与 `npm test` 通过。
- 状态：done

### GPT-002 定义 provider.json 编解码

- 依赖：GPT-001。
- 改动：增加 `parseProviderState/renderProviderState`，不接文件系统。
- 测试：PC-02，三值 round-trip 与破损 schema。
- 调试：失败输出仅含错误码和字段名。
- 完成：状态 JSON 字节确定且无时间戳。
- 状态：done

### GPT-003 计算 Skill/provider 一致性

- 依赖：GPT-002。
- 改动：增加 `deriveProviderStatus` 纯函数。
- 测试：PC-03 的完整矩阵。
- 调试：返回解析后的两个 Skill boolean 与 state provider。
- 完成：只有三种合法组合成功。
- 状态：done

### GPT-004 兼容读取旧 Grok 配置

- 依赖：GPT-003。
- 改动：只读识别无 provider.json 的旧 default/Grok 状态。
- 测试：PC-04，断言 `migrationRequired=true` 且无写盘。
- 调试：status 显示 `legacySource=managed-block`，普通输出不显示路径。
- 完成：旧真实配置升级前不会被误识别为 GPT。
- 状态：done

### GPT-005 实现单文件原子写

- 改动：新增 `src/atomic-file.mjs`。
- 测试：成功替换、写失败、rename 失败、临时文件清理。
- 调试：I/O adapter 可注入失败点。
- 完成：任何失败都保留原目标字节。
- 状态：done

### GPT-006 生成安全切换步骤

- 依赖：GPT-003。
- 改动：增加 `planProviderSwitch`，只返回有序计划，不写盘。
- 测试：覆盖 default↔Web、grok↔gpt。
- 调试：dry-run 直接显示步骤类型，不显示用户路径。
- 完成：计划中不存在同时启用两个 Skill 的中间状态。
- 状态：done

### GPT-007 执行三值 provider 切换

- 依赖：GPT-005、GPT-006。
- 改动：重构 `scripts/skill-provider.mjs` 使用计划和原子写。
- 测试：PS-01、PS-02、PS-03、PS-04。
- 调试：仅使用临时 `CODEX_ROOT`。
- 完成：default→grok→gpt→default 全程可恢复。
- 状态：done

### GPT-008 注入切换中断

- 依赖：GPT-007。
- 改动：为 switch I/O 增加仅供测试的 adapter 注入，不改变 CLI。
- 测试：PS-05 的每个写入断点。
- 调试：失败后运行 status，必须得到安全 provider 或 mismatch。
- 完成：无双 Skill enabled，无半截目标文件。
- 状态：done

### GPT-009 发布 default 命令名并保留 GPT 发布门

- 依赖：GPT-007。
- 改动：`package.json` 增加 `provider:default`，移除公开 `provider:openai`；GPT 只可在纯函数/隔离测试中切换，公开 CLI 返回 `provider-not-ready`。
- 测试：PS-06、CLI 命令解析和提前调用 GPT 的拒绝测试。
- 调试：先运行 `--dry-run --codex-root <temp>`。
- 完成：README 中 default 可运行命令与代码一致，且不存在公开 `provider:gpt` script。
- 状态：done

## Phase B：Job 与 Attempt

### GPT-010 引入 job schema v2/provider

- 改动：`createBatch` 写 `schemaVersion=2` 和不可变 `provider`；init 必填 `grok | gpt`。
- 测试：JM-01、provider 缺失/default/未知值拒绝。
- 调试：`status` 显示 provider。
- 完成：所有现有测试 fixture 显式使用 `provider=grok`。

### GPT-011 读取并迁移 v1 terminal job

- 依赖：GPT-010。
- 改动：新增 `migrateJobV1`，先只覆盖终态。
- 测试：JM-02。
- 调试：只读 status 不改原文件。
- 完成：旧 chosen 幂等结果保持。

### GPT-012 迁移 v1 ready/generating job

- 依赖：GPT-011。
- 改动：ready 创建 synthetic attempt；无身份 generating 标记不可恢复。
- 测试：JM-03、JM-04。
- 调试：debug 显示 `migrationUnprovable` boolean，不暴露旧 key。
- 完成：任何旧 generating job 都不会自动重复提交。

### GPT-013 定义 attempt policy

- 改动：新增 `src/attempts.mjs` 的 policy 与预算纯函数。
- 测试：AT-01、AT-04 的预算部分。
- 调试：表驱动测试输出 provider/workflow/target。
- 完成：GPT group 5 明确拒绝，AI baseLimit=2。

### GPT-014 实现 attempt-start

- 依赖：GPT-010、GPT-013。
- 改动：attempt prepared 状态、activeAttemptId、重复调用幂等。
- 测试：AT-02。
- 调试：debug 显示 attemptId/purpose/status/remaining。
- 完成：active attempt 未结束时不能启动不同 attempt。

### GPT-015 实现 attempt-bind

- 依赖：GPT-014。
- 改动：接收已经验证的 identity result，绑定唯一响应和 assetKeys；具体 provider dispatch 在 GPT-021 接入。
- 测试：AT-03。
- 调试：不同 response 只返回 `response-ambiguous`，不覆盖原绑定。
- 完成：同输入重放字节不变。

### GPT-016 实现 attempt-fail

- 依赖：GPT-014。
- 改动：记录闭集错误、结束 active attempt、返回剩余预算。
- 测试：AT-05。
- 调试：网页文本不进入 job/debug。
- 完成：只有硬失败允许消耗 recovery。

### GPT-017 补齐 attempt 崩溃恢复

- 依赖：GPT-015、GPT-016。
- 改动：prepared/bound/collected 重载给出唯一 nextAction。
- 测试：AT-06。
- 调试：歧义统一停在 `submission-ambiguous`。
- 完成：测试模拟进程清空内存后仍一致。

## Phase C：Provider 身份

### GPT-018 抽离 provider-neutral selection

- 改动：从 `src/select.mjs` 移出 Grok URL/UUID 解析，只保留选择和幂等。
- 测试：现有 user intent/group/replay 测试保持通过。
- 调试：静态断言 `select.mjs` 不含 `grok.com`、`/imagine/post/`。
- 完成：行为无变化，只改变依赖边界。

### GPT-019 建立 Grok identity 模块

- 依赖：GPT-018。
- 改动：新增 `src/providers/grok-identity.mjs` 并迁移原函数。
- 测试：GI-01，逐条搬迁旧断言。
- 调试：新旧函数对同 fixture 输出一致。
- 完成：Grok runtime 测试全绿。

### GPT-020 建立 GPT identity 模块

- 改动：新增 `src/providers/gpt-identity.mjs`，只处理普通 observation。
- 测试：GPTI-01 至 GPTI-07。
- 调试：失败结果含 stage/error，不含 opaque 原值。
- 完成：历史响应、附件和其他对话永不生成 asset key。

### GPT-021 接通 attempt-bind identity dispatch

- 依赖：GPT-015、GPT-019、GPT-020。
- 改动：按 job.provider 调用唯一 identity validator。
- 测试：同 observation 在错误 provider 下失败。
- 调试：debug 只显示 validator 名称和结果码。
- 完成：runtime 不直接识别任何供应商 URL。

## Phase D：下载与候选

### GPT-022 抽离通用下载快照

- 改动：新增 `src/download-snapshot.mjs`，只负责 before/after 差异。
- 测试：DS-01。
- 调试：公开结果可选择 redacted 模式只给计数。
- 完成：不按 mtime 排序选最近文件。

### GPT-023 搬迁 Grok download resolver

- 依赖：GPT-022。
- 改动：新增 `src/providers/grok-download.mjs`，保留 UUID 规则。
- 测试：GD-01，现有测试原样通过。
- 调试：对相同快照输出与旧模块一致。
- 完成：删除 `browser-downloads.mjs` 中 Grok 专用代码或只留兼容 re-export。

### GPT-024 实现 GPT download resolver

- 依赖：GPT-022。
- 改动：新增 `src/providers/gpt-download.mjs`，支持直接路径和唯一 delta。
- 测试：GPTD-01 至 GPTD-03。
- 调试：零/多变化给不同错误。
- 完成：不存在 allowExisting/最近文件/文件名身份捷径。

### GPT-025 collect 强制 attempt/asset 身份

- 依赖：GPT-021、GPT-024。
- 改动：manifest 必填 provider、attemptId、providerAssetKey；候选记录 provider/attempt。
- 测试：未绑定、错误 provider、未知 asset、重复内容逐项拒绝。
- 调试：rejected 只含本地 basename 和错误码。
- 完成：成功 collect 将 attempt 标记 collected。

## Phase E：Runtime 场景

### GPT-026 让 Grok 走 attempt API

- 依赖：Phase B–D。
- 改动：现有 Grok init/collect/choose 改走新 attempt 记录，不改变用户行为。
- 测试：RG-01、RG-02。
- 调试：Grok initial attempt 数必须为 1。
- 完成：全部旧语义通过后才能开始 GPT runtime。

### GPT-027 实现 GPT AI 单响应完成

- 依赖：GPT-026。
- 改动：一个 response 提供两张时直接 ready。
- 测试：RGP-01。
- 调试：baseRemaining=1 且无第二 attempt。
- 完成：agent 只可选择一张。

### GPT-028 实现 GPT AI fill

- 依赖：GPT-027。
- 改动：initial 一张时允许一个 fill attempt。
- 测试：RGP-02、RGP-03。
- 调试：attempt purpose 明确为 fill/recovery。
- 完成：第三个基础 attempt 被拒绝。

### GPT-029 实现 GPT 用户单选

- 依赖：GPT-025。
- 改动：bind 后 awaiting；用户确认后只物化匹配 asset。
- 测试：RGP-04。
- 调试：冻结 assetCount 与选中 ordinal 可见，opaque key 不显示。
- 完成：历史 response 不能保存。

### GPT-030 实现 GPT 用户组图

- 依赖：GPT-028。
- 改动：2–4 target 的多 attempt 收集和 incomplete。
- 测试：RGP-05。
- 调试：每次 collect 后输出 actual/target/baseRemaining。
- 完成：零候选不自动重试。

### GPT-031 provider mismatch/redraw/锁回归

- 依赖：GPT-027 至 GPT-030。
- 改动：所有 mutating command 校验 provider；redraw 继承 provider。
- 测试：RGP-06 至 RGP-08。
- 调试：失败前后 job 字节比较。
- 完成：错误 provider 操作零写入。

### GPT-032 扩展 CLI

- 依赖：GPT-014 至 GPT-031。
- 改动：加入 attempt-start/bind/fail 和所有 `--provider` 参数。
- 测试：CLI-01、CLI-02。
- 调试：每条命令直接用 fixture JSON 单独运行。
- 完成：成功/失败都恰好一行 JSON。

## Phase F：Skill 路由

### GPT-033 增加 Skill provider status 入口

- 依赖：GPT-009。
- 改动：新增 `skill/web-imagegen/scripts/provider.mjs`。
- 测试：临时 CODEX_ROOT 下返回三种规范值。
- 调试：mismatch 时不继续读取 provider 文档。
- 完成：wrapper 与根 CLI 输出一致。

### GPT-034 拆出 Grok provider 指令

- 依赖：GPT-026、GPT-033。
- 改动：把 Grok 页面/Post/×2/下载规则移入 `references/providers/grok.md`。
- 测试：SK-01，现有 Grok 关键约束仍可静态检出。
- 调试：顶层 SKILL 不再出现 Grok DOM/URL 细节。
- 完成：Grok Skill 快速验证通过。

### GPT-035 编写 GPT provider 指令

- 依赖：GPT-020、GPT-024、GPT-032。
- 改动：新增 `references/providers/gpt.md`，覆盖空白对话、锚点、提交、绑定和物化。
- 测试：SK-01、SK-02。
- 调试：UI 不确定时指令明确停止并回传截图。
- 完成：无 CSS/XPath、无历史聊天/Library 扫描。

### GPT-036 完成 provider-neutral 顶层路由

- 依赖：GPT-034、GPT-035。
- 改动：顶层 Skill 先 status，再只加载一个 provider 和一个 workflow 文档。
- 测试：SK-01 至 SK-03。
- 调试：default 明确退出 Web ImageGen。
- 完成：官方 Skill 与 Web Skill 不重叠响应。

## Phase G：离线总验收

### GPT-037 全量测试入口整理

- 依赖：GPT-036。
- 改动：更新 `npm test`，列出所有新测试文件。
- 测试：完整运行两次，结果一致，无 skipped/todo。
- 调试：按测试文件分组输出，不吞掉错误堆栈。
- 完成：离线总门全绿。

### GPT-038 临时 Codex 根安装演练

- 依赖：GPT-037。
- 改动：无产品代码；在临时根执行 install、三值 dry-run、三值真实临时切换和 status。
- 验证：真实用户配置 mtime 不变。
- 调试：保留临时根直到检查完成，再由测试清理。
- 完成：安装、切换、恢复均有 JSON 证据。

### GPT-039 文档与禁用项审计

- 依赖：GPT-038。
- 改动：同步 README/DESIGN/BREAKPOINT；旧 `openai` 只保留在迁移说明或历史测试。
- 测试：全文扫描 Playwright/CDP/fetch/daemon/fallback/旧命令。
- 调试：逐个命中判断是否为允许的历史语境。
- 完成：`git diff --check` 和 Skill 快速验证通过。

### GPT-040 公开 GPT provider 命令

- 依赖：GPT-037 至 GPT-039 全部通过。
- 改动：CLI 解除 `provider-not-ready`，`package.json` 新增 `provider:gpt`，README 标记为可运行。
- 测试：临时 CODEX_ROOT 执行 gpt switch/status，再运行完整 `npm test`。
- 调试：只允许 `--dry-run` 或临时根；此 task 不写真实配置。
- 完成：GPT runtime、identity、download、Skill 路由和离线总门均已通过后才存在公开命令。

## Phase H：真实浏览器（逐项授权）

### GPT-041 零提交 UI 勘测

- 依赖：GPT-040。
- 前置：用户明确提供已登录的 Chrome ChatGPT 空白对话标签页。
- 提交预算：0。
- 验证：origin、登录、空白对话、composer、附件入口、响应容器。
- 调试：歧义时截图并停止，不尝试多个控件。
- 完成：形成不含账号/HTML 的 observation fixture 修订。

### GPT-042 AI 二选一冒烟

- 依赖：GPT-041 和用户对最多 2 次提交的明确授权。
- 提交预算：最多 2；不使用 recovery/refine。
- 验证：RGP-01 或 RGP-02、两张硬校验候选、agent 选择。
- 调试：每个 attempt 后先落盘 status/debug 再继续。
- 完成：chosen 原图和 job 证据一致。

### GPT-043 用户单选冒烟

- 依赖：GPT-041 和用户对 1 次提交的明确授权。
- 提交预算：1。
- 验证：awaiting、用户选图、当前 response 身份、choose 幂等。
- 调试：选择前不下载全部候选。
- 完成：重放选择不改写输出。

### GPT-044 Reference Image 冒烟

- 依赖：GPT-041、用户提供参考图并授权 1 次提交。
- 提交预算：1。
- 验证：上传证据、附件排除、生成图物化。
- 调试：不保存账号、对话正文或签名 URL。
- 完成：候选内容摘要不同于 Reference Image。

### GPT-045 零提交断点恢复

- 依赖：GPT-043 已完成。
- 提交预算：0。
- 验证：新进程 status、同对话重绑定、choose/download 幂等。
- 调试：若身份无法证明则 selection-expired，不重新提交。
- 完成：输出 mtime 和内容摘要不变。

### GPT-046 接受 ADR 并收尾

- 依赖：GPT-042 至 GPT-045 通过或明确记录未授权项。
- 改动：将 ADR-0003 从 proposed 改为 accepted，更新 BREAKPOINT 和实施状态。
- 验证：最终 `npm test`、Skill 验证、文档链接检查。
- 调试：汇总每个 LIVE case 的提交次数和非敏感证据。
- 完成：无剩余必做项；未授权 LIVE 项不能伪装为通过。
