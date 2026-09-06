# GPT Web Provider 测试与验证方案

状态：ready-for-implementation

更新时间：2026-09-05

## 1. 验证原则

- 先纯函数，后临时目录集成，最后才是真实浏览器。
- 默认入口 `npm test` 必须完全离线、零账号、零额度、零真实全局配置写入。
- 每个测试只证明一个失败边界；失败信息必须指出 provider、batch、attempt 和阶段，但不泄露敏感标识。
- 真实验证按提交次数逐项授权，不把 UI 勘测、登录或人工补救算作自动测试成功。
- 任何一次真实失败都保留 job/debug 证据并停止，不通过增加提交次数“跑到成功”。

## 2. 测试文件规划

```text
tests/
├─ provider-config.test.mjs
├─ provider-switch.test.mjs
├─ job-migration.test.mjs
├─ attempts.test.mjs
├─ grok-identity.test.mjs
├─ gpt-identity.test.mjs
├─ download-snapshot.test.mjs
├─ grok-download.test.mjs
├─ gpt-download.test.mjs
├─ contract.test.mjs
├─ runtime-grok.test.mjs
├─ runtime-gpt.test.mjs
├─ cli.test.mjs
├─ skill-routing.test.mjs
├─ architecture.test.mjs
└─ fixtures/
   ├─ jobs/
   ├─ provider/
   └─ observations/
```

现有测试先按职责迁移，不一次性重写全部断言。每移动一个测试文件立即单独运行，再运行 `npm test`。

## 3. Fixture 规则

- Fixture 只保存虚构的 origin、opaque ID、尺寸和文件路径。
- 不保存真实 ChatGPT/Grok HTML、Cookie、签名 URL、账号名或完整截图。
- 图片 fixture 继续由 `tests/helpers.mjs` + `sharp` 生成，保证是真实可解码字节。
- 固定时间和随机 ID通过函数参数注入，不 monkey-patch 全局环境。
- provider observation fixture 是普通 JSON，不固定 CSS selector。

## 4. Provider 配置测试

### PC-01 规范值

- `default/grok/gpt` 接受。
- 空值、`openai`、`chatgpt`、大小写变体和未知值按设计拒绝。
- 验证：`node --test tests/provider-config.test.mjs`。

### PC-02 状态编解码

- 三个 provider 往返保持相同值和确定性 JSON。
- 缺字段、错误 schema、多余凭据字段、破损 JSON 返回闭集错误。

### PC-03 Skill 矩阵

- 覆盖官方/Web Skill 的四种开关组合和三种状态值。
- 只有三条合法组合返回 provider，其余全部 `provider-config-mismatch`。

### PC-04 旧 Grok 状态

- Web Skill 开启且状态文件缺失时只读返回 `grok + migrationRequired`。
- 官方 Skill 开启且状态文件缺失时返回 `default + migrationRequired`。
- 不在 status 操作中创建文件。

## 5. Provider 切换集成测试

所有测试使用 `mkdtemp` 创建隔离 `CODEX_ROOT`。

### PS-01 三值切换

- `default → grok → gpt → default`。
- 每一步断言恰好一个 Skill enabled、状态文件值正确、输出 provider 为规范值。

### PS-02 幂等

- 对同一 provider 连续切换两次。
- 第二次 `changed=false`，配置与状态文件字节不变。

### PS-03 用户配置保留

- managed block 前后放置自定义模型和 Skill 配置。
- 切换后三方内容逐字保留。

### PS-04 外部冲突

- managed block 外存在官方或 Web Skill path 时停止。
- 原文件字节不变，不产生 provider 状态。

### PS-05 中断注入

通过注入的 I/O adapter 在每个写入步骤前后抛错：

- 从 default 切 Web 时，中断后官方 Skill 仍是唯一可能生效路径或 status 明确 mismatch。
- 从 Web 切 default 时，中断后 Web 与官方不会同时启用。
- 临时文件被清理，原目标可继续读取。

### PS-06 dry-run

- 返回计划中的写入顺序和目标 provider。
- `config.toml/provider.json` 均不改变。

### PS-07 GPT 发布门

- GPT runtime、identity、download 和 Skill 路由完成前，公开 CLI 返回 `provider-not-ready`，且 `package.json` 不存在 `provider:gpt`。
- 离线总门完成后的发布 task 才增加该 script；随后在临时根切换并再次运行全部测试。

验证：`node --test tests/provider-switch.test.mjs`。

## 6. Job migration 测试

### JM-01 v2 round-trip

- provider、attemptPolicy、attempts 和候选写读一致。
- browser 对象、buf 和临时 observation 不落盘。

### JM-02 v1 terminal

- 旧 chosen job 读取为 `provider=grok`。
- 旧幂等选择结果保持可重放。

