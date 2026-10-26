/**
 * History-completion ghost for the composer.
 *
 * The ghost is a suffix of a past prompt shown after the caret. Only the state
 * machine lives here: when it is allowed (completion enabled, no `/` or `@` menu
 * open, machine idle, caret at the end of the draft), and the Esc dismissal that
 * lasts until the draft changes.
 *
 * @module dsh-prompt-history/client/useCompletion
 */
import { useCallback, useEffect, useRef } from 'react'
import {
  COMPOSER_CARD, editorHost, editorSelectionOffsets,
} from './editor.ts'
import { completionEligible, matchCompletion } from './completion.ts'
import { hideGhost, showGhost } from './ghost.ts'
import { getPrefs } from './prefs.ts'
import { scheduleFrame } from './frame.ts'
import type { LiveComposer } from './useSuggestion.ts'

/** What the composer hands the hook. */
export interface CompletionInput {
  readonly liveRef: { readonly current: LiveComposer }
  /** History the suffix is matched against (oldest → newest). */
  readonly historyRef: { readonly current: readonly string[] }
  /** Current draft: an edit ends the dismissal. */
  readonly draft: string
}

/** The controls the composer binds. */
export interface CompletionControls {
  /** Re-evaluate the ghost (draft, caret, menu state, idle state). */
  sync(): void
  /** Whether a suffix is currently ghosted. */
  visible(): boolean
  /** Esc: suppress the ghost for this exact draft. */
  dismiss(): void
}

/** The `/` and `@` menus render a listbox inside the card while open. */
const OPEN_MENU = '[role="listbox"]'

/**
 * Own the completion ghost for one composer.
 * @param input - live composer state, the history list, and the draft.
 * @returns the controls, plus the effects that keep the ghost in sync.
 */
export function useCompletion(input: CompletionInput): CompletionControls {
  const { liveRef, historyRef } = input
  const dismissedRef = useRef<string | null>(null)

  const sync = useCallback((): void => {
    if (!getPrefs().promptCompletion) { hideGhost(); return }
    const host = editorHost()
    if (host === null) { hideGhost(); return }
    const card = document.querySelector<HTMLElement>(COMPOSER_CARD)
    if (card !== null && card.querySelector(OPEN_MENU) !== null) { hideGhost(); return }
    const live = liveRef.current
    if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) { hideGhost(); return }
    const current = live.draft
    if (!completionEligible(current)) { hideGhost(); return }
    if (dismissedRef.current === current) { hideGhost(); return }
    // Only complete from the end of the draft: mid-line edits stay untouched.
    const offsets = editorSelectionOffsets(host)
    if (offsets === null || offsets.start !== current.length || offsets.end !== current.length) { hideGhost(); return }
    const suffix = matchCompletion(current, historyRef.current)
    if (suffix === null) { hideGhost(); return }
    showGhost(suffix, host)
  }, [historyRef, liveRef])

  const visible = useCallback((): boolean => {
    const node = document.querySelector('.dsh-ph-ghost')
    return node !== null
  }, [])

  const dismiss = useCallback((): void => {
    dismissedRef.current = liveRef.current.draft
    hideGhost()
  }, [liveRef])

  // Any draft change re-arms the ghost (a dismissed ghost must not stick).
  useEffect(() => { dismissedRef.current = null }, [input.draft])

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
      hideGhost()
    }
  }, [sync, input.draft, getPrefs().promptCompletion])

  return { sync, visible, dismiss }
}
