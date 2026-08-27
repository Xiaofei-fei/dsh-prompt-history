/**
 * Locale dictionaries for dsh-prompt-history (zh/en). The active language
 * follows the DSH app locale; `en` is the key-parity mirror of `zh`.
 */

/** The plugin's locale namespace. */
export const NS = 'dsh-prompt-history'

/** zh dictionary — the authoritative key set. */
const zh = {
  'settings.title': '>_ 终端式输入',
  /** Settings-nav label (the `>_` glyph lives in the nav icon slot instead). */
  'settings.nav': '终端式输入',
  'settings.copyGroup': '复制方式（选中文字时）',
  'copyMode.toolbar': '工具栏复制（推荐）',
  'copyMode.auto': '选中即自动复制',
  'copyMode.off': '关闭复制',
  'paste.toggle': '右键直接粘贴：输入框上右键即粘贴剪贴板内容（终端风格，不弹菜单）',
  'history.global': '跨会话历史记忆：↑/↓ 历史在会话间保持（存于浏览器本地，上限 200 条）',
  'toc.toggle': '会话目录（Chat TOC）：对话左侧显示可拖动的目录把手',
  'settings.note': '历史（↑/↓、前缀搜索、Ctrl+R）始终开启。设置存于浏览器本地，修改立即生效。',
  'toolbar.copy': '复制',
  'toolbar.quote': '引用',
  'toolbar.code': '代码',
  'pill.copied': '已复制',
  'pill.quoted': '已引用',
  'pill.codeCopied': '已复制代码块',
  'toc.title': '会话目录',
  'toc.aria': '会话目录（可拖动）',
  'search.noMatch': '无匹配',
} as const

/** en dictionary (key parity enforced). */
const en: Record<keyof typeof zh, string> = {
  'settings.title': '>_ Terminal Input',
  'settings.nav': 'Terminal Input',
  'settings.copyGroup': 'Copy mode (on selection)',
  'copyMode.toolbar': 'Toolbar copy (recommended)',
  'copyMode.auto': 'Auto-copy on select',
  'copyMode.off': 'Off',
  'paste.toggle': 'Right-click pastes directly: right-click the input box to paste (terminal style, no context menu)',
  'history.global': 'Cross-session history: Up/Down history persists across sessions (browser-local, capped at 200)',
  'toc.toggle': 'Chat TOC: show the draggable grip on the chat left edge',
  'settings.note': 'History (Up/Down, prefix search, Ctrl+R) is always on. Settings are browser-local and take effect immediately.',
  'toolbar.copy': 'Copy',
  'toolbar.quote': 'Quote',
  'toolbar.code': 'Code',
  'pill.copied': 'Copied',
  'pill.quoted': 'Quoted',
  'pill.codeCopied': 'Code block copied',
  'toc.title': 'Conversation TOC',
  'toc.aria': 'Conversation TOC (draggable)',
  'search.noMatch': 'no match',
}

/** Key union of the plugin's copy. */
export type PromptHistoryKey = keyof typeof zh

/** Merge the namespace into the slot locale table (typed `t` seat + typed `bind`). */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-prompt-history': PromptHistoryKey
  }
}

export { zh, en }
