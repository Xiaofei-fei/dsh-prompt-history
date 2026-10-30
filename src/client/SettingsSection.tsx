/**
 * The settings-page section for dsh-prompt-history: grouped toggles for the two
 * composer completion sources, the clipboard behaviors and the session
 * navigation helpers, plus a bridge status line so a broken host link is
 * visible without opening the console.
 */
import { useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { getPrefs, setPref, subscribePrefs, type CopyMode } from './prefs.ts'
import type { PromptHistoryKey } from './locales.ts'
import { PLUGIN_VERSION } from './i18n.ts'
import { getActiveBridge, subscribeBridge } from './suggest.ts'
import { openSideChat } from './sideChat.tsx'

/** Copy-mode options in display order (keys resolve through the locale seat). */
const COPY_MODES: ReadonlyArray<{ value: CopyMode; label: PromptHistoryKey }> = [
  { value: 'toolbar', label: 'copyMode.toolbar' },
  { value: 'auto', label: 'copyMode.auto' },
]

/** Section entry: grouped preferences plus the prediction-bridge status. */
export function SettingsSection({ t }: PropsLocale<'dsh-prompt-history'>): JSX.Element {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs)
  const bridgeReady = useSyncExternalStore(subscribeBridge, () => getActiveBridge() !== null)
  return (
    <div className="dsh-ph-settings">
      <h4 className="dsh-ph-title">{t('settings.title')}（dsh-prompt-history v{PLUGIN_VERSION}）</h4>

      <p className="dsh-ph-group">{t('settings.groupInput')}</p>
      <label className="dsh-ph-row">
        <input
          type="checkbox"
          checked={prefs.contextSuggest}
          onChange={(e) => { setPref('contextSuggest', e.target.checked) }}
        />
        <span>{t('suggest.toggle')}</span>
      </label>
      <label className="dsh-ph-row">
        <input
          type="checkbox"
          checked={prefs.promptCompletion}
          onChange={(e) => { setPref('promptCompletion', e.target.checked) }}
        />
        <span>{t('completion.toggle')}</span>
      </label>

      <p className="dsh-ph-group">{t('settings.groupClipboard')}</p>
      {COPY_MODES.map((mode) => (
        <label className="dsh-ph-row" key={mode.value}>
          <input
            type="radio"
            name="dsh-ph-copy-mode"
            checked={prefs.copyMode === mode.value}
            onChange={() => { setPref('copyMode', mode.value) }}
          />
          <span>{t(mode.label)}</span>
        </label>
      ))}
      <label className="dsh-ph-row">
        <input
          type="checkbox"
          checked={prefs.rightClickPaste}
          onChange={(e) => { setPref('rightClickPaste', e.target.checked) }}
        />
        <span>{t('paste.toggle')}</span>
      </label>

      <p className="dsh-ph-group">{t('settings.groupNav')}</p>
      <label className="dsh-ph-row">
        <input
          type="checkbox"
          checked={prefs.tocVisible}
          onChange={(e) => { setPref('tocVisible', e.target.checked) }}
        />
        <span>{t('toc.toggle')}</span>
      </label>
      <label className="dsh-ph-row">
        <input
          type="checkbox"
          checked={prefs.globalHistory}
          onChange={(e) => { setPref('globalHistory', e.target.checked) }}
        />
        <span>{t('history.global')}</span>
      </label>

      <p className="dsh-ph-group">{t('sideChat.group')}</p>
      <label className="dsh-ph-row">
        <input
          type="checkbox"
          checked={prefs.sideChat}
          onChange={(e) => { setPref('sideChat', e.target.checked) }}
        />
        <span>{t('sideChat.toggle')}</span>
      </label>
      {prefs.sideChat && (
        <div className="dsh-ph-row">
          <button type="button" className="dsh-ph-button" onClick={() => { openSideChat() }}>
            {t('sideChat.open')}
          </button>
        </div>
      )}
      {prefs.sideChat && (
        <label className="dsh-ph-row">
          <input
            type="checkbox"
            checked={prefs.writeGuard}
            onChange={(e) => { setPref('writeGuard', e.target.checked) }}
          />
          <span>{t('sideChat.guardToggle')}</span>
        </label>
      )}
      <p className="dsh-ph-note">{t('sideChat.note')}</p>

      <p className="dsh-ph-note">{t('bridge.label')}：{bridgeReady ? t('bridge.on') : t('bridge.off')}</p>

      <p className="dsh-ph-note">{t('suggest.keys')}</p>
      <p className="dsh-ph-note">{t('settings.note')}</p>
    </div>
  )
}
