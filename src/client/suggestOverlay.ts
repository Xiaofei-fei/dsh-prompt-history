/**
 * The context-suggestion overlay: the predicted next prompt, ghosted in the
 * empty composer with a "press Tab" hint, matching the Codex composer look.
 *
 * Vanilla DOM (like the plugin's other overlays) so it can be driven from event
 * handlers without re-rendering the composer. It sits inside the editor's
 * content box with the same font, and never receives pointer events.
 *
 * @module dsh-prompt-history/client/suggestOverlay
 */
import { COMPOSER_CARD, editorHost, editorText } from './editor.ts'
import { sitBelowCover } from './occlusion.ts'

const CLASS = 'dsh-ph-suggest'
/** Toggled on the composer card while a prediction is on screen. */
const CARD_CLASS = 'dsh-ph-suggesting'
/** The composer's own placeholder ("描述你想要构建的内容…"). */
const PLACEHOLDER = '[data-composer-placeholder], [class*="placeholder"]'
let node: HTMLDivElement | null = null
/** Placeholders hidden for the current overlay, with their previous inline value. */
let hiddenPlaceholders: Array<{ el: HTMLElement; prev: string }> = []
/** Self-healing tick: re-hides a remounted placeholder and re-measures the box. */
let tickTimer: number | null = null
/** What is on screen right now, so a layout change can repaint it. */
let current: Painted | null = null

/** One painted suggestion: the content plus the host it must stay glued to. */
interface Painted {
  readonly text: string
  readonly hint: string
  readonly host: HTMLElement
  readonly hidePlaceholder: boolean
  /** Informational copy (a request is in flight): dimmed, and never hints a key. */
  readonly pending?: boolean
}

/**
 * Keep the overlay correct while it is on screen.
 *
 * Two things move under it without any event of their own: the composer is
 * mounted in stages (its card and placeholder can be replaced right after the
 * first prediction), and the column it lives in resizes or shifts whenever a
 * sidebar opens or closes. A light poll re-hides the placeholder and re-measures
 * the box, which also catches pure moves that a resize observer never reports.
 */
function startTick(): void {
  if (tickTimer !== null) return
  tickTimer = window.setInterval(tick, 250)
}

/** Stop the self-healing poll. */
function stopTick(): void {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
}

/** One self-healing pass: drop a dead host, re-hide, re-measure, repaint. */
function tick(): void {
  if (node === null || current === null) {
    stopTick()
    return
  }
  if (!current.host.isConnected) {
    hideSuggestion()
    return
  }
  if (current.hidePlaceholder) hidePlaceholders()
  paint()
}

/** Repaint on viewport changes, immediately rather than on the next tick. */
function onViewportChange(): void {
  if (node !== null && current !== null) paint()
}

/** Hide the composer placeholder (inline + via the card class for re-renders). */
function hidePlaceholders(): void {
  const card = document.querySelector<HTMLElement>(COMPOSER_CARD)
  card?.classList.add(CARD_CLASS)
  for (const el of document.querySelectorAll<HTMLElement>(PLACEHOLDER)) {
    // Re-showing for the same context must not record "hidden" as the value to
    // restore (that would leave the placeholder permanently hidden).
    if (el.style.visibility === 'hidden') continue
    hiddenPlaceholders.push({ el, prev: el.style.visibility })
    el.style.visibility = 'hidden'
  }
}

/** Restore every placeholder this overlay hid. */
function restorePlaceholders(): void {
  document.querySelector<HTMLElement>(COMPOSER_CARD)?.classList.remove(CARD_CLASS)
  for (const { el, prev } of hiddenPlaceholders) el.style.visibility = prev
  hiddenPlaceholders = []
}

