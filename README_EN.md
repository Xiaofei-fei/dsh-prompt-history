# dsh-prompt-history

Bash-like prompt history for the DSH web composer: **Up / Down** arrows recall previously submitted messages in the input box.

## Install

```sh
dsh plugin --profile web add dsh-prompt-history
```

Then refresh the page.

## Usage

- **Up**: recall the previous submitted prompt (newest first), replacing the current draft; keep pressing Up to walk further back.
- **Down**: walk forward; at the bottom edge, restore the line you were typing before browsing began (readline pending-line behavior).
- **Edit exits browsing**: editing the draft while browsing drops back to the live line.
- **Does not interfere**: while the `/` or `@` suggestion menu is open, arrow keys stay with menu navigation; IME composition, `Shift+Up` selection, `Ctrl+Up` word-jumps and other modifier chords are never intercepted; busy/removed sessions do not respond.

## Features

- **History comes from the session's own message log**: reads the conversation snapshot's user nodes (`user` / `steering`) and appends as they land — strictly consistent with the transcript, persisted with the session, survives page reloads, and needs no configuration or extra storage.
- **Consecutive duplicates collapse**; browse state resets on session switch.
- No UI, no settings; the client bundle is ~7 KB and depends only on the official `@deepseek-ai/*` peer packages.

## Known limitations

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
