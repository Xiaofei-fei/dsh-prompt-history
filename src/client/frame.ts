/**
 * One animation frame for every overlay.
 *
 * The composer overlays used to measure synchronously inside their event
 * handlers: every scroll event (a trackpad gesture fires dozens per frame) ran a
 * read → write → read sequence, which is a forced synchronous layout each time.
 * That is what turned scrolling a long conversation into ~20 fps.
 *
 * All overlay listeners now only mark work as pending; the actual measuring and
 * writing happens once per animation frame, in registration order.
 *
 * @module dsh-prompt-history/client/frame
 */
type FrameTask = () => void

const pending = new Set<FrameTask>()
const endListeners = new Set<() => void>()
let handle: number | null = null

/** Run the queued tasks in the next frame, then forget them. */
function flush(): void {
  handle = null
  if (pending.size === 0) return
  const tasks = [...pending]
  pending.clear()
  for (const task of tasks) {
    try {
      task()
    } catch {
      // One failing task must not starve the others.
    }
  }
  // Frame-end work sees every task that ran in this frame; it is how a
  // page-level "changed since last probe" flag is consumed exactly once per
  // frame instead of once per subscriber.
  for (const listener of [...endListeners]) {
    try {
      listener()
    } catch {
      // Same isolation as above.
    }
  }
}

/**
 * Run a callback at the end of every frame that ran queued work.
 * @param listener - the callback; it may not schedule more work.
 * @returns disposer removing it.
 */
export function onFrameEnd(listener: () => void): () => void {
  endListeners.add(listener)
  return () => { endListeners.delete(listener) }
}

/**
 * Queue overlay work for the next animation frame.
 *
 * Registering the same task twice in one frame runs it once; tasks run in
 * first-registration order.
 * @param task - measuring/writing work to run at most once this frame.
 */
export function scheduleFrame(task: FrameTask): void {
  pending.add(task)
  if (handle !== null) return
  handle = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(flush)
    : (setTimeout(flush, 16) as unknown as number)
}

/**
 * Whether tasks are already queued for the coming frame.
 *
 * Lets a listener skip the cheap argument work when a frame is pending anyway.
 * @returns true while a frame is scheduled.
 */
export function framePending(): boolean {
  return handle !== null
}
