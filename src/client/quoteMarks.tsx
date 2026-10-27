/**
 * Codex-style quote marks for dsh-prompt-history.
 *
 * 引用 used to be pasted straight into the composer as a markdown blockquote,
 * so the input box filled up with quoted text the user then had to scroll past.
 * This module keeps quotes OUT of the draft instead, the way Codex does it:
 *
 * - Every 引用 becomes one numbered entry in a per-session store.
 * - A card above the composer lists the entries (number, text, edit, delete),
 *   collapsed to a "N 条注" pill until it is hovered, clicked or focused, and a
 *   matching badge is painted over the transcript text the quote came from.
 * - The draft stays empty. The quotes are prepended to the message by a hook on
 *   the composer shell's submit(), which Enter, the send button and the
 *   keyboard shortcut all go through.
 * - In the transcript, the leading "> ..." blocks of a sent user message are
 *   rendered as a "N 条注释" pill (a user-text rule plus a node renderer)
 *   instead of raw blockquote text.
 *
 * The submit hook never trusts the insertion API's return value: draft writes
 * go through captureInsertion()/insertText(), which reports success for spans
 * it merely mapped, so the hook re-reads the shell snapshot and only sends once
 * the quotes are actually in the draft - falling back to setDraft(), and
 * deferring one microtask when the editor has not published the write yet. A
 * quote that cannot be verified keeps its entry instead of vanishing silently.
 *
 * @module dsh-prompt-history/client/quoteMarks
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { COMPOSER_CARD } from './editor.ts'
import { T } from './i18n.ts'

/** Where in the transcript a quote came from (element + text offsets). */
export interface QuoteAnchor {
  /** Element that held the selection when the quote was taken. */
  readonly element: Element
  /** Offset of the selection start inside the element's textContent. */
  readonly start: number
  /** Offset of the selection end inside the element's textContent. */
  readonly end: number
}

/** One queued quote. */
export interface QuoteEntry {
  /** Stable identity, used by the card's per-row actions. */
  readonly id: number
  /** Display number (1-based, renumbered on every change). */
  readonly n: number
  /** Quoted text as the user selected it. */
  readonly text: string
  /** Transcript anchor for the badge, null when the quote came from elsewhere. */
  readonly anchor: QuoteAnchor | null
}

/** One session's quote list. */
interface QuoteStore {
  entries: QuoteEntry[]
  readonly listeners: Set<() => void>
  seq: number
}

/** Per-session stores, keyed by session id. */
const stores = new Map<string, QuoteStore>()
/** Session-less callers share one store. */
const FALLBACK_SESSION = ''

/** Key of a session id in the store map. */
function storeKey(sessionId: string | undefined): string {
  return sessionId ?? FALLBACK_SESSION
}

/** The store of one session, created on first use. */
function storeFor(sessionId: string | undefined): QuoteStore {
  const key = storeKey(sessionId)
  let store = stores.get(key)
  if (store === undefined) {
    store = { entries: [], listeners: new Set(), seq: 0 }
    stores.set(key, store)
  }
  return store
}

/** Publish a change to every mounted overlay of the session. */
function emit(store: QuoteStore): void {
  for (const listener of [...store.listeners]) {
    try {
      listener()
    } catch {
      // A broken listener must not block the others.
    }
  }
}

/** Renumber entries 1..n in place (display numbers follow the list order). */
function renumber(entries: readonly QuoteEntry[]): QuoteEntry[] {
  return entries.map((entry, index) => entry.n === index + 1 ? entry : { ...entry, n: index + 1 })
}

/** Subscribe to one session's quote list; returns the unsubscribe function. */
export function subscribeQuotes(sessionId: string | undefined, listener: () => void): () => void {
  const store = storeFor(sessionId)
  store.listeners.add(listener)
  return () => { store.listeners.delete(listener) }
}

/** The session's quote list (identity-stable between changes). */
export function quoteEntries(sessionId: string | undefined): readonly QuoteEntry[] {
  return storeFor(sessionId).entries
}

/** Replace the whole list (renumbered, published). */
function setEntries(sessionId: string | undefined, entries: readonly QuoteEntry[]): void {
  const store = storeFor(sessionId)
  store.entries = renumber(entries)
  emit(store)
}

