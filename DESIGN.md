# Codex Grok ImageGen 设计

## 1. 目标

本项目为 Codex 提供一个可全局启用的 Grok ImageGen Skill。它在 Grok 被选为全局 Generation Provider 时，使用 Codex 自带的 Chrome 能力接管用户明确指定、已登录的 Grok 标签页，并复用项目现有状态机、候选校验和文件落盘语义。

系统必须保持轻量和单路径：无 MCP、无 Playwright/CDP、无自管浏览器/profile、无 HTTP daemon、无第二浏览器后端、失败不降级。

## 2. 非目标

- 不调用 xAI/Grok API，也不管理 API key。
- 不兼容 OpenCode，不保留 OpenCode 工具协议。
- 不实现 ChatGPT 网页生图 provider。
- 不搜索或自动创建 Grok 标签页。
- 不从用户提示词推断全局提供方或 Grok 工作流模式。
- 不移植官方 ImageGen Skill 的 `generate/edit` 分类、通用提示词优化器或逐项语义校验门。
- 不把截图、缩略图、模糊预览或合成占位图当作最终原图。

## 3. 两层开关

### 3.1 全局 Generation Provider

全局开关只有两个值：

| 值 | 启用 | 禁用 | 唯一底层能力 |
|---|---|---|---|
| `openai` | 官方 ImageGen Skill | Grok ImageGen Skill | 内置 `image_gen` |
| `grok` | Grok ImageGen Skill | 官方 ImageGen Skill | Codex Chrome |

切换由用户显式运行命令完成。命令更新 Codex 的 Skill 启用配置后要求重启 Codex。任何时刻只能有一个 ImageGen Skill 生效；不在单个 Skill 内实现 provider 路由或 fallback。

### 3.2 Grok Workflow Mode

Grok Skill 内部另有 `workflow=ai|user`。首次未设置时询问一次，并在当前 Codex 任务内保持，直到用户切换。它只决定提示词归属、页面控制和选图责任，不改变全局 Generation Provider。

## 4. 组件与依赖方向

```text
Codex task
  └─ Grok ImageGen Skill
       ├─ Codex Chrome skill/runtime     浏览器读取与动作
       └─ one-shot local CLI             确定性状态与文件操作
            ├─ contract                  输入、状态、错误
            ├─ jobs                      状态转移、幂等、恢复
            ├─ candidates                文件真实性与图片校验
            ├─ paths                     工作区目录和版本
            ├─ selection                 选择规则
            └─ artifact                  真实转码与最终落盘
```

浏览器对象不得进入本地状态模块。本地 CLI 只接收普通 JSON、明确的本地文件路径和页面观察结果，因此测试无需浏览器。

## 5. Skill 职责

Grok Skill 负责：

1. 确认当前全局提供方确实为 Grok。
2. 读取或询问当前任务的 Workflow Mode。
3. 使用 Codex Chrome 绑定用户明确提供的 Grok 标签页。
4. 检查页面属于 Grok Imagine 且当前会话已登录。
5. 根据 Workflow Mode 输入提示词、参考图以及允许的页面选项。
6. 观察当前批次身份和生成完成信号。
7. 通过 Grok 页面触发原图下载。
8. 调用本地 CLI 校验候选、推进状态、执行选择和落盘。
9. 向用户展示需要决定的候选、状态和最终项目路径。

Skill 不负责：

- 浏览器连接实现、扩展安装或登录凭据。
- 自己启动浏览器或保存浏览器 profile。
- 在失败时调用 `image_gen` 或其他生成服务。
- 对用户提示词应用通用改写规则。
- 用主体、风格、构图、文字或禁止项检查作为硬成功门。

## 6. Chrome 边界

目标标签页必须由用户通过 Chrome 或标签页提及明确提供。绑定后：

- 仅允许在该标签页及其由用户动作产生的 Grok 页面状态中工作。
- 不枚举历史记录、Cookie、localStorage、密码或 profile。
- 标签页缺失、关闭、非 Grok、未登录或无法重新证明批次身份时停止。
- 恢复时重新绑定同一用户提供的标签页；浏览器对象从不落盘。
- 页面结构无法识别时返回 `ui-changed`，不尝试其他浏览器实现。

## 7. 提示词和页面选项

### AI 主导

Codex 根据父级任务、目标版位、参考图和已知设计上下文自行形成 Grok 提示词。这是任务执行的一部分，不是对用户提示词运行通用优化器。

- 默认使用速度档。
- 只有任务明确要求质量档时选择质量。
- 支持 Grok 页面提供的 `1:1 / 2:3 / 3:2 / 9:16 / 16:9`。
- 不支持的比例返回 `invalid-aspect`。

### 用户主导

- 原样提交用户提示词，除非用户明确要求改写。
- 不替用户点击质量或比例。
- 每批开始前明确选择单张或一组；一组还需期望数量。

`job.json` 记录实际提交提示词。用户主导且发生明确改写时，同时保留原始提示词。

## 8. 参考图

本地参考图必须在浏览器动作前通过本地 CLI 验证存在且为可接受图片。Skill 使用 Chrome 上传，并把本次上传产生的可验证标识绑定到当前批次。

历史上传、历史生成资产、侧栏图片和其他批次图片不得进入当前候选。无法证明关联时失败，不按相似 URL 猜测。

## 9. 批次与状态机

核心状态保留：

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

约束：

- 未结束批次阻止静默覆盖。
- `batchKey + source + ids` 继续作为选择幂等键。
- 相同选择重复执行返回第一次结果，不创建 `chosen-v2`。
- 新批次不得继承旧批次的 `chosenId/chosenIds`。
- 恢复只恢复磁盘状态，不恢复浏览器对象。
- 页面与磁盘批次无法相互证明时进入 `selection-expired`。

