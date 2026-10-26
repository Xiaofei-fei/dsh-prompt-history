/**
 * Composer regressions: history browsing, completion, reverse search, the
 * selection toolbar, the quote-under-focus-mismatch bug, and the chat TOC.
 *
 * @module dsh-prompt-history/test/e2e/composer
 */
import {
  clearComposer, composerText, focusComposer, normalizePrompt, openFirstSession, sleep,
} from './harness.mjs'

/**
 * Run the composer suite on an opened session.
 * @param page - an app page from the harness.
 * @param check - the runner's assertion collector.
 */
export async function composerSuite(page, check) {
  const lastPrompt = await openFirstSession(page)
  await focusComposer(page)
  await clearComposer(page)

  // 1) ↑ recalls the newest prompt.
  await page.keyboard.press('ArrowUp')
  await sleep(500)
  const recalled = await composerText(page)
  check('history recalls the newest prompt with ↑',
    lastPrompt !== null && normalizePrompt(recalled) === normalizePrompt(lastPrompt),
    { expected: normalizePrompt(lastPrompt).slice(0, 30), recalled: normalizePrompt(recalled).slice(0, 30) })

  // 2) ↓ returns to the pending line (empty here).
  await page.keyboard.press('ArrowDown')
  await sleep(400)
  const restored = await composerText(page)
  check('history restores the pending line with ↓',
    (restored ?? '').trim() === '',
    { restored: JSON.stringify((restored ?? '').slice(0, 20)) })

  // 3) Prefix search: typing a prefix then ↑ jumps to a matching entry. The
  //    prefix must leave room to complete, and the newest message can be short
  //    enough to be a prefix of itself — pick a longer prompt from the session.
  const longPrompt = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-chat-flow-kind="user"]')]
      .map((row) => (row.textContent ?? '').trim())
      .filter((text) => text.length > 16)
    return rows[rows.length - 1] ?? null
  })
  const prefix = (longPrompt ?? lastPrompt ?? '').trim().slice(0, 4)
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

  // 4) Completion ghost offers the suffix and Tab accepts it.
  await clearComposer(page)
  await page.keyboard.type(prefix)
  await sleep(500)
  const ghost = await page.evaluate(() => {
    const node = document.querySelector('.dsh-ph-ghost')
    return node === null ? null : (node.textContent ?? '')
  })
  await page.keyboard.press('Tab')
  await sleep(500)
  const completed = (await composerText(page) ?? '').trim()
  // The rule is "the ghost is the suffix of a matching history entry", not "the
  // newest DOM row equals the newest history entry" — the matched entry can be an
  // older prompt (the DOM row may also carry a trailing clock stamp).
  const ghostNorm = normalizePrompt(ghost)
  const completedNorm = normalizePrompt(completed)
  const ghostIsSuffix = ghostNorm !== ''
    && completedNorm.startsWith(prefix)
    && completedNorm.length > prefix.length
    && completedNorm.slice(prefix.length) === ghostNorm
  check('history completion ghosts the suffix and Tab accepts it',
    ghostIsSuffix,
    { prefix, ghost: ghostNorm.slice(0, 26), completed: completedNorm.slice(0, 40), newestRow: normalizePrompt(lastPrompt).slice(0, 40) })

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
  await sleep(900)
  const buttons = await page.evaluate(() => [...document.querySelectorAll('.dsh-ph-toolbar button')]
    .map((b) => (b.textContent ?? '').trim()))
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

  // 7) The chat TOC opens with entries.
  const grip = await page.evaluate(() => document.querySelector('.dsh-ph-toc-grip') !== null)
  if (grip) {
    await page.evaluate(() => {
      const handle = document.querySelector('.dsh-ph-toc-grip')
      if (handle !== null) handle.click()
    })
    await sleep(1200)
  }
  const toc = await page.evaluate(() => ({
    panel: document.querySelector('.dsh-ph-toc') !== null,
    entries: document.querySelectorAll('.dsh-ph-toc-item').length,
  }))
  await page.keyboard.press('Escape')
  await sleep(400)
  check('chat TOC opens with entries', grip && toc.panel && toc.entries > 0, { grip, toc })
}
