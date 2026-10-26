/**
 * Clipboard behaviour for the composer: terminal-style right-click paste, the
 * two copy-on-select modes, the selection toolbar (复制 / 引用 / 侧聊追问), and
 * the quote insertion that puts the selected text in the composer as a
 * markdown blockquote.
 *
 * Both halves install document-level capture listeners once; everything they
 * need at event time comes through the composer's live ref, so no listener is
 * ever re-registered for a draft or settings change.
 *
 * @module dsh-prompt-history/client/useClipboard
 */
import { useEffect } from 'react'
import {
  flashCopied, hideSelectionToolbar, showSelectionToolbar,
} from './feedback.ts'
import { T } from './i18n.ts'
import {
  editorHost, editorSelectedText, editorSelectionOffsets, focusEditor, isEditorTarget, setEditorCaret,
} from './editor.ts'
import { getPrefs } from './prefs.ts'
import { quoteBlock, sendToSideChat } from './bridge.ts'
import type { LiveComposer } from './useSuggestion.ts'

/** What the composer hands the hook. */
export interface ClipboardInput {
  /** Live composer state (draft, phase, removed, inputActions). */
  readonly liveRef: { readonly current: LiveComposer }
}

/**
 * Install the composer's clipboard behaviour.
 * @param input - the composer's live ref.
 */
