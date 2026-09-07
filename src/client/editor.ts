/**
 * Composer editor abstraction for dsh-prompt-history.
 *
 * DSH ≤ 0.1.1: the composer input is a <textarea> inside
 * `[data-composer-card]` — selections/carets read off selectionStart/End.
 * DSH ≥ 0.1.2: the composer input is a Lexical contenteditable host
 * (`[data-composer-input]`); draft writes still flow through
 * `inputActions.setDraft`, and caret/selection read off the DOM Selection.
 * Everything editor-shaped goes through this module so both hosts behave the
 * same from the plugin's point of view.
 */

export const COMPOSER_CARD = '[data-composer-card]'
/** The rc.1 Lexical contenteditable host attribute. */
const EDITOR_HOST = '[data-composer-input]'

/** The composer editor host (textarea on old DSH, contenteditable on new), if any. */
export function editorHost(): HTMLTextAreaElement | HTMLElement | null {
  const card = document.querySelector<HTMLElement>(COMPOSER_CARD)
  if (card === null) return null
  const textarea = card.querySelector<HTMLTextAreaElement>('textarea')
  if (textarea !== null) return textarea
  return card.querySelector<HTMLElement>(EDITOR_HOST)
}

/** Is the event target the composer editor (the host or a node inside it)? */
export function isEditorTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest(COMPOSER_CARD) === null) return false
  if (target instanceof HTMLTextAreaElement) return true
  return target.closest(EDITOR_HOST) !== null
}

/** Whether the composer editor currently holds focus. */
export function editorFocused(): boolean {
  const host = editorHost()
  return host !== null && document.activeElement === host
}

/** The editor host's current plain text (its own content, not the draft mirror). */
export function editorText(host: HTMLTextAreaElement | HTMLElement): string {
  if (host instanceof HTMLTextAreaElement) return host.value
  return host.textContent ?? ''
}

/**
 * Text offset of a DOM Selection endpoint within a contenteditable host's
 * textContent (document-order text-node walk). Lexical decorations (chips)
 * are stripped by using the node's text; plain drafts map 1:1 to draft text.
 */
function hostOffsetOf(host: HTMLElement, node: Node, offset: number): number {
  if (node === host) return offset // collapsed at the host boundary
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  let acc = 0
  let current: Node | null = walker.nextNode()
  while (current !== null) {
    if (current === node) return acc + Math.min(offset, (current.textContent ?? '').length)
    acc += (current.textContent ?? '').length
    current = walker.nextNode()
  }
  return acc
}

/** Focus the editor host without scrolling (textarea or contenteditable). */
export function focusEditor(host: HTMLTextAreaElement | HTMLElement): void {
  host.focus({ preventScroll: true })
}

/**
 * The editor's selection as draft-text offsets [start, end), or null when the
 * editor is not the active selection owner. Exact on a textarea; best-effort
 * on the contenteditable (maps the DOM Selection through its text content).
 */
export function editorSelectionOffsets(host: HTMLTextAreaElement | HTMLElement): { start: number; end: number } | null {
  if (host instanceof HTMLTextAreaElement) {
    if (document.activeElement !== host) return null
    const start = host.selectionStart ?? 0
    const end = host.selectionEnd ?? start
    return { start, end }
  }
  if (document.activeElement !== host) {
    const hostNode = host.contains(document.activeElement) ? document.activeElement : null
    if (hostNode === null) return null
  }
  const sel = document.getSelection()
  if (sel === null || sel.rangeCount === 0) return null
  const { anchorNode, anchorOffset, focusNode, focusOffset } = sel
  if (anchorNode === null || focusNode === null) return null
  const inHost = (n: Node): boolean => n === host || host.contains(n)
  if (!inHost(anchorNode) || !inHost(focusNode)) return null
  const start = hostOffsetOf(host, anchorNode, anchorOffset)
  const end = hostOffsetOf(host, focusNode, focusOffset)
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

/** The editor's selected text ('' when there is no selection inside it). */
export function editorSelectedText(host: HTMLTextAreaElement | HTMLElement): string {
  if (host instanceof HTMLTextAreaElement) {
    if (document.activeElement !== host) return ''
    const start = host.selectionStart ?? 0
    const end = host.selectionEnd ?? start
    return end > start ? host.value.slice(start, end) : ''
  }
  const sel = document.getSelection()
  if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return ''
  const anchorNode = sel.anchorNode
  if (anchorNode === null || !host.contains(anchorNode)) return ''
  return sel.toString()
}

/**
 * Move the editor caret to a draft-text offset (used to park the caret after
 * an insertion). Exact on a textarea; best-effort collapse on the
 * contenteditable (falls back to leaving the caret wherever the editor put it).
 */
export function setEditorCaret(host: HTMLTextAreaElement | HTMLElement, offset: number): void {
  if (host instanceof HTMLTextAreaElement) {
    const clamp = Math.max(0, Math.min(offset, host.value.length))
    host.setSelectionRange(clamp, clamp)
    return
  }
  // Collapse the DOM selection inside the host after `offset` text characters.
  const target = Math.max(0, Math.min(offset, (host.textContent ?? '').length))
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  let acc = 0
  let node: Node | null = walker.nextNode()
  while (node !== null) {
    const len = (node.textContent ?? '').length
    if (acc + len >= target) {
      try {
        const range = document.createRange()
        range.setStart(node, Math.min(target - acc, len))
        range.collapse(true)
        const sel = document.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      } catch { /* structure edge: leave the caret alone */ }
      return
    }
    acc += len
    node = walker.nextNode()
  }
}
