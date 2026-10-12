# Audio: the record

Moved out of AGENTS.md (2026-10-12) so it is read only when the work touches the Mac audio graph. `docs/AUDIO.md` is the reader's version; this is the record.


The audio graph (`apps/mac/Sources/Hormes/Audio/`) is read back, never assumed: every claim ends
in a state a probe prints. `docs/AUDIO.md` is the reader's version; this is the record.

- **One setting**: `settings.audio.recording` (default off), nested like `wake`, merged at load,
  written only by `set-settings` (the Console toggle, the status menu row, ⌃⌥R all send that).
  The ducking level is a constant (`VoiceProcessingPolicy.duckLevel = 10`, `.min`), not a knob.
- **The policy** (`VoiceProcessingPolicy`): `aec` = the unit on, told `duck min advanced, agc on,
  bypass off` inside the same `objcTry` that switches it on, released (`setVoiceProcessingEnabled(false)`)
  at every stop and teardown, following the system default input; `recording` = no unit, the ranked
  microphone, the software echo guard (`EchoGuard`/`EchoGuardModel`: hold the wire while Hormes is
  audible + tail, zero-fill not drop, +12 dB × 120 ms breaks through after 2 s of learning).
- **The ladder** `startLocked` walks (`VoiceProcessingPolicy.attempts`; `winningRung` remembered,
  reset by `setPolicy`, `setPreferredInputDevice` and a failed walk):

  | policy | rung | voice processing | mainMixer → output | notes |
  |---|---|---|---|---|
  | aec | 1 | on | automatic | refused −10875 on this Mac |
  | aec | 2 | on | input-rate | the one that comes up here |
  | aec | 3 | on | hardware | |
  | aec | 4 | off | hardware | the fallback, ranked mic pinned (`pinDevice`): guard armed, `fallback` in the frame, the doctor fails `voice processing` |
  | aec | 5 | off | hardware | the fallback on the system default mic (the pin refused) |
  | recording | 1 | off | hardware | ranked mic pinned; guard on; the one that comes up here |
  | recording | 2 | off | automatic | ranked mic pinned |
  | recording | 3 | off | hardware | no device set: the system default mic, `ranked mic refused; hearing the system default` |

  (`PrivateRoute.enabled` would add two `private` rungs at the top; it is `false`, probe-only.)
  `StartAttempt.pinDevice` is the plain path's `kAudioOutputUnitProperty_CurrentDevice` set, and it
  is skipped outright when the ranked mic already *is* the system default: on a Mac whose default
  input ≠ default output the engine's I/O is one unit on its own aggregate and the set knocks the
  output side out (−10875 on every wiring). A pinned rung whose set fails throws and the ladder moves
  on. `hears` on the plain path is `activeInputUID` (the AU's `CurrentDevice` reads as the engine's
  `CADefaultDeviceAggregate-<pid>-n` there); `aggregatePresent` in the frame is the **unit's**
  `VPAUAggregateAudioDevice-*` (the Swift read-back also carries `engineAggregatePresent`, a fact, not
  on the wire).
- **The four surfaces** read one frame (`AudioStateReadback` → the `audio-state` wire frame →
  `Snapshot.audioState`): Settings › Audio (`SettingsWords.hears` / `.speaks` / `.recordingRow` with
  the `shares the mic` hint, `recordingOn` while on, `sharedWith(_:)` when another process reads the
  mic; the head's `[recording]` badge is `ConsoleDisclosureWords.recording`), the island (`RecordingWords`
  in `UI/HelpCopy.swift`: the mute box at 0.48 while the guard holds, the 2 × 2 dot, the `record.circle`
  chip while tucked, fed by the `hormes.dock.audio` notice (`NotchDock.audioNotification`, userInfo
  `recording` · `guardHeld` · `shared`); no new zone, no gesture), the status menu row + ⌃⌥R
  (`HelpCopy.recordingRow`: `Recording` · `Hand back the mic, guard the echo, so apps keep their sound` ·
  `Hotkeys.Action.toggleRecording = 9`; the title never flips, the checkmark is the state), `pnpm
  hormes status` / `doctor` (group `audio`, `--test-audio`). The cost fuse lives in `AppState`
  (`echoTurns`, `echoFuseTurns = 3`, toast `AppState.heardHimself`): three turns of Hormes's own
  sentence while `guardOn` send `.mute` and nothing else.