/** Append one quote and return it. */
export function addQuoteEntry(
  sessionId: string | undefined,
  text: string,
  anchor: QuoteAnchor | null,
): QuoteEntry {
  const store = storeFor(sessionId)
  store.seq += 1
  const entry: QuoteEntry = { id: store.seq, n: store.entries.length + 1, text, anchor }
  store.entries = [...store.entries, entry]
  emit(store)
  return entry
}

/** Drop one quote (the card's delete button). */
export function removeQuoteEntry(sessionId: string | undefined, entry: QuoteEntry): void {
  setEntries(sessionId, quoteEntries(sessionId).filter((item) => item.id !== entry.id))
}

/** Drop every quote (the card's x pill). */
export function clearQuotes(sessionId: string | undefined): void {
  setEntries(sessionId, [])
}

/** Rewrite one quote's text (the card's edit button). */
export function editQuoteEntry(sessionId: string | undefined, entry: QuoteEntry, text: string): void {
  setEntries(sessionId, quoteEntries(sessionId).map((item) => item.id === entry.id ? { ...item, text } : item))
}

/** One quote as a markdown blockquote (each line prefixed with '> '). */
function blockquote(text: string): string {
  return '> ' + text.replace(/\n/g, '\n> ')
}

/** The draft prefix a message gets: every quote, blocks separated by a blank line. */
export function quotePayload(entries: readonly QuoteEntry[]): string {
  let payload = ''
  for (const entry of entries) payload += blockquote(entry.text) + '\n\n'
  return payload
}

/** The composer shell's action face, as far as quotes need it. */
interface QuoteShellActions {
  captureInsertion?: () => { readonly draftRev?: number } | undefined
  insertText?: (text: string, span: unknown) => boolean
}

/** The composer shell the UI submits through (ConversationInputShell). */
interface QuoteShell {
  readonly snapshot?: { readonly draft?: string } | undefined
  readonly actions?: QuoteShellActions | undefined
  setDraft?: (text: string) => void
  publish?: () => void
  submit: (mode?: string, source?: string) => unknown
}

/** Duck-type check for a composer shell. */
function isShell(value: unknown): value is QuoteShell {
  if (value === null || typeof value !== 'object') return false
  return typeof (value as { submit?: unknown }).submit === 'function'
}

/** The plugin context, bound from apply() so the conversation service is reachable. */
let pluginContext: ClientContext | undefined

/** Remember the plugin context (called once from apply). */
export function bindQuoteContext(ctx: ClientContext): void {
  pluginContext = ctx
}

/** The React fiber React parks on a DOM node (internal key, prefixed). */
interface FiberLike {
  readonly memoizedProps?: unknown
  readonly return?: FiberLike | null
}

/** Read the fiber of a DOM node. */
function fiberOf(node: Element): FiberLike | null {
  const record = node as unknown as Record<string, FiberLike | undefined>
  for (const key of Object.keys(record)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) return record[key] ?? null
  }
  return null
}

/**
 * Last-resort shell lookup: the composer card's own props carry the shell
 * ('keyboard') the InputBar submits through. Only used when the service lookup
 * fails, because a missing hook silently drops every quote.
 */
function shellFromDom(): QuoteShell | null {
  const card = document.querySelector(COMPOSER_CARD)
  if (card === null) return null
  let fiber = fiberOf(card)
  for (let guard = 0; fiber !== null && guard < 300; guard += 1) {
    const props = fiber.memoizedProps
    if (props !== null && typeof props === 'object') {
      const candidate = (props as { keyboard?: unknown }).keyboard
      if (isShell(candidate) && candidate.actions !== undefined) return candidate
    }
    fiber = fiber.return ?? null
  }
  return null
}

/** The composer shell of one session. */
function shellFor(sessionId: string | undefined): QuoteShell | null {
  const dom = shellFromDom()
  if (dom !== null) return dom
  const ctx = pluginContext
  if (ctx === undefined) return null
  let conversation: unknown
  try {
    conversation = (ctx as unknown as { get: (name: string) => unknown }).get('conversation')
  } catch {
    return null
  }
  const input = (conversation as { input?: { shell?: (id: string) => unknown } } | undefined)?.input
  if (input === undefined || typeof input.shell !== 'function') return null
  try {
    const shell = input.shell(storeKey(sessionId))
    return isShell(shell) ? shell : null
  } catch {
    return null
  }
}

