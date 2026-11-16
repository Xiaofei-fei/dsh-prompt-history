/**
 * History browsing and reverse search, as key handlers.
 *
 * Two state machines and their keys:
 *
 * - ↑/↓ browse: a plain walk over the list (Down at the live line stays native),
 *   or a bash-style prefix search when the draft is non-empty; the bottom edge
 *   restores the pending line, and an edit ends the browse session.
 * - Ctrl+R reverse search: starts on the newest entry, prints feed the query,
 *   Backspace shortens it, Enter keeps the match, Escape restores the draft, and
 *   any other key exits the search while keeping the match.
 *
 * Each handler returns whether it consumed the event, so the composer keeps the
 * original key order (this module never reorders the caller's chain).
 *
 * @module dsh-prompt-history/client/useBrowse
 */
import { useCallback } from 'react'
import type { BrowseState, SearchState } from './browse.ts'
import { containsMatches, prefixMatches, RESET_BROWSE } from './browse.ts'
import { hideSearchOverlay, hideSelectionToolbar, showSearchOverlay } from './feedback.ts'
import { caretOnFirstLine, editorHost } from './editor.ts'
import type { LiveComposer } from './useSuggestion.ts'

/** What the composer hands the hook. */
export interface BrowseInput {
  readonly liveRef: { readonly current: LiveComposer }
  readonly historyRef: { readonly current: readonly string[] }
  readonly browseRef: { current: BrowseState }
  readonly searchRef: { current: SearchState | null }
}

/** The key handlers. */
export interface BrowseControls {
  /** Ctrl+R: start a search, or step to the older match. */
  handleCtrlR(event: KeyboardEvent): boolean
  /** Keys while a reverse search is running (including the exit key). */
  handleSearchKey(event: KeyboardEvent): boolean
  /** ↑/↓ browse or prefix search. */
  handleArrow(event: KeyboardEvent): boolean
  /** Whether a reverse search is running. */
  searching(): boolean
}

/**
 * Own history browsing and reverse search for one composer.
 * @param input - the live composer state and the three refs.
 * @returns the key handlers.
 */