## 10. AI 主导工作流

1. 创建批次并进入 `generating`。
2. Codex 在 Grok 提交任务提示词和可选参考图。
3. 收集当前批次的真实原图，按页面顺序去重。
4. 只有两张候选均通过硬文件校验后才交给 Codex。
5. Codex基于当前任务做整体视觉二选一，不运行通用逐项语义验收器。
6. 写入 `chosen.jpg` 并记录 `chosenBy=agent`；另一候选保留。

恢复重试：当前批次不足两张、文件损坏或下载无效时，使用相同规格自动补发一次并跨批合并去重；仍不足则返回 `insufficient-candidates`。

审美重画：只有 `refine=1` 且 Codex 整体判断两张都不可用时，才允许针对性修改提示词并额外生成一批。最多一次。

## 11. 用户主导工作流

### 单张

1. 提交后冻结当前批次，进入 `awaiting-user-selection`。
2. 用户在 Grok 打开本批目标图并回复“选好了”。
3. Skill 验证当前 Post/资产属于本批并触发原图下载。
4. CLI 校验并写入 `chosen.jpg`，记录 `chosenBy=user`。

历史 Post、未加载图片或批次不匹配分别返回明确错误，不刷新页面、不猜测。

### 组图

1. 冻结并下载当前批次候选，写入 `1.<ext>…N.<ext>`。
2. 进入 `candidates-ready`，在 Codex 中展示编号候选；此时不写 chosen 文件。
3. 用户可以回复编号、全部、重画或取消。
4. 选择后执行幂等落盘；重画创建新版本目录；取消不产生 chosen。

实际数量少于请求数量时展示实际候选并标记 `incomplete=true`，不自动补发；零候选时失败并询问是否重试。

## 12. 图片硬校验与落盘

候选硬校验只覆盖：

- 来自当前批次且身份稳定。
- 文件非空、传输完整、可解码。
- MIME、魔数和扩展名一致。
- JPEG、PNG、WebP 元数据合法且尺寸有效。
- 非模糊预览、占位 data URI、缩略图或历史重复图。

候选保留 Grok 原始格式和字节。最终 `out` 支持 `.jpg/.jpeg/.png/.webp`，使用真实编解码转换；默认 `chosen.jpg`。不得通过改后缀、截图或生成纯色像素满足格式测试。

输出目录保持：

```text
<workspace>/imagine/<YYYY-MM-DD_任务>/<目标[-Vn]>/
```

## 13. 一次性 CLI

CLI 使用单次进程和 JSON 输出，不监听端口。计划命令：

- `init`：验证输入、创建 session/job 和批次。
- `status`：读取可恢复状态。
- `collect`：验证下载文件并冻结候选。
- `choose`：执行 agent/user 选择与最终转码。
- `redraw`：结束旧批次并创建版本批次。
- `cancel`：幂等取消。
- `debug`：输出脱敏状态。

所有命令失败时返回闭集错误码和非零退出码，不启动或控制浏览器。

## 14. 全局安装和开关

仓库保存 Grok Skill 源码、安装脚本和切换脚本。安装脚本把 Skill 安装到用户级 Codex Skill 目录；切换脚本只管理带明确 begin/end 标记的 Codex 配置块。

安全规则：

- 不修改官方 ImageGen Skill 文件本身。
- 不重写用户配置中的非托管内容。
- 发现同一路径的外部 Skill 配置时停止并解释冲突。
- 支持 `--dry-run` 和自定义配置根，便于离线测试。
- 全局写入只在用户显式运行安装/切换命令时发生。

## 15. 错误与诊断

保留 kebab-case 闭集错误，包括：

`login-wall`、`timeout`、`quota`、`blocked`、`ui-changed`、`busy`、`batch-pending`、`no-job`、`ref-missing`、`prompt-required`、`workspace-required`、`unknown-id`、`invalid-out-format`、`invalid-aspect`、`invalid-quality`、`ids-required`、`insufficient-candidates`、`selection-not-ready`、`selection-stale`、`selection-expired`。

默认 `debug.json` 只保存 URL 的非敏感路径、状态、候选数量、尺寸、MIME 和失败步骤。不保存完整 HTML、Cookie、账号信息、浏览器存储或全页截图。额外截图必须先获得用户许可。

## 16. 测试

### 默认离线测试

- 全局切换配置的 dry-run、互斥性、冲突保护和幂等。
- Skill 结构与 frontmatter 校验。
- CLI 输入、输出和错误码。
- 状态转移、恢复、并发锁和选择幂等。
- 当前批次候选过滤、文件真实性、尺寸和格式校验。
- `sharp` 真实转码和内容非空白验证。
- 单张、组图、重画、取消和 `refine=1` 预算规则。
- 静态架构检查：不得依赖 Playwright、CDP、Chromium profile、HTTP daemon 或 ChatGPT provider。

### 真实 Chrome 冒烟

真网测试不进入 `npm test`。执行前说明预计 Grok 提交次数并获得用户许可；遇到登录、验证码、额度或 UI 改版立即停止，不把人工操作算作自动测试成功。

## 17. 迁移完成条件

- 文档只描述 Codex 全局 Skill 架构，历史问题文档明确标记为历史。
- `playwright` 依赖和所有浏览器/profile/daemon 代码删除。
- OpenCode、ChatGPT provider 和兼容协议删除。
- Grok Skill 通过官方 Skill 结构校验。
- 全局安装/切换脚本可在临时配置根完成离线测试。
- `npm test` 全绿。
- 未经额度许可不运行真实 Grok 提交。
