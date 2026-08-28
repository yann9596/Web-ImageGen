# 当前接续点

更新时间：2026-08-28

## 已确认架构

- 交付为全局 Grok ImageGen Skill，不是 MCP 或插件。
- 全局开关使官方 OpenAI ImageGen 与 Grok ImageGen 互斥；切换后重启 Codex。
- Grok 模式只支持 ChatGPT 桌面应用中的 Codex + Chrome 扩展。
- 只操作用户明确提供且已登录的 Grok 标签页。
- 无 Playwright、CDP、自管 Chromium/profile、HTTP daemon、第二浏览器后端或失败降级。
- Skill 负责 Chrome 编排；一次性 Node CLI 负责状态、硬文件校验和落盘。
- 不移植官方 ImageGen Skill 的 generate/edit 分类、通用提示词优化器或逐项语义验收门。
- 用户主导提示词不主动改写；AI 主导由 Codex根据父级任务自行形成提示词。

## 实施状态

核心文档和历史 issue 已按新架构重写并通过全文审计。Skill、全局开关和一次性 CLI 均已实现；旧浏览器栈、daemon、Playwright 依赖及其脚本已经删除。

## 离线验证

迁移前离线基线为 85/85；迁移后测试已按新架构改写，当前 `npm test` 为 20/20。官方 `quick_validate.py` 返回 `Skill is valid!`。

已完成：

- `skill/grok-imagegen/`：Chrome-only 编排和两种工作流。
- `scripts/skill-provider.mjs`：用户级安装及 OpenAI/Grok 全局互斥开关。
- `scripts/grok-imagegen.mjs`：一次性 JSON CLI。
- `src/runtime.mjs`：批次编排、锁、恢复、候选冻结和落盘。
- `src/jobs.mjs`、`src/candidates.mjs`、`src/paths.mjs`、`src/select.mjs`：迁移后的纯状态与校验核心。
- `src/artifact.mjs`：基于 `sharp` 的完整解码和真实转码。

未执行：

- 未把 Skill 安装到真实 `~/.codex/skills`。
- 未修改真实 Codex `config.toml`。
- 未连接真实 Chrome/Grok，也未消耗 Grok 额度。

## 可选下一步（需用户授权）

1. 运行 `npm run skill:install`。
2. 运行 `npm run provider:grok` 并重启 Codex。
3. 用户连接 Chrome 扩展并明确提供已登录的 Grok Imagine 标签页。
4. 经额度许可后分别做一次 AI 主导与用户主导真实冒烟。

未经用户另行许可，不安装到真实全局目录、不修改真实 Codex 配置、不提交真实 Grok 任务。