### JM-03 v1 ready

- 旧 candidates-ready / awaiting-user-selection 保留候选身份。
- synthetic attempt 不增加额度计数。

### JM-04 v1 generating

- 无身份的旧 generating job 标记 `migrationUnprovable`。
- 尝试恢复时进入 `selection-expired`，不返回可重提状态。

### JM-05 provider immutable

- 用 `gpt` 命令修改 `grok` job 返回 `provider-mismatch`。
- 文件字节和 mtime 不变。

验证：`node --test tests/job-migration.test.mjs`。

## 7. Attempt 单元测试

### AT-01 Policy 矩阵

逐项覆盖 Grok/GPT、AI/user、single/group 和边界数量 1/2/4/5。

### AT-02 Start 幂等

- 相同 prepared attempt 重放返回同一个 attemptId。
- 不同输入在 active attempt 未结束时返回 `attempt-pending`。

### AT-03 Bind 幂等

- 同 response 重放成功。
- 不同 response 绑定同 attempt 返回 `response-ambiguous`。

### AT-04 Budget

- GPT AI 第 3 个基础 attempt 被拒绝。
- GPT group 达到 targetCount 后被拒绝。
- recovery 只能使用一次且必须有硬失败原因。

### AT-05 Failure

- 只接受错误闭集。
- failed attempt 保留 purpose/error，但不保存网页原文。

### AT-06 Crash recovery

- prepared、bound、collected 三种磁盘断点重载后给出唯一下一动作。
- prepared 且页面证据歧义返回 `submission-ambiguous`。

验证：`node --test tests/attempts.test.mjs`。

## 8. Provider 身份测试

### GI-01 Grok 回归

搬迁现有 Post UUID、历史资源、当前资产和重复选择测试，断言保持不变。

### GPTI-01 合法响应

- 正确 origin、同 conversation、锚点后的唯一 response、合法 ordinal。
- 返回稳定 `gpt:<responseKey>:<ordinal>`。

### GPTI-02 错误页面

- 非 `chatgpt.com` origin 返回 `wrong-provider-page`。

### GPTI-03 对话切换

- conversationKey 与 attempt 不同返回 `conversation-changed`。

### GPTI-04 响应歧义

- 零个或多个锚点后 response 返回 `response-ambiguous`。

### GPTI-05 历史图

- response 位于锚点前或 asset 已在 beforeKeys 时拒绝。

### GPTI-06 Reference Image 排除

- 用户上传附件即使尺寸与生成图相同，也返回 `reference-ambiguous` 或明确的非候选结果。

### GPTI-07 缺失身份

- 只有媒体 URL、缩略图或 data URI 而无 response/ordinal 时返回 `asset-identity-missing`。

验证：

```console
node --test tests/grok-identity.test.mjs
node --test tests/gpt-identity.test.mjs
```

## 9. 下载测试

### DS-01 快照差异

- 新文件、内容覆盖、无变化、多变化分别可重复判定。
- 普通 debug 只报告数量，不报告无关文件名。

### GD-01 Grok 精确匹配

- 保留 UUID 新文件、唯一旧文件复用、多副本歧义等现有断言。

### GPTD-01 直接路径

- Chrome 返回的精确本地路径通过扩展名与硬解码后可进入 collect。
- 路径不存在、目录或不支持格式拒绝。

### GPTD-02 下载按钮唯一差异

- 只有一个新增支持图片时接受。
- 零个为 `download-missing`，两个为 `download-ambiguous`。

### GPTD-03 禁止猜测

- 只有历史同名图片时不允许复用。
- mtime 最新但非唯一时不选择。
- 文件名包含 responseKey 也不能代替页面资产身份。

验证：

```console
node --test tests/download-snapshot.test.mjs
node --test tests/grok-download.test.mjs
node --test tests/gpt-download.test.mjs
```

## 10. Runtime 场景测试

### RG-01 Grok AI 回归

一次 initial attempt 收两张、一次 recovery、二选一、refine 和幂等保持现状。

### RG-02 Grok user 回归

单选、组图 incomplete、全部、重画、取消保持现状。

### RGP-01 GPT AI 单响应两张

- 一个 attempt 得到两张有效图。
- 立即 `candidates-ready`，baseRemaining 仍为 1，不创建 fill attempt。

### RGP-02 GPT AI 两响应各一张

- initial 一张、fill 一张。
- 两张去重后进入 `candidates-ready`，agent 只能选一个。

### RGP-03 GPT AI 重复图

- 第二 attempt 与第一张内容相同。
- 内容去重，若无 recovery 授权条件则 `attempt-budget-exhausted`；有硬失败条件时只允许一次 recovery。

