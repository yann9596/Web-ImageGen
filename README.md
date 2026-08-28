# Grok ImageGen for Codex

让 Codex 在全局 Grok ImageGen 模式下接管用户明确指定、已经登录的 Chrome Grok 标签页，完成生图、参考图上传、候选收集、选择与项目落盘。

本项目不提供自己的浏览器，也不连接 Grok API。它把浏览器动作交给 Codex 已有的 Chrome 能力，把状态机、文件校验和落盘交给本地一次性命令。

## 架构边界

```text
全局提供方开关
├─ openai → 官方 ImageGen Skill → 内置 image_gen
└─ grok   → Grok ImageGen Skill → Codex Chrome → 用户指定的 Grok 标签页
                                      ↓
                               本地状态/校验/落盘 CLI
```

- OpenAI 与 Grok 两个 ImageGen Skill 全局互斥，不靠提示词路由。
- Grok 模式只有 Codex Chrome 一个浏览器后端。
- 不使用 MCP、Playwright、CDP、自管 Chromium、独立 profile 或 HTTP daemon。
- Chrome、Grok 或下载失败时直接报告失败，不回退到 OpenAI ImageGen。
- 不读取或管理 Cookie、浏览器存储、密码或 profile。

## 前置条件

1. 使用 ChatGPT 桌面应用中的 Codex。
2. 在 **Settings → Computer Use** 中安装并连接 Chrome 扩展。
3. 在 Chrome 中打开并登录 Grok Imagine。
4. 开始任务时，通过 `@Chrome` 或标签页提及把目标 Grok 标签页明确交给 Codex。

Grok Skill 不搜索、不新建、也不替换目标标签页。

## 安装和全局切换

安装全局 Grok Skill：

```console
npm run skill:install
```

切换到 Grok：

```console
npm run provider:grok
```

切回 OpenAI ImageGen：

```console
npm run provider:openai
```

切换后重启 Codex。切换命令只管理本项目拥有的配置块；遇到同一路径的外部配置冲突时应停止，而不是覆盖用户配置。

## Grok 工作流

工作流模式与全局提供方是两个不同概念。进入 Grok 模式后，首次生图时选择 `workflow=ai` 或 `workflow=user`；该选择在当前 Codex 任务内持续生效，直到用户切换。

### AI 主导

- Codex 根据当前任务自行形成提交给 Grok 的提示词。
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

- 候选文件保存 Grok 下载的真实字节。
- 最终格式通过真实解码/编码转换；截图或纯色占位图不能作为成功产物。
- 重画使用 `-V2` 等版本目录，不覆盖旧批次。
- 默认调试文件只记录脱敏状态、尺寸、MIME 和失败步骤。
- 不保存完整 HTML、Cookie、账号信息或浏览器存储；全页截图必须另行获得用户许可。

## 测试

```console
npm test
```

默认测试全部离线，不打开浏览器、不依赖账号、不消耗 Grok 额度。真实 Chrome 冒烟测试单独运行；执行前必须说明预计提交次数并获得用户许可。

架构详情见 [DESIGN.md](./DESIGN.md)，实施状态见 [TASK.md](./TASK.md)，当前接续点见 [BREAKPOINT.md](./BREAKPOINT.md)。
