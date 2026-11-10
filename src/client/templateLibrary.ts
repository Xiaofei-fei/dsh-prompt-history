/**
 * The prompt-template library: user-saved prompt snippets the composer inserts
 * with one click (the "常用提示词" half of dsh-prompt-history).
 *
 * Storage is localStorage, versioned so a shape change never strands a
 * payload: every read normalizes through one sanitizer, and a payload written
 * by an older build still loads. The list is a tiny observable store — the
 * snapshot keeps its identity until a mutation — so React can subscribe through
 * useSyncExternalStore and event-time readers see the same authoritative value.
 *
 * Nothing here touches the DOM or the composer: insertion lives in
 * TemplatesAction.tsx, this module only owns the data.
 *
 * @module dsh-prompt-history/client/templateLibrary
 */
import { T } from './i18n.ts'
import type { PromptHistoryKey } from './locales.ts'

/** One saved prompt template. */
export interface PromptTemplate {
  /** Stable identity, generated on creation (never reused). */
  readonly id: string
  /** Short display name; the row's only always-visible line. */
  readonly name: string
  /** The text written into the composer when the row is clicked. */
  readonly body: string
}

/** Longest accepted template name. */
export const NAME_MAX = 40
/** Longest accepted template body. */
export const BODY_MAX = 8_000
/** Most templates kept; the oldest is dropped past this. */
export const LIBRARY_CAP = 100

const STORAGE_KEY = 'dsh-prompt-history.templates'
/** Stored shape version; bump when the normalization rules change. */
const STORE_VERSION = 1

/**
 * The payload actually persisted. `seeded` records that the starter set was
 * already offered once, so deleting every starter never brings them back.
 */
interface StoredLibrary {
  readonly version: number
  readonly seeded: boolean
  readonly items: readonly unknown[]
}

/** Current list; replaced on every mutation (stable snapshot identity). */
let items: readonly PromptTemplate[] = []
/** Whether the starter set has been offered (persisted). */
let seeded = false
const listeners = new Set<() => void>()

/** Generate a collision-proof id without depending on crypto.randomUUID. */
function newId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Trim to a length the panel can render, or '' when the value is unusable. */
function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/**
 * Normalize one stored entry, dropping anything that cannot render.
 * Ids are regenerated when missing so a hand-edited payload still loads.
 * @param raw - one unknown entry from storage.
 * @returns the template, or null when the entry carries no name and no body.
 */
function sanitize(raw: unknown): PromptTemplate | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const name = text(record.name, NAME_MAX)
  const body = text(record.body, BODY_MAX)
  if (name === '' && body === '') return null
  const id = typeof record.id === 'string' && record.id !== '' ? record.id : newId()
  return { id, name: name === '' ? body.slice(0, NAME_MAX) : name, body }
}

/**
 * Read the persisted library (any stored shape).
 * @returns the normalized templates, oldest first, capped.
 */
function load(): { readonly items: readonly PromptTemplate[]; readonly seeded: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { items: [], seeded: false }
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return { items: [], seeded: false }
    const record = parsed as Partial<StoredLibrary>
    // Tolerate the degenerate shape a draft build may have written: a bare array.
    const source: readonly unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(record.items) ? record.items : []
    const out: PromptTemplate[] = []
    for (const entry of source) {
      const template = sanitize(entry)
      if (template !== null) out.push(template)
      if (out.length >= LIBRARY_CAP) break
    }
    return { items: out, seeded: record.seeded === true }
  } catch {
    // Unreadable payload (private mode, quota, hand-edited JSON): start empty
    // rather than crash the composer.
    return { items: [], seeded: false }
  }
}

/** Write the current list back. Failures are soft: memory stays authoritative. */
function persist(): void {
  try {
    const payload: StoredLibrary = { version: STORE_VERSION, seeded, items }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Storage unavailable: the in-memory list keeps working for this page.
  }
}

/** Announce a mutation to every subscriber (one faulty listener must not starve the rest). */
function notify(): void {
  for (const fn of [...listeners]) {
    try { fn() } catch { /* isolation */ }
  }
}

// Load once at module scope: the panel and the settings page both read the
// same list, and neither wants a storage round-trip per render.
{
  const loaded = load()
  items = loaded.items
  seeded = loaded.seeded
}

/** The starter set offered on first run, localized through the plugin dictionary. */
const SEEDS: ReadonlyArray<{ readonly name: PromptHistoryKey; readonly body: PromptHistoryKey }> = [
  { name: 'tpl.seedReview.name', body: 'tpl.seedReview.body' },
  { name: 'tpl.seedExplain.name', body: 'tpl.seedExplain.body' },
  { name: 'tpl.seedTests.name', body: 'tpl.seedTests.body' },
  { name: 'tpl.seedEdge.name', body: 'tpl.seedEdge.body' },
  { name: 'tpl.seedRefactor.name', body: 'tpl.seedRefactor.body' },
]

/**
 * Write the starter templates once, on the first run of this build.
 *
 * Called from `apply()` after the translator is installed, so the seeds land in
 * the app's current language. Deleting them afterwards is permanent: `seeded`
 * is persisted alongside the list.
 */
export function ensureSeeded(): void {
  if (seeded) return
  seeded = true
  const out: PromptTemplate[] = [...items]
  for (const seed of SEEDS) {
    if (out.length >= LIBRARY_CAP) break
    const name = T(seed.name)
    const body = T(seed.body)
    // A missing dictionary key returns the key itself: never seed placeholders.
    if (name.startsWith('tpl.') || body.startsWith('tpl.')) continue
    out.push({ id: newId(), name: text(name, NAME_MAX), body: text(body, BODY_MAX) })
  }
  items = out
  persist()
  notify()
}

/** Current templates snapshot (stable until the next mutation). */
export function getTemplates(): readonly PromptTemplate[] {
  return items
}

/**
 * Subscribe to library mutations.
 * @param fn - called after every add/update/delete.
 * @returns the unsubscribe disposer.
 */
export function subscribeTemplates(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * Create or update one template.
 *
 * `id === null` appends a new template; otherwise the entry with that id is
 * replaced in place, keeping its position in the list. Either way the caller's
 * strings are trimmed and length-capped before they are stored.
 *
 * @param id - the template to update, or null to create one.
 * @param name - the display name (falls back to the body's head when empty).
 * @param body - the text to insert.
 * @returns the stored template, or null when name and body are both empty.
 */
export function saveTemplate(id: string | null, name: string, body: string): PromptTemplate | null {
  const cleanName = text(name, NAME_MAX)
  const cleanBody = text(body, BODY_MAX)
  if (cleanName === '' && cleanBody === '') return null
  const next: PromptTemplate = {
    id: id === null || id === '' ? newId() : id,
    name: cleanName === '' ? cleanBody.slice(0, NAME_MAX) : cleanName,
    body: cleanBody,
  }
  if (id === null || id === '') {
    const out = [...items, next]
    items = out.length > LIBRARY_CAP ? out.slice(out.length - LIBRARY_CAP) : out
  } else {
    const index = items.findIndex((entry) => entry.id === id)
    if (index === -1) items = [...items, next]
    else {
      const out = [...items]
      out[index] = next
      items = out
    }
  }
  persist()
  notify()
  return next
}

/**
 * Delete one template.
 * @param id - the template to drop; unknown ids are a no-op.
 */
export function removeTemplate(id: string): void {
  const index = items.findIndex((entry) => entry.id === id)
  if (index === -1) return
  const out = [...items]
  out.splice(index, 1)
  items = out
  persist()
  notify()
}
