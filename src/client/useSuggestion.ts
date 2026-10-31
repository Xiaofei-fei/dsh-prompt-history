/**
 * Next-prompt prediction orchestration for the composer.
 *
 * Everything about the prediction lives here: the cache keyed by session +
 * context, the dismissal per context, the debounce and the empty-context retry
 * loop, the pending line, and accepting the text into the editor. The composer
 * keeps only its key bindings and calls into this hook.
 *
 * Deliberately a hook, not a service: it reads the live draft/phase through the
 * ref the composer owns, so a listener registered once always sees current state
 * without re-registering.
 *
 * @module dsh-prompt-history/client/useSuggestion
 */
import { useCallback, useEffect, useRef } from 'react'
import { COMPOSER_CARD, editorHost, focusEditor, isEditorTarget, setEditorCaret } from './editor.ts'
import { T } from './i18n.ts'
import { getPrefs } from './prefs.ts'
import { buildContext, getActiveBridge } from './suggest.ts'
import { hideSuggestion, showPending, showSuggestion, suggestionVisible } from './suggestOverlay.ts'

/** The composer actions the hooks may call (all optional: hosts differ). */
export interface ComposerActions {
  captureInsertion?: () => unknown
  /** The span is whatever the host's own captureInsertion() returned. */
  insertText?: (text: string, span: never) => boolean
  setDraft?: (text: string) => void
}

/** The composer state the hooks read at event time. */
export interface LiveComposer {
  readonly draft: string
  readonly phase: string
  readonly removed: boolean
  readonly inputActions: ComposerActions
}

/** What the composer must hand the hook each render. */
export interface SuggestionInput {
  /** Durable session identity: part of every cache key. */
  readonly sessionId: string
  /** Live composer state, read at event time (never null: the composer owns it). */
  readonly liveRef: { readonly current: LiveComposer }
  /** Current draft (effect dependency). */
  readonly draft: string
  /** Current phase (effect dependency). */
  readonly phase: string
  /** Conversation node count: the precondition re-runs as nodes arrive. */
  readonly messagesLength: number
}

/** The controls the composer binds to keys and clicks. */
export interface SuggestionControls {
  /** Predict for the current context, respecting a dismissal and the cache. */
  request(): void
  /** Predict now, ignoring a dismissal (the manual shortcut). */
  requestNow(): void
  /** Cancel any scheduled or in-flight request and drop the overlay. */
  clear(): void
  /** Accept the visible prediction into the composer. */
  accept(): boolean
  /** A prediction (not just the pending line) is on screen. */
  visible(): boolean
  /** The user dismissed this context with Esc. */
  dismiss(): void
}

/** How long to wait for the composer frame before reading the transcript. */
const SETTLE_MS = 300
/** Retries while the transcript is not readable yet (fresh session). */
const EMPTY_CONTEXT_RETRIES = 20
/** Retry interval for an unreadable transcript. */
const EMPTY_CONTEXT_INTERVAL_MS = 1200
/** Silent retries for an empty model answer per context. */
const EMPTY_ANSWER_RETRIES = 2

/**
 * Own the prediction lifecycle for one composer.
 * @param input - session identity, live state, and the effect dependencies.
 * @returns the controls, plus the effects that trigger predictions.
 */