### RGP-04 GPT user single

- bind 时只冻结身份，不下载全部。
- 当前展开 asset 匹配后保存；历史/其他 response 拒绝。

### RGP-05 GPT user group

- 目标 2、4 的正常完成。
- 达到预算但只有部分候选时 `incomplete=true`；零候选失败。

### RGP-06 Provider mismatch

- 初始化为 gpt 的 job 用 grok 执行 collect/choose/redraw 全部失败且不改盘。

### RGP-07 Redraw

- 新 batch 继承 provider，attempts 清空，refinementUsed 正确增加。

### RGP-08 锁和恢复

- 每个新 mutating command 都服从 `.runtime.lock`。
- bound 后重启进程可以继续 collect；chosen 后重放不改写文件。

验证：

```console
node --test tests/runtime-grok.test.mjs
node --test tests/runtime-gpt.test.mjs
```

## 11. CLI 与 Skill 静态测试

### CLI-01 单 JSON 输出

每个新命令成功/失败都只输出一行 JSON，退出码与 `error` 一致。

### CLI-02 临时输入文件

成功消费删除；验证失败保留；路径必须在 `.web-imagegen` 内。

### CLI-03 Provider 发布状态

发布前后分别验证 `provider:gpt` 的拒绝和启用；两种情况下都不得触碰真实 Codex 根。

### SK-01 路由

- 顶层 Skill 明确先查 provider。
- `grok` 只路由 Grok 文档，`gpt` 只路由 GPT 文档。
- `default` 明确退出 Web ImageGen。

### SK-02 禁止项

静态扫描不得出现 Playwright、CDP、fetch、HTTP server、自管 profile、跨 provider fallback。

### SK-03 结构验证

Skill frontmatter、引用路径和脚本入口通过官方快速验证工具。

验证：

```console
node --test tests/cli.test.mjs tests/skill-routing.test.mjs tests/architecture.test.mjs
npm test
```

## 12. 调试验证

每个 runtime 场景测试同时断言 `debug`：

- 包含 provider、state、attempt status、预算和候选计数。
- 不包含 prompt、originalPrompt、refFiles、conversationKey、responseKey、asset URL、Cookie 字样或 data URI。
- 错误发生前后的 job diff 只包含预期字段。

调试一个失败时按固定顺序：

1. `provider:status --debug` 检查全局路由。
2. `status --job ... --provider ...` 检查主状态。
3. `debug --job ... --provider ...` 检查 attempt 阶段和预算。
4. 检查输入 JSON 是否仍保留。
5. 检查候选文件硬校验结果。
6. 最后才检查用户提供的浏览器标签页；不通过额外提交探测。

## 13. 默认回归门

每完成一个 task：

```console
node --test <本 task 对应测试文件>
npm test
git diff --check
```

最终离线门：

- 所有测试通过且无 skipped/todo。
- `npm test` 不读取真实 `~/.codex`。
- 测试过程不产生 workspace 外文件。
- `git diff --check` 无错误。
- 全文搜索只允许旧值 `openai` 出现在明确的迁移测试/历史说明中。

## 14. 真实浏览器验证

真实验证不进入 `npm test`，且必须由用户明确提供已登录的 Chrome ChatGPT 空白新对话标签页。

### LIVE-00 零提交 UI 勘测

- 预计提交：0。
- 只验证 origin、登录、空白对话、composer、附件入口和语义可观察的响应容器。
- 遇到界面歧义时停止并回传当前截图与可选项。

### LIVE-01 GPT AI

- 预计提交：最多 2；不自动使用 recovery/refine。
- 验证 attempt-start/bind、两候选、原图硬校验、agent 选择和 job provider。
- 只有用户另行授权第 3 次提交时才验证 recovery。

### LIVE-02 GPT 用户单选

- 预计提交：1。
- 用户在当前 response 中选图；验证冻结身份、单图物化与选择幂等。

### LIVE-03 GPT Reference Image

- 预计提交：1。
- 使用用户明确给出的非敏感本地图片；验证本次上传证据和生成图不与附件混淆。

### LIVE-04 断点恢复

- 预计新增提交：0。
- 在已完成 LIVE-02 的 job 上重启进程，验证 status、重新绑定同一对话和 choose 幂等，不再次下载或生成。

不主动测试登录失败、验证码、额度耗尽、付款、政策拒绝或删除历史聊天。

## 15. 真实验证证据

每个 LIVE case 只记录：

- case ID、provider、workflow、提交次数。
- batchKey、attempt 数量与最终状态。
- 候选格式、尺寸、内容摘要和最终路径。
- 是否发生恢复、歧义或用户介入。

不记录完整对话、账号信息、签名 URL、Cookie、全页 HTML 或未授权截图。
