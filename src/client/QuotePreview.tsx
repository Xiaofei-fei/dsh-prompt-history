/**
 * Quote preview strip: renders above the composer (conversation.input.dock)
 * the FULL content of every quote chip currently in the draft, so the user
 * can see exactly what was quoted without hovering the (one-cell) chip. The
 * owner InputZone re-renders on every input-store change, so the strip tracks
 * quoting live and disappears once the chips are gone (sent or removed).
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ui-conversation SlotMap merge (the input.dock entry) and the
// InputZone owner share it carries.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The strip: one row per quote chip with the full quoted text. */
export function QuotePreview({ input }: PropsRuntime<'conversation.input.dock'>): JSX.Element | null {
  const quotes = input.occurrences.filter((o) => o.source === 'quote')
  if (quotes.length === 0) return null
  return (
    <div className="dsh-ph-quotes">
      {quotes.map((quote) => (
        <div className="dsh-ph-quote" key={quote.occurrenceId}>
          <span className="dsh-ph-quote-tag">引用</span>
          <span className="dsh-ph-quote-body">{quote.clipboardText}</span>
        </div>
      ))}
    </div>
  )
}