/** Shells whose submit() is already wrapped. */
const hookedShells = new WeakSet<QuoteShell>()

/** Text the shell will actually send (submit reads its snapshot). */
function snapshotText(shell: QuoteShell): string {
  try {
    const draft = shell.snapshot?.draft
    return typeof draft === 'string' ? draft : ''
  } catch {
    return ''
  }
}

/** Ask the shell to re-compose its published snapshot (best effort). */
function flush(shell: QuoteShell): void {
  try {
    shell.publish?.()
  } catch {
    // publish() is private to the shell; the editor catches up on its own.
  }
}

/**
 * Wrap the shell's submit() once so queued quotes land in the draft before the
 * message is built.
 *
 * insertText() reports success for spans it only mapped, so the write is
 * verified against the live snapshot; an unverified write falls back to
 * setDraft() and then one microtask, after which the draft is checked again.
 * Entries are cleared only once the quotes are verified in the draft, so a
 * failed injection keeps the card instead of dropping the user's text.
 */
export function ensureSendHook(sessionId: string | undefined): void {
  const shell = shellFor(sessionId)
  if (shell === null || hookedShells.has(shell)) return
  const original = shell.submit
  hookedShells.add(shell)
  shell.submit = function submitWithQuotes(this: QuoteShell, mode?: string, source?: string): unknown {
    const entries = quoteEntries(sessionId)
    if (entries.length === 0) return original.call(this, mode, source)
    const payload = quotePayload(entries)
    if (payload === '') return original.call(this, mode, source)
    const target = payload + snapshotText(this)
    const hasPayload = (): boolean => snapshotText(this).indexOf(payload) === 0
    const writeDraft = (): void => {
      try {
        this.setDraft?.(target)
      } catch {
        // Leave the entries in place; the card still shows them.
      }
      flush(this)
    }
    try {
      const actions = this.actions
      const insertion = actions?.captureInsertion?.()
      if (actions?.insertText !== undefined && insertion !== undefined) {
        actions.insertText(payload, { start: 0, end: 0, draftRev: insertion.draftRev })
      }
    } catch {
      // Fall through to the verified draft write below.
    }
    if (!hasPayload()) writeDraft()
    if (hasPayload()) {
      setEntries(sessionId, [])
      return original.call(this, mode, source)
    }
    void Promise.resolve().then(() => {
      if (!hasPayload()) writeDraft()
      if (hasPayload()) setEntries(sessionId, [])
      original.call(this, mode, source)
    })
    return undefined
  }
}

/** Text offset of a DOM point inside its closest element (for anchors). */
function textOffsetIn(element: Element, node: Node, offset: number): number {
  let total = 0
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current !== null && current !== node) {
    total += current.textContent?.length ?? 0
    current = walker.nextNode()
  }
  if (node.nodeType === Node.TEXT_NODE) total += offset
  else if (current === null && node === element) total = 0
  return total
}

/** Where the current selection sits, as an element + text offsets. */
export function selectionAnchor(): QuoteAnchor | null {
  const selection = document.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const node = range.commonAncestorContainer
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (element === null || element.closest(COMPOSER_CARD) !== null) return null
  return { element, start: textOffsetIn(element, range.startContainer, range.startOffset), end: textOffsetIn(element, range.endContainer, range.endOffset) }
}

/** Rebuild a DOM range for an anchor, null when the element is gone. */
function rangeForAnchor(anchor: QuoteAnchor | null): Range | null {
  if (anchor === null) return null
  const element = anchor.element
  if (!element.isConnected) return null
  const range = document.createRange()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let startNode: Node | null = null
  let endNode: Node | null = null
  let startOffset = 0
  let endOffset = 0
  let current = walker.nextNode()
  while (current !== null) {
    const length = current.textContent?.length ?? 0
    if (startNode === null && consumed + length >= anchor.start) {
      startNode = current
      startOffset = anchor.start - consumed
    }
    if (endNode === null && consumed + length >= anchor.end) {
      endNode = current
      endOffset = anchor.end - consumed
      break
    }
    consumed += length
    current = walker.nextNode()
  }
  if (startNode === null || endNode === null) return null
  range.setStart(startNode, Math.max(0, Math.min(startOffset, startNode.textContent?.length ?? 0)))
  range.setEnd(endNode, Math.max(0, Math.min(endOffset, endNode.textContent?.length ?? 0)))
  return range
}

