/**
 * Prompt-history plugin, browser half: the composer entry (bash-like history,
 * copy modes, right-click paste, selection quote — see InputHistory.tsx) plus
 * a settings section with user toggles for the copy/paste behaviors.
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
  '.dsh-ph-note{margin:10px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary);}',
  '.dsh-ph-group{margin:8px 0 4px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}',
  '.dsh-ph-toc-grip{position:fixed;z-index:2147483000;width:20px;height:52px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-specific-menu);background:color-mix(in srgb,var(--dsw-specific-menu) 88%,#000);box-shadow:0 1px 4px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1;cursor:pointer;opacity:.65;transition:opacity .15s;display:flex;align-items:center;justify-content:center;padding:0;}',
  '.dsh-ph-toc-grip:hover{opacity:1;background:var(--dsw-alias-bg-layer-2);}',
  '.dsh-ph-toc{position:fixed;z-index:2147483000;width:220px;max-height:min(60vh,480px);display:flex;flex-direction:column;padding:8px;border-radius:12px;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 8px 28px rgba(0,0,0,.25);}',
  '.dsh-ph-toc-title{margin:0 4px 6px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}',
  '.dsh-ph-toc-list{overflow-y:auto;display:flex;flex-direction:column;gap:2px;}',
  '.dsh-ph-toc-item{display:block;width:100%;text-align:left;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.4;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.dsh-ph-toc-item:hover{background:var(--dsw-alias-bg-layer-2);}',
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
