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
  | 'sidebar.user'
  | 'dialog.title'
  | 'dialog.close'
  | 'dialog.newTab'
  | 'dialog.closeTab'
  | 'dialog.placeholder'
  | 'dialog.noSession'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dsh-toolkit header actions, sidebar, and Terminate dialog copy. */
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
  'sidebar.user': '你',
  'dialog.title': '终端',
  'dialog.close': '关闭',
  'dialog.newTab': '新建终端',
  'dialog.closeTab': '关闭终端',
  'dialog.placeholder': '输入命令，回车执行',
  'dialog.noSession': '没有终端会话',
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
  'sidebar.user': 'You',
  'dialog.title': 'Terminal',
  'dialog.close': 'Close',
  'dialog.newTab': 'New terminal',
  'dialog.closeTab': 'Close terminal',
  'dialog.placeholder': 'Type a command and press Enter',
  'dialog.noSession': 'No terminal session',
}
