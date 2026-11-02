/**
 * Client half of the prompt-suggestion bridge.
 *
 * The browser cannot call a model, so the host service registered by this
 * package's node half (`promptSuggest/suggest`) is mounted here through the
 * Typert Gateway and called with the recent conversation. Every failure is
 * swallowed: a missing host, an unmounted descriptor or a dead connection must
 * never disturb the composer.
 *
 * @module dsh-prompt-history/client/suggest
 */

/** The client Remote face this module consumes (structural: no runtime dep). */
interface RemoteFace {
  $mount?: (contribution: unknown) => Promise<unknown>
  promptSuggest?: {
    suggest?: (request: SuggestRequest, signal?: AbortSignal) => Promise<unknown>
  }
}

/** One prediction request (mirrors the host contract). */
export interface SuggestRequest {
  /** Recent conversation, oldest → newest, flattened to plain text. */
  readonly context: string
  /** The in-progress draft, when this is a continuation rather than a prediction. */
  readonly draft?: string
  /** Provider route override; the host default is used when absent. */
  readonly provider?: string
  /** Provider-owned model id override; the host default is used when absent. */
  readonly model?: string
}

/** One prediction result (mirrors the host contract). */
export interface SuggestResult {
  /** Single-line predicted prompt (or continuation suffix), or '' when unavailable. */
  readonly text: string
}

/**
 * Hand-written consumer descriptors for this package's host face. The official
 * packages generate these; the shape is public
 * (`InvocationDescriptor` in @deepseek-ai/dsh-typert-protocol) and the
 * `src-json` codec needs no schema.
 */
/**
 * A minimal strict codec. The consumer side only validates `mode === 'strict'`
 * (schema materialization happens on the host), so a pass-through schema keeps
 * this plugin free of a schema dependency.
 * @param typeSymbol - stable host-face symbol for diagnostics.
 * @returns one strict codec descriptor.
 */
function strictCodec(typeSymbol: string): {
  mode: 'strict'
  typeSymbol: string
  create: () => { safeParse: (value: unknown) => { success: true; data: unknown } }
} {
  return {
    mode: 'strict',
    typeSymbol,
    // Only `mode` is read on this side; the host owns schema materialization.
    create: () => ({ safeParse: (value: unknown) => ({ success: true as const, data: value }) }),
  }
}

const CONTRIBUTION = {
  package: 'dsh-prompt-history',
  descriptors: [
    {
      id: 'dsh-prompt-history#promptSuggest/suggest',
      service: 'promptSuggest',
      namespace: 'promptSuggest',
      method: 'suggest',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: strictCodec('dsh-prompt-history#promptSuggest/suggest:request'),
        },
      ],
      result: strictCodec('dsh-prompt-history#promptSuggest/suggest:result'),
    },
  ],
} as const

/** One bridge call's options. */
export interface SuggestOptions {
  /**
   * The draft being continued. Present means "finish this message"; the answer
   * is the text that follows the draft, not a fresh prompt.
   */
  readonly draft?: string
  /** Cancellation (a new keystroke or a submit aborts it). */
  readonly signal?: AbortSignal
}

/** The mounted bridge: fetch one prediction, or '' when unavailable. */
export interface SuggestBridge {
  /**
   * Ask the host for a predicted next prompt, or for the rest of a draft.
   * @param context - recent conversation text.
   * @param options - the draft being continued and/or the abort signal.
   * @returns the predicted single line (or continuation suffix), '' when unavailable.
   */
  fetch(context: string, options?: SuggestOptions): Promise<string>
}

/**
 * Mount this package's host face on the client Remote service.
 *
 * Must run inside a context that injects `remote`; the namespace service it
 * installs is `remote.<namespace>` (see the gateway's `remoteServiceKey`), so
 * binding happens from a second injected context that waits for that service.
 * @param ctx - a context with `remote` injected.
 * @returns true when the contribution mounted.
 */
export async function mountContribution(ctx: unknown): Promise<boolean> {
  const remote = (ctx as { remote?: Pick<RemoteFace, '$mount'> }).remote
  if (remote === undefined || typeof remote.$mount !== 'function') return false
  try {
    await remote.$mount(CONTRIBUTION)
    return true
  } catch (error) {
    console.warn('[dsh-prompt-history] prompt-suggestion bridge unavailable:', error)
    return false
  }
}

/**
 * Bind the mounted namespace service into a bridge.
 * @param ctx - a context with `remote.promptSuggest` injected.
 * @returns the bridge, or null when the namespace is not callable.
 */
