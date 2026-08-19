/**
 * Prompt-history plugin, browser half: one invisible entry in the composer's
 * input.right tool row that mounts the capture-phase keyboard listener (see
 * InputHistory.tsx for the full behavior contract).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right entry)
// and the session standard kit members used by the component.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { InputHistory } from './InputHistory.tsx'

/** Required services: the slot registry the entry registers into. */
export const inject = ['slots']

/**
 * Client plugin body: register the composer input-history entry. The
 * declaration lives in ui-conversation, whose apply order is unconstrained —
 * slots.inject waits on the actual declaration and retires the contribution
 * with this plugin's fiber.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
    { name: 'conversation.input.right', id: 'dsh-prompt-history' },
    InputHistory,
  ))
}
