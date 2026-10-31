/**
 * E2E harness for dsh-prompt-history.
 *
 * Runs a real DSH web server on a scratch port, drives it with a headless
 * Chromium, and reports per-check pass/fail. No test framework: the suite is a
 * handful of focused checks, each one a named regression we have shipped a fix
 * for, so a failure points at the behaviour rather than at a stack trace.
 *
 * Environment:
 * - DSH_E2E_CHROME   Chromium/Chrome binary (default /usr/bin/google-chrome)
 * - DSH_E2E_PORT     scratch server port (default 3099)
 * - DSH_E2E_URL      use an already-running server instead of starting one
 * - DSH_E2E_PROFILE  DSH profile name (default web)
 * - DSH_E2E_SECRET   browser-session secret; otherwise read from ~/.dsh/.credentials.yaml
 * - DSH_E2E_HEADFUL  set to 1 to watch the run
 *
 * @module dsh-prompt-history/test/e2e/harness
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

/**
 * Ask the OS for a free port.
 *
 * A fixed port is a trap: a server left over from the previous run still
 * answers the readiness probe, the new child then fails to bind, and the page
 * lands on chrome-error:// with every feature check failing for the wrong
 * reason.
 * @returns a port nothing is listening on right now.
 */
async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

export const PORT = Number(process.env.DSH_E2E_PORT ?? 0) || await freePort()
export const AUTHORITY = `127.0.0.1:${PORT}`
const CHROME = process.env.DSH_E2E_CHROME ?? '/usr/bin/google-chrome'
const BASE = process.env.DSH_E2E_URL ?? `http://${AUTHORITY}/`
const PROFILE = process.env.DSH_E2E_PROFILE ?? 'web'
const DSH_BIN = process.env.DSH_E2E_DSH_BIN ?? 'dsh'
const PREF_KEY = 'dsh-prompt-history.prefs'
const SEAM_KEY = 'dsh-prompt-history.testSeam'

/**
 * Base prefs every suite starts from.
 *
 * The live next-prompt prediction is off on purpose: it needs a model round-trip,
 * so its timing is not reproducible, and when it returns nothing the plugin
 * legitimately clears the overlay — which would erase the seam's overlay in the
 * middle of a geometry check. The overlay mechanics are exercised through the
 * seam instead, which is the same paint path with a deterministic trigger.
 */
export const BASE_PREFS = {
  version: 3,
  data: {
    copyMode: 'toolbar',
    rightClickPaste: true,
    globalHistory: false,
    tocVisible: true,
    promptCompletion: true,
    contextSuggest: false,
    sideChat: true,
    writeGuard: true,
  },
}

/**
 * The browser-session secret the cookie must be signed with.
 *
 * DSH keeps it in the credential store; reading it there keeps the suite
 * self-contained without a secret in the repo.
 * @returns the base64 secret.
 */
export function sessionSecret() {
  const fromEnv = process.env.DSH_E2E_SECRET
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  const file = path.join(homedir(), '.dsh', '.credentials.yaml')
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === 'client-connection/browser-session:')
  if (start < 0) throw new Error(`client-connection/browser-session missing in ${file}`)
  for (let i = start; i < lines.length; i += 1) {
    const match = /^\s+secret:\s*(\S+)\s*$/.exec(lines[i] ?? '')
    if (match !== null) return match[1]
    if (i > start && /^\s{2}\S/.test(lines[i] ?? '')) break
  }
  throw new Error(`browser-session secret missing in ${file}`)
}

/** Build the auth cookie value DSH expects for this authority. */
export function authCookie() {
  const b64url = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const name = `dsh-auth-${b64url(crypto.createHash('sha256').update(AUTHORITY).digest())}`
  const issuedAt = Date.now()
  const expiresAt = issuedAt + 24 * 60 * 60 * 1000
  const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt, expiresAt }), 'utf8'))
  const signature = b64url(crypto.createHmac('sha256', Buffer.from(sessionSecret(), 'base64')).update(body).digest())
  return { name, value: `v1.${body}.${signature}` }
}

