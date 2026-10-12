# hormes: agent index

Voice-first computer-use assistant for User's Mac, built on GPT-Live-1
delegation: the voice owns the conversation, a brain of User's choosing owns what
happens, a Swift helper owns the Mac.

Hormes voice update (2026-10-11): `settings.voiceProvider` selects Gemini Live or
the original OpenAI transport independently of `settings.brain`. See
`docs/GEMINI_VOICE.md`. Gemini uses `GEMINI_API_KEY` in the same secret store and
`packages/live/src/gemini-session.ts`, protected as a whole-file self-edit rail.
Never turn model function arguments into student speech or executable actions.
Local Qwen remains a reasoning option; it does not make Gemini voice local.

## Hardening update (2026-10-10)

Read the execution rules below and `docs/HORMES_PRD.md`. Model shell commands must use
`sandbox.ts` in foreground and background; a lexical verdict alone is not an
execution boundary. Never add an unrestricted fallback. Owner authentication is
on by default for every pending confirmation, including grants; a spoken or typed
yes supplies no device-owner proof. The approval protocol is version 2.
Generic AppleScript, external agent start/send and self-edit preparation/checks
are separately approved broader capabilities. Self-edit checks must build all
affected components; cancellation or missing checks cannot mark a change green.
The proactive pilot is opt-in, passive, budgeted and limited to reading the one
suggested agent; routing wrappers must preserve that tool scope. Protect the
sandbox, authentication, approval protocol, engine wiring and detector as whole
self-edit rails. These additions supersede older spoken-approval/full-shell claims
below; existing secret, wake, audio and ledger rules still apply.

## Inherited-code cleanup (2026-10-11)

The marketing site/playground, mascot eyes/ASCII renderer, coloured halo and
flight trail are retired. `UI/Orb/VoicePresence.swift` paints the white voice bars;
`NotchInk.swift` provides only the solid island shape. The waveform is directly
draggable and can snap into the notch; annotations draw on their own overlay. Build icons with `pnpm build:icon`; the icon's
shared PNG encoder is `scripts/png.ts`. Installer checks are `scripts/check-install.sh`.
Older dated visual notes in `docs/agents/learnings.md` describe retired designs; the Hormes PRD owns
current presentation requirements.

## Hackathon simplification (2026-10-11)

Keep the demo surface small. One draggable white waveform shares its idle breathing
animation with the notch. No collision scans, throwing, autonomous flights, satellites
or fleet budgets. Overlay circles, arrows, rectangles and strokes remain independent
of waveform movement; do not restore `orb.fly`, `orb.trace` or `orb.home` commands.

Activity has a plain saved-session list and recorded conversation pane. Archive, pin,
trash/restore, bulk selection, history search and the grouped ledger UI are retired.
Engine records and CLI readers remain append-only; saved work and external coding
sessions keep their open/resume flows. Native SwiftUI menus, pickers, disclosure and
help replace the custom floating-control framework. Keep a small monochrome theme,
notch expansion, idle bars and essential status feedback.

Settings is one sheet for credentials, reasoning/model selection, microphone, wake,
owner authentication and permissions. Generic automation and memory administration,
accent palettes, billing figures and diagnostic/tuning panels are retired. Calendar,
break/reminder delivery, goals, notes, checkpoints and voice memory keep their backend.
Forge, Sage, Relay, Education, Tasks, the optional phone integration and self-edit are
preserved. Older dated component-kit notes in `docs/agents/learnings.md` describe retired designs.

Visual previews use `Scripts/PreviewMain.swift` through `console-preview.sh` with fake
state, no daemon or audio, and an in-process window capture. The preview scripts keep fake state separate from the running application.

## Boot

