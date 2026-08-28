/**
 * Prompt-history plugin, browser half: the composer entry (bash-like history,
 * copy modes, right-click paste, selection quote — see InputHistory.tsx) plus
 * a settings section with user toggles, internationalized (zh/en follows the
 * DSH app locale).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right entry)
// and the session standard kit members used by the component.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-settings SlotMap merge (the settings.section entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { InputHistory } from './InputHistory.tsx'
import { SettingsSection } from './SettingsSection.tsx'
import { NS, en, zh } from './locales.ts'
import { setTranslator, T } from './i18n.ts'
import { installNavGlyph } from './navGlyph.ts'

/** Required services: the slot registry, the locale service. */
export const inject = ['slots', 'locale']

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
  '.dsh-ph-toc{position:fixed;z-index:2147483000;width:300px;max-height:min(60vh,480px);display:flex;flex-direction:column;padding:8px;border-radius:12px;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 8px 28px rgba(0,0,0,.25);box-sizing:border-box;}',
  '.dsh-ph-toc-title{margin:0 4px 6px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);flex-shrink:0;}',
  // Header-fixed / list-scrollable: the list is a flex child with min-height:0
  // so it shrinks to the remaining panel height; each item is flex-shrink:0 so
  // entries NEVER compress when the list overflows — the excess simply scrolls
  // (overflow-y:auto), keeping every row's height, font and line-height intact.
  '.dsh-ph-toc-list{overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:2px;box-sizing:border-box;min-height:0;flex:1 1 auto;overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);}',
  '.dsh-ph-toc-item{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;flex-shrink:0;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;cursor:pointer;overflow:hidden;white-space:normal;box-sizing:border-box;}',
  '.dsh-ph-toc-item:hover{background:var(--dsw-alias-bg-layer-2);}',
].join('')

/**
 * Client plugin body: register the dictionaries, the composer input-history
 * entry, and the settings section (locale-aware label). Declarations live in
 * other packages whose apply order is unconstrained — slots.inject waits on
 * each declaration and retires the contribution with this plugin's fiber.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const style = document.createElement('style')
  // data-plugin-css (not data-plugin): the theme/skin system also tags style
  // elements with the bundle's package name, so a query on data-plugin would
  // be ambiguous.
  style.dataset.pluginCss = 'dsh-ph-settings'
  style.textContent = SETTINGS_CSS
  document.head.appendChild(style)

  // Dictionaries + the vanilla-DOM translator (toolbar/pills/overlay/TOC).
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-prompt-history: dictionaries')
  setTranslator(ctx.locale.bind(NS))

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
    { name: 'conversation.input.right', id: 'dsh-prompt-history' },
    InputHistory,
  ))
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    {
      name: 'settings.section',
      id: 'dsh-prompt-history',
      order: 60,
      locale: NS,
      // The nav label carries no glyph — the shell would draw a generic gear
      // for unknown ids; installNavGlyph swaps that gear for a terminal `>_`.
      label: () => T('settings.nav'),
    },
    SettingsSection,
  ))

  // Swap the shell's default gear nav icon for the terminal `>_` glyph.
  installNavGlyph()
}
