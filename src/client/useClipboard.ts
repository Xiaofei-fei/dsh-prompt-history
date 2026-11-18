/**
 * Clipboard behaviour for the composer: terminal-style right-click paste, the
 * two copy-on-select modes, the selection toolbar (复制 / 引用 / 侧聊追问), and
 * the quote that queues selected text as a note instead of writing it into the
 * draft (the note card above the composer owns it until the message is sent).
 *
 * Both halves install document-level capture listeners once; everything they
 * need at event time comes through the composer's live ref, so no listener is
 * ever re-registered for a draft or settings change.
 *
 * @module dsh-prompt-history/client/useClipboard
 */
import { useEffect } from 'react'
import {
  flashCopied, flashQuoteRow, hideSelectionToolbar, showQuoteComposer, showSelectionToolbar,
} from './feedback.ts'
import { captureQuoteContext } from './quoteContext.ts'
import { addQuoteEntry, selectionAnchor } from './quoteMarks.tsx'
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
  /** Session that owns the queued quote notes. */
  readonly sessionId: string | undefined
}

/**
 * Other plugins' text-selection toolbars.
 *
 * `.dshq-actions` is the historical third-party quote bar. The official host
 * renders its registry-driven action surface as
 * `[data-text-interaction-surface]`, whose `aria-hidden` flips to `"false"` while
 * an interaction (e.g. message-quotes) is active; its action is a CSS-module
 * button, so a class check cannot see it.
 */
const FOREIGN_BAR = '.dshq-actions'
const FOREIGN_SURFACE_ACTION = '[data-text-interaction-surface]:not([aria-hidden="true"]) button'

/**
 * Whether another plugin is showing a quote/text toolbar for this selection.
 * @returns true when a foreign toolbar is on screen.
 */
function foreignToolbarPresent(): boolean {
  if (document.querySelector(FOREIGN_BAR) !== null) return true
  const action = document.querySelector<HTMLElement>(FOREIGN_SURFACE_ACTION)
  return action !== null && action.getClientRects().length > 0
}

let foreignWatch: MutationObserver | null = null

/** Stop watching for a foreign toolbar (idempotent). */
function stopForeignWatch(): void {
  foreignWatch?.disconnect()
  foreignWatch = null
}

/**
 * Hide our toolbar if another plugin's toolbar appears after ours.
 *
 * The official surface usually activates on the same `selectionchange`, but its
 * React commit and the plugin's own gesture dispatch can land a frame later; a
 * one-shot check at show time was the race this guard removes. The observer
 * lives only while our bar is on screen (it self-stops on the removal).
 */
function watchForeignToolbar(): void {
  if (foreignWatch !== null) return
  foreignWatch = new MutationObserver(() => {
    if (!getPrefs().quoteYield || document.querySelector('.dsh-ph-toolbar') === null) {
      stopForeignWatch()
      return
    }
    if (foreignToolbarPresent()) { stopForeignWatch(); hideSelectionToolbar() }
  })
  foreignWatch.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-hidden', 'class', 'style', 'hidden'],
  })
}

/**
 * Replay the whole clipboard into the composer through its own paste handler.
 *
 * `execCommand('paste')` is blocked on ordinary Chromium web content and
 * `readText()` only carries `text/plain`, which is why right-click used to drop
 * images and files. The async Clipboard API can read every type; rebuilding a
 * DataTransfer and dispatching a paste event hands the content to the composer
 * (image intake, file attachments, chip matching) exactly like Ctrl+V.
 * @param host - the composer editor host.
 * @returns whether a paste event was dispatched.
 */
async function pasteAllTypes(host: HTMLElement): Promise<boolean> {
  if (typeof navigator.clipboard?.read !== 'function') return false
  let items: ClipboardItem[]
  try {
    items = await navigator.clipboard.read()
  } catch {
    // Permission denied or clipboard-read unsupported: fall back to text.
    return false
  }
  if (items.length === 0) return false
  const data = new DataTransfer()
  for (const item of items) {
    for (const type of item.types) {
      const blob = await item.getType(type).catch(() => null)
      if (blob === null) continue
      if (type.startsWith('text/') || type === 'text/uri-list') {
        data.setData(type, await blob.text())
      } else {
        data.items.add(new File([blob], clipboardFileName(type), { type }))
      }
    }
  }
  if (data.types.length === 0) return false
  host.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  return true
}

