# dsh-prompt-history

Terminal-style copy & paste plus bash-like prompt history for the DSH web composer: **any selection auto-copies**, **right-click pastes the clipboard directly**, and **Up / Down** arrows recall previously submitted messages.

## Install

```sh
dsh plugin --profile web add dsh-prompt-history
```

Then refresh the page.

## Usage

- **Up**: with an empty draft, recalls the newest prompt (newest first); **with a typed prefix, jumps to the most recent prompt starting with that prefix** (bash history-search-backward), keep pressing Up to walk further back through matches.
- **Down**: walk forward (including forward through prefix matches); at the bottom edge, restore the line you were typing before browsing began (readline pending-line behavior).
- **Ctrl+R reverse search**: incremental search over history with live matching (bash-style `(reverse-i-search)`query`` overlay); Ctrl+R again steps to the older match, Enter accepts, Escape cancels and restores the previous draft.
- **Edit exits browsing**: editing the draft while browsing drops back to the live line.
- **Copy + quote (three modes, in Settings)**: any non-empty selection in the page — the composer textarea, chat messages, code blocks — is handled per the chosen mode: **toolbar** (default: 复制 and 引用 buttons appear above the selection — copy writes the clipboard only on click; quote inserts the FULL selected text into the composer as a clean `>`-prefixed markdown blockquote — fully visible and editable, rendered as a blockquote on send; the next input starts on the line directly below) / **auto** (terminal-style: copies the selection straight to the system clipboard; floods Win+V history) / **off**.
- **Right-click pastes directly**: a right-click on the composer textarea pastes the clipboard — no context menu, like a Linux terminal. Paste runs the same pipeline as Ctrl+V (images and reference chips behave identically), with a navigator.clipboard fallback when the execCommand path is blocked.
- **Does not interfere**: while the `/` or `@` suggestion menu is open, arrow keys stay with menu navigation; IME composition, `Shift+Up` selection, `Ctrl+Up` word-jumps and other modifier chords are never intercepted; busy/removed sessions keep the browser's native right-click behavior.

## Chat TOC (conversation directory)

When the conversation gets long, a subtle semi-transparent grip on the chat's left edge (brightens on hover) expands a directory of every user message in order — click any entry to jump to that spot; click outside or press Esc to close.

## Configuration

Open **Settings → 终端式输入 (Terminal-style Input)** (stored in browser localStorage, effective immediately):

- **Copy mode** (on selection): toolbar copy (recommended) / auto copy on select / off
- **Right-click paste**: toggle; off restores the browser's native context menu
- Up/Down history is always on, independent of these switches.

## Features

- **History comes from the session's own message log**: reads the conversation snapshot's user nodes (`user` / `steering`) and appends as they land — strictly consistent with the transcript, persisted with the session, survives page reloads, and needs no configuration or extra storage.
- **Consecutive duplicates collapse**; browse state resets on session switch.
- The client bundle is ~17 KB and depends only on the official `@deepseek-ai/*` peer packages.

## Known limitations

- **Ctrl+R**: while the composer is focused, Ctrl+R is reverse-search — it no longer reloads the page (click outside the input first to reload).

- On a session switch, only the currently loaded event window's messages are recallable (everything submitted while the page is open is included); there is no host-side history fetch.
- Plain text only: image-only or chip-bearing messages are not recalled; recalled drafts are plain text.

## Development

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run build       # tsc (lib/types) + tsdown (lib/index.js / lib/invariant.js / lib/client.js)
```

The browser half (`src/client/`) registers into the `conversation.input.right` slot; the build emits the DSH `__ModuleLoader__` closure format with `react` as the only external (everything else comes from the browser module table).

## How it works

The plugin is an invisible composer slot entry that mounts a capture-phase `keydown` listener on the document. It takes over Up/Down only when the target is the composer textarea, no modifiers are held, no IME composition is active, no suggestion menu is open, and the session is not busy — then writes the recalled text through `inputActions.setDraft`. The history list is fed from the snapshot's `user`/`steering` nodes (deduped by seq); the browse position (index plus the pending line to restore) lives in component refs.

## License

[MIT](LICENSE)
