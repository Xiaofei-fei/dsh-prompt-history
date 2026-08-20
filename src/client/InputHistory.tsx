/**
 * InputHistory: bash-like prompt history + right-click menu for the composer
 * (dsh-prompt-history). Renders nothing visible except the transient
 * right-click menu (portaled to document.body) — it mounts capture-phase
 * listeners on the document while the session's composer card is live.
 *
 * Prompt history: Up recalls previously submitted prompts (newest first), Down
 * walks forward and restores the line that was being typed before browsing
 * began; editing the draft while browsing drops back to the live line. The '/'
 * and '@' suggestion menus keep their own arrow-key navigation: while the menu
 * (role=listbox inside the composer card) is open, the history listener
 * declines and the input trigger pipeline owns the keys.
 *
 * Right-click menu: a context menu (粘贴 / 复制 / 剪切) replaces the native
 * menu on the composer textarea. Paste runs the SAME pipeline as Ctrl+V
 * (execCommand('paste') fires the composer's own paste handler, so images and
 * reference chips behave identically), with a navigator.clipboard fallback;
 * copy/cut likewise prefer the composer's own handlers with a clipboard API
 * fallback. Focus never leaves the textarea (menu mousedowns are suppressed),
 * so the caret and selection survive the interaction.
 *
 * History is fed from the conversation snapshot's user nodes (kind 'user' and
 * 'steering'), appended as they land — so everything submitted while the page
 * is open is recallable even after the session event window slides. Consecutive
 * duplicates collapse; on a session switch the window's in-window user messages
 * seed the list. Unlike a parallel storage ring, the history IS the session's
 * own message log: it stays consistent with the transcript, survives reloads
 * through the session itself, and needs no configuration or extra storage.
 *
 * Interception guards: composer textarea target only, no modifier keys
 * (Shift+Up still extends selection), no IME composition, machine not
 * adjudicating/submitting, session not removed.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ui-conversation SlotMap merge (the input.right entry) and the
// session standard kit members (useInput/inputActions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the runtime SessionStandardProps merge (useSession/sessionId) and
// the conversation node union.
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'

/** Full props of the input-history entry: framework standard kit + owner share. */
export type InputHistoryProps = PropsRuntime<'conversation.input.right'>

/** One browse-position snapshot; index -1 = showing the live draft (not browsing). */
interface BrowseState {
  /** History index currently shown; -1 = the live line. */
  readonly index: number
  /** The draft saved when browsing started; restored at the bottom edge. */
  readonly saved: string
  /** The exact draft our own setDraft last wrote (user-edit detection). */
  readonly lastSet: string | null
}

/** One open context menu: position plus the textarea it was opened from. */
interface MenuState {
  readonly x: number
  readonly y: number
  readonly target: HTMLTextAreaElement
}

/** Not-browsing state; also the reset target after edits and session switches. */
const RESET_BROWSE: BrowseState = { index: -1, saved: '', lastSet: null }

/** The composer card's own textarea is the only interception target. */
const COMPOSER_CARD = '[data-composer-card]'
/** The suggestion menu (slash/at) renders a listbox inside the card while open. */
const OPEN_MENU = '[role="listbox"]'

/** Rough menu footprint for viewport clamping before the first paint. */
const MENU_WIDTH = 148
const MENU_HEIGHT = 124

