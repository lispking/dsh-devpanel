# dsh-devpanel

> DeepSeek Harness（DSH）开发者工具箱：为 Web 控制台带来真实的 PTY 多标签终端、AI 输出文件浏览器，以及 AI+终端双维使用统计面板。

`dsh-devpanel` 是 DeepSeek Harness 的一个插件，为浏览器控制台带来三大能力：

- **终端面板** —— 停靠在输入框下方的多标签真实 PTY 终端。可以开始/终止进程、手工输入命令，实时查看输出，体验和原生终端一致。
- **AI 输出侧边栏** —— 右侧文件浏览器，列出当前会话中 AI 写入或编辑过的所有文件，支持语法高亮、Markdown 渲染和图片预览。
- **使用统计面板** —— 模态仪表盘，把两个维度合并成一个「我今天到底干了多少活」视图：AI 活动（Token、调用、消息、模型占比）与终端活动（会话数、提交的命令、活跃时长 —— 只有 dsh-devpanel 能看到这个维度，因为它拥有终端面板）。

终端与文件界面由 `TerminalPanelService` 驱动，统计面板由 `UsageService` 驱动。两者分别封装 harness 的 `ctx.subprocess.spawnTerminal` PTY 原语与 `session/event` 事件流 + 终端事件，并通过 Typert Remote 边界暴露给浏览器 —— **无需改动 harness 本身**。Gateway 通过各自的 `typertRemote` 绑定自动发现这两个服务。

## 功能特性

- **真实 PTY 会话** —— 以系统登录 shell（`$SHELL`，缺省回退 `/bin/sh`）在会话工作目录下启动进程，并包裹一层使 shell 导出真实 `TERM`（harness 默认以 `TERM=dumb` fork PTY，会导致 `clear` 失效、提示符字形乱码）。`git`、`ls`、提示符的彩色输出与原生终端一致。
- **多标签终端对话框** —— 停靠在输入框下方，带标签栏、shell 徽标、`+` 新建标签、逐标签关闭，以及一键关闭全部会话的按钮。关闭最后一个标签会连面板一起关闭；重新打开时自动新建一个默认标签。
- **原生终端行为** —— 选中即复制到剪贴板，`Cmd/Ctrl+Shift+V` 粘贴，`clear` 正常清屏，跨任意字节分片的多字节 UTF-8 输出不会出现 `?` 乱码。
- **进程控制** —— 可向前台进程组投递 `SIGINT` / `SIGTERM` / `SIGKILL` / `SIGTSTP` / `SIGHUP`，或带 2 秒宽限期终止捕获的进程树。
- **增量输出读取** —— 浏览器轮询 `read` 获取增量输出；宿主端为每个会话保留有界回滚缓冲（保留尾部 1 MB），长输出可浏览且内存不会无限增长。
- **AI 输出文件侧边栏** —— 收集当前会话 `write` / `edit` 工具调用产生的文件（来源包括 diff 视图与原始参数，按首次出现顺序去重），通过 Remote 读取内容，按图片、Markdown、高亮代码或纯文本渲染，并支持全屏查看。
- **AI+终端双维使用统计** —— 会话头部柱状图图标打开的模态仪表盘：把 `session/event` 事件流的 AI 侧（Token、调用、消息、模型占比、响应时长、思考度）与终端侧（会话数、提交命令、活跃时长）折叠成概览卡片、每日双系列趋势、年度活跃热力图、分页的调用/终端明细表，以及 CSV/JSON 导出。历史会话在启动时尽力通过 `ctx.sessionQuery` 回放；索引以防抖、原子写方式持久化到 `DSH_HOME/devpanel/usage-v1.json`。
- **会话级工作目录** —— 终端与相对路径文件读取都基于会话的项目目录解析（缺省回退到用户主目录 / 宿主进程 cwd）。
- **双语 UI** —— 简体中文与英文词典，注册在 `toolkit` 语言命名空间下。
- **干净的生命周期** —— 插件卸载时终止所有存活 PTY；客户端注销其槽位、移除注入的样式表并卸载 Remote 命名空间。

## 架构

插件是双面（two-face）bundle，与 harness 客户端预设保持一致：

