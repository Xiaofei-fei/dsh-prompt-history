/**
 * The prompt-template button and its floating panel.
 *
 * A 📋 button sits next to the ✨ enhancement action in the composer's input
 * slot. Clicking it opens a panel anchored to the button: the saved templates,
 * a filter, and one click to write a template's body into the composer at the
 * caret. New templates come from the current draft, so saving is "type it,
 * then keep it" rather than a separate editor.
 *
 * Insertion goes through the same host capability the prediction and the quote
 * marks use (`captureInsertion()` + `insertText()`), with `setDraft` as the
 * fallback for older hosts. Row mousedown is prevented so the composer keeps
 * focus and its caret: without that, clicking a row would collapse the
 * selection before the span is captured and every insertion would land at the
 * end of the draft.
 *
 * The panel carries `role="dialog"`, which is also how `occlusion.ts` learns to
 * make the plugin's own ghost overlays yield under it — the panel never has
 * prediction text bleeding across its rows.
 *
 * @module dsh-prompt-history/client/TemplatesAction
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { getPrefs, subscribePrefs } from './prefs.ts'
import { T } from './i18n.ts'
import { editorHost, focusEditor, setEditorCaret } from './editor.ts'
import {
  BODY_MAX, NAME_MAX, getTemplates, removeTemplate, saveTemplate, subscribeTemplates,
  type PromptTemplate,
} from './templateLibrary.ts'

/** The composer action face this component needs (the rest is ignored). */
interface ComposerWriter {
  /** Capture the insertion span at the moment of the click. */
  readonly captureInsertion?: () => unknown
  /** Write text at a captured span; true when the span mapped. */
  readonly insertText?: (text: string, span: unknown) => boolean
  /** Replace the whole draft (older hosts). */
  readonly setDraft?: (text: string) => void
}

/** Props of the template entry, mirroring the composer slot's share. */
export interface TemplatesActionProps {
  /** The live draft, read when a template is saved from it. */
  readonly draft: string
  /** Composer phase; a sending composer cannot take an insertion. */
  readonly phase: string
  /** The composer's public action face, narrowed inside `insertBody`. */
  readonly actions: unknown
  /** Session id: the panel closes on a session switch. */
  readonly sessionId?: string
}

/** The inline editor state: `id === null` means "new template". */
interface EditDraft {
  readonly id: string | null
  readonly name: string
  readonly body: string
}

const STYLE_ID = 'dsh-ph-templates-style'

/** Inject the panel's stylesheet once (theme tokens follow light/dark). */
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = [
    '.dsh-ph-tpl-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;',
    'border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);',
    'font-size:14px;line-height:1;cursor:pointer;padding:0;transition:background .15s,color .15s;}',
    '.dsh-ph-tpl-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
    '.dsh-ph-tpl-btn:disabled{opacity:.4;cursor:default;}',
    '.dsh-ph-tpl-panel{position:fixed;z-index:2147483000;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;',
    'max-height:min(60vh,520px);padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;',
    'background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 28px rgba(0,0,0,.25);}',
    '.dsh-ph-tpl-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}',
    '.dsh-ph-tpl-head span{flex:1;}',
    '.dsh-ph-tpl-count{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary);}',
    '.dsh-ph-tpl-close{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;}',
    '.dsh-ph-tpl-filter{height:26px;box-sizing:border-box;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);',
    'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;}',
    '.dsh-ph-tpl-list{flex:1 1 auto;min-height:0;overflow-y:auto;margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;}',
    '.dsh-ph-tpl-row{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;cursor:pointer;}',
    '.dsh-ph-tpl-row:hover,.dsh-ph-tpl-row--active{background:var(--dsw-alias-bg-layer-2);}',
    '.dsh-ph-tpl-name{flex:1 1 auto;min-width:0;font-size:12.5px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.dsh-ph-tpl-actions{display:flex;gap:2px;opacity:0;flex:0 0 auto;}',
    '.dsh-ph-tpl-row:hover .dsh-ph-tpl-actions,.dsh-ph-tpl-row--active .dsh-ph-tpl-actions{opacity:1;}',
    '.dsh-ph-tpl-icon{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:12px;line-height:1;padding:2px 4px;border-radius:4px;}',
    '.dsh-ph-tpl-icon:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);}',
    '.dsh-ph-tpl-empty{margin:0;padding:8px 4px;font-size:12px;color:var(--dsw-alias-label-tertiary);}',
    '.dsh-ph-tpl-foot{display:flex;gap:6px;align-items:center;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px;}',
    '.dsh-ph-tpl-foot span{flex:1;font-size:11px;color:var(--dsw-alias-label-tertiary);}',
    '.dsh-ph-tpl-act{height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;',
    'color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;}',
    '.dsh-ph-tpl-act:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);}',
    '.dsh-ph-tpl-act:disabled{opacity:.4;cursor:default;}',
    '.dsh-ph-tpl-act--primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);border-color:transparent;}',
    '.dsh-ph-tpl-edit{display:flex;flex-direction:column;gap:6px;min-height:0;}',
    '.dsh-ph-tpl-input,.dsh-ph-tpl-body{width:100%;box-sizing:border-box;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);',
    'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;padding:6px 8px;}',
    '.dsh-ph-tpl-body{min-height:96px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;}',
    '.dsh-ph-tpl-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);}',
  ].join('')
  document.head.appendChild(tag)
}