/** Stylesheet key of the quote card + badges. */
const QUOTE_STYLE_ID = 'dsh-ph-quote-marks'

/** The section's own CSS: card, pill, badges, and the transcript pill. */
const QUOTE_CSS = [
  '.dsh-ph-quote-host{position:fixed;left:0;bottom:0;width:0;z-index:2147482000;display:none;pointer-events:none;font:12px/1.5 system-ui,sans-serif;}',
  '.dsh-ph-quote-host[data-open="1"]{display:block;}',
  '.dsh-ph-quote-card{display:none;pointer-events:auto;width:100%;min-width:280px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.16);padding:10px 12px;max-height:46vh;overflow:auto;color:var(--dsw-alias-label-primary,#1f2328);}',
  '.dsh-ph-quote-host[data-show="1"] .dsh-ph-quote-card{display:block;}',
  '.dsh-ph-quote-row{display:flex;align-items:flex-start;gap:8px;padding:2px 0;}',
  '.dsh-ph-quote-row+.dsh-ph-quote-row{border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));margin-top:6px;padding-top:8px;}',
  '.dsh-ph-quote-no{flex:0 0 auto;color:var(--dsw-alias-label-tertiary,#8b949e);font-variant-numeric:tabular-nums;padding-top:1px;}',
  '.dsh-ph-quote-body{flex:1 1 auto;min-width:0;}',
  '.dsh-ph-quote-label{color:var(--dsw-alias-label-tertiary,#8b949e);font-size:11px;}',
  '.dsh-ph-quote-text{white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#1f2328);max-height:120px;overflow:auto;}',
  '.dsh-ph-quote-edit{width:100%;box-sizing:border-box;resize:vertical;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.15));border-radius:8px;padding:4px 6px;font:12px/1.5 system-ui,sans-serif;color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-layer-2,#f6f8fa);}',
  '.dsh-ph-quote-icon{flex:0 0 auto;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8b949e);cursor:pointer;font-size:13px;padding:2px 4px;border-radius:6px;line-height:1.2;}',
  '.dsh-ph-quote-icon:hover{background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1f2328);}',
  '.dsh-ph-quote-count{pointer-events:auto;margin-top:6px;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:var(--dsw-specific-menu,#fff);color:var(--dsw-alias-label-secondary,#57606a);font:12px system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.06);}',
  '.dsh-ph-quote-count:hover{background:var(--dsw-alias-bg-layer-3,#f0f2f5);}',
  '.dsh-ph-quote-notes-wrap{display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin:0 0 8px;max-width:100%;}',
  '.dsh-ph-quote-notes{display:inline-flex;align-items:center;gap:6px;max-width:100%;box-sizing:border-box;padding:4px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 86%,transparent);color:var(--dsw-alias-label-secondary,#57606a);font:500 12px/18px system-ui,sans-serif;white-space:normal;cursor:pointer;text-align:left;}',
  '.dsh-ph-quote-notes:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-primary,#1f2328);}',
  '.dsh-ph-quote-notes-icon{flex:0 0 auto;width:13px;height:13px;display:block;}',
  '.dsh-ph-quote-notes-text{min-width:0;white-space:nowrap;}',
  '.dsh-ph-quote-notes-list{display:flex;flex-direction:column;gap:6px;max-width:100%;box-sizing:border-box;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);font:12px/1.6 system-ui,sans-serif;white-space:normal;word-break:break-word;}',
  '.dsh-ph-quote-notes-item{display:flex;gap:6px;align-items:flex-start;}',
  '.dsh-ph-quote-notes-no{flex:0 0 auto;color:var(--dsw-alias-label-tertiary,#8b949e);font-variant-numeric:tabular-nums;}',
  '.dsh-ph-quote-notes-body{flex:1 1 auto;min-width:0;white-space:pre-wrap;}',
  '.dsh-ph-quote-x{opacity:.6;font-size:13px;margin-left:2px;}',
  '.dsh-ph-quote-badge{position:fixed;left:0;top:0;width:18px;height:18px;border-radius:50%;background:#22a35a;color:#fff;font:600 11px/18px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.28);opacity:0;transition:opacity .12s;pointer-events:none;z-index:2147482001;}',
].join('')

