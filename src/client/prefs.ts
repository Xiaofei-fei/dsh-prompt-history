/**
 * Client-side preferences for dsh-prompt-history, backed by localStorage.
 * A tiny observable store: listeners subscribe via {@link subscribePrefs},
 * snapshots stay reference-stable until {@link setPref} replaces the object,
 * so React's useSyncExternalStore and the event-time reads in InputHistory
 * both see the same authoritative value.
 */

/** The user-facing toggles of this plugin. */
export interface PluginPrefs {
  /** Auto-copy any non-empty selection in the page once it stabilizes. */
  copyOnSelect: boolean
  /** Right-click on the composer textarea pastes the clipboard directly. */
  rightClickPaste: boolean
}

const STORAGE_KEY = 'dsh-prompt-history.prefs'
const DEFAULTS: PluginPrefs = { copyOnSelect: true, rightClickPaste: true }

/** Current prefs; replaced on every setPref (stable snapshot identity). */
let prefs: PluginPrefs = load()
const listeners = new Set<() => void>()

/** Read the persisted prefs, tolerating absent/corrupt storage. */
function load(): PluginPrefs {
  const fallback = (): PluginPrefs => ({ ...DEFAULTS })
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return fallback()
    const parsed = JSON.parse(raw) as Partial<PluginPrefs>
    return {
      copyOnSelect: typeof parsed.copyOnSelect === 'boolean' ? parsed.copyOnSelect : DEFAULTS.copyOnSelect,
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

/** Apply one toggle and persist it. */
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
