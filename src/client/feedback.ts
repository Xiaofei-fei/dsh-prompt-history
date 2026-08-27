/**
 * Transient DOM feedback for dsh-prompt-history: the "已复制" pill and the
 * floating copy toolbar shown above a selection in 'toolbar' copy mode.
 * Vanilla DOM (no React) so both can be driven from event handlers.
 */

/** Copy the current document selection via execCommand, clipboard API fallback. */
function copyDocumentSelection(): boolean {
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  if (ok) return true
  const sel = document.getSelection()
  const text = sel !== null && !sel.isCollapsed ? sel.toString() : ''
  if (text === '') return false
  navigator.clipboard.writeText(text).catch((error) => {
    console.warn('[dsh-prompt-history] clipboard copy failed:', error)
  })
  return true
}

/** A brief "已复制" pill above the given rect (or the top-left corner). */
export function flashCopied(rect?: DOMRect | null): void {
  let x = 8
  let y = 8
  if (rect !== undefined && rect !== null && (rect.width > 0 || rect.height > 0)) {
    x = Math.max(4, Math.min(rect.left, window.innerWidth - 90))
    y = Math.max(4, rect.top - 26)
  }
  const pill = document.createElement('div')
  pill.textContent = '已复制'
  pill.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:2147483000;` +
    'padding:3px 8px;border-radius:6px;pointer-events:none;' +
    'background:var(--dsw-specific-tip);border:1px solid var(--dsw-alias-border-l1);' +
    'color:var(--dsw-alias-label-primary);font:12px system-ui,sans-serif;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.2);'
  document.body.appendChild(pill)
  window.setTimeout(() => { pill.remove() }, 800)
}

const BAR_CLASS = 'dsh-ph-toolbar'
let bar: HTMLDivElement | null = null

function ensureToolbarStyle(): void {
  if (document.querySelector('style[data-plugin-css="dsh-ph-toolbar"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.pluginCss = 'dsh-ph-toolbar'
  tag.textContent = [
    `.${BAR_CLASS}{position:fixed;z-index:2147483000;display:flex;align-items:center;padding:4px;`,
    'border-radius:8px;background:var(--dsw-specific-menu);',
    'border:1px solid var(--dsw-alias-border-l1);box-shadow:0 4px 16px rgba(0,0,0,.25);}',
    `.${BAR_CLASS} button{border:0;border-radius:6px;padding:4px 12px;font-size:12px;line-height:1.4;cursor:pointer;`,
    'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
    `.${BAR_CLASS} button:hover{background:var(--dsw-alias-bg-layer-3);}`,
  ].join('')
  document.head.appendChild(tag)
}

/** Hide the copy toolbar (idempotent). */
export function hideSelectionToolbar(): void {
  if (bar !== null) {
    bar.remove()
    bar = null
  }
}

/**
 * Show the floating copy toolbar above the selection rect. Clicking 复制 copies
 * the current document selection and flashes the copied pill; mousedown is
 * suppressed so the selection survives the click.
 * @param rect - the selection's bounding rect (toolbar sits above it).
 */
export function showSelectionToolbar(rect: DOMRect): void {
  ensureToolbarStyle()
  hideSelectionToolbar()
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '复制'
  button.addEventListener('mousedown', (e) => { e.preventDefault() }) // keep the selection
  button.addEventListener('click', () => {
    const copied = copyDocumentSelection()
    hideSelectionToolbar()
    if (copied) flashCopied(rect)
  })
  const el = document.createElement('div')
  el.className = BAR_CLASS
  el.appendChild(button)
  const W = 64
  const H = 30
  const x = Math.max(4, Math.min(rect.left + rect.width / 2 - W / 2, window.innerWidth - W - 4))
  const y = Math.max(4, rect.top - H - 4)
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  document.body.appendChild(el)
  bar = el
}
