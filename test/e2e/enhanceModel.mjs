/**
 * Prompt enhancement, end to end — opt-in (`DSH_E2E_AI=1`).
 *
 * Needs a working session model: the rewrite goes through the host's own LLM
 * service, and its latency and wording come from the model. The assertions are
 * therefore about the contract, not the text: the panel shows both versions, the
 * draft only changes on "应用", and the undo bar restores the exact original.
 *
 * @module dsh-prompt-history/test/e2e/enhanceModel
 */
import { clearComposer, composerText, openApp, openScratchSession, sleep } from './harness.mjs'

/** A rough draft whose rewrite will be multi-line and structured. */
const DRAFT = '写个函数把用户列表按注册时间排好 顺便处理下重复的'

/** How long a rewrite may take before the check gives up. */
const TIMEOUT_MS = 60_000

/**
 * Collapse whitespace so the composer's paragraph normalization does not matter.
 * @param text - raw text.
 * @returns the normalized text.
 */
function norm(text) {
  return (text ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
}

/**
 * Run the model-backed enhancement suite.
 * @param browser - the launched browser.
 * @param check - the runner's assertion collector.
 */
export async function enhanceModelSuite(browser, check) {
  const { page, errors } = await openApp(browser)
  try {
    await openScratchSession(page)
    await sleep(2000)
    await clearComposer(page)
    await page.evaluate(() => { const el = document.querySelector('[data-composer-input]'); if (el) el.focus() })
    await page.keyboard.type(DRAFT)
    await sleep(600)
    const button = await page.evaluate(() => {
      const b = document.querySelector('.dsh-ph-enh-btn')
      return b === null ? null : { disabled: b.disabled }
    })
    if (button === null || button.disabled === true) {
      check('the enhance rewrite opens a compare panel', false, { button })
      return
    }
    await page.click('.dsh-ph-enh-btn')
    let panel = null
    const started = Date.now()
    while (Date.now() - started < TIMEOUT_MS) {
      await sleep(1000)
      panel = await page.evaluate(() => {
        const p = document.querySelector('.dsh-ph-enh-panel')
        if (p === null) return null
        const pres = [...p.querySelectorAll('pre')].map((n) => (n.textContent ?? ''))
        return { pres, buttons: [...p.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()) }
      })
      if (panel !== null && (panel.pres[1] ?? '').trim().length > 20) break
    }
    const rewriteShown = panel !== null && norm(panel.pres[1]) !== ''
    const draftUntouched = norm(await composerText(page)) === norm(DRAFT)
    check('the enhance rewrite opens a compare panel and leaves the draft alone',
      rewriteShown && draftUntouched,
      { original: norm(panel?.pres[0] ?? '').slice(0, 40), rewrite: norm(panel?.pres[1] ?? '').slice(0, 80), draftUntouched })

    // Apply: the draft becomes the rewrite, the undo bar appears.
    await page.evaluate(() => {
      const p = document.querySelector('.dsh-ph-enh-panel')
      const apply = p && [...p.querySelectorAll('button')].find((b) => /^(应用|Apply)$/.test((b.textContent ?? '').trim()))
      if (apply) apply.click()
    })
    await sleep(1200)
    const applied = norm(await composerText(page))
    const undoBar = await page.evaluate(() => document.querySelector('.dsh-ph-enh-undo') !== null)
    check('applying the rewrite replaces the draft and offers an undo',
      undoBar && applied !== '' && applied !== norm(DRAFT),
      { applied: applied.slice(0, 80), undoBar })

    // Undo: back to exactly what was typed.
    await page.evaluate(() => {
      const bar = document.querySelector('.dsh-ph-enh-undo')
      const undo = bar && [...bar.querySelectorAll('button')].find((b) => /^(撤销|Undo)$/.test((b.textContent ?? '').trim()))
      if (undo) undo.click()
    })
    await sleep(900)
    check('undo restores the original draft exactly',
      norm(await composerText(page)) === norm(DRAFT),
      { afterUndo: norm(await composerText(page)).slice(0, 60) })
    check('prompt enhancement leaves no console errors', errors.length === 0, { errors: errors.slice(0, 3) })
    await clearComposer(page)
  } finally {
    await page.close()
  }
}
