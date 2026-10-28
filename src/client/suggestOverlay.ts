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
import { scheduleFrame } from './frame.ts'
import { asSelfWrite, occlusionNeedsProbe, subscribeOcclusionDirty } from './occlusion.ts'
import { composerTypeStyle, invalidateTypeStyle } from './typeStyle.ts'
import { getPrefs } from './prefs.ts'
import { claimComposer, registerSuggestionHider } from './overlayExclusion.ts'
import { sitBelowCover } from './occlusion.ts'

const CLASS = 'dsh-ph-suggest'
/** ③ Long predictions are clamped to this many lines with an ellipsis. */
const MAX_TEXT_LINES = 2
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
/** Watches the host's size: a sidebar toggle resizes the column, not the window. */
let resizeObserver: ResizeObserver | null = null
/**
 * What the DOM currently shows. Painting rebuilds two spans and rewrites the
 * inline geometry, so an unchanged paint is skipped: the fallback tick used to
 * rebuild identical content once a second (issue #13's residual cost).
 */
let paintedSignature = ''

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
 * The composer is mounted in stages (its card and placeholder can be replaced
 * right after the first prediction), so a light poll re-hides the placeholder
 * and drops a dead host. Geometry is NOT measured here: that is forced layout,
 * and it belongs to the coalesced frame (see frame.ts).
 */
function startTick(): void {
  if (tickTimer !== null) return
  tickTimer = window.setInterval(tick, 1000)
}

/** Observe the host's box so a column resize repaints in the same frame. */
function startResizeWatch(host: HTMLElement): void {
  stopResizeWatch()
  if (typeof ResizeObserver !== 'function') return
  resizeObserver = new ResizeObserver(() => { scheduleFrame(paint) })
  resizeObserver.observe(host)
}

/** Stop watching the host. */
function stopResizeWatch(): void {
  resizeObserver?.disconnect()
  resizeObserver = null
}

/** Stop the self-healing poll. */
function stopTick(): void {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
}

/**
 * One self-healing pass.
 *
 * Kept only as the fallback for layout changes no event reports (a column that
 * moves without resizing). It is deliberately slow: each paint is a forced
 * layout, and the scroll path — the actual cost in issue #14 — is now coalesced
 * into frames instead.
 */
function tick(): void {
  if (node === null || current === null) {
    stopTick()
    return
  }
  if (!current.host.isConnected) {
    hideSuggestion()
    return
  }
  if (node.style.visibility !== 'hidden' && current.hidePlaceholder) hidePlaceholders()
  // Queue one paint as the safety net for layout changes no event reports — a
  // popup that becomes visible through a class/style change is one. With the
  // painted-signature guard this costs a measurement, not a rebuild.
  scheduleFrame(paint)
}

/**
 * Queue a repaint for the coming frame.
 *
 * Scroll and resize fire far more often than frames; measuring inside the event
 * is what forced a synchronous layout per event. The queue collapses a burst
 * into one measurement.
 */
function onViewportChange(): void {
  if (node === null || current === null) return
  scheduleFrame(paint)
}

/** Hide the composer placeholder (inline + via the card class for re-renders). */
function hidePlaceholders(): void {
  asSelfWrite(() => hidePlaceholdersInner())
}

/** The actual placeholder hiding (wrapped as a self write by the caller). */
function hidePlaceholdersInner(): void {
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
  asSelfWrite(() => {
    document.querySelector<HTMLElement>(COMPOSER_CARD)?.classList.remove(CARD_CLASS)
    for (const { el, prev } of hiddenPlaceholders) el.style.visibility = prev
    hiddenPlaceholders = []
  })
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
  window.addEventListener('resize', () => { invalidateTypeStyle(); onViewportChange() }, { passive: true })
  window.addEventListener('scroll', onViewportChange, { passive: true, capture: true })
}

// A popup or card appearing must schedule a frame: the occlusion probe is gated
// on "nothing changed", so the change itself has to wake the paint.
subscribeOcclusionDirty(() => { scheduleFrame(paint) })

// The completion ghost must let go of the composer when a prediction appears.
registerSuggestionHider(hideSuggestion)

/** Is a suggestion currently on screen? */
export function suggestionVisible(): boolean {
  return node !== null
}

