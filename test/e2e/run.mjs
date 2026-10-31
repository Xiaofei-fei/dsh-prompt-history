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
import { hintLayoutSuite } from './hintLayout.mjs'
import { overlaySuite } from './overlay.mjs'
import { quoteSuite } from './quote.mjs'
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
  await suite('side chat', () => sideChatSuite(page, check, browser))
  await suite('hint layout', () => hintLayoutSuite(browser, check))
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