/** Extract the trimmed plain text of one user-submitted message node; null when empty. */
function promptText(node: ConversationNode): string | null {
  if (node.kind !== 'user' && node.kind !== 'steering') return null
  let text = ''
  for (const block of node.content) {
    if (block.type === 'text') text += block.text
  }
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

/** Insert `text` at the textarea's selection via the machine's setDraft; restore the caret. */
function insertAtSelection(
  target: HTMLTextAreaElement,
  text: string,
  draft: string,
  setDraft: (text: string) => void,
): void {
  const start = target.selectionStart ?? 0
  const end = target.selectionEnd ?? start
  const next = draft.slice(0, start) + text + draft.slice(end)
  setDraft(next)
  const caret = start + text.length
  requestAnimationFrame(() => { target.setSelectionRange(caret, caret) })
}

/**
 * The composer history + context-menu entry.
 * @param props - framework standard kit (useInput/useSession/inputActions/sessionId).
 * @returns the transient right-click menu (portaled) or null.
 */
export function InputHistory({ useInput, useSession, inputActions, sessionId }: InputHistoryProps) {
  // Latest machine/session facts at event time (the listeners mount once).
  const draft = useInput(s => s.draft)
  const phase = useInput(s => s.phase)
  const nodes = useSession(s => s.nodes)
  const removed = useSession(s => s.removed) ?? false

  /** Submitted prompt texts, oldest → newest (per session; append-only). */
  const historyRef = useRef<string[]>([])
  /** User-node seqs already folded into historyRef (append-once dedup). */
  const seenRef = useRef<Set<number>>(new Set())
  const browseRef = useRef<BrowseState>(RESET_BROWSE)
  const liveRef = useRef({ draft, phase, removed, inputActions })
  liveRef.current = { draft, phase, removed, inputActions }

  // Right-click menu state (visible menu + the textarea it was opened from).
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuElRef = useRef<HTMLDivElement | null>(null)
  const menuStateRef = useRef<MenuState | null>(null)
  menuStateRef.current = menu
  const closeMenu = useCallback((): void => { setMenu(null) }, [])

  // One-time style tag for the portaled menu (theme tokens adapt to light/dark).
  useEffect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-prompt-history'
    tag.textContent = [
      '.dsh-ph-menu{position:fixed;z-index:2147483000;min-width:140px;padding:4px;',
      'background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l1);',
      'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.25);',
      'font-family:system-ui,sans-serif;user-select:none;}',
      '.dsh-ph-menu button{display:block;width:100%;text-align:left;padding:6px 10px;',
      'border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);',
      'font-size:13px;line-height:1.4;cursor:default;}',
      '.dsh-ph-menu button:hover{background:var(--dsw-alias-bg-layer-2);}',
    ].join('')
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, [])

  // Session switch: start a fresh history, seen set, and browse position.
  useEffect(() => {
    historyRef.current = []
    seenRef.current = new Set()
    browseRef.current = RESET_BROWSE
  }, [sessionId])

  // Fold newly arrived user messages into the history (window slides; the
  // append-only list survives it).
  useEffect(() => {
    const seen = seenRef.current
    const history = historyRef.current
    for (const node of nodes) {
      if (node.kind !== 'user' && node.kind !== 'steering') continue
      if (seen.has(node.seq)) continue
      seen.add(node.seq)
      const text = promptText(node)
      if (text === null) continue
      if (history[history.length - 1] !== text) history.push(text)
    }
  }, [nodes])

  // Any draft change that is not our own history write ends the browse
  // session (bash drops the recalled line when you edit it).
  useEffect(() => {
    const browse = browseRef.current
    if (browse.index !== -1 && draft !== browse.lastSet) browseRef.current = RESET_BROWSE
  }, [draft])

  // History keydown listener (mounts once; reads refs at event time).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // While the context menu is open the arrows belong to the menu, not history.
      if (menuStateRef.current !== null) return
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      const target = e.target
      if (!(target instanceof HTMLTextAreaElement)) return
      const card = target.closest(COMPOSER_CARD)
      if (card === null) return
      // IME composition and modifier chords stay native (Shift+Up selects text,
      // Ctrl+Up moves by word).
      if (e.isComposing || e.keyCode === 229) return
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
      // The suggestion menu owns the arrows while it is open.
      if (card.querySelector(OPEN_MENU) !== null) return
      const live = liveRef.current
      if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) return
      const history = historyRef.current
      if (history.length === 0) return
      // The browse indexes below are always in bounds (derived from the length
      // or a clamped prior index), so the undefined arm of the indexed read is
      // unreachable; the fallback keeps the write and the lastSet echo aligned.
      const recall = (index: number): string => history[index] ?? ''
      const browse = browseRef.current

      if (e.key === 'ArrowDown' && browse.index === -1) return // native caret-down on the live line

      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'ArrowUp') {
        if (browse.index === -1) {
          // Enter browsing: save the live line, recall the newest prompt.
          const index = history.length - 1
          browseRef.current = { index, saved: live.draft, lastSet: recall(index) }
          live.inputActions.setDraft(recall(index))
        } else {
          const index = Math.max(0, browse.index - 1)
          browseRef.current = { ...browse, index, lastSet: recall(index) }
          live.inputActions.setDraft(recall(index))
        }
        return
      }

      // ArrowDown while browsing.
      if (browse.index + 1 >= history.length) {
        // Bottom edge: restore the saved live line and stop browsing.
        browseRef.current = RESET_BROWSE
        live.inputActions.setDraft(browse.saved)
      } else {
        const index = browse.index + 1
        browseRef.current = { ...browse, index, lastSet: recall(index) }
        live.inputActions.setDraft(recall(index))
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, [])

  // Right-click listener: open the custom menu on the composer textarea, close
  // any open menu on right-clicks anywhere else.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent): void => {
      const target = e.target
      if (!(target instanceof HTMLTextAreaElement) || target.closest(COMPOSER_CARD) === null) {
        if (menuStateRef.current !== null) closeMenu()
        return
      }
      const live = liveRef.current
      if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) return
      e.preventDefault()
      e.stopPropagation()
      // Right-click does not focus in browsers; focus so the caret/selection is
      // authoritative for the menu actions (preventScroll: the caret is where
      // the user sees it already).
      target.focus({ preventScroll: true })
      const x = Math.max(4, Math.min(e.clientX, window.innerWidth - MENU_WIDTH - 8))
      const y = Math.max(4, Math.min(e.clientY, window.innerHeight - MENU_HEIGHT - 8))
      setMenu({ x, y, target })
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => { document.removeEventListener('contextmenu', onContextMenu, true) }
  }, [closeMenu])

  // Menu dismissal: outside pointer-down, Escape, any scroll, and resize.
  useEffect(() => {
    if (menu === null) return
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && menuElRef.current?.contains(e.target)) return
      closeMenu()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeMenu()
    }
    const onScroll = (): void => { closeMenu() }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', closeMenu)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menu, closeMenu])

  // ---- menu actions (execCommand primary; clipboard API fallback) ----

  const runPaste = useCallback((): void => {
    const state = menuStateRef.current
    if (state === null) return
    const target = state.target
    closeMenu()
    // The composer's own paste handler (chip matching, image intake) fires on
    // the native paste event execCommand dispatches — full Ctrl+V parity.
    if (document.execCommand('paste')) return
    // Fallback: read text and splice at the selection ourselves.
    void navigator.clipboard.readText().then(
      (text) => {
        if (text === '') return
        insertAtSelection(target, text, liveRef.current.draft, liveRef.current.inputActions.setDraft)
      },
      () => { /* clipboard read denied: nothing to paste */ },
    )
  }, [closeMenu])

  const runCopy = useCallback((): void => {
    const state = menuStateRef.current
    if (state === null) return
    const target = state.target
    closeMenu()
    // The composer's own copy handler (clipboard projections for chips) fires
    // on the native copy event execCommand dispatches.
    if (document.execCommand('copy')) return
    const start = target.selectionStart ?? 0
    const end = target.selectionEnd ?? start
    const text = liveRef.current.draft.slice(start, end)
    if (text !== '') void navigator.clipboard.writeText(text).catch(() => {})
  }, [closeMenu])

  const runCut = useCallback((): void => {
    const state = menuStateRef.current
    if (state === null) return
    const target = state.target
    closeMenu()
    if (document.execCommand('cut')) return
    const start = target.selectionStart ?? 0
    const end = target.selectionEnd ?? start
    const draft = liveRef.current.draft
    const text = draft.slice(start, end)
    if (text === '') return
    void navigator.clipboard.writeText(text).then(
      () => {
        liveRef.current.inputActions.setDraft(draft.slice(0, start) + draft.slice(end))
        requestAnimationFrame(() => { target.setSelectionRange(start, start) })
      },
      () => { /* clipboard write denied: leave the selection */ },
    )
  }, [closeMenu])

  if (menu === null) return null
  return createPortal(
    <div
      ref={menuElRef}
      className="dsh-ph-menu"
      role="menu"
      aria-label="输入框菜单"
      style={{ left: menu.x, top: menu.y }}
      // Keep focus in the textarea: right-click must not blur the caret, or
      // execCommand and the composer handlers would lose their target.
      onMouseDown={(e) => { e.preventDefault() }}
    >
      <button type="button" role="menuitem" onClick={runPaste}>粘贴</button>
      <button type="button" role="menuitem" onClick={runCopy}>复制</button>
      <button type="button" role="menuitem" onClick={runCut}>剪切</button>
    </div>,
    document.body,
  )
}
