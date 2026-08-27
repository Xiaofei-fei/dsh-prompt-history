/**
 * Transient DOM feedback for dsh-prompt-history: the copied pill and the
 * floating copy toolbar shown above a selection in 'toolbar' copy mode.
 * Vanilla DOM (no React) so both can be driven from event handlers.
 */
import { T } from './i18n.ts'

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

/** A brief feedback pill (已复制 / 已引用 …) above the given rect. */
export function flashCopied(rect?: DOMRect | null, text?: string): void {
  const label = text ?? T('pill.copied')
  let x = 8
  let y = 8
  if (rect !== undefined && rect !== null && (rect.width > 0 || rect.height > 0)) {
    x = Math.max(4, Math.min(rect.left, window.innerWidth - 90))
    y = Math.max(4, rect.top - 26)
  }
  const pill = document.createElement('div')
  pill.textContent = label
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
 * Show the floating selection toolbar above the selection rect: 复制 copies
 * the current document selection; 引用 (when a handler is given) hands the
 * selection to the caller for insertion into the composer as a quote. Mousedown
 * is suppressed so the selection survives the click.
 * @param rect - the selection's bounding rect (toolbar sits above it).
 * @param onQuote - quote handler; renders the 引用 button only when provided.
 */
export function showSelectionToolbar(rect: DOMRect, onQuote?: () => void): void {
  ensureToolbarStyle()
  hideSelectionToolbar()
  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.textContent = T('toolbar.copy')
  copyButton.addEventListener('mousedown', (e) => { e.preventDefault() }) // keep the selection
  copyButton.addEventListener('click', () => {
    const copied = copyDocumentSelection()
    hideSelectionToolbar()
    if (copied) flashCopied(rect)
  })
  const el = document.createElement('div')
  el.className = BAR_CLASS
  el.appendChild(copyButton)
  if (onQuote !== undefined) {
    const quoteButton = document.createElement('button')
    quoteButton.type = 'button'
    quoteButton.textContent = T('toolbar.quote')
    quoteButton.addEventListener('mousedown', (e) => { e.preventDefault() }) // keep the selection
    quoteButton.addEventListener('click', () => {
      hideSelectionToolbar()
      onQuote()
    })
    el.appendChild(quoteButton)
  }
  const W = onQuote !== undefined ? 116 : 64
  const H = 30
  const x = Math.max(4, Math.min(rect.left + rect.width / 2 - W / 2, window.innerWidth - W - 4))
  const y = Math.max(4, rect.top - H - 4)
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  document.body.appendChild(el)
  bar = el
}

// ---- reverse-search overlay (Ctrl+R) ----

const SEARCH_CLASS = 'dsh-ph-search'
let searchBar: HTMLDivElement | null = null

/** Hide the reverse-search prompt bar (idempotent). */
export function hideSearchOverlay(): void {
  if (searchBar !== null) {
    searchBar.remove()
    searchBar = null
  }
}

/**
 * Show the bash-style reverse-search prompt above the composer card:
 * `(reverse-i-search)`query': match-preview`. Display-only (pointer-events
 * none), so it never interferes with the input underneath.
 */
export function showSearchOverlay(query: string, match: string): void {
  hideSearchOverlay()
  const card = document.querySelector('[data-composer-card]')
  const cardRect = card instanceof HTMLElement ? card.getBoundingClientRect() : null
  const el = document.createElement('div')
  el.className = SEARCH_CLASS
  const q = document.createElement('span')
  q.className = 'dsh-ph-search-q'
  q.textContent = query
  const m = document.createElement('span')
  m.className = 'dsh-ph-search-m'
  m.textContent = match.length > 64 ? `${match.slice(0, 64)}…` : match
  el.append('(reverse-i-search)`')
  el.append(q)
  el.append("': ")
  el.append(m)
  el.style.cssText = 'position:fixed;z-index:2147483000;pointer-events:none;' +
    'left:50%;transform:translateX(-50%);' +
    `top:${cardRect !== null ? Math.max(4, cardRect.top - 34) : 8}px;` +
    'max-width:min(640px, calc(100vw - 24px));padding:5px 12px;border-radius:8px;' +
    'background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l1);' +
    'color:var(--dsw-alias-label-primary);font:12px ui-monospace,SFMono-Regular,Consolas,monospace;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
  q.style.cssText = 'color:var(--dsw-static-blue-900);'
  document.body.appendChild(el)
  searchBar = el
}
