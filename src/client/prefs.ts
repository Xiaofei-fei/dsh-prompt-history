/**
 * Client-side preferences for dsh-prompt-history, backed by localStorage.
 * A tiny observable store: listeners subscribe via {@link subscribePrefs},
 * snapshots stay reference-stable until {@link setPref} replaces the object,
 * so React's useSyncExternalStore and the event-time reads in InputHistory
 * both see the same authoritative value.
 */

/** Copy behavior on text selection. */
export type CopyMode = 'toolbar' | 'auto'

/** The user-facing settings of this plugin. */
export interface PluginPrefs {
  /**
   * How a selection copies: 'toolbar' shows an explicit copy button above the
   * selection (the safe default — nothing writes the system clipboard until
   * the user clicks); 'auto' copies the selection directly (terminal-style,
   * floods clipboard history).
   */
  copyMode: CopyMode
  /** Right-click on the composer textarea pastes the clipboard directly. */
  rightClickPaste: boolean
  /** Keep one global prompt-history ring across sessions (localStorage). */
  globalHistory: boolean
  /** Show the draggable Chat TOC grip on the chat's left edge. */
  tocVisible: boolean
  /**
   * Codex-style prompt completion: while the draft is a prefix of an earlier
   * prompt, ghost the rest after the caret and accept it with Tab / →.
   */
  promptCompletion: boolean
  /**
   * Remind when the side chat and the main conversation touch the same files in
   * parallel. Warning only: nothing is blocked.
   */
  writeGuard: boolean
  /**
   * Experimental side chat: a second work thread in the right sidebar (docked
   * pane, split or floating) sharing this workspace. Off by default.
   */
  sideChat: boolean
  /**
   * Codex-style next-prompt suggestion: when the composer is empty, ask the
   * host to predict the user's next prompt from the recent conversation and
   * ghost it. Costs a small model call per prediction.
   */
  contextSuggest: boolean
}

const STORAGE_KEY = 'dsh-prompt-history.prefs'
/** Stored shape version; bump when the migration rules change. */
const STORE_VERSION = 3
const DEFAULTS: PluginPrefs = {
  copyMode: 'toolbar',
  rightClickPaste: true,
  globalHistory: false,
  tocVisible: true,
  promptCompletion: true,
  contextSuggest: true,
  sideChat: true,
  writeGuard: true,
}

/** Current prefs; replaced on every setPref (stable snapshot identity). */
let prefs: PluginPrefs = load()
const listeners = new Set<() => void>()

/** Normalize one stored boolean. */
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Migrate any stored shape into the current prefs.
 *
 * v3 stores `{ version, data }` and made the side chat default-on: v2 payloads
 * (written while it shipped as off-by-default) adopt the new default instead of
 * keeping the value nobody chose deliberately — the feature had no UI surface at
 * the time, so a stored `false` there is a default, not a decision.
 * Older builds stored the flat object, and the oldest one used a `copyOnSelect`
 * boolean instead of `copyMode`. Every rule lives here so a new field never adds
 * another branch to the loader.
 * @param parsed - the parsed localStorage payload.
 * @returns the normalized prefs.
 */
function migrate(parsed: unknown): PluginPrefs {
  if (parsed === null || typeof parsed !== 'object') return { ...DEFAULTS }
  const record = parsed as Record<string, unknown>
  const wrapped = typeof record.version === 'number'
    && record.data !== null
    && typeof record.data === 'object'
  const source = (wrapped ? record.data : record) as Record<string, unknown>
  const storedVersion = wrapped ? (record.version as number) : 1
  // v1/v2 payloads predate the side chat's default flip, so a stored false there
  // is the old default rather than a choice the user made.
  const sideChatDefault = storedVersion >= 3 ? DEFAULTS.sideChat : true
  const rawMode = source.copyMode
  const copyMode: CopyMode = rawMode === 'auto'
    ? 'auto'
    : rawMode === 'toolbar'
      ? 'toolbar'
      : typeof source.copyOnSelect === 'boolean'
        ? (source.copyOnSelect ? 'auto' : 'toolbar')
        : DEFAULTS.copyMode
  return {
    copyMode,
    rightClickPaste: bool(source.rightClickPaste, DEFAULTS.rightClickPaste),
    globalHistory: bool(source.globalHistory, DEFAULTS.globalHistory),
    tocVisible: bool(source.tocVisible, DEFAULTS.tocVisible),
    promptCompletion: bool(source.promptCompletion, DEFAULTS.promptCompletion),
    contextSuggest: bool(source.contextSuggest, DEFAULTS.contextSuggest),
    sideChat: storedVersion >= 3 ? bool(source.sideChat, sideChatDefault) : true,
    writeGuard: bool(source.writeGuard, DEFAULTS.writeGuard),
  }
}

/** Read the persisted prefs (any stored shape), upgrading the payload in place. */
function load(): PluginPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { ...DEFAULTS }
    const parsed: unknown = JSON.parse(raw)
    const next = migrate(parsed)
    // Write the upgraded shape back once, so the migration rule does not have to
    // be re-applied on every load (and 'stored' matches what is in force).
    const storedVersion = parsed !== null && typeof parsed === 'object' && typeof (parsed as { version?: unknown }).version === 'number'
      ? (parsed as { version: number }).version
      : 1
    if (storedVersion !== STORE_VERSION) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORE_VERSION, data: next }))
    }
    return next
  } catch {
    return { ...DEFAULTS }
  }
}

/** Current prefs snapshot (stable until the next setPref). */
export function getPrefs(): PluginPrefs {
  return prefs
}

/** Apply one setting and persist it. */
export function setPref<K extends keyof PluginPrefs>(key: K, value: PluginPrefs[K]): void {
  prefs = { ...prefs, [key]: value }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORE_VERSION, data: prefs }))
  } catch {
    // Storage unavailable (private mode / quota): keep the in-memory value.
  }
  for (const fn of [...listeners]) {
    try { fn() } catch { /* one faulty listener must not starve the others */ }
  }
}

/** Subscribe to pref changes; returns the unsubscribe disposer. */
export function subscribePrefs(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
