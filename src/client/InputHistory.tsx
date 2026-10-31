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
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ui-conversation SlotMap merge (the input.right entry) and the
// session standard kit members (useInput/inputActions).
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the ui-session merge (useSession/sessionId) on DSH >= 0.2 layouts.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { getPrefs, subscribePrefs } from './prefs.ts'
import { pullOlderPage } from './sessionCtx.ts'
import { promptMessage, type PromptMessage } from './nodes.ts'
import {
  COMPOSER_CARD, editorFocused, editorHost, editorSelectedText, editorSelectionOffsets,
  focusEditor, isEditorTarget, setEditorCaret,
} from './editor.ts'
import { useClipboard } from './useClipboard.ts'
import { QuoteOverlay } from './quoteMarks.tsx'
import { useHistory } from './useHistory.ts'
import { useBrowse } from './useBrowse.ts'
import { useComposerKeys } from './useComposerKeys.ts'
import { useCompletion } from './useCompletion.ts'
import { RESET_BROWSE, type BrowseState, type SearchState } from './browse.ts'
import { registerMainInserter } from './bridge.ts'
import { useSuggestion } from './useSuggestion.ts'
import { ChatToc } from './ChatToc.tsx'

/** Full props of the input-history entry: framework standard kit + owner share. */
export type InputHistoryProps = PropsRuntime<'conversation.input.right'>

/** The suggestion menu (slash/at) renders a listbox inside the card while open. */
const OPEN_MENU = '[role="listbox"]'

/** DSH ≥ 0.1.2 moved the conversation nodes off the session snapshot onto the
 * chat view (useChat); the lifecycle fields (removed/hasMore/loadingOlder/
 * openState) stay on useSession. Node shapes differ per generation, so reads
 * go through rawNodesOf + promptMessage (nodes.ts). */
interface ChatLike {
  /** 0.1.1 session snapshot nodes, or a direct array on newer shapes. */
  nodes?: unknown
  /** 0.1.2 web: the old-shaped node array compatibility slice. */
  legacy?: { nodes?: unknown }
  /** 2.0.x desktop: ordered node keys + a store whose .get(key) returns a node. */
  order?: readonly string[]
  removed?: boolean
  hasMore?: boolean
  loadingOlder?: boolean
  openState?: string
}
type SelectorHook = (select: (snapshot: ChatLike) => unknown) => unknown

/** Pull the ordered node array out of whichever snapshot shape is present. */
function rawNodesOf(snapshot: ChatLike): readonly unknown[] {
  const legacy = snapshot.legacy?.nodes
  if (Array.isArray(legacy)) return legacy
  const order = snapshot.order
  const store = snapshot.nodes as { get?: (key: string) => unknown } | undefined
  if (Array.isArray(order) && store !== undefined && typeof store.get === 'function') {
    return order.map((key) => store.get?.(key)).filter((n): n is unknown => n !== null && n !== undefined)
  }
  if (Array.isArray(snapshot.nodes)) return snapshot.nodes
  return []
}

/**
 * The composer history + right-click-paste entry.
 * @param props - framework standard kit (useInput/useSession/inputActions/sessionId).
 * @returns null (the entry is invisible chrome).
 */
