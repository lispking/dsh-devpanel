/** `toolkit` namespace dictionaries (header actions + sidebar + Terminate dialog). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'toolkit'

/** The console dictionary key set (the source of truth for both locales). */
export type ConsoleKey =
  | 'header.sidebar.aria'
  | 'header.terminate.aria'
  | 'sidebar.title'
  | 'sidebar.close'
  | 'sidebar.empty'
  | 'sidebar.select'
  | 'sidebar.readError'
  | 'sidebar.maximize'
  | 'sidebar.openInTerminal'
  | 'sidebar.tail'
  | 'sidebar.tailLabel'
  | 'sidebar.tailGone'
  | 'sidebar.diff'
  | 'sidebar.diffLabel'
  | 'sidebar.user'
  | 'sidebar.modes.aria'
  | 'sidebar.modes.files'
  | 'sidebar.modes.browse'
  | 'sidebar.browse.loading'
  | 'sidebar.browse.error'
  | 'sidebar.browse.empty'
  | 'sidebar.enterDir'
  | 'dialog.title'
  | 'dialog.close'
  | 'dialog.newTab'
  | 'dialog.closeTab'
  | 'dialog.placeholder'
  | 'dialog.noSession'
  | 'dialog.search.placeholder'
  | 'dialog.search.prev'
  | 'dialog.search.next'
  | 'dialog.search.close'
  | 'dialog.resize'
  | 'dialog.renameTab'
  | 'dialog.palette.open'
  | 'dialog.palette.placeholder'
  | 'dialog.palette.name'
  | 'dialog.palette.command'
  | 'dialog.palette.save'
  | 'dialog.palette.empty'
  | 'dialog.palette.delete'
  | 'dialog.palette.add'
  | 'dialog.palette.hint'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dsh-devpanel header actions, sidebar, and Terminate dialog copy. */
    'toolkit': ConsoleKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<ConsoleKey, string> = {
  'header.sidebar.aria': '打开/关闭 AI 输出侧边栏',
  'header.terminate.aria': '打开/关闭终端对话框',
  'sidebar.title': '文件',
  'sidebar.close': '关闭',
  'sidebar.empty': '当前会话暂无文件',
  'sidebar.select': '选择左侧文件查看内容',
  'sidebar.readError': '读取文件失败',
  'sidebar.maximize': '全屏查看',
  'sidebar.openInTerminal': '在终端中打开',
  'sidebar.tail': '实时跟踪日志（tail -f）',
  'sidebar.tailLabel': 'tail',
  'sidebar.tailGone': '（文件已移除或轮转）',
  'sidebar.diff': '查看本次会话对该文件的修改',
  'sidebar.diffLabel': 'diff',
  'sidebar.user': '你',
  'sidebar.modes.aria': '侧边栏显示模式',
  'sidebar.modes.files': '会话文件',
  'sidebar.modes.browse': '目录',
  'sidebar.browse.loading': '加载中…',
  'sidebar.browse.error': '无法读取目录',
  'sidebar.browse.empty': '空目录',
  'sidebar.enterDir': '在该目录打开终端',
  'dialog.title': '终端',
  'dialog.close': '关闭',
  'dialog.newTab': '新建终端',
  'dialog.closeTab': '关闭终端',
  'dialog.placeholder': '输入命令，回车执行',
  'dialog.noSession': '没有终端会话',
  'dialog.search.placeholder': '搜索终端输出',
  'dialog.search.prev': '上一个匹配',
  'dialog.search.next': '下一个匹配',
  'dialog.search.close': '关闭搜索',
  'dialog.resize': '拖拽调整终端高度',
  'dialog.renameTab': '重命名终端标签',
  'dialog.palette.open': '命令片段面板',
  'dialog.palette.placeholder': '过滤命令片段…',
  'dialog.palette.name': '名称',
  'dialog.palette.command': '命令',
  'dialog.palette.save': '保存',
  'dialog.palette.empty': '没有匹配的命令片段',
  'dialog.palette.delete': '删除该片段',
  'dialog.palette.add': '新增片段',
  'dialog.palette.hint': '↑↓ 选择 · Enter 执行 · Esc 关闭',
}

/** English dictionary. */
export const en: Record<ConsoleKey, string> = {
  'header.sidebar.aria': 'Toggle the AI output sidebar',
  'header.terminate.aria': 'Toggle the terminal dialog',
  'sidebar.title': 'Files',
  'sidebar.close': 'Close',
  'sidebar.empty': 'No files in the current session yet',
  'sidebar.select': 'Select a file on the left to view its content',
  'sidebar.readError': 'Failed to read the file',
  'sidebar.maximize': 'View fullscreen',
  'sidebar.openInTerminal': 'Open in terminal',
  'sidebar.tail': 'Tail the log (tail -f)',
  'sidebar.tailLabel': 'tail',
  'sidebar.tailGone': '(file removed or rotated)',
  'sidebar.diff': 'View this session\'s edits to the file',
  'sidebar.diffLabel': 'diff',
  'sidebar.user': 'You',
  'sidebar.modes.aria': 'Sidebar display mode',
  'sidebar.modes.files': 'Session files',
  'sidebar.modes.browse': 'Browse',
  'sidebar.browse.loading': 'Loading…',
  'sidebar.browse.error': 'Failed to read directory',
  'sidebar.browse.empty': 'Empty directory',
  'sidebar.enterDir': 'Open terminal in this directory',
  'dialog.title': 'Terminal',
  'dialog.close': 'Close',
  'dialog.newTab': 'New terminal',
  'dialog.closeTab': 'Close terminal',
  'dialog.placeholder': 'Type a command and press Enter',
  'dialog.noSession': 'No terminal session',
  'dialog.search.placeholder': 'Search terminal output',
  'dialog.search.prev': 'Previous match',
  'dialog.search.next': 'Next match',
  'dialog.search.close': 'Close search',
  'dialog.resize': 'Drag to resize the terminal height',
  'dialog.renameTab': 'Rename terminal tab',
  'dialog.palette.open': 'Command snippet palette',
  'dialog.palette.placeholder': 'Filter snippets…',
  'dialog.palette.name': 'Name',
  'dialog.palette.command': 'Command',
  'dialog.palette.save': 'Save',
  'dialog.palette.empty': 'No matching snippets',
  'dialog.palette.delete': 'Delete snippet',
  'dialog.palette.add': 'Add snippet',
  'dialog.palette.hint': '↑↓ select · Enter run · Esc close',
}
