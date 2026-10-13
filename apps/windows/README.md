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

## Talking to it: Claude, by voice or typed

The app starts the daemon with `HORMES_TEXT_BRAIN=1`: with no voice session open, a line goes
straight to the main brain (Claude Code, on your Claude login) and the answer comes back on the
transcript (`Engine.textTurn`). No OpenAI or Gemini key, no Live session.

**Voice is recognised on this PC** by OpenAI's Whisper large-v3-turbo through whisper.cpp
(`Speech/`): on the GPU via Vulkan, the CPU otherwise. The model (`ggml-large-v3-turbo-q5_0.bin`,
574 MB) lives in `~/.hormes/models` and is downloaded on first run. Audio never leaves the machine
and is dropped once transcribed.

- **Start a turn** with a double clap (the Mac's clap detector, `Audio/ClapDetector.cs`), the mic
  button in the island, or **Ctrl+Alt+Space** from anywhere.
- **It stops when you are done**: `Audio/Endpointer.cs` ends the turn after 2 s of quiet against an
  adaptive noise floor, so a pause to think does not cut you off; a cough alone is not a turn.
- **Early transcription**: once you have been quiet 0.5 s, Whisper starts on what you said, so the
  text is usually ready as the turn ends (0.7–1.5 s after it in the checks). Speaking again drops it.
- Listening for claps keeps the microphone open (Windows shows its mic indicator); turn it off with
  **Listen for double clap** in the tray menu (`~/.hormes/windows-app.json`).

**Answers are spoken** by ElevenLabs in the *Alistair* voice (`Speech/ElevenLabsSpeaker.cs`),
streamed so the first words play while the rest is generated. Put `ELEVENLABS_API_KEY=…` in
`~/.hormes/env`; `ELEVENLABS_VOICE_ID` pins a voice, otherwise the app finds Alistair in your voices
or the Voice Library. Markdown and code are not read out, and long answers stop at ~1200 characters.
A new turn or Stop cuts the voice off, Hormes's own voice never triggers the clap detector, and
**Speak replies** (the speaker button in the notch, the tray menu or Settings) turns it on and off. Only short,
conversational answers are spoken (`Speech/SpokenReply.cs`: at most 5 sentences and 500 characters, no
lists, tables, code, links or headings); anything meant for reading stays on screen and costs no credits.
Nothing is sent to ElevenLabs while Windows output is muted or at zero volume (`Audio/SystemAudio.cs`).

The clap detector is stricter than the Mac's, because the mic is open all day: a double clap must
come out of 0.3 s of quiet, the two claps must be within 2.5x of each other in strength and 0.2–0.6 s
apart, and the room must stay quiet for about one more clap interval after (so typing, speech, a
third clap or music do not count). It rests 3 s after every turn.

Typed text sends on Enter; text pasted in one go (a dictation app such as Wispr Flow) sends itself
after 0.7 s. An answer holds the island open for 12 s so it can be read. Voice events go to
`~/.hormes/windows-app.log` (lengths and timings, never the words).

## Checks

```sh
dotnet run --project apps/windows/Checks
dotnet run --project apps/windows/Checks -- --whisper speech.wav --expect "the words in it"
```

The first runs the clap detector against the Mac's recordings (`apps/mac/Scripts/fixtures`) and the
endpointer against synthetic turns. The second also feeds a recording through the live path in
real time (endpointer, early transcription, Whisper) and reports how long after the turn the text
lands; `--runtime cpu|vulkan` pins the backend.

The checks also run every Mac sound through the CAF reader. `--render <dir>` draws the Console
(every page, both themes, the todo and event sheets) to PNGs with sample data, for looking at the UI
without a screen.

## The hands: `hormes-hands.exe`

The engine's native helper (the Mac's Swift `hormes-hands`) in C#, `apps/windows/Hands`: JSON lines
over stdio, same protocol (`packages/hands/src/native.ts`). Build it with `pnpm build:hands` (runs
`dotnet publish apps/windows/Hands -c Release -o build/hands`, framework-dependent: the whole
`build/hands/` folder is the helper); `handsBin` resolves to `build/hands/hormes-hands.exe` on Windows
(`packages/core/src/env.ts`, `HORMES_HANDS_BIN` overrides).

- Coordinates are physical pixels. The process is Per-Monitor-V2 aware, so a "point" is a pixel,
  every display's `scale` is 1 and the origin is the top-left of the primary monitor (negative to its
  left or above). Screenshots downscale to `maxLongEdge` / `maxPixels`; their `scale` is that factor.
- Real: `hello`, `--permissions` (all true: Windows has no per-app grants for these), `displays`,
  `screenshot` / `zoom` (GDI BitBlt, cursor drawn in), `cursor`, `move`, `click`, `mouse_down/up`,
  `drag`, `scroll`, `key` (`cmd` is Ctrl, `option` is Alt), `hold_key`, `type`, `wait`, `frontmost`,
  `windows`, `open_app` (Start Menu shortcut, else ShellExecute), `focus_app`, `focused_text`,
  `element_at`, `find_element`, `ax_tree` (UI Automation, roles mapped to `AXButton`/`AXTextField`/...),
  `user_idle`, `owner_approval` (Windows Hello via `UserConsentVerifier`; unavailable, cancelled,
  timed out or any error is `approved: false`).
