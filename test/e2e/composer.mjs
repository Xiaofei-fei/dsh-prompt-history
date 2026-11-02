/**
 * Composer regressions: history browsing, completion, reverse search, the
 * selection toolbar, and the quote-under-focus-mismatch bug.
 *
 * @module dsh-prompt-history/test/e2e/composer
 */
import {
  clearComposer, composerText, focusComposer, normalizePrompt, openScratchSession, sleep,
} from './harness.mjs'

/**
 * Run the composer suite on an opened session.
 * @param page - an app page from the harness.
 * @param check - the runner's assertion collector.
 */
export async function composerSuite(page, check) {
  await openScratchSession(page)
  await focusComposer(page)
  await clearComposer(page)

  // A seed prompt of our own: the scratch session starts empty, and deriving the
  // expected text from whatever the session happens to contain made these checks
  // depend on the user's own conversation (and fail on an empty session).
  const SEED = '历史召回校验用的一条固定提示词'
  await page.keyboard.type(SEED)
  await page.keyboard.press('Enter')
  const seededBy = Date.now() + 40_000
  while (Date.now() < seededBy) {
    await sleep(600)
    const landed = await page.evaluate((text) => [...document.querySelectorAll('[data-chat-flow-kind="user"]')]
      .some((row) => (row.textContent ?? '').includes(text)), SEED)
    if (landed) break
  }
  await sleep(1200)
  await clearComposer(page)

  // 1) ↑ recalls the newest prompt.
  await page.keyboard.press('ArrowUp')
  await sleep(500)
  const recalled = await composerText(page)
  check('history recalls the newest prompt with ↑',
    normalizePrompt(recalled) === normalizePrompt(SEED),
    { expected: SEED, recalled: normalizePrompt(recalled).slice(0, 40) })

  // 2) ↓ returns to the pending line (empty here).
  await page.keyboard.press('ArrowDown')
  await sleep(400)
  const restored = await composerText(page)
  check('history restores the pending line with ↓',
    (restored ?? '').trim() === '',
    { restored: JSON.stringify((restored ?? '').slice(0, 20)) })

  // 3) Completion ghost offers the suffix and Tab accepts it. The draft is the
  //    prefix of SEED, which step 1 just recalled from the history ring — no second
  //    send and no reliance on the ring catching up, so this cannot race.
  const prefix = SEED.slice(0, 6)
  await clearComposer(page)
  await page.keyboard.type(prefix)
  let ghost = null
  for (let i = 0; i < 16; i += 1) {
    await sleep(400)
    ghost = await page.evaluate(() => {
      const node = document.querySelector('.dsh-ph-ghost')
      return node === null ? null : (node.textContent ?? '')
    })
    if (ghost !== null && ghost !== '') break
  }
  await page.keyboard.press('Tab')
  await sleep(500)
  const completed = (await composerText(page) ?? '').trim()
  const ghostNorm = normalizePrompt(ghost)
  const completedNorm = normalizePrompt(completed)
  const ghostIsSuffix = ghostNorm !== ''
    && completedNorm.startsWith(prefix)
    && completedNorm.length > prefix.length
    && completedNorm.slice(prefix.length) === ghostNorm
  check('history completion ghosts the suffix and Tab accepts it',
    ghostIsSuffix,
    { prefix, expectedSuffix: SEED.slice(prefix.length), ghost: ghostNorm.slice(0, 26), completed: completedNorm.slice(0, 40), seeded: SEED })

  // 4) Prefix search: typing a prefix then ↑ jumps to a matching entry.
  await clearComposer(page)
  await page.keyboard.type(prefix)
  await sleep(300)
  await page.keyboard.press('ArrowUp')
  await sleep(500)
  const searched = (await composerText(page) ?? '').trim()
  // Prefix search guarantees "an entry starting with the prefix"; when the only
  // match is the typed line itself, the draft simply stays put.
  check('history prefix search jumps to a matching prompt',
    prefix.length >= 2 && searched.startsWith(prefix),
    { prefix, searched: searched.slice(0, 30) })

  // 5) Ctrl+R opens the reverse search.
  await clearComposer(page)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyR')
  await page.keyboard.up('Control')
  await sleep(700)
  const searchOpen = await page.evaluate(() => document.querySelector('.dsh-ph-search') !== null)
  if (searchOpen) {
    await page.keyboard.type(prefix.slice(0, 3))
    await sleep(700)
  }
  const searchHit = await page.evaluate(() => {
    const matches = document.querySelector('.dsh-ph-search-m')
    return matches === null ? null : (matches.textContent ?? '').trim().slice(0, 40)
  })
  await page.keyboard.press('Escape')
  await sleep(400)
  check('Ctrl+R opens the reverse search with matches',
    searchOpen && (searchHit ?? '') !== '',
    { searchOpen, searchHit })

  // 6) Regression: 引用 must read the selection the user made even while the
  //    composer still holds focus (it does right after sending a message).
  await clearComposer(page)
  await page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    if (editor !== null) editor.focus()
    const row = document.querySelector('[data-chat-flow-kind="user"]')
    if (row === null) return
    const range = document.createRange()
    range.selectNodeContents(row)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  // The toolbar appears on the next frame after the selection settles; a streaming
  // assistant turn can re-render the transcript in between, so poll and re-dispatch.
  let buttons = []
  for (let i = 0; i < 10; i += 1) {
    await sleep(300)
    buttons = await page.evaluate(() => {
      document.dispatchEvent(new Event('selectionchange'))
      return [...document.querySelectorAll('.dsh-ph-toolbar button')].map((b) => (b.textContent ?? '').trim())
    })
    if (buttons.length > 0) break
  }
  await page.evaluate(() => {
    const quote = [...document.querySelectorAll('.dsh-ph-toolbar button')]
      .find((b) => /引用|Quote/.test(b.textContent ?? ''))
    if (quote !== undefined) quote.click()
  })
  await sleep(1000)
  const quoted = (await composerText(page) ?? '').trim()
  check('quote inserts the conversation selection while the composer holds focus',
    quoted.startsWith('> '),
    { buttons, quoted: quoted.slice(0, 30) })
  await clearComposer(page)

}
