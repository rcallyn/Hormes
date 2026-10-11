# Gemini voice for Hormes

Implemented 2026-10-11. Voice and reasoning are separate configuration choices.
Gemini Live speaks and listens through Hormes's native audio graph. The existing
OpenAI-compatible or local brain reasons and runs policy-gated tools. Local Qwen
remains selectable; no model weights or local server are installed by this update.

## Configuration

Fresh configurations default to Gemini Live (`voiceProvider: "gemini"`), using
`gemini-3.8-live` and voice `Kore`. Gemini remains the default for normal voice and
tutoring. Console > Settings > Audio retains OpenAI Live as an explicitly selected
alternative; an unavailable Gemini session does not silently switch providers.
Existing explicit provider settings are preserved. This default change does not
rewrite the running app's configuration.

Other exposed Gemini voices are Aoede, Puck, Charon and Zephyr. A voice/provider
change is used on the next explicit voice start; Switch now is available when an
idle session is open.

Settings > Brain retains the existing provider choices, including Local. Selecting
local Qwen changes reasoning, not the Gemini voice transport. The recorded live
synthetic verification below used the OpenAI-compatible brain with `gpt-4.1`.
OpenAI-hosted Responses delegation requires the OpenAI voice transport; Gemini
needs a client brain. A selected local model that cannot start may leave voice
unavailable until the client brain is restored. The app reports that condition.
It does not silently change voice providers.

`GEMINI_API_KEY` lives only in `~/.hormes/env`, written by `config.set-secrets`
through Setup or Console. Presence and probe status are exposed, never the key.
It belongs to the shared secret-key list: child environments remove it, text
results redact it and its base64 form, and the test preload removes it. The
WebSocket authenticates with a header, keeping the key out of URLs.

## Transport contract

`GeminiSession` implements the same `VoiceSession` contract as `LiveSession`.
PCM16 mono input declares the native 24 kHz rate; Gemini resamples it. Output is
24 kHz PCM16. Binary JSON frames, combined transcripts and multiple audio parts
are decoded. Interruption flushes queued native speech. Transcript boundaries
settle speech for the application's existing answer checker.

The sole model function is nonblocking `delegate`. Its immediate response means
queued, not completed. `scheduling: SILENT` is a FunctionResponse field, outside the model-readable response object. During a lesson, speech after a queued delegation is held until an application result arrives; a queued call cannot speak completion. Function arguments are not accepted as user requests or
student attempts; the backend uses actual recorded user transcripts. Tool results
return through the existing Delegator. Cancellation applies only to the matching
owned call. Gemini has no direct shell, browser, drawing or completion capability.

Silent progress stays on the application ledger. Backend commentary or an
explicit application instruction may request speech. Normal silence while the
student works does not trigger the GPT transport's continuous-frame watchdog.
Closing clears the socket, queued input and timers. The native session display
shows elapsed time, not a Gemini invoice or dollar estimate.

## Verification and limits

The real Gemini endpoint has returned native audio and the exact test opening,
with no microphone capture or speaker playback in that transport check. Bounded
checks also accepted prerecorded synthetic speech at declared 16 kHz and 24 kHz,
returned its transcript, and queued a real model delegation. The selected Kore
voice passed the native-rate input check. These checks executed no tools and
recorded no student evidence. Unit coverage includes
setup, buffering, mute, binary frames, transcript boundaries, interruption,
queued acknowledgments, duplicate/cancelled calls, timeout and credential
redaction. Engine tests preserve the separate local brain choice and quiet waits.

The live synthetic end-to-end check also passes: Kore introduces the actual
handwritten problem, Aoede speaks an incorrect answer, the application rejects it,
Aoede requests help, the real gpt-4.1 brain queues a handwritten budget hint, the
production Scholar/Excalidraw renderer saves it and acknowledges application, and
Aoede's correct spoken retry is recorded as assisted. Kore's spoken confirmation
finishes before shutdown. Reopening SQLite restores the same board revision,
evidence and course folder; the synthetic session cannot complete a mastery goal.

The bounded test used a continuous PCM silence stream between synthetic student
turns, matching the native graph's streaming contract. Stopping the input stream
between clips is not an equivalent microphone test. The test bridge was loopback
only and served the actual production workspace; it did not forge drawing acks.
No physical microphone, speakers or native notch were involved in this check.
A native human conversation and an uninterrupted day rehearsal remain required
before recording the final video. One short redundant board announcement remained
in the last live take; the core result was correct but delivery can improve.
Local Qwen teaching quality and local speech remain separate evaluation tasks.

Official API references:

- [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api)
- [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Live function calls](https://ai.google.dev/gemini-api/docs/live-api/tools)
- [WebSocket schema](https://ai.google.dev/api/live)

The wire placement follows the [FunctionResponse JSON schema](https://ai.google.dev/api/generate-content#FunctionResponse).
