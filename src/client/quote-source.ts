/**
 * The 'quote' input-trigger source: a hidden reference source that exists so
 * the selection-quote feature can insert a real reference chip into the
 * composer. It never appears in the '@' menu (empty candidates); its codec
 * expands a chip back to the quoted text on submit, and provides the
 * clipboard/persistence projection (the quoted text itself).
 */
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/** ref id → the quoted text the chip expands to on send. */
const quoteTexts = new Map<string, string>()
let seq = 0

/** Mint a unique ref id for one quote chip. */
export function nextQuoteRef(): string {
  seq += 1
  return `q${seq}`
}

/** Remember the quoted text behind a ref id (the codec reads it on submit). */
export function storeQuoteText(ref: string, quoted: string): void {
  quoteTexts.set(ref, quoted)
}

/** Build the hidden '@' source whose codec expands quote chips. */
export function createQuoteSource(): InputTriggerSource {
  return {
    trigger: '@',
    name: 'quote',
    order: 100,
    candidates: async () => [], // never listed in the '@' menu
    onPick: () => undefined, // never picked from a menu; the toolbar inserts chips directly
    codec: {
      clipboardText: (ref) => quoteTexts.get(ref) ?? '',
      serialize: (ref) => {
        const text = quoteTexts.get(ref)
        return text === undefined
          ? Promise.resolve('')
          : Promise.resolve(text)
      },
    },
  }
}
