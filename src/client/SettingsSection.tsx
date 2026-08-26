/**
 * The settings-page section for dsh-prompt-history: two toggles (copy on
 * select, right-click paste) persisted through the client-side prefs store.
 * Registered into the `settings.section` slot by the plugin apply; the shell
 * supplies only `close`, so the section draws its own copy and controls.
 */
import { useSyncExternalStore } from 'react'
import { getPrefs, setPref, subscribePrefs } from './prefs.ts'

/** Section entry component: two checkbox toggles for the plugin's behaviors. */
export function SettingsSection(): JSX.Element {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs)
  return (
    <div className="dsh-ph-settings">
      <h4 className="dsh-ph-title">终端式输入（dsh-prompt-history）</h4>
      <label className="dsh-ph-row">
        <input
          type="checkbox"
          checked={prefs.copyOnSelect}
          onChange={(e) => { setPref('copyOnSelect', e.target.checked) }}
        />
        <span>选中即复制：页面中任何选中文字（拖选/双击/键盘选中）自动复制到剪贴板</span>
      </label>
      <label className="dsh-ph-row">
        <input
          type="checkbox"
          checked={prefs.rightClickPaste}
          onChange={(e) => { setPref('rightClickPaste', e.target.checked) }}
        />
        <span>右键直接粘贴：输入框上右键即粘贴剪贴板内容（终端风格，不弹菜单）</span>
      </label>
      <p className="dsh-ph-note">关闭后对应功能完全停用（右键恢复浏览器原生菜单）。</p>
    </div>
  )
}