/** Resolve the chrome binary or fail with a skip-worthy message. */
export function resolveChrome() {
  try {
    readFileSync(CHROME)
    return CHROME
  } catch {
    throw new Error(`chrome not found at ${CHROME} (set DSH_E2E_CHROME)`)
  }
}

/**
 * Start the scratch server unless the caller points the suite at one.
 * @returns a function that stops what this harness started.
 */
export async function startServer() {
  if (process.env.DSH_E2E_URL !== undefined) return async () => {}
  const args = ['--profile', PROFILE, '--no-open', '--port', String(PORT)]
  // Windows cannot exec a .cmd shim directly: spawn() would be EINVAL. The
  // launcher DSH ships is a .cmd, so go through the command processor.
  const isBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(DSH_BIN)
  const child = isBatch
    ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${DSH_BIN}" ${args.join(' ')}`], {
        detached: false,
        stdio: 'ignore',
        env: process.env,
        windowsVerbatimArguments: true,
      })
    : spawn(DSH_BIN, args, {
        detached: false,
        stdio: 'ignore',
        env: process.env,
      })
  const stop = async () => {
    if (process.platform === 'win32' && child.exitCode === null && child.pid !== undefined) {
      // SIGTERM is a no-op on Windows; /T also reaps the Electron grandchild
      // the .cmd launcher started, which would otherwise keep the port.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      const deadline = Date.now() + 5_000
      while (child.exitCode === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    if (child.exitCode === null) child.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 400))
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  process.on('exit', () => { try { child.kill('SIGKILL') } catch { /* gone */ } })
  // Readiness means the auth fence is mounted, not merely "something answers":
  // during startup the listener can reply 404 before the app routes exist, and a
  // stray responder on a random port would also pass a status-agnostic probe.
  const READY = new Set([401, 200, 302])
  let lastStatus = 0
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before answering on ${BASE} (code ${child.exitCode})`)
    }
    try {
      const response = await fetch(BASE, { redirect: 'manual' })
      lastStatus = response.status
      if (READY.has(response.status)) return stop
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  await stop()
  throw new Error(`server never became ready on ${BASE} (last status ${lastStatus})`)
}

/**
 * Open the app as an authenticated page with the given prefs.
 * @param browser - the launched browser.
 * @param prefs - the prefs payload to seed (defaults to {@link BASE_PREFS}).
 */
export async function openApp(browser, prefs = BASE_PREFS) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${String(error).slice(0, 160)}`))
  // Host-transport noise (the gateway hiccuping while a second server shares the
  // same profile) is not a plugin error; only the app's own failures count.
  const HOST_NOISE = /404|Failed to load resource|Failed to fetch|gateway\/internal|dynamicCordisRunner|cordis-client-runner|client api:/
  page.on('console', (message) => {
    if (message.type() === 'error' && !HOST_NOISE.test(message.text())) {
      errors.push(message.text().slice(0, 160))
    }
  })
  const cookie = authCookie()
  const client = await page.target().createCDPSession()
  await client.send('Network.setCookie', {
    name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true,
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 40_000 })
  // A navigation that landed on chrome-error:// has no localStorage and no app;
  // wait for the composer so such a run reports a harness error instead of a
  // dozen feature failures.
  try {
    await page.waitForSelector('[data-composer-input]', { timeout: 40_000 })
  } catch {
    throw new Error(`app did not mount (url=${page.url()}); is the server serving the web profile?`)
  }
  await sleep(2500)
  await page.evaluate(([key, seam, payload]) => {
    localStorage.setItem(key, JSON.stringify(payload))
    localStorage.setItem(seam, '1')
  }, [PREF_KEY, SEAM_KEY, prefs])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(8000)
  await dismissDialog(page)
  return { page, errors }
}

/** Close the first-run dialog if it is up. */
export async function dismissDialog(page) {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => /知道了|继续|Got it/.test((b.textContent ?? '').trim()))
    if (button !== undefined) button.click()
  })
  await sleep(500)
}

/**
 * Open the first real session so the composer has history to work with.
 * @param page - the app page.
 * @returns a sample of the first user row's text, or null.
 */