/** An insertion span captured while the composer still owned the caret. */
interface CapturedSpan {
  /** Whatever `captureInsertion()` returned. */
  readonly span: unknown
  /** The draft at capture time: a changed draft makes the span stale. */
  readonly draft: string
}

/**
 * Write a template body into the composer.
 *
 * Prefers the host's own insertion (keeps undo history and reference chips
 * intact); falls back to a draft write parked at the end for older hosts.
 *
 * `captured` is the span taken when the panel opened, while the composer still
 * owned the caret — the panel itself takes focus (so Enter edits the panel
 * instead of sending the message), which is exactly why the span has to be
 * snapshotted up front rather than read at click time.
 *
 * @param props - the composer facts captured by the caller.
 * @param body - the text to insert.
 * @param captured - the span snapshot, or null when none could be taken.
 * @returns whether anything was written.
 */
function insertBody(props: TemplatesActionProps, body: string, captured: CapturedSpan | null): boolean {
  const host = editorHost()
  if (host === null) return false
  const writer = props.actions as ComposerWriter
  if (captured !== null && captured.draft === props.draft && typeof writer.insertText === 'function') {
    try {
      if (writer.insertText(body, captured.span) === true) { focusEditor(host); return true }
    } catch { /* stale span: fall through to a fresh capture */ }
  }
  // Focus first: a focused host reports its live caret and Lexical restores the
  // last selection on focus, so a fresh span lands where the user was typing.
  focusEditor(host)
  if (typeof writer.captureInsertion === 'function' && typeof writer.insertText === 'function') {
    try {
      if (writer.insertText(body, writer.captureInsertion()) === true) return true
    } catch { /* host refused the span: fall through to a draft write */ }
  }
  const next = props.draft === '' ? body : `${props.draft}\n\n${body}`
  writer.setDraft?.(next)
  setEditorCaret(host, next.length)
  return true
}

/**
 * The 📋 button and its panel.
 * @param props - draft, phase, composer actions and session id.
 * @returns the button, plus a portal panel while open.
 */
