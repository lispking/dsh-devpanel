# dsh-toolkit

> DeepSeek Harness（DSH）开发者工具箱：为 Web 控制台带来真实的 PTY 多标签终端，以及 AI 输出文件浏览器。

`dsh-toolkit` 是 DeepSeek Harness 的一个插件，为浏览器控制台带来两大能力：

- **终端面板** —— 停靠在输入框下方的多标签真实 PTY 终端。可以开始/终止进程、手工输入命令，实时查看输出，体验和原生终端一致。
- **AI 输出侧边栏** —— 右侧文件浏览器，列出当前会话中 AI 写入或编辑过的所有文件，支持语法高亮、Markdown 渲染和图片预览。

两个界面都由同一个宿主端服务 `TerminalPanelService` 驱动。它封装了 harness 的 `ctx.subprocess.spawnTerminal` PTY 原语，并通过 Typert Remote 边界暴露给浏览器 —— **无需改动 harness 本身**。Gateway 通过其 `typertRemote` 绑定自动发现该服务。

## 功能特性

- **真实 PTY 会话** —— 以系统登录 shell（`$SHELL`，缺省回退 `/bin/sh`）在会话工作目录下启动进程，并包裹一层使 shell 导出真实 `TERM`（harness 默认以 `TERM=dumb` fork PTY，会导致 `clear` 失效、提示符字形乱码）。`git`、`ls`、提示符的彩色输出与原生终端一致。
- **多标签终端对话框** —— 停靠在输入框下方，带标签栏、shell 徽标、`+` 新建标签、逐标签关闭，以及一键关闭全部会话的按钮。关闭最后一个标签会连面板一起关闭；重新打开时自动新建一个默认标签。
- **原生终端行为** —— 选中即复制到剪贴板，`Cmd/Ctrl+Shift+V` 粘贴，`clear` 正常清屏，跨任意字节分片的多字节 UTF-8 输出不会出现 `?` 乱码。
- **进程控制** —— 可向前台进程组投递 `SIGINT` / `SIGTERM` / `SIGKILL` / `SIGTSTP` / `SIGHUP`，或带 2 秒宽限期终止捕获的进程树。
- **增量输出读取** —— 浏览器轮询 `read` 获取增量输出；宿主端为每个会话保留有界回滚缓冲（保留尾部 1 MB），长输出可浏览且内存不会无限增长。
- **AI 输出文件侧边栏** —— 收集当前会话 `write` / `edit` 工具调用产生的文件（来源包括 diff 视图与原始参数，按首次出现顺序去重），通过 Remote 读取内容，按图片、Markdown、高亮代码或纯文本渲染，并支持全屏查看。
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
│    ConsoleHeaderActions   会话头部两个图标（终端 + 侧边栏开关）                │
│    ConsoleSidebar         AI 输出文件浏览器（右侧 details 列）                 │
│    TerminateDialog        多标签 xterm 对话框（输入框 dock 槽）                │
│    console-store.ts       共享的侧边栏/对话框开关状态                          │
│    console.css.ts         注入的 <style> 标签（无 CSS 流水线）                 │
│    locales.ts             中 / 英词典（命名空间 'toolkit'）                    │
└───────────────▲──────────────────────────────────────────────────────────────┘
                │  Typert Remote（JSON 线上格式，zod 严格编解码）
┌───────────────┴──────────────────────────── 宿主（node） ────────────────────┐
│  src/index.ts         TerminalPanelService（TypertRemoteService）             │
│  src/typert.host.ts   typert-loader 消费的 TYPERT 清单                        │
│  src/types.ts         共享线上词汇（纯数据，无运行时依赖）                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **宿主端**（`src/index.ts`）—— `TerminalPanelService` 继承 `TypertRemoteService`，维护一张无所有者的会话表。每个会话把来自 `ctx.subprocess.spawnTerminal` 的 `SubprocessTerminalHandle` 与流式 `TextDecoder`（保证跨两个输出分片的多字节字符不断裂）、有界回滚缓冲和增量读取游标组合在一起。会话生命周期跟随插件：构造函数注册了一个 fiber effect，在销毁时终止所有存活 PTY。
- **客户端**（`src/client/`）—— `apply` 先挂载 `TYPERT_REMOTE` 贡献（对话框注入它之前命名空间必须已挂载），然后基于同一个共享 console store 贡献**三个槽位**：
  - `conversation.session.header.utilities`（id `toolkit-actions`，order `10`）—— 终端对话框与侧边栏两个开关图标；
  - `details`（priority `-10`）—— AI 输出文件浏览器；**更低的优先级**会遮蔽 harness 自带 `DetailsPanel`（最低者渲染，所以 `-10` 胜出），并通过 `ctx.layout` 驱动右侧列；
  - `conversation.composer.dock`（id `toolkit-dialog`，order `10`）—— 多标签终端对话框。

  由于插件自己挂载 `remote.terminalPanel`，它通过 `ctx.get` 从服务仓库读取存活实例，而不是声明静态 inject 条目，从而避免自等死锁（self-wait deadlock）。

- **线上词汇**（`src/types.ts`）—— 跨越 Remote 边界的 JSON 安全结构，宿主编码与客户端描述符共用。`src/typert.host.ts` 提供一份严格手写的清单，确保无论模块身份如何端点都已知（独立安装的 bundle 若走运行时反射回退会 404）。

## 安装

`dsh-toolkit` 作为 workspace 包与 harness 源码并列开发。环境要求：

- Node `^22.19.0 || >=24.0.0`
- 包含 `../deepseek-harness` 的 pnpm workspace（见 `pnpm-workspace.yaml`）

```bash
# 在 workspace 根目录
pnpm install
pnpm --filter dsh-toolkit build
```

插件通过 `cordis.patch.yml` 贡献一条 bundle 记录（`{ id: toolkit, name: dsh-toolkit }`）；在列出该 bundle 的 harness profile 中启用即可。发布包暴露四个入口：

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

## 项目结构

```
src/
  index.ts               宿主端：TerminalPanelService（TypertRemoteService）
  typert.host.ts         供 typert-loader 使用的宿主面 TYPERT 清单
  types.ts               共享 JSON 线上词汇（纯数据）
  client/
    index.ts             客户端插件主体（apply/inject）
    remote.ts            TYPERT_REMOTE 贡献 + ctx.remote 类型
    ConsoleHeaderActions.tsx   会话头部两个图标开关
    ConsoleSidebar.tsx        AI 输出文件浏览器（details 列）
    TerminateDialog.tsx       多标签 xterm 对话框（输入框 dock）
    console-store.ts         共享的侧边栏/对话框快照 store
    console.css.ts           注入的样式表（style 标签）
    locales.ts               中 / 英词典（命名空间 'toolkit'）
tests/
  service.spec.ts        基于 stub subprocess 的 TerminalPanelService 行为测试
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
