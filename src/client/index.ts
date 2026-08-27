/**
 * Prompt-history plugin, browser half: the composer entry (bash-like history,
 * copy modes, right-click paste, selection quote — see InputHistory.tsx) plus
 * a settings section with user toggles for the copy/paste behaviors.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InputTriggerServiceContract, ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right entry)
// and the session standard kit members used by the component.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-settings SlotMap merge (the settings.section entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { InputHistory } from './InputHistory.tsx'
import { SettingsSection } from './SettingsSection.tsx'
import { createQuoteSource } from './quote-source.ts'

/** Required services: the slot registry, the trigger pipeline, and the sessions service. */
export const inject = ['slots', 'inputTriggers', 'sessions']

/** One-time style tag for the settings section (theme tokens adapt to light/dark). */
const SETTINGS_CSS = [
  '.dsh-ph-settings{padding:4px 2px;}',
  '.dsh-ph-title{margin:0 0 10px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);}',
  '.dsh-ph-row{display:flex;align-items:flex-start;gap:8px;margin:8px 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);cursor:pointer;}',
  '.dsh-ph-row input{margin-top:3px;accent-color:var(--dsw-static-blue-900);}',
  '.dsh-ph-note{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary);}',
  '.dsh-ph-group{margin:8px 0 4px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}',
  '.dsh-ph-hint{color:var(--dsw-alias-label-tertiary);}',
].join('')

/**
 * Client plugin body: register the composer input-history entry (with the
 * quote-chip insertion face), the hidden quote reference source, and the
 * settings section. Declarations live in other packages whose apply order is
 * unconstrained — slots.inject waits on each declaration and retires the
 * contribution with this plugin's fiber.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-prompt-history'
  style.textContent = SETTINGS_CSS
  document.head.appendChild(style)

  // The hidden 'quote' reference source: makes the selection-quote chips
  // serializable on submit (see quote-source.ts).
  ctx.effect(() => {
    const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
    const unregister = inputTriggers.registerSource(createQuoteSource())
    return () => { unregister() }
  }, 'dsh-prompt-history: quote source')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
    {
      name: 'conversation.input.right',
      id: 'dsh-prompt-history',
      inject: (sessionId: SessionId) => ({
        /**
         * Insert one reference chip into the session's composer draft via the
         * scoped input event (the hub applies it to the input machine).
         * @param reference - the chip material (source/ref/label/clipboardText).
         * @param span - draft span at the caret (draftRev CAS).
         * @returns whether the machine accepted the insertion.
         */
        insertQuoteRef: (reference: ReferenceInsert, span: TokenSpan): boolean => {
          const actx = ctx.sessions.binding(sessionId)?.ctx
          if (actx === undefined) return false
          return actx.bail(actx, 'slash/input-insert-reference', { reference, span }) === true
        },
      }),
    },
    InputHistory,
  ))
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: 'dsh-prompt-history',
      order: 60,
      label: '终端式输入',
    },
    SettingsSection,
  ))
}
