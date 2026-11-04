/**
 * The root client context, captured at apply time.
 *
 * A client plugin's apply() runs on the root context, and per-session services
 * are reached through it lazily: they are provided only after the host
 * connection is up, so they are resolved on every call rather than captured.
 *
 * @module dsh-prompt-history/client/sessionCtx
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

let rootContext: ClientContext | undefined

/** Keep the root context (called once from apply). */
export function bindRootContext(ctx: ClientContext): void {
  rootContext = ctx
}

/** The captured root context, or undefined before apply ran. */
export function rootContextOrNull(): ClientContext | undefined {
  return rootContext
}
