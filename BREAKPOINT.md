# 当前接续点

更新时间：2026-09-05

## 已确认架构

- 项目与全局 Skill 的稳定名称为 Web ImageGen；当前只实现 Grok Provider Integration。
- 全局开关使官方 OpenAI ImageGen 与 Web ImageGen Skill 互斥；切换后重启 Codex。
- 后续供应商使用新的显式 provider 值和独立集成加入，不改变项目名称、不隐式路由或降级。
- provider 规范值为 `default | grok | gpt`：`default` 是 Codex 内置生图，`gpt` 是新的 GPT 网页供应商。Phase A（命名/状态/安全切换）已完成；公开 CLI 仍对 `gpt` 返回 `provider-not-ready`。
- Grok 模式只支持 ChatGPT 桌面应用中的 Codex + Chrome 扩展。
- 只操作用户明确提供且已登录的 Grok 标签页。
- 无 Playwright、CDP、自管 Chromium/profile、HTTP daemon、第二浏览器后端或失败降级。
- Skill 负责 Chrome 编排；一次性 Node CLI 负责状态、硬文件校验和落盘。
- 不移植官方 ImageGen Skill 的 generate/edit 分类、通用提示词优化器或逐项语义验收门。
- 用户主导提示词不主动改写；AI 主导由 Codex根据父级任务自行形成提示词。

## 实施状态

核心文档和历史 issue 已按新架构重写并通过全文审计。Skill、全局开关和一次性 CLI 均已实现；旧浏览器栈、daemon、Playwright 依赖及其脚本已经删除。

## 离线验证

迁移前离线基线为 85/85；迁移后测试已按新架构改写。Phase A 完成后当前 `npm test` 为 37/37。官方 `quick_validate.py` 返回 `Skill is valid!`。

已完成：

- `skill/web-imagegen/`：供应商中立入口、当前 Grok Chrome 编排和两种工作流。
- `scripts/skill-provider.mjs`：用户级安装及 `default | grok | gpt` 三值切换（公开 CLI 暂拒 `gpt`）。
- `src/provider-config.mjs` / `src/atomic-file.mjs`：Provider 状态纯函数与原子写。
- `scripts/web-imagegen.mjs`：一次性 JSON CLI。
- `src/runtime.mjs`：批次编排、锁、恢复、候选冻结和落盘。
- `src/jobs.mjs`、`src/candidates.mjs`、`src/paths.mjs`、`src/select.mjs`：迁移后的纯状态与校验核心。
- `src/artifact.mjs`：基于 `sharp` 的完整解码和真实转码。
- `src/browser-downloads.mjs`：只枚举冻结 Post UUID 文件的 Chrome 下载快照、精确解析和安全幂等复用。

已完成全局配置：

- Web ImageGen 已安装到真实 `~/.codex/skills/web-imagegen`，并链接当前仓库源码。
- 全局 Generation Provider 已切到 `grok`；官方 ImageGen Skill 已在托管配置块中禁用。

已完成真实验证：

- Chrome 扩展已连接用户明确提供且已登录的 Grok Imagine 标签页。
- AI 主导二选一真实冒烟已完成。
- 用户主导单选真实冒烟已完成；本次提交生成 2 张候选，用户选择的原图已验证并保存为 `chosen.jpg`（JPEG，768×1152）。
- Chrome 原图物化优化已用同一已选 Post 回归：`downloadMedia()` 优先、页面下载一次兜底、精确 UUID 文件复用；没有新增 Grok 提交，运行时返回 `idempotent=true`。
- 参考图上传真实验证已完成：上传既有 `chosen.jpg` 后单次生成 1 张，用户确认选择；页面资产接口精确匹配冻结 Post UUID，保存并硬校验为 JPEG（1008×1792），未使用 Chrome 下载按钮。
- 跨回合断点恢复已完成：新进程从持久状态读取同一批次为 `chosen`，重放冻结 Post UUID 的选择返回 `idempotent=true`，没有重复下载或改写文件。
- `refine=1` 真实策略验证已完成：初始批次严格生成 2 张并通过硬校验；候选 1 可用时按规则直接选择，状态为 `chosen`、`refinementBudget=1`、`refinementUsed=0`，因此没有发起不必要的第二次提交。

## 可选后续验证（需用户授权）

当前计划内真实验证均已完成；后续仅在出现新的真实场景或回归需求时追加。

未经用户另行许可，不修改真实 Codex 配置、不额外提交真实 Grok 任务。

## 下一接续点：GPT Web Provider Phase B

- Phase A（GPT-001～009）已完成。下一从 [GPT-010](./docs/gpt-provider-tasks.md) 开始，严格按单步任务顺序推进；每一步都先跑定向测试再跑 `npm test`。
- 代码模块、数据结构和 CLI 契约以 [详细代码设计](./docs/gpt-provider-implementation-design.md)为准。
- 测试编号、故障注入和真实提交预算以 [测试与验证方案](./docs/gpt-provider-test-plan.md)为准。
- Phase B～G 只使用临时目录和离线 fixture；Phase H 每个真实场景分别获得明确提交次数授权。