export async function openFirstSession(page) {
  await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="打开侧边栏"]')
    if (button !== null) button.click()
  })
  await sleep(2000)
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[class*="sessionRow"]')]
    const row = rows.find((candidate) => {
      const text = (candidate.textContent ?? '').trim()
      return text.length > 3 && !/新会话|展开其余/.test(text)
    })
    if (row !== undefined) row.click()
  })
  for (let i = 0; i < 14; i += 1) {
    await sleep(1200)
    const count = await page.evaluate(() => document.querySelectorAll('[data-chat-flow-kind="user"]').length)
    if (count > 0) break
  }
  await page.keyboard.press('Escape')
  await sleep(600)
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-chat-flow-kind="user"]')]
    const last = rows[rows.length - 1]
    return last === undefined ? null : (last.textContent ?? '').trim()
  })
}

/** Clear the composer (select all inside it, then Backspace). */
export async function clearComposer(page) {
  await page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    if (editor === null) return
    editor.focus()
    const selection = document.getSelection()
    const range = document.createRange()
    range.selectNodeContents(editor)
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  await page.keyboard.press('Backspace')
  await sleep(250)
}

/** The composer draft text. */
export function composerText(page) {
  return page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    return editor === null ? null : (editor.innerText ?? editor.textContent ?? '')
  })
}

/** Focus the composer. */
export async function focusComposer(page) {
  await page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    if (editor !== null) editor.focus()
  })
  await sleep(300)
}

/** Show a prediction through the test seam (no model call). */
export async function seamShowSuggestion(page, text = '这是一个用于校验几何位置的预测句子') {
  return page.evaluate((value) => {
    const editor = document.querySelector('[data-composer-input]')
    const seam = window.__dshPhTest
    if (editor === null || seam === undefined) return false
    return seam.showSuggestion(value, '按 Tab 键接受', editor)
  }, text)
}

/** Hide whatever overlay the seam last drew. */
export function seamHideSuggestion(page) {
  return page.evaluate(() => window.__dshPhTest?.hideSuggestion())
}

/** Show the history-completion ghost through the seam. */
export function seamShowGhost(page, text = '补全后缀') {
  return page.evaluate((value) => {
    const editor = document.querySelector('[data-composer-input]')
    const seam = window.__dshPhTest
    if (editor === null || seam === undefined) return false
    return seam.showGhost(value, editor)
  }, text)
}

/** Geometry of the suggestion overlay against the composer's content box. */
export function overlayGeometry(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('.dsh-ph-suggest')
    const host = document.querySelector('[data-composer-input]')
    if (overlay === null || host === null) return { present: false }
    const box = overlay.getBoundingClientRect()
    const hostBox = host.getBoundingClientRect()
    const style = getComputedStyle(host)
    const padLeft = Number.parseFloat(style.paddingLeft) || 0
    const padRight = Number.parseFloat(style.paddingRight) || 0
    return {
      present: true,
      left: box.left,
      width: box.width,
      contentLeft: hostBox.left + padLeft,
      contentWidth: hostBox.width - padLeft - padRight,
      zIndex: getComputedStyle(overlay).zIndex,
      visibility: getComputedStyle(overlay).visibility,
      text: (overlay.textContent ?? '').slice(0, 24),
    }
  })
}

/**
 * Normalize a prompt for comparison: the conversation row carries a trailing
 * clock stamp that the composer history never contains.
 * @param text - raw row or draft text.
 * @returns the comparable form.
 */
export function normalizePrompt(text) {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\d{1,2}:\d{2}\s*$/, '')
    .trim()
}

/** Whether the composer host element is still the one the test measured. */
export function hostIdentity(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-composer-input]')
    if (host === null) return null
    const remembered = window.__e2eHost
    window.__e2eHost = host
    return { same: remembered === undefined ? null : remembered === host, connected: host.isConnected }
  })
}

/** Sleep helper. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Select the text of one conversation message.
 *
 * The plugin reads the selection on `selectionchange`, so the range has to be
 * installed and the event dispatched exactly like a real drag-select.
 * @param page - the app page.
 * @param options - `fromEnd` picks the newest message, otherwise the first.
 * @returns the selected string, or null when no message row exists.
 */