export function createBridge(ctx: unknown): SuggestBridge | null {
  // The namespace service key is `remote.<namespace>`; the dotted inject proxy
  // refuses a read from a context that did not declare it, so resolve it with
  // `ctx.get` instead (same lookup, no declaration requirement).
  const getService = (ctx as { get?: (key: string) => unknown }).get
  const api = typeof getService === 'function'
    ? getService.call(ctx, 'remote.promptSuggest') as RemoteFace['promptSuggest']
    : undefined
  const call = api?.suggest
  if (typeof call !== 'function' || api === undefined) return null
  return {
    async fetch(context: string, options: SuggestOptions = {}): Promise<string> {
      try {
        // The carrier validates the argument count against the descriptor, so
        // the business argument is the only one sent; cancellation is honoured
        // by discarding the result (the caller checks its own signal).
        const draft = options.draft
        const request: SuggestRequest = draft === undefined || draft === ''
          ? { context }
          : { context, draft }
        const raw = await call.call(api, request) as
          | SuggestResult
          | { readonly ok: true; readonly value: SuggestResult }
          | { readonly ok: false }
          | undefined
        // The carrier may hand back the bare value or its RemoteResult wrapper.
        const value = raw !== undefined && typeof raw === 'object' && 'ok' in raw
          ? (raw.ok ? raw.value : undefined)
          : raw
        const answer = typeof value?.text === 'string' ? value.text.trim() : ''
        // The conversation often discusses this feature, so the model may append
        // its own "按 Tab 接受" instruction; it is UI copy, never user content.
        return answer
          .replace(/[\s，,。.；;：:]*按?\s*(?:Tab|tab)\s*(?:键)?\s*(?:接受|确认|补全|采纳)[。.!！]?\s*$/u, '')
          .trim()
      } catch (error) {
        // Offline host, rate limit, cancelled call: simply no suggestion.
        return ''
      }
    },
  }
}

/** The mounted bridge for this page (set by the plugin apply, read by the composer entry). */
let activeBridge: SuggestBridge | null = null
/** Bridge-status subscribers (the settings section renders it). */
const bridgeListeners = new Set<() => void>()

/**
 * Publish the mounted bridge to the composer entry.
 * @param bridge - the mounted bridge, or null when unavailable.
 */
export function setActiveBridge(bridge: SuggestBridge | null): void {
  activeBridge = bridge
  for (const fn of [...bridgeListeners]) {
    try { fn() } catch { /* one faulty listener must not starve the others */ }
  }
}

/**
 * Subscribe to bridge availability.
 * @param fn - listener invoked whenever the bridge changes.
 * @returns the unsubscribe disposer.
 */
export function subscribeBridge(fn: () => void): () => void {
  bridgeListeners.add(fn)
  return () => { bridgeListeners.delete(fn) }
}

/** The mounted bridge, or null when the host face is unavailable. */
export function getActiveBridge(): SuggestBridge | null {
  return activeBridge
}

/** Longest conversation tail handed to the model. */
const MAX_CONTEXT = 8000
/** Rows of conversation inspected, newest last. */
const MAX_ROWS = 12
/** Longest text kept from the START of one row (its question or opening). */
const MAX_ROW_HEAD = 900
/** Longest text kept from the END of one row (its conclusion and next step). */
const MAX_ROW_TAIL = 700
/** Marker inserted where a long row was cut. */
const CUT = ' … '

/** Row kinds that carry conversation. Tool/plan rows are UI, not dialogue. */
const CONVERSATION_KINDS = new Set(['user', 'steering', 'assistant'])

/**
 * Relative timestamps the transcript repaints constantly: they are not
 * conversation and would re-key the prediction cache on every repaint.
 */
const TIMESTAMP = /(?:刚刚|\d+\s*(?:秒|分钟|小时|天|周|个月|年)前?|\b\d{1,2}:\d{2}\b)/g

/**
 * Keep both ends of a long row.
 *
 * A long assistant answer carries the question at the top and its conclusion,
 * caveat or proposed next step at the BOTTOM. The old head-only slice handed the
 * model the preamble and hid the part that decides what to ask next, which is
 * why predictions read as if the model had not read the answer at all.
 * @param text - the row's normalized text.
 * @returns the text, cut in the middle when it is too long.
 */
function condense(text: string): string {
  if (text.length <= MAX_ROW_HEAD + MAX_ROW_TAIL) return text
  return `${text.slice(0, MAX_ROW_HEAD)}${CUT}${text.slice(-MAX_ROW_TAIL)}`
}

/**
 * Flatten the visible conversation into role-tagged text for the predictor.
 *
 * Reads the rendered rows (they carry both sides of the conversation, which the
 * node projection does not) and normalizes whitespace so the prompt stays
 * compact. Rows whose flow kind is not a conversation turn are skipped: a tool
 * call card, a plan block or a diff summary is not something the user said.
 * @returns the context tail, or '' when the conversation is not readable.
 */
export function buildContext(): string {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')].slice(-MAX_ROWS)
  const parts: string[] = []
  for (const row of rows) {
    const kind = row.getAttribute('data-chat-flow-kind')
    if (kind !== null && !CONVERSATION_KINDS.has(kind)) continue
    const role = kind === 'user' || kind === 'steering' ? 'user' : 'assistant'
    const text = condense(
      (row.textContent ?? '')
        .replace(TIMESTAMP, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    if (text !== '') parts.push(`${role}: ${text}`)
  }
  const joined = parts.join('\n')
  return joined.length > MAX_CONTEXT ? joined.slice(-MAX_CONTEXT) : joined
}
