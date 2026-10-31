/**
 * Quote regressions: selecting a conversation message and pressing 引用 must
 * keep the composer draft pristine, show a note card next to the composer, and
 * fold the quoted lines into exactly one outgoing message on submit.
 *
 * The draft must never carry the '> ' blockquote: the selection is stored as a
 * note next to the composer and folded into the draft by a capture-phase
 * listener on the send gesture, so a draft that starts with '> ' means an
 * insertion path writes into the composer and the user has to delete it.
 *
 * @module dsh-prompt-history/test/e2e/quote
 */
import {
  clearComposer, clearQuotes, clickPrimarySend, composerText, ensureSessionMessage,
  lastUserNoteRow, normalizePrompt, openFirstSession, quoteCarriedByRow,
  quoteFromUserRow, quoteState, sendFromComposer, sleep, userMessageCount,
  waitForUserMessageCount,
} from './harness.mjs'

/** Prompt typed after quoting; distinctive so the merged message is checkable. */
const PROMPT = 'quote regression prompt 24680'

/** Prompt sent with no pending notes; proves the submit path still works bare. */
const PLAIN_PROMPT = 'plain send prompt 13579'

/** Prompt sent through the composer's send button, with a note queued. */
const BUTTON_PROMPT = 'quote button prompt 31415'

/** Plain prompt sent while a note is queued; it must not be swallowed. */
const QUEUED_PROMPT = 'queued note plain prompt 27182'

/** The note card's pill, in either locale the toolbar can render. */
const PILL = /1\s*条注|1\s*note/i

/**
 * Run the quote suite on an opened session.
 * @param page - an app page from the harness.
 * @param check - the runner's assertion collector.
 */
