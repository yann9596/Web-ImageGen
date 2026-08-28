# Codex Grok ImageGen 实施清单

## 执行纪律

- 严格先完成全部文档迁移，再修改实现。
- 默认验证全部离线；任何真实 Grok 提交必须先说明次数并获得许可。
- 不修改或删除现有 `out/` 用户图片与诊断数据。
- 不写入用户全局 Codex 配置，除非用户显式运行或授权安装/切换操作。
- 不为保住旧测试而保留 OpenCode、Playwright、daemon 或双后端兼容层。

## D. 文档迁移

- [x] 新增 README，说明前置条件、安装、全局切换、工作流和隐私边界。
- [x] 重写 DESIGN，建立全局 provider 与 Grok workflow 两层模型。
- [x] 重写 TASK 和 BREAKPOINT。
- [x] 将历史 issues 改成“事实与保留不变量”，删除旧实现指令。
- [x] 建立领域词汇表和架构决策记录。
- [x] 全文审计：旧术语只允许出现在“已删除/历史”语境。

## S1. Skill 骨架

- [x] 创建 `grok-imagegen` Skill，包含 `SKILL.md` 与 `agents/openai.yaml`。
- [x] 描述覆盖普通位图生图请求，使 Grok 模式无需提示词约定。
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
- [x] Skill 只认当前批次稳定资产，触发原图下载并交给 CLI。
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
- [x] `npm test` 全绿（20/20）。
- [x] `quick_validate.py` 全绿。

## S9. 用户授权后的真实验证

- [ ] 安装全局 Skill 并切到 Grok，重启 Codex。
- [ ] 用户连接 Chrome 扩展并提供已登录 Grok 标签页。
- [ ] 运行一次不带参考图的 AI 主导二选一。
- [ ] 运行一次用户主导选择。
- [ ] 机会性验证参考图、恢复或 `refine=1`，不为覆盖率额外消耗额度。

S9 不属于默认实现门禁；未授权时以离线验证完成交付。
