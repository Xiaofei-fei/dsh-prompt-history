/**
 * Tolerant conversation-node reading across DSH generations.
 *
 * ≤ 0.1.1 (web): session nodes are `{ kind, seq, content: ContentBlock[] }`.
 * 0.1.2 rc (web): the same old-shaped array is exposed as the chat snapshot's
 *   `legacy.nodes` (and `nodes` holds a ChatNodeStore). 2.0.x (desktop) nodes
 *   are `chatNode`-shaped `{ key, kind, ..., anchorSeq, data }` with the text
 *   content under `data.content`. Everything below normalizes one node to the
 *   three facts the plugin needs: kind, seq, plain text.
 */

export interface PromptMessage {
  readonly kind: string
  /** Stable order identity for append-once dedup. */
  readonly seq: number
  /** Trimmed plain text of the message, or null when empty/unsupported. */
  readonly text: string | null
}

type NodeLike = {
  kind?: unknown
  seq?: unknown
  anchorSeq?: unknown
  content?: unknown
  data?: unknown
}

/** The node's ordering identity: anchorSeq (new), then seq (old), then data.seq. */
export function nodeSeq(node: NodeLike): number {
  for (const key of ['anchorSeq', 'seq'] as const) {
    const value = node[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  const data = node.data as { seq?: unknown } | undefined
  return typeof data?.seq === 'number' && Number.isFinite(data.seq) ? data.seq : 0
}

/** The node's text content blocks (old `content` or new `data.content`). */
function textBlocks(node: NodeLike): unknown {
  const content = node.content
  if (Array.isArray(content)) return content
  const data = node.data as { content?: unknown } | undefined
  if (data !== undefined && Array.isArray(data.content)) return data.content
  return []
}

/** Normalize one node into {kind, seq, text}; null for non-text/unsupported. */
export function promptMessage(node: unknown): PromptMessage | null {
  const n = node as NodeLike | null | undefined
  if (n === null || n === undefined) return null
  if (n.kind !== 'user' && n.kind !== 'steering') return null
  let text = ''
  for (const block of textBlocks(n) as ReadonlyArray<{ type?: unknown; text?: unknown }>) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      text += block.text
    }
  }
  const trimmed = text.trim()
  if (trimmed === '') return null
  return { kind: n.kind as string, seq: nodeSeq(n), text: trimmed }
}
