/**
 * Tiny module-level translator for non-React code (feedback pills, the
 * selection toolbar, the search overlay, the TOC grip). apply() installs the
 * locale-bound translate function; T() reads the active locale at call time,
 * falling back to the key itself before apply runs or if a key is missing.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PromptHistoryKey } from './locales.ts'

let translator: TranslateNS<'dsh-prompt-history'> | undefined

/** Install the locale-bound translate (called once from apply). */
export function setTranslator(fn: TranslateNS<'dsh-prompt-history'>): void {
  translator = fn
}

/** Translate one plugin key using the active locale. */
export function T(key: PromptHistoryKey): string {
  if (translator !== undefined) {
    const text = translator(key)
    if (text !== key) return text
  }
  return key
}
