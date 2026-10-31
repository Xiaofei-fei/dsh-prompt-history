/**
 * Host half of the prompt-suggestion bridge.
 *
 * The browser cannot reach a model: the harness owns `ctx.llm` (provider
 * routes, credentials, quota). This service exposes one Remote method to the
 * plugin's client half through the Typert Gateway, so the composer can ask the
 * host for a predicted next prompt — or for the rest of a message the user is
 * halfway through typing.
 *
 * @module dsh-prompt-history/suggest
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'

/** One prediction request from the composer. */
export interface SuggestRequest {
  /** Recent conversation, oldest → newest, already flattened to plain text. */
  readonly context: string
  /**
   * What the user has typed so far, when this is a continuation request.
   *
   * A non-empty draft means "finish this message": the answer is the text that
   * follows it, never a fresh prompt. Absent or empty is the next-prompt
   * prediction for an idle composer.
   */
  readonly draft?: string
  /** Provider route override; the host default is used when absent. */
  readonly provider?: string
  /** Provider-owned model id override; the host default is used when absent. */
  readonly model?: string
}

/** One prediction result. `text` is '' when no suggestion could be produced. */
export interface SuggestResult {
  /** Single-line predicted prompt (or continuation suffix), or '' when unavailable. */
  readonly text: string
}

/** The host services this bridge reads (structural: no runtime dependency). */
interface HostServices {
  get?: (key: string) => unknown
}

/** One selectable reasoning effort as the adapter describes it. */
interface HostEffortInfo {
  readonly id?: string
  readonly name?: string
}

/** The subset of `ctx.llm` used here. */
interface HostLlm {
  stream(options: {
    provider: string
    model: string
    system?: string
    messages: readonly { role: 'user'; content: readonly { type: 'text'; text: string }[] }[]
    maxTokens?: number
    temperature?: number
    reasoningEffort?: string
    signal?: AbortSignal
  }): AsyncIterable<{ type?: string; text?: string }>
  resolveModelInfo?: (provider: string, model: string) => Promise<unknown>
}

/** The subset of `ctx.agentDefaultModel` used here. */
interface HostDefaultModel {
  currentSelection?: () => { provider?: string; model?: string }
}

/**
 * Instruction for next-prompt prediction: one line, nothing else.
 *
 * The tone/actionability lines matter: a generic "you predict the next message"
 * produced vague filler ("继续", "运行测试看看") that the user could not have
 * written. The conversation rows already carry the user's own phrasing, so the
 * model only has to stay in it.
 */
const NEXT_SYSTEM = [
  "You predict the user's next message in a coding-assistant conversation.",
  'Reply with that message only: a single line, no quotes, no explanation, no code fence.',
  "Write it the way the user writes: match their language, their level of detail and their tone.",
  "Prefer a concrete, actionable instruction over a vague one, and refer to the specific file, symbol or step the conversation is about.",
  'When the assistant just asked a question or offered options, answer that question.',
  'Never mention UI mechanics such as pressing Tab or accepting a suggestion.',
  'If the conversation suggests no clear next step, reply with nothing at all.',
].join(' ')

/**
 * Instruction for finishing an in-progress message.
 *
 * The continuation must be *only* the missing tail: the composer appends it at
 * the caret, so repeating the draft would duplicate what the user already wrote.
 */
const CONTINUE_SYSTEM = [
  "You complete the user's half-written message in a coding-assistant conversation.",
  'The message below ends exactly where the user stopped typing.',
  'Reply with ONLY the text that continues it: never repeat what they already wrote, no quotes, no explanation, no code fence.',
  'Keep their language, tone and formatting, finish the clause naturally, and stay under 120 characters.',
  'If nothing sensible can follow, reply with nothing at all.',
].join(' ')

/** Longest conversation tail sent to the model. */
const MAX_CONTEXT = 8000
/** Longest draft tail sent as the continuation seed. */
const MAX_DRAFT = 400
/** Longest accepted next-prompt suggestion; longer answers are prose, not a prompt. */
const MAX_TEXT = 200
/** Longest accepted continuation; a ghost is a clause, not a paragraph. */
const MAX_CONTINUATION = 160

/**
 * A leading "Sure, here is..." preamble means the model explained instead of
 * predicting. Kept only when a colon separates it from the actual answer.
 */
