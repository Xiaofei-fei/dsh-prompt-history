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
  /**
   * Parsed line height in px. The ghost must use the composer's line box, not the
   * caret rect's height: those differ (a 15px font can have a 25px line box and a
   * 20px caret), and forcing the caret height drops the ghost ~2px below the draft
   * baseline and condenses it (issue #12).
   */
  readonly lineHeight: number
}

let cached: { readonly element: Element | null; readonly style: TypeStyle } | null = null
let cachedLine: { readonly element: Element; readonly lineHeight: number } | null = null

/**
 * The type style for a composer card (or the editor host when it has no card).
 * @param element - the card element, or null to fall back to the document body.
 * @returns the cached style for that element.
 */
export function composerTypeStyle(element: Element | null): TypeStyle {
  if (cached !== null && cached.element === element) return cached.style
  const computed = window.getComputedStyle(element ?? document.body)
  const fontSize = Number.parseFloat(computed.fontSize) || 14
  const rawLine = Number.parseFloat(computed.lineHeight)
  const style: TypeStyle = {
    font: computed.font === '' ? 'inherit' : computed.font,
    letterSpacing: computed.letterSpacing,
    fontSize,
    // `line-height: normal` parses to NaN; 1.5em is the app's usual ratio.
    lineHeight: Number.isFinite(rawLine) && rawLine > 0 ? rawLine : fontSize * 1.5,
  }
  cached = { element, style }
  return style
}

/**
 * The **editor host's** line box height.
 *
 * The ghost mirrors the draft's text, so it must use the draft's line box — the
 * card's line height can differ from the editor's (a card style and an editor
 * style are separate declarations), and the caret rect's height differs from both
 * (issue #12). Cached per element, invalidated with the rest of the type cache.
 * @param element - the composer editor host.
 * @returns the computed line height in px (1.5em when it computes to normal).
 */
export function editorLineHeight(element: Element): number {
  if (cachedLine !== null && cachedLine.element === element) return cachedLine.lineHeight
  const computed = window.getComputedStyle(element)
  const size = Number.parseFloat(computed.fontSize) || 14
  const raw = Number.parseFloat(computed.lineHeight)
  const lineHeight = Number.isFinite(raw) && raw > 0 ? raw : size * 1.5
  cachedLine = { element, lineHeight }
  return lineHeight
}

/** Drop the caches (zoom, theme or window changes move the computed metrics). */
export function invalidateTypeStyle(): void {
  cached = null
  cachedLine = null
}
