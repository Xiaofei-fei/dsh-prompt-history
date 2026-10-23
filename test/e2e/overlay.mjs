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
  clearComposer, composerText, focusComposer, hostIdentity, openFirstSession,
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
  //
  // Two paths, both meaningful: an overlay already on screen may be dropped by
  // the plugin's own controls when focus leaves the composer (fine — it never
  // lands above the popup), and an overlay painted while the popup is open must
  // be restacked below it. The second path is the one the fix is about.
  await seamShowSuggestion(page)
  await sleep(300)
  const beforeMenu = await overlayGeometry(page)
  let clicked = null
  for (let i = 0; i < 10 && clicked === null; i += 1) {
    clicked = await page.evaluate(() => {
      const candidate = [...document.querySelectorAll('button, [role="button"], [aria-haspopup]')]
        .find((b) => /完全权限|工作区内修改|只读|Full access|Workspace/.test((b.textContent ?? '').trim()))
      if (candidate === undefined) return null
      candidate.click()
      return (candidate.textContent ?? '').trim().slice(0, 16)
    })
    if (clicked === null) await sleep(600)
  }
  // The app's own control is not always rendered (it belongs to the composer
  // footer); a stand-in cover still exercises the rule the fix is about.
  if (clicked === null) {
    await page.evaluate(() => {
      const cover = document.createElement('div')
      cover.setAttribute('role', 'menu')
      cover.setAttribute('data-e2e-cover', '1')
      cover.style.cssText = 'position:fixed;left:8px;top:8px;width:420px;height:180px;z-index:1100;background:rgba(0,0,0,.15)'
      document.body.appendChild(cover)
    })
  }
  const opened = clicked ?? 'stand-in'
  await sleep(1200)
  const afterOpen = await overlayGeometry(page)
  if (afterOpen.present === false) {
    await seamShowSuggestion(page)
    await sleep(500)
  }
  const withMenu = await overlayGeometry(page)
  const menuZ = await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"], [data-popper-placement], [role="listbox"]')
    return menu === null ? null : Number.parseInt(getComputedStyle(menu).zIndex, 10)
  })
  const restacked = withMenu.present === true
    && (Number(withMenu.zIndex) < (menuZ ?? 0) || withMenu.visibility === 'hidden')
  // Close the popup the way the user would: press the same control again, or
  // remove the stand-in cover.
  await page.evaluate(() => {
    const cover = document.querySelector('[data-e2e-cover]')
    if (cover !== null) { cover.remove(); return }
    const candidate = [...document.querySelectorAll('button, [role="button"], [aria-haspopup]')]
      .find((b) => /完全权限|工作区内修改|只读|Full access|Workspace/.test((b.textContent ?? '').trim()))
    if (candidate !== undefined) candidate.click()
  })
  await sleep(900)
  await seamShowSuggestion(page)
  await sleep(500)
  const afterClose = await overlayGeometry(page)
  await seamHideSuggestion(page)
  check('ghost sits below a popup that covers the composer',
    opened !== null && menuZ !== null && restacked,
    { opened, menuZ, beforeZ: beforeMenu.zIndex, afterOpenPresent: afterOpen.present, withMenu })
  check('overlay returns to its own layer once the popup closes',
    afterClose.present === true && Number(afterClose.zIndex) > (menuZ ?? 0),
    { menuZ, afterClose })

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
  check('placeholder is restored when the overlay hides',
    placeholderAfterHide === true,
    { placeholderWhileShown, placeholderAfterHide })

  // 6) Regression: a question card owns the composer seat by hiding the ordinary
  // composer bar behind a `display:none` chain-overlay anchor, while the editor
  // itself stays mounted (and `isConnected`). The plugin used to keep repainting
  // the prediction at its last fixed position, on top of the card.
  await clearComposer(page)
  await seamShowSuggestion(page)
  await sleep(300)
  const beforeSeatHidden = await overlayGeometry(page)
  const seatHidden = await page.evaluate(() => {
    const editor = document.querySelector('[data-composer-input]')
    if (editor === null) return null
    // The harness hides the ordinary composer bar behind a `display:none` anchor
    // when another surface (an ask_user_question card) owns the composer seat; a
    // missing anchor falls back to the composer card so the check still exercises
    // "mounted but unmeasurable" either way.
    const anchor = document.querySelector('[data-chain-overlay-fallback="conversation.composer"]')
      ?? editor.closest('[data-composer-card]')
      ?? editor
    anchor.dataset.e2eDisplay = anchor.style.display
    anchor.dataset.e2eDisplayHidden = '1'
    anchor.style.display = 'none'
    return { display: getComputedStyle(anchor).display }
  })
  await sleep(900)
  const whileSeatHidden = await overlayGeometry(page)
  await page.evaluate(() => {
    const el = document.querySelector('[data-e2e-display-hidden="1"]')
    if (el === null) return
    el.style.display = el.dataset.e2eDisplay ?? ''
    delete el.dataset.e2eDisplay
    delete el.dataset.e2eDisplayHidden
  })
  check('prediction disappears when the composer seat is hidden',
    beforeSeatHidden.present === true
      && seatHidden !== null
      && whileSeatHidden.present === false,
    { beforeSeatHidden, seatHidden, whileSeatHidden })
}
