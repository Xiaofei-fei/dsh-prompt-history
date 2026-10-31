/**
 * The composer's key chain, in one place.
 *
 * Order is the contract here — each step exists because an earlier one must not
 * win: the prediction accepts Tab/→ from anywhere except another text field
 * (the caret wanders while reading a suggestion), then only composer-targeted
 * keys continue past the IME and `/`-menu guards, the manual predict shortcut
 * runs, reverse search owns its keys, the prediction and completion hints take
 * Escape/Tab/→, and the arrows fall through to history browsing last.
 *
 * The hooks are read through a ref updated every render, so the listener is
 * installed once and always sees the current controls.
 *
 * @module dsh-prompt-history/client/useComposerKeys
 */
import { useEffect, useRef } from 'react'
import { COMPOSER_CARD, editorHost, isEditorTarget, setEditorCaret } from './editor.ts'
import { getPrefs } from './prefs.ts'
import type { BrowseControls } from './useBrowse.ts'
import type { CompletionControls } from './useCompletion.ts'
import type { SuggestionControls } from './useSuggestion.ts'
import type { LiveComposer } from './useSuggestion.ts'

/** The `/` and `@` menus render a listbox inside the card while open. */
const OPEN_MENU = '[role="listbox"]'

/** What the composer hands the hook. */
export interface ComposerKeysInput {
  readonly liveRef: { readonly current: LiveComposer }
  readonly historyRef: { readonly current: readonly string[] }
  readonly suggestion: SuggestionControls
  readonly completion: CompletionControls
  readonly browsing: BrowseControls
}

/** One render's view of the controls, read at event time. */
interface KeyApi {
  readonly live: LiveComposer
  readonly history: readonly string[]
  readonly suggestion: SuggestionControls
  readonly completion: CompletionControls
  readonly browsing: BrowseControls
}

/**
 * Install the composer's key listener once.
 * @param input - the live ref and the three control sets.
 */
export function useComposerKeys(input: ComposerKeysInput): void {
  const { liveRef, historyRef } = input
  const apiRef = useRef<KeyApi>({
    live: liveRef.current, history: historyRef.current,
    suggestion: input.suggestion, completion: input.completion, browsing: input.browsing,
  })
  apiRef.current = {
    live: liveRef.current, history: historyRef.current,
    suggestion: input.suggestion, completion: input.completion, browsing: input.browsing,
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const { live, suggestion, completion, browsing } = apiRef.current
      const target = e.target
      // The prediction belongs to the composer even when the caret wandered off
      // (clicking around the page is normal while reading a suggestion): accept
      // Tab or → anywhere except inside another text field.
      const acceptKey = e.key === 'Tab' || e.key === 'ArrowRight'
      if (acceptKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
        && suggestion.visible() && liveRef.current.draft === '') {
        const active = document.activeElement
        const otherField = active instanceof HTMLElement
          && active !== document.body
          && active.closest(COMPOSER_CARD) === null
          && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
        if (!otherField) {
          e.preventDefault()
          e.stopPropagation()
          suggestion.accept()
          return
        }
      }
      if (!isEditorTarget(target)) return
      const card = (target as Element).closest(COMPOSER_CARD)
      if (card === null) return
      // IME composition stays native; the suggestion menu owns the keys.
      if (e.isComposing || e.keyCode === 229) return
      if (card.querySelector(OPEN_MENU) !== null) return
      if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) return

      // Ctrl/Cmd+Shift+Space: predict now. The automatic pass only fires when an
      // empty composer gains focus or a turn ends, so a dismissed (or slow)
      // prediction otherwise has no way back.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'Space' || e.key === ' ')) {
        if (live.draft !== '' || live.phase !== 'plain' || live.removed) return
        e.preventDefault()
        e.stopPropagation()
        suggestion.requestNow()
        return
      }

      // Ctrl+R: start reverse search, or step to the older match.
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'r') {
        browsing.handleCtrlR(e)
        return
      }

      // Active reverse search: typed keys feed the query.
      if (browsing.handleSearchKey(e)) return

      // Context suggestion: Tab accepts the predicted next prompt.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'Escape' && suggestion.visible()) {
          suggestion.dismiss()
          return
        }
        if ((e.key === 'Tab' || e.key === 'ArrowRight') && live.draft === '' && suggestion.accept()) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
      }

      // Prompt completion: Tab (or →) accepts the ghosted suffix, whichever
      // source painted it (history match or model continuation). The ghost only
      // exists while the caret sits at the end of an eligible draft, so the
      // accept path does not re-derive the match and cannot disagree with what
      // the user is looking at.
      if (getPrefs().promptCompletion && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'Escape' && completion.visible()) {
          completion.dismiss()
          return
        }
        if ((e.key === 'Tab' || (e.key === 'ArrowRight' && !e.shiftKey)) && !e.shiftKey) {
          const suffix = completion.current()
          const host = editorHost()
          if (suffix !== null && suffix !== '' && host !== null) {
            e.preventDefault()
            e.stopPropagation()
            const actions = live.inputActions
            let inserted = false
            if (typeof actions.captureInsertion === 'function' && typeof actions.insertText === 'function') {
              try { inserted = actions.insertText(suffix, actions.captureInsertion() as never) === true } catch { inserted = false }
            }
            if (!inserted) {
              // Legacy hosts (DSH <= 0.1.x) have no insertText: replace the
              // draft and park the caret after the accepted suffix.
              const full = live.draft + suffix
              actions.setDraft?.(full)
              setEditorCaret(host, full.length)
            }
            completion.sync()
            return
          }
        }
      }

      // Arrow keys: prefix search (non-empty draft) or plain browse.
      browsing.handleArrow(e)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, [liveRef])
}
