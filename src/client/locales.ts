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
  | 'sidebar.binary'
  | 'sidebar.binaryHint'
  | 'sidebar.binarySize'
  | 'sidebar.maximize'
  | 'sidebar.openInTerminal'
  | 'sidebar.tail'
  | 'sidebar.tailLabel'
  | 'sidebar.tailGone'
  | 'sidebar.diff'
  | 'sidebar.diffLabel'
  | 'sidebar.diffCollapse'
  | 'sidebar.diffExpand'
  | 'sidebar.diffCollapseAria'
  | 'sidebar.diffExpandAria'
  | 'sidebar.diffFiles'
  | 'sidebar.copy'
  | 'sidebar.copied'
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
  | 'header.usage.aria'
  | 'usage.title'
  | 'usage.close'
  | 'usage.range.7d'
  | 'usage.range.30d'
  | 'usage.range.90d'
  | 'usage.scope.label'
  | 'usage.scope.all'
  | 'usage.scope.main'
  | 'usage.scope.subtasks'
  | 'usage.workspace.all'
  | 'usage.loading'
  | 'usage.error'
  | 'usage.empty'
  | 'usage.overview.aiTokens'
  | 'usage.overview.aiCalls'
  | 'usage.overview.aiMessages'
  | 'usage.overview.aiSessions'
  | 'usage.overview.aiActiveDays'
  | 'usage.overview.aiStreak'
  | 'usage.overview.terminalSessions'
  | 'usage.overview.commands'
  | 'usage.overview.terminalMs'
  | 'usage.overview.terminalActiveDays'
  | 'usage.section.trend'
  | 'usage.section.heatmap'
  | 'usage.section.models'
  | 'usage.section.calls'
  | 'usage.section.terminals'
  | 'usage.tab.overview'
  | 'usage.tab.calls'
  | 'usage.tab.terminals'
  | 'usage.trend.aiTokens'
  | 'usage.trend.commands'
  | 'usage.trend.noData'
  | 'usage.heatmap.noData'
  | 'usage.models.empty'
  | 'usage.calls.empty'
  | 'usage.calls.time'
  | 'usage.calls.model'
  | 'usage.calls.duration'
  | 'usage.calls.input'
  | 'usage.calls.output'
  | 'usage.calls.cache'
  | 'usage.calls.reasoning'
  | 'usage.calls.effort'
  | 'usage.terminals.empty'
  | 'usage.terminals.started'
  | 'usage.terminals.shell'
  | 'usage.terminals.cwd'
  | 'usage.terminals.duration'
  | 'usage.terminals.commands'
  | 'usage.terminals.exit'
  | 'usage.terminals.running'
  | 'usage.terminals.toolsEmpty'
  | 'usage.export.csv'
  | 'usage.export.json'
  | 'usage.export.label'
  | 'usage.pager.prev'
  | 'usage.pager.next'
  | 'usage.pager.pageSize'

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
  'sidebar.binary': '二进制文件',
  'sidebar.binaryHint': '该文件类型无法以文本预览',
  'sidebar.binarySize': '大小',
  'sidebar.maximize': '全屏查看',
  'sidebar.openInTerminal': '在终端中打开',
  'sidebar.tail': '实时跟踪日志（tail -f）',
  'sidebar.tailLabel': 'tail',
  'sidebar.tailGone': '（文件已移除或轮转）',
  'sidebar.diff': '查看本次会话对该文件的修改',
  'sidebar.diffLabel': 'diff',
  'sidebar.diffCollapse': '折叠',
  'sidebar.diffExpand': '展开',
  'sidebar.diffCollapseAria': '折叠过长的差异',
  'sidebar.diffExpandAria': '展开 {count} 行被折叠的差异',
  'sidebar.diffFiles': '{count} 个文件',
  'sidebar.copy': '复制',
  'sidebar.copied': '已复制',
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
  'header.usage.aria': '打开/关闭使用统计',
  'usage.title': '使用统计',
  'usage.close': '关闭',
  'usage.range.7d': '近 7 天',
  'usage.range.30d': '近 30 天',
  'usage.range.90d': '近 90 天',
  'usage.scope.label': '范围',
  'usage.scope.all': '全部任务',
  'usage.scope.main': '仅主任务',
  'usage.scope.subtasks': '仅子任务',
  'usage.workspace.all': '全部工作区',
  'usage.loading': '加载中…',
  'usage.error': '统计加载失败',
  'usage.empty': '当前范围内暂无使用数据',
  'usage.overview.aiTokens': 'AI Tokens',
  'usage.overview.aiCalls': 'AI 调用',
  'usage.overview.aiMessages': 'AI 消息',
  'usage.overview.aiSessions': 'AI 会话',
  'usage.overview.aiActiveDays': '活跃天数',
  'usage.overview.aiStreak': '连续活跃',
  'usage.overview.terminalSessions': '终端会话',
  'usage.overview.commands': '终端命令',
  'usage.overview.terminalMs': '终端活跃',
  'usage.overview.terminalActiveDays': '终端活跃天数',
  'usage.section.trend': '每日趋势',
  'usage.section.heatmap': '活跃热力图',
  'usage.section.models': '模型占比',
  'usage.section.calls': '调用明细',
  'usage.section.terminals': '终端明细',
  'usage.tab.overview': '概览',
  'usage.tab.calls': '调用明细',
  'usage.tab.terminals': '终端明细',
  'usage.trend.aiTokens': 'AI Tokens',
  'usage.trend.commands': '命令数',
  'usage.trend.noData': '该范围暂无趋势数据',
  'usage.heatmap.noData': '暂无年度活跃数据',
  'usage.models.empty': '暂无模型数据',
  'usage.calls.empty': '暂无符合条件的调用',
  'usage.calls.time': '时间',
  'usage.calls.model': '模型',
  'usage.calls.duration': '耗时',
  'usage.calls.input': '输入',
  'usage.calls.output': '输出',
  'usage.calls.cache': '缓存',
  'usage.calls.reasoning': '思考',
  'usage.calls.effort': '思考度',
  'usage.terminals.empty': '暂无终端会话',
  'usage.terminals.started': '开始',
  'usage.terminals.shell': 'Shell',
  'usage.terminals.cwd': '目录',
  'usage.terminals.duration': '时长',
  'usage.terminals.commands': '命令',
  'usage.terminals.exit': '退出',
  'usage.terminals.running': '运行中',
  'usage.terminals.toolsEmpty': '暂无命令记录',
  'usage.export.csv': '导出 CSV',
  'usage.export.json': '导出 JSON',
  'usage.export.label': '导出',
  'usage.pager.prev': '上一页',
  'usage.pager.next': '下一页',
  'usage.pager.pageSize': '每页',
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
  'sidebar.binary': 'Binary file',
  'sidebar.binaryHint': 'This file type cannot be previewed as text',
  'sidebar.binarySize': 'Size',
  'sidebar.maximize': 'View fullscreen',
  'sidebar.openInTerminal': 'Open in terminal',
  'sidebar.tail': 'Tail the log (tail -f)',
  'sidebar.tailLabel': 'tail',
  'sidebar.tailGone': '(file removed or rotated)',
  'sidebar.diff': 'View this session\'s edits to the file',
  'sidebar.diffLabel': 'diff',
  'sidebar.diffCollapse': 'Collapse',
  'sidebar.diffExpand': 'Expand',
  'sidebar.diffCollapseAria': 'Collapse the oversized diff',
  'sidebar.diffExpandAria': 'Expand {count} collapsed diff lines',
  'sidebar.diffFiles': '{count} files',
  'sidebar.copy': 'Copy',
  'sidebar.copied': 'Copied',
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
  'header.usage.aria': 'Toggle usage stats',
  'usage.title': 'Usage',
  'usage.close': 'Close',
  'usage.range.7d': 'Last 7 days',
  'usage.range.30d': 'Last 30 days',
  'usage.range.90d': 'Last 90 days',
  'usage.scope.label': 'Scope',
  'usage.scope.all': 'All tasks',
  'usage.scope.main': 'Main tasks only',
  'usage.scope.subtasks': 'Subtasks only',
  'usage.workspace.all': 'All workspaces',
  'usage.loading': 'Loading…',
  'usage.error': 'Failed to load usage stats',
  'usage.empty': 'No usage data in this range',
  'usage.overview.aiTokens': 'AI tokens',
  'usage.overview.aiCalls': 'AI calls',
  'usage.overview.aiMessages': 'AI messages',
  'usage.overview.aiSessions': 'AI sessions',
  'usage.overview.aiActiveDays': 'Active days',
  'usage.overview.aiStreak': 'Day streak',
  'usage.overview.terminalSessions': 'Terminal sessions',
  'usage.overview.commands': 'Commands',
  'usage.overview.terminalMs': 'Terminal time',
  'usage.overview.terminalActiveDays': 'Terminal days',
  'usage.section.trend': 'Daily trend',
  'usage.section.heatmap': 'Activity heatmap',
  'usage.section.models': 'Model share',
  'usage.section.calls': 'Call details',
  'usage.section.terminals': 'Terminal details',
  'usage.tab.overview': 'Overview',
  'usage.tab.calls': 'Calls',
  'usage.tab.terminals': 'Terminals',
  'usage.trend.aiTokens': 'AI tokens',
  'usage.trend.commands': 'Commands',
  'usage.trend.noData': 'No trend data in this range',
  'usage.heatmap.noData': 'No yearly activity yet',
  'usage.models.empty': 'No model data',
  'usage.calls.empty': 'No matching calls',
  'usage.calls.time': 'Time',
  'usage.calls.model': 'Model',
  'usage.calls.duration': 'Duration',
  'usage.calls.input': 'Input',
  'usage.calls.output': 'Output',
  'usage.calls.cache': 'Cache',
  'usage.calls.reasoning': 'Reasoning',
  'usage.calls.effort': 'Effort',
  'usage.terminals.empty': 'No terminal sessions',
  'usage.terminals.started': 'Started',
  'usage.terminals.shell': 'Shell',
  'usage.terminals.cwd': 'Directory',
  'usage.terminals.duration': 'Duration',
  'usage.terminals.commands': 'Commands',
  'usage.terminals.exit': 'Exit',
  'usage.terminals.running': 'Running',
  'usage.terminals.toolsEmpty': 'No commands recorded',
  'usage.export.csv': 'Export CSV',
  'usage.export.json': 'Export JSON',
  'usage.export.label': 'Export',
  'usage.pager.prev': 'Previous',
  'usage.pager.next': 'Next',
  'usage.pager.pageSize': 'Per page',
}