/** Install the quote card + pill + badge stylesheet once. */
export function ensureQuoteStyle(): void {
  if (document.querySelector('style[data-plugin-css="' + QUOTE_STYLE_ID + '"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.pluginCss = QUOTE_STYLE_ID
  tag.textContent = QUOTE_CSS
  document.head.appendChild(tag)
}

/** Delay before the card collapses after the pointer leaves it. */
const CARD_HIDE_DELAY = 160

/**
 * The quote card above the composer plus the numbered badges over the quoted
 * transcript text. Renders nothing visible until the first quote exists: the
 * card stays collapsed to a "N 条注" pill until it is hovered, focused or
 * clicked, and the badges track their text through a per-frame range rebuild.
 *
 * @param props - standard kit: the current session id.
 */
export function QuoteOverlay({ sessionId }: { readonly sessionId: string | undefined }): ReactElement {
  const [mount, setMount] = useState<HTMLDivElement | null>(null)
  const [editingId, setEditingId] = useState(0)
  const [editingText, setEditingText] = useState('')
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const slotRef = useRef<HTMLSpanElement | null>(null)

  const showCard = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setHovered(true)
  }, [])

  const hideCardSoon = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setHovered(false)
    }, CARD_HIDE_DELAY)
  }, [])

  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
  }, [])

  const store = useCallback((listener: () => void) => subscribeQuotes(sessionId, listener), [sessionId])
  const read = useCallback(() => quoteEntries(sessionId), [sessionId])
  const entries = useSyncExternalStore(store, read)
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  // The card lives on document.body so the composer's overflow cannot clip it.
  useEffect(() => {
    const element = document.createElement('div')
    element.className = 'dsh-ph-quote-mount'
    document.body.appendChild(element)
    setMount(element)
    return () => { element.remove() }
  }, [])

  useEffect(() => { ensureSendHook(sessionId) }, [sessionId])
  useEffect(() => { if (entries.length === 0) setPinned(false) }, [entries.length])

  // Keep the card under the composer and the badges on their quoted text.
  useEffect(() => {
    if (entries.length === 0) return
    ensureQuoteStyle()
    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const host = hostRef.current
      const card = (slotRef.current === null ? null : slotRef.current.closest(COMPOSER_CARD)) ?? document.querySelector(COMPOSER_CARD)
      if (host === null || card === null) return
      host.dataset.open = '1'
      const rect = card.getBoundingClientRect()
      host.style.left = rect.left + 'px'
      host.style.width = rect.width + 'px'
      host.style.bottom = window.innerHeight - rect.top + 8 + 'px'
      const badges = host.querySelectorAll<HTMLElement>('.dsh-ph-quote-badge')
      for (const badge of badges) {
        try {
          const id = Number(badge.dataset.quoteId ?? '0')
          const entry = entriesRef.current.find((item) => item.id === id)
          const range = entry === undefined ? null : rangeForAnchor(entry.anchor)
          const box = range === null || typeof range.getBoundingClientRect !== 'function' ? null : range.getBoundingClientRect()
          if (box === null || (box.width === 0 && box.height === 0) || box.bottom < 0 || box.top > window.innerHeight) {
            badge.style.opacity = '0'
            continue
          }
          badge.style.opacity = '1'
          badge.style.left = Math.max(2, box.left) + 'px'
          badge.style.top = Math.max(2, box.top - 22) + 'px'
        } catch {
          badge.style.opacity = '0'
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      const host = hostRef.current
      if (host !== null) host.dataset.open = ''
    }
  }, [entries.length])

  const marker = <span ref={slotRef} data-dsh-ph-quote-slot="1" style={{ display: 'none' }} />
  if (mount === null) return marker

  const commitEdit = (entry: QuoteEntry): void => {
    const text = editingText
    setEditingId(0)
    if (text.trim() === '' || text === entry.text) return
    editQuoteEntry(sessionId, entry, text)
  }

  const rows = entries.map((entry) => {
    const editing = editingId === entry.id
    return (
      <div className="dsh-ph-quote-row" key={'q' + entry.id}>
        <div className="dsh-ph-quote-no">{entry.n + '.'}</div>
        <div className="dsh-ph-quote-body">
          <div className="dsh-ph-quote-label">{T('quote.selected') + ':'}</div>
          {editing
            ? (
              <textarea
                className="dsh-ph-quote-edit"
                value={editingText}
                rows={Math.min(6, Math.max(2, editingText.split('\n').length))}
                autoFocus
                onChange={(event) => setEditingText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setEditingId(0)
                    return
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    commitEdit(entry)
                  }
                }}
              />
            )
            : <div className="dsh-ph-quote-text">{entry.text}</div>}
        </div>
        <button
          type="button"
          className="dsh-ph-quote-icon"
          title={T('quote.edit')}
          onClick={() => { setEditingId(entry.id); setEditingText(entry.text) }}
        >{'\u270E'}</button>
        <button
          type="button"
          className="dsh-ph-quote-icon"
          title={T('quote.delete')}
          onClick={() => removeQuoteEntry(sessionId, entry)}
        >{'\uD83D\uDDD1'}</button>
      </div>
    )
  })

  const layer = createPortal(
    <div
      className="dsh-ph-quote-host"
      ref={hostRef}
      data-show={entries.length > 0 && (hovered || focused || pinned || editingId !== 0) ? '1' : undefined}
    >
      <div
        className="dsh-ph-quote-card"
        onMouseEnter={showCard}
        onMouseLeave={hideCardSoon}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          const next = event.relatedTarget
          if (next !== null && event.currentTarget.contains(next as Node)) return
          setFocused(false)
          setEditingId(0)
        }}
      >{rows}</div>
      <button
        type="button"
        className="dsh-ph-quote-count"
        title={T('quote.view')}
        onMouseEnter={showCard}
        onMouseLeave={hideCardSoon}
        onClick={() => setPinned((value) => !value)}
      >
        {entries.length + ' ' + T('quote.count')}
        <span
          className="dsh-ph-quote-x"
          role="button"
          title={T('quote.clear')}
          onClick={(event) => {
            event.stopPropagation()
            setPinned(false)
            clearQuotes(sessionId)
          }}
        >{'\u00D7'}</span>
      </button>
      {entries.map((entry) => (
        <div className="dsh-ph-quote-badge" key={'b' + entry.id} data-quote-id={String(entry.id)}>{entry.n}</div>
      ))}
    </div>,
    mount,
  )

  return <>{marker}{layer}</>
}