export function InputHistory(props: InputHistoryProps) {
  const { useInput, useSession, inputActions, sessionId } = props
  // rc.1 merges useChat into the same session standard props (nodes source).
  const useChat = (props as InputHistoryProps & { useChat?: unknown }).useChat
  const nodesHook = (typeof useChat === 'function' ? useChat : useSession) as SelectorHook | undefined
  const sessionHook = useSession as SelectorHook | undefined

  // Latest machine/session facts at event time (the listeners mount once).
  const draft = useInput((s: InputState) => s.draft)
  const phase = useInput((s: InputState) => s.phase)
  // Node shapes differ by DSH generation (old {kind,seq,content} vs 2.0.x
  // chatNode with data.content/anchorSeq, and rc.1's nodes being a store, not
  // an array). rawNodesOf + promptMessage normalize them to {kind, seq, text},
  // so nothing non-iterable or mis-shaped reaches the history or the directory.
  const rawNodes = (nodesHook?.((s: ChatLike) => rawNodesOf(s)) as readonly unknown[] | undefined) ?? []
  const messages = useMemo(
    () => rawNodes.map(promptMessage).filter((m): m is PromptMessage => m !== null),
    [rawNodes],
  )
  // Directory texts: consecutive duplicates collapsed, in conversation order.
  const tocTexts = useMemo(() => {
    const out: string[] = []
    for (const message of messages) {
      if (message.text !== null && out[out.length - 1] !== message.text) out.push(message.text)
    }
    return out
  }, [messages])
  const removed = sessionHook?.((s) => s.removed) as boolean | undefined ?? false

  // Full-history TOC: when the directory opens it asks us to widen the loaded
  // window backwards (loadOlder page by page) until hasMore is false, so every
  // earlier user message shows up in the directory, not just the initial window.
  const hasMore = sessionHook?.((s) => s.hasMore) as boolean | undefined ?? false
  const loadingOlder = sessionHook?.((s) => s.loadingOlder) as boolean | undefined ?? false
  const openState = sessionHook?.((s) => s.openState) as string | undefined ?? ''
  const [widen, setWiden] = useState(false)
  const widenBusyRef = useRef(false)
  const widenPagesRef = useRef(0)
  const requestWiden = useCallback((): void => { setWiden(true) }, [])
  useEffect(() => {
    if (!widen) return
    if (removed || openState !== 'open') { setWiden(false); return }
    if (!hasMore) { setWiden(false); return }
    if (loadingOlder || widenBusyRef.current) return
    if (widenPagesRef.current >= 60) { setWiden(false); return } // safety cap
    widenBusyRef.current = true
    widenPagesRef.current += 1
    void pullOlderPage(sessionId).finally(() => { widenBusyRef.current = false })
  }, [widen, hasMore, loadingOlder, openState, sessionId, removed])

  /** Submitted prompt texts, oldest → newest (per session; append-only). */
  const historyRef = useRef<string[]>([])
  /** User-node seqs already folded into historyRef (append-once dedup). */
  const seenRef = useRef<Set<number>>(new Set())
  const browseRef = useRef<BrowseState>(RESET_BROWSE)
  const searchRef = useRef<SearchState | null>(null)
  const liveRef = useRef({ draft, phase, removed, inputActions })
  /** Settings snapshot: the TOC render and the leaf flags follow it. */
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs)

  // Prediction lifecycle (cache, dismissal, debounce, pending line, accept).
  const suggestion = useSuggestion({ sessionId, liveRef, draft, phase, messagesLength: messages.length })
  // History-completion ghost (suffix of a past prompt after the caret).
  const completion = useCompletion({ liveRef, historyRef, draft })
  // Clipboard: right-click paste, copy modes, selection toolbar, quote.
  useClipboard({ liveRef, sessionId })
  // Browsing (↑/↓ with prefix search) and Ctrl+R reverse search.
  const browsing = useBrowse({ liveRef, historyRef, browseRef, searchRef })
  // History: seed/reset/fold the prompt list from the session's own messages.
  useHistory({ sessionId, messages, historyRef, seenRef, browseRef, searchRef })
  liveRef.current = { draft, phase, removed, inputActions }

  // ---- prompt completion (Codex/fish-style type-ahead) ----
  /** Draft the user dismissed the ghost on (Esc); cleared whenever it changes. */
  // Let the side chat hand a conclusion back into this composer's draft.
  useEffect(() => registerMainInserter((text) => {
    const host = editorHost()
    if (host === null) return false
    const live = liveRef.current
    const next = live.draft === '' ? text : `${live.draft}\n\n${text}`
    const actions = live.inputActions as {
      captureInsertion?: () => unknown
      insertText?: (value: string, span: unknown) => boolean
      setDraft?: (value: string) => void
    }
    if (typeof actions.captureInsertion === 'function' && typeof actions.insertText === 'function') {
      try {
        if (actions.insertText(`${live.draft === '' ? '' : '\n\n'}${text}`, actions.captureInsertion()) === true) return true
      } catch { /* fall through to a draft write */ }
    }
    actions.setDraft?.(next)
    setEditorCaret(host, next.length)
    return true
  }), [])

  // Any draft change that is not our own history write ends the browse
  // session (bash drops the recalled line when you edit it).
  useEffect(() => {
    const browse = browseRef.current
    if (browse.index !== -1 && draft !== browse.lastSet) browseRef.current = RESET_BROWSE
  }, [draft])

  // The key chain (prediction accept → IME/menu guards → manual predict →
  // reverse search → hint accept → arrows), installed once.
  useComposerKeys({ liveRef, historyRef, suggestion, completion, browsing })

  // The TOC (when enabled) plus the Codex-style quote card: notes queued from
  // the selection toolbar, rendered above the composer and prepended to the
  // message on submit. Both are optional chrome — InputHistory itself returns
  // no visible box, so the fragment keeps its previous shape.
  return (
    <>
      {prefs.tocVisible ? <ChatToc texts={tocTexts} onWiden={requestWiden} /> : null}
      <QuoteOverlay sessionId={sessionId} draft={draft} phase={phase} inputActions={inputActions} />
    </>
  )
}
