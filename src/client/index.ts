/**
 * Prompt-history plugin, browser half: the composer entry (bash-like history,
 * copy modes, right-click paste, selection quote — see InputHistory.tsx) plus
 * a settings section with user toggles, internationalized (zh/en follows the
 * DSH app locale).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the Context merge (ctx.slots) from the renderer service.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
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
import { createBridge, mountContribution, setActiveBridge } from './suggest.ts'
import { hideSuggestion, installSuggestStyle, showPending, showSuggestion } from './suggestOverlay.ts'
import { hideGhost, showGhost } from './ghost.ts'
import { bindSideChat } from './sideChat.tsx'
import { bindRootContext } from './sessionCtx.ts'
import { bindQuoteContext, bindQuoteNotes } from './quoteMarks.tsx'

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
  '.dsh-ph-toc-list{overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;box-sizing:border-box;min-height:0;flex:1 1 auto;overscroll-behavior:contain;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);}',
  // Uniform directory rows: fixed 28px height, leading index column, and a
  // single-line ellipsis label (standard text-overflow — no line-clamp, which
  // Chromium 148 renders unreliably). Rows are therefore all exactly the same
  // compact height no matter the message length; the FULL text shows in the
  // hover tooltip, so shortening the preview loses nothing. No inter-row gap:
  // the entries stack as one tight directory (hover highlights the row).
  '.dsh-ph-toc-item{flex-shrink:0;display:flex;align-items:center;gap:8px;width:100%;height:28px;text-align:left;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;box-sizing:border-box;}',
  '.dsh-ph-toc-item:hover{background:var(--dsw-alias-bg-layer-2);}',
  '.dsh-ph-toc-idx{flex:none;min-width:24px;text-align:right;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;line-height:1;}',
  '.dsh-ph-toc-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.4;}',
  '.dsh-ph-toc-tip{position:fixed;z-index:2147483001;max-width:min(420px,calc(100vw - 24px));max-height:min(40vh,300px);overflow-y:auto;padding:8px 10px;border-radius:8px;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 6px 20px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;pointer-events:none;box-sizing:border-box;}',
  '.dsh-ph-toc-resize{position:absolute;right:3px;bottom:3px;width:14px;height:14px;cursor:se-resize;border-radius:3px;opacity:.55;background:linear-gradient(135deg,transparent 0 50%,var(--dsw-alias-label-tertiary) 50% 58%,transparent 58%),linear-gradient(135deg,transparent 0 66%,var(--dsw-alias-label-tertiary) 66% 74%,transparent 74%);}',
  '.dsh-ph-toc-resize:hover{opacity:1;}',
  '.dsh-ph-button{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 12px;font-size:12px;line-height:1.4;cursor:pointer;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
  '.dsh-ph-button:hover{background:var(--dsw-alias-bg-layer-3);}',
  '.dsh-ph-sidechat{display:flex;flex-direction:column;height:100%;min-height:0;gap:8px;padding:10px;}',
  '.dsh-ph-sidechat-strip{display:flex;gap:6px;flex-wrap:wrap;flex:0 0 auto;}',
  '.dsh-ph-sidechat-chip{border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px;font-size:12px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);}',
  '.dsh-ph-sidechat-chip--on{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);}',
  '.dsh-ph-sidechat-log{flex:1 1 auto;min-height:0;overflow-y:auto;border-radius:8px;border:1px dashed var(--dsw-alias-border-l1);padding:10px;}',
  '.dsh-ph-sidechat-empty{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary);}',
  '.dsh-ph-sidechat-chipLabel{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0;}',
  '.dsh-ph-sidechat-chipClose{border:0;background:transparent;color:inherit;cursor:pointer;opacity:.6;font-size:12px;padding:0 0 0 6px;}',
  '.dsh-ph-sidechat-chipClose:hover{opacity:1;}',
  '.dsh-ph-sidechat-row{display:flex;gap:8px;padding:6px 2px;border-bottom:1px solid var(--dsw-alias-border-l1);}',
  '.dsh-ph-sidechat-row:last-child{border-bottom:0;}',
  '.dsh-ph-sidechat-role{flex:0 0 62px;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--dsw-alias-label-tertiary);}',
  '.dsh-ph-sidechat-text{flex:1 1 auto;min-width:0;white-space:pre-wrap;word-break:break-word;font-size:12px;color:var(--dsw-alias-label-primary);}',
  '.dsh-ph-sidechat-row--tool .dsh-ph-sidechat-text{color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;}',
  '.dsh-ph-sidechat-row--user .dsh-ph-sidechat-text{color:var(--dsw-alias-label-primary);}',
  '.dsh-ph-sidechat-compose{display:flex;gap:6px;align-items:flex-end;flex:0 0 auto;}',
  '.dsh-ph-guard{flex:0 0 auto;border-radius:6px;padding:6px 8px;font-size:11px;line-height:1.5;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);}',
  '.dsh-ph-guard--clash{background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);color:var(--dsw-alias-label-primary);}',
  '.dsh-ph-guardList{margin:4px 0 0;padding-left:16px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;}',
  '.dsh-ph-sidechat-head{display:flex;gap:4px;justify-content:flex-end;flex:0 0 auto;}',
  '.dsh-ph-iconButton{border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:4px;font-size:12px;line-height:1;padding:3px 6px;}',
  '.dsh-ph-iconButton:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);}',
  '.dsh-ph-sidechat-title{display:inline-flex;align-items:center;gap:4px;}',
  '.dsh-ph-sidechat-badge{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-2);font-size:10px;font-weight:600;line-height:1;}',
  '.dsh-ph-sidechat-running{font-size:10px;opacity:.7;}',
  '.dsh-ph-panelComposer{display:flex;flex-direction:column;gap:4px;flex:1 1 auto;min-width:0;}',
  '.dsh-ph-panelHint{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.dsh-ph-panelHintText{color:var(--dsw-alias-label-secondary);}',
  '.dsh-ph-sidechat-input{flex:1 1 auto;min-width:0;resize:vertical;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);',
  'background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:12px system-ui,sans-serif;padding:6px 8px;}',
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

  // Keep the root context so the full-history TOC can widen the loaded window
  // with loadOlder() from component code (no ctx there); the sessions service
  // is resolved lazily per call — it appears only after the host connection.
  bindRootContext(ctx)
  // Quote marks need the same root context: the submit hook reaches the
  // per-session composer shell through the conversation service (with a DOM
  // fallback), and the transcript pill registers on uiConversation.
  bindQuoteContext(ctx)
  bindQuoteNotes(ctx)
  // Style first: the suggestion overlay hides the composer's own placeholder.
  installSuggestStyle()

  // Test seam: the E2E suite opts in through localStorage so the overlay
  // regressions (stray ghost over typed text, ghost above a covering popup,
  // geometry after a layout change) can be exercised deterministically without a
  // model round-trip. Only the harness sets this key; users never get a global.
  try {
    if (window.localStorage.getItem('dsh-prompt-history.testSeam') === '1') {
      Reflect.set(window, '__dshPhTest', {
        showSuggestion, showPending, hideSuggestion, showGhost, hideGhost,
        suggestionVisible: (): boolean => document.querySelector('.dsh-ph-suggest') !== null,
        ghostVisible: (): boolean => document.querySelector('.dsh-ph-ghost') !== null,
      })
    }
  } catch { /* storage unavailable: no seam */ }

  // Side chat rides the right sidebar: the toggle decides whether the tab type
  // and its body are registered at all.
  ctx.inject(['sidebarRightTabs', 'sidebarRight', 'slots'], (sideCtx) => {
    bindSideChat(sideCtx)
  })

  // The next-prompt suggestion needs the `remote` service: mount this
  // package's host face from an injected child context, then publish the
  // bridge to the composer entry. Without the service the feature stays off.
  ctx.inject(['remote'], (remoteCtx) => {
    void mountContribution(remoteCtx).then((mounted) => {
      if (!mounted) return
      setActiveBridge(createBridge(remoteCtx))
    })
  })

  // The suggestion bridge needs the `remote` service (mounted from an injected
  // child context) and then its `remote.promptSuggest` namespace service, which
  // only exists after the mount — the second inject waits for exactly that.
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
      label: () => T('settings.nav'),
    },
    SettingsSection,
  ))

}
