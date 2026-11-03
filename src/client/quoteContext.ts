/**
 * What the user selected, and how it becomes a quote in the draft.
 *
 * The composer's quote used to be a bare markdown blockquote: the model got the
 * text but not where it came from, and a selected code block arrived as prose.
 * This module captures the selection's source (conversation row and turn), the
 * fence/language when it is code, and formats a quote that carries both — the
 * cheap half of what `dsh-client-ui-quote` does, without touching any host
 * internal API.
 *
 * @module dsh-prompt-history/client/quoteContext
 */

/** One captured selection. */
export interface QuoteContext {
  /** The selected text, verbatim. */
  readonly text: string
  /** The conversation row the selection starts in, when there is one. */
  readonly row: HTMLElement | null
  /** That row's flow kind, when the host exposes it. */
  readonly kind: 'user' | 'steering' | 'assistant' | 'other'
  /** Which conversation turn the row belongs to (1-based), or 0 when unknown. */
  readonly turn: number
  /** Opening fence (```` ```ts ````) when the selection is code, else null. */
  readonly fence: string | null
}

/** A reply-per-quote instruction appended to the block for the model only. */
const PER_ITEM = '▲ 请按出现顺序把以上引用记为「引用1」「引用2」…，并在回复中逐条对应。'

/** Line leading characters that would otherwise read as our own markers. */
const MARKER = /^([❝❞※\\])/

/**
 * The conversation rows in document order.
 * @returns the anchor rows.
 */
function conversationRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
}

/**
 * The turn a row belongs to: a user/steering row opens one, an assistant row
 * answers the most recent one.
 * @param row - the row to locate.
 * @returns the 1-based turn, or 0 when the row is not in the conversation.
 */
function turnOf(row: HTMLElement): number {
  let turn = 0
  for (const candidate of conversationRows()) {
    const kind = candidate.getAttribute('data-chat-flow-kind') ?? ''
    if (kind === 'user' || kind === 'steering') turn += 1
    if (candidate === row) {
      // An assistant row answers the turn that is already open.
      return kind === 'assistant' ? Math.max(1, turn) : Math.max(1, turn)
    }
  }
  return 0
}

/**
 * The fence for a code selection, when the range sits inside one rendered block.
 * @param range - the selection range.
 * @returns the opening fence line, or null for prose.
 */
function fenceOf(range: Range): string | null {
  const start = range.startContainer
  const element = start.nodeType === Node.ELEMENT_NODE ? start as Element : start.parentElement
  const pre = element?.closest('pre')
  if (pre === null || pre === undefined) return null
  // The whole selection has to live in that block; a range spanning out of it is
  // prose with code in the middle, and a fence would misrepresent it.
  if (!pre.contains(range.endContainer)) return null
  const code = pre.querySelector('code')
  const className = code?.className ?? pre.className ?? ''
  const language = /language-([a-zA-Z0-9+#-]+)/.exec(className)?.[1]
    ?? pre.getAttribute('data-language')
    ?? ''
  const body = range.toString()
  // The chosen fence must not appear in the body itself.
  const marker = body.includes('```') ? '~~~' : '```'
  return language === '' ? marker : `${marker}${language}`
}

/**
 * Capture the current document selection as a quote.
 * @returns the context, or null when nothing usable is selected.
 */
export function captureQuoteContext(): QuoteContext | null {
  const selection = document.getSelection()
  if (selection === null || selection.isCollapsed) return null
  const raw = selection.toString()
  if (raw.trim() === '') return null
  const range = selection.getRangeAt(0)
  const start = range.startContainer
  const element = start.nodeType === Node.ELEMENT_NODE ? start as Element : start.parentElement
  const row = element?.closest<HTMLElement>('[data-chat-anchor-key]') ?? null
  const rawKind = row?.getAttribute('data-chat-flow-kind') ?? ''
  const kind = rawKind === 'user' || rawKind === 'steering' || rawKind === 'assistant' ? rawKind : 'other'
  const fence = fenceOf(range)
  // Code keeps its whitespace; prose from a message row drops the row's clock and
  // blank-line padding.
  const text = fence === null && row !== null ? cleanRowText(raw) : raw
  if (text.trim() === '') return null
  return {
    text,
    row,
    kind,
    turn: row === null ? 0 : turnOf(row),
    fence,
  }
}

/**
 * Whether a selection happens inside a conversation message (so it can carry a
 * source attribution), or somewhere else such as a file preview.
 * @param context - the captured selection.
 * @returns true when a row was found.
 */
export function hasSource(context: QuoteContext): boolean {
  return context.row !== null && context.turn > 0
}

/** A trailing clock stamp the transcript row carries but the quote should not. */
const CLOCK = /^\s*(?:\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}月\d{1,2}日(?:\s+\d{1,2}:\d{2})?|刚刚|\d+\s*(?:秒|分钟|小时|天)前)\s*$/

/**
 * Clean a transcript row's selection.
 *
 * Selecting a whole message also selects its trailing clock stamp and the blank
 * lines the row adds around it; keeping them turns the quote into stray `> 12:01`
 * lines that mean nothing to the model.
 * @param text - raw selected text.
 * @returns the cleaned text.
 */
function cleanRowText(text: string): string {
  const lines = text.split('\n')
  while (lines.length > 0 && CLOCK.test(lines[lines.length - 1] ?? '')) lines.pop()
  return lines
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n')
}

/** Escape a line that would otherwise start with one of our markers. */
function guard(line: string): string {
  return line.replace(MARKER, '\\$1')
}

/**
 * Format one quote (plus its comment) for the composer draft.
 *
 * Shape, mirroring the convention other DSH quote plugins use so the model reads
 * the same thing everywhere:
 *
 * ```
 * > ❝ quoted line
 * > ❞ comment line
 * ※ 引自第 3 轮 · 助手
 * ```
 * @param context - the captured selection.
 * @param comment - the user's comment, or ''.
 * @param perItem - whether to append the reply-per-quote instruction.
 * @returns the text to insert into the draft.
 */
export function formatQuote(context: QuoteContext, comment: string, perItem: boolean): string {
  const lines: string[] = []
  if (context.fence !== null) {
    lines.push(`> ❝ ${context.fence}`)
    for (const line of context.text.split('\n')) lines.push(`> ${guard(line)}`)
    lines.push('> ```'.replace('```', context.fence.startsWith('~~~') ? '~~~' : '```'))
  } else {
    const quoted = context.text.split('\n').map((line) => `> ${guard(line)}`)
    quoted[0] = `> ❝ ${guard(context.text.split('\n')[0] ?? '')}`
    lines.push(...quoted)
  }
  if (comment.trim() !== '') {
    const commentLines = comment.trim().split('\n')
    commentLines[0] = `❞ ${commentLines[0] ?? ''}`
    lines.push(...commentLines.map((line) => `> ${line}`))
  }
  if (hasSource(context)) {
    const who = context.kind === 'assistant' ? '助手' : context.kind === 'user' ? '用户' : '对话'
    lines.push(`※ 引自第 ${context.turn} 轮 · ${who}`)
  }
  if (perItem) lines.push(`> ${PER_ITEM}`)
  return lines.join('\n')
}