- **The probes** (`apps/mac/Scripts/`): `duck-probe.sh` (V4, no TCC) · `audio-probe.sh` (V1, its own
  `AudioProbe.app`; modes `aec|recording|asleep|private`; `--test` is what the doctor shells to; the
  record in `~/.hormes/audio-probe.json` by mode) · `recorder-probe.sh` (V3) · `duck-leak-probe.sh`
  (V2, macOS 14.2 process tap) · `playout-probe.sh` (the playout cushion, offline render; `--stall`
  the play queue beside the real `AudioStateReader`) · `snapshot-probe.sh` (the app's receive path
  against a fake daemon). Anything that plays sound needs `AUDIO_PROBE_PLAY=1` and otherwise
  prints its plan (recorder/duck-leak exit 0; `audio-probe.sh --test` prints `{"dryRun":true}` and its
  exit still carries the mode's V1 checks). None connects to the daemon; none opens a session.
- **Playback** (`Audio/Playout.swift`, `BargeInDuck.swift`; docs/AUDIO.md §9): 120 ms of silence
  before the first chunk after a reset (start, flush, restart, dry ≥ 0.5 s); an underrun plays at
  once behind a 5 ms fade-in and raises later resets' target to the longest gap + 40 ms, at most
  200 ms; `wouldBeUnderruns` is the no-cushion count on the same timeline. The HAL reads run on
  `hormes.audio.state`, never on the play queue (stale-marked, else every 30 s). Only the energy
  gate starts a duck: −6 dB unconfirmed, −20 dB on confirmation (the ear's words or Live's
  transcript of User); unconfirmed, it comes back at 700 ms on a quiet mic, 1.5 s at most.
- **Telemetry**: the `audio-state` frame carries `playout`, `duck` and `output` (optional;
  `lateMaxMs` and `queuedMinMs` per window since the last frame, `lateMaxGraphMs` since the graph
  started); `snapshot.liveAudio` while a session is open (delta size, arrival p99/max, ahead,
  gated frames, the loop's max delay less its 10 ms resolution, the echoed rate); one `audio:`
  line in daemon.log at most every 5 s while it changes (`AUDIO_LINE_EVERY_MS`) and a summary at
  close; one `audio.playout` ledger row at session close. `status` prints `playout`, `duck`,
  `output`, `live`, or the ledger's `last session` block with no app; the doctor adds five
  advisory rows (`playout`, `duck`, `residual echo`, `output level`, `live arrival`). A frame's
  malformed telemetry object is shed and the rest passes (`noteShed`, one debug line a minute).
- **The snapshot path**: past `SNAPSHOT_BACKLOG_BYTES` (64 KB) of a client's socket backlog the
  daemon keeps that client one pending snapshot (the newest) and writes it on drain; speaker
  frames and every other frame keep their order. `EngineClient` decodes snapshots off `net`, one
  decode running and one payload (the newest) waiting, so a speaker frame never waits on a decode.
- **The sounds** (`Audio/Earcons.swift`, `App/EarconCues.swift`; docs/AUDIO.md §10): twelve CAFs in
  `apps/mac/Resources/Sounds` (staged by build-mac before signing), one `AVAudioPlayer` each on the
  default output, never the voice's engine, never `NSSound`. The one gate is `Earcons.play`: nothing while
  `AppState.voiceAudioRuns` (connecting included), a wait for the voice's playout to drain
  (`VoiceOutputClock`, dropped past 2 s), one at a time by priority (a higher sound fades a lower one
  started under 250 ms before it), the same sound once per 1.5 s. `awake` is the one session-edge sound: it
  plays before `updateAudioActivity()` starts the graph and `handleMic` zero-fills the wire until
  `EarconWire.holdUntil` (status: `awake held`). Every edge into a mic phase calls `Earcons.enterVoice()`
  first: the rest fades over 50 ms and the wire is held through it; `EarconWire.cut` never shortens a
  hold. `onLocalSay` holds a frame that lands while connecting (`EarconCues.LocalSayHold`), and the
  engine holds a fire's lines for the opening session (`opening` / `holdForSession`, `releaseHeldFires`).
  WakeGate still names `Pop`/`Glass`; `LocalSpeaker.earcon` maps them (`Earcon.gate`). On `local.say`,
  `ring` (the row's kind, `ringOf`) makes a ring and `sound` only picks the file (`Earcon.named`;
  `Ring.of` reads the name when an older daemon sends no `ring`). The alarm ignores Volume (floor 0.67,
  Hero's −19.5 LUFS, after its ramp). `settings.audio.sounds` (absent = macOS's interface-sounds switch)
  and `soundVolume` (0.7) go through `audioSettingsOf`, which keeps only typed fields; rings sound with
  Sounds off. New moments go in `EarconCues` with a check line, never inside a session.
- **Rails**: `Wake/WakeGate.swift` is never touched; the wake listener gets exactly one property set
  on its own input AU (`kAudioOutputUnitProperty_CurrentDevice` → the ranked mic, `hears <name>
  (ranked)`); the barge-in duck stays detached on the plain path (it would duck Hormes against
  himself); `set-settings` is the only writer of settings; the ledger is append-only (`audio.guard`
  and `audio.playout` rows); taps are `format: nil`; every raising AVFAudio call sits in `objcTry`; nothing paid, ever,
  from a probe.