export async function quoteSuite(page, check) {
  if (await userMessageCount(page) === 0) {
    await openFirstSession(page)
    await ensureSessionMessage(page)
  }
  await clearQuotes(page)
  await clearComposer(page)

  // 0) A plain send with no pending notes must still submit: the quote plumbing
  //    has to stay completely out of the way when the note store is empty.
  const plainBefore = await userMessageCount(page)
  await sendFromComposer(page, PLAIN_PROMPT)
  let plainAfter = plainBefore
  for (let i = 0; i < 12; i += 1) {
    await sleep(1000)
    plainAfter = await userMessageCount(page)
    if (plainAfter > plainBefore) break
  }
  const plainText = normalizePrompt(await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-chat-flow-kind="user"]')]
    const last = rows[rows.length - 1]
    return last === undefined ? '' : (last.innerText ?? last.textContent ?? '')
  }))
  const plainDraft = (await composerText(page) ?? '').trim()
  check('quote: a plain send with no notes still sends exactly one message',
    plainAfter === plainBefore + 1 && plainText === PLAIN_PROMPT && plainDraft === '',
    { before: plainBefore, after: plainAfter, sent: plainText.slice(0, 60), draft: JSON.stringify(plainDraft.slice(0, 20)) })

  await clearQuotes(page)
  await clearComposer(page)
  const before = await userMessageCount(page)

  // 1) Select text inside a conversation message and press 引用.
  const quote = await quoteFromUserRow(page, { fromEnd: true })
  const selected = quote.selected ?? ''
  const firstLine = selected.split('\n')[0] ?? ''
  check('quote: the toolbar quotes a selection taken from a conversation message',
    quote.clicked && selected !== '',
    { labels: quote.labels, selected: selected.slice(0, 40) })

  // 2) The draft stays empty: no '> ' blockquote is written into it, and the
  //    note card appears with the selection in it.
  const afterQuote = await quoteState(page)
  const draft = afterQuote.draft ?? ''
  check('quote: the composer draft stays empty after quoting',
    draft.trim() === '' && !/^> /m.test(draft),
    { draft: JSON.stringify(draft.slice(0, 40)) })
  check('quote: the note card appears with the quoted selection',
    afterQuote.mount && afterQuote.hostOpen === '1' && PILL.test(afterQuote.pill ?? '')
      && afterQuote.pillDisplay !== 'none' && afterQuote.rows.length === 1
      && (afterQuote.rows[0] ?? '').includes(firstLine),
    { ...afterQuote, expected: firstLine.slice(0, 40) })

  // The rest of the flow needs the note UI. A host that renders quotes
  // differently still fails these checks, but one missing selector must not
  // abort the checks after it: the send path runs on whatever draft is left.
  const pending = new Set([
    'quote: the note card expands on hover',
    'quote: sending adds exactly one user message',
    'quote: the sent message carries both the quoted lines and the prompt',
    'quote: the composer draft is empty after sending',
    'quote: the note store is cleared after sending',
  ])
  const report = (name, ok, detail) => {
    pending.delete(name)
    check(name, ok, detail)
  }

  // 3) The card expands on hover, which is how the user reviews or deletes it.
  try {
    await page.hover('.dsh-ph-quote-count')
    await sleep(600)
    const hovered = await quoteState(page)
    await page.mouse.move(2, 2)
    await sleep(400)
    report('quote: the note card expands on hover',
      hovered.hostShow === '1' && hovered.cardDisplay === 'block',
      { hostShow: hovered.hostShow, cardDisplay: hovered.cardDisplay })
  } catch (error) {
    report('quote: the note card expands on hover', false, { error: String(error).slice(0, 200) })
  }

  // 4) Type a prompt and send: the quotes and the prompt must leave together,
  //    as exactly one user message. On a host without the note UI this still
  //    runs, so the failure record shows what the draft did instead.
  try {
    await sendFromComposer(page, PROMPT)
    let after = before
    for (let i = 0; i < 12; i += 1) {
      await sleep(1000)
      after = await userMessageCount(page)
      if (after > before) break
    }
    const lastRow = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-chat-flow-kind="user"]')]
      const last = rows[rows.length - 1]
      if (last === undefined) return null
      const pill = last.querySelector('.dsh-ph-quote-notes')
      return {
        text: last.innerText ?? last.textContent ?? '',
        pill: pill === null ? null : { label: (pill.textContent ?? '').trim(), title: pill.getAttribute('title') ?? '' },
      }
    })
    const sent = normalizePrompt(lastRow?.text ?? '')
    // Two transcript renderings exist: a host with uiConversation replaces the
    // leading '> ' run with the note pill, an older host keeps the blockquote
    // text. Either way the quoted line has to survive in the bubble.
    const pillBranch = lastRow?.pill !== null && lastRow?.pill !== undefined
    const quotedCarried = pillBranch
      ? /1\s*条注释|1\s*note/i.test(lastRow.pill.label) && lastRow.pill.title.includes(firstLine)
      : sent.startsWith('> ') && sent.includes(firstLine)
    // Keep the rendering branch visible on a passing run: it tells a host
    // upgrade apart from a test that silently took the other branch.
    console.log('         note: transcript rendering is ' + (pillBranch
      ? 'the .dsh-ph-quote-notes pill (' + JSON.stringify(lastRow.pill.label) + ')'
      : 'raw "> " blockquote text (' + JSON.stringify(sent.slice(0, 40)) + ')'))
    report('quote: sending adds exactly one user message',
      after === before + 1,
      { before, after })
    report('quote: the sent message carries both the quoted lines and the prompt',
      sent.includes(PROMPT) && quotedCarried,
      {
        rendering: pillBranch ? 'note pill' : 'plain blockquote',
        pill: lastRow?.pill ?? null,
        sent: sent.slice(0, 120),
        expectedQuote: firstLine.slice(0, 40),
        expectedPrompt: PROMPT,
      })

    // 5) After the send the composer is empty again and the note store is empty.
    const afterSend = await quoteState(page)
    const sentDraft = (await composerText(page) ?? '')
    report('quote: the composer draft is empty after sending',
      sentDraft.trim() === '', { draft: JSON.stringify(sentDraft.slice(0, 40)) })
    report('quote: the note store is cleared after sending',
      afterSend.hostOpen !== '1' && afterSend.rows.length === 0,
      { hostOpen: afterSend.hostOpen, rows: afterSend.rows.length })
  } catch (error) {
    for (const name of pending) check(name, false, { error: String(error).slice(0, 200) })
  }

  const pendingSends = new Set([
    'quote: the send button merges the notes too',
    'quote: a send with a queued note still produces exactly one message',
  ])
  const reportSend = (name, ok, detail) => {
    pendingSends.delete(name)
    check(name, ok, detail)
  }
  try {
    // 6) The same merge has to happen for the composer's send button: the
    //    capture-phase click listener folds the notes, then lets the click
    //    reach the button. Quote the oldest message so both checks can use a
    //    plain selection even after earlier sends added note pills.
    await clearComposer(page)
    await clearQuotes(page)
    const buttonBefore = await userMessageCount(page)
    const buttonQuote = await quoteFromUserRow(page, { fromEnd: false })
    const buttonFirstLine = (buttonQuote.selected ?? '').split('\n')[0] ?? ''
    const buttonQueued = await quoteState(page)
    // A script-level focus() does not give the page keyboard focus; a real
    // pointer click does, so the typed prompt lands in the editor.
    await page.click('[data-composer-input]')
    await page.keyboard.type(BUTTON_PROMPT)
    await sleep(250)
    const buttonTyped = (await composerText(page) ?? '').trim()
    const buttonClick = await clickPrimarySend(page)
    const buttonAfter = await waitForUserMessageCount(page, buttonBefore)
    const buttonRow = await lastUserNoteRow(page)
    const buttonCarried = quoteCarriedByRow(buttonRow, buttonFirstLine)
    const buttonSent = normalizePrompt(buttonRow?.text ?? '')
    const buttonSettled = await quoteState(page)
    const buttonDraft = (await composerText(page) ?? '').trim()
    reportSend('quote: the send button merges the notes too',
      buttonQuote.clicked && buttonFirstLine !== '' && buttonQueued.hostOpen === '1'
        && PILL.test(buttonQueued.pill ?? '') && buttonTyped === BUTTON_PROMPT
        && buttonClick.clicked && buttonAfter === buttonBefore + 1
        && buttonSent.includes(BUTTON_PROMPT) && buttonCarried.carried
        && buttonDraft === '' && buttonSettled.hostOpen !== '1' && buttonSettled.rows.length === 0,
      {
        before: buttonBefore,
        after: buttonAfter,
        click: buttonClick,
        draftWhileQueued: JSON.stringify(buttonQueued.draft ?? ''),
        typed: buttonTyped,
        rendering: buttonCarried.rendering,
        pill: buttonRow?.pill ?? null,
        sent: buttonSent.slice(0, 120),
        draftAfterSend: JSON.stringify(buttonDraft),
        noteOpen: buttonSettled.hostOpen,
        noteRows: buttonSettled.rows.length,
      })

    // 7) The maintainer's report: with a note queued, a plain Enter send used
    //    to be swallowed (message count unchanged). It must produce exactly
    //    one message - not zero, and not two after the transcript settles.
    await clearComposer(page)
    await clearQuotes(page)
    const queuedBefore = await userMessageCount(page)
    const queuedQuote = await quoteFromUserRow(page, { fromEnd: false })
    const queuedFirstLine = (queuedQuote.selected ?? '').split('\n')[0] ?? ''
    await sendFromComposer(page, QUEUED_PROMPT)
    const queuedAfter = await waitForUserMessageCount(page, queuedBefore)
    await sleep(900)
    const queuedSettled = await userMessageCount(page)
    const queuedRow = await lastUserNoteRow(page)
    const queuedCarried = quoteCarriedByRow(queuedRow, queuedFirstLine)
    const queuedSent = normalizePrompt(queuedRow?.text ?? '')
    const queuedState = await quoteState(page)
    const queuedDraft = (await composerText(page) ?? '').trim()
    reportSend('quote: a send with a queued note still produces exactly one message',
      queuedQuote.clicked && queuedFirstLine !== ''
        && queuedAfter === queuedBefore + 1 && queuedSettled === queuedBefore + 1
        && queuedSent.includes(QUEUED_PROMPT) && queuedCarried.carried
        && queuedDraft === '' && queuedState.hostOpen !== '1' && queuedState.rows.length === 0,
      {
        before: queuedBefore,
        after: queuedAfter,
        settled: queuedSettled,
        rendering: queuedCarried.rendering,
        pill: queuedRow?.pill ?? null,
        sent: queuedSent.slice(0, 120),
        draftAfterSend: JSON.stringify(queuedDraft),
        noteOpen: queuedState.hostOpen,
        noteRows: queuedState.rows.length,
      })
  } catch (error) {
    for (const name of pendingSends) check(name, false, { error: String(error).slice(0, 200) })
  }
  await clearComposer(page)
  await clearQuotes(page)
}
