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
    'border-radius:8px;background:var(--dsw-alias-bg-layer-1);',
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
 * the current document selection; 引用 hands the selection to the caller for
 * insertion into the composer as a quote; 侧聊 sends it to the side chat.
 * Mousedown is suppressed so the selection survives the click.
 * @param rect - the selection's bounding rect (toolbar sits above it).
 * @param onQuote - quote handler; renders the 引用 button only when provided.
 * @param onSideChat - side-chat handler; renders the 侧聊 button only when provided.
 */
export function showSelectionToolbar(rect: DOMRect, onQuote?: () => void, onSideChat?: () => void): void {
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
  if (onSideChat !== undefined) {
    const sideButton = document.createElement('button')
    sideButton.type = 'button'
    sideButton.textContent = T('toolbar.sideChat')
    sideButton.addEventListener('mousedown', (e) => { e.preventDefault() }) // keep the selection
    sideButton.addEventListener('click', () => {
      hideSelectionToolbar()
      onSideChat()
    })
    el.appendChild(sideButton)
  }
  const W = 56 + (onQuote !== undefined ? 52 : 0) + (onSideChat !== undefined ? 52 : 0)
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
    'background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);' +
    'color:var(--dsw-alias-label-primary);font:12px ui-monospace,SFMono-Regular,Consolas,monospace;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
  q.style.cssText = 'color:var(--dsw-static-blue-900);'
  document.body.appendChild(el)
  searchBar = el
}

/** Class of the quote comment panel. */
const COMPOSER_CLASS = 'dsh-ph-qc'
let composer: HTMLDivElement | null = null

/** Styles for the comment panel and the source-row flash. */
function ensureComposerStyle(): void {
  if (document.querySelector('style[data-plugin-css="dsh-ph-qc"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.pluginCss = 'dsh-ph-qc'
  tag.textContent = [
    `.${COMPOSER_CLASS}{position:fixed;z-index:2147483000;box-sizing:border-box;width:360px;display:flex;`,
    'flex-direction:column;gap:8px;padding:10px;border-radius:10px;',
    'background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);',
    'box-shadow:0 8px 28px rgba(0,0,0,.28);font:12px system-ui,sans-serif;}',
    `.${COMPOSER_CLASS}-preview{max-height:72px;overflow:auto;padding:6px 8px;border-radius:6px;`,
    'white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-1);',
    'color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l1);}',
    `.${COMPOSER_CLASS} textarea{box-sizing:border-box;width:100%;min-height:56px;max-height:160px;resize:vertical;`,
    'padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);',
    'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:12px/1.5 system-ui,sans-serif;}',
    `.${COMPOSER_CLASS}-row{display:flex;align-items:center;gap:8px;}`,
    `.${COMPOSER_CLASS}-row label{display:flex;align-items:center;gap:6px;flex:1;color:var(--dsw-alias-label-secondary);cursor:pointer;}`,
    `.${COMPOSER_CLASS}-row button{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 10px;`,
    'font-size:12px;cursor:pointer;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
    `.${COMPOSER_CLASS}-row button[data-primary]{background:var(--dsw-alias-label-primary);`,
    'color:var(--dsw-alias-bg-layer-1);border-color:transparent;}',
    '.dsh-ph-qflash{animation:dsh-ph-qflash 1.2s ease-out;}',
    '@keyframes dsh-ph-qflash{0%{outline:2px solid var(--dsw-alias-label-primary);outline-offset:2px;}',
    '100%{outline:2px solid transparent;outline-offset:2px;}}',
  ].join('')
  document.head.appendChild(tag)
}

/**
 * Ask for a comment on the selected quote.
 *
 * Resolves with the comment (possibly empty) and the per-quote reply flag, or
 * null when the user cancelled — the caller must not insert anything then.
 * @param rect - the selection rectangle, for placement.
 * @param preview - the selected text, shown read-only above the input.
 * @param defaultPerItem - initial state of the reply-per-quote checkbox.
 * @returns the comment result, or null.
 */
export function showQuoteComposer(
  rect: DOMRect,
  preview: string,
  defaultPerItem: boolean,
): Promise<{ comment: string; perItem: boolean } | null> {
  ensureComposerStyle()
  composer?.remove()
  return new Promise((resolve) => {
    const panel = document.createElement('div')
    panel.className = COMPOSER_CLASS
    const head = document.createElement('div')
    head.className = `${COMPOSER_CLASS}-preview`
    head.textContent = preview
    const input = document.createElement('textarea')
    input.placeholder = T('quote.commentPlaceholder')
    const row = document.createElement('div')
    row.className = `${COMPOSER_CLASS}-row`
    const label = document.createElement('label')
    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = defaultPerItem
    label.append(check, document.createTextNode(T('quote.perItem')))
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = T('quote.cancel')
    const submit = document.createElement('button')
    submit.type = 'button'
    submit.dataset.primary = '1'
    submit.textContent = T('quote.submit')
    row.append(label, cancel, submit)
    panel.append(head, input, row)
    document.body.appendChild(panel)
    composer = panel

    // Place above the selection when there is room, below otherwise.
    const width = 360
    const height = panel.offsetHeight
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 4))
    const above = rect.top - height - 8
    panel.style.left = `${left}px`
    panel.style.top = `${above >= 4 ? above : Math.min(rect.bottom + 8, window.innerHeight - height - 4)}px`
    input.focus()

    const close = (value: { comment: string; perItem: boolean } | null): void => {
      document.removeEventListener('mousedown', onOutside, true)
      panel.remove()
      if (composer === panel) composer = null
      resolve(value)
    }
    const commit = (): void => { close({ comment: input.value, perItem: check.checked }) }
    const onOutside = (event: MouseEvent): void => {
      if (!panel.contains(event.target as Node)) close(null)
    }
    cancel.addEventListener('click', () => { close(null) })
    submit.addEventListener('click', commit)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(null); return }
      // Enter submits; Shift+Enter keeps the newline for a multi-line comment.
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commit() }
    })
    // Give the click that opened the panel time to settle before watching for a
    // click outside it.
    setTimeout(() => { document.addEventListener('mousedown', onOutside, true) }, 0)
  })
}

/**
 * Bring the quoted row into view and flash it, so the user sees where the quote
 * came from.
 * @param row - the conversation row the selection started in.
 */
export function flashQuoteRow(row: HTMLElement | null): void {
  if (row === null) return
  try {
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    row.classList.remove('dsh-ph-qflash')
    // Reflow so a second quote of the same row replays the animation.
    void row.offsetWidth
    row.classList.add('dsh-ph-qflash')
    window.setTimeout(() => { row.classList.remove('dsh-ph-qflash') }, 1300)
  } catch {
    // A detached row (virtualized list) simply gets no flash.
  }
}
