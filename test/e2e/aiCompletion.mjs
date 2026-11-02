/**
 * The model-continuation path of the completion ghost.
 *
 * This is the one suite that needs a working session model, so it is opt-in
 * (`DSH_E2E_AI=1`) and never runs as part of the deterministic suite: the answer's
 * latency and content come from the model, and a check that waits on them cannot
 * be reproducible by construction.
 *
 * @module dsh-prompt-history/test/e2e/aiCompletion
 */
import {
  BASE_PREFS, composerText, openApp, openFirstSession, sleep,
} from './harness.mjs'

/** How long a model answer may take before the check gives up. */
const ANSWER_TIMEOUT_MS = 30_000

/** A half-written prompt no history entry can match. */
const DRAFT = '请帮我检查一下这个插件的'

/**
 * Run the AI continuation suite on its own page with the feature enabled.
 * @param browser - the launched browser.
 * @param check - the runner's assertion collector.
 */
export async function aiCompletionSuite(browser, check) {
  const prefs = { version: 3, data: { ...BASE_PREFS.data, aiCompletion: true, contextSuggest: false } }
  const { page, errors } = await openApp(browser, prefs)
  try {
    await openFirstSession(page)
    await page.evaluate(() => { const el = document.querySelector('[data-composer-input]'); if (el) el.focus() })
    await sleep(400)
    await page.keyboard.type(DRAFT)
    let ghost = null
    const started = Date.now()
    while (Date.now() - started < ANSWER_TIMEOUT_MS) {
      await sleep(1000)
      ghost = await page.evaluate(() => {
        const node = document.querySelector('.dsh-ph-ghost')
        return node === null ? null : (node.textContent ?? '')
      })
      if (ghost !== null && ghost !== '') break
    }
    const beforeTab = await composerText(page)
    if (ghost !== null && ghost !== '') {
      await page.keyboard.press('Tab')
      await sleep(600)
    }
    const afterTab = await composerText(page)
    check('AI continuation ghosts the rest of a half-written prompt',
      ghost !== null && ghost !== ''
        && (beforeTab ?? '').trim() === DRAFT
        && (afterTab ?? '').trim() === `${DRAFT}${ghost}`.trim(),
      { ghost: (ghost ?? '').slice(0, 60), beforeTab, afterTab, waitedMs: Date.now() - started })
    check('AI continuation leaves no console errors', errors.length === 0, { errors: errors.slice(0, 3) })
  } finally {
    await page.close()
  }
}