/** Parsed shapes a quoted run of a sent message carries. */
interface QuoteNotesData {
  readonly count: number
  readonly texts: readonly string[]
}

/** The user-text candidate a matched quoted run produces. */
interface QuoteNotesCandidate {
  readonly id: string
  readonly start: number
  readonly end: number
  readonly data: QuoteNotesData
}

/** A uiConversation user-text rule (registered dynamically when available). */
export interface QuoteNotesRule {
  readonly id: string
  readonly order: number
  match: (text: string, from: number) => QuoteNotesCandidate | undefined
}

/** Read the run of Markdown blockquote lines a sent message starts with. */
function matchQuotedRun(text: string): QuoteNotesCandidate | undefined {
  if (!text.startsWith('> ')) return undefined
  const blocks: string[] = []
  let pos = 0
  while (pos < text.length) {
    if (!text.startsWith('> ', pos)) break
    const lines: string[] = []
    let cursor = pos
    let blockEnd = pos
    while (cursor < text.length) {
      const lineEnd = text.indexOf('\n', cursor)
      const stop = lineEnd === -1 ? text.length : lineEnd
      const line = text.slice(cursor, stop)
      if (line.startsWith('> ')) lines.push(line.slice(2))
      else if (line === '>') lines.push('')
      else break
      blockEnd = stop
      if (lineEnd === -1) break
      cursor = lineEnd + 1
    }
    if (lines.length === 0) break
    const body = lines.join('\n')
    if (body.trim() === '') break
    blocks.push(body)
    pos = blockEnd
    let next = pos
    while (next < text.length && text.charAt(next) === '\n') next += 1
    if (next < text.length && text.startsWith('> ', next)) {
      pos = next
      continue
    }
    pos = next
    break
  }
  if (blocks.length === 0) return undefined
  return { id: 'quote-notes', start: 0, end: pos, data: { count: blocks.length, texts: blocks } }
}

