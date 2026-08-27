/**
 * ChatToc: a subtle Codex-style conversation directory. A low-opacity grip on
 * the chat's left edge expands a panel listing every user-submitted message
 * (oldest → newest); clicking an entry scrolls the conversation to that
 * message. Rendered via a portal to document.body so the fixed positioning is
 * viewport-relative, and lives off the conversation snapshot's user nodes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'

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

  // Close on outside pointer-down and Escape.
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

  const gripY = Math.round((origin.top + origin.bottom) / 2)
  return createPortal(
    <>
      <button
        type="button"
        className="dsh-ph-toc-grip"
        aria-label="会话目录"
        title="会话目录"
        onClick={() => { measure(); setOpen((v) => !v) }}
        style={{ top: gripY - 26, left: origin.left + 6 }}
      >
        ☰
      </button>
      {open && entries.length > 0 && (
        <div
          ref={panelRef}
          className="dsh-ph-toc"
          style={{ top: origin.top + 8, left: origin.left + 30 }}
        >
          <div className="dsh-ph-toc-title">会话目录</div>
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
