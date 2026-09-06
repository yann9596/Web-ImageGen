# Web ImageGen for Codex 实施清单

## 执行纪律

- 严格先完成全部文档迁移，再修改实现。
- 默认验证全部离线；任何真实 Grok 提交必须先说明次数并获得许可。
- 不修改或删除现有 `out/` 用户图片与诊断数据。
- 不写入用户全局 Codex 配置，除非用户显式运行或授权安装/切换操作。
- 不为保住旧测试而保留 OpenCode、Playwright、daemon 或双后端兼容层。

## D. 文档迁移

- [x] 新增 README，说明前置条件、安装、全局切换、工作流和隐私边界。
- [x] 重写 DESIGN，建立全局 Generation Provider 与 Workflow Mode 两层模型。
- [x] 重写 TASK 和 BREAKPOINT。
- [x] 将历史 issues 改成“事实与保留不变量”，删除旧实现指令。
- [x] 建立领域词汇表和架构决策记录。
- [x] 全文审计：旧术语只允许出现在“已删除/历史”语境。

## S1. Web ImageGen Skill 骨架

- [x] 创建 `web-imagegen` Skill，包含 `SKILL.md` 与 `agents/openai.yaml`。
- [x] 使用供应商中立的项目与 Skill 名称；当前实现明确标记为 Grok Provider Integration。
- [x] 描述覆盖普通位图生图请求，使当前供应商无需提示词约定。
- [x] Skill 明确依赖已连接的 Codex Chrome 能力，但不声明 MCP dependency。
- [x] 分离 AI 主导与用户主导条件指令，避免加载无关细节。
- [x] 使用 `quick_validate.py` 验证 Skill。

## S2. 全局安装与提供方开关

- [x] 实现用户级 Skill 安装命令。
- [x] 实现 `provider:grok` 与 `provider:openai`。
- [x] 仅修改托管配置块，保留其他 Codex 配置。
- [x] 支持 dry-run 和临时配置根。
- [x] 验证互斥、重复执行、路径转义、冲突停止与重启提示。

## S3. 本地一次性 CLI

- [x] 建立 `init/status/collect/choose/redraw/cancel/expire/debug` 命令。
- [x] 所有命令输出 JSON，错误使用闭集 kebab-case 代码。
- [x] CLI 不导入或控制任何浏览器实现。
- [x] 复用 `contract/jobs/paths/select/candidates` 中仍有效的纯逻辑；删除浏览器绑定的 generated-assets 层。
- [x] 用文件锁保护并发状态更新。

## S4. 图片真实性与落盘

- [x] 候选接受 JPEG、PNG、WebP，并校验魔数、完整解码、尺寸和扩展名。
- [x] 移除截图成功路径和纯色伪转码。
- [x] 引入 `sharp` 完成真实格式转换。
- [x] 默认写真实 `chosen.jpg`，尊重显式 `.jpg/.jpeg/.png/.webp` 输出。
- [x] 保留候选原始字节和未选候选。

## S5. 状态机迁移

- [x] 移除 provider 字段和 ChatGPT 分支。
- [x] 保留批次状态、恢复、幂等和版本目录规则。
- [x] AI 主导必须取得两张有效候选；硬失败自动重试一次。
- [x] `refine=1` 只提供一次额外审美重画预算。
- [x] 用户单张、组图、全部、编号、重画和取消行为保持。
- [x] 浏览器身份无法恢复时进入 `selection-expired`。

## S6. Chrome Skill 编排

- [x] Skill 只允许使用用户明确提供的 Chrome Grok 标签页。
- [x] Skill 要求检查 Grok Imagine 与登录状态。
- [x] Skill 编排提示词提交、参考图上传、AI 页面选项和用户页面控制。
- [x] Skill 只认当前批次稳定资产，经 Chrome 媒体接口物化原图并交给 CLI。
- [x] Chrome/Grok/UI 失败时返回明确错误，不降级。
- [x] 默认诊断脱敏，截图另行授权。

## S7. 删除旧实现

- [x] 删除 `src/browser.mjs`、`src/chatgpt.mjs` 和 `src/daemon.mjs`。
- [x] 删除依赖旧浏览器的 spike/live/probe/keep/dump 脚本。
- [x] 删除 Playwright 依赖与锁文件条目。
- [x] 删除 OpenCode 工具契约、provider 兼容字段和旧 npm scripts。
- [x] 保留 `out/` 和有价值的纯状态/校验模块。

## S8. 离线测试

- [x] 改写旧 daemon/Playwright/OpenCode 测试。
- [x] 增加 Skill、全局开关、CLI 和静态架构测试。
- [x] 增加真实转码、完整解码、预览拒绝和原始候选保留测试。
- [x] 保留状态机、候选过滤、路径、单选/组选和幂等测试语义。
- [x] `npm test` 全绿（23/23）。
- [x] `quick_validate.py` 全绿。

## S9. 用户授权后的真实验证