/**
 * One comment pill for a sent message: the leading run of Markdown blockquote
 * lines the send hook prepended. Matching only at offset 0 keeps a blockquote
 * the user typed by hand mid-message untouched.
 */
export const QUOTE_NOTES_RULE: QuoteNotesRule = {
  id: 'quote-notes',
  order: 20,
  match: (text, from) => from === 0 ? matchQuotedRun(text) : undefined,
}

/** Props of a conversation.user.text.node renderer, as far as quotes need them. */
interface QuoteNotesChipProps {
  readonly node?: { readonly data?: unknown } | undefined
}

/** Narrow a renderer's node data to the quote shape. */
function quoteNotesData(value: unknown): QuoteNotesData {
  if (value === null || typeof value !== 'object') return { count: 1, texts: [] }
  const record = value as { count?: unknown; texts?: unknown }
  const count = typeof record.count === 'number' && record.count > 0 ? record.count : 1
  const texts = Array.isArray(record.texts) ? record.texts.filter((item): item is string => typeof item === 'string') : []
  return { count, texts }
}

/**
 * The sent-message stand-in for quoted text: a Codex-style "N 条注释" pill that
 * expands to the quoted lines. It renders inside the message bubble, so it
 * re-enables normal white-space (the bubble is pre-wrap) and sits full width of
 * its own line.
 */
export function QuoteNotesChip({ node }: QuoteNotesChipProps): ReactElement {
  const { count, texts } = quoteNotesData(node?.data)
  const [open, setOpen] = useState(false)
  ensureQuoteStyle()
  const label = count + ' ' + T('quote.notes')
  const title = texts.length > 0 ? texts.join('\n\n') : label
  return (
    <div className="dsh-ph-quote-notes-wrap">
      <button
        type="button"
        className="dsh-ph-quote-notes"
        title={title}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen((value) => !value)
        }}
      >
        <svg className="dsh-ph-quote-notes-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.7 3.5h10.6v7.1H7.5L4.3 13.3v-2.7H2.7z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M5.1 6.1h5.8M5.1 8.2h3.9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
        <span className="dsh-ph-quote-notes-text">{label}</span>
      </button>
      {open && texts.length > 0
        ? (
          <div className="dsh-ph-quote-notes-list">
            {texts.map((body, index) => (
              <div className="dsh-ph-quote-notes-item" key={'qn' + index}>
                <span className="dsh-ph-quote-notes-no">{index + 1 + '.'}</span>
                <span className="dsh-ph-quote-notes-body">{body}</span>
              </div>
            ))}
          </div>
        )
        : null}
    </div>
  )
}

/**
 * The uiConversation service, as far as the comment pill needs it. Hosts before
 * 0.2.1-rc.3 do not have it, so every member is optional and the caller guards.
 */
interface QuoteUserTextHost {
  readonly userText?: { register: (rule: QuoteNotesRule) => unknown } | undefined
}

/** Slot registry surface, loose because the node slot is not in every typings. */
interface QuoteSlotHost {
  inject: (name: string, callback: (...args: never[]) => unknown) => unknown
  register: (options: Record<string, unknown>, component: unknown) => unknown
}

/** True once the transcript half is registered (it is a one-shot registration). */
let notesBound = false

/**
 * Register the sent-message comment pill once: one uiConversation user-text
 * rule plus its conversation.user.text.node renderer, behind a single
 * uiConversation/slots injection so a host without them keeps working (the raw
 * blockquote then shows as plain text, as before).
 */
export function bindQuoteNotes(ctx: ClientContext): void {
  if (notesBound) return
  notesBound = true
  ensureQuoteStyle()
  ctx.inject(['uiConversation', 'slots'], (notesCtx) => {
    const host = notesCtx as unknown as QuoteUserTextHost & { slots: QuoteSlotHost }
    try {
      host.userText?.register(QUOTE_NOTES_RULE)
    } catch {
      // Older hosts: the pill is skipped, the transcript keeps plain text.
    }
    try {
      const slots = host.slots
      slots.inject('conversation.user.text.node', function* () {
        yield slots.register({ name: 'conversation.user.text.node', key: 'quote-notes', priority: 100 }, QuoteNotesChip)
      })
    } catch {
      // Same fallback: no renderer, no pill, no breakage.
    }
  })
}
