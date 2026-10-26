/**
 * The composer's type style, cached.
 *
 * Both ghosts copy the composer card's font so they sit exactly on its
 * baseline. Reading it with `getComputedStyle` is a forced style recalc, and the
 * overlays repaint on every coalesced frame — so the read is cached per card
 * element and invalidated when the viewport (and therefore zoom/theme metrics)
 * changes.
 *
 * @module dsh-prompt-history/client/typeStyle
 */
export interface TypeStyle {
  /** The card's `font` shorthand, or `inherit` when it has none. */
  readonly font: string
  readonly letterSpacing: string
  /** Parsed font size in px, for the smaller hint line. */
  readonly fontSize: number
}

let cached: { readonly element: Element | null; readonly style: TypeStyle } | null = null

/**
 * The type style for a composer card (or the editor host when it has no card).
 * @param element - the card element, or null to fall back to the document body.
 * @returns the cached style for that element.
 */
export function composerTypeStyle(element: Element | null): TypeStyle {
  if (cached !== null && cached.element === element) return cached.style
  const computed = window.getComputedStyle(element ?? document.body)
  const style: TypeStyle = {
    font: computed.font === '' ? 'inherit' : computed.font,
    letterSpacing: computed.letterSpacing,
    fontSize: Number.parseFloat(computed.fontSize) || 14,
  }
  cached = { element, style }
  return style
}

/** Drop the cache (zoom, theme or window changes move the computed metrics). */
export function invalidateTypeStyle(): void {
  cached = null
}
