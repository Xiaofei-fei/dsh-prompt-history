/**
 * Prompt completion for the composer: the ghosted suffix after the caret.
 *
 * Two sources, one overlay, strict precedence:
 *
 * 1. **History** — the draft is a prefix of a prompt the user already sent. Free
 *    and instant, so it always wins.
 * 2. **Model continuation** — nothing in history matches, so after a short pause
 *    the host is asked to finish the half-written message from the conversation.
 *    This is what makes typing a first clause useful: the model sees what the
 *    assistant just said and completes the sentence in the user's own register,
 *    instead of the feature being dead until a prompt is retyped verbatim.
 *
 * Rendering lives in ghost.ts; acceptance is wired up by InputHistory so the
 * feature can be toggled from Settings.
 *
 * @module dsh-prompt-history/client/useCompletion
 */
import { useCallback, useEffect, useRef } from 'react'
import { COMPOSER_CARD, editorHost, editorSelectionOffsets } from './editor.ts'
import { completionEligible, matchCompletion } from './completion.ts'
import { buildContext, getActiveBridge } from './suggest.ts'
import { hideGhost, showGhost } from './ghost.ts'
import { getPrefs } from './prefs.ts'
import { scheduleFrame } from './frame.ts'

/** The `/` and `@` menus render a listbox inside the card while open. */
const OPEN_MENU = '[role="listbox"]'
/** Quiet time after the last keystroke before asking the model. */
const AI_DELAY_MS = 450
/** Shorter drafts are too ambiguous to continue usefully. */
const AI_MIN_DRAFT = 3
/** Draft → suffix pairs remembered per session (oldest evicted). */
const AI_CACHE_LIMIT = 40

/** The composer host that owns the caret. */
type Host = HTMLTextAreaElement | HTMLElement

/** Live composer state, read at event time. */
export interface LiveDraft {
  readonly draft: string
  readonly phase: string
  readonly removed: boolean
}

/** What the composer hands the hook. */
export interface CompletionInput {
  /** Durable session identity: part of every cache key. */
  readonly sessionId: string
  /** Live composer state, read at event time (never null: the composer owns it). */
  readonly liveRef: { readonly current: LiveDraft }
  /** The prompt history, oldest → newest. */
  readonly historyRef: { readonly current: readonly string[] }
  /** Current draft (effect dependency). */
  readonly draft: string
}

/** The controls the composer binds to keys and clicks. */
export interface CompletionControls {
  /** Recompute the ghost for the current draft (called on caret/layout changes). */
  sync(): void
  /** A ghost is on screen. */
  visible(): boolean
  /** The suffix on screen right now, or null (Tab accepts exactly this text). */
  current(): string | null
  /** Esc: suppress the ghost for this exact draft. */
  dismiss(): void
}

/**
 * Remember one continuation, evicting the oldest beyond the cap.
 * @param cache - the per-session cache.
 * @param key - `${sessionId}:${draft}`.
 * @param value - the suffix the model produced.
 */
function remember(cache: Map<string, string>, key: string, value: string): void {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > AI_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) return
    cache.delete(oldest)
  }
}

/**
 * Own the completion ghost for one composer.
 * @param input - live composer state, the history list, the draft and the session.
 * @returns the controls, plus the effects that keep the ghost in sync.
 */
