/**
 * Session-window widening for the full-history TOC. A client plugin's apply()
 * runs on the root context, where per-session actions are reached through the
 * runtime `sessions` service: `binding(sessionId).session.loadOlder()` pages
 * one history page into the session's loaded window (the same mechanism the
 * chat uses when the user scrolls to older content). Pulling pages until
 * `hasMore` is false loads the ENTIRE conversation, so the directory can list
 * every user message — not just the initially loaded window.
 *
 * The service is provided only after the host connection is up, so it is
 * resolved LAZILY on every call (never captured at apply time): mirror of
 * ui-conversation's own `requireSessions()`.
 */
import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

let rootContext: ClientContext | undefined

/** Keep the root context (called once from apply). */
export function bindRootContext(ctx: ClientContext): void {
  rootContext = ctx
}

/** Pull one older history page for `sessionId`; true when a page was pulled. */
export async function pullOlderPage(sessionId: SessionId): Promise<boolean> {
  const sessions = rootContext?.get('sessions') as ISessions | undefined
  if (sessions === undefined) return false
  const binding = sessions.binding(sessionId)
  if (binding === undefined) return false
  try {
    await binding.session.loadOlder()
    return true
  } catch {
    // Failures land in snapshot.openState/loadingOlder; keep the window as-is.
    return false
  }
}