/**
 * File name for a pasted blob, derived from its MIME type.
 * @param type - the clipboard item's MIME type.
 * @returns a safe `paste.<ext>` name.
 */
function clipboardFileName(type: string): string {
  const slash = type.indexOf('/')
  const extension = slash < 0 ? 'bin' : type.slice(slash + 1)
  return `paste.${extension.replace(/[^a-z0-9.+-]/gi, '') || 'bin'}`
}

/**
 * Install the composer's clipboard behaviour.
 * @param input - the composer's live ref.
 */
export function useClipboard(input: ClipboardInput): void {
  const { liveRef, sessionId } = input

  // Right-click paste (terminal style): a right-click on the composer editor
  // pastes the clipboard directly, like a Linux terminal.
  useEffect(() => {
    const pasteInto = (host: HTMLElement): void => {
      focusEditor(host)
      // Chromium refuses a programmatic paste on ordinary web content, so this
      // is usually false; it stays first for hosts that do allow it.
      if (document.execCommand('paste')) return
      void pasteClipboard(host)
    }

    const pasteClipboard = async (host: HTMLElement): Promise<void> => {
      // Every clipboard type goes through the composer's own paste pipeline.
      if (await pasteAllTypes(host)) return
      // Fallback: only text is readable here (no clipboard-read, or it was
      // denied), so splice it at the caret ourselves.
      const text = await navigator.clipboard.readText().catch(() => '')
      if (text === '') return
      const sel = editorSelectionOffsets(host)
      const start = sel?.start ?? liveRef.current.draft.length
      const end = sel?.end ?? start
      const draft = liveRef.current.draft
      const next = draft.slice(0, start) + text + draft.slice(end)
      liveRef.current.inputActions.setDraft?.(next)
      const caret = start + text.length
      requestAnimationFrame(() => { setEditorCaret(host, caret) })
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


    // 引用: capture what was selected AND where it came from, then put a block in
    // the composer that carries the text, an optional comment and the source turn
    // ("※ 引自第 N 轮 · 助手"). A code selection arrives as a fenced block so the
    // model reads real code instead of a paragraph of it.
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
      if (selectionInHost) {
        // A selection inside the composer is an edit, not a quote.
        return
      }
      const context = captureQuoteContext()
      if (context === null) return
      // Anchor now: the comment dialog (and the click on it) clears the DOM
      // selection, and the badge needs the text the quote actually came from.
      const anchor = selectionAnchor()
      const rect = selectionRect()
      // The quote becomes a note above the composer, not text in the draft: the
      // draft stays empty until the user sends, and the note is merged into the
      // message at that moment.
      const apply = (comment: string, perItem: boolean): void => {
        addQuoteEntry(sessionId, context.text, anchor, {
          fence: context.fence,
          comment,
          perItem,
        })
        flashQuoteRow(context.row)
      }
      if (!getPrefs().quoteComment) {
        apply('', false)
        return
      }
      void showQuoteComposer(
        rect ?? new DOMRect(window.innerWidth / 2 - 180, window.innerHeight / 2, 0, 0),
        context.text,
        false,
      ).then((result) => {
        // Cancelled: nothing was inserted and the draft is untouched.
        if (result === null) return
        apply(result.comment, result.perItem)
      })
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
          // Another quote plugin shows its own bar for the same selection
          // (official text-interaction surface or a `.dshq-actions` bar); two
          // toolbars stacked on one selection is worse than either, so ours
          // stands down when that pref is on.
          if (getPrefs().quoteYield && foreignToolbarPresent()) {
            hideSelectionToolbar()
            return
          }
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
            // Coverage for an interaction that activates after this timer.
            if (getPrefs().quoteYield) watchForeignToolbar()
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