export function TemplatesAction(props: TemplatesActionProps): JSX.Element | null {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs)
  const templates = useSyncExternalStore(subscribeTemplates, getTemplates)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [editing, setEditing] = useState<EditDraft | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  // Span snapshot taken at open time, while the composer still owned the caret.
  const spanRef = useRef<CapturedSpan | null>(null)
  // State, not a ref: the first paint with `open` happens before the button can
  // be measured, so the measurement must trigger one more render.
  const [anchor, setAnchor] = useState({ bottom: 140, right: 24 })

  useEffect(() => { ensureStyle() }, [])

  // A panel left open across a session switch must not offer the old session's
  // bookkeeping: close it and drop any half-written edit.
  useEffect(() => {
    setOpen(false)
    setEditing(null)
    setConfirming(null)
  }, [props.sessionId])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return templates
    return templates.filter((entry) => `${entry.name}\n${entry.body}`.toLowerCase().includes(needle))
  }, [templates, query])

  // Selection stays inside the filtered list as it shrinks.
  useEffect(() => {
    setActive((current) => (filtered.length === 0 ? 0 : Math.min(current, filtered.length - 1)))
  }, [filtered.length])

  /** Anchor the panel above the button, right-aligned to it. */
  const place = useCallback((): void => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const next = {
      bottom: Math.max(12, window.innerHeight - rect.top + 8),
      right: Math.max(12, window.innerWidth - rect.right),
    }
    // Only re-render when the measurement actually moved.
    setAnchor((current) => (current.bottom === next.bottom && current.right === next.right ? current : next))
  }, [])

  /** Close the panel and hand focus back to the composer. */
  const close = useCallback((): void => {
    setOpen(false)
    const host = editorHost()
    if (host !== null) focusEditor(host)
  }, [])

  // Focusing the filter on open keeps Enter/↑/↓ inside the panel: with the
  // composer still focused, Enter would send the message instead of inserting.
  useEffect(() => {
    if (!open) return
    filterRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open, place])

  // Escape closes (dropping an edit first); an outside pointer press closes too.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (editing !== null) { setEditing(null); return }
      if (confirming !== null) { setConfirming(null); return }
      close()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) === true) return
      if (buttonRef.current?.contains(target) === true) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, editing, confirming, close])

  const choose = useCallback((template: PromptTemplate): void => {
    // A sending composer refuses insertions; keep the panel open instead of
    // closing on a write that never happened.
    if (props.phase === 'submitting' || props.phase === 'adjudicating') return
    if (insertBody(props, template.body, spanRef.current)) setOpen(false)
  }, [props])

  const startNew = useCallback((): void => {
    setEditing({ id: null, name: '', body: props.draft })
    setConfirming(null)
  }, [props.draft])

  const commit = useCallback((): void => {
    if (editing === null) return
    const saved = saveTemplate(editing.id, editing.name, editing.body)
    if (saved === null) return // both empty: keep the editor open
    setEditing(null)
  }, [editing])

  const canInsert = props.phase !== 'submitting' && props.phase !== 'adjudicating'

  if (!prefs.promptTemplates) return null

  const button = (
    <button
      ref={buttonRef}
      type="button"
      className="dsh-ph-tpl-btn"
      title={T('tpl.title')}
      aria-label={T('tpl.title')}
      aria-expanded={open}
      disabled={!canInsert}
      onClick={() => {
        if (open) { setOpen(false); return }
        // Snapshot before the panel takes focus: afterwards the composer no
        // longer owns the caret.
        const writer = props.actions as ComposerWriter
        let span: unknown = null
        try {
          span = typeof writer.captureInsertion === 'function' ? writer.captureInsertion() : null
        } catch { span = null }
        spanRef.current = span === null ? null : { span, draft: props.draft }
        setOpen(true)
        setQuery('')
        setEditing(null)
        setConfirming(null)
      }}
    >
      📋
    </button>
  )

  const list = (
    <ul className="dsh-ph-tpl-list" role="list">
      {filtered.length === 0 && <li className="dsh-ph-tpl-empty">{templates.length === 0 ? T('tpl.empty') : T('tpl.noMatch')}</li>}
      {filtered.map((template, index) => {
        const isConfirming = confirming === template.id
        return (
          <li
            key={template.id}
            className={`dsh-ph-tpl-row${index === active ? ' dsh-ph-tpl-row--active' : ''}`}
            // Keep the composer focused (and its caret alive) when a row is clicked.
            onMouseDown={(event) => { event.preventDefault() }}
            onMouseEnter={() => { setActive(index) }}
            onClick={() => { if (!isConfirming) choose(template) }}
          >
            <span className="dsh-ph-tpl-name" title={template.body}>{template.name}</span>
            <span className="dsh-ph-tpl-actions">
              {isConfirming
                ? (
                  <>
                    <button
                      type="button"
                      className="dsh-ph-tpl-icon"
                      title={T('tpl.deleteConfirm')}
                      aria-label={T('tpl.deleteConfirm')}
                      onClick={(event) => { event.stopPropagation(); removeTemplate(template.id); setConfirming(null) }}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="dsh-ph-tpl-icon"
                      title={T('tpl.cancel')}
                      aria-label={T('tpl.cancel')}
                      onClick={(event) => { event.stopPropagation(); setConfirming(null) }}
                    >
                      ↩
                    </button>
                  </>
                )
                : (
                  <>
                    <button
                      type="button"
                      className="dsh-ph-tpl-icon"
                      title={T('tpl.edit')}
                      aria-label={T('tpl.edit')}
                      onClick={(event) => {
                        event.stopPropagation()
                        setEditing({ id: template.id, name: template.name, body: template.body })
                        setConfirming(null)
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="dsh-ph-tpl-icon"
                      title={T('tpl.delete')}
                      aria-label={T('tpl.delete')}
                      onClick={(event) => { event.stopPropagation(); setConfirming(template.id) }}
                    >
                      ✕
                    </button>
                  </>
                )}
            </span>
          </li>
        )
      })}
    </ul>
  )

  const editor = editing !== null
    ? (
      <div className="dsh-ph-tpl-edit">
        <input
          className="dsh-ph-tpl-input"
          value={editing.name}
          maxLength={NAME_MAX}
          placeholder={T('tpl.namePlaceholder')}
          aria-label={T('tpl.namePlaceholder')}
          onChange={(event) => { setEditing({ ...editing, name: event.target.value }) }}
        />
        <textarea
          className="dsh-ph-tpl-body"
          value={editing.body}
          maxLength={BODY_MAX}
          placeholder={T('tpl.bodyPlaceholder')}
          aria-label={T('tpl.bodyPlaceholder')}
          onChange={(event) => { setEditing({ ...editing, body: event.target.value }) }}
        />
        <div className="dsh-ph-tpl-foot">
          <span>{T('tpl.bodyHint')}</span>
          <button type="button" className="dsh-ph-tpl-act" onClick={() => { setEditing(null) }}>{T('tpl.cancel')}</button>
          <button type="button" className="dsh-ph-tpl-act dsh-ph-tpl-act--primary" onClick={commit}>{T('tpl.saveAction')}</button>
        </div>
      </div>
    )
    : null

  const panel = open && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={panelRef}
        className="dsh-ph-tpl-panel"
        style={{
          bottom: anchor.bottom,
          right: anchor.right,
          width: 360,
          maxWidth: 'calc(100vw - 24px)',
        }}
        role="dialog"
        aria-label={T('tpl.title')}
        onKeyDown={(event) => {
          if (editing !== null) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((current) => (filtered.length === 0 ? 0 : (current + 1) % filtered.length))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((current) => (filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length))
          } else if (event.key === 'Enter') {
            const target = filtered[active]
            if (target !== undefined) { event.preventDefault(); choose(target) }
          }
        }}
      >
        <div className="dsh-ph-tpl-head">
          <span>{T('tpl.title')}</span>
          <span className="dsh-ph-tpl-count">{T('tpl.count').replace('{n}', String(filtered.length))}</span>
          <button type="button" className="dsh-ph-tpl-close" aria-label={T('tpl.close')} onClick={close}>×</button>
        </div>
        {editor ?? (
          <>
            <input
              ref={filterRef}
              className="dsh-ph-tpl-filter"
              value={query}
              placeholder={T('tpl.filter')}
              aria-label={T('tpl.filter')}
              onChange={(event) => { setQuery(event.target.value) }}
            />
            {list}
            <div className="dsh-ph-tpl-foot">
              <span>{T('tpl.saveHint')}</span>
              <button
                type="button"
                className="dsh-ph-tpl-act dsh-ph-tpl-act--primary"
                disabled={props.draft.trim() === '' || !canInsert}
                title={props.draft.trim() === '' ? T('tpl.noDraft') : T('tpl.saveCurrent')}
                onClick={startNew}
              >
                {T('tpl.saveCurrent')}
              </button>
            </div>
          </>
        )}
      </div>,
      document.body,
    )
    : null

  return <>{button}{panel}</>
}
