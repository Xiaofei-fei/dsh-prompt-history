/**
 * Session-window widening for the full-history TOC. A client plugin's apply()
 * runs on the root context, where per-session actions are reached through the
 * runtime `sessions` service: `binding(sessionId).session.loadOlder()` pages
 * one history page into the session's loaded window (the same mechanism the
 * chat uses when the user scrolls to older content). Pulling pages until
 * `hasMore` is false loads the ENTIRE conversation, so the directory can list
 * every user message — not just the initially loaded window.
 */
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

let sessionsService: ISessions | undefined

/** Capture the runtime sessions service (called once from apply). */
export function bindSessionsService(service: ISessions | undefined): void {
  sessionsService = service
}

/** Pull one older history page for `sessionId`; true when a page was pulled. */
export async function pullOlderPage(sessionId: SessionId): Promise<boolean> {
  if (sessionsService === undefined) return false
  const binding = sessionsService.binding(sessionId)
  if (binding === undefined) return false
  try {
    await binding.session.loadOlder()
    return true
  } catch {
    // Failures land in snapshot.openState/loadingOlder; keep the window as-is.
    return false
  }
}