export async function selectUserRowText(page, options = {}) {
  const { fromEnd = false } = options
  const selected = await page.evaluate((pickLast) => {
    const rows = [...document.querySelectorAll('[data-chat-flow-kind="user"]')]
    const ordered = pickLast ? [...rows].reverse() : rows
    // A sent message that itself starts with a quote would nest the note; prefer
    // a plain message when there is one.
    const row = ordered.find((candidate) => !(candidate.textContent ?? '').trim().startsWith('> '))
      ?? ordered[0]
    if (row === undefined) return null
    const slot = row.querySelector('[data-slot="conversation.user.text.node"]')
    const host = slot ?? row
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    const text = walker.nextNode()
    const range = document.createRange()
    range.selectNodeContents(text ?? host)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return (selection?.toString() ?? '').trim()
  }, fromEnd)
  await sleep(700)
  return selected
}

/**
 * Click the toolbar's quote action for the current selection.
 * @param page - the app page.
 * @returns the toolbar labels and whether the quote button was found.
 */
export async function clickQuoteAction(page) {
  const buttons = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.dsh-ph-toolbar button')]
    const labels = all.map((button) => (button.textContent ?? '').trim())
    const quote = all.find((button) => /引用|Quote/.test((button.textContent ?? '')))
    if (quote !== undefined) quote.click()
    return { labels, clicked: quote !== undefined }
  })
  await sleep(1000)
  return buttons
}

/**
 * Quote the selected message text the way a user does: select, then press the
 * toolbar's quote action.
 * @param page - the app page.
 * @param options - forwarded to {@link selectUserRowText}.
 * @returns the selected text and the toolbar labels.
 */
export async function quoteFromUserRow(page, options = {}) {
  const selected = await selectUserRowText(page, options)
  if (selected === null) return { selected: null, labels: [], clicked: false }
  const { labels, clicked } = await clickQuoteAction(page)
  return { selected, labels, clicked }
}

/** Read the composer-adjacent quote UI state. */
export function quoteState(page) {
  return page.evaluate(() => {
    const host = document.querySelector('.dsh-ph-quote-host')
    const card = document.querySelector('.dsh-ph-quote-card')
    const pill = document.querySelector('.dsh-ph-quote-count')
    const draft = document.querySelector('[data-composer-input]')
    return {
      mount: document.querySelector('.dsh-ph-quote-mount') !== null,
      hostOpen: host === null ? null : host.getAttribute('data-open'),
      hostShow: host === null ? null : host.getAttribute('data-show'),
      pill: pill === null ? null : (pill.textContent ?? '').trim(),
      pillDisplay: pill === null ? null : getComputedStyle(pill).display,
      cardDisplay: card === null ? null : getComputedStyle(card).display,
      rows: [...document.querySelectorAll('.dsh-ph-quote-row')].map((row) => (row.textContent ?? '').trim()),
      draft: draft === null ? null : (draft.innerText ?? draft.textContent ?? ''),
    }
  })
}

/** Drop every pending quote through the pill's clear button. */
export async function clearQuotes(page) {
  const clicked = await page.evaluate(() => {
    const clear = document.querySelector('.dsh-ph-quote-x')
    if (clear === null) return false
    clear.click()
    return true
  })
  await sleep(350)
  return clicked
}

/**
 * Type a prompt into the composer and submit it.
 *
 * A real pointer click is required: focusing the editor from script does not
 * give the page the keyboard focus, so `keyboard.type` would land nowhere.
 * @param page - the app page.
 * @param text - the prompt to type.
 */
export async function sendFromComposer(page, text) {
  await page.click('[data-composer-input]')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

/** Count the user bubbles in the conversation. */
export function userMessageCount(page) {
  return page.evaluate(() => document.querySelectorAll('[data-chat-flow-kind="user"]').length)
}

/**
 * Wait for one more user bubble, then return the new count.
 *
 * Sending is asynchronous (the row is committed after the send gesture), so a
 * fixed sleep would race the transcript.
 * @param page - the app page.
 * @param previous - the count observed before sending.
 * @param tries - seconds to wait at most.
 */
export async function waitForUserMessageCount(page, previous, tries = 12) {
  let count = previous
  for (let i = 0; i < tries; i += 1) {
    await sleep(1000)
    count = await userMessageCount(page)
    if (count > previous) break
  }
  return count
}

/** Read the newest user bubble together with its note pill, if the host renders one. */
export function lastUserNoteRow(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-chat-flow-kind="user"]')]
    const last = rows[rows.length - 1]
    if (last === undefined) return null
    const pill = last.querySelector('.dsh-ph-quote-notes')
    return {
      text: last.innerText ?? last.textContent ?? '',
      pill: pill === null ? null : { label: (pill.textContent ?? '').trim(), title: pill.getAttribute('title') ?? '' },
    }
  })
}

