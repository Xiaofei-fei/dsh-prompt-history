/**
 * Prompt enhancement in the composer.
 *
 * A ✨ button next to the composer actions rewrites the current draft into a
 * structured prompt through the host's own model (the same `promptSuggest`
 * bridge the prediction uses). The rewrite is never applied automatically: it
 * opens a compare panel, and only "应用" writes it back — with a one-click undo
 * for as long as the draft is still the rewrite.
 *
 * Every failure is local and non-destructive: the draft is only ever replaced
 * by an explicit click, and a failed call leaves it exactly as typed.
 *
 * @module dsh-prompt-history/client/EnhanceAction
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getActiveBridge, subscribeBridge, type SuggestBridge } from './suggest.ts'
import { getPrefs, subscribePrefs } from './prefs.ts'
import { useSyncExternalStore } from 'react'
import { T } from './i18n.ts'

/** A failed rewrite, kept as a key so the panel can localize it. */
type Failure = 'empty' | 'failed' | 'busy' | 'no-bridge'

/** The applied-rewrite undo affordance, if any. */
interface Undo {
  /** The draft before the rewrite. */
  readonly original: string
  /** The text the rewrite wrote; the bar retires when the draft diverges. */
  readonly applied: string
}

/** Longest draft the panel accepts; the host refuses longer ones too. */
const MAX_INPUT = 12_000

/** Milliseconds the undo bar stays on screen. */
const UNDO_MS = 20_000

const STYLE_ID = 'dsh-ph-enhance-style'

/** Inject the panel's stylesheet once. */
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = [
    '.dsh-ph-enh-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;',
    'border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);',
    'font-size:14px;line-height:1;cursor:pointer;padding:0;transition:background .15s,color .15s;}',
    '.dsh-ph-enh-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
    '.dsh-ph-enh-btn:disabled{opacity:.4;cursor:default;}',
    '.dsh-ph-enh-panel{position:fixed;z-index:2147483000;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;',
    'max-height:60vh;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;',
    'background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2));box-shadow:0 8px 28px rgba(0,0,0,.25);}',
    '.dsh-ph-enh-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}',
    '.dsh-ph-enh-head span{flex:1;}',
    '.dsh-ph-enh-close{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;}',
    '.dsh-ph-enh-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px;min-height:0;}',
    '.dsh-ph-enh-col{display:flex;flex-direction:column;gap:4px;min-width:0;min-height:0;}',
    '.dsh-ph-enh-col h4{margin:0;font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;}',
    '.dsh-ph-enh-col pre{margin:0;overflow:auto;max-height:38vh;padding:8px;border-radius:8px;font-size:12px;line-height:1.6;',
    'white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);}',
    '.dsh-ph-enh-foot{display:flex;align-items:center;gap:8px;}',
    '.dsh-ph-enh-foot span{flex:1;font-size:12px;color:var(--dsw-alias-label-tertiary);}',
    '.dsh-ph-enh-act{height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);cursor:pointer;',
    'background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;}',
    '.dsh-ph-enh-act:hover{background:var(--dsw-alias-bg-layer-2);}',
    '.dsh-ph-enh-act--primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);border-color:transparent;}',
    '.dsh-ph-enh-undo{position:fixed;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;',
    'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2));',
    'box-shadow:0 4px 16px rgba(0,0,0,.2);font-size:12px;color:var(--dsw-alias-label-secondary);}',
    '.dsh-ph-enh-undo button{border:0;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;text-decoration:underline;}',
  ].join('')
  document.head.appendChild(tag)
}

/** Props of the composer entry slot, narrowed to what enhancement needs. */
export interface EnhanceActionProps {
  /** The live draft. */
  readonly draft: string
  /** Composer phase (`idle`, `submitting`, `adjudicating`, …). */
  readonly phase: string
  /** Host input actions (only `setDraft` is used). */
  readonly actions: { readonly setDraft?: (text: string) => void }
  /** Session id, for keying the panel per conversation. */
  readonly sessionId?: string
}

/**
 * The ✨ button and its compare panel.
 * @param props - draft, phase, input actions and session id.
 * @returns the button, plus a portal panel while open.
 */