- `type` sets the value through UI Automation when the focused field is empty and writable (verified
  by reading it back), otherwise sends Unicode key events. A password field is refused. A stop in flight
  is not supported (the Mac uses SIGURG): the loop stops on the user's own input or the focus moving.
- `user_idle` cannot tell key from click from scroll: every field is the time since the last input of any
  kind; `foreignMs` leaves out the helper's own posts.
- Not on Windows: `browser_*` answer `bad_request` "not supported on Windows"; `excludePids` is accepted
  but GDI cannot leave a process's windows out of a shot; `locked` is never reported.
- `dotnet run --project apps/windows/Checks -- --hands` opens Notepad, types "hello" through the helper,
  reads it back with `focused_text` and closes it without saving (it uses your keyboard for a moment).
  The protocol test is `packages/hands/src/__tests__/windows-helper.test.ts` (skips when not built).

## Shell sandbox (`apps/windows/Sandbox`)

`run_shell` on Windows runs PowerShell inside an AppContainer through `hormes-sandbox.exe`; the macOS
Seatbelt counterpart is `packages/brain/src/sandbox.ts`. Without the exe the shell fails closed ("shell
isolation is unavailable; no command was run"): there is no unrestricted fallback.

```sh
dotnet build apps/windows/Sandbox     # also copies hormes-sandbox.{exe,dll,runtimeconfig.json,deps.json} to <repo>/build/
```

`HORMES_WINDOWS_SANDBOX` overrides the exe path (default `build/hormes-sandbox.exe`; `build/` is ignored).

```
hormes-sandbox --workspace <dir> --scratch <dir> [--read-only] [--write-file <path>]... [--read <dir>]... -- <program> <args...>
```

The container (profile `Hormes.Shell`) has no capabilities: no network, loopback included. It reaches only
what gets an ACE for its SID: scratch (full), the workspace (modify, or read+execute with `--read-only`),
each `--write-file` (modify; created empty first if missing), each `--read` folder (read+execute). The ACEs
are removed on exit, on Ctrl+C or console close, with a counted lease so a finishing command does not strip
a background job sharing the folder. The child runs in a kill-on-close Job object, so ending
`hormes-sandbox` (taskkill /T) ends the tree. Setup failures print `hormes-sandbox: <reason>` and exit 126.

Caveats: a hard kill of `hormes-sandbox` itself (TerminateProcess, power loss) skips the revoke and leaves
its ACEs on the workspace and scratch folders until the next sandbox run on them removes them; only
processes inside the container can use them. The workspace's `.git` is writable (Seatbelt denies it).
The TS side refuses a workspace holding secret-named entries, hard links, or a protected/secret root.

## The Console

An Apple-style window (tray icon, the notch's Console button, or `Hormes.exe --console [page]`):

- **Home**: a greeting, today's schedule, what is due, and Ask Hormes with the conversation.
- **Calendar**: Day, Week and Month like Apple Calendar; click an event to edit it, double-click an
  empty slot (or a day) to add one; recurring events edit as a series.
- **Todos**: Reminders' smart lists (Today, Scheduled, All, Completed), category chips, sections by
  date, round checkboxes in the category colour, quick add.
- **School**: the week's classes (school-category events), open assignments (school todos and
  everything Canvas brought in through stits), and Study buttons that hand the work to Claude.
- **Settings**: your name, **Calendar & Todos** (see below), voice, the engine and its logs.

It follows Windows' light/dark mode; its colours are Apple's system palette and stits' category colours.

## Calendar & todos: Hormes' own, or synced with stits

The planner lives in the engine (`packages/engine/src/planner`), so the Console, the notch and Claude
(the `planner` tool, and `read_calendar` off the Mac) all see the same todos and events. It has two
stores, switched in Settings, or with the **Hormes | stits** control on Calendar, Todos and School:

- **Hormes** (default): `~/.hormes/planner.json` on this PC.
- **stits**: stits' own Postgres, read and written the way stits' API routes do (Canvas deletions are
  remembered in `canvas_dismissed`, recurring occurrences edit their series), so a change in either
  app shows in the other; Hormes re-reads stits every minute. The connection comes from
  `STITS_DATABASE_URL` or `DATABASE_URL` in `~/Documents/Repositories/stits/.env.local` (or
  `STITS_DIR`); the URL never leaves the engine. Switching on copies this PC's items into stits once;
  switching off shows this PC's own list again.

## Automations

Alarms, timers and reminders Claude sets (`automation_set`) ring on Windows: the Mac's sound
(`apps/mac/Resources/Sounds`, copied next to the app), the line spoken when replies are on, a Windows
notification, and the ring in the notch with **Snooze** and **Done**.

## Not yet on Windows

| Mac piece | Status here |
|---|---|
| Voice (AVAudioEngine, echo guard, barge-in duck) | speech in on-device and answers spoken by ElevenLabs (above); no Live voice session. The app says `audio: false` to the daemon and starts it with `HORMES_AUTO_WAKE=0` |
| The hands (`packages/hands/native`, AX) | not yet: UI Automation + SendInput |
| Shell sandbox (`sandbox-exec`) | not yet: AppContainer / job objects |
| Calendar (EventKit) | the planner instead (above) |
| Owner authentication (Touch ID) | not yet: an approval that needs it offers Deny only |
| Overlay, agents rail, lecture capture and whiteboard workspaces | not yet |
