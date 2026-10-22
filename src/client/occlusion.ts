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
 * Keep `el` just below whatever covers `box`, or on its stylesheet default when
 * nothing does.
 *
 * The offset is recomputed on every paint, which runs on a 250 ms tick and on
 * every viewport change, so the overlay returns to its normal layer as soon as
 * the popup closes.
 *
 * @param el - the overlay element to restack.
 * @param box - the box the overlay is drawn into, in viewport coordinates.
 * @param probe - the composer element the overlay belongs to.
 */
export function sitBelowCover(el: HTMLElement, box: Box, probe: Element | null): void {
  const z = coveringZIndex(box, probe)
  el.style.zIndex = z === null ? '' : String(z - 1)
}
