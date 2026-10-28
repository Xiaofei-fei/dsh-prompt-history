/**
 * The `oneLineWithHint` prediction layout.
 *
 * The default (`twoLines`) keeps the trailing hint only while the prediction
 * stays on one line. This layout is for people who would rather keep the hint:
 * the prediction is clamped to one line and the hint gets its own line below it,
 * which is the combination that fits a 48 px composer exactly (issue #15's
 * reporter measured both).
 *
 * @module dsh-prompt-history/test/e2e/hintLayout
 */
import { BASE_PREFS, openApp, openFirstSession, seamHideSuggestion, seamShowSuggestion, sleep } from './harness.mjs'

/** A prediction long enough to wrap at any composer width. */
const LONG_PREDICTION = '这是一段很长的预测文本，用于校验一行截断与块状提示布局是否让两者互不重叠。'.repeat(4)

/**
 * Run the layout suite on its own page (the layout is a load-time preference).
 * @param browser - the launched browser.
 * @param check - the runner's assertion collector.
 */
export async function hintLayoutSuite(browser, check) {
  const prefs = { version: 3, data: { ...BASE_PREFS.data, suggestLayout: 'oneLineWithHint' } }
  const { page, errors } = await openApp(browser, prefs)
  try {
    await openFirstSession(page)
    await page.evaluate(() => { const el = document.querySelector('[data-composer-input]'); if (el) el.focus() })
    await sleep(400)
    await seamShowSuggestion(page, LONG_PREDICTION)
    await sleep(700)
    const measured = await page.evaluate(() => {
      const container = document.querySelector('.dsh-ph-suggest')
      const text = document.querySelector('.dsh-ph-suggest-text')
      const hint = document.querySelector('.dsh-ph-suggest-hint')
      if (container === null || text === null || hint === null) return null
      const box = container.getBoundingClientRect()
      const textBox = text.getBoundingClientRect()
      const hintBox = hint.getBoundingClientRect()
      return {
        line: Number.parseFloat(getComputedStyle(container).lineHeight),
        containerHeight: box.height,
        textHeight: textBox.height,
        textBottom: textBox.bottom,
        hintTop: hintBox.top,
        hintBottom: hintBox.bottom,
        hintDisplay: getComputedStyle(hint).display,
        hintText: (hint.textContent ?? '').trim().slice(0, 12),
      }
    })
    const hintHeight = measured === null ? 0 : measured.hintBottom - measured.hintTop
    check('one-line layout clamps the text and keeps the hint below it',
      measured !== null
        && measured.textHeight <= measured.line + 2
        && measured.hintText !== ''
        && measured.hintDisplay === 'block'
        && measured.hintTop >= measured.textBottom - 1
        && measured.containerHeight >= measured.textHeight + hintHeight - 1,
      measured)
    check('one-line layout leaves no console errors', errors.length === 0, { errors: errors.slice(0, 3) })
    await seamHideSuggestion(page)
  } finally {
    await page.close()
  }
}
