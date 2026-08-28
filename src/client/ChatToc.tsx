/**
 * ChatToc: a subtle Codex-style conversation directory. A low-opacity grip on
 * the chat's left edge expands a panel listing every user-submitted message
 * (oldest → newest); clicking an entry scrolls the conversation to that
 * message. Rendered via a portal to document.body so the fixed positioning is
 * viewport-relative, and lives off the conversation snapshot's user nodes.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import { T } from './i18n.ts'

/** One directory entry: the prompt text and a row index for scroll targeting. */
export interface TocEntry {
  readonly text: string
}

/** Extract the plain text of a user-submitted node; null for others/empty. */
function entryText(node: ConversationNode): string | null {
  if (node.kind !== 'user' && node.kind !== 'steering') return null
  let text = ''
  for (const block of node.content) {
    if (block.type === 'text') text += block.text
  }
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

/** Full props: the conversation nodes to build the directory from. */
export interface ChatTocProps {
  readonly nodes: readonly ConversationNode[]
}

/** The TOC grip + panel entry. */
export function ChatToc({ nodes }: ChatTocProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [origin, setOrigin] = useState({ left: 0, top: 0, bottom: 0 })
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Directory entries: user/steering prompts, consecutive duplicates collapsed.
  const entries = useMemo<TocEntry[]>(() => {
    const out: TocEntry[] = []
    for (const node of nodes) {
      const text = entryText(node)
      if (text === null) continue
      if (out[out.length - 1]?.text !== text) out.push({ text })
    }
    return out
  }, [nodes])

  // Anchor the grip/panel to the conversation scrollport's left edge.
  const measure = useCallback((): void => {
    const scrollport = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (scrollport === null) return
    const rect = scrollport.getBoundingClientRect()
    setOrigin({ left: rect.left, top: rect.top, bottom: rect.bottom })
  }, [])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [measure])

  // Draggable grip: mousedown starts a drag, mousemove moves it (clamped to
  // the viewport), mouseup persists the position in localStorage so it stays
  // where the user put it across reloads. The panel opens beside the current
  // grip position instead of the scrollport edge.
  const POS_KEY = 'dsh-prompt-history.tocPos'
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null)
  const movedRef = useRef(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(POS_KEY)
      if (raw !== null) setPos(JSON.parse(raw) as { left: number; top: number })
    } catch { /* corrupt saved position: fall back to the default */ }
  }, [])

  // Close on outside pointer-down and Escape (the panel).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const startDrag = (e: ReactMouseEvent): void => {
    e.preventDefault() // no text selection while dragging
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseLeft: pos?.left ?? origin.left + 6, baseTop: pos?.top ?? gripY() - 26 }
    movedRef.current = false
  }
  const gripY = (): number => Math.round((origin.top + origin.bottom) / 2)
  const onDragMove = useCallback((e: MouseEvent): void => {
    const drag = dragRef.current
    if (drag === null) return
    if (Math.abs(e.clientX - drag.startX) > 4 || Math.abs(e.clientY - drag.startY) > 4) movedRef.current = true
    const left = Math.min(Math.max(4, drag.baseLeft + e.clientX - drag.startX), window.innerWidth - 24)
    const top = Math.min(Math.max(4, drag.baseTop + e.clientY - drag.startY), window.innerHeight - 56)
    setPos({ left, top })
  }, [])
  const endDrag = useCallback((): void => {
    if (dragRef.current === null) return
    dragRef.current = null
    try {
      const current = pos
      if (current !== null) localStorage.setItem(POS_KEY, JSON.stringify(current))
    } catch { /* storage unavailable */ }
  }, [pos])

  useEffect(() => {
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', endDrag)
    return () => {
      window.removeEventListener('mousemove', onDragMove)
      window.removeEventListener('mouseup', endDrag)
    }
  }, [onDragMove, endDrag])

  // Scroll the conversation to the first anchor row containing the entry text,
  // walking from the previous entry's row so repeated prompts land in order.
  const lastRowRef = useRef(0)
  const jumpTo = (index: number): void => {
    const entry = entries[index]
    if (entry === undefined) return
    const rows = [...document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
    const start = index === 0 ? 0 : lastRowRef.current
    const hit = rows.slice(start).find((row) => (row.textContent ?? '').includes(entry.text))
    if (hit === undefined) return
    lastRowRef.current = rows.indexOf(hit)
    hit.scrollIntoView({ block: 'start' })
    setOpen(false)
  }

  const gripLeft = pos?.left ?? origin.left + 6
  const gripTop = pos?.top ?? gripY() - 26

  // The panel is anchored to the grip like a context menu: it sits to the
  // grip's right, vertically centered on it, and is clamped so the box always
  // fits the viewport — dragging the grip to the bottom edge shifts the panel
  // up just enough (never clipping the directory).
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  useLayoutEffect(() => {
    if (!open || entries.length === 0) return
    const panel = panelRef.current
    if (panel === null) return
    const gap = 8
    const gripRight = gripLeft + 20 // grip width from .dsh-ph-toc-grip
    const gripCenterY = gripTop + 26 // grip height 52 → vertical center
    const natural = Math.min(panel.getBoundingClientRect().height, 480)
    const maxHeight = Math.min(natural, window.innerHeight - 8)
    const left = Math.max(4, Math.min(gripRight + gap, window.innerWidth - 308))
    // Prefer centering on the grip; clamp so both edges stay inside the viewport.
    const top = Math.max(4, Math.min(gripCenterY - maxHeight / 2, window.innerHeight - maxHeight - 4))
    const next = { top, left, maxHeight }
    setPanelStyle((prev) => (
      prev !== null && prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight
        ? prev
        : next
    ))
  }, [open, entries.length, gripLeft, gripTop])

  return createPortal(
    <>
      <button
        type="button"
        className="dsh-ph-toc-grip"
        aria-label={T('toc.aria')}
        title={T('toc.aria')}
        onClick={() => {
          if (movedRef.current) { movedRef.current = false; return } // a drag is not a click
          measure()
          setOpen((v) => !v)
        }}
        onMouseDown={startDrag}
        style={{ top: gripTop, left: gripLeft, cursor: dragRef.current !== null ? 'grabbing' : 'grab' }}
      >
        ☰
      </button>
      {open && entries.length > 0 && (
        <div
          ref={panelRef}
          className="dsh-ph-toc"
          style={panelStyle ?? { top: Math.max(4, gripTop - 8), left: Math.min(gripLeft + 30, window.innerWidth - 230) }}
        >
          <div className="dsh-ph-toc-title">{T('toc.title')}</div>
          <div className="dsh-ph-toc-list">
            {entries.map((entry, i) => (
              <button
                type="button"
                key={`${i}:${entry.text}`}
                className="dsh-ph-toc-item"
                onClick={() => { jumpTo(i) }}
              >
                {entry.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}
