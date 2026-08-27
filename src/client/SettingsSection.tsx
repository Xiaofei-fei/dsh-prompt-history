/**
 * The settings-page section for dsh-prompt-history: a three-way copy mode
 * selector (toolbar / auto / off) and a right-click paste toggle, persisted
 * through the client-side prefs store. Registered into the `settings.section`
 * slot by the plugin apply; the shell supplies only `close`, so the section
 * draws its own copy and controls.
 */
import { useSyncExternalStore } from 'react'
import { getPrefs, setPref, subscribePrefs, type CopyMode } from './prefs.ts'

/** Copy-mode options in display order. */
const COPY_MODES: ReadonlyArray<{ value: CopyMode; label: string; hint: string }> = [
  {
    value: 'toolbar',
    label: '工具栏复制（推荐）',
    hint: '选中文字后出现「复制」按钮，点击才复制——不污染剪贴板历史',
  },
  {
    value: 'auto',
    label: '选中即自动复制',
    hint: '选中即写入系统剪贴板（终端风格，会刷屏 Win+V 历史，慎用）',
  },
  {
    value: 'off',
    label: '关闭复制',
    hint: '选中不做任何事',
  },
]

/** Section entry component: the copy-mode radio group plus the paste toggle. */
export function SettingsSection(): JSX.Element {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs)
  return (
    <div className="dsh-ph-settings">
      <h4 className="dsh-ph-title">终端式输入（dsh-prompt-history）</h4>

      <p className="dsh-ph-group">复制方式（选中文字时）</p>
      {COPY_MODES.map((mode) => (
        <label className="dsh-ph-row" key={mode.value}>
          <input
            type="radio"
            name="dsh-ph-copy-mode"
            checked={prefs.copyMode === mode.value}
            onChange={() => { setPref('copyMode', mode.value) }}
          />
          <span>
            <b>{mode.label}</b>
            <span className="dsh-ph-hint"> — {mode.hint}</span>
          </span>
        </label>
      ))}

      <label className="dsh-ph-row">
        <input
          type="checkbox"
          checked={prefs.rightClickPaste}
          onChange={(e) => { setPref('rightClickPaste', e.target.checked) }}
        />
        <span>右键直接粘贴：输入框上右键即粘贴剪贴板内容（终端风格，不弹菜单）</span>
      </label>

      <p className="dsh-ph-note">历史（↑/↓）始终开启，不随以上开关变化。设置存于浏览器本地，修改立即生效。</p>
    </div>
  )
}