export function useBrowse(input: BrowseInput): BrowseControls {
  const { liveRef, historyRef, browseRef, searchRef } = input

  const recall = useCallback((index: number): string => historyRef.current[index] ?? '', [historyRef])

  const handleCtrlR = useCallback((event: KeyboardEvent): boolean => {
    const active = searchRef.current
    const history = historyRef.current
    if (active !== null) {
      event.preventDefault()
      event.stopPropagation()
      const matches = containsMatches(history, active.query)
      const position = matches.indexOf(active.matchIndex)
      if (position > 0) {
        const matchIndex = matches[position - 1] ?? 0
        searchRef.current = { ...active, matchIndex }
        liveRef.current.inputActions.setDraft?.(recall(matchIndex))
        showSearchOverlay(active.query, recall(matchIndex))
      }
      return true
    }
    if (history.length === 0) return false
    event.preventDefault()
    event.stopPropagation()
    hideSelectionToolbar()
    const matchIndex = history.length - 1
    searchRef.current = { preSearch: liveRef.current.draft, query: '', matchIndex }
    liveRef.current.inputActions.setDraft?.(recall(matchIndex))
    showSearchOverlay('', recall(matchIndex))
    return true
  }, [historyRef, liveRef, recall, searchRef])

  const handleSearchKey = useCallback((event: KeyboardEvent): boolean => {
    const active = searchRef.current
    if (active === null) return false
    const history = historyRef.current
    const setDraft = (text: string): void => { liveRef.current.inputActions.setDraft?.(text) }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      searchRef.current = null
      hideSearchOverlay()
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      searchRef.current = null
      hideSearchOverlay()
      setDraft(active.preSearch)
      return true
    }
    if (event.key === 'Backspace') {
      event.preventDefault()
      event.stopPropagation()
      const query = active.query.slice(0, -1)
      const matches = containsMatches(history, query)
      if (query === '') {
        const matchIndex = history.length - 1
        searchRef.current = { ...active, query, matchIndex }
        setDraft(recall(matchIndex))
        showSearchOverlay('', recall(matchIndex))
      } else if (matches.length > 0) {
        const matchIndex = matches[matches.length - 1] ?? 0
        searchRef.current = { ...active, query, matchIndex }
        setDraft(recall(matchIndex))
        showSearchOverlay(query, recall(matchIndex))
      } else {
        searchRef.current = { ...active, query, matchIndex: -1 }
        showSearchOverlay(query, '(无匹配)')
      }
      return true
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      const query = active.query + event.key
      const matches = containsMatches(history, query)
      const matchIndex = matches.length > 0 ? (matches[matches.length - 1] ?? 0) : -1
      searchRef.current = { ...active, query, matchIndex }
      if (matchIndex >= 0) {
        setDraft(recall(matchIndex))
        showSearchOverlay(query, recall(matchIndex))
      } else {
        setDraft(active.preSearch)
        showSearchOverlay(query, '(无匹配)')
      }
      return true
    }
    // Any other key exits the search, keeping the current match (the key then
    // applies to the draft natively).
    searchRef.current = null
    hideSearchOverlay()
    return true
  }, [historyRef, liveRef, recall, searchRef])

  const handleArrow = useCallback((event: KeyboardEvent): boolean => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
    const history = historyRef.current
    if (history.length === 0) return false
    const browse = browseRef.current
    // Native caret-down on the live line.
    if (event.key === 'ArrowDown' && browse.index === -1) return false
    // ↑ only starts browsing from the editor's first line: while a line sits
    // above the caret, the arrow keeps moving it (readline semantics), so a
    // multi-line draft stays editable. Unmeasurable geometry keeps the old
    // behavior (browse) rather than silently swallowing the key.
    if (event.key === 'ArrowUp' && browse.index === -1) {
      const host = editorHost()
      if (host !== null && caretOnFirstLine(host) === false) return false
    }
    event.preventDefault()
    event.stopPropagation()
    const setDraft = (text: string): void => { liveRef.current.inputActions.setDraft?.(text) }

    if (event.key === 'ArrowUp') {
      if (browse.index === -1) {
        const draft = liveRef.current.draft
        if (draft !== '') {
          // Prefix search: the typed line is the prefix; recall the most recent
          // entry starting with it (bash history-search-backward).
          const matches = prefixMatches(history, draft)
          if (matches.length === 0) return true // no prefix match: keep the line
          const index = matches[matches.length - 1] ?? 0
          browseRef.current = { index, saved: draft, lastSet: recall(index), prefix: draft }
          setDraft(recall(index))
        } else {
          // Plain recall: save the live line, recall the newest prompt.
          const index = history.length - 1
          browseRef.current = { index, saved: '', lastSet: recall(index) }
          setDraft(recall(index))
        }
      } else if (browse.prefix !== undefined) {
        // Walk further back through prefix matches.
        const matches = prefixMatches(history, browse.prefix)
        const position = matches.indexOf(browse.index)
        if (position > 0) {
          const index = matches[position - 1] ?? 0
          browseRef.current = { ...browse, index, lastSet: recall(index) }
          setDraft(recall(index))
        }
      } else {
        const index = Math.max(0, browse.index - 1)
        browseRef.current = { ...browse, index, lastSet: recall(index) }
        setDraft(recall(index))
      }
      return true
    }

    // ArrowDown while browsing.
    if (browse.prefix !== undefined) {
      const matches = prefixMatches(history, browse.prefix)
      const position = matches.indexOf(browse.index)
      if (position < matches.length - 1) {
        const index = matches[position + 1] ?? 0
        browseRef.current = { ...browse, index, lastSet: recall(index) }
        setDraft(recall(index))
      } else {
        // Bottom edge of the prefix matches: restore the typed prefix.
        browseRef.current = RESET_BROWSE
        setDraft(browse.saved)
      }
    } else if (browse.index + 1 >= history.length) {
      // Bottom edge: restore the saved live line and stop browsing.
      browseRef.current = RESET_BROWSE
      setDraft(browse.saved)
    } else {
      const index = browse.index + 1
      browseRef.current = { ...browse, index, lastSet: recall(index) }
      setDraft(recall(index))
    }
    return true
  }, [browseRef, historyRef, liveRef, recall])

  const searching = useCallback((): boolean => searchRef.current !== null, [searchRef])

  return { handleCtrlR, handleSearchKey, handleArrow, searching }
}