1. Read `docs/HORMES_PRD.md` and the execution rules below.
2. `pnpm run doctor` and read what it says before touching anything live.
3. `pnpm run check` must be green before and after your change. Wall-clock
   ceilings in tests carry `RUNNER_SLACK` (×3 under `GITHUB_ACTIONS`, ×1 on a
   Mac) and the `[measure]` lines keep the real numbers; the suite runs four
   files at a time (`--test-concurrency=4`) because the timing asserts were
   written for one Mac, not seventeen workers, and a timing failure under
   `pnpm test` on a busy Mac is re-run alone before it is called a regression.
4. `pnpm test` (and each package's `test` script) loads `scripts/test-preload.mjs`
   into every test process. The fences: a temp `HORMES_STATE_DIR` and a temp `HOME`
   (a `.gitconfig` only); every other `HORMES_*` variable (but the suite's own
   `HORMES_TEST_*` knobs) and every secret key unset, and `HORMES_AUTO_WAKE=0` and
   `HORMES_NO_AUDIO=1` set; `fetch` off loopback answers a synthetic 401 (throws under
   `HORMES_TEST_NET=strict`, as CI runs it) and a WebSocket off loopback is refused;
   `osascript`, `open`, `say`, `afplay`, `shortcuts`, `automator` and `screencapture` run
   a refusing stub, and so do `codex` and `claude` outside the temp dir (a test's own
   fake under `os.tmpdir()` still runs) and any program inside an app under
   `/Applications` or `~/Applications`. Its header says what the fences miss: a
   `node --import tsx` child does not load the preload.

## Rules

- **Nothing on the voice path awaits a tool.** The brain reports through a
  `BrainSink`; the `Delegator` decides what reaches Live. Do not call
  `LiveSession.append*` from a tool.
- **Policy lives in one place:** `packages/core/src/policy.ts` decides
  run/confirm/refuse; the confirmation handshake is `ConfirmationState` in
  `packages/hands`. Every brain goes through `ToolRunner`; do not add a second
  path for "just this tool".
- **Coordinates are global points**, origin top-left of the main display, y
  down. User's second display is *above* the main one: negative y is normal.
  Model coordinates are pixels of the last screenshot; `Screen` maps between.
- **Ledger is append-only.** The Console shows only what was recorded.
- **Protocol first.** App ↔ engine types are `packages/protocol`; the Swift
  mirror is `apps/mac/Sources/Hormes/Model/Protocol.swift`; the socket frames are
  `packages/daemon/src/wire.ts`. Change the TS first, then the mirror.
- No new npm dependencies without a reason in the PR description. No build
  step for the engine: TypeScript runs through tsx; the app is `swift build`.
- Never commit keys. `~/.hormes/env` is the only home; the daemon loads no
  `.env` file from the checkout. The app writes it through `config.set-secrets`
  (Console) and only ever reads back presence and probe results
  (`snapshot.setup`), never a value.
- **Agents link to anything, not to one tool.** The `sessions` connector finds
  the agent sessions on this Mac (Claude Code, Codex, other CLIs on disk or
  running); `claude-code` continues one. Do not add a connector for a specific
  product.
- **Agent statuses are lease-bounded, and `ended` is a word.** `AgentStatus` =
  `working` (a live owner process, a turn-bearing write within 30 s, no closing
  marker) · `idle` (a live owner otherwise) · `blocked` (an open permission
  question) · `done` (archived, or a run that finished and closed) · `ended` (no
  live process, however old; a session with no process is over) · `unknown`
  (the process evidence itself was missing: a degraded `ps`/`lsof`; never "old")
  · `offline` (a run handle closed). `AgentInfo.hint` says why a row reads as it
  does; `detail` carries no relative time (clients format it from `updatedAt`, so
  nothing churns a snapshot a second). Everywhere six statuses are known, seven
  are: `waitSettled` (ended settles), the brain's `agents_list` / `agent_wait`
  text, `hormes status` (`agents N (3 working · 8 ended)`, an
  `AGENT_STATUSES satisfies Record<AgentStatus, 0>` pin), the Sessions rail. A
  tool call with no result when its session ended reads `interrupted`, no pulse.
  `send()` to an `ended` Codex session still resumes it.
- **Delete; history is git.** Superseded code is removed outright: no alias
  shims, no deprecated fields, no fixtures of retired shapes. The one compatibility
  kept is files under `~/.hormes` written before 2026-09-13: ledger day files hold
  `worker` rows, `step.worker`, session rows without `language`, `pause` / `resume`
  rows without a session, `"?"` closes and per-session utterance ids (every reader
  skips or tolerates them); and `settings.json` says `workers` (read as `threads`) and
  may carry `replayFinish` (dropped).
- **Gated by policy, not by absence.** The brain can read, write, run, fetch and
  script anything on this Mac; `packages/core/src/policy.ts` decides per call
  (`classifyAction` / `classifyPath` / `classifyAppleScript` / `classifyUrl`):
  run, confirm (the `ConfirmationState` handshake), or refuse (the never list
  and the secret stores: `~/.hormes/env`, `~/.ssh`, keychains, cookies,
  `.env*`). Add a gate there with a table-driven case in `policy.test.ts`; never
  special-case a tool in the runner. The shell gate is lexical and fails closed:
  strip wrappers (`command`, `exec`, `env`, `sudo`, `then`), read inner shells
  (`bash -c`, `eval`) and one-liner scripts, normalise paths (`~`, `$HOME`,
  `/Users/x`, `/./`, `//`, and `/private/var` ≡ `/var`), and refuse anything
  that *sweeps* a folder holding a secret (a glob in it, a `cd` into it, a
  recursive reader or archiver naming it) whether or not the secret's name
  appears. Egress (a network client carrying a file, `$(…)`, a body or a pipe)
  and environment dumps (`env`, `set`, `ps -E`, `launchctl getenv`, or a one-liner
  that reads `process.env` or `os.environ` whole) confirm.
- **Local brain: read, chat, embed, never pull.** The daemon's requests to a
  local model server (Ollama, LM Studio, llama.cpp) are exactly: `GET /api/version`,
  `GET /api/tags`, `POST /api/show`, `GET /api/ps`, `GET /v1/models`,
  `POST /api/chat`, `POST /api/generate` (body has `keep_alive` and no `prompt`),
  `POST /api/embed`, `POST /v1/chat/completions`, `POST /v1/embeddings`,
  `GET /api/v0/models`, `GET /health`, `GET /props`. Any other path fails the
  `never-writes` test in `packages/brain`. Never `/api/pull`, `/api/create`,
  `/api/delete`, `brew`, `ollama launch`, or starting a server. The row prints the
  command; User runs it (`ProblemRemedy.copy` is text a surface offers to copy,
  never something it executes). The brain itself meets the same gate: in
  `classifyAction`'s destructive-shell table `ollama (pull|rm|create|push|cp|run|launch)` and
  `lms (get|import|rm)` are `confirm`: the model must pass the confirmation
  handshake before it fetches or deletes weights. `auto` never resolves to `local`;
  User picks it. Everything Ollama-side is pinned by fake-server tests, since no
  Ollama is installed on this Mac; see `docs/LOCAL.md`.
- **"User named it" means User's words.** Every gate that asks whether he
  named a folder, a host, a rail or said "apply anyway" reads
  `BrainTask.request` + `BrainTask.userDialogue` (his utterances, filled by the
  `Delegator` from `transcript.since(…, "user")`), never `dialogue`, which
  carries Hormes's own lines. Do not pass the rendered dialogue to a gate.
- **Judge the real path.** `classifyPath` takes `realPath` (the runner computes
  it with `realPathOf`, parent-resolved for files that do not exist yet) and
  checks both spellings; `listTree` / `walkSearch` use `lstat` and never follow
  links; `run_shell` refuses a `cwd` inside a secret store or one of the folders
  that hold one. The running checkout (`REPO_ROOT`) is not a scratch folder:
  writes into it by file tool, shell or `agent_start` confirm with "self_edit is
  the way".
- **Hormes edits itself only through the self-edit loop** (`packages/brain/src/
  selfedit.ts`): a worktree under `~/.hormes/worktrees`,
  a coding agent, `pnpm run typecheck && pnpm test`, a spoken summary, User's
  yes to "apply the change to Hormes and restart it?", fast-forward into main,
  `engine.requestRestart`. The rails are files as a whole (policy.ts, core's
  index.ts and any new core module, brain.ts, instructions.ts,
  `apps/mac/.../Wake`, selfedit.ts, runner.ts, shell.ts, files.ts, brain's
  index.ts, the automations executor `packages/engine/src/automations/executor.ts`
  (the one place that acts with nobody there, so it never asks, never wakes,
  never deletes), and the notification category
  `apps/mac/.../System/Notifications.swift`, whose two buttons are the island's
  Snooze · Done and never a yes) or, for mostly-ordinary files, changed lines (the
  handshake in toolset.ts, build-mac signing, `permission()` in claude.ts, the
  Codex sandbox flags, `SECRET_KEYS`); a touched rail applies only when User's own words name
  it by whole word or file name. Do not add a hunk-narrowed rail for a
  security-critical file: hunk regexes are dodged by editing the lines around
  them. Bump `SYSTEM_PROMPT_VERSION` when the standing orders change;
  `brain.test.ts` pins the prompt's order, budget (1250 words, v3.5: the automations
  pass moved it from 1100, the name pass reworded the orders without pronouns, and v3.5
  fits the orders to each brain's tool table, 1225 words for the full table; the voice's
  orders are 1449 words under a 1450-word ceiling, `instructions.test.ts`) and tool names.
  The memory pass touched one rail by one optional field (`BrainTask.memory?:
  string` in `brain.ts`, no prompt text, no version bump) because User asked for
  the memory module by name; `# Language` lives in the engine-assembled
  `packages/live/src/language.ts`, not in `instructions.ts`, so no other rail moved.
