/**
 * Client-side preferences for dsh-prompt-history, backed by localStorage.
 * A tiny observable store: listeners subscribe via {@link subscribePrefs},
 * snapshots stay reference-stable until {@link setPref} replaces the object,
 * so React's useSyncExternalStore and the event-time reads in InputHistory
 * both see the same authoritative value.
 */

/** Copy behavior on text selection. */
export type CopyMode = 'toolbar' | 'auto' | 'off'

/** The user-facing settings of this plugin. */
export interface PluginPrefs {
  /**
   * How a selection copies: 'toolbar' shows an explicit copy button above the
   * selection (the safe default — nothing writes the system clipboard until
   * the user clicks); 'auto' copies the selection directly (terminal-style,
   * floods clipboard history); 'off' does nothing.
   */
  copyMode: CopyMode
  /** Right-click on the composer textarea pastes the clipboard directly. */
  rightClickPaste: boolean
}

const STORAGE_KEY = 'dsh-prompt-history.prefs'
const DEFAULTS: PluginPrefs = { copyMode: 'toolbar', rightClickPaste: true }

/** Current prefs; replaced on every setPref (stable snapshot identity). */
let prefs: PluginPrefs = load()
const listeners = new Set<() => void>()

/** Migrate the pre-v0.7.0 boolean toggle, then read the persisted prefs. */
function load(): PluginPrefs {
  const fallback = (): PluginPrefs => ({ ...DEFAULTS })
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return fallback()
    const parsed = JSON.parse(raw) as Partial<PluginPrefs> & { copyOnSelect?: boolean }
    // Legacy migration: the old copyOnSelect boolean maps onto the mode.
    const copyMode: CopyMode = (parsed as { copyMode?: unknown }).copyMode === 'auto'
      || (parsed as { copyMode?: unknown }).copyMode === 'toolbar'
      || (parsed as { copyMode?: unknown }).copyMode === 'off'
      ? (parsed as { copyMode: CopyMode }).copyMode
      : typeof parsed.copyOnSelect === 'boolean'
        ? (parsed.copyOnSelect ? 'auto' : 'off')
        : DEFAULTS.copyMode
    return {
      copyMode,
      rightClickPaste: typeof parsed.rightClickPaste === 'boolean' ? parsed.rightClickPaste : DEFAULTS.rightClickPaste,
    }
  } catch {
    return fallback()
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
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
