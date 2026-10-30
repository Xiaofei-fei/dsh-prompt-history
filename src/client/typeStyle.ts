/**
 * The composer's type style, cached.
 *
 * Both ghosts mirror the composer's **editor** type so they sit in the same slot
 * the placeholder occupies. The editor is the element that matters: a theme can
 * style the card and the editor separately (dsh-claude-style sets the card to
 * 15px and the editor to 14px), and reading the card produced a 15px prediction
 * in a 24px line box (issue #17).
 *
 * Reading it with `getComputedStyle` is a forced style recalc, and the overlays
 * repaint on every coalesced frame — so the read is cached per element and
 * invalidated when the viewport (and therefore zoom/theme metrics) changes.
 *
 * @module dsh-prompt-history/client/typeStyle
 */
export interface TypeStyle {
  /**
   * Individual longhands, never the `font` shorthand: the shorthand resets
   * font-style/weight/line-height, and writing it inline locks the overlay's
   * typography away from both inheritance and theme overrides (issue #17).
   */
  readonly fontFamily: string
  readonly fontWeight: string
  readonly fontStyle: string
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
    fontFamily: computed.fontFamily === '' ? 'inherit' : computed.fontFamily,
    fontWeight: computed.fontWeight === '' ? 'inherit' : computed.fontWeight,
    fontStyle: computed.fontStyle === '' ? 'normal' : computed.fontStyle,
    letterSpacing: computed.letterSpacing,
    fontSize,
    // `line-height: normal` parses to NaN; 1.5em is the app's usual ratio.
    lineHeight: Number.isFinite(rawLine) && rawLine > 0 ? rawLine : fontSize * 1.5,
  }
  cached = { element, style }
  return style
}

/**
 * Publish a type style on an overlay node as CSS custom properties.
 *
 * The node lives on `document.body`, outside the composer subtree, so it cannot
 * inherit the editor's type. Between "inline everything" (what the overlays used
 * to do, unreachable from a theme) and "inherit nothing", the middle ground is:
 * our stylesheet reads these variables, and a theme rule targeting the overlay
 * simply outranks that rule — the typography stays theme-able (issue #17).
 * @param element - the overlay node.
 * @param style - the editor's type style.
 * @param lineHeight - the line box to occupy, in px.
 */
export function applyTypeVariables(element: HTMLElement, style: TypeStyle, lineHeight: number): void {
  element.style.setProperty('--dsh-ph-font-family', style.fontFamily)
  element.style.setProperty('--dsh-ph-font-weight', style.fontWeight)
  element.style.setProperty('--dsh-ph-font-style', style.fontStyle)
  element.style.setProperty('--dsh-ph-font-size', `${style.fontSize}px`)
  element.style.setProperty('--dsh-ph-letter-spacing', style.letterSpacing)
  element.style.setProperty('--dsh-ph-line-height', `${lineHeight}px`)
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

const styleListeners = new Set<() => void>()
let watchInstalled = false

/**
 * Watch for theme changes.
 *
 * A theme switch is an attribute change on `<html>`/`<body>` or a stylesheet swap
 * in `<head>`; none of those fire `resize`, so the cached type style would keep
 * serving the previous theme's metrics (issue #17). Registered lazily because the
 * overlays are the only consumers.
 */
function watchThemeChanges(): void {
  if (watchInstalled || typeof MutationObserver !== 'function') return
  watchInstalled = true
  const observer = new MutationObserver(() => {
    invalidateTypeStyle()
    for (const listener of [...styleListeners]) {
      try { listener() } catch { /* one faulty listener must not starve the others */ }
    }
  })
  observer.observe(document.documentElement, { attributes: true, childList: false })
  observer.observe(document.body, { attributes: true, childList: false })
  observer.observe(document.head, { childList: true })
}

/**
 * Subscribe to theme/type changes.
 * @param listener - usually `() => scheduleFrame(paint)`.
 * @returns disposer removing the listener.
 */
export function subscribeTypeStyle(listener: () => void): () => void {
  watchThemeChanges()
  styleListeners.add(listener)
  return () => { styleListeners.delete(listener) }
}

/** Drop the caches (zoom, theme or window changes move the computed metrics). */
export function invalidateTypeStyle(): void {
  cached = null
  cachedLine = null
}