- **Secrets never enter a child, and never leave a result.** `scrubbedEnv` /
  `codexEnv` strip `SECRET_KEYS` from every process the brain spawns (shell,
  AppleScript, Codex, Claude Code); `loginShellCommand` unsets them again inside
  `zsh -lc`, because `~/.zprofile` re-exports them; the policy refuses commands
  that name the secret stores or a secret-named variable; and `SecretRedactor`
  (`shell.ts`) strikes every known secret value (env keys, everything in the state
  dir's env file, `~/.hormes/env` by default, their base64) and every key-shaped
  string from every text result before a model reads it. A brain's own built-in
  tools are switched off. The Claude Code brain runs with `tools: []`, denies its
  built-ins by name (`Read`, `Glob`, `Grep`, `LS`, `WebFetch`, `WebSearch`, `Edit`,
  `Write`, `MultiEdit`, `NotebookEdit`, `Bash`, `Task`, `Agent`, `Skill`,
  `ToolSearch`) and loads no settings sources. Codex runs with `features.shell_tool`,
  `view_image` and `apps` off and its hosted `web_search` set to `"disabled"`. Codex
  0.159.2 reads those three features back false (`codex features list`, no turn). Its
  tool list is rendered only by the opt-in `HORMES_CODEX_TOOLS_CHECK` turn, which has
  not been run, so it is unproven that Codex offers none of them (RAIL-4 waits on that
  run). A Codex that runs its own command anyway has its turn stopped and its thread
  retired once the command has started (`codex.ts`, `ownShell`). Each brain is told
  only the tools it can call.

## Commands

```bash
pnpm run doctor · pnpm run typecheck · pnpm test · pnpm run check
pnpm build:mac                # builds, signs, installs /Applications/Hormes.app IN PLACE (rsync; the bundle directory and its inode never change); build/Hormes.app is a symlink to it. HORMES_INSTALL_HYGIENE=0 skips the Dock/LaunchServices audit, =fix also repairs the Dock
pnpm hormes dock [--fix]     # one Hormes: Dock tiles + LaunchServices records for /Applications/Hormes.app, read-only; --fix drops recent tiles, rebuilds the pin, unregisters stale bundle paths, restarts the Dock only on a change
pnpm hormesd                 # engine daemon alone; HORMES_AUTO_WAKE=0 keeps it quiet
pnpm hormes status | say "…" | probe "…" | agents | hands | live | doctor | cmd go|pause|resume|stop|interrupt|sleep [cause]|mute|unmute|agent.refresh|request-permission <kind|all>|thread.stop|thread.pause|thread.resume   # thread.* take <id|name>; request-permission puts up the system prompt for one grant (the doctor names it)
pnpm hormes ledger --speed [--days N] | reflex-miss [--days N]   # where the time went (acting→screenshot share, now: lines, round trips by class, generation gaps; a negative interval is left out and counted); the short commands the grammar missed
pnpm hormes memory [list] [--state live|forgotten|archived|merged|all] | search "…" | forget <id> | restore <id> | add "…" [--kind k] | run   # over the daemon; forget is a state, nothing is deleted
pnpm hormes automations [list] [--state s] | add "<when> <chime|say|notify|open> <what>" | snooze|done|skip|pause|resume|run|trash|restore <id|name> | rename <id|name> "<name>"   # over the daemon; add arms the free kinds only (no flag is a yes); trash is Move to Trash, nothing is deleted
pnpm hormes recipes [list] | add <name> "<cmd>" [--cwd D] [--timeout N] | trash <name> | restore <name>   # the approved shell recipes; add prints the shell gate's word first (run · asks · refused · fronts); trash is Move to Trash (trashedAt), restore undoes it; nothing is deleted
pnpm hormes bench [--fake-hands] [--no-duck] # the tool path and the ear's 250 ms path (+ read during a type, acting call incl. observation, status reflex, targeted stop); exit 1 when p95 to dispatch > 250 ms with the real helper; spends nothing (no OpenAI request); --no-duck skips the Swift duck probe
pnpm hormes bench --brain [--runs N] [--effort low] [--observe off] [--compare F] [--no-reflex] [--json --out F] # the five representative commands on the real brain (Codex: User's ChatGPT plan, no dollars; canned hands, no real actions); refuses when Codex is not signed in unless --allow-api-spend
pnpm build:hands              # Swift helper → build/hormes-hands
apps/mac/Scripts/console-preview.sh [scenario] [out.png]   # Console with fake data; activity | library | tasks | education | settings | waveform | waveform-open | notch
apps/mac/Scripts/duck-probe.sh              # the echo guard's machine + the start ladder (V4 check lines, no TCC), then the barge-in duck rounds
apps/mac/Scripts/audio-probe.sh [--json|--test] # AUDIO_PROBE_MODE=aec|recording|asleep|private: the graph's state read back, no session (its own .app for the mic grant; AUDIO_PROBE_DIRECT=1 borrows the terminal's); --test plays a chime ONLY with AUDIO_PROBE_PLAY=1
apps/mac/Scripts/recorder-probe.sh · duck-leak-probe.sh   # V3 recorders beside the graph · V2 other apps' level under the unit; both PLAY SOUND, only with AUDIO_PROBE_PLAY=1, never while Hormes.app is awake
apps/mac/Scripts/playout-probe.sh [--stall [--legacy]] · snapshot-probe.sh   # the playout cushion rendered offline (--stall: the play queue beside the real AudioStateReader) · the app's receive path against a fake daemon; no device, no window, no sound
apps/mac/Scripts/wake-gate-check.sh · sweep-check.sh · hotkey-check.sh · w3-3-check.sh · single-instance-check.sh   # headless: the wake gate (WG-12) · Ask for everything parks (APP-7) · every hotkey but Go / Pause types nothing (D3, D8) · version skew, saved reads and typed delivery (W3-3) · one Hormes per state dir
apps/mac/Scripts/earcon-check.sh [--bundle build/stage/Hormes.app]   # headless and silent: the palette's gate, cues, wire hold and echo rule through a recorder, then every sound file opened and decoded (never played)
packages/hands/native/harness/hands-win/check.sh · run-blocking/check.sh   # User's hands win, decided with no event posted · the 5 s capture bound; both run under pnpm test
node --import tsx scripts/live-check.mts list | <LC-n|name> --dry-run | <LC-n|name> --i-accept-spend --cap-usd 1.00   # the paid GPT-Live-1 checks LC-1..LC-10, each run on User's yes; one $1.00 cap per day across checks, kept in <stateDir>/live-check/spend.ndjson (live.lock: one live check at a time); reports in build/live-check/<day>/; scripts/rejudge.mts <report.json> judges a saved report again for free
```

Test launches of anything that opens a voice session must set
`HORMES_AUTO_WAKE=0` unless User asked to talk to it: an open session listens
to his microphone and bills per second.

## Reference (read on demand, not every session)

- `docs/agents/learnings.md`: things that cost real time to learn, with the dated pass
  learnings (Codex app-server, GPT-Live-1, hands, lease, desk, threads, memory, sleep,
  notch, Console kit, install). Grep it for the subsystem before changing that subsystem.
- `docs/agents/audio.md`: the Mac audio graph's record (policy, ladder, probes, playback,
  telemetry, sounds, rails). Read it before touching `apps/mac/Sources/Hormes/Audio/`.
