<div align="center">

# ⌨️ dsh-prompt-history

**Terminal-style input for the DeepSeek Harness Web GUI composer — bash-like prompt history, copy & quote, and right-click paste.**

*Press ↑ like it's a terminal — history, quoting and pasting in one plugin.*

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](#)
[![npm version](https://img.shields.io/npm/v/dsh-prompt-history)](https://www.npmjs.com/package/dsh-prompt-history)
[![npm downloads](https://img.shields.io/npm/dm/dsh-prompt-history)](https://www.npmjs.com/package/dsh-prompt-history)

**English** · [简体中文](README.md) · [Español](README.es.md) · [Português](README.pt.md)

</div>

---

## Compatibility

| Surface | Status |
|---|---|
| DSH versions | **One release supports both 0.1.x and 0.2.x** (no per-version plugin switch): 0.1.1-rc.2 / 0.1.2-rc.1 / 0.1.5-rc.1 run-verified; **0.2.0-rc.2 mount-verified live**, 0.2.1-alpha.2 / alpha.3 pass the official installer compatibility preflight. Node reading is normalized across generations (old `session.nodes` / 0.1.2+ `legacy.nodes` / newer `order`+store with `data.content`), so desktop 2.0.x is covered too |
| Version mapping | **≥ 1.2.16** supports 0.1.x and 0.2.x together (1.2.16 fixed the rejected install on 0.2.1+; 1.2.17 moved types/deps to the 0.2.x package layout while keeping 0.1.x working). **No 1.3.x breaking line exists or is needed** |
| Platform | Web GUI only (client plugin; browser-local state; no network, no native code) |
| Node | `>=20` |
| Model | Any (only the toggleable context suggestion calls the current session model) |
| UI language | 中文 / English (follows the DSH app locale, switchable in Settings) |

## What you get

`dsh-prompt-history` puts a terminal's input history into the DeepSeek Harness Web GUI composer:

1. **Shell-style arrow recall** — with an empty draft, **Up** recalls the most recently sent message (newest first); **with a typed prefix, Up jumps to the most recent message starting with that prefix** (bash `history-search-backward`), keep pressing Up to walk further back through matches; **Down** walks forward (including forward through prefix matches) and, at the bottom edge, **restores the line you were typing before browsing began** (readline pending-line behavior).
2. **Edit exits browsing** — editing the draft while browsing drops back to the live line.
3. **Ctrl+R reverse search** — incremental search over history with live matching (bash-style `(reverse-i-search)`query`` overlay); Ctrl+R again steps to the older match; Enter accepts, Escape cancels and restores the previous draft.
4. **Copy + quote (two modes, in Settings)** — any non-empty selection in the page — the composer textarea, chat messages, code blocks — is handled per the chosen mode:
   - **Toolbar** (default): Copy / Quote buttons appear above the selection — copy writes the clipboard only on click (no Win+V flooding); **Quote** records the selection as a *note* (Codex style — the composer itself stays untouched): a numbered card (`1.` + the selected text, with edit / delete) appears above the composer next to an “N notes ×” pill, and a green numbered badge floats beside the paragraph the text came from. The card stays collapsed until you hover the pill; when you send, the notes are merged into the message as a `>` blockquote at the top, then the card and badges are cleared, and the transcript shows them as a “💬 N notes” pill (open it to read the quoted source).
   - **Auto** (terminal-style): copies the selection straight to the system clipboard on select.
5. **Right-click pastes directly** — a right-click on the composer pastes the clipboard — no context menu, like a Linux terminal. Paste runs the same pipeline as Ctrl+V (images and reference chips behave identically), with a Clipboard API fallback when the execCommand path is blocked.
6. **Cross-session history** (Settings toggle, default off) — keeps Up/Down history across sessions, stored in browser localStorage (cap 200), survives reloads and session switches.
7. **Prompt completion (Codex-style, Settings toggle, default on)** — while your draft is a prefix of an earlier prompt, the remainder is ghosted after the caret in dim text; accept it in one keystroke with **Tab or →** (Escape ignores it). Matching is case-insensitive, and `/` or `@` drafts are left to the host's own command/reference menus.
8. **Context suggestion (Codex-style, Settings toggle, default on)** — with an empty composer the plugin hands the recent conversation to the **current session model**, predicts the prompt you are about to write, and shows it as a dim full sentence inside the input with a "Press Tab to accept" hint; **Tab** fills it in (typing, Escape or a new turn dismisses it). It runs once per finished turn plus once when the empty composer gains focus, and caches per context so the same context never calls twice.
9. **Chat TOC (conversation directory)** — when the conversation gets long, a subtle semi-transparent, draggable grip on the chat's left edge (brightens on hover) expands a directory of every user message in order — click any entry to jump to that spot, and scroll through all entries when the list gets long; click outside or press Esc to close. Can be toggled off in Settings.

Pure UI behavior: no session events, no agent-loop changes. History recall, quoting and copying are entirely browser-local and request-free; the single feature that calls a model is **context suggestion**, which you control in Settings (on by default). While enabled it sends at most one tiny prediction request (~512 token budget) per turn to the **current session model**; turn it off and the plugin is fully offline again. Recalled and predicted text only ever enters the composer draft, while quotes wait in the plugin's own note queue (never in the draft) and are merged into the message on submit — nothing reaches the model unless *you* press Enter.

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add dsh-prompt-history

# 2. refresh the page — no service restart needed
```

## Install & uninstall

- **npm channel** (published releases): `dsh plugin --profile web add dsh-prompt-history`
- **git channel** (local dev, latest `main`): `dsh plugin --profile web add "github:Xiaofei-fei/dsh-prompt-history#main"` (a source checkout must be built first — `pnpm run build`; an unbuilt bundle refuses to boot)
- **uninstall**: `dsh plugin --profile web remove dsh-prompt-history`

## Configuration

Open **Settings → `>_ Terminal Input`** (stored in browser localStorage, effective immediately):

| Option | Default | Meaning |
|---|---|---|
| Copy mode (on selection) | `Toolbar copy` | `Toolbar` (recommended; writes the clipboard only on click) / `Auto copy on select` (terminal-style) |
| Cross-session history | Off | Up/Down history persists across sessions in browser localStorage (cap 200) |
| Context suggestion (Tab accepts) | On | With an empty composer, predicts your next prompt using the current session model; Tab accepts (once per turn, small quota use) |
| Prompt completion (Tab accepts) | On | Ghosts the matching history prompt while you type; Tab or → accepts, Escape ignores |
| Chat TOC | On | Show the draggable grip on the chat left edge; can be turned off |
| Right-click paste | On | Off restores the browser's native context menu |

Up/Down history is always on, independent of these switches. Completion shares the same history and the same prefix-matching semantics as Up.

## Features

- **History comes from the session's own message log**: reads the conversation snapshot's user nodes (`user` / `steering`) and appends as they land — strictly consistent with the transcript, persisted with the session, survives page reloads, and needs no configuration or extra storage.
- **Consecutive duplicates collapse**; browse state resets on session switch.
- **Internationalized UI**: every string (settings, toolbar, feedback pills, TOC, search overlay) follows the DSH app language (中文 / English).
- The client bundle is ~12 KB gzipped and depends only on the official `@deepseek-ai/*` peer packages.

## Known limitations

- **Ctrl+R**: while the composer is focused, Ctrl+R is reverse-search — it no longer reloads the page (click outside the input first to reload).
- The conversation directory pulls older host history automatically (page by page until complete), so it can locate every earlier position; Up/Down recall still covers the currently loaded window only.
- Plain text only: image-only or chip-bearing messages are not recalled; recalled drafts are plain text.

## Development

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run build       # tsc (lib/types) + tsdown (lib/index.js / lib/invariant.js / lib/client.js)
```

The browser half (`src/client/`) registers into the `conversation.input.right` slot; the build emits the DSH `__ModuleLoader__` closure format with `react` as the only external (everything else comes from the browser module table). Copy dictionaries live in `src/client/locales.ts` (`zh` authoritative, `en` key-parity) and register via `ctx.locale.register`.

## How it works

The plugin is an invisible composer slot entry that mounts a capture-phase `keydown` listener on the document. It takes over Up/Down only when the target is the composer textarea, no modifiers are held, no IME composition is active, no suggestion menu is open, and the session is not busy — then writes the recalled text through `inputActions.setDraft`. The history list is fed from the snapshot's `user`/`steering` nodes (deduped by seq); the browse position (index plus the pending line to restore) lives in component refs.

## License

[MIT](LICENSE)
