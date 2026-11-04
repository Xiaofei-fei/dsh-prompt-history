/**
 * The side-chat composer: the same prompt affordances as the main composer,
 * but on a panel-owned <textarea> instead of the shell's editor.
 *
 * Reused as-is: the history matcher (`browse.ts`), the completion matcher
 * (`completion.ts`), the host prediction bridge (`suggest.ts`) and the ghost
 * overlay (`suggestOverlay.ts`). Only the editor wiring differs — the shell
 * composer reads its caret through the DOM selection, this one owns its value.
 *
 * Keys: ↑/↓ browse (prefix search when the line is non-empty), Tab or → accept
 * (history suffix, model continuation, or the predicted prompt while empty),
 * Esc dismiss, Enter send, Shift+Enter newline.
 *
 * @module dsh-prompt-history/client/panelComposer
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { completionEligible, matchCompletion } from './completion.ts'
import { prefixMatches, RESET_BROWSE, stepPrefix, type BrowseState } from './browse.ts'
import { getPrefs, subscribePrefs } from './prefs.ts'
import { getActiveBridge, subscribeBridge } from './suggest.ts'
import { hideSuggestion, showPending, showSuggestion, suggestionVisible } from './suggestOverlay.ts'
import { T } from './i18n.ts'

/** Props of the panel composer. */
export interface PromptComposerProps {
  /** Current draft (owned by the parent so quotes can be appended). */
  readonly value: string
  readonly onChange: (value: string) => void
  /** Enter: hand the draft to the thread. */
  readonly onSubmit: () => void
  /** A turn is running: the parent shows Stop and the composer stops predicting. */
  readonly running: boolean
  /** Prompt history for this thread, oldest → newest. */
  readonly history: readonly string[]
  /** Recent transcript for the model prediction. */
  readonly predictContext: () => string
  readonly placeholder: string
}

/** Debounce before asking the host to predict. */
const PREDICT_DELAY = 450
/** Shorter drafts are too ambiguous to continue usefully. */
const AI_MIN_DRAFT = 3