/** Create the overlay style tag once. */
function ensureStyle(): void {
  if (document.querySelector('style[data-plugin-css="dsh-ph-suggest"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.pluginCss = 'dsh-ph-suggest'
  tag.textContent = [
    `.${CLASS}{position:fixed;z-index:2147482000;pointer-events:none;overflow:hidden;`,
    'white-space:pre-wrap;word-break:break-word;}',
    `.${CLASS} .dsh-ph-suggest-text{color:var(--dsw-alias-label-primary);opacity:.42;}`,
    `.${CLASS}--pending .dsh-ph-suggest-text{opacity:.26;font-style:italic;}`,
    `.${CLASS} .dsh-ph-suggest-hint{color:var(--dsw-alias-label-primary);opacity:.3;}`,
    `.${CLASS} .dsh-ph-suggest-hint--block{display:block;}`,
    // The composer's own hint must not sit under the prediction.
    `[data-composer-card].${CARD_CLASS} [data-composer-placeholder],`,
    `[data-composer-card].${CARD_CLASS} [class*="placeholder"]{visibility:hidden !important;}`,
  ].join('')
  document.head.appendChild(tag)
}

/**
 * Install the overlay stylesheet. Called once from the plugin body so the
 * placeholder-hiding rule exists even before the first prediction.
 */
export function installSuggestStyle(): void {
  ensureStyle()
  window.addEventListener('resize', onViewportChange, { passive: true })
  window.addEventListener('scroll', onViewportChange, { passive: true, capture: true })
}

/** Is a suggestion currently on screen? */
export function suggestionVisible(): boolean {
  return node !== null
}

/** Remove the suggestion overlay (idempotent). */
export function hideSuggestion(): void {
  stopTick()
  current = null
  restorePlaceholders()
  if (node !== null) {
    node.remove()
    node = null
  }
}

/** The editor's content box plus its line height, or null when unmeasurable. */
function editorBox(host: HTMLElement): { left: number; top: number; width: number; height: number; line: number } | null {
  const rect = host.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const style = window.getComputedStyle(host)
  const pad = (side: string): number => Number.parseFloat(style.getPropertyValue(side)) || 0
  const fontSize = Number.parseFloat(style.fontSize) || 14
  const rawLine = Number.parseFloat(style.lineHeight)
  const line = Number.isFinite(rawLine) && rawLine > 0 ? rawLine : fontSize * 1.5
  return {
    left: rect.left + pad('padding-left'),
    top: rect.top + pad('padding-top'),
    width: Math.max(40, rect.width - pad('padding-left') - pad('padding-right')),
    height: Math.max(line, rect.height - pad('padding-top') - pad('padding-bottom')),
    line,
  }
}

/**
 * Re-measure the host and rewrite the overlay's geometry and content.
 *
 * Everything positional is derived here and nowhere else, so a repaint after a
 * sidebar toggle, a window resize or a composer remount puts the ghost back
 * exactly on the editor's content box.
 * @returns whether the overlay was painted.
 */
function paint(): boolean {
  const painted = current
  const el = node
  if (painted === null || el === null) return false
  const box = editorBox(painted.host)
  if (box === null) return false
  const card = document.querySelector<HTMLElement>(COMPOSER_CARD)
  // A popup covering the composer outranks the overlay's own layer; drop just
  // below it so the panel covers the ghost instead of the ghost bleeding around
  // the panel. Restored to the stylesheet default as soon as it closes.
  sitBelowCover(el, box, painted.host)
  const style = window.getComputedStyle(card ?? painted.host)
  el.classList.toggle(`${CLASS}--pending`, painted.pending === true)
  const textEl = document.createElement('span')
  textEl.className = 'dsh-ph-suggest-text'
  textEl.textContent = painted.text
  const hintEl = document.createElement('span')
  hintEl.className = 'dsh-ph-suggest-hint'
  // The prediction may itself mention Tab (the conversation talks about it);
  // never repeat the hint in that case. A pending line never carries one.
  const showHint = painted.pending !== true && painted.hint !== '' && !/tab/i.test(painted.text)
  // A block hint needs a second line of room inside the composer.
  const block = box.height >= box.line * 2.1
  if (!showHint) {
    hintEl.textContent = ''
  } else if (block) {
    hintEl.classList.add('dsh-ph-suggest-hint--block')
    hintEl.textContent = painted.hint
  } else {
    hintEl.textContent = ` ${painted.hint}`
  }
  el.textContent = ''
  el.append(textEl, hintEl)
  el.style.font = style.font === '' ? 'inherit' : style.font
  el.style.letterSpacing = style.letterSpacing
  el.style.left = `${box.left}px`
  el.style.top = `${box.top}px`
  el.style.width = `${box.width}px`
  el.style.height = `${box.height}px`
  el.style.lineHeight = `${box.line}px`
  hintEl.style.fontSize = `${Math.max(10, (Number.parseFloat(style.fontSize) || 14) - 2)}px`
  return true
}

/**
 * Show progress in the composer while a request is in flight.
 *
 * Waiting in silence is what makes a probabilistic feature feel broken: the
 * prediction can take a few seconds, and an empty composer shows nothing at all
 * until it lands. The pending line uses the same overlay (and the same
 * self-correcting geometry), so the real prediction simply replaces it.
 * @param host - the composer editor host to align against.
 * @param host2 - unused placeholder kept for symmetry with showSuggestion.
 * @returns whether the pending line is on screen.
 */
export function showPending(text: string, host: HTMLElement, options: ShowSuggestionOptions = {}): boolean {
  if (text === '') return false
  if (editorText(host).trim() !== '') return false
  const box = editorBox(host)
  if (box === null) return false
  ensureStyle()
  const hidePlaceholder = options.hidePlaceholder !== false
  if (hidePlaceholder) hidePlaceholders()
  if (node === null) {
    node = document.createElement('div')
    node.className = CLASS
    node.setAttribute('aria-hidden', 'true')
    document.body.appendChild(node)
  }
  current = { text, hint: '', host, hidePlaceholder, pending: true }
  if (!paint()) {
    hideSuggestion()
    return false
  }
  startTick()
  return true
}

/**
 * Draw the predicted prompt inside the empty composer.
 *
 * The hint sits on its own line when the composer is tall enough (the Codex
 * look) and inline after the prediction when it is not, so nothing is ever
 * clipped.
 * @param text - the predicted next prompt.
 * @param hint - the accept hint copy (already localized).
 * @param host - the composer editor host to align against.
 * @returns whether the overlay is on screen.
 */
export interface ShowSuggestionOptions {
  /** Hide the composer's own placeholder under the ghost (off for panel fields). */
  readonly hidePlaceholder?: boolean
}

export function showSuggestion(
  text: string,
  hint: string,
  host: HTMLElement,
  options: ShowSuggestionOptions = {},
): boolean {
  if (text === '') {
    hideSuggestion()
    return false
  }
  // Guard against a lagging draft state: never paint over real input.
  if (editorText(host).trim() !== '') {
    hideSuggestion()
    return false
  }
  const box = editorBox(host)
  if (box === null) {
    hideSuggestion()
    return false
  }
  ensureStyle()
  const hidePlaceholder = options.hidePlaceholder !== false
  if (hidePlaceholder) hidePlaceholders()
  if (node === null) {
    node = document.createElement('div')
    node.className = CLASS
    node.setAttribute('aria-hidden', 'true')
    document.body.appendChild(node)
  }
  current = { text, hint, host, hidePlaceholder }
  if (!paint()) {
    hideSuggestion()
    return false
  }
  startTick()
  return true
}