export function useCompletion(input: CompletionInput): CompletionControls {
  const { liveRef, historyRef, sessionId } = input
  const dismissedRef = useRef<string | null>(null)
  /** The suffix currently painted, so Tab accepts what is on screen. */
  const shownRef = useRef<string | null>(null)
  /** Model continuations, keyed `${sessionId}:${draft}`. */
  const cacheRef = useRef(new Map<string, string>())
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** Draft an in-flight request belongs to (a newer draft retires it). */
  const pendingDraftRef = useRef<string | null>(null)

  /** Drop any scheduled or in-flight model request. */
  const cancelAi = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    abortRef.current?.abort()
    abortRef.current = null
    pendingDraftRef.current = null
  }, [])

  /** Paint (or clear) the ghost and remember what it shows. */
  const paint = useCallback((suffix: string | null, host: Host): void => {
    if (suffix === null || suffix === '') {
      shownRef.current = null
      hideGhost()
      return
    }
    shownRef.current = suffix
    showGhost(suffix, host)
  }, [])

  /**
   * Everything the ghost needs, or null when it must not show at all.
   * @returns the host and the draft when a ghost is allowed.
   */
  const gate = useCallback((): { host: Host; draft: string } | null => {
    if (!getPrefs().promptCompletion) return null
    const host = editorHost()
    if (host === null) return null
    const card = document.querySelector<HTMLElement>(COMPOSER_CARD)
    if (card !== null && card.querySelector(OPEN_MENU) !== null) return null
    const live = liveRef.current
    if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) return null
    const draft = live.draft
    if (!completionEligible(draft)) return null
    if (dismissedRef.current === draft) return null
    // Only complete from the end of the draft: mid-line edits stay untouched.
    const offsets = editorSelectionOffsets(host)
    if (offsets === null || offsets.start !== draft.length || offsets.end !== draft.length) return null
    return { host, draft }
  }, [liveRef])

  /**
   * Ask the model to finish `draft` after the quiet period.
   * @param draft - the draft the ghost is being computed for.
   */
  const requestAi = useCallback((draft: string): void => {
    if (!getPrefs().aiCompletion) return
    if (draft.trim().length < AI_MIN_DRAFT) return
    if (getActiveBridge() === null) return
    // Already waiting for (or receiving) an answer for this exact draft.
    if (pendingDraftRef.current === draft && (timerRef.current !== null || abortRef.current !== null)) return
    cancelAi()
    pendingDraftRef.current = draft
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      if (liveRef.current.draft !== draft) {
        pendingDraftRef.current = null
        return
      }
      let context = ''
      try {
        context = buildContext()
      } catch {
        pendingDraftRef.current = null
        return
      }
      const controller = new AbortController()
      abortRef.current = controller
      void getActiveBridge()?.fetch(context, { draft, signal: controller.signal }).then((suffix) => {
        if (controller.signal.aborted) return
        abortRef.current = null
        pendingDraftRef.current = null
        // Remember an empty answer too: without it every scroll or caret move
        // would re-ask for a draft the model already declined.
        remember(cacheRef.current, `${sessionId}:${draft}`, suffix)
        if (suffix === '') return
        // The user may have typed on while the model was thinking.
        if (liveRef.current.draft !== draft) return
        const allowed = gate()
        if (allowed === null || allowed.draft !== draft) return
        paint(suffix, allowed.host)
      })
    }, AI_DELAY_MS)
  }, [cancelAi, gate, liveRef, paint, sessionId])

  const sync = useCallback((): void => {
    const allowed = gate()
    if (allowed === null) {
      cancelAi()
      if (shownRef.current !== null) { shownRef.current = null; hideGhost() }
      return
    }
    const fromHistory = matchCompletion(allowed.draft, historyRef.current)
    if (fromHistory !== null) {
      cancelAi()
      paint(fromHistory, allowed.host)
      return
    }
    const cached = cacheRef.current.get(`${sessionId}:${allowed.draft}`)
    if (cached !== undefined) {
      // '' means the model already declined this draft: do not ask again.
      cancelAi()
      paint(cached === '' ? null : cached, allowed.host)
      return
    }
    // Nothing known yet: drop whatever was painted for an earlier draft and let
    // the model answer after the quiet period.
    if (shownRef.current !== null) { shownRef.current = null; hideGhost() }
    requestAi(allowed.draft)
  }, [cancelAi, gate, historyRef, paint, requestAi, sessionId])

  const visible = useCallback((): boolean => {
    return document.querySelector('.dsh-ph-ghost') !== null
  }, [])

  const current = useCallback((): string | null => {
    return document.querySelector('.dsh-ph-ghost') === null ? null : shownRef.current
  }, [])

  const dismiss = useCallback((): void => {
    dismissedRef.current = liveRef.current.draft
    cancelAi()
    shownRef.current = null
    hideGhost()
  }, [cancelAi, liveRef])

  // Any draft change re-arms the ghost (a dismissed ghost must not stick).
  useEffect(() => { dismissedRef.current = null }, [input.draft])

  // A new conversation owns its own predictions.
  useEffect(() => {
    cacheRef.current.clear()
    shownRef.current = null
    dismissedRef.current = null
    cancelAi()
    hideGhost()
  }, [sessionId, cancelAi])

  // Keep the ghost glued to the draft, caret and viewport: caret moves (arrow
  // keys, clicks, selection), layout shifts and scrolls all move its anchor.
  //
  // Events only queue the work: sync() walks the DOM (host, card, menu, offsets,
  // matcher), and scroll fires dozens of times per frame during a trackpad
  // gesture — running it per event was the 20 fps scroll report (issue #14).
  useEffect(() => {
    const queued = (): void => { scheduleFrame(sync) }
    queued()
    document.addEventListener('selectionchange', queued)
    window.addEventListener('resize', queued)
    window.addEventListener('scroll', queued, true)
    return () => {
      document.removeEventListener('selectionchange', queued)
      window.removeEventListener('resize', queued)
      window.removeEventListener('scroll', queued, true)
      cancelAi()
      hideGhost()
    }
  }, [sync, input.draft, getPrefs().promptCompletion, cancelAi])

  return { sync, visible, current, dismiss }
}
