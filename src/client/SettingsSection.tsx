/**
 * The settings-page section for dsh-prompt-history: a three-way copy mode
 * selector (toolbar / auto / off) and a right-click paste toggle, persisted
 * through the client-side prefs store. Registered into the `settings.section`
 * slot by the plugin apply; the shell supplies only `close`, so the section
 * draws its own copy and controls.
 */
import { useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { getPrefs, setPref, subscribePrefs, type CopyMode } from './prefs.ts'
import type { PromptHistoryKey } from './locales.ts'

/** Copy-mode options in display order (keys resolve through the locale seat). */
const COPY_MODES: ReadonlyArray<{ value: CopyMode; label: PromptHistoryKey }> = [
  { value: 'toolbar', label: 'copyMode.toolbar' },
  { value: 'auto', label: 'copyMode.auto' },
]

/** Section entry component: the copy-mode radio group plus the paste toggle. */
export function SettingsSection({ t }: PropsLocale<'dsh-prompt-history'>): JSX.Element {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs)
  return (
    <div className="dsh-ph-settings">
      <h4 className="dsh-ph-title">{t('settings.title')}（dsh-prompt-history）</h4>

      <p className="dsh-ph-group">{t('settings.copyGroup')}</p>
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

      <label className="dsh-ph-row">
        <input
          type="checkbox"
          checked={prefs.globalHistory}
          onChange={(e) => { setPref('globalHistory', e.target.checked) }}
        />
        <span>{t('history.global')}</span>
      </label>

      <label className="dsh-ph-row">
        <input
          type="checkbox"
          checked={prefs.tocVisible}
          onChange={(e) => { setPref('tocVisible', e.target.checked) }}
        />
        <span>{t('toc.toggle')}</span>
      </label>

      <p className="dsh-ph-note">{t('settings.note')}</p>
    </div>
  )
}