/**
 * Report whether a user bubble carries the quoted line: either through the
 * note pill (a host with the conversation slot) or as raw '> ' blockquote text
 * (older hosts). Returns the branch so a failing check shows which rendering
 * was expected.
 * @param row - a {@link lastUserNoteRow} result.
 * @param firstLine - the first line of the quoted selection.
 */
export function quoteCarriedByRow(row, firstLine) {
  if (row === null) return { carried: false, rendering: 'no user row' }
  if (row.pill !== null) {
    return {
      carried: /1\s*条注释|1\s*note/i.test(row.pill.label) && row.pill.title.includes(firstLine),
      rendering: 'note pill',
    }
  }
  const sent = normalizePrompt(row.text)
  return { carried: sent.startsWith('> ') && sent.includes(firstLine), rendering: 'plain blockquote' }
}

/**
 * Click the composer's primary send control instead of pressing Enter.
 *
 * The button only leaks through as a hashed class token ending in `_primary`,
 * so candidates are matched on that suffix and ranked by the localized
 * aria-label; a single usable candidate is accepted as the send button.
 * @param page - the app page.
 * @returns which button was clicked plus the candidates seen.
 */
export async function clickPrimarySend(page) {
  const handles = await page.$$('button, [role="button"]')
  const ranked = []
  for (const handle of handles) {
    // The composer toolbar re-renders between typing and sending, so a handle
    // from the first query can already be detached; skip it instead of failing.
    let info = null
    try {
      info = await handle.evaluate((el) => {
        const primary = [...el.classList].some((token) => token.endsWith('_primary'))
        if (!primary) return null
        const label = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 24)
        const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'
        return { label, disabled }
      })
    } catch {
      info = null
    }
    if (info !== null) ranked.push({ handle, ...info })
  }
  const usable = ranked.filter((entry) => !entry.disabled)
  const chosen = usable.find((entry) => /发送|send/i.test(entry.label)) ?? (usable.length === 1 ? usable[0] : null)
  const candidates = ranked.map(({ label, disabled }) => ({ label, disabled }))
  if (chosen === null) return { clicked: false, candidates }
  await chosen.handle.click()
  return { clicked: true, label: chosen.label, candidates }
}

/**
 * Make sure the opened session has at least one message.
 *
 * A brand-new scratch profile starts with an empty session, and most composer
 * checks need history (the recall checks need a newest prompt). Sending a
 * prompt works without a model: the row lands locally and only the assistant
 * turn afterwards reports a missing credential.
 * @param page - the app page.
 * @param text - the prompt to seed with.
 * @returns the text that is now the newest message.
 */
export async function ensureSessionMessage(page, text = 'e2e seed prompt 00001') {
  if (await userMessageCount(page) > 0) return null
  await sendFromComposer(page, text)
  for (let i = 0; i < 12; i += 1) {
    await sleep(1000)
    if (await userMessageCount(page) > 0) break
  }
  await sleep(500)
  return text
}

/**
 * Launch the browser.
 * @returns the browser instance.
 */
export async function launch() {
  const executablePath = resolveChrome()
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1700,1000']
  // Edge 156+ relaunches itself through its "compat layer" when it notices an
  // automation driver: the process puppeteer spawned exits with code 0 before
  // DevTools answers, and the real browser runs detached under a pid puppeteer
  // does not own. This flag keeps the browser in the spawned process.
  if (/msedge/i.test(executablePath)) args.push('--edge-skip-compat-layer-relaunch')
  return puppeteer.launch({
    executablePath,
    headless: process.env.DSH_E2E_HEADFUL === '1' ? false : 'new',
    args,
  })
}