export function useClipboard(input: ClipboardInput): void {
  const { liveRef } = input

  // Right-click paste (terminal style): a right-click on the composer editor
  // pastes the clipboard directly, like a Linux terminal.
  useEffect(() => {
    const pasteInto = (host: HTMLElement): void => {
      // The composer's own paste handler (chip matching, image intake) fires on
      // the native paste event execCommand dispatches — full Ctrl+V parity.
      focusEditor(host)
      if (document.execCommand('paste')) return
      // Fallback: read text and splice it at the selection ourselves.
      void navigator.clipboard.readText().then(
        (text) => {
          if (text === '') return
          const sel = editorSelectionOffsets(host)
          const start = sel?.start ?? liveRef.current.draft.length
          const end = sel?.end ?? start
          const draft = liveRef.current.draft
          const next = draft.slice(0, start) + text + draft.slice(end)
          liveRef.current.inputActions.setDraft?.(next)
          const caret = start + text.length
          requestAnimationFrame(() => { setEditorCaret(host, caret) })
        },
        () => { /* clipboard read denied: nothing to paste */ },
      )
    }

    const onContextMenu = (e: MouseEvent): void => {
      const target = e.target
      if (!isEditorTarget(target)) return
      const live = liveRef.current
      if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) return
      // Toggle off: leave the native context menu alone.
      if (!getPrefs().rightClickPaste) return
      e.preventDefault()
      e.stopPropagation()
      const host = editorHost()
      if (host === null) return
      // Right-click does not focus in browsers; focus so the caret/selection is
      // authoritative for the paste (preventScroll: the caret is where the user
      // sees it already).
      focusEditor(host)
      pasteInto(host)
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => { document.removeEventListener('contextmenu', onContextMenu, true) }
  }, [liveRef])

  // Selection-driven copy, two modes (Settings → 终端式输入): 'auto' copies any
  // stable non-empty selection directly (terminal-style, floods the system
  // clipboard — opt-in); 'toolbar' (default) shows an explicit 复制 button above
  // the selection and copies only when clicked (nothing writes the clipboard on
  // its own). Both modes apply anywhere in the page — the composer editor
  // (chip-aware via the composer's own copy handler), chat messages, code
  // blocks. A stable-window debounce keeps mid-drag partial selections out; the
  // toolbar is dismissed by collapsing the selection, Escape, scrolling, or
  // clicking elsewhere.
  useEffect(() => {
    let timer: number | undefined
    let lastKey = ''
    let dragStartedInEditor = false

    const selectionRect = (): DOMRect | null => {
      try {
        const sel = document.getSelection()
        if (sel !== null && !sel.isCollapsed && sel.rangeCount > 0) {
          const rect = sel.getRangeAt(0).getBoundingClientRect()
          if (rect.width > 0 || rect.height > 0) return rect
        }
      } catch { /* no range for textarea selections in some engines */ }
      const host = editorHost()
      if (host !== null && document.activeElement === host) {
        const rect = host.getBoundingClientRect()
        if (rect.width > 0 || rect.height > 0) return rect
      }
      return null
    }

    const copyText = (text: string, key: string, focusHost?: HTMLElement): void => {
      if (key === lastKey) return // unchanged selection: already copied
      lastKey = key
      if (focusHost !== undefined && document.activeElement !== focusHost) {
        focusEditor(focusHost)
      }
      let ok = false
      try {
        ok = document.execCommand('copy')
      } catch {
        ok = false // flaky across engines; fall back to the clipboard API
      }
      if (ok) {
        flashCopied(selectionRect())
        return
      }
      if (text === '') return
      navigator.clipboard.writeText(text).then(
        () => { flashCopied(selectionRect()) },
        (error) => { console.warn('[dsh-prompt-history] clipboard copy failed:', error) },
      )
    }

    const copySelection = (): void => {
      const live = liveRef.current
      if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) return

      // 1) Composer editor selection (the composer's own handler expands chips;
      //    only while it is the active selection or a drag started in it — a
      //    stale editor selection must not shadow a chat selection).
      const host = editorHost()
      if (host !== null && (document.activeElement === host || dragStartedInEditor)) {
        const text = editorSelectedText(host)
        if (text !== '') {
          copyText(text, `ed:${text}`, host)
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
      dragStartedInEditor = isEditorTarget(e.target)
    }

    // 引用: insert the FULL selected text into the composer as a markdown quote
    // block (each line prefixed with '> ', Codex-style) — everything is visible
    // and editable in the input. A blank line before (unless the draft starts
    // there) and a blank line after keep the quote distinct from the user's own
    // next input, which begins on a fresh line after the caret.
    const quoteSelection = (): void => {
      const live = liveRef.current
      if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) return
      const host = editorHost()
      if (host === null) return
      // Where the selection LIVES decides which reader to use — not which
      // element has focus. The composer keeps focus after sending, so a user
      // selecting a message and pressing 引用 would otherwise have the empty
      // in-composer selection read instead and nothing would happen.
      const sel = document.getSelection()
      const selectionInHost = sel !== null && sel.rangeCount > 0 && sel.anchorNode !== null && host.contains(sel.anchorNode)
      const hostFocused = selectionInHost
      let text = ''
      if (selectionInHost) {
        text = editorSelectedText(host)
      } else if (sel !== null && !sel.isCollapsed) {
        text = sel.toString()
      }
      if (text.trim() === '') return
      // A plain markdown blockquote (each line prefixed with '> '), matching how
      // other DSH quote plugins format it — minimal and clean in the input,
      // rendered as a proper blockquote when sent.
      const quoted = '> ' + text.replace(/\n/g, '\n> ')
      const draft = live.draft
      const caret = hostFocused ? (editorSelectionOffsets(host)?.start ?? draft.length) : draft.length
      // A blank line before the quote separates it from prior text; a SINGLE
      // newline after lets the next input start on the line right below it.
      const lead = caret > 0 && draft[caret - 1] !== '\n' ? '\n\n' : caret > 0 ? '\n' : ''
      const tail = '\n'
      const next = draft.slice(0, caret) + lead + quoted + tail + draft.slice(caret)
      live.inputActions.setDraft?.(next)
      const pos = caret + lead.length + quoted.length + tail.length
      requestAnimationFrame(() => {
        focusEditor(host)
        setEditorCaret(host, pos)
      })
      flashCopied(null, T('pill.quoted'))
    }

    const onSelectionChange = (): void => {
      const live = liveRef.current
      if (live.phase === 'adjudicating' || live.phase === 'submitting' || live.removed) {
        hideSelectionToolbar()
        return
      }
      const mode = getPrefs().copyMode
      const host = editorHost()
      const editorActive = host !== null
        && (document.activeElement === host || dragStartedInEditor)
        && editorSelectedText(host) !== ''
      const sel = document.getSelection()
      const domActive = sel !== null && !sel.isCollapsed
      if (!editorActive && !domActive) {
        window.clearTimeout(timer)
        hideSelectionToolbar()
        return
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (mode === 'auto') {
          copySelection()
        } else {
          const rect = selectionRect()
          if (rect !== null) {
            // The action only exists while the feature is on: a disabled side
            // chat must not put a button in the toolbar that cannot do anything.
            const askInSideChat = getPrefs().sideChat
              ? (): void => {
                  const selection = document.getSelection()
                  const text = selection !== null && !selection.isCollapsed ? selection.toString() : ''
                  if (text.trim() === '') return
                  sendToSideChat(quoteBlock(text))
                }
              : undefined
            showSelectionToolbar(rect, quoteSelection, askInSideChat)
          }
        }
      }, 150)
    }

    // Toolbar dismissal: Escape, scrolling anywhere, and pointer-down outside
    // the toolbar itself (its own mousedown is suppressed to keep the
    // selection, and the click handler copies before any hide).
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hideSelectionToolbar()
    }
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Element && e.target.closest('.dsh-ph-toolbar') !== null) return
      hideSelectionToolbar()
    }
    // Cheap early-out: scrolling the conversation with no toolbar on screen must
    // not touch the DOM at all.
    const onScroll = (): void => {
      if (document.querySelector('.dsh-ph-toolbar') === null) return
      hideSelectionToolbar()
    }

    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', hideSelectionToolbar)
    console.info('[dsh-prompt-history] copy modes active (toolbar/auto)')
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', hideSelectionToolbar)
      window.clearTimeout(timer)
      hideSelectionToolbar()
    }
  }, [liveRef])
}