export function EnhanceAction(props: EnhanceActionProps): JSX.Element | null {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs)
  const [bridge, setBridge] = useState<SuggestBridge | null>(() => getActiveBridge())
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [enhanced, setEnhanced] = useState('')
  const [undo, setUndo] = useState<Undo | null>(null)
  const originalRef = useRef('')
  const requestRef = useRef(0)
  const anchorRef = useRef({ bottom: 160, width: 720 })

  useEffect(() => subscribeBridge(() => setBridge(getActiveBridge())), [])
  useEffect(() => { ensureStyle() }, [])
  useEffect(() => {
    if (!open && undo === null) return
    const place = (): void => {
      const card = document.querySelector<HTMLElement>('[data-composer-card]')
      const rect = card?.getBoundingClientRect()
      anchorRef.current = {
        bottom: rect === undefined ? 160 : Math.max(24, window.innerHeight - rect.top + 8),
        width: Math.min(760, Math.max(320, (rect?.width ?? 720))),
      }
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open, undo])

  // The undo bar retires as soon as the draft is no longer the rewrite, so a
  // stale "restore" can never overwrite newer typing.
  useEffect(() => {
    if (undo === null) return
    if (props.draft !== undo.applied) { setUndo(null); return }
    const timer = setTimeout(() => { setUndo(null) }, UNDO_MS)
    return () => { clearTimeout(timer) }
  }, [undo, props.draft])

  useEffect(() => () => {
    // A panel left open across a session switch must not resurrect an old draft.
    requestRef.current += 1
  }, [props.sessionId])

  const usable = bridge !== null && prefs.promptEnhance
  const tooLong = props.draft.length > MAX_INPUT
  const canEnhance = usable && !busy && !tooLong && props.draft.trim() !== ''
    && props.phase !== 'submitting' && props.phase !== 'adjudicating'

  const run = useCallback(async (): Promise<void> => {
    if (!canEnhance || bridge === null) return
    const draft = props.draft
    const ticket = requestRef.current + 1
    requestRef.current = ticket
    originalRef.current = draft
    setFailure(null)
    setEnhanced('')
    setOpen(true)
    setBusy(true)
    const text = await bridge.enhance(draft)
    if (requestRef.current !== ticket) return
    setBusy(false)
    if (text === '') { setFailure('failed'); return }
    setEnhanced(text)
  }, [bridge, canEnhance, props.draft])

  const apply = useCallback((): void => {
    if (enhanced === '') return
    props.actions.setDraft?.(enhanced)
    setUndo({ original: originalRef.current, applied: enhanced })
    setOpen(false)
  }, [enhanced, props.actions])

  const undoNow = useCallback((): void => {
    if (undo === null) return
    props.actions.setDraft?.(undo.original)
    setUndo(null)
  }, [undo, props.actions])

  const copy = useCallback((): void => {
    if (enhanced === '') return
    void navigator.clipboard?.writeText(enhanced).catch(() => { /* clipboard is best effort */ })
  }, [enhanced])

  const retry = useCallback((): void => { void run() }, [run])

  // Escape closes the panel without touching the draft.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [open])

  const failures = useMemo(() => ({
    empty: T('enhance.errEmpty'),
    failed: T('enhance.errFailed'),
    busy: T('enhance.errBusy'),
    'no-bridge': T('enhance.errBridge'),
  }), [])

  if (!prefs.promptEnhance) return null

  const button = (
    <button
      type="button"
      className="dsh-ph-enh-btn"
      title={tooLong ? T('enhance.tooLong') : T('enhance.title')}
      aria-label={T('enhance.title')}
      disabled={!canEnhance}
      onClick={() => { void run() }}
    >
      ✨
    </button>
  )

  const panel = open && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="dsh-ph-enh-panel"
        style={{ left: '50%', transform: 'translateX(-50%)', bottom: anchorRef.current.bottom, width: anchorRef.current.width }}
        role="dialog"
        aria-label={T('enhance.title')}
      >
        <div className="dsh-ph-enh-head">
          <span>{busy ? T('enhance.working') : T('enhance.title')}</span>
          <button type="button" className="dsh-ph-enh-close" aria-label={T('enhance.cancel')} onClick={() => { setOpen(false) }}>×</button>
        </div>
        {busy
          ? <div className="dsh-ph-enh-foot"><span>{T('enhance.workingHint')}</span></div>
          : failure !== null
            ? (
              <div className="dsh-ph-enh-foot">
                <span>{failures[failure]}</span>
                <button type="button" className="dsh-ph-enh-act" onClick={() => { setOpen(false) }}>{T('enhance.cancel')}</button>
                <button type="button" className="dsh-ph-enh-act dsh-ph-enh-act--primary" onClick={retry}>{T('enhance.retry')}</button>
              </div>
            )
            : (
              <>
                <div className="dsh-ph-enh-cols">
                  <div className="dsh-ph-enh-col">
                    <h4>{T('enhance.original')}</h4>
                    <pre>{originalRef.current}</pre>
                  </div>
                  <div className="dsh-ph-enh-col">
                    <h4>{T('enhance.result')}</h4>
                    <pre>{enhanced}</pre>
                  </div>
                </div>
                <div className="dsh-ph-enh-foot">
                  <span>{T('enhance.neverAutoApplied')}</span>
                  <button type="button" className="dsh-ph-enh-act" onClick={copy}>{T('enhance.copy')}</button>
                  <button type="button" className="dsh-ph-enh-act" onClick={() => { setOpen(false) }}>{T('enhance.cancel')}</button>
                  <button type="button" className="dsh-ph-enh-act dsh-ph-enh-act--primary" onClick={apply}>{T('enhance.apply')}</button>
                </div>
              </>
            )}
      </div>,
      document.body,
    )
    : null

  const undoBar = undo !== null && typeof document !== 'undefined'
    ? createPortal(
      <div className="dsh-ph-enh-undo" style={{ left: '50%', transform: 'translateX(-50%)', bottom: anchorRef.current.bottom + 8 }}>
        <span>{T('enhance.applied')}</span>
        <button type="button" onClick={undoNow}>{T('enhance.undo')}</button>
      </div>,
      document.body,
    )
    : null

  return <>{button}{panel}{undoBar}</>
}
