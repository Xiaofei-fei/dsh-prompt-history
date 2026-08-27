/**
 * Prompt-history plugin, browser half: the composer entry (bash-like history,
 * copy-on-select, right-click paste — see InputHistory.tsx) plus a settings
 * section with user toggles for the copy/paste behaviors.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right entry)
// and the session standard kit members used by the component.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-settings SlotMap merge (the settings.section entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { InputHistory } from './InputHistory.tsx'
import { SettingsSection } from './SettingsSection.tsx'

/** Required services: the slot registry the entries register into. */
export const inject = ['slots']

/** One-time style tag for the settings section (theme tokens adapt to light/dark). */
const SETTINGS_CSS = [
  '.dsh-ph-settings{padding:4px 2px;}',
  '.dsh-ph-title{margin:0 0 10px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);}',
  '.dsh-ph-row{display:flex;align-items:flex-start;gap:8px;margin:8px 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);cursor:pointer;}',
  '.dsh-ph-row input{margin-top:3px;accent-color:var(--dsw-static-blue-900);}',
  '.dsh-ph-note{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary);}', '.dsh-ph-group{margin:8px 0 4px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}', '.dsh-ph-hint{color:var(--dsw-alias-label-tertiary);}',
].join('')

/**
 * Client plugin body: register the composer input-history entry and the
 * settings section. Both declarations live in other packages whose apply order
 * is unconstrained — slots.inject waits on each declaration and retires the
 * contribution with this plugin's fiber.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-prompt-history'
  style.textContent = SETTINGS_CSS
  document.head.appendChild(style)

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
    { name: 'conversation.input.right', id: 'dsh-prompt-history' },
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
