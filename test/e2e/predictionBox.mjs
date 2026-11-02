/**
 * The prediction overlay's box and type under a zoomed theme.
 *
 * Two invariants that a fixed overlay cannot inherit and therefore has to be
 * tested for (both from PR #18):
 *
 * - it is one line tall and never reaches past the editor's box, because a second
 *   row paints over the toolbar under the composer;
 * - its type is the editor's type *visually*, which needs the zoom factor: position
 *   comes from getBoundingClientRect (viewport px) while type comes from
 *   getComputedStyle (CSS px), and a theme that zooms the page and compensates the
 *   overlay breaks either one of them unless the factor is measured.
 *
 * @module dsh-prompt-history/test/e2e/predictionBox
 */
import { composerText, openApp, openScratchSession, seamHideSuggestion, seamShowSuggestion, seedComposerMessage, sleep, waitForIdle } from './harness.mjs'

/** Long enough to wrap at any composer width. */
const LONG = '这是一段用于校验单行截断与缩放字号一致性的很长的预测文本，'.repeat(5)

/** The zoom factor an element renders at (viewport px over layout px). */
const NODE_ZOOM = `(el) => {
  const own = el.offsetWidth
  return own > 0 ? el.getBoundingClientRect().width / own : 1
}`

/**
 * Run the box/zoom suite.
 * @param page - the app page.
 * @param check - the runner's assertion collector.
 */
export async function predictionBoxSuite(page, check) {
  await openScratchSession(page)
  // A side-chat pane left open by an earlier suite owns the composer seat, and a
  // fixed overlay then has no editor box to hang from.
  await page.evaluate(() => {
    const close = [...document.querySelectorAll('.dsh-ph-iconButton')]
      .find((b) => (b.getAttribute('title') ?? '').includes('关闭此标签页'))
    if (close !== undefined) close.click()
  })
  await sleep(1200)
  await page.evaluate(() => { const el = document.querySelector('[data-composer-input]'); if (el) el.focus() })
  await sleep(400)
  // The seam only paints once the editor is measurable; retry briefly instead of
  // assuming one frame.
  for (let i = 0; i < 10; i += 1) {
    await seamShowSuggestion(page, LONG)
    await sleep(400)
    const painted = await page.evaluate(() => document.querySelector('.dsh-ph-suggest') !== null)
    if (painted) break
  }

  const atOne = await page.evaluate((zoomSource) => {
    const nodeZoom = eval(zoomSource)
    const container = document.querySelector('.dsh-ph-suggest')
    const host = document.querySelector('[data-composer-input]')
    if (container === null || host === null) return null
    const box = container.getBoundingClientRect()
    const hostBox = host.getBoundingClientRect()
    return {
      containerHeight: box.height,
      hostHeight: hostBox.height,
      overrun: box.bottom - hostBox.bottom,
      hint: document.querySelector('.dsh-ph-suggest-hint') !== null,
      overlayZoom: nodeZoom(container),
    }
  }, NODE_ZOOM)
  check('the prediction overlay is one line tall and does not overrun the editor',
    atOne !== null && atOne.containerHeight <= atOne.hostHeight + 2 && atOne.overrun <= 2 && atOne.hint === false,
    atOne)

  // A theme that zooms the page and compensates the fixed overlay: coordinates stay
  // right, contents would scale down without the measured factor.
  await page.evaluate((zoomSource) => {
    eval(zoomSource)
    document.body.style.zoom = '1.25'
    const style = document.createElement('style')
    style.setAttribute('data-e2e-zoom', '1')
    style.textContent = '.dsh-ph-suggest{zoom:0.8}'
    document.head.appendChild(style)
  }, NODE_ZOOM)
  // The zoom is a style attribute change; the overlay repaints from the type-style
  // subscription on the next frame, so measure only after it landed.
  await sleep(900)
  const zoomed = await page.evaluate((zoomSource) => {
    const nodeZoom = eval(zoomSource)
    const container = document.querySelector('.dsh-ph-suggest')
    const text = document.querySelector('.dsh-ph-suggest-text')
    const host = document.querySelector('[data-composer-input]')
    if (container === null || text === null || host === null) return null
    const visual = (el) => Number.parseFloat(getComputedStyle(el).fontSize) * nodeZoom(el)
    const box = container.getBoundingClientRect()
    const hostBox = host.getBoundingClientRect()
    const hostStyle = getComputedStyle(host)
    const hostZoom = nodeZoom(host)
    // The overlay lines up with the editor's CONTENT box, so the padding has to be
    // brought into viewport pixels before comparing.
    const padLeft = (Number.parseFloat(hostStyle.paddingLeft) || 0) * hostZoom
    const padRight = (Number.parseFloat(hostStyle.paddingRight) || 0) * hostZoom
    return {
      overlayVisual: visual(text),
      editorVisual: visual(host),
      overlayLeft: box.left,
      contentLeft: hostBox.left + padLeft,
      overlayWidth: box.width,
      contentWidth: hostBox.width - padLeft - padRight,
      overlayZoom: nodeZoom(container),
      editorZoom: hostZoom,
    }
  }, NODE_ZOOM)
  await page.evaluate(() => {
    document.body.style.zoom = ''
    document.querySelector('[data-e2e-zoom="1"]')?.remove()
  })
  await sleep(400)
  check('the prediction keeps the editor type size under a zoomed theme',
    zoomed !== null
      && Math.abs(zoomed.overlayVisual - zoomed.editorVisual) <= 0.6
      && Math.abs(zoomed.overlayLeft - zoomed.contentLeft) <= 2
      && Math.abs(zoomed.overlayWidth - zoomed.contentWidth) <= 2,
    zoomed)
  await seamHideSuggestion(page)
  await composerText(page) // keep the harness import honest
}