/** Remove the suggestion overlay (idempotent). */
export function hideSuggestion(): void {
  stopTick()
  stopResizeWatch()
  paintedSignature = ''
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
  // The composer gained real text after this prediction was drawn (typing, a
  // paste, an accepted completion, an IME commit). The repaint must not put the
  // ghost back on top of the user's own input — this runs on the tick, so a
  // missed React effect can no longer leave the two layered together.
  if (editorText(painted.host).trim() !== '') {
    hideSuggestion()
    return false
  }
  const box = editorBox(painted.host)
  if (box === null) {
    // Same rule as the ghost: a host that no longer renders (ask_user_question
    // takes over the composer seat, leaving the bar inside a display:none anchor)
    // must drop the overlay instead of pinning it over the replacing card. A
    // transient 0x0 keeps it, so a remount does not flicker.
    if (painted.host.getClientRects().length === 0) hideSuggestion()
    return false
  }
  const card = document.querySelector<HTMLElement>(COMPOSER_CARD)
  const style = composerTypeStyle(card)
  const signature = [
    painted.text, painted.hint, painted.pending === true ? '1' : '0',
    round(box.left), round(box.top), round(box.width), round(box.height), round(box.line),
    style.font, style.letterSpacing, round(style.fontSize),
    getPrefs().suggestLayout,
  ].join('\u0000')
  // A popup covering the composer outranks the overlay's own layer; drop just
  // below it so the panel covers the ghost instead of the ghost bleeding around
  // the panel. Restacked on every paint: the decision is per overlay, and the
  // call is internally gated on "the page changed or a cover persisted".
  sitBelowCover(el, box, painted.host)
  // Nothing moved: the DOM already shows exactly this, so skip the rebuild.
  if (signature === paintedSignature) return true
  // A cover with no layer of its own hides the hint (see occlusion.ts). The
  // composer's placeholder then has to come back — an empty field with neither
  // the hint nor the placeholder reads as a broken composer.
  if (el.style.visibility === 'hidden') restorePlaceholders()
  else if (painted.hidePlaceholder) hidePlaceholders()
  el.classList.toggle(`${CLASS}--pending`, painted.pending === true)
  const textEl = document.createElement('span')
  textEl.className = 'dsh-ph-suggest-text'
  textEl.textContent = painted.text
  const hintEl = document.createElement('span')
  hintEl.className = 'dsh-ph-suggest-hint'
  // The prediction may itself mention Tab (the conversation talks about it);
  // never repeat the hint in that case. A pending line never carries one.
  const wantHint = painted.pending !== true && painted.hint !== '' && !/tab/i.test(painted.text)
  // `oneLineWithHint` clamps the prediction to a single line and always renders the
  // hint as a block below it — the shape that fits a 48 px composer exactly.
  const layout = getPrefs().suggestLayout
  const oneLine = layout === 'oneLineWithHint'
  const maxLines = oneLine ? 1 : MAX_TEXT_LINES

  // The clamp gives a real ellipsis instead of letting overflow:hidden cut the
  // sentence mid-word.
  textEl.style.display = '-webkit-box'
  textEl.style.webkitLineClamp = String(maxLines)
  textEl.style.webkitBoxOrient = 'vertical'
  textEl.style.overflow = 'hidden'

  asSelfWrite(() => {
    el.textContent = ''
    el.append(textEl, hintEl)
    el.style.font = style.font
    el.style.letterSpacing = style.letterSpacing
    el.style.left = `${box.left}px`
    el.style.top = `${box.top}px`
    el.style.width = `${box.width}px`
    el.style.lineHeight = `${box.line}px`
    // The container follows its content: a clamped prediction needs more room than
    // an empty editor had, and clipping it was what made long predictions read as a
    // smear. Height is finished below, once measured.
    el.style.height = `${box.height}px`
    hintEl.style.fontSize = `${Math.max(10, style.fontSize - 2)}px`
    hintEl.textContent = wantHint ? ` ${painted.hint}` : ''
  })

  const textHeight = textEl.getBoundingClientRect().height
  const textIsOneLine = textHeight <= box.line * 1.5
  const showHint = wantHint && (oneLine || textIsOneLine)
  // A wrapped two-line prediction already fills the room the hint would need, so
  // the hint is dropped there (it would land on the composer footer).
  const blockHint = showHint && oneLine
  // The hint's FINAL layout has to be in the DOM before it is measured: measuring
  // the inline version and then switching to a block under-sized the container.
  asSelfWrite(() => {
    if (!showHint) {
      hintEl.textContent = ''
      hintEl.classList.remove('dsh-ph-suggest-hint--block')
    } else if (blockHint) {
      hintEl.classList.add('dsh-ph-suggest-hint--block')
      hintEl.textContent = painted.hint
    } else {
      hintEl.classList.remove('dsh-ph-suggest-hint--block')
      hintEl.textContent = ` ${painted.hint}`
    }
  })
  const hintHeight = showHint && blockHint ? hintEl.getBoundingClientRect().height : 0
  asSelfWrite(() => {
    const height = Math.max(box.height, textHeight + hintHeight)
    el.style.height = `${height}px`
  })
  paintedSignature = signature
  return true
}

/** Signature component: sub-pixel churn must not count as a change. */
function round(value: number): number {
  return Math.round(value * 100) / 100
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
  claimComposer('suggestion')
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
  claimComposer('suggestion')
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
  startResizeWatch(host)
  if (!paint()) {
    hideSuggestion()
    return false
  }
  startTick()
  return true
}
