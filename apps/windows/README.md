# Hormes for Windows

The Windows face of Hormes: a tray icon, the notch and a first Console, in C# / WPF on .NET 10.
As on the Mac, everything else (the brain, the agents, memory, automations) is the TypeScript
engine, `hormesd`, which the app spawns and talks to over the same binary wire
(`packages/daemon/src/wire.ts`).

```
Hormes.exe ──spawns──► node --import tsx packages/daemon/src/main.ts --socket ~/.hormes/hormes.sock
     │                          │
     └──── named pipe ──────────┘   JSON control + PCM16 audio frames
```

Windows Node has no unix sockets, so the socket path names a named pipe:
`\\.\pipe\hormes-<first 16 hex of SHA-256(lower-cased full socket path)>`
(`packages/core/src/ipc.ts`, `Daemon/Ipc.cs`; pinned by `packages/core/src/__tests__/ipc.test.ts`).

## Run in development

Requires Windows 10/11, the .NET 10 SDK, Node 24+ and pnpm 10.

```sh
pnpm install
dotnet run --project apps/windows/Hormes.Windows
```

The app finds the checkout by walking up from its executable to the `package.json` named
`hormes` (or `HORMES_REPO`), and Node via `HORMES_NODE`, then `PATH`, then
`C:\Program Files\nodejs`. If a daemon already answers on the pipe (`pnpm hormesd`), the app
attaches instead of spawning. Its own daemon is restarted with backoff (1 s → 30 s) and logs to
`~/.hormes/daemon.log`. Quit sends `bye` and closes the daemon's stdin, as on the Mac.

## The notch

PCs have no hardware notch, so a small black tab hangs from the top edge of the primary display
where the Mac's would be, with the five voice bars. Hover it and the island opens beneath:
what Hormes is doing, the last line said, an approval (Allow / Deny) or a problem (with its
remedy), live threads, a Say field (Enter sends `say-text`), Stop and Console. It closes when the
pointer leaves, unless the Say field holds a draft; Esc clears and closes. The tab never takes
focus on hover and stays out of Alt+Tab; its transparent pixels pass the mouse through. It sits
on the primary monitor, centred, scaled to that monitor (`UI/NotchPlacement.cs`).

## Talking to it: Claude, typed or dictated

The app starts the daemon with `HORMES_TEXT_BRAIN=1`: with no voice session open, a line from the
Say field goes straight to the main brain (Claude Code, on your Claude login) and the answer comes
back on the transcript (`Engine.textTurn`). No OpenAI or Gemini key, no Live session.

Speech comes from [Wispr Flow](https://wisprflow.ai): with the island open, hold Wispr's
push-to-talk (Ctrl+Win) and the caret moves into the Say field, so Wispr types there instead of into
the app underneath. Text that lands in one go sends itself after 0.7 s of quiet; typed text waits
for Enter. **Ctrl+Alt+Space** opens the island from anywhere with the caret in the field. An answer
holds the island open for 12 s so it can be read.

## Not yet on Windows

| Mac piece | Status here |
|---|---|
| Voice (AVAudioEngine, echo guard, barge-in duck) | speech in via Wispr Flow (above); no Live voice session and no spoken answers yet. The app says `audio: false` and the daemon starts with `HORMES_AUTO_WAKE=0` |
| The hands (`packages/hands/native`, AX) | not yet: UI Automation + SendInput |
| Shell sandbox (`sandbox-exec`) | not yet: AppContainer / job objects |
| Calendar (EventKit) | not yet |
| Owner authentication (Touch ID) | not yet: an approval that needs it offers Deny only |
| Hotkeys, Overlay, full Console rails, workspaces | not yet |
