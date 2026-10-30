/**
 * Overlay regressions: geometry, layout tracking, the stray-ghost-over-typed-text
 * bug, and the popup-occlusion rule.
 *
 * Every check here is a bug we shipped a fix for; the seam draws the overlay
 * directly so the checks stay deterministic (no model round-trip).
 *
 * @module dsh-prompt-history/test/e2e/overlay
 */
import {
  clearComposer, composerText, focusComposer, hostIdentity, normalizePrompt, openFirstSession,
  overlayGeometry, seamHideSuggestion, seamShowSuggestion, sleep,
} from './harness.mjs'

const TOLERANCE = 2

/**
 * Run the overlay suite.
 * @param page - an app page from the harness.
 * @param check - the runner's assertion collector.
 */
export async function overlaySuite(page, check) {
  // The composer renders before the session finishes opening; keys typed into a
  // composer whose session is still loading are swallowed, so open one first.
  await openFirstSession(page)
  await focusComposer(page)
  await clearComposer(page)

  // 1) The overlay sits exactly on the composer's content box.
  const shown = await seamShowSuggestion(page)
  await sleep(400)
  const geometry = await overlayGeometry(page)
  check('overlay aligns with the composer content box',
    shown === true && geometry.present === true
      && Math.abs(geometry.left - geometry.contentLeft) <= TOLERANCE
      && Math.abs(geometry.width - geometry.contentWidth) <= TOLERANCE,
    { shown, geometry })

  // 2) A layout change (window resize) moves the composer; the overlay follows.
  //
  // The app may remount the composer when the viewport changes; the plugin then
  // drops the stale overlay (correct behaviour), so the check re-shows it and
  // verifies it lands on the NEW box rather than the old one.
  const widthBefore = geometry.contentWidth
  const leftBefore = geometry.contentLeft
  const beforeIdentity = await hostIdentity(page)
  await page.setViewport({ width: 1280, height: 900 })
  await sleep(900)
  const identity = await hostIdentity(page)
  let afterResize = await overlayGeometry(page)
  const remounted = identity !== null && identity.same === false
  if (afterResize.present === false) {
    await seamShowSuggestion(page)
    await sleep(400)
    afterResize = await overlayGeometry(page)
  }
  // The column is centred with a max width, so a narrower window can move it
  // without resizing it; either change proves the layout moved under the overlay.
  const layoutMoved = Math.abs(afterResize.contentWidth - widthBefore) > 20
    || Math.abs(afterResize.contentLeft - leftBefore) > 20
  check('overlay follows a layout change',
    afterResize.present === true
      && layoutMoved
      && Math.abs(afterResize.left - afterResize.contentLeft) <= TOLERANCE
      && Math.abs(afterResize.width - afterResize.contentWidth) <= TOLERANCE,
    { widthBefore, leftBefore, afterResize, layoutMoved, remounted, beforeIdentity })
  await page.setViewport({ width: 1700, height: 1000 })
  await sleep(700)

  // 3) Regression: the prediction must never be repainted over real input.
  await page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    if (editor !== null) editor.focus()
  })
  await page.keyboard.type('Release 1.1.4 测试重叠')
  await sleep(900)
  const afterTyping = await overlayGeometry(page)
  const draft = await composerText(page)
  check('prediction disappears when real text is typed',
    afterTyping.present === false && (draft ?? '').includes('测试重叠'),
    { afterTyping, draft })
  await clearComposer(page)

  // 4) Regression: a covering popup must paint over the ghost, not under it.
  //    A stand-in menu (numeric z-index, over the overlay's own box) makes this
  //    independent of whichever popup the app happens to render, and of where it
  //    opens.
  await clearComposer(page)
  await seamShowSuggestion(page)
  await sleep(400)
  const beforeCover = await overlayGeometry(page)
  await page.evaluate(() => {
    const node = document.querySelector('.dsh-ph-suggest')
    const box = node === null ? null : node.getBoundingClientRect()
    const left = box === null ? 8 : box.left
    const top = box === null ? 8 : box.top
    const width = box === null ? 420 : Math.min(420, box.width)
    const height = box === null ? 120 : Math.min(120, box.height)
    const cover = document.createElement('div')
    cover.setAttribute('role', 'menu')
    cover.setAttribute('data-e2e-popup', '1')
    cover.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${width}px;height:${height}px;z-index:1100;background:rgba(0,0,0,.12)`
    document.body.appendChild(cover)
  })
  await sleep(2000) // the 1 s fallback tick re-probes
  const covered = await overlayGeometry(page)
  const coverZ = await page.evaluate(() => {
    const cover = document.querySelector('[data-e2e-popup="1"]')
    return cover === null ? null : Number.parseInt(getComputedStyle(cover).zIndex, 10)
  })
  await page.evaluate(() => { document.querySelector('[data-e2e-popup="1"]')?.remove() })
  await sleep(2000)
  const uncovered = await overlayGeometry(page)
  await seamHideSuggestion(page)
  check('ghost sits below a popup that covers the composer',
    covered.present === true && coverZ === 1100
      && (Number(covered.zIndex) < coverZ || covered.visibility === 'hidden'),
    { beforeZ: beforeCover.zIndex, coverZ, covered })
  check('overlay returns to its own layer once the popup closes',
    uncovered.present === true && Number(uncovered.zIndex) > (coverZ ?? 0),
    { coverZ, uncovered })

  // 5) Hiding the overlay restores the composer's own placeholder.
  await clearComposer(page)
  await seamShowSuggestion(page)
  await sleep(300)
  const placeholderWhileShown = await page.evaluate(() => {
    const placeholder = [...document.querySelectorAll('[data-composer-placeholder], [class*="placeholder"]')]
      .find((el) => el.getBoundingClientRect().height > 0)
    return placeholder === undefined ? null : getComputedStyle(placeholder).visibility
  })
  await seamHideSuggestion(page)
  await sleep(400)
  const placeholderAfterHide = await page.evaluate(() => {
    const placeholder = [...document.querySelectorAll('[data-composer-placeholder], [class*="placeholder"]')]
      .find((el) => el.getBoundingClientRect().height > 0)
    if (placeholder === undefined) return null
    return getComputedStyle(placeholder).visibility !== 'hidden'
  })
  // 6) Issue #14: the scroll path must coalesce into one measurement per frame.
  //    A trackpad gesture fires dozens of events; measuring per event forced a
  //    synchronous layout each time (~20 fps while scrolling a long conversation).
  await clearComposer(page)
  await seamShowSuggestion(page)
  await sleep(300)
  const burst = await page.evaluate(async () => {
    const proto = Element.prototype
    const original = proto.getBoundingClientRect
    let calls = 0
    proto.getBoundingClientRect = function patched(...args) {
      calls += 1
      return original.apply(this, args)
    }
    for (let i = 0; i < 40; i += 1) window.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    proto.getBoundingClientRect = original
    return calls
  })
  const afterBurst = await overlayGeometry(page)
  check('scroll bursts coalesce into a frame-sized measurement',
    burst <= 20
      && afterBurst.present === true
      && Math.abs(afterBurst.left - afterBurst.contentLeft) <= TOLERANCE,
    { rectCalls: burst, afterBurst })
  await seamHideSuggestion(page)

  // 7) ask_user_question takes over the composer seat: the bar stays mounted but
  //    its anchor is display:none and the question card renders in its place. The
  //    host is connected yet unmeasurable, and the old prediction must not stay
  //    pinned on top of that card (PR #11).
  await clearComposer(page)
  await seamShowSuggestion(page)
  await sleep(300)
  const hidden = await page.evaluate(() => {
    const seat = document.querySelector('[data-chain-overlay-fallback="conversation.composer"]')
      ?? document.querySelector('[data-composer-card]')
    if (seat === null) return null
    const previous = seat.style.display
    seat.style.display = 'none'
    return { restored: previous, hook: seat.hasAttribute('data-chain-overlay-fallback') ? 'chain' : 'card' }
  })
  await sleep(1600)
  const afterSeatHidden = await page.evaluate(() => document.querySelector('.dsh-ph-suggest') !== null)
  await page.evaluate(() => {
    const seat = document.querySelector('[data-chain-overlay-fallback="conversation.composer"]')
      ?? document.querySelector('[data-composer-card]')
    if (seat !== null) seat.style.display = ''
  })
  await sleep(300)
  check('overlay drops when the composer seat stops rendering',
    hidden !== null && afterSeatHidden === false,
    { hidden, stillPresent: afterSeatHidden })
  await seamHideSuggestion(page)

  // 8) Issue #12: the ghost must sit on the composer's line box, not on the caret
  //    rect's height, or it lands below the draft baseline and reads as a smear.
  //    A wider line box than the caret makes the difference observable.
  await clearComposer(page)
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.setAttribute('data-e2e-lineheight', '1')
    style.textContent = '[data-composer-card] [data-composer-input]{line-height:34px !important}'
    document.head.appendChild(style)
  })
  await sleep(300)
  // A caret must exist for the ghost to anchor to: type one character first.
  await page.evaluate(() => { const el = document.querySelector('[data-composer-input]'); if (el) el.focus() })
  await page.keyboard.type('a')
  await sleep(200)
  const ghost = await page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    const seam = window.__dshPhTest
    if (editor === null || seam === undefined) return null
    seam.showGhost('基线校验后缀', editor)
    const node = document.querySelector('.dsh-ph-ghost')
    if (node === null) return null
    const hostLine = Number.parseFloat(getComputedStyle(editor).lineHeight)
    const ghostLine = Number.parseFloat(getComputedStyle(node).lineHeight)
    const caret = document.getSelection()?.getRangeAt(0)?.getBoundingClientRect()
    return {
      hostLine,
      ghostLine,
      ghostHeight: Number.parseFloat(getComputedStyle(node).height),
      ghostTop: Number.parseFloat(getComputedStyle(node).top),
      caretTop: caret === undefined ? null : caret.top,
      caretHeight: caret === undefined ? null : caret.height,
    }
  })
  await page.evaluate(() => {
    const style = document.querySelector('[data-e2e-lineheight]')
    if (style !== null) style.remove()
    window.__dshPhTest?.hideGhost()
  })
  const baselineOk = ghost !== null
    && Math.abs(ghost.ghostLine - ghost.hostLine) <= 1.5
    && Math.abs(ghost.ghostHeight - ghost.hostLine) <= 1.5
    && (ghost.caretTop === null || Math.abs(ghost.ghostTop - (ghost.caretTop - (ghost.hostLine - ghost.caretHeight) / 2)) <= 2)
  check('ghost paints on the composer line box, not the caret height',
    baselineOk,
    { ghost })
  await sleep(200)

  // 9) The occlusion probe is the last per-frame cost: it must be skipped when
  //    nothing on the page changed and no popup exists (a scroll burst does not
  //    mutate the DOM).
  await clearComposer(page)
  await seamShowSuggestion(page)
  await sleep(2400) // let the dirty flag settle after the previous covers
  const probeCost = await page.evaluate(async () => {
    const original = document.elementFromPoint.bind(document)
    let hits = 0
    document.elementFromPoint = (...args) => { hits += 1; return original(...args) }
    for (let i = 0; i < 40; i += 1) window.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    document.elementFromPoint = original
    return hits
  })
  // A page that keeps changing (a streaming turn, an animated panel) legitimately
  // re-probes once per frame — the guarantee is per frame, not per event: 40 scroll
  // events may cost one pass of five hit tests, never forty.
  check('occlusion probing costs at most one pass per frame, not one per event',
    probeCost <= 5,
    { elementFromPointCalls: probeCost })
  await seamHideSuggestion(page)

  // 10) A cover with no numeric z-index (an approval card rendered inside the
  //     composer card) has no layer to slide under. The product rule is simply
  //     that the hint must not stay visible over it; whether it is hidden or
  //     removed is an implementation detail. (The restore path is covered by the
  //     popup check above, which uses a cover the page itself renders.)
  await clearComposer(page)
  await seamShowSuggestion(page)
  await sleep(400)
  await page.evaluate(() => {
    const card = document.querySelector('[data-composer-card]')
    const cover = document.createElement('div')
    cover.setAttribute('data-e2e-inflow-cover', '1')
    cover.style.cssText = 'position:absolute;inset:0;background:transparent'
    ;(card ?? document.body).appendChild(cover)
  })
  await sleep(1700) // the 1 s fallback tick schedules the frame that re-probes
  const overInflowCover = await page.evaluate(() => {
    const node = document.querySelector('.dsh-ph-suggest')
    if (node === null) return 'removed'
    return getComputedStyle(node).visibility === 'hidden' ? 'hidden' : 'visible'
  })
  await page.evaluate(() => { document.querySelector('[data-e2e-inflow-cover="1"]')?.remove() })
  await sleep(400)
  check('an in-flow cover without a z-index never leaves the hint visible',
    overInflowCover === 'hidden' || overInflowCover === 'removed',
    { overInflowCover })
  await seamHideSuggestion(page)

  // 11) Issue #13's residual: with the prediction on screen and nothing happening,
  //     the overlay must not be rebuilt at all. The 1 s fallback tick used to queue
  //     a full repaint (spans destroyed/recreated, six inline styles rewritten, one
  //     forced layout) once a second with identical content.
  await clearComposer(page)
  await seamShowSuggestion(page)
  await sleep(600)
  const idle = await page.evaluate(async () => {
    const node = document.querySelector('.dsh-ph-suggest')
    const host = document.querySelector('[data-composer-input]')
    if (node === null || host === null) return null
    let mutations = 0
    const watcher = new MutationObserver((records) => { mutations += records.length })
    watcher.observe(node, { childList: true, subtree: true, characterData: true, attributes: true })
    const originalRect = Element.prototype.getBoundingClientRect
    let ownReads = 0
    Element.prototype.getBoundingClientRect = function patched(...args) {
      if (this === node || this === host) ownReads += 1
      return originalRect.apply(this, args)
    }
    const originalFromPoint = document.elementFromPoint.bind(document)
    let probes = 0
    document.elementFromPoint = (...args) => { probes += 1; return originalFromPoint(...args) }
    await new Promise((resolve) => setTimeout(resolve, 2600))
    watcher.disconnect()
    Element.prototype.getBoundingClientRect = originalRect
    document.elementFromPoint = originalFromPoint
    return { mutations, ownReads, probes, stillPresent: document.querySelector('.dsh-ph-suggest') !== null }
  })
  check('an idle overlay is not repainted at all',
    idle !== null && idle.mutations === 0 && idle.stillPresent === true,
    idle)
  await seamHideSuggestion(page)

  // 12) Issue #15 ①: only one composer overlay may be on screen. Both are fixed
  //     layers at the same z-index anchored to the same point, so the two dim texts
  //     used to weave together in the race where the draft goes empty before the
  //     completion sync re-runs. An empty contenteditable has no caret rect (no text
  //     node), so the race is driven on a controlled textarea, where both entry
  //     points are reachable in the same state.
  const exclusive = await page.evaluate(() => {
    const seam = window.__dshPhTest
    if (seam === undefined) return null
    const area = document.createElement('textarea')
    area.style.cssText = 'position:fixed;left:40px;top:120px;width:320px;height:72px;'
    document.body.appendChild(area)
    area.focus()
    // ghost first, then a prediction on the same empty field
    const ghostShown = seam.showGhost('后缀', area) === true
    const ghostBefore = seam.ghostVisible()
    const suggestionShown = seam.showSuggestion('互斥校验预测', '按 Tab 键接受', area, { hidePlaceholder: false }) === true
    const afterSuggestion = { suggestion: seam.suggestionVisible(), ghost: seam.ghostVisible() }
    // and the other direction: a ghost claims the field back from the prediction
    const ghostAgain = seam.showGhost('后缀二', area) === true
    const afterGhost = { suggestion: seam.suggestionVisible(), ghost: seam.ghostVisible() }
    seam.hideSuggestion()
    seam.hideGhost()
    area.remove()
    return { ghostShown, ghostBefore, suggestionShown, afterSuggestion, ghostAgain, afterGhost }
  })
  check('only one composer overlay is on screen at a time',
    exclusive !== null
      && exclusive.ghostShown && exclusive.ghostBefore
      && exclusive.suggestionShown
      && exclusive.afterSuggestion.suggestion && !exclusive.afterSuggestion.ghost
      && exclusive.ghostAgain
      && exclusive.afterGhost.ghost && !exclusive.afterGhost.suggestion,
    exclusive)

  // 13) Issue #15 ②③: a wrapped prediction clamps to two lines with an ellipsis,
  //     and the hint gets its own room below the text instead of landing inside it.
  await clearComposer(page)
  await seamShowSuggestion(page, '这是一段用于校验两行截断与提示不重叠的很长的预测文本，'.repeat(6))
  await sleep(600)
  const wrapped = await page.evaluate(() => {
    const container = document.querySelector('.dsh-ph-suggest')
    const text = document.querySelector('.dsh-ph-suggest-text')
    const hint = document.querySelector('.dsh-ph-suggest-hint')
    if (container === null || text === null) return null
    const box = container.getBoundingClientRect()
    const textBox = text.getBoundingClientRect()
    const hintBox = hint === null ? null : hint.getBoundingClientRect()
    return {
      line: Number.parseFloat(getComputedStyle(container).lineHeight),
      containerHeight: box.height,
      containerBottom: box.bottom,
      textHeight: textBox.height,
      textBottom: textBox.bottom,
      hintTop: hintBox === null ? null : hintBox.top,
      hintBottom: hintBox === null ? null : hintBox.bottom,
      hintText: (hint?.textContent ?? '').trim().slice(0, 10),
    }
  })
  check('a wrapped prediction clamps to two lines and keeps its hint clear',
    wrapped !== null
      && wrapped.textHeight <= wrapped.line * 2 + 2
      && wrapped.containerHeight >= wrapped.textHeight - 1
      // Either the hint is gone (wrapped text drops it) or it sits below the text.
      && (wrapped.hintText === '' || wrapped.hintTop >= wrapped.textBottom - 1),
    wrapped)
  await seamHideSuggestion(page)

  // 14) Issue #17: the overlay mirrors the EDITOR's type style, not the card's, and
  //     it must not force its own italic/opacity. A theme that sizes the editor
  //     differently from the card is the case that exposes the mix.
  await clearComposer(page)
  const themed = await page.evaluate(async () => {
    const style = document.createElement('style')
    style.setAttribute('data-e2e-type-size', '1')
    // The card keeps the app's own size; only the editor is re-typed, exactly as a
    // theme pack does it.
    style.textContent = '[data-composer-card] [data-composer-input]{font-size:13px !important;font-style:normal !important}'
    document.head.appendChild(style)
    // A theme switch is an attribute change, not a resize: this is what has to
    // invalidate the cached type style.
    document.documentElement.setAttribute('data-e2e-theme', 'dark')
    const seam = window.__dshPhTest
    const host = document.querySelector('[data-composer-input]')
    if (seam === undefined || host === null) return null
    host.focus()
    seam.showPending('正在预测下一条…', host, { hidePlaceholder: false })
    await new Promise((resolve) => setTimeout(resolve, 700))
    const overlay = document.querySelector('.dsh-ph-suggest')
    const text = document.querySelector('.dsh-ph-suggest-text')
    if (overlay === null || text === null) return null
    const overlayStyle = getComputedStyle(overlay)
    const textStyle = getComputedStyle(text)
    return {
      hostSize: getComputedStyle(host).fontSize,
      overlaySize: overlayStyle.fontSize,
      textSize: textStyle.fontSize,
      textStyle: textStyle.fontStyle,
      textOpacity: textStyle.opacity,
      inlineFont: overlay.style.font,
    }
  })
  const pendingState = themed === null
    ? null
    : {
      ...themed,
      matchesEditor: themed.textSize === themed.hostSize && themed.overlaySize === themed.hostSize,
    }
  await page.evaluate(() => {
    document.querySelector('[data-e2e-type-size]')?.remove()
    document.documentElement.removeAttribute('data-e2e-theme')
    window.__dshPhTest?.hideSuggestion()
  })
  check('the overlay mirrors the editor type and forces no italic',
    pendingState !== null
      && pendingState.matchesEditor === true
      && pendingState.textStyle === 'normal'
      && Number(pendingState.textOpacity) >= 0.9
      && pendingState.inlineFont === '',
    pendingState)
  await sleep(200)

  check('placeholder is restored when the overlay hides',
    placeholderAfterHide === true,
    { placeholderWhileShown, placeholderAfterHide })
}
