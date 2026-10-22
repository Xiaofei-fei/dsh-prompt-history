/**
 * The inline completion ghost: the matched suffix rendered in dim text right
 * after the caret. Vanilla DOM (like the plugin's other overlays) so it can be
 * driven from event handlers without re-rendering the composer.
 *
 * Placement is measured from the live caret: on the Lexical contenteditable the
 * collapsed Range gives the caret box; on the legacy <textarea> a hidden mirror
 * of the text before the caret yields the same thing. When the box cannot be
 * measured the ghost simply stays hidden — a misplaced hint is worse than none.
 */
import { COMPOSER_CARD } from './editor.ts'
import { sitBelowCover } from './occlusion.ts'

const GHOST_CLASS = 'dsh-ph-ghost'
let node: HTMLDivElement | null = null

/** Create the overlay style tag once. */
function ensureStyle(): void {
  if (document.querySelector('style[data-plugin-css="dsh-ph-ghost"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.pluginCss = 'dsh-ph-ghost'
  tag.textContent = [
    `.${GHOST_CLASS}{position:fixed;z-index:2147482000;pointer-events:none;`,
    'white-space:pre;overflow:hidden;font:inherit;opacity:.45;',
    'color:var(--dsw-alias-label-primary);}',
  ].join('')
  document.head.appendChild(tag)
  window.addEventListener('resize', onViewportChange, { passive: true })
  window.addEventListener('scroll', onViewportChange, { passive: true, capture: true })
}

/** Is the ghost currently on screen? */
export function ghostVisible(): boolean {
  return node !== null
}

/** Remove the ghost (idempotent). */
export function hideGhost(): void {
  stopTick()
  current = null
  if (node !== null) {
    node.remove()
    node = null
  }
}

/** A caret box with a usable height, or null. */
function usable(rect: DOMRect | undefined | null): DOMRect | null {
  if (rect === undefined || rect === null) return null
  if (rect.height <= 0 && rect.width <= 0) return null
  return rect
}

/** Caret box inside a contenteditable host (collapsed selection, then fallback). */
function editableCaretRect(host: HTMLElement): DOMRect | null {
  const sel = document.getSelection()
  if (sel === null || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const anchor = sel.anchorNode
  if (anchor === null || !(anchor === host || host.contains(anchor))) return null
  const direct = usable(range.getBoundingClientRect())
  if (direct !== null && direct.height > 0) return direct
  const rects = range.getClientRects()
  for (const rect of rects) {
    const hit = usable(rect)
    if (hit !== null && hit.height > 0) return hit
  }
  // Empty caret box (end of a line in some engines): measure the character
  // before the caret and take its right edge.
  const before = range.cloneRange()
  try {
    before.setStart(range.startContainer, Math.max(0, range.startOffset - 1))
    before.setEnd(range.startContainer, range.startOffset)
    const prev = usable(before.getBoundingClientRect())
    if (prev !== null && prev.height > 0) return prev
  } catch { /* boundary node: give up */ }
  return null
}

/** Caret box inside a legacy textarea, via a hidden mirror of the text before it. */
function textareaCaretRect(host: HTMLTextAreaElement): DOMRect | null {
  const box = host.getBoundingClientRect()
  if (box.height <= 0) return null
  const style = window.getComputedStyle(host)
  const mirror = document.createElement('div')
  const caret = document.createElement('span')
  mirror.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;white-space:pre-wrap;' +
    `left:${box.left}px;top:${box.top}px;width:${box.width}px;` +
    `font:${style.font};letter-spacing:${style.letterSpacing};` +
    `padding:${style.padding};border:${style.borderWidth} solid transparent;box-sizing:${style.boxSizing};`
  mirror.textContent = host.value.slice(0, host.selectionStart ?? 0)
  caret.textContent = '\u200b'
  mirror.appendChild(caret)
  document.body.appendChild(mirror)
  const rect = usable(caret.getBoundingClientRect())
  mirror.remove()
  if (rect === null) return null
  return rect
}

/** What the ghost currently shows: the suffix and the host holding the caret. */
let current: { readonly text: string; readonly host: HTMLTextAreaElement | HTMLElement } | null = null
/** Self-healing tick: the composer moves whenever a sidebar opens or closes. */
let tickTimer: number | null = null

/** Start following the caret while the ghost is on screen. */
function startTick(): void {
  if (tickTimer !== null) return
  tickTimer = window.setInterval(() => {
    if (node === null || current === null) {
      stopTick()
      return
    }
    if (!current.host.isConnected) {
      hideGhost()
      return
    }
    paint()
  }, 250)
}

/** Stop following the caret. */
function stopTick(): void {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
}

/** Repaint on viewport changes without waiting for the next tick. */
function onViewportChange(): void {
  if (node !== null && current !== null) paint()
}

/**
 * Re-measure the caret and move the ghost onto it.
 *
 * The position is derived here and nowhere else, so a sidebar toggle or a window
 * resize puts the ghost back beside the caret instead of leaving it where the
 * composer used to be.
 * @returns whether the ghost was painted.
 */
function paint(): boolean {
  const shown = current
  const el = node
  if (shown === null || el === null) return false
  const rect = caretRect(shown.host)
  if (rect === null) return false
  const card = document.querySelector<HTMLElement>(COMPOSER_CARD)
  const font = card !== null ? window.getComputedStyle(card).font : ''
  el.textContent = shown.text
  el.style.font = font === '' ? 'inherit' : font
  el.style.left = `${rect.right}px`
  el.style.top = `${rect.top}px`
  el.style.height = `${rect.height}px`
  el.style.lineHeight = `${rect.height}px`
  // Same rule as the suggestion overlay: never float above a popup that covers
  // the caret; sit just below it instead.
  const width = el.getBoundingClientRect().width
  sitBelowCover(el, { left: rect.right, top: rect.top, width: Math.max(1, width), height: rect.height }, shown.host)
  return true
}

/** The caret box for the composer host, or null when it cannot be measured. */
function caretRect(host: HTMLTextAreaElement | HTMLElement): DOMRect | null {
  if (host instanceof HTMLTextAreaElement) return textareaCaretRect(host)
  return editableCaretRect(host)
}

/**
 * Render `text` as a dim ghost right after the caret inside the composer.
 * @param text - the suffix to ghost.
 * @param host - the composer editor host holding the caret.
 * @returns whether the ghost is on screen.
 */
export function showGhost(text: string, host: HTMLTextAreaElement | HTMLElement): boolean {
  if (text === '') {
    hideGhost()
    return false
  }
  const rect = caretRect(host)
  if (rect === null) {
    hideGhost()
    return false
  }
  ensureStyle()
  if (node === null) {
    node = document.createElement('div')
    node.className = GHOST_CLASS
    node.setAttribute('aria-hidden', 'true')
    document.body.appendChild(node)
  }
  current = { text, host }
  if (!paint()) {
    hideGhost()
    return false
  }
  startTick()
  return true
}
