# Web-ImageGen — Repo-local Context

本文件只记录**本仓**事实（职责、模块、入口、构建/测试、约束）。项目级目标、协作边界与 Canonical Memory 在 Project Context Repo：`D:\AI\multica-memory`（见 `.ai/context.yaml`）。

机器可读指针：`.ai/context.yaml`。

验证基线：git revision `72db245a9d53886dfb4a6bc52fbc4a2179e237ec`（`main` @ `feat:web-imagegen-chrome-workflow`），对照 committed `README.md` / 目录树 / ADR；未把未提交工作区改动当作已实现事实。

## 所属 Project

| 字段 | 值 |
|---|---|
| Project | Web-ImageGen |
| Multica `project_id` | `19a54e43-57eb-4823-8bd2-4e026addcea7` |
| `repo_id` | `web-imagegen` |
| GitHub | https://github.com/yann9596/Web-ImageGen.git |
| 默认分支 | `main` |
| 本地主 checkout（只读参考；产品任务用独立 worktree） | `D:\AI\projects\opencode-web-imagegen` |
| Project Context / Memory | `D:\AI\multica-memory`（chain: `web-imagegen-pilot`，tags: `web-imagegen`） |

## Repo 职责

面向 Codex 的**供应商中立**生图能力（稳定名：Web ImageGen）：

- 统一全局 Skill 安装、Generation Provider 切换、批次状态、候选图硬校验、选择与项目落盘。
- 每个供应商只实现自己的生图边界；任一时刻只激活一个 Generation Provider。
- **当前已实现的浏览器供应商**：`grok` —— 经 Codex Chrome 接管用户**明确指定**、已登录的 Grok Imagine 标签页生图；使用用户自己的浏览器会话与账号额度。
- 全局互斥的另一侧是官方 OpenAI ImageGen Skill（`openai` / 内置 `image_gen`），由本仓 provider 切换命令启用/禁用，不是本仓浏览器编排实现。

不在本仓职责内（非目标，见 `DESIGN.md` / ADR）：

- 调用 xAI/Grok HTTP API 或管理 API key
- MCP / Playwright / CDP / 自管 Chromium / 独立 browser profile / HTTP daemon
- 隐式供应商路由或失败降级到另一供应商
- 搜索、新建或替换目标 Chrome 标签页；读写 Cookie / 浏览器存储 / 密码 / profile

## Module Map

```text
Codex task
  └─ skill/web-imagegen/          Web ImageGen Skill（当前 Grok 编排 + 工作流说明）
       ├─ SKILL.md / references/  ai-led、user-led、runtime 约束
       ├─ scripts/cli.mjs         Skill 侧 CLI 入口
       └─ scripts/downloads.mjs   下载相关辅助
  └─ scripts/
       ├─ skill-provider.mjs      全局 Skill 安装与 provider:grok|openai|status
       └─ web-imagegen.mjs        本地 one-shot CLI（状态/校验/选择/落盘）
  └─ src/                         确定性本地核心（无浏览器对象）
       ├─ runtime.mjs             命令编排与错误边界
       ├─ contract.mjs            输入/状态/错误契约
       ├─ jobs.mjs                批次状态转移与幂等
       ├─ candidates.mjs          候选真实性与图片硬校验
       ├─ paths.mjs               工作区目录与版本路径
       ├─ select.mjs              选择规则与身份键
       ├─ artifact.mjs            真实解码/转码与 chosen 落盘
       └─ browser-downloads.mjs   按 Post 身份匹配本地下载文件名（非浏览器控制）
  └─ tests/                       离线 node:test 套件
  └─ docs/adr/                    已接受架构决策
```

术语与避免用语见根目录 `CONTEXT.md`。架构与状态机细节见 `DESIGN.md`。

## 关键入口

| 用途 | 入口 |
|---|---|
| 安装全局 Web ImageGen Skill | `npm run skill:install` → `scripts/skill-provider.mjs install` |
| 切到 Grok 供应商 | `npm run provider:grok` |
| 切回官方 OpenAI ImageGen | `npm run provider:openai` |
| 查看当前 provider 状态 | `npm run provider:status` |
| 本地批次 CLI | `npm run imagegen` → `scripts/web-imagegen.mjs` |
| Skill 文档入口 | `skill/web-imagegen/SKILL.md` |
| 架构 / 任务 / 接续点 | `DESIGN.md` / `TASK.md` / `BREAKPOINT.md` |
| ADR | `docs/adr/0001-…`（Chrome 唯一浏览器边界）、`docs/adr/0002-…`（全局显式切换） |

切换 provider 后需重启 Codex。切换命令只管理本项目配置块；遇外部同路径冲突时停止，不覆盖用户配置。

## Build / Test

- 运行时：Node.js ESM（`package.json` `"type": "module"`）。
- 依赖：`sharp`（真实图片解码/转码）。
- 测试：`npm test` → `node --test` 跑 `tests/*.test.mjs`（见 `package.json` scripts.test）。
- 默认测试**全部离线**：不打开浏览器、不依赖账号、不消耗供应商额度。真实浏览器冒烟须单独运行并事先说明预计提交次数、获得用户许可。

## 本仓特殊约束

1. **单一激活 Provider**：`openai` 与 `grok` 全局互斥；不做提示词路由或失败静默降级。
2. **Grok 浏览器边界唯一**：仅 Codex Chrome + 用户明确交给 Codex 的已登录 Grok 标签页（`@Chrome` / 标签页提及）。
3. **Workflow Mode ≠ Provider**：`workflow=ai|user` 是任务内选择，与全局 Generation Provider 独立。
4. **候选必须是物化原图**：经 Chrome 媒体表面落到本地并通过硬校验的真实 JPEG/PNG/WebP 字节；截图、缩略图、占位图不算成功。
5. **输出布局**（默认）：`<workspace>/imagine/<日期_任务>/<生成目标>/`，含 `job.json`、编号候选、`chosen.jpg`；重画用 `-V2` 等版本目录，不覆盖旧批次。
6. **隐私**：默认调试只保留脱敏状态/尺寸/MIME/失败步骤；不落完整 HTML、Cookie、账号或浏览器存储。
7. **扩展供应商**：新增时加独立编排与显式 provider 值，并复用本地状态/校验/落盘核心；不得同时启用多个供应商。

## 与 Project Memory 的边界

- 本文件与 `.ai/context.yaml`：**repo-local**，随本仓版本管理。
- `D:\AI\multica-memory`：**project-wide** Canonical Memory / chains / registry；产品实现角色不写 `memory/`。
- 避免双写：仓库地图级长期事实以 Memory 为准；本仓只保留开发与导航所需的本地摘要，并标注验证 revision。
