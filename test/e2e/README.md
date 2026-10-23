# E2E tests

Regression suite for the plugin's UI behaviour. It starts a **real DSH web server**
on a scratch port, drives it with a headless Chromium through `puppeteer-core`, and
prints one line per check.

```sh
pnpm test:e2e        # or: pnpm test  (typecheck + e2e)
```

## What is covered

| Suite | Checks |
|---|---|
| `overlay.mjs` | overlay aligns with the composer content box · follows a layout change · **prediction disappears when real text is typed** (the stray-ghost regression) · **ghost sits below a popup that covers the composer** (occlusion) · **prediction disappears when a question card takes the composer seat** (occlusion) · placeholder is restored when the overlay hides |
| `composer.mjs` | ↑ recalls the newest prompt · ↓ restores the pending line · prefix search · completion ghost + Tab · Ctrl+R reverse search · **quote reads the conversation selection while the composer holds focus** · chat TOC opens with entries |
| `sidechat.mjs` | side chat on by default · settings toggle reads enabled + bridge connected · panel opens and forks a thread · **the toolbar action disappears when the feature is off** |

Bold rows are bugs that shipped fixes; they exist so the same regression cannot
come back unnoticed.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `DSH_E2E_CHROME` | `/usr/bin/google-chrome` | Chromium/Chrome binary |
| `DSH_E2E_PORT` | `3099` | scratch server port |
| `DSH_E2E_URL` | — | use an already-running server instead of starting one |
| `DSH_E2E_PROFILE` | `web` | DSH profile to serve |
| `DSH_E2E_DSH_BIN` | `dsh` | the DSH CLI to spawn |
| `DSH_E2E_SECRET` | read from `~/.dsh/.credentials.yaml` | browser-session secret (the cookie signer) |
| `DSH_E2E_HEADFUL` | — | `1` to watch the run |

The suite needs the same machine as a working DSH profile: it signs the
`dsh-auth-*` cookie with the profile's own browser-session secret (read from the
credential store, never committed).

## The test seam

Predictions normally need a model round-trip, which would make geometry and
occlusion checks slow and flaky. So the plugin exposes its overlay controls on
`window.__dshPhTest` **only when** `localStorage['dsh-prompt-history.testSeam'] === '1'`
— the harness sets that key on every page it opens. Nothing is exposed for a
normal user, and the seam has no effect on product behaviour.