const PREAMBLE = /^(?:sure|okay|ok|here(?:'s| is)?|the next|i think)\b[^:：]{0,40}[:：]\s*/i

/**
 * Reduce model output to one plain line, or '' when it is not a usable prompt.
 * @param raw - the accumulated assistant text.
 * @param maxLength - longest accepted line.
 * @returns the single-line suggestion, or ''.
 */
function sanitize(raw: string, maxLength: number): string {
  let text = raw.trim()
  if (text.startsWith('```')) text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim()
  text = text.replace(/^[\s"'“”「」]+/, '').replace(/[\s"'“”「」]+$/, '').trim()
  const line = text.split('\n').map((part) => part.trim()).find((part) => part !== '') ?? ''
  if (line === '') return ''
  const withoutPreamble = line.replace(PREAMBLE, '').trim()
  const answer = withoutPreamble === '' ? line : withoutPreamble
  return answer.length > maxLength ? '' : answer
}

/**
 * Reduce a continuation answer to the missing tail, or '' when it is unusable.
 *
 * Models sometimes echo the whole message instead of the tail; the composer
 * appends whatever comes back at the caret, so an echoed draft has to be cut
 * off here rather than in the browser.
 * @param raw - the accumulated assistant text.
 * @param draft - the draft the request was made for.
 * @returns the continuation suffix, or ''.
 */
function sanitizeContinuation(raw: string, draft: string): string {
  const text = sanitize(raw, MAX_CONTINUATION * 2)
  if (text === '') return ''
  const seed = draft.trimEnd()
  const body = seed !== '' && text.startsWith(seed) ? text.slice(seed.length) : text
  // Leading whitespace would push the ghost off the caret; punctuation is kept.
  const suffix = body.replace(/^[\s"'“”「」]+/, '').trimEnd()
  if (suffix === '' || suffix.length > MAX_CONTINUATION) return ''
  return suffix
}

/** Prompt-suggestion Remote service: turns recent conversation into a next prompt. */
export class PromptSuggestService extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'promptSuggest')
  }

  /**
   * Predict the user's next prompt — or the rest of the one they are typing.
   * @param request - conversation context, optional in-progress draft, and an
   *   optional model override.
   * @returns the predicted single line ('' when unavailable).
   */
  @Remote('suggest')
  async suggest(request: SuggestRequest): Promise<SuggestResult> {
    const ctx = (this as unknown as { ctx: HostServices }).ctx
    const context = typeof request?.context === 'string' ? request.context.slice(-MAX_CONTEXT) : ''
    const draft = typeof request?.draft === 'string' ? request.draft.slice(-MAX_DRAFT) : ''
    const continuing = draft.trim() !== ''
    if (context.trim() === '' && !continuing) return { text: '' }
    const llm = ctx.get?.('llm') as HostLlm | undefined
    if (llm === undefined || typeof llm.stream !== 'function') return { text: '' }
    let provider = request.provider
    let model = request.model
    if (provider === undefined || model === undefined) {
      const selection = (ctx.get?.('agentDefaultModel') as HostDefaultModel | undefined)?.currentSelection?.()
      provider = provider ?? selection?.provider
      model = model ?? selection?.model
    }
    if (provider === undefined || model === undefined) return { text: '' }

    const system = continuing ? CONTINUE_SYSTEM : NEXT_SYSTEM
    const prompt = continuing
      ? (context.trim() === ''
        ? `The message the user is writing right now, cut at the cursor:\n${draft}`
        : `${context}\n\n---\nThe message the user is writing right now, cut at the cursor:\n${draft}`)
      : context
    /** Turn one raw answer into the shape this request asked for. */
    const finish = (raw: string): string => continuing ? sanitizeContinuation(raw, draft) : sanitize(raw, MAX_TEXT)

    /**
     * Run one prediction call and return the raw assistant text.
     * @param effort - reasoning effort to request, or undefined for the default.
     * @param maxTokens - response budget for this attempt.
     * @returns the accumulated assistant text.
     */
    const collect = async (effort: string | undefined, maxTokens: number): Promise<string> => {
      let out = ''
      const stream = llm.stream({
        provider: provider as string,
        model: model as string,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        maxTokens,
        temperature: 0.2,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      })
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
        if (out.length > MAX_TEXT * 2) break
      }
      return out
    }

    // Reasoning models can spend the whole budget thinking and emit no text, so
    // ask for the cheapest effort the route offers; a second pass without any
    // effort hint (and a larger budget) recovers when the first comes back empty.
    const effort = await pickLowEffort(llm, provider, model)
    try {
      const first = finish(await collect(effort, 1024))
      if (first !== '') return { text: first }
      // Second pass without any effort hint (and a larger budget) recovers when
      // the provider ignored the low-effort request.
      return { text: finish(await collect(undefined, 3072)) }
    } catch (error) {
      console.warn('[dsh-prompt-history] prompt-suggestion call failed:', error)
      return { text: '' }
    }
  }
}

/**
 * The cheapest reasoning effort the route offers, or undefined when unknown.
 * @param llm - the host LLM service.
 * @param provider - provider route.
 * @param model - model id.
 * @returns the effort id to request.
 */
async function pickLowEffort(llm: HostLlm, provider: string, model: string): Promise<string | undefined> {
  try {
    const info = await llm.resolveModelInfo?.(provider, model) as
      | { reasoning?: { efforts?: readonly HostEffortInfo[] } }
      | undefined
    const efforts = info?.reasoning?.efforts ?? []
    if (efforts.length === 0) return undefined
    const low = efforts.find((entry) => /minimal|none|off|low|basic/i.test(`${entry.id ?? ''} ${entry.name ?? ''}`))
    return (low ?? efforts[efforts.length - 1])?.id
  } catch {
    return undefined
  }
}
