# Web ImageGen for Codex

Web ImageGen 是面向 Codex 的供应商中立生图项目。它提供统一的全局安装、供应商切换、批次状态、图片校验、选择和项目落盘能力；每个供应商只实现自己的生图边界。

当前版本实现 `grok` 与 `gpt` 两条 Web 供应商路径：Codex 接管用户明确指定、已经登录的 Chrome 标签页完成生图。`gpt` 代表浏览器里的 ChatGPT Images，与 Codex 内置的 `default` 生图是不同路径。离线 runtime / identity / download / Skill 路由与发布门已通过；真实浏览器冒烟仍需按 Phase H 逐项授权。任一时刻只启用一个 Generation Provider，不做隐式路由或失败降级。

## 当前架构

```text
全局 Generation Provider
├─ default → 官方 ImageGen Skill → Codex 内置 image_gen（命名待迁移）
└─ Web ImageGen Skill
   ├─ grok                 → Codex Chrome → 用户指定的 Grok 标签页（已实现）
   └─ gpt                  → Codex Chrome → 用户指定的 ChatGPT 标签页（离线已发布；真实验证待授权）
       ↓
   共享本地状态/校验/落盘 CLI
```

- `Web ImageGen` 是稳定的项目和 Skill 名称；规范 provider 值为 `default | grok | gpt`。
- 官方 OpenAI ImageGen 与 Web ImageGen Skill 全局互斥，不靠提示词路由。
- 当前 Grok 实现只有 Codex Chrome 一个浏览器边界。
- 不使用 MCP、Playwright、CDP、自管 Chromium、独立 profile 或 HTTP daemon。
- Chrome、Grok 或下载失败时直接报告失败，不回退到其他供应商。
- 不读取或管理 Cookie、浏览器存储、密码或 profile。

## Grok 供应商前置条件

1. 使用 ChatGPT 桌面应用中的 Codex。
2. 在 **Settings → Computer Use** 中安装并连接 Chrome 扩展。
3. 在 Chrome 中打开并登录 Grok Imagine。
4. 开始任务时，通过 `@Chrome` 或标签页提及把目标 Grok 标签页明确交给 Codex。

Web ImageGen 不搜索、不新建、也不替换目标标签页。

## 安装和全局切换

安装全局 Web ImageGen Skill：

```console
npm run skill:install
```

切换到当前 Grok 供应商：

```console
npm run provider:grok
```

切换到 GPT Web 供应商：

```console
npm run provider:gpt
```

切回官方 Default Provider（内置 ImageGen）：

```console
npm run provider:default
```

查看当前状态：

```console
npm run provider:status
```

切换后重启 Codex。切换命令只管理 Web ImageGen 自己的配置块与 `<CODEX_ROOT>/web-imagegen/provider.json`；遇到同一路径的外部配置冲突或不一致状态时停止，不覆盖用户配置。`provider:default`、`provider:grok` 与 `provider:gpt` 均可在隔离/`--codex-root` 或用户显式切换时运行；旧命令 `provider:openai` 已退役。

## 当前 Grok 工作流

工作流模式与 Generation Provider 是两个不同概念。选择 `grok` 后，首次生图时选择 `workflow=ai` 或 `workflow=user`；该选择在当前 Codex 任务内持续生效，直到用户切换。

### AI 主导

- Codex 根据当前任务自行形成提交给 Grok 的提示词。
- 每次提交前显式把 Grok 图像数量设为 `×2`，不使用会产生额外资产的“自动模式”。
- 按任务要求设置 Grok 页面支持的比例和质量。
- 取得两张来自当前批次、真实且可解码的候选图。
- Codex 做整体视觉判断并二选一，未选候选继续保留。
- 候选缺失、损坏或无效时自动补发一次。
- 只有显式设置 `refine=1` 时，两张都整体不可用才允许针对性重画一次。

### 用户主导

- 原样提交用户提示词；只有用户明确要求时才改写。
- Codex 不替用户改变质量和比例。
- 单张：用户在 Grok 打开目标图并回复“选好了”。
- 组图：Codex 落盘并展示编号候选，用户可选择编号、全部、重画或取消。

两种工作流均支持本地参考图。

## 文件与隐私

默认输出结构：

```text
<workspace>/imagine/<日期_任务>/<生成目标>/
├─ job.json
├─ 1.<原格式>
├─ 2.<原格式>
└─ chosen.jpg
```

- 供应商候选保存经 Chrome 媒体表面物化并通过本地硬校验的真实原始字节；不重放 Grok HTTP 请求或读取 Cookie。
- 最终格式通过真实解码/编码转换；截图或纯色占位图不能作为成功产物。
- 重画使用 `-V2` 等版本目录，不覆盖旧批次。
- 默认调试只记录脱敏状态、尺寸、MIME 和失败步骤。
- 不保存完整 HTML、Cookie、账号信息或浏览器存储；全页截图必须另行获得用户许可。

## 扩展新供应商

新增供应商时，应增加独立的供应商编排和显式 provider 值，并复用本地状态、校验和落盘核心。不得把多个供应商同时启用、按提示词猜测供应商，或在失败后静默切换供应商。

GPT Web Provider Integration 的文档：

- [总体设计](./docs/gpt-provider-design.md)
- [详细代码设计](./docs/gpt-provider-implementation-design.md)
- [测试与验证方案](./docs/gpt-provider-test-plan.md)
- [单步实施任务](./docs/gpt-provider-tasks.md)

`provider:default`、`provider:grok` 与 `provider:gpt` 已可在隔离/`--codex-root` 环境下运行。真实 ChatGPT 标签页冒烟仍属 Phase H，需单独授权提交次数。

## 测试

```console
npm test
```

默认测试全部离线，不打开浏览器、不依赖账号、不消耗供应商额度。真实浏览器冒烟测试单独运行；执行前必须说明预计提交次数并获得用户许可。

架构详情见 [DESIGN.md](./DESIGN.md)，实施状态见 [TASK.md](./TASK.md)，当前接续点见 [BREAKPOINT.md](./BREAKPOINT.md)。
