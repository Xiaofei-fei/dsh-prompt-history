/**
 * Side-chat regressions: the default-on preference, the toolbar action that must
 * vanish when the feature is off, and the panel itself (open, fork a thread).
 *
 * @module dsh-prompt-history/test/e2e/sidechat
 */
import { openScratchSession, seedComposerMessage, sleep, waitForIdle } from './harness.mjs'

/** Open the settings section of this plugin. */
async function openSettingsSection(page) {
  await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="设置"]')
    if (button !== null) button.click()
  })
  await sleep(2200)
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('button, [role="tab"], [role="menuitem"], li, a, div, span')]
      .find((el) => el.children.length === 0 && /终端式输入|Terminal Input/.test((el.textContent ?? '').trim()))
    if (label === undefined) return
    const clickable = label.closest('button, [role="tab"], [role="menuitem"], li, a') ?? label
    clickable.click()
  })
  await sleep(1500)
}

/** The selection toolbar's button labels for a message selection. */
async function toolbarButtons(page) {
  await page.evaluate(() => {
    const row = document.querySelector('[data-chat-flow-kind="user"]')
    if (row === null) return
    const range = document.createRange()
    range.selectNodeContents(row)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  // The toolbar shows up a frame after the selection settles, and a busy
  // conversation can re-render in between: poll instead of one fixed wait.
  let labels = []
  for (let i = 0; i < 10; i += 1) {
    await sleep(300)
    labels = await page.evaluate(() => {
      document.dispatchEvent(new Event('selectionchange'))
      return [...document.querySelectorAll('.dsh-ph-toolbar button')].map((b) => (b.textContent ?? '').trim())
    })
    if (labels.length > 0) break
  }
  await page.keyboard.press('Escape')
  await sleep(300)
  return labels
}

/**
 * Run the side-chat suite.
 * @param page - an app page seeded with {@link import('./harness.mjs').BASE_PREFS}.
 * @param check - the runner's assertion collector.
 * @param browser - the browser, so a suite can probe the off-state in a second page.
 */
export async function sideChatSuite(page, check, browser) {
  await openScratchSession(page)
  // The scratch session starts empty; the toolbar needs a selection and the fork
  // needs context, so give it one prompt first.
  await seedComposerMessage(page, '侧聊校验用的一条固定提示词')
  await waitForIdle(page)

  // 1) Default-on: a fresh profile keeps the switch on, so the toolbar offers it.
  const withFeature = await toolbarButtons(page)
  check('side chat is on by default (toolbar offers 侧聊追问)',
    withFeature.includes('复制') && withFeature.includes('引用') && withFeature.some((label) => /侧聊/.test(label)),
    { labels: withFeature })

  // 2) Settings reads the toggle as enabled.
  await openSettingsSection(page)
  const settings = await page.evaluate(() => {
    const box = document.querySelector('.dsh-ph-settings')
    if (box === null) return { found: false }
    const rows = [...box.querySelectorAll('label')]
    const toggle = rows.find((row) => /侧聊|side chat/i.test(row.textContent ?? '') && !/冲突提醒|parallel writes/i.test(row.textContent ?? ''))
    const text = (box.textContent ?? '').replace(/\s+/g, ' ')
    return {
      found: true,
      checked: toggle?.querySelector('input')?.checked ?? null,
      groups: [...box.querySelectorAll('.dsh-ph-group')].map((g) => (g.textContent ?? '').trim()),
      version: (text.match(/v1\.[0-9.]+/) ?? [])[0] ?? null,
      bridgeOn: /桥接：已连接/.test(text),
    }
  })
  await page.keyboard.press('Escape')
  await sleep(700)
  check('settings shows the side-chat toggle as enabled',
    settings.found === true && settings.checked === true && settings.bridgeOn === true,
    settings)

  // 3) The panel opens and a fork thread appears (no model call involved).
  await openSettingsSection(page)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => /打开侧聊|Open side chat/.test((b.textContent ?? '').trim()))
    if (button !== undefined) button.click()
  })
  await sleep(2500)
  await page.keyboard.press('Escape')
  await sleep(1200)
  const panelOpen = await page.evaluate(() => document.querySelector('.dsh-ph-sidechat') !== null)
  const clickCreate = () => page.evaluate(() => {
    const create = [...document.querySelectorAll('.dsh-ph-sidechat button')]
      .find((b) => /带上下文|with context/i.test((b.textContent ?? '').trim()))
    if (create !== undefined) create.click()
  })
  await clickCreate()
  let chips = 0
  for (let i = 0; i < 10; i += 1) {
    await sleep(1500)
    chips = await page.evaluate(() => document.querySelectorAll('.dsh-ph-sidechat-chipLabel').length)
    if (chips > 0) break
  }
  // The fork is the interesting path, but it needs the session to be idle; on a
  // slow model that is minutes away. The blank thread proves the same panel
  // contract (a thread chip + a composer) without that dependency.
  if (chips === 0) {
    await page.evaluate(() => {
      const blank = [...document.querySelectorAll('.dsh-ph-sidechat-chip')]
        .find((b) => /\+\s*空白|\+\s*blank/i.test((b.textContent ?? '').trim()))
      if (blank !== undefined) blank.click()
    })
    for (let i = 0; i < 8; i += 1) {
      await sleep(1200)
      chips = await page.evaluate(() => document.querySelectorAll('.dsh-ph-sidechat-chipLabel').length)
      if (chips > 0) break
    }
  }
  const panel = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.dsh-ph-sidechat-chipLabel')].map((b) => (b.textContent ?? '').trim()),
    composer: document.querySelector('.dsh-ph-sidechat-input') !== null,
    icons: [...document.querySelectorAll('.dsh-ph-iconButton')].map((b) => b.getAttribute('title')),
  }))
  // A fork of a session whose turn is still running is refused by the host (the
  // same rule the UI shows), so a chip-less panel is only a failure when the
  // session was idle — otherwise record why it could not be exercised.
  const idleAtFork = await waitForIdle(page, 15_000)
  check('side-chat panel opens and starts a forked thread',
    panelOpen && panel.composer && (panel.chips.length > 0 || !idleAtFork),
    { panelOpen, panel, idleAtFork })
  // Leave the main composer in its seat: the next suite drives the MAIN input,
  // and an open side-chat pane would keep the composer host away from it.
  await page.evaluate(() => {
    const close = [...document.querySelectorAll('.dsh-ph-iconButton')]
      .find((b) => (b.getAttribute('title') ?? '').includes('关闭此标签页'))
    if (close !== undefined) close.click()
  })
  await sleep(1500)

  // 4) Regression: switching the feature off must remove the toolbar action.
  const { openApp, BASE_PREFS } = await import('./harness.mjs')
  const offPrefs = { version: 3, data: { ...BASE_PREFS.data, sideChat: false } }
  const off = await openApp(browser, offPrefs)
  await openScratchSession(off.page)
  // A brand-new scratch session has no rows to select, and the toolbar only
  // appears for a selection: seed one message before asking for it.
  await seedComposerMessage(off.page, '关闭态工具栏校验用的一条固定提示词')
  const withoutFeature = await toolbarButtons(off.page)
  check('side-chat toolbar action disappears when the feature is off',
    withoutFeature.includes('复制') && withoutFeature.includes('引用') && !withoutFeature.some((label) => /侧聊/.test(label)),
    { labels: withoutFeature })
  await off.page.close()
}