/** The side-chat composer entry. */
export function PromptComposer(props: PromptComposerProps): JSX.Element {
  const { value, onChange, onSubmit, running, history, predictContext, placeholder } = props
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const browseRef = useRef<BrowseState>(RESET_BROWSE)
  const predictionRef = useRef<string | null>(null)
  const dismissedRef = useRef<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [bridged, setBridged] = useState(() => getActiveBridge() !== null)
  /** The model's continuation for the current draft (null while unknown). */
  const [aiSuffix, setAiSuffix] = useState<string | null>(null)
  const aiTimerRef = useRef<number | null>(null)
  const aiAbortRef = useRef<AbortController | null>(null)

  useEffect(() => subscribeBridge(() => { setBridged(getActiveBridge() !== null) }), [])

  /** The history suffix that would complete the current draft. */
  const historySuffix = useMemo(() => matchCompletion(value, history), [value, history])
  /** What Tab accepts: history first (free and exact), then the model's tail. */
  const suffix = historySuffix ?? aiSuffix

  const clearPrediction = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    abortRef.current?.abort()
    abortRef.current = null
    predictionRef.current = null
    hideSuggestion()
  }, [])

  /** Drop a scheduled or in-flight continuation for the draft that just changed. */
  const clearContinuation = useCallback((): void => {
    if (aiTimerRef.current !== null) {
      window.clearTimeout(aiTimerRef.current)
      aiTimerRef.current = null
    }
    aiAbortRef.current?.abort()
    aiAbortRef.current = null
    setAiSuffix(null)
  }, [])

  /** Ask the host for the next prompt and ghost it inside the empty field. */
  const requestPrediction = useCallback((): void => {
    const area = areaRef.current
    if (area === null) return
    if (!getPrefs().contextSuggest || !getPrefs().sideChat) { clearPrediction(); return }
    if (value !== '' || running) { clearPrediction(); return }
    const bridge = getActiveBridge()
    if (bridge === null) return
    const context = predictContext()
    if (context.trim() === '' || dismissedRef.current === context) { clearPrediction(); return }
    clearPrediction()
    const controller = new AbortController()
    abortRef.current = controller
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      showPending(T('suggest.pending'), area, { hidePlaceholder: false })
      void bridge.fetch(context, { signal: controller.signal }).then((text) => {
        if (controller.signal.aborted) return
        if (text === '') { hideSuggestion(); return }
        predictionRef.current = text
        showSuggestion(text, T('suggest.accept'), area, { hidePlaceholder: false })
      })
    }, PREDICT_DELAY)
  }, [clearPrediction, predictContext, running, value])

  // A draft, a running turn or a closed panel all invalidate the ghost.
  useEffect(() => {
    if (value !== '' || running) clearPrediction()
  }, [value, running, clearPrediction])

  // The typed draft is the continuation seed: history first, then the model.
  // Re-runs on every keystroke, so the pending timer always belongs to the text
  // on screen and a stale answer can never be painted.
  useEffect(() => {
    clearContinuation()
    if (value === '' || running || historySuffix !== null) return
    if (!getPrefs().promptCompletion || !getPrefs().aiCompletion) return
    if (!completionEligible(value) || value.trim().length < AI_MIN_DRAFT) return
    const bridge = getActiveBridge()
    if (bridge === null) return
    aiTimerRef.current = window.setTimeout(() => {
      aiTimerRef.current = null
      const controller = new AbortController()
      aiAbortRef.current = controller
      void bridge.fetch(predictContext(), { draft: value, signal: controller.signal }).then((text) => {
        if (controller.signal.aborted || text === '') return
        setAiSuffix(text)
      })
    }, PREDICT_DELAY)
  }, [value, running, historySuffix, predictContext, clearContinuation])

  // Re-arm the prediction when the transcript changes (a finished turn).
  useEffect(() => {
    if (value === '' && !running) requestPrediction()
    return () => { /* the next effect run or unmount clears it */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predictContext, running, bridged])

  useEffect(() => () => { clearPrediction(); clearContinuation() }, [clearPrediction, clearContinuation])
  useEffect(() => subscribePrefs(() => { if (value === '' && !running) requestPrediction() }), [requestPrediction, value, running])

  /** Accept whatever hint is on screen. @returns whether something was accepted. */
  const accept = (): boolean => {
    const predicted = predictionRef.current
    if (predicted !== null && suggestionVisible()) {
      clearPrediction()
      onChange(predicted)
      return true
    }
    if (suffix !== null) {
      clearContinuation()
      onChange(value + suffix)
      return true
    }
    return false
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // ↑/↓ browse, prefix search when the line is not empty
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      event.preventDefault()
      const delta = event.key === 'ArrowUp' ? -1 : 1
      const browse = browseRef.current
      if (browse.index === -1) {
        if (delta === 1) return
        const matches = prefixMatches(history, value)
        if (matches.length === 0) return
        const index = matches[matches.length - 1] ?? 0
        browseRef.current = { index, saved: value, lastSet: history[index] ?? '', prefix: value }
        onChange(history[index] ?? '')
        return
      }
      const stepped = stepPrefix(history, browse, delta)
      if (stepped === null) {
        browseRef.current = RESET_BROWSE
        onChange(browse.saved)
        return
      }
      browseRef.current = stepped.state
      onChange(stepped.text)
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.code === 'Space' || event.key === ' ')) {
      event.preventDefault()
      dismissedRef.current = null
      requestPrediction()
      return
    }
    if (event.key === 'Escape') {
      if (suggestionVisible()) {
        dismissedRef.current = predictContext()
        clearPrediction()
        return
      }
      if (suffix !== null) return
      return
    }
    if ((event.key === 'Tab' || event.key === 'ArrowRight') && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (accept()) event.preventDefault()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      clearPrediction()
      clearContinuation()
      onSubmit()
    }
  }

  return (
    <div className="dsh-ph-panelComposer">
      {suffix !== null && (
        <div className="dsh-ph-panelHint">
          {T('panel.hint')}：<span className="dsh-ph-panelHintText">{suffix}</span>
        </div>
      )}
      <textarea
        ref={areaRef}
        className="dsh-ph-sidechat-input"
        rows={2}
        value={value}
        placeholder={placeholder}
        onChange={(event) => { onChange(event.target.value) }}
        onKeyDown={onKeyDown}
        onFocus={() => { if (value === '' && !running) requestPrediction() }}
      />
    </div>
  )
}