- `docs/HORMES_PRD.md`, `docs/AUDIO.md`, `docs/LATENCY.md`, `docs/LOCAL.md`,
  `docs/AUTOMATIONS.md`, `docs/GEMINI_VOICE.md`: product and subsystem docs.

## Windows (`apps/windows`, branch `windows`)

C#/.NET 10 WPF app over the same hormesd, on a named pipe (`ipcPath` in
`packages/core/src/ipc.ts`). `apps/windows/README.md` is the guide. Build and check:
`dotnet build apps/windows/Hormes.Windows` · `dotnet run --project apps/windows/Checks`
(clap, endpointer, sounds; `--render <dir>` draws the Console to PNGs; `--whisper` runs
the model). Clone with `-c core.longpaths=true`; pnpm comes from `npm i -g pnpm@10`
(corepack hits EPERM). Defender flags `scripts/__tests__/hermetic.test.ts`: leave it out
of Windows runs. The suite's Windows baseline at 061aec6 is 2064 pass / 148 fail (the
failures are macOS-only); compare failing test names against it, not the count alone.
Never print the stits `DATABASE_URL`; test stits writes only inside a rolled-back
transaction.

## Subagents (`.claude/agents`)

Pick the cheapest model that can do the job; a subagent's file reads and test output
stay in its own context and only its summary comes back.

- `explorer` (Haiku, read-only): where is X, who calls Y, which files a change touches.
- `test-runner` (Haiku): runs tests or the Windows checks, reports only failures.
- `implementer` (Sonnet): builds a well-specified change; give it paths, the goal and
  what done means. Run parallel ones with worktree isolation.
- `reviewer` (Opus, read-only): reviews a diff for correctness and the rules above.

## Installation permission flow (2026-10-11)

The first-run wizard is removed. `PermissionInstallation` records an attempted sweep, never granted permission. First launch and `--install-permissions` request through `PermissionsCenter`; macOS dialogs/toggles remain user-owned. No TCC bypass, no automatic approval, no fabricated granted state. Ordinary subsequent launches only read grants. Console Settings owns credentials/models/wake, and Console/menu Permissions owns retries, Skip and Stop. Closing Console or reaching the 90-second watch span parks a waiting sweep. Test launches set `HORMES_NO_AUDIO=1` to disable installation prompts, and `HORMES_AUTO_WAKE=0` to keep voice sessions closed.
