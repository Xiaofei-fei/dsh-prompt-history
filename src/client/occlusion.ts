/**
 * Occlusion helper for the composer overlays.
 *
 * Both ghosts are `position: fixed` at `z-index: 2147482000` so they stay above
 * the composer's own content. The side effect is that any popup which happens
 * to cover the composer — the permission-preset menu, a context menu, a dialog
 * — is painted *under* the ghost, so the hint bleeds around the popup's edges
 * and across approval cards.
 *
 * This module answers a single question: what is covering this box, and how
 * high is it stacked? An overlay can then drop to just below that surface and
 * let the popup cover it cleanly, without moving the hint or hiding it.
 *
 * @module dsh-prompt-history/client/occlusion
 */
import { onFrameEnd } from './frame.ts'

/** A box in viewport coordinates, as measured for the composer. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Popup surfaces that may float above the composer. */
const POPUP_SELECTOR = [
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[data-popper-placement]',
].join(',')

/**
 * Probing is the last cost left in the paint pass: five hit tests plus a popup
 * query, once per painted frame. Two cheap gates keep it off the common path —
 * no overlay is covered while nothing on the page has changed.
 *
 * `domDirty` starts true so the first paint always probes; any mutation sets it
 * again (streaming a turn keeps it set, which is correct: cards and menus appear
 * during a turn). Scrolling does not mutate the DOM, so a scroll burst after one
 * clean frame costs no hit tests at all.
 */
let domDirty = true
/**
 * Per-overlay cover state. Two overlays paint in the same frame; a shared flag
 * would let whichever painted first decide for the other one (and clear the
 * page-level dirty flag before its sibling probed).
 */
const coveredByOverlay = new WeakMap<Element, boolean>()
let observer: MutationObserver | null = null
/** The flag is page-level; every overlay in the frame must still see it. */
onFrameEnd(() => { domDirty = false })
/**
 * Depth of our own DOM writes. The overlays hide placeholders and restyle
 * themselves on every paint, which are mutations too; counting them keeps our own
 * writes from marking the page dirty forever (that would defeat the gate).
 */
let selfWrites = 0
const dirtyListeners = new Set<() => void>()
let notifyTimer: number | null = null

/**
 * Whether the next paint still owes an occlusion probe.
 *
 * A repaint that would change nothing must still run when the page changed (or a
 * cover persisted), because restacking is an occlusion decision rather than a
 * content one.
 * @returns true when a probe is pending.
 */
export function occlusionNeedsProbe(): boolean {
  return domDirty
}

/**
 * Run a DOM write that must not count as "the page changed".
 * @param write - the mutation to perform.
 */
export function asSelfWrite(write: () => void): void {
  selfWrites += 1
  try {
    write()
  } finally {
    // MutationObserver callbacks are microtasks; the timer runs after them.
    window.setTimeout(() => { selfWrites = Math.max(0, selfWrites - 1) }, 0)
  }
}

/**
 * Register a callback for "something on the page changed, probe again".
 * @param listener - usually `() => scheduleFrame(paint)`.
 */
export function subscribeOcclusionDirty(listener: () => void): void {
  dirtyListeners.add(listener)
}

/**
 * Announce a page change once per burst instead of once per mutation.
 *
 * `domDirty` is cleared at the end of the frame that probed, so every overlay in
 * that frame still sees it (see frame.ts `onFrameEnd`).
 */
function notifyDirty(): void {
  domDirty = true
  if (notifyTimer !== null) return
  notifyTimer = window.setTimeout(() => {
    notifyTimer = null
    for (const listener of [...dirtyListeners]) {
      try { listener() } catch { /* one faulty listener must not starve the others */ }
    }
  }, 200)
}

/** Watch the page so a newly mounted popup or card re-enables probing. */
function watchDom(): void {
  if (observer !== null || typeof MutationObserver !== 'function') return
  observer = new MutationObserver(() => {
    if (selfWrites > 0) return
    notifyDirty()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'open'],
  })
}

/**
 * Points sampled across the box. Corners plus center catch partial overlaps,
 * which a single corner probe misses — a menu that only covers the left half
 * of the composer leaves the top-left corner untouched.
 */
