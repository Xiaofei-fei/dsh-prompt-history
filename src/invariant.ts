/**
 * Package-owned invariant companion for `dsh-prompt-history`.
 * @module dsh-prompt-history/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-prompt-history'

/** Cordis companion plugin name. */
export const name = 'dsh-prompt-history-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the composer slot registration is a registry-owned
 * registration whose disposal is proven by the HMR-safety spec, and the
 * per-session keydown listener is React-effect-owned (unmount tears it down).
 * The plugin emits no cordis events and owns no cross-plugin mutable state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
