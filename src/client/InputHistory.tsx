/**
 * InputHistory: bash-like prompt history + right-click paste for the composer
 * (dsh-prompt-history). Renders nothing — it mounts capture-phase listeners on
 * the document while the session's composer card is live.
 *
 * Prompt history: Up recalls previously submitted prompts (newest first), Down
 * walks forward and restores the line that was being typed before browsing
 * began; editing the draft while browsing drops back to the live line. The '/'
 * and '@' suggestion menus keep their own arrow-key navigation: while the menu
 * (role=listbox inside the composer card) is open, the history listener
 * declines and the input trigger pipeline owns the keys.
 *
 * Right-click paste (terminal-style, like Linux): a right-click on the composer
 * textarea pastes the clipboard directly — no context menu. Paste runs the
 * SAME pipeline as Ctrl+V (execCommand('paste') fires the composer's own paste
 * handler, so images and reference chips behave identically), with a
 * navigator.clipboard fallback that splices text at the caret.
 *
 * Copy on select: any selection in the composer textarea (left-drag,
 * double-click, keyboard Shift+arrows, Ctrl+A) auto-copies once it stabilizes
 * — so select → right-click paste works end to end. Copy prefers the
 * composer's own handler (execCommand), with a navigator.clipboard fallback.
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
import { useEffect, useRef } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ui-conversation SlotMap merge (the input.right entry) and the
// session standard kit members (useInput/inputActions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the runtime SessionStandardProps merge (useSession/sessionId) and
// the conversation node union.
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import { getPrefs } from './prefs.ts'

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

/** Not-browsing state; also the reset target after edits and session switches. */
const RESET_BROWSE: BrowseState = { index: -1, saved: '', lastSet: null }

/** The composer card's own textarea is the only interception target. */
const COMPOSER_CARD = '[data-composer-card]'
/** The suggestion menu (slash/at) renders a listbox inside the card while open. */
const OPEN_MENU = '[role="listbox"]'

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

/**
 * The composer history + right-click-paste entry.
 * @param props - framework standard kit (useInput/useSession/inputActions/sessionId).
 * @returns null (the entry is invisible chrome).
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

  // Right-click paste (terminal style): a right-click on the composer textarea
  // pastes the clipboard directly, like a Linux terminal.
  useEffect(() => {
    const pasteInto = (target: HTMLTextAreaElement): void => {
      // The composer's own paste handler (chip matching, image intake) fires on
      // the native paste event execCommand dispatches — full Ctrl+V parity.
      if (document.execCommand('paste')) return
      // Fallback: read text and splice it at the selection ourselves.
      void navigator.clipboard.readText().then(
        (text) => {
          if (text === '') return
          const start = target.selectionStart ?? 0
          const end = target.selectionEnd ?? start
          const draft = liveRef.current.draft
          const next = draft.slice(0, start) + text + draft.slice(end)
          liveRef.current.inputActions.setDraft(next)
          const caret = start + text.length
          requestAnimationFrame(() => { target.setSelectionRange(caret, caret) })
        },
        () => { /* clipboard read denied: nothing to paste */ },
      )
    }

    const onContextMenu = (e: MouseEvent): void => {
      const target = e.target
      if (!(target instanceof HTMLTextAreaElement)) return
      if (target.closest(COMPOSER_CARD) === null) return
      const live = liveRef.current
      if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) return
      // Toggle off: leave the native context menu alone.
      if (!getPrefs().rightClickPaste) return
      e.preventDefault()
      e.stopPropagation()
      // Right-click does not focus in browsers; focus so the caret/selection is
      // authoritative for the paste (preventScroll: the caret is where the user
      // sees it already).
      target.focus({ preventScroll: true })
      pasteInto(target)
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => { document.removeEventListener('contextmenu', onContextMenu, true) }
  }, [])

  // Copy on select (selection-driven, terminal-wide): whenever any non-empty
  // selection in the page has been stable briefly, copy it — the composer
  // textarea (chip-aware via the composer's own copy handler), chat messages,
  // code blocks, anything. A stable-window debounce keeps mid-drag partial
  // selections out of the clipboard; a last-copied key suppresses re-copying
  // an unchanged selection. A brief "已复制" pill appears on success, so the
  // copy is visible. execCommand('copy') is the primary path (it needs the
  // focused element for textarea selections); the clipboard API is the
  // fallback and logs failures.
  useEffect(() => {
    let timer: number | undefined
    let lastKey = ''
    let dragStartedInTextarea = false

    const flashCopied = (): void => {
      let x = 8
      let y = 8
      try {
        const sel = document.getSelection()
        if (sel !== null && !sel.isCollapsed && sel.rangeCount > 0) {
          const rect = sel.getRangeAt(0).getBoundingClientRect()
          if (rect.width > 0 || rect.height > 0) {
            x = Math.max(4, Math.min(rect.left, window.innerWidth - 90))
            y = Math.max(4, rect.top - 26)
          }
        }
      } catch { /* fall back to the corner position */ }
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

    const copyText = (text: string, key: string, focusTarget?: HTMLTextAreaElement): void => {
      if (key === lastKey) return // unchanged selection: already copied
      lastKey = key
      if (focusTarget !== undefined && document.activeElement !== focusTarget) {
        focusTarget.focus({ preventScroll: true })
      }
      let ok = false
      try {
        ok = document.execCommand('copy')
      } catch {
        ok = false // flaky across engines; fall back to the clipboard API
      }
      if (ok) {
        flashCopied()
        return
      }
      if (text === '') return
      navigator.clipboard.writeText(text).then(
        () => { flashCopied() },
        (error) => { console.warn('[dsh-prompt-history] clipboard copy failed:', error) },
      )
    }

    const copySelection = (): void => {
      const live = liveRef.current
      if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) return

      // 1) Composer textarea selection (the composer's own handler expands
      //    chips; only while it is the active selection or a drag started in
      //    it — a stale textarea selection must not shadow a chat selection).
      const textarea = document.querySelector<HTMLTextAreaElement>(`${COMPOSER_CARD} textarea`)
      if (textarea !== null && (document.activeElement === textarea || dragStartedInTextarea)) {
        const start = textarea.selectionStart ?? 0
        const end = textarea.selectionEnd ?? start
        if (end > start) {
          copyText(textarea.value.slice(start, end), `ta:${start}:${end}`, textarea)
          return
        }
      }

      // 2) Any other document selection (chat messages, code blocks, ...).
      const sel = document.getSelection()
      if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return
      const text = sel.toString()
      if (text === '') return
      copyText(text, `doc:${text}`)
    }

    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const target = e.target
      dragStartedInTextarea =
        target instanceof HTMLTextAreaElement && target.closest(COMPOSER_CARD) !== null
    }

    const onSelectionChange = (): void => {
      const live = liveRef.current
      if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) return
      // Toggle off: no auto-copy at all.
      if (!getPrefs().copyOnSelect) return
      const textarea = document.querySelector<HTMLTextAreaElement>(`${COMPOSER_CARD} textarea`)
      const taActive = textarea !== null
        && (document.activeElement === textarea || dragStartedInTextarea)
        && (textarea.selectionStart ?? 0) < (textarea.selectionEnd ?? 0)
      const sel = document.getSelection()
      const domActive = sel !== null && !sel.isCollapsed
      if (!taActive && !domActive) {
        window.clearTimeout(timer)
        return
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(copySelection, 120)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mousedown', onMouseDown, true)
    console.info('[dsh-prompt-history] copy-on-select active')
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mousedown', onMouseDown, true)
      window.clearTimeout(timer)
    }
  }, [])

  return null
}