function probePoints(box: Box): Array<[number, number]> {
  return [
    [box.left + 6, box.top + 6],
    [box.left + box.width - 6, box.top + 6],
    [box.left + box.width / 2, box.top + box.height / 2],
    [box.left + box.width / 2, box.top + box.height - 6],
    [box.left + box.width - 6, box.top + box.height - 6],
  ]
}

/** Elements covering `box` that do not belong to `probe` (the composer). */
function coveringElements(box: Box, probe: Element | null): Element[] {
  const out: Element[] = []
  for (const [x, y] of probePoints(box)) {
    const hit = document.elementFromPoint(x, y)
    if (hit === null) continue
    if (probe !== null && probe.contains(hit)) continue
    out.push(hit)
  }
  const popup = document.querySelector(POPUP_SELECTOR)
  if (popup !== null) out.push(popup)
  return out
}

/**
 * The highest numeric z-index among elements covering `box`.
 *
 * Returns `null` when nothing covers the box, or when every cover is stacked
 * with `z-index: auto` — there is no surface to slide under in that case, so
 * callers keep their own default stacking.
 *
 * @param box - the overlay's target box, in viewport coordinates.
 * @param probe - the composer element the overlay belongs to; its descendants
 *   never count as covers.
 */
export function coveringZIndex(box: Box, probe: Element | null): number | null {
  let max = -1
  for (const el of coveringElements(box, probe)) {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    const overlaps =
      rect.right > box.left &&
      rect.left < box.left + box.width &&
      rect.bottom > box.top &&
      rect.top < box.top + box.height
    if (!overlaps) continue
    const z = Number.parseInt(window.getComputedStyle(el).zIndex, 10)
    if (Number.isFinite(z) && z > max) max = z
  }
  return max > 1 ? max : null
}

/**
 * Keep `el` behind whatever covers `box`.
 *
 * Two cases, because a cover is not always a popup:
 *
 * - the cover has a numeric z-index (menus, dialogs, poppers) — sit just below
 *   it, so the panel covers the hint exactly where they overlap and the hint
 *   keeps its place in the composer;
 * - the cover has no numeric z-index (an approval card rendered in normal flow
 *   above the composer) — there is no layer to slide under, so hide the hint
 *   softly: the node, its text and the tick stay alive, and the hint is back on
 *   the next paint after the cover goes away.
 *
 * The state is recomputed on every paint, which runs on a 250 ms tick and on
 * every viewport change, so both cases recover on their own.
 *
 * @param el - the overlay element to restack.
 * @param box - the box the overlay is drawn into, in viewport coordinates.
 * @param probe - the editor element the overlay belongs to; its content never
 *   counts as a cover.
 */
export function sitBelowCover(el: HTMLElement, box: Box, probe: Element | null): void {
  watchDom()
  // Off-screen box: nothing can be visible over it, so nothing to restack.
  const inViewport = box.top + box.height > 0 && box.top < window.innerHeight
  const wasCovered = coveredByOverlay.get(el) === true
  // Clean page and no cover last time: skip the hit tests entirely.
  if (!inViewport || (!domDirty && !wasCovered && document.querySelector(POPUP_SELECTOR) === null)) {
    el.style.zIndex = ''
    el.style.visibility = ''
    return
  }
  const covered = coveringElements(box, probe).some((el2) => intersects(box, el2))
  coveredByOverlay.set(el, covered)
  const z = covered ? coveringZIndex(box, probe) : null
  // Restyling our own node is not a page change: exempt it from the dirty count,
  // or this module would keep its own gate open forever.
  asSelfWrite(() => {
    if (!covered) {
      el.style.zIndex = ''
      el.style.visibility = ''
    } else if (z === null) {
      // A cover with no numeric z-index (an in-flow card) has no layer to slide
      // under, so the hint hides instead of floating over it.
      el.style.visibility = 'hidden'
    } else {
      el.style.zIndex = String(z - 1)
      el.style.visibility = ''
    }
  })
}

/** Whether `el`'s border box intersects `box`. */
function intersects(box: Box, el: Element): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  return (
    rect.right > box.left &&
    rect.left < box.left + box.width &&
    rect.bottom > box.top &&
    rect.top < box.top + box.height
  )
}
