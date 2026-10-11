# Hormes

Hormes is a calendar-aware, voice-first workspace for learning and getting work done on a Mac. It carries goals, evidence, notes, and unfinished actions between sessions.

The notch is the interaction surface. A lecture caption, recall card, quiz, handwritten whiteboard, or timer drops from it as needed. The floating presence and app icon use the same five white voice bars on black. Console stores work by course, date, and session type, alongside a unified Agents rail.

## Run locally

Requires Apple silicon, macOS 14+, Swift, Node 24+, and pnpm 10.

```sh
pnpm install
pnpm run doctor
pnpm run check
pnpm build:hands
pnpm build:mac
open -a Hormes
```

The signed app installs at `/Applications/Hormes.app`. Settings and credentials live under `~/.hormes`; only the private `env` file stores keys. No checkout `.env` is loaded. Console shows credential presence and probe results, never secret values.

GPT provides initial reasoning; Gemini provides realtime tutoring and lecture transcription. A local OpenAI-compatible Qwen endpoint remains configurable. Model weights are never downloaded automatically.

## Work that persists

- Lecture speech is saved separately from generated notes and takeaways.
- Four-question class reviews and quizzes record actual submitted answers.
- Tutor sessions use the Scholar whiteboard and native voice; assisted, independent, and delayed-recall attempts stay distinguishable.
- Spoken recall cards reveal after an answer or “I forgot”; timers and breaks stay in the notch.
- Coding and browser work retain receipts. A model's completion claim is not proof of success.

Calendar suggestions are opt-in. Recording requires an explicit session. The rehearsal calendar is hypothetical and labeled as such.

## Execution and verification

Every brain uses `ToolRunner` and the centralized policy. Shell execution uses OS-enforced isolation. Sensitive actions require device-owner authentication. Credentials are scrubbed from child environments and tool output. See the [execution rules](AGENTS.md#rules) and [product architecture](docs/HORMES_PRD.md).

```sh
pnpm hormes status
pnpm hormesd
pnpm run typecheck
pnpm test
pnpm --filter @hormes/workspace build
```

The native app and daemon use protocol version 4. Rebuild both after updating. Renaming the macOS bundle identity may require granting microphone, screen, calendar, and other permissions again.

Hormes is licensed under [MIT](LICENSE).

**Uses the Mac.** It carries out actions in other applications. The hands are AX-first: find a control by label, read the focused text, click the element. Screenshots provide visual context and verification as needed.

### Hotkeys

`⌥⇧Space` is go / pause. On the US layout it is the one hotkey that types a character, a no-break space
(U+00A0). While Hormes runs that combo never reaches a field; `⌥Space` still types one.
`apps/mac/Scripts/HotkeyCheckMain.swift` allows this one combo.

## License

See LICENSE for the required MIT notice.

Installation asks for permissions through native macOS dialogs and System Settings toggles. There is no separate setup window. You approve the grants; Hormes verifies them and can resume missing permissions from Console or its menu bar. Model and voice configuration stay in Console Settings.
