/**
 * Settings-nav icon for dsh-prompt-history. The settings shell keys nav
 * glyphs by section id and falls back to a generic gear for unknown ids, so
 * this replaces the gear in OUR nav cell with a terminal `>_` glyph: the
 * shell's <svg> is hidden and a styled glyph span is injected. React
 * re-renders (locale switch, active-state) drop the injected span, so a
 * MutationObserver re-applies the patch while the settings dialog is open.
 */

/** Class of the injected glyph span (also the style-tag data key). */
const GLYPH_CLASS = 'dsh-ph-nav-glyph'

/** Glyph styles: 16x16 to match the shell's nav-icon slot (flex + 8px gap). */
const GLYPH_CSS = [
  `.${GLYPH_CLASS}{display:inline-flex;flex:none;align-items:center;justify-content:center;`,
  'width:16px;height:16px;font:600 11px/1 ui-monospace,"SF Mono",Consolas,monospace;',
  'color:var(--dsw-alias-label-secondary);letter-spacing:-0.5px;}',
].join('')

/** Our section's nav label in every shipped locale (exact match). */
const NAV_LABELS = new Set(['终端式输入', 'Terminal Input'])

/** Hide the shell's gear <svg> and inject the `>_` glyph (idempotent). */
function patchCell(cell: HTMLButtonElement): void {
  if (cell.querySelector(`.${GLYPH_CLASS}`) !== null) return
  const svg = cell.querySelector('svg')
  if (svg !== null) svg.style.display = 'none'
  const glyph = document.createElement('span')
  glyph.className = GLYPH_CLASS
  glyph.textContent = '>_'
  glyph.setAttribute('aria-hidden', 'true')
  cell.insertBefore(glyph, cell.firstChild)
}

/** Find our settings-nav cell inside an open dialog, if any. */
function findOurCell(): HTMLButtonElement | null {
  const dialog = document.querySelector('[role="dialog"]')
  if (dialog === null) return null
  for (const cell of dialog.querySelectorAll('button')) {
    const label = cell.querySelector(':scope > span')
    if (label !== null && NAV_LABELS.has((label.textContent ?? '').trim())) return cell as HTMLButtonElement
  }
  return null
}

/** Install the stylesheet + re-patch observer once (idempotent). */
export function installNavGlyph(): void {
  if (document.querySelector(`style[data-plugin-css="${GLYPH_CLASS}"]`) === null) {
    const tag = document.createElement('style')
    tag.dataset.pluginCss = GLYPH_CLASS
    tag.textContent = GLYPH_CSS
    document.head.appendChild(tag)
  }
  const observer = new MutationObserver(() => {
    const cell = findOurCell()
    if (cell !== null) patchCell(cell)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  // Settings could already be open (hot plugin re-registration): patch now.
  const cell = findOurCell()
  if (cell !== null) patchCell(cell)
}