- [x] 安装全局 Skill 并切到 Grok；等待本次配置后的 Codex 重启。
- [x] 用户连接 Chrome 扩展并提供已登录 Grok 标签页。
- [x] 运行一次不带参考图的 AI 主导二选一。
- [x] 运行一次用户主导选择。
- [x] 机会性验证参考图上传与用户主导单选；页面资产接口保存 1008×1792 JPEG。
- [x] 机会性验证跨回合断点恢复：新进程读取 `chosen` 状态并幂等重放同一选择，不重复下载或改写。
- [x] 机会性验证 `refine=1`：预算为 1，初始两张候选可用时正确停止，`refinementUsed=0`，未浪费额外提交。

S9 不属于默认实现门禁；未授权时以离线验证完成交付。

## S10. Chrome 原图物化优化

- [x] 优先使用页面资产或主图 `downloadMedia()`，不重放 Grok HTTP 请求。
- [x] 页面下载按钮只允许一次兜底，不盲目重试。
- [x] 使用动作前后下载目录快照和冻结 Post UUID 解析唯一文件，不按时间猜测。
- [x] 快照调用必须提供冻结 Post UUID，助手不返回无关下载文件名。
- [x] 两级下载幂等无变化时，只允许复用唯一精确 UUID 文件并重新执行硬校验。
- [x] 增加新文件、历史文件、唯一复用和多副本歧义的离线回归。
- [x] 使用已选真实帖子完成回归；未新增 Grok 提交，运行时幂等返回原有 768×1152 JPEG。

## S11. GPT Web Provider 设计

- [x] 将 Codex 内置生图规范为 `default`，新的 GPT 网页供应商规范为 `gpt`。
- [x] 设计单 Web ImageGen Skill 下的显式 Provider Router 与三值全局开关。
- [x] 设计 job provider 冻结、Provider Attempt 预算和 ChatGPT 响应资产身份链。
- [x] 设计专用空白对话、外部页面不可信、登录/付款暂停和隐私边界。
- [x] 设计 AI 二选一、用户单张/组图、参考图和原图物化流程。
- [x] 记录提案 ADR 与实现前验收标准。
- [x] 写明模块拆分、job schema v2、attempt 状态机、CLI JSON 契约和迁移策略。
- [x] 写明离线测试矩阵、故障注入、调试顺序和逐项授权的真实验证方案。
- [x] 拆分 GPT-001～GPT-046 单步任务，每步包含依赖、改动、测试、调试和完成条件。

## S12. GPT Web Provider 实施

详细执行顺序见 [docs/gpt-provider-tasks.md](./docs/gpt-provider-tasks.md)，测试编号见 [docs/gpt-provider-test-plan.md](./docs/gpt-provider-test-plan.md)。每项只能在自己的定向测试和 `npm test` 同时通过后勾选。

- [x] Phase A（GPT-001～009）：Provider 命名、状态和安全切换。
  - [x] GPT-001 规范值 `default | grok | gpt`（`src/provider-config.mjs` / PC-01）
  - [x] GPT-002 `provider.json` 编解码（PC-02）
  - [x] GPT-003 Skill/provider 一致性（PC-03）
  - [x] GPT-004 旧 Grok/default 只读兼容（PC-04）
  - [x] GPT-005 单文件原子写（`src/atomic-file.mjs`）
  - [x] GPT-006 安全切换计划（`planProviderSwitch`）
  - [x] GPT-007 三值切换执行（PS-01～04）
  - [x] GPT-008 切换中断注入（PS-05）
  - [x] GPT-009 `provider:default` 发布门；公开 CLI 拒绝 `gpt`/`openai`（PS-06/07）
- [x] Phase B（GPT-010～017）：job schema v2 与 Provider Attempt。
- [x] Phase C（GPT-018～021）：Grok/GPT 资产身份模块。
- [x] Phase D（GPT-022～025）：下载快照、resolver 与候选准入。
- [x] Phase E（GPT-026～032）：Grok 回归及 GPT 三种 workflow。
- [x] Phase F（GPT-033～036）：Skill provider 路由。
  - [x] GPT-033 Skill `scripts/provider.mjs` status 入口（与根 CLI 一致）
  - [x] GPT-034 Grok 页面/Post/×2/下载规则迁入 `references/providers/grok.md`
  - [x] GPT-035 GPT 空白对话/锚点/提交/绑定/物化写入 `references/providers/gpt.md`
  - [x] GPT-036 顶层 Skill 先 status，再只加载一个 provider 与一个 workflow 文档（SK-01～03）
- [x] Phase G（GPT-037～040）：离线总验收与 GPT 命令发布门。
  - [x] GPT-037 全量 `npm test` 两次一致（85/85，无 skipped/todo）
  - [x] GPT-038 临时 Codex 根 install / 三值 dry-run / 三值切换 / status；真实配置 mtime 未变
  - [x] GPT-039 README/DESIGN/BREAKPOINT 同步；禁用项审计；`git diff --check`；Skill `quick_validate.py`
  - [x] GPT-040 解除 `provider-not-ready`，公开 `provider:gpt`（CLI-03）
- [ ] Phase H（GPT-041～046）：逐项授权的真实浏览器验证与收尾。