```
┌─────────────────────────── 浏览器（web 平台） ───────────────────────────────┐
│  src/client/                                                                 │
│    index.ts               插件主体：挂载 Remote、注册槽位                      │
│    remote.ts              TYPERT_REMOTE 贡献 + ctx.remote 类型               │
│    ConsoleHeaderActions   会话头部三个图标（终端 + 侧边栏 + 统计开关）         │
│    ConsoleSidebar         AI 输出文件浏览器（右侧 details 列）                 │
│    TerminateDialog        多标签 xterm 对话框（输入框 dock 槽）                │
│    UsagePanel             AI+终端双维统计仪表盘（模态浮层）                    │
│    console-store.ts       共享的侧边栏/对话框/统计开关状态                     │
│    console.css.ts         注入的 <style> 标签（无 CSS 流水线）                 │
│    locales.ts             中 / 英词典（命名空间 'toolkit'）                    │
└───────────────▲──────────────────────────────────────────────────────────────┘
                │  Typert Remote（JSON 线上格式，zod 严格编解码）
┌───────────────┴──────────────────────────── 宿主（node） ────────────────────┐
│  src/index.ts         TerminalPanelService（TypertRemoteService）             │
│  src/usage.ts         UsageService（TypertRemoteService，usagePanel 命名空间）│
│  src/typert.host.ts   typert-loader 消费的 TYPERT 清单                        │
│  src/types.ts         终端线上词汇（纯数据，无运行时依赖）                     │
│  src/usage-types.ts   统计线上词汇（纯数据）                                  │
│  src/usage-schemas.ts 统计 zod 编解码（纯数据）                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **宿主端** —— `TerminalPanelService`（`src/index.ts`）继承 `TypertRemoteService`，维护一张无所有者的会话表。每个会话把来自 `ctx.subprocess.spawnTerminal` 的 `SubprocessTerminalHandle` 与流式 `TextDecoder`（保证跨两个输出分片的多字节字符不断裂）、有界回滚缓冲和增量读取游标组合在一起，并在共享 ctx 上发出终端生命周期事件（`devpanel/terminal/spawn|command|exit|dispose`）。会话生命周期跟随插件：构造函数注册了一个 fiber effect，在销毁时终止所有存活 PTY。`UsageService`（`src/usage.ts`）在 `usagePanel` 命名空间下继承 `TypertRemoteService`：它把实时 `session/event` 事件流折叠成按聊天会话归类的 AI 活动记录、把终端事件折叠成按终端会话归类的记录，以防抖、原子写方式把索引持久化到 `DSH_HOME/devpanel/usage-v1.json`，尽力通过 `ctx.sessionQuery` 回放历史会话，并提供聚合快照、调用/终端明细分页与 CSV/JSON 导出。插件的 `apply` 先装配 `UsageService`（确保在任何终端 spawn 之前完成订阅），再装配 `TerminalPanelService`。
- **客户端**（`src/client/`）—— `apply` 先挂载 `TYPERT_REMOTE` 贡献（对话框注入它之前命名空间必须已挂载），然后基于同一个共享 console store 贡献**三个槽位**：
  - `conversation.session.header.utilities`（id `toolkit-actions`，order `10`）—— 终端对话框、侧边栏与使用统计三个开关图标；
  - `details`（priority `-10`）—— AI 输出文件浏览器；**更低的优先级**会遮蔽 harness 自带 `DetailsPanel`（最低者渲染，所以 `-10` 胜出），并通过 `ctx.layout` 驱动右侧列；
  - `conversation.composer.dock`（id `toolkit-dialog`，order `10`）—— 多标签终端对话框。

  使用统计开关把 `UsagePanel` 渲染成固定模态浮层，通过 `usagePanel` Remote face 拉取快照、明细与导出。

  由于插件自己挂载 `remote.terminalPanel` 与 `remote.usagePanel`，它通过 `ctx.get` 从服务仓库读取存活实例，而不是声明静态 inject 条目，从而避免自等死锁（self-wait deadlock）。

- **线上词汇** —— `src/types.ts`（终端）与 `src/usage-types.ts`（统计）承载跨越 Remote 边界的 JSON 安全结构，宿主编码与客户端描述符共用；`src/usage-schemas.ts` 补充统计的 zod 编解码。`src/typert.host.ts` 提供一份严格手写的清单，确保无论模块身份如何端点都已知（独立安装的 bundle 若走运行时反射回退会 404）。

## 安装

`dsh-devpanel` 作为 workspace 包与 harness 源码并列开发。环境要求：

- Node `^22.19.0 || >=24.0.0`
- 包含 `../deepseek-harness` 的 pnpm workspace（见 `pnpm-workspace.yaml`）

```bash
# 在 workspace 根目录
pnpm install
pnpm --filter dsh-devpanel build
```

插件通过 `cordis.patch.yml` 贡献一条 bundle 记录（`{ id: toolkit, name: dsh-devpanel }`）；在列出该 bundle 的 harness profile 中启用即可。发布包暴露四个入口：

| Export | 路径 | 用途 |
| --- | --- | --- |
| `.` | `lib/index.js` | 宿主服务入口（默认导出 `TerminalPanelService`） |
| `./client` | `lib/client.js` | 浏览器 CJS closure-factory bundle |
| `./types` | `lib/types/types.js` | 共享线上类型 |
| `./typert` | `lib/typert.host.ts` | 宿主面 Typert 清单 |

## 使用说明

### 终端面板

点击会话头部的终端图标（`>_`）开关停靠在输入框下方的终端对话框。首次打开会在会话工作目录下新建一个默认标签（会话无工作目录时落到用户主目录）。用标签栏切换会话，`+` 新建标签，点标签上的 `×` 关闭——关闭最后一个标签会连面板一起关闭，重新打开时自动新建默认标签。

输入逐键写入 PTY（包含回车，不做换行转换），因此 `vim`、`top`、REPL 等交互程序表现符合预期。选中文本即复制，`Cmd/Ctrl+Shift+V` 粘贴。标签栏旁的 shell 徽标显示当前运行的 shell 程序（如 `zsh`）。

### AI 输出侧边栏

点击会话头部的面板图标开关右侧 details 列的文件侧边栏。它列出当前会话 `write` / `edit` 工具调用产生的全部文件（按首次出现顺序去重）。点击文件即通过宿主端读取：

- `.md` / `.mdx` 渲染为 Markdown；
- 常见代码扩展名获得语法高亮；
- 图片（`png`、`jpg`、`gif`、`webp`、`avif`、`svg` 等）以 data URL 内联渲染；
- 其余按纯文本渲染。

用 `⛶` 按钮全屏查看当前文件，`×` 关闭侧边栏。

### 使用统计面板

点击会话头部的柱状图图标打开使用统计仪表盘（模态浮层，`Esc` 或 `×` 关闭）。工具栏可选择范围（近 7 / 30 / 90 天）、任务范围（全部 / 仅主任务 / 仅子任务）与工作区（会话 cwd）。面板包含：

- **概览卡片** —— AI Token、调用、消息、会话、活跃天数 + 连续活跃，以及终端维度：终端会话数、提交命令数、终端活跃时长。
- **每日趋势** —— 每天 AI Token 与终端命令数的双系列柱状图。
- **活跃热力图** —— GitHub 风格的年度网格，按 AI+终端合并活动得分着色（悬停单元格查看具体数值）。
- **模型占比** —— 各模型的 Token 水平条形占比。
- **调用明细** —— 分页的助手调用行（时间、模型、思考度、耗时、输入/输出/缓存/思考 Token），跟随同样的范围/范围/工作区筛选。
- **终端明细** —— 分页的终端会话（开始、Shell、目录、时长、退出、命令数；悬停命令数查看具体命令）。
- **导出** —— 把当前范围下载为 CSV 或 JSON。

数据从插件加载起持续采集：实时 AI 活动来自 `session/event` 事件流，终端活动来自终端面板自身的事件，历史聊天会话在启动时尽力通过 `ctx.sessionQuery` 回放。索引持久化在 `DSH_HOME/devpanel/usage-v1.json`。

## Remote API

客户端以 `ctx.remote.terminalPanel.*` 访问 `terminalPanel` 命名空间。所有方法都接受可选的尾部 `AbortSignal` 参数，返回 `RemoteResult<T>`（`{ ok: true, value }` 或 `{ ok: false, error }`）。

| 方法 | 参数 | 结果 | 说明 |
| --- | --- | --- | --- |
| `spawn` | `{ argv, cwd, rows, cols, name? }` | `{ id, pid, shell }` | 新建一个 PTY 会话。空 `argv` 解析为带真实 `TERM` 的系统登录 shell；空或 `~` 的 cwd 落到用户主目录。 |
| `write` | `id, text, submit` | `{ ok: true }` | 向终端写入文本；`submit` 为 true 时追加回车序列（`\r`）。 |
| `read` | `id` | `{ delta, status }` | 消费自上次读取以来产生的增量输出，附带当前会话状态。 |
| `signal` | `id, sig` | `{ delivered: true, targetPgid }` | 向校验过的前台进程组投递 `SIGINT`/`SIGTERM`/`SIGKILL`/`SIGTSTP`/`SIGHUP`。 |
| `terminate` | `id` | `{ ok: true }` | 终止捕获的进程树（2 秒宽限）并等待静默；记录保持为已退出状态。 |
| `list` | — | `{ sessions }` | 按创建顺序列出存活会话。 |
| `dispose` | `id` | `{ ok: true }` | 移除会话记录，若仍在运行则先终止；未知 id 幂等返回 ok。 |
| `readFile` | `path, cwd?` | `{ path, content, kind, dataUrl? }` | 为浏览器读取一个文件。`~` 前缀与相对路径基于 `cwd`（默认宿主 cwd）解析；图片返回 base64 data URL。 |

会话状态为 `{ kind: 'running' }` 或 `{ kind: 'exited', exitCode, signal }`。完整的 TypeScript 词汇位于 `src/types.ts`，并通过包入口 `./types` 重新导出。

客户端以 `ctx.remote.usagePanel.*` 访问 `usagePanel` 命名空间，契约同样是 `RemoteResult<T>`。

| 方法 | 参数 | 结果 | 说明 |
| --- | --- | --- | --- |
| `snapshot` | `{ from, to, timeZone, scope, workspace? }` | `UsageSnapshot` | 某日期范围内的 AI+终端聚合（总量、逐日行、模型占比、工作区、索引健康度）。 |
| `calls` | `{ from, to, timeZone, scope, workspace?, model?, provider?, minInputTokens?, minOutputTokens?, page, pageSize }` | `UsageCallsPage` | 分页的助手调用明细，最新在前。 |
| `terminals` | `{ from, to, timeZone, workspace?, page, pageSize }` | `UsageTerminalsPage` | 分页的终端会话明细，最新在前。 |
| `exportCsv` | `{ from, to, timeZone, scope, workspace? }` | `{ filename, body }` | 合并逐日行的 CSV 导出。 |
| `exportJson` | `{ from, to, timeZone, scope, workspace? }` | `{ filename, body }` | 完整快照的 JSON 导出。 |

`scope` 为 `'all' | 'main' | 'subtasks'`；`from` / `to` 为给定 IANA `timeZone` 下的 `YYYY-MM-DD`。统计词汇位于 `src/usage-types.ts`。

## 项目结构

```
src/
  index.ts               宿主端：TerminalPanelService（TypertRemoteService）
  usage.ts               宿主端：UsageService（TypertRemoteService，usagePanel 命名空间）
  typert.host.ts         供 typert-loader 使用的宿主面 TYPERT 清单
  types.ts               终端 JSON 线上词汇（纯数据）
  usage-types.ts         统计 JSON 线上词汇（纯数据）
  usage-schemas.ts       统计 zod 编解码（纯数据）
  client/
    index.ts             客户端插件主体（apply/inject）
    remote.ts            TYPERT_REMOTE 贡献 + ctx.remote 类型
    ConsoleHeaderActions.tsx   会话头部三个图标开关
    ConsoleSidebar.tsx        AI 输出文件浏览器（details 列）
    TerminateDialog.tsx       多标签 xterm 对话框（输入框 dock）
    UsagePanel.tsx           AI+终端双维统计仪表盘（模态浮层）
    console-store.ts         共享的侧边栏/对话框/统计快照 store
    console.css.ts           注入的样式表（style 标签）
    locales.ts               中 / 英词典（命名空间 'toolkit'）