export function useSuggestion(input: SuggestionInput): SuggestionControls {
  const { liveRef } = input
  /** Last prediction, keyed by session + context so it never crosses sessions. */
  const cachedRef = useRef<{ key: string; text: string } | null>(null)
  /** Context the user dismissed with Escape (suppressed until it changes). */
  const dismissedContextRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<number | null>(null)
  /** One attempt chain at a time: overlapping triggers would cancel each other. */
  const pendingRef = useRef(false)
  /** Empty model answers already retried for the current context. */
  const emptyAnswersRef = useRef(0)

  /** Stop any scheduled or in-flight prediction and drop the overlay. */
  const clear = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    abortRef.current?.abort()
    abortRef.current = null
    pendingRef.current = false
    hideSuggestion()
  }, [])

  /** Predict the next prompt and ghost it in the empty composer. */
  const request = useCallback((): void => {
    if (!getPrefs().contextSuggest) { clear(); return }
    const live = liveRef.current
    if (live.draft !== '' || live.phase !== 'plain' || live.removed) { clear(); return }
    if (pendingRef.current || suggestionVisible()) return
    const bridge = getActiveBridge()
    if (bridge === null) return
    const host = editorHost()
    if (host === null) return
    pendingRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    let attempts = 0
    // Wait for the frame to settle before reading the conversation: node updates
    // arrive before React paints the chat rows, so an immediate read would see an
    // empty transcript. Empty reads retry cheaply — no model call happens until
    // there is context.
    const attempt = (): void => {
      timerRef.current = null
      const now = liveRef.current
      if (controller.signal.aborted || now.draft !== '' || now.phase !== 'plain' || now.removed) {
        pendingRef.current = false
        return
      }
      let context = ''
      try {
        context = buildContext()
      } catch {
        pendingRef.current = false
        return
      }
      if (context.trim() === '') {
        // Nothing readable yet (fresh session): never keep another context's
        // prediction on screen while waiting for rows to render.
        hideSuggestion()
        attempts += 1
        if (attempts < EMPTY_CONTEXT_RETRIES) timerRef.current = window.setTimeout(attempt, EMPTY_CONTEXT_INTERVAL_MS)
        else pendingRef.current = false
        return
      }
      if (dismissedContextRef.current === context) { pendingRef.current = false; return }
      const key = `${input.sessionId}:${context.slice(-600)}`
      if (cachedRef.current?.key !== key) emptyAnswersRef.current = 0
      const cached = cachedRef.current
      if (cached !== null && cached.key === key) {
        pendingRef.current = false
        if (cached.text !== '') showSuggestion(cached.text, T('suggest.accept'), host)
        return
      }
      // Tell the user something is happening; the prediction replaces this line.
      showPending(T('suggest.pending'), host)
      void bridge.fetch(context, { signal: controller.signal }).then((text) => {
        pendingRef.current = false
        if (controller.signal.aborted) return
        const latest = liveRef.current
        if (latest.draft !== '' || latest.phase !== 'plain' || latest.removed) return
        // An empty answer must not hide a suggestion already on screen, and must
        // not be cached: a later turn can still produce one. Reasoning models
        // occasionally spend the whole budget thinking, so a couple of silent
        // retries are allowed per context before giving up on it.
        if (text === '') {
          hideSuggestion()
          if (emptyAnswersRef.current < EMPTY_ANSWER_RETRIES) {
            emptyAnswersRef.current += 1
            attempt()
          }
          return
        }
        emptyAnswersRef.current = 0
        cachedRef.current = { key, text }
        showSuggestion(text, T('suggest.accept'), host)
      })
    }
    timerRef.current = window.setTimeout(attempt, SETTLE_MS)
  }, [clear, input.sessionId, liveRef])

  /** Predict now, ignoring a dismissal. */
  const requestNow = useCallback((): void => {
    dismissedContextRef.current = null
    pendingRef.current = false
    hideSuggestion()
    request()
  }, [request])

  /** A real prediction (not the pending line) is on screen. */
  const visible = useCallback((): boolean => suggestionVisible() && cachedRef.current !== null, [])

  /** The user dismissed the current context. */
  const dismiss = useCallback((): void => {
    try {
      dismissedContextRef.current = buildContext()
    } catch {
      dismissedContextRef.current = null
    }
    clear()
  }, [clear])

  /** Accept the visible prediction into the composer. */
  const accept = useCallback((): boolean => {
    const predicted = cachedRef.current
    if (predicted === null || predicted.text === '') return false
    const host = editorHost()
    if (host === null) return false
    const actions = liveRef.current.inputActions
    focusEditor(host)
    let inserted = false
    if (typeof actions.captureInsertion === 'function' && typeof actions.insertText === 'function') {
      try { inserted = actions.insertText(predicted.text, actions.captureInsertion() as never) === true } catch { inserted = false }
    }
    if (!inserted) {
      actions.setDraft?.(predicted.text)
      setEditorCaret(host, predicted.text.length)
    }
    clear()
    dismissedContextRef.current = null
    return true
  }, [clear, liveRef])

  // A suggestion belongs to one conversation: switching sessions (or starting a
  // new one) drops it immediately instead of showing the previous session's
  // prediction in every view.
  useEffect(() => {
    cachedRef.current = null
    dismissedContextRef.current = null
    emptyAnswersRef.current = 0
    clear()
  }, [input.sessionId, clear])

  // Triggers: the empty composer gaining focus, an edit (which kills the ghost at
  // the DOM level), and every conversation mutation (a finished turn, a freshly
  // opened session rendering its rows).
  useEffect(() => {
    const card = document.querySelector(COMPOSER_CARD)
    if (card === null) return
    const onFocusIn = (event: Event): void => {
      if (!isEditorTarget(event.target)) return
      request()
    }
    card.addEventListener('focusin', onFocusIn)
    const onEdit = (): void => { clear() }
    card.addEventListener('beforeinput', onEdit, true)
    card.addEventListener('input', onEdit, true)
    card.addEventListener('paste', onEdit, true)
    const scrollport = document.querySelector('[data-conversation-scroll]') ?? document.body
    const observer = new MutationObserver(() => { request() })
    observer.observe(scrollport, { childList: true, subtree: true, characterData: true })
    return () => {
      card.removeEventListener('focusin', onFocusIn)
      card.removeEventListener('beforeinput', onEdit, true)
      card.removeEventListener('input', onEdit, true)
      card.removeEventListener('paste', onEdit, true)
      observer.disconnect()
    }
  }, [request, clear])

  // The composer being empty and the session idle is the precondition; the effect
  // also re-runs whenever conversation nodes arrive, which is exactly when a
  // fresh prediction makes sense. The cache keeps this to one call per context.
  useEffect(() => {
    if (input.draft !== '') {
      clear()
      return
    }
    if (input.phase === 'plain') request()
    else clear()
  }, [input.draft, input.phase, input.messagesLength, clear, request])

  return { request, requestNow, clear, accept, visible, dismiss }
}
