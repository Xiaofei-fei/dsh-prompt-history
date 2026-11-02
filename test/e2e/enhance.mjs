/**
 * Prompt enhancement: the parts that do not need a model.
 *
 * The rewrite itself is model-backed and covered by `enhanceModel.mjs` (opt-in).
 * Here we only assert the affordance contract: the button appears in the composer
 * action row, stays disabled while there is nothing to rewrite, and disappears
 * completely when the feature is switched off in Settings.
 *
 * @module dsh-prompt-history/test/e2e/enhance
 */
import { BASE_PREFS, clearComposer, composerText, openApp, openScratchSession, sleep } from './harness.mjs'

/**
 * Run the enhancement affordance suite.
 * @param browser - the launched browser.
 * @param check - the runner's assertion collector.
 */
export async function enhanceSuite(browser, check) {
  // A) Default: the button is there, disabled while the composer is empty.
  {
    const { page, errors } = await openApp(browser)
    try {
      await openScratchSession(page)
      await sleep(1500)
      await clearComposer(page)
      await sleep(400)
      const idle = await page.evaluate(() => {
        const button = document.querySelector('.dsh-ph-enh-btn')
        return button === null ? null : { disabled: button.disabled, title: button.getAttribute('title') }
      })
      await page.evaluate(() => { const el = document.querySelector('[data-composer-input]'); if (el) el.focus() })
      await page.keyboard.type('增强按钮可用性校验')
      await sleep(600)
      const typed = await page.evaluate(() => {
        const button = document.querySelector('.dsh-ph-enh-btn')
        return button === null ? null : { disabled: button.disabled }
      })
      check('the enhance button is present and stays disabled on an empty draft',
        idle !== null && idle.disabled === true && typed !== null && typed.disabled === false,
        { idle, typed })
      check('the enhance affordance leaves no console errors', errors.length === 0, { errors: errors.slice(0, 3) })
      await clearComposer(page)
    } finally {
      await page.close()
    }
  }

  // B) Switched off in Settings: nothing is rendered at all.
  {
    const prefs = { version: 3, data: { ...BASE_PREFS.data, promptEnhance: false } }
    const { page, errors } = await openApp(browser, prefs)
    try {
      await openScratchSession(page)
      await sleep(1500)
      await page.evaluate(() => { const el = document.querySelector('[data-composer-input]'); if (el) el.focus() })
      await page.keyboard.type('关闭后不应出现按钮')
      await sleep(600)
      const hidden = await page.evaluate(() => ({
        button: document.querySelector('.dsh-ph-enh-btn') !== null,
        panel: document.querySelector('.dsh-ph-enh-panel') !== null,
      }))
      check('switching prompt enhancement off removes the button entirely',
        hidden.button === false && hidden.panel === false && (await composerText(page) ?? '').trim() === '关闭后不应出现按钮',
        { hidden, errors: errors.slice(0, 3) })
      await clearComposer(page)
    } finally {
      await page.close()
    }
  }
}
