#!/usr/bin/env node
/**
 * E2E runner: one scratch server, one browser, every suite, a summary table.
 *
 * Usage: pnpm test:e2e   (see harness.mjs for the environment variables)
 *
 * @module dsh-prompt-history/test/e2e/run
 */
import { launch, openApp, startServer } from './harness.mjs'
import { composerSuite } from './composer.mjs'
import { quoteSuite } from './quote.mjs'
import { predictionBoxSuite } from './predictionBox.mjs'
import { aiCompletionSuite } from './aiCompletion.mjs'
import { enhanceSuite } from './enhance.mjs'
import { enhanceModelSuite } from './enhanceModel.mjs'
import { overlaySuite } from './overlay.mjs'
import { sideChatSuite } from './sidechat.mjs'

/** Collected results. */
const results = []

/** Record one check. */
function check(name, ok, detail) {
  results.push({ name, ok: ok === true, detail })
  const marker = ok === true ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m'
  console.log(`  ${marker}  ${name}`)
  if (ok !== true) console.log(`         ${JSON.stringify(detail).slice(0, 400)}`)
}

/**
 * Run one suite, isolating its failures.
 * @param label - suite name for the log.
 * @param run - the suite body.
 */
async function suite(label, run) {
  console.log(`\n${label}`)
  try {
    await run()
  } catch (error) {
    check(`${label}: suite completed`, false, { error: String(error).slice(0, 300) })
  }
}

const stopServer = await startServer()
let browser
let exitCode = 0
try {
  browser = await launch()
  const { page, errors } = await openApp(browser)
  await suite('overlay', () => overlaySuite(page, check))
  await suite('composer', () => composerSuite(page, check))
  await suite('quote', () => quoteSuite(page, check))
  // Its own page: this suite opens a side-chat pane, which takes the composer seat
  // away from the shared page and breaks the suites that follow it.
  await suite('side chat', async () => {
    const { page: own } = await openApp(browser)
    try { await sideChatSuite(own, check, browser) } finally { await own.close() }
  })
  await suite('prediction box', async () => {
    const { page: own } = await openApp(browser)
    try { await predictionBoxSuite(own, check) } finally { await own.close() }
  })
  await suite('prompt enhancement', () => enhanceSuite(browser, check))
  // The model-continuation path is opt-in: its answer comes from a model, so it
  // cannot be part of a deterministic run. DSH_E2E_AI=1 turns it on.
  if (process.env.DSH_E2E_AI === '1') {
    await suite('ai continuation', () => aiCompletionSuite(browser, check))
    await suite('prompt enhancement (model)', () => enhanceModelSuite(browser, check))
  } else {
    console.log('\nai continuation\n  SKIP  set DSH_E2E_AI=1 to run the model-backed checks')
  }
  check('no console errors during the run', errors.length === 0, { errors: errors.slice(0, 3) })
} catch (error) {
  console.error(`\nharness error: ${String(error).slice(0, 400)}`)
  exitCode = 2
} finally {
  if (browser !== undefined) await browser.close()
  await stopServer()
}

const passed = results.filter((r) => r.ok).length
const failed = results.length - passed
console.log(`\n${passed}/${results.length} checks passed${failed === 0 ? '' : `, ${failed} failed`}`)
if (failed > 0 || exitCode !== 0) exitCode = 1
process.exit(exitCode)
