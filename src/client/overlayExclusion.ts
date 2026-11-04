/**
 * The composer can only show one hint at a time.
 *
 * The prediction overlay and the history-completion ghost are separate modules,
 * each owning a `position: fixed` layer at the same z-index, anchored to the same
 * point on an empty composer. Nothing used to stop both from being on screen —
 * the real window is a race (the draft goes empty, the prediction paints, the
 * completion sync has not re-run yet), and the result is two dim texts woven
 * together where the user expects one (issue #15).
 *
 * A registry rather than direct imports: the two modules would otherwise import
 * each other for their hide functions.
 *
 * @module dsh-prompt-history/client/overlayExclusion
 */

type Hider = () => void

let hideSuggestion: Hider | null = null
let hideGhost: Hider | null = null

/**
 * Register the prediction overlay's hide function (called once at module init).
 * @param hider - the module's `hideSuggestion`.
 */
export function registerSuggestionHider(hider: Hider): void {
  hideSuggestion = hider
}

/**
 * Register the completion ghost's hide function (called once at module init).
 * @param hider - the module's `hideGhost`.
 */
export function registerGhostHider(hider: Hider): void {
  hideGhost = hider
}

/**
 * Give the composer to one overlay, dropping the other.
 * @param kind - the overlay that is about to show.
 */
export function claimComposer(kind: 'suggestion' | 'ghost'): void {
  if (kind === 'suggestion') hideGhost?.()
  else hideSuggestion?.()
}