tests/
  service.spec.ts         基于 stub subprocess 的 TerminalPanelService 行为测试
  usage.spec.ts           统计采集/聚合 + 服务集成测试
  apply.client.spec.ts   客户端 apply：槽位、Remote 挂载、样式表
  clear-repro.spec.ts    UTF-8 分片 + clear 转义序列回归测试
  terminate-reopen.spec.ts  标签生命周期：关最后标签 / 重开自动新建
cordis.patch.yml         贡献给 harness profile 的 bundle 行补丁
tsdown.config.ts         双面构建（宿主 ESM + 客户端 CJS closure bundle）
vitest.config.ts         将 @deepseek-ai/* 解析到 harness 源码
```

## 开发

```bash
pnpm build          # tsc -p tsconfig.json && tsdown（宿主 + 客户端 bundle）
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run
pnpm test:watch     # vitest（监听模式）
```

给贡献者的注意事项：

- **绝不打包运行时** —— 客户端 bundle 通过 `tsdown.config.ts` 中的 `CLIENT_EXTERNALS` 将 `react`、`@deepseek-ai/*` 等保持 external；它们在运行时经由模块加载器注入的 `require` 解析。
- **两份 Remote 贡献必须保持同步** —— `src/client/remote.ts`（浏览器描述符）与 `src/typert.host.ts`（宿主清单）都是手写实现，与生成器输出对应；其 zod schema 与线上名称必须与 `src/index.ts` 中的 `@Remote` 方法一致。
- **客户端样式表是字符串** —— 客户端 bundle 没有 CSS 流水线，样式以单个注入的 `<style>` 标签携带（见 `console.css.ts`），颜色走 `--dsw-*` token 层并带中性回退。
- **回归测试覆盖真实字节流** —— `clear-repro.spec.ts` 在每一个可能的分片位置切分真实的提示符/清屏字节序列，确保绝不出现 `U+FFFD` 乱码。

## 许可证

MIT —— 见 [LICENSE](./LICENSE)。
