# Hormes product build

Updated 2026-10-11. This records implemented behavior and verification limits. The
PRD defines the full P0 release; a finished 90-second video is still outstanding.

## Current shared-checkout verification limit

Separate user-owned chats are concurrently changing native wake, Console and Education sources. The latest whole-project check finished **2,287 total: 2,283 passed, 2 failed, 2 skipped**. TypeScript passed; doctor did not run after the test failure. One native wake build collided on `.build/wake-gate-check/ObjCTry.o`; one docs contract references the now-removed `AutomationsRail.swift`. No Tasks/grocery assertion failed. Log: `/private/tmp/hormes-grocery-lane-final-integrated-check.log`. The preceding navigation baseline passed 2,283 tests with two skipped and doctor 51 OK / 12 warnings / 0 failures. Older full checks below retain their recorded scope, not current whole-checkout approval. Current Tasks/grocery source verification passed **67/67** across ten focused files, plus full TypeScript. Logs: `/private/tmp/hormes-tasks-grocery-final-scoped.log` and `/private/tmp/hormes-tasks-grocery-final-types.log`. Tests use controlled native/browser transports; actual cart preparation remains incomplete pending a controlled installed retry. Other owners continue independently.

## Selected-note Tasks Inbox: installed acceptance passed

PRD 1.6 adds a durable Console Tasks Inbox with original selected-note task text and source revision, separate suggestions, explicit linked-work start, and pending/in-progress/user-reported-done states. A mixed to-do list cannot become grocery products; an itemized source is required. Backend/protocol and native UI are implemented. The earlier frozen Tasks source passed its 2,275-test check (2,273 passed, two skipped, zero failed), including five coordinator integration scenarios and six engine lifecycle cases. The final native presentation harness passed 17 checks. The 20.7 MiB release installed in place with strict/deep verification, preserving inode 22405057 (two files replaced, none added/removed). Corrected installed CUA acceptance passed: a real selected synthetic Apple Note yields four current tasks; latest source disclosure has exact lines and no metadata; explicit Buy groceries → Start work opens the notch with zero products and a separate-list requirement; native done/reopen says user-reported; actual app/daemon quit and relaunch retain identical task/source state. Root rechecked the original Note unchanged. The first import’s extra desktop-observation row remains superseded in history, so storage has five historical records while the current UI has four. Optional voice import was not run. No cart preparation, purchase or physical ASR/clap proof is implied. Receipts: `hormes-tasks-installed-acceptance.json`, `hormes-tasks-final-install.json`; install log: `/private/tmp/hormes-tasks-final-install.log`. Use the existing tools/workflows; no new plugin framework is part of this change.

## Current continuation: Calendar, groceries, Education and Gemini

PRD 1.5 replaces the required travel demo beat with selected-note grocery cart
preparation; optional travel capability remains. The earlier Tasks all-source
`pnpm check` passed **2,275 tests total: 2,273 passed, 2 skipped, 0 failed**.
TypeScript passed; doctor reported **43 OK, 12 warnings, 0 failures** while the app/daemon were stopped for coordinated restart. Current app permission/audio read-back was unavailable.
Log: `/private/tmp/hormes-tasks-final-integrated-check-2.log`.
A subsequent doctor with the installed app/daemon running passed **55 OK, 8 warnings, 0 failures**; no live voice session or backend task was started. Log: `/private/tmp/hormes-tasks-installed-doctor.log`.
The earlier Calendar/grocery release stage built, was Apple Development signed and passed strict signature
verification; log: `/private/tmp/hormes-calendar-grocery-native-release.log`.
That earlier release subsequently installed in place with strict/deep signature
verification, preserving inode 22405057 (five files replaced, none added/removed).
The workspace was rebuilt for install, including the final grocery scrolling fix.
The app relaunched asleep with its wake-word listener; this is not clap proof.
Log: `/private/tmp/hormes-installed-calendar-grocery-release.log`.

Before the final combined suite, the selected-Notes policy passed **35/35** focused
checks and full TypeScript. A final one-line `GroceryTool` scrolling correction
rebuilt the workspace and passed **7/7** real bundled-renderer checks at the native
560 × 490 size. The signed stage preceded that CSS correction; the coordinated
install rebuild includes the refreshed bundle. Focused totals overlap and are
not added to the integrated project total.

### Fresh Calendar questions and checked Gemini speech

General Calendar questions now use `read_calendar`: a fresh typed EventKit read
through the daemon's correlated native bridge. Existing permission is reused;
only undetermined permission requests access. Date ranges are bounded, local-day
queries respect DST, and failures/truncation remain explicit. An explicit question
can query permitted calendars without changing the user's proactive selections.
The proactive reader remains restricted to saved selected IDs and explicit links.
Application-owned parsing now derives relative dates from the latest user request and checks the native query range; a model-invented historical date cannot satisfy “today.” The older wrong-date live failure remains in `hormes-calendar-wrong-date-historical.json` with private event wording redacted.

After the explicit Gemini completion handoff, two consecutive installed schedule-only runs passed: actual October 11 local-day EventKit reads returned six calendars and zero events, and final English answers arrived at 7.538 s and 7.956 s. Gemini emitted 165,120 and 165,122 PCM bytes; both runs stayed quiet for three seconds. Input was typed production `say-text` after Go; no physical microphone PCM was supplied. `hormes-general-mode-final-verification.json` preserves exact sanitized tool sequences, including the ordinary context screenshot receipt, without pixels/calendar names/event lists. Earlier definition output was explicitly requested by the harness. A populated event, proactive offer, physical ASR and clap remain unverified.

Voice defaults to General. Explicit **Begin voice** enters Sage/Education; fold/pause or sleep clears the binding and keeps saved work. Capture stays silent. Backend completion uses an explicit completed Gemini client turn, with a visible General error after 15 seconds without audio. The final focused completion suite passed 57/57 and the final combined check includes the mode transition/isolation coverage. The preceding zero-audio receipt remains historical; two observed passes do not guarantee provider reliability.

English framing is present in initial Gemini instructions, history and backend
results. Application-checked numeric feedback has a turn-bound output gate that
waits for the check and discards stale provider audio. The earlier synthetic live
English probe retained English but failed because Gemini announced correctness
before the delayed application result. That historical failure remains in
`hormes-english-live-verification.md`; fresh passing regressions do not turn it
into a passed live run. The installed Calendar run verifies observed English
responses, but does not repeat the delayed checked-tutor-feedback scenario; that
replacement live tutor check is still pending.

### Grocery preparation without purchase

The new compact tool imports only the selected unlocked Apple Note, or an
explicitly pasted list, and retains its identity, revision and exact original
requests. The assistant's execution checklist is separate. Browser observations
supply item states and final cart review; an Add button alone is not cart evidence.
Login/store/address blockers remain visible and can be retried without replacing
the list. The production browser gate permits bounded cart preparation and refuses
checkout/purchase and unsupported script/API/keyboard/desktop bypasses. Completion
is a pending human cart review, never an order or a completed grocery goal.

The actual bundled renderer passed seven checks using a fenced synthetic
milk/eggs/bananas fixture: initial action, preserved list/plan, blocked retry,
receipt-backed review link, link dispatch, recheck and fold. Real wheel scrolling
makes both the expanded checklist and review controls reachable at 560 × 490.
Outputs: `hormes-grocery-ui-proof.json` and `hormes-grocery-ui-proof.png`.
The renderer fixture used no real Notes, account, Instacart, microphone, model or purchase. Separately, the installed app imported the selected public milk/eggs/bananas demo note from real Apple Notes. Fresh DOM preflight reports disabled Chrome JavaScript explicitly, and only an explicit grocery task may trigger Notes/browser work; saved scope alone cannot. After the user enabled the setting, fresh Chrome DOM access passed. An earlier model returned only the current date; a subsequent corrected-prompt retry stopped at screen ownership. The latest actual Tasks-linked run freshly imported a distinct Milk/Eggs/Bananas Note, read fresh DOM and generated three plan steps. Rapid navigation/readiness blocked further execution: the model read the prior home page, while root later saw banana search products loaded in native Chrome. All three items remain pending. The bounded readiness/read-first preflight fix passed **67/67** combined scoped checks and full TypeScript. Its controlled installed retry is pending; cart → native notch review remains unverified and no purchase is authorized. Receipt: `hormes-task-grocery-live-result.json`.

### Education from saved evidence

Education now opens to the current learning goal, its purpose and a prominent
Continue learning action. Continue resumes the exact saved session and board;
supported practice options retain that goal and course. Up to three relevant
concepts appear below, with a recorded missed check first. Explore concepts groups
topics by subject, with grade labels only in secondary concept details. Other
goals, practice history and rehearsal tools no longer compete with the main action.
Concepts without an automatic exercise offer goal creation for guided learning.
No course-completion percentage or broader mastery is inferred.

The small curated prerequisite map is not school history or an official
curriculum. Independent and assisted counts come only from valid linked student
attempts; real and rehearsal work remain separate, invalidation removes assessment
credit, and unsupported concepts stay unassessed. Application-authored fraction,
ratio and linear-equation checks can return to the preserved economics exercise.
The new native routing/presentation checks pass **26/26**, including saved-session
resume, custom-course isolation, acknowledged first-practice routing and real/demo
separation. The full project check passed **2,283 tests**, with two skipped and no
failures; doctor reported 51 OK, 12 warnings and no failures. Four offscreen layouts
were rendered with isolated sample data through the production Education view,
button styles and native disclosure component. The app host in that harness is a stub;
this is not a live voice or end-to-end practice receipt. The updated source awaits
the concurrent Console cleanup's full native build before installation.

For the earlier stage-led revision, the engine suite passed **23/23** and native
protocol/presentation/routing checks passed **21/21**. Root observed installed
read-only navigation across Grade 5/Middle/High/College/Today, seven unassessed
skills and Fractions with separate zero independent/with-hints counts and no
evidence. No practice was clicked; prerequisite-return interaction and human
mastery were not established. Earlier counts below refer to their named revisions.

### Goal authoring and targeted practice (staged)

Fresh settings now default to Gemini Live, as requested. Existing provider choices
are respected; local Qwen remains a separate reasoning option. OpenAI-specific
fake test and benchmark fixtures declare their transport explicitly. Changing
this default does not authenticate or open a real microphone session.

Console now creates and revises goals with explicit outcomes, success criteria,
course association and optional deadlines. Versioned saves preserve the draft on
conflict; changed criteria reopen the goal without deleting prior evidence.
Custom criteria require user review and cannot inherit automatic Microeconomics
completion. Custom learning goals open an ungraded voice-and-ink board under their
own title; they do not inherit fixed exchange exercises, sources, recall cards or
another goal’s lecture. Existing sessions and earlier evidence remain preserved. Other coding goals can be planned; execution remains bounded to the
existing EvoSim task. Calendar linking uses that same execution rule, preserves
unsaved choices after errors, and sends metadata without interrupting voice.
Starting study from a selected course now keeps that course.

Fresh exchange-economy practice targets a recorded price or allocation error,
retains the supporting attempt IDs, and uses different endowments. An assisted
correction does not retire the target; a later independent success on a genuinely
different exercise can. Withdrawing that success restores the unresolved target.
Selection follows durable record order through clock changes. Income-recall
failures remain in their recall workflow; equilibrium practice does not pretend
to reassess that separate criterion. Demo and real work, courses and goals are
kept separate in both selection and model context. The shared goal's next-step
text is excluded from model context because it can contain a different session's
rehearsal; the active session's next step remains available.

The whiteboard now commits arrow movement through Excalidraw's own undo history.
A version- and source-checked build transform repairs the pinned 0.18.0 keyup
handler; it introduces no separate canvas history. Actual bundled-renderer checks
passed single-step and held-arrow undo/redo, pointer-ink undo/redo, and SQLite
reopen with unchanged evidence. This is a headless DOM check, not native macOS
menu proof; history itself is not persisted between launches.

The real source-image check loaded a permitted HTTPS SVG, handled a broken image
with a visible error, and returned to an unchanged board. Transparent diagrams
now receive a white background so black lines remain legible. The source credit
and inspected screenshot are retained in `hormes-image-undo-probe.json`.

### Calendar intent and source selection

Console’s session-tools popover discovers calendar names and accounts, then lets
the user choose stable calendar IDs. With no selection, the native reader does
not query EventKit events. Selected IDs persist in the engine; the EventKit query
and engine ingestion both filter by them. Calendars with identical titles remain
distinct. Deselecting a calendar removes its cached events and invalidates an
outstanding offer without deleting saved work or the labeled hypothetical day.
No OS calendar event is created or changed by this reader.

“Calendar links” opens an explicit mode/goal/course editor. An event can use an
existing compatible goal, an existing course or a newly named course. Saving a
link does not start work; the user opens the event or accepts a bounded offer.
Removing a link revokes future suggestions. Legacy mode-only links retain their
established defaults. Refresh and recurring events preserve the chosen goal;
class, meeting and travel sessions retain occurrence isolation. Current event
end, mode, opt-in and a calendar read less than two minutes old are checked again
at acceptance, before writing an accepted receipt. Manual class/next-class and
study requests reject missing, incompatible or conflicting goals; valid explicit
study goals are honored. Event titles never authorize or choose a session mode.

Native verification discovered **six calendars** and selected one **Work** calendar;
the selected read returned **zero events**. This proves discovery/selection and
an empty native read, not a real linked-event offer. Root restored the original
empty selection, confirmed in native UI and read-only SQLite (six catalog sources,
selected IDs empty). Calendar app control was unavailable to the UI tool; no alternate
OS-event write route was used. A real accepted-offer rehearsal remains open.

### Evidence correction and other courses

Console’s saved checked attempts offer “Correct this record.” A required reason
excludes every criterion row from that original answer while preserving the words,
original checks, hint history, timestamps and append-only activity. Excluded
answers leave current tutor context and no longer count toward completion; a
completed goal reopens if its required support is withdrawn. The model cannot
perform the correction or replace its reason. An excluded answer cannot erase
assistance or unlock an unsolicited independent-practice hint. Six focused
regressions and the integrated check cover this behavior. The signed native
correction UI compiled and installed; clicking through an actual correction is
still a rehearsal gate.

Other-course learning keeps its explicit goal, course and captured source context.
It opens an editable ungraded board with voice and fold controls rather than
inserting Microeconomics problems. Voice asks what to work on when no supported
exercise exists. No Microeconomics reference grading is applied to that course.
This does not implement arbitrary course assessment or importing all course
materials. Explicit goal authoring and criteria revision are implemented in the
staged build described above; arbitrary goal assessment remains unimplemented.

### Native board continuity

Root drew two native pen strokes in a saved demo session and immediately pressed
Cmd-Q after the second. Both objects persisted, the scene advanced from revision
5 to 7, and the reopened board visibly retained the ink. The installed focus fix
then passed native selection, one-point movement and a new pen stroke after restore.
The original positions were restored before the final save.

The visible Fold control saved and paused the board at **revision 14**. Explicit
Quit ended app and daemon; a clean relaunch retained **11 sessions**, **eight visible
scene objects** (five original handwriting objects and three test strokes), one
deleted object, and an intact SQLite database. Root stopped UI actions when the
user began navigating Console, so a second visual board presentation check was
not repeated. That optional recheck does not invalidate the saved-data proof or
create a new P0 blocker. Keyboard undo was not verified by this narrow check.
No microphone, model call or learning evidence was involved.

Receipts: `hormes-native-board-reopen.json`, `hormes-canvas-focus-proof.json` and
the current `hormes-prd-release-verification.json` in the task outputs. These prove
bounded native continuity, not an uninterrupted full-day rehearsal.

### Actual production Claude integration, synthetic project

The real production `ClaudeCodeConnector`, `ClaudeSession`, installed SDK and
persisted candidate-only profile completed a separately approved synthetic
circle-overlap task using existing authentication. Claude reported **8 turns,
7 guarded tools and $0.172816**. Only the candidate changed; all six protected
fixture hashes stayed unchanged, and a fresh profile-store instance retained the
guard. The production macOS read-only workspace verifier passed **8/8 tests** and
measured **5.17695× on that synthetic sparse workload**. This result is separate
from the existing EvoSim candidate’s workload-specific **47.12×** verification.
It is not a general engine performance claim.

The original private-project payload was rejected by automatic approval review
before any SDK startup because authorization to send that private source was not
established. The successful alternative used newly authored synthetic code only;
no existing EvoSim source was read, copied, reset or sent. It does not resolve the
original payload’s authorization. Receipts: `hormes-production-claude-synthetic.json`
and `hormes-production-claude-synthetic-report.md` in the task outputs.
No physical clap, Gemini microphone, device-owner dialog or VS Code sequence ran
in that integration. The authenticated native Forge chain remains to rehearse.

## Current learning interaction

Open Hormes's Console > Library > session tools and choose Study, Review, Exam prep, or the corresponding
Hypothetical day block. Study/exam unfold into a black board; Review opens a spoken flashcard. The tutor can select a separate MCQ, source-image or break surface. These are not whiteboard tabs.
The problem writes itself in bundled Virgil handwriting. The whiteboard controls are select, pen, eraser, microphone and fold-away icons. Cards and quizzes keep only their relevant controls. There is no Ask or
Check form, mode heading, chat panel, Sound on label, listening label or Console button
on this surface. Accessible control names and error messages remain available.

Press the microphone to explicitly begin the native voice lesson. Gemini Live is
now selected; OpenAI Live remains a configuration option. The opening is
“Take a look at the problem. What would you try first?” for a supported exercise; an ungraded course opens with a question about what to work on. Answer aloud and ask for help
when needed. Preparing a problem or accepting calendar work cannot open the microphone.
The tutor's instructions are to ask, wait, and provide one small handwritten and spoken
hint when the student stumbles, rather than reveal the complete solution.

The application checks narrowly supported, explicit spoken numeric attempts from
settled microphone transcripts. Examples are “The price is one half” and “The income
is five.” A full exchange answer can include “A gets five quarters of x and five halves
of y. B gets seven quarters of x and seven halves of y.” These example numbers apply
only to the original study exercise; exam practice changes the endowments. Ambiguous
speech, open-ended reasoning, and arbitrary handwriting remain ungraded. The original
words and microphone utterance ID are retained with the checked observation.

The model cannot submit a student answer or declare a goal complete. A displayed
problem and the exact opening are not hints. Actual tutor help is recorded as
assistance. Hypothetical-day evidence is saved but excluded from goal completion.

Fold away or press Escape to save and pause. Closing and changing modes end the
explicit lesson microphone. Console retains the board, observations, evidence and
unfinished work. Student strokes and tutor handwriting stay editable in the reused
Scholar/Excalidraw scene; the handwriting is not a raster screenshot. Tutor updates
preserve the viewport instead of recentering the entire lesson for each hint.

## Other implemented work

- Goals, sessions, observations, evidence, interventions and sources persist in a
  SQLite store with an append-only activity history, request deduplication and
  expected board revisions. Model drawing is acknowledged separately from saving.
- Console organizes learning under Intermediate Microeconomics, with real dates,
  times and Class/Review/Study/Exam prep labels. Each session exposes its notes,
  questions, checked attempts, sources and next step. Selecting an archive entry
  retrieves older notes without resuming work or opening voice. Resume restores the
  editable board under the notch. Meeting/travel entries appear under Other work.
- Read-only EventKit ingestion works independently of manual sessions and filters
  explicitly selected calendars. Suggestions require opt-in and an explicit event,
  mode and goal/course association, share the attention budget, and cannot start
  voice. The native discovery/empty-read and remaining real-offer boundaries are
  recorded above.
- The hypothetical day advances manually through class, review, another class, study, exam practice,
  EvoSim coding, VC meeting, NYC travel and break. It does not change real Calendar events or prove
  automatic anticipation.
- The VC block has a source-grounded briefing, explicit silent speech capture,
  generated follow-up email and an actual PDF deck/XLSX retention workbook. Requested
  attachments are selected by catalog ID and checked by size/hash at proposal and
  review. Reviewing exports a local MIME `.eml` containing the real files. Recipient,
  sending and reconnect remain pending; nothing is sent or declared completed.
- Travel researches actual provider pages and saves source receipts and review links.
  Changed constraints invalidate the current recommendation and require fresh checks.
  Date-specific fares and departures must be verified separately; no booking is made.
- Break saves work, cancels its work turn, closes voice and suppresses proactive offers.

## Provider and execution boundaries

Reasoning uses the existing OpenAI-compatible provider with gpt-4.1. Native voice now
selects Gemini Live (`gemini-3.8-live`, Kore), independently of the reasoning provider.
The supplied Gemini key is saved in Hormes's existing secret store, mode 0600; it never
enters the web view. OpenAI voice and the Local reasoning option remain configurable.
Qwen remains the next reasoning-provider evaluation, using the existing local transport;
no weights were downloaded or server started. See GEMINI_VOICE.md for the transport
contract and its OpenAI-hosted Responses limitation.

All model actions pass the existing ToolRunner and policy. Learning capabilities are
bound to their current session. Learning can read web sources for source images through web_search/web_fetch, with the ordinary URL gates. It cannot use the shell or browser controls. Expired or
cancelled work cannot act on a new session. Tools report through the orchestration
layer; no tool directly appends to the Live socket.

## Verified in this revision

- The latest integrated check passed 2,103 tests total (2,101 passed, 2 skipped,
  0 failed), TypeScript passed, and doctor reported 52 OK, 10 warnings, 0 failures.
  The signed calendar/evidence build installed at /Applications/Hormes.app with
  its stable signing requirement. The subsequent Canvas-only focus revision and
  native continuity also passed their separate checks described above.
- Focused work/voice tests pass, including fragmented-transcript settlement, fractions
  and decimals, ambiguous-answer rejection, explicit microphone start, stale voice
  rejection, assistance persistence, and ending voice on mode changes.
- The spoken-answer checker is protected as a whole-file self-edit rail. Its named-rail
  test and the final engine TypeScript check pass.
- On the unlocked Mac, the native board showed the handwritten problem with only the
  icon strip. GPT Live delivered the exact opening through the real audio graph.
- A real gpt-4.1 work request added the unboxed handwritten hint “A's income = 2 + p × 1.”
  WebKit acknowledged the scene; it preserved five editable handwriting objects and
  recorded help without generating student mastery evidence.
- The native fold-away control saved the board and returned to Console. SQLite confirmed
  the paused session, saved revision 4, and the problem plus hint. The audio graph was
  down and the Live session closed.
- Calendar read access is granted. Native discovery listed six calendars; selecting
  one Work calendar returned zero events. A live linked-event offer remains unproven.
- Native board continuity passed save, fold, editing after restore and clean
  restart with retained scene data; the exact proof and limits are recorded above.
- Gemini smoke and live synthetic end-to-end checks pass with Kore tutoring and
  Aoede as a scripted student. The actual Engine, Daemon, ToolRunner, gpt-4.1 brain,
  numeric checker and production Scholar/Excalidraw renderer handled a wrong answer,
  requested handwritten budget hint, assisted correct retry, completed spoken
  feedback and SQLite reopening. Font family 1 was preserved for all six saved
  handwriting elements. Course association and demo exclusion also survived reopening.
- The test exposed and fixed dropped transcript whitespace, repeated identical ASR
  sentences, long lesson requests rejected by the room attention window, desktop
  reflex/screenshot scope leakage, the compatible model's broad tool table, and
  incorrect Gemini response scheduling. Lesson progress narration is suppressed,
  duplicate help instructions are avoided, and queued tool continuation is inaudible
  until an application result. Narrow editor controls keep the minimal strip.
- Archive coverage confirms that dated class notes survive reopening and remain
  readable beyond the 500-observation recent window without changing active work.
- Gemini transport/engine and credential tests cover binary frames, combined audio
  and transcripts, quiet waiting, interruption, cancellation, mute, connection timeout,
  secret stripping/redaction, and preserving the separate local brain setting.
- An earlier daemon check confirmed Gemini/Kore selected, key probe OK, gpt-4.1 reasoning,
  and no open voice session. Later native continuity verification reached scene revision 7;
  current process status must be read from the final root verification.

## Remaining rehearsal gates

The signed Gemini build is installed and Setup is finished. Native accessibility
confirms the front-only recall surface, its minimal controls, course folders, deck
dates and session types. Native Console screenshot capture now succeeds; capture
of the floating notch panel was inconsistent, so the fresh animation is not claimed
from a Console screenshot or the production-renderer test.
A direct binary test launch hit macOS's Speech Recognition usage-description check;
the installed plist contains the description, and the app was relaunched through
LaunchServices with auto-wake disabled. Use the installed app bundle for rehearsal.
No work reset or deletion is necessary.

The full synthetic voice → actual rendered hint → checked retry → saved work loop
is verified through a loopback test bridge. It opened no physical microphone and
used no native speaker output. Native notch/hardware audio and a real human exchange
remain rehearsal gates. The strict extended synthetic run also passed direct next-class entry, four actual
MCQ clicks, a wrong answer, completed handwritten/spoken hint, assisted correction,
fresh checked price/allocation exercise, and reopen in 154.71 seconds. It verified
nonempty completed tutor audio at each feedback point. Synthetic numeric answers
are a fixture, not evidence of human learning.

Also outstanding: a native evidence-correction interaction, three uninterrupted demo takes, an actual calendar offer, verified
travel options for the chosen date, and recording/editing the 90-second video. Phone
sync, long lectures, permanent lecture audio recording, app blocking, and Qwen evaluation are not claimed.

## Code and reuse

packages/engine/src/work owns storage, transcript checking and orchestration;
packages/protocol/src/work.ts is the wire contract. apps/workspace contains the
Scholar adaptation and bundled fonts. Native hosting is in
apps/mac/Sources/Hormes/UI/Workspace/WorkspaceController.swift; saved work is in
UI/Console/WorkPane.swift. The existing execution hardening is preserved.

Excalidraw supplies the drawing editor, React/ReactDOM its host, and esbuild offline
bundling. No new package was added for this handwriting revision. The source attribution
and Excalidraw MIT notice remain in the workspace and installed bundle.

## Spaced recall, MCQs and compact breaks

Implemented October 11: a saved memorization deck arms a durable adaptive clock. A
relevant saved recall deck also arms a new Study block; explicitly paused recall is
respected, and independent Exam prep does not automatically import recall prompts.
Quiz banks remain separate from memorization decks.

Only the flashcard front drops under the notch. A settled spoken answer or “I forgot”
records the actual words and utterance ID, then reveals the back with a flip animation.
There is no flip button. A question or help request leaves the front hidden. Late
transcripts are bound to the original card. Independent exact-reference matches
lengthen intervals; lapses and helped attempts return sooner. No accepted phrases
means ungraded speech. These records do not complete learning goals.

MCQs occupy a separate drop-down. Students click a choice, the application records
it against the authored reference, and the explanation appears. Next waits for the
student. The quiz works with voice closed. The reused Scholar board stays retained
and saved while another tool is visible. Source images have their own focused view;
image generation is not implemented, and live source-image loading has not been
rehearsed in this revision.

Learning blocks have a 25-minute focus clock and five-minute recovery default. The
tutor can set a 30–1800-second break. Breaks reduce to a small clock beneath the notch,
save continuity, suppress recall and close paid voice. Expiry restores the previous
tool without reopening the microphone. Locked/busy/sleeping intervals defer prompts,
with no backlog burst. The closing lesson keeps its expired capability until voice
actually closes, so a late delegation cannot acquire general desktop tools.

Console stores recall decks and dated voice/MCQ attempts within course folders.
Attempts retain prompt, answer/choice, reference, method, help, real timestamp, demo
provenance and next due time. Real and demo decks cannot reschedule one another.

The live production-renderer loop passed in 151 seconds: GPT saved the deck; a real
one-minute clock presented its front; Gemini Kore asked and Aoede said “I forgot”;
the application saved the lapse and revealed the back; two actual UI clicks completed
GPT-authored MCQs without voice; a real 30-second break ended quietly; SQLite reopening
preserved the board and all three attempts. This synthetic test opened no physical
microphone or native speaker. The installed native recall surface and course folders
were subsequently inspected through accessibility. Native notch animation and a
complete human audio exchange remain rehearsal gates. Post-test focused coverage
also verifies click-paced MCQs, scoped
late voice, source-image validation and distinct recall/quiz banks. No npm dependency
was added for these tools.


## Lecture capture, class review and course continuity

Implemented October 11: Class opens a compact 740 × 260 black caption panel beneath the existing notch host. Capture starts only by pressing Record. Gemini’s dedicated `gemini-3.5-transcribe-live` transport supplies interim text while speech continues; these hypotheses are display-only. Finalized ASR segments become timestamped original lecture sources. The tutor cannot speak over capture, run a tool from lecture words, submit an answer or claim learning evidence. NotchPrompt inspired the edge-faded scrolling treatment; its MIT notice is bundled as `NOTCHPROMPT-LICENSE.txt`. The repository is a teleprompter, so its prewritten-script clock was not used as transcription.

Press the question icon or Q while the panel is focused. Capture pauses and Gemini/Kore opens a scoped voice question. The actual student question and tutor answer are saved separately; neither modifies the lecture source. Return to recording explicitly. Pause/end/mode changes request a bounded ASR finalization before closing the capture connection. If it fails, earlier finalized segments remain and an error asks the user to repeat the last phrase. Reopening after a crash requires explicit capture restart.

End saves the transcript and generates notes plus 1–8 takeaways through the configured reasoning provider. Summaries cite the original source and exact transcript revision. Console displays the class folder, actual date, Class type, notes date, takeaways and a separate original-transcript disclosure. Generated summaries cannot become fresh evidence. Notes failure offers regeneration while preserving the original speech.

Next class prepares exactly four clickable MCQs against the previous original lecture source. All four actual choices, including incorrect ones, are persisted before the final Next opens the target class ready to record. The model cannot replace this unfinished review with a whiteboard, another quiz or break. Review generation failure shows retry. No prior transcript means no fabricated quiz. Manual next-class entry and explicit calendar links can select another course and compatible goal; the association persists through the four-question transition. A new calendar event occurrence cannot revive an unrelated paused class.

Study and Exam prep retain the latest captured lecture from the same course and demo/real context. The existing handwriting, spoken tutor, separate flashcards, source-image tool and timed breaks remain. Structured work payloads now avoid double JSON decoding, which a live multiline hint exposed as unreliable. Old JSON-string payloads are rejected.

Earlier class-only verification: 55 focused tests passed, including speech-source isolation, interim/final separation, capture finalization/close, stale notes, four actual choices, class target folders, calendar occurrence transitions, crash recovery, cancellation and multiline handwriting payloads. That revision’s combined check passed: 2,052 tests, 2,050 passed, 0 failed and 2 skipped. Doctor reports 51 OK, 12 warnings and 0 failures. The bounded live class-to-homework loop passes in 235 seconds: 99 interim caption updates, two separate captured lecture sources and saved summaries, a completed spoken question, four actual UI choices (including one incorrect answer), a production-renderer-acknowledged handwritten budget hint and SQLite reopening. The test pauses after the hint begins speaking; a complete human lesson remains a separate rehearsal. All synthetic attempts remain excluded from mastery. It opened no physical microphone or native speaker.

Sources: [NotchPrompt](https://github.com/saif0200/notchprompt), [Gemini streaming transcription](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe). Raw room audio, long real lectures and a human native-microphone class rehearsal are not demonstrated by a synthetic PCM test.

## Double clap and EvoSim coding

Implemented October 11: Settings > Wake with offers Wake word, Double clap, or Both.
Double clap uses the existing ranked-microphone wake tap and a local transient detector,
with no second recorder or cloud classification. The detector requires two short sharp
onsets 180–700 ms apart, warm-up, a quiet gap and cooldown. October 11 calibration
against New Recording 8, 10 and 11 adds a filtered-impulse route with a fourfold
rise and decay below 35% of peak RMS within 40 ms. The original broadband route
remains. The tap uses audio-sample timestamps and complete 10 ms feature windows
across callback boundaries, avoiding scheduling jitter and tiny remainder windows.
The router suppresses
activation while locked, disabled, busy authenticating or audible. The unchanged
WakeGate still owns device-owner authentication. A clap is a wake gesture, never
proof of identity or permission to start a coding agent. Speech remains available
for the existing passphrase factor even in clap-only mode.

A finalized user utterance “win compile15, make no mistakes!” opens a durable EvoSim
coding goal. Spoken “compile fifteen” is also supported. Partial speech, lecture
capture and quoted webpage instructions cannot create that goal. The compact coding
surface unfolds beneath the notch; Console saves its actual tool receipts and next
action separately from class folders. Coding has a narrow tool list; existing file,
isolated-shell, native-action and owner-approval gates still apply. The voice delegates
the bounded brief to the normal reasoning/orchestration path. The brief opens VS Code,
asks Claude to edit the selected project, tests the result and retains its evidence.
It does not promise a tournament outcome. “Make no mistakes” means verify results.

The demonstration project is /Users/tazeemmahashin/Downloads/EvoSim. It is a dependency-free
2D circle-physics experiment. A real Claude session replaced the all-pairs candidate
with a uniform-grid broad phase. Trusted baseline, physics, tests and benchmark
files were protected from agent edits. Two additional edge-case tests were added
after the agent finished. All eight tests pass, including exact reference pairs,
seeded worlds, degenerate/outlier geometry, deterministic trajectories and momentum/
energy checks. The latest protected read-only sandbox benchmark measured 47.12× median
broad-phase improvement over five seeded 1,800-body worlds and nine alternating
rounds. This is a particular collision workload, not a universal engine speedup.

The loopback preview's Verify again control runs the actual tests and benchmark;
changed source invalidates acceptance, and both source changes during verification
and failures are rejected. Its test subprocesses receive no provider keys. The
agent used the existing Claude login; no API keys, .env contents, packages or network
server capability are needed by the candidate. Credentials remain in Hormes's
secret configuration, and the recording must show only masked setup status.

Verification: the headless Swift clap harness includes single/
sustained/speech-like rejection and owner-denial preventing Go. The real production
Engine, WorkStore, ToolRunner and macOS sandbox run the eight EvoSim tests and repeated
benchmark, record two source receipts, save an artifact, and preserve the paused goal
as in-progress. Hands, voice and reasoning are test doubles in that verifier harness;
no owner confirmation is bypassed. A sandbox compatibility regression now permits
only the missing kern.hostname read needed by POSIX uname/Node --test; unrelated
kernel data, secret reads, file escapes and network remain denied. Focused sandbox/
policy coverage passes all 28 tests.

A bounded real Gemini voice smoke test also passes. The first successful take
transcribes the full command; the final take speaks “Win compile fifteen” and
Gemini/Kore transcribes “Win Compile 15”. Both create the same bounded coding goal.
The final take also emits exactly one application-owned native notch-opening
response; partial speech and repeated commands cannot repeatedly unfold it.
The real ToolRunner then returns
needs-confirmation for the Claude start with owner authentication required. Native
hands and reasoning are test doubles; wake was invoked by the test, no physical
microphone or speaker opened, and Claude was not started by this smoke test.
Double clap is selected through the normal set-settings protocol while asleep;
the existing authentication choice and ownerApproval=true are retained.

The signed native bundle is installed with its existing signing requirement and
bundle inode. Physical clap detection, hardware voice, VS Code activation and the
live product's Claude start after real device-owner approval still require a native
rehearsal. Later unlocked native checks proved saved ink and Calendar discovery,
but not the complete authenticated coding chain. The separate actual Claude build,
protected verification and new synthetic production-connector run must not be
presented as proof that the whole clap-to-Claude chain has run. PRD v1.3 defines the
90-second cut; the final video and three uninterrupted human takes remain outstanding.

EvoSim's prepare-demo.mjs requires --reset-candidate, archives the existing code and
receipts, and restores the slow reference starter for a fresh recorded take. Its
flag requirement and preservation were verified on a private copy. The current
live project and its accepted result have not been reset.

Historical combined check after the voice/presentation changes: 2,061 tests, 2,059 passed,
0 failed and 2 skipped; doctor reports 51 OK, 12 warnings and 0 failures. The signed
release build passes with the new protocol mirror and native presentation handler.


## Hormes identity and Console revision · October 11

PRD v0.8 records the final visual contract: five white voice bars on black,
a monochrome command-center Console, one Agents list, and settings on demand.
The repository is now `/Users/tazeemmahashin/Downloads/Hormes-main`; package
names, imports, environment identifiers, CLI commands, state directory, socket,
Swift targets, executable, helper, resources and bundle identifier use Hormes.
The protocol is version 4 and the brain instruction version is 3.8. Original
MIT copyright and license terms remain in LICENSE; product copy and metadata
no longer identify the upstream owner as this product's user or author.

The draggable presence, native notch mark, menu bar and app icon share the five
bars. The floating view no longer draws the eyes or coloured halo. The notch
retains its existing geometry and animation on solid black. Installation requests
native permission prompts and toggles; configuration lives in Console. Console opens on work, with Work / Activity navigation and one Agents
rail. System settings are disclosed on demand; session tools remain collapsed.
Unused vendor-logo paths and their parser were removed. Course folders still
show dates, session types, notes and resume actions.

Private state moved to `~/.hormes`. Credentials retained their values with file
mode 0600; secret values were never included in source or test output. Legacy
record spellings were translated for the new readers, while the original records
were retained separately and read-only. The work database retains 2 goals, 11
sessions, 40 observations and its existing evidence. Previous source, generated
media, app bundle and build caches were archived outside the repository before
retiring the old installed bundle. No Git history existed in this ZIP checkout.

Verification: `pnpm run check` passed with 2,048 tests: 2,046 passed, 2 skipped,
0 failures. The smaller test count follows removing retired mascot-pixel tests
and replacing them with wave-icon checks. Workspace and site TypeScript checks
pass. The release app and helper build and the installed bundle passes strict
signing verification with identifier `com.hormes.app`. A quiet native cold start
connects to the migrated daemon; status reads asleep, session none, brain/hands
ready and audio graph down. The installed doctor reports 45 OK, 13 warnings,
0 failures; warnings include pending permissions and local-model setup. A shell
probe confirms the installed bundle is writable, although the app-owned daemon
reports an install warning in its restricted permission context.

The Console layout render uses real saved work with synthetic agent rows, and
is explicitly a preview rather than proof of live agent activity. Native UI
access returned AXError.cannotComplete while the Mac was locked. Physical drag,
notch motion and interaction still need an unlocked Mac. No voice session or
paid model request was opened for this rebrand. The overall human demo rehearsal
and 90-second video remain outstanding.

The site production build also passes. The React best-practices review found
8 changed TSX components; their edits are branding/import names and introduce
no new hook lifecycle, data-fetching or client/server boundary behavior.
A final scan including generated app and site files finds upstream brand/owner
identifiers only in the original LICENSE notice. No retired owned file names
remain. The original app was archived and unregistered before removal.

## VC meeting loop: October 11

The meeting tool follows pre → capture → follow-up. Before the call, GPT prepares
a source-linked brief. During explicit capture, the same transcription path used
by class mode stays silent and records original microphone speech. Finalizing
capture generates the requested follow-up through the scoped work tool. A typed
recap is an alternative and is labeled as a user-provided recap.

The hypothetical VC block includes a versioned three-page PDF deck and an XLSX
retention workbook with synthetic cohort inputs and live rate formulas. Copies
live in durable session storage. The model chooses catalog IDs; application
checks reject missing, changed, symlinked or invented attachments. Review is
bound to both the draft ID and current capture revision. New capture or recap
invalidates review. The local `.eml` contains actual MIME attachments and has no
recipient. Sending and scheduling are not implemented by this meeting tool.
The requested next-week reconnect is saved as unfinished work, without an
invented exact appointment. Real meetings do not inherit the synthetic sources.

Console retains the brief, original transcript/recaps, generated email, requested
files and next actions under dated meeting work. A linked real meeting can offer
preparation fifteen minutes beforehand, subject to existing opt-in, quiet-state
and attention-budget rules. Accepting an offer does not open the microphone.
Real preparation-material import remains future work; the complete prepared
brief/file workflow currently uses the bounded hypothetical VC block.

Verification for this addition:

- `pnpm run check`: 2,056 tests, 2,054 passed, 2 skipped, 0 failures; doctor
  52 OK, 11 warnings, 0 failures.
- Eight new meeting tests cover original capture, source separation, persisted
  pre/post state, checked MIME files, stale review, restart, calendar lead time
  and blocked source-driven execution. Existing class/work scope tests also pass.
- A real gpt-4.1 check through WorkCoordinator and ToolRunner generated the brief
  in 5.109 seconds and the follow-up in 3.875 seconds. It selected both requested
  files and exported an unsent draft. Input was an explicit typed mock VC recap,
  not a live meeting or a microphone-transcription claim.
- A second end-to-end check generated the mock investor sentence with Gemini
  Live and streamed PCM through the real daemon microphone wire. Gemini's
  transcription session produced fourteen interim captions and one final
  segment. GPT drafted the requested two-file follow-up from that captured
  source; exact review exported the MIME draft and reopening storage preserved
  it. Capture emitted zero audio and zero delegations. No physical microphone
  or actual investor meeting was used, and no message was sent.
- Workspace TypeScript and the signed native release build pass. Real GPT work
  JSON decodes and round-trips through the actual Swift protocol definitions.
  The native wire/Console harness and strict/deep installed signing verification
  pass.
- Read-only browser previews inspected the actual generated pre/post content.
  They simulate the notch host and do not prove native animation or real voice.
- The deck was rendered and all three pages inspected. Workbook formulas, input
  changes, exported formulas and rendering were checked; native Excel behavior
  was not tested.

At the time of the initial meeting integration, the old process was retained to
avoid losing unsaved work. Later recovery and native relaunch completed. The physical
Gemini microphone/caption → end → draft rehearsal, real mail sending integration
and finished 90-second recording remain outstanding. The unified storyboard now
allocates 56–73 seconds to briefing, the short VC request and prepared email.

## Spontaneous activity awareness: requirements update

PRD 1.1 adds metadata-based awareness of unscheduled work and optional retrospective
calendar logging as P1 work. Existing front-app and browser-tab tools provide
building blocks, but there is no continuous activity-span collector or dedicated
calendar writer implemented by this update. The requirements distinguish inferred
resource exposure from checked learning and observed task-site time from task
completion. Automatic calendar additions require configured authorization and
apply only to qualifying retrospective spans on a chosen Hormes calendar.

This update changes product documents only. It does not enable monitoring, read
the user's browsing history, open audio or write calendar events. The physical
day-loop rehearsal remains the next release gate.

## Native interface refresh: Hormes library and voice island

The native Console now opens to Library, with course folders, goal filters, a
chronological calendar strip and dated session rows. Session records read in
their own pane; resume remains explicit. Agents and Activity have separate
navigation. Agents opens to a flat overview of real tasks and discovered sessions;
its conversation rail appears on selection or explicit search. The agent rail
no longer wraps the library, and its default page has no voice composer or
provider picker. Settings and
permission remedies remain available on demand. Empty evidence and notes
sections no longer appear in records. Tools and the manually advanced
hypothetical day sit behind the library's ellipsis control.

The open island uses a horizontal white-wave header and full-width content.
Screenshot/circle utilities, the extra sleep control and ordinary billing
figures are removed from its visible controls and hit areas. Transport, stop,
microphone, message submission, library access, approvals, reminders and problem
remedies remain. The field's arrow submits the typed draft; it does not invoke
the former contextual screenshot question. The floating voice controls share
the monochrome palette. Workspace tools and durable engine records are retained.

Native renders use the app's own view tree with audio disabled. Library preview
records come from prior synthetic class and VC end-to-end test stores; these
images are not a claim that the user's real day has been observed.

Validation: the full suite passed 2,054 of 2,056 tests (two skipped, no failures),
with 52 doctor checks OK, 11 existing warnings and no failures. Four native
island scenarios passed 36 checks for layout, hit areas, accessibility,
approvals, permission remedies and typed-draft submission. Opening a saved
lecture in the native preview emitted only `inspect`, with no resume intent.
Selecting an Agents task emitted `thread.open` and opened its conversation.
The release build was signed and installed in place, and strict/deep signing
verification passed. That prior running application could not answer native accessibility queries;
it was retained until safe recovery. Later native relaunch loaded the interface,
including Forge, Sage and Relay with their saved sessions.

## Inherited-code cleanup

The marketing playground, mascot rendering stack, gradient bitmap cache, flight
trail and retired notch command routes have been deleted. The white voice mark
and current Library / Agents / Activity views use the existing runtime and work
store. See [README.md](../README.md) for the current interface and installation scope.

Cleanup verification completed: 2,050 runtime tests passed (two skipped), 14 affected self-edit tests passed, and 42 native checks passed. Frozen offline installation, installer dry-run, release build and deep/strict signing verification passed. The installed app loads the cleanup after a full quit and reopen.

## Demo verification and safe shutdown

An October 11 process sample located the old native application's hang in its
signal-triggered quit callback. Calling AppKit termination inside the main
dispatch callback stranded the asynchronous board-save task. Signal termination
now enters through the main run loop after that callback returns. The existing
save and cancellation protocol remains in charge of whether the app exits.

The original entry point reproduced the hang in an empty application; the fixed
entry point completed its asynchronous save and exited. A native regression
checks SIGTERM, SIGINT and a declined save followed by a successful retry, with
ten checks passing. It uses an empty application without documents, microphone,
engine or model access. The full check passes 2,051 tests with two skipped and
no failures; doctor reports 52 OK, 11 warnings and no failures. The release was
installed in place and deep/strict signature verification passed. The old process was initially retained pending recovery. Subsequent recovery,
clean quit and native relaunch completed; the new dirty-board receipt proves
saved strokes survive a later normal quit.

A fresh live Gemini/GPT test passed the current class-to-homework flow: generated
lecture audio produced interim captions, a spoken question paused capture without
contaminating lecture provenance, and GPT saved notes and takeaways. Four MCQ
answers submitted through the actual workspace renderer included one incorrect
answer. Finishing the review opened a separate class record. The second lecture
fed the homework session, and the renderer acknowledged a real handwritten tutor
hint after the generated student asked for help. Both lecture records, all four
answers and the board survived reopening SQLite. Synthetic attempts did not
complete the learning goal. This test used isolated state and generated voices;
it did not open a physical microphone or inspect native notch animation.

EvoSim's actual verification control passed all eight correctness checks again.
That earlier candidate run measured a 44.0x median broad-phase speedup on the fixed
1,800-body workload, with its source hash recorded in the result. That benchmark
is specific to this workload. It does not prove the physical double-clap,
authenticated delegation and IDE chain, which still needs a live rehearsal.

## Coding voice transcription regression

The refreshed synthetic Gemini smoke check exposed a missed command: Aoede spoke
"Win compile fifteen. Make no mistakes!", but the receiver transcribed "When
Compile 15 make no mistakes." The exact-match trigger did not create the coding
workspace. The matcher now accepts that observed transcription only when the
complete "make no mistakes" phrase follows the event name. Ordinary questions
about when the event occurs, quoted page content and commands with extra actions
remain excluded. Delegation checks a complete line from the user's own transcript
rather than a matching substring inside a longer statement.

The focused coding and meeting suite passed 16 checks, including finalized-turn
handling, the observed transcription, capture-source isolation and negative
requests. A subsequent live Gemini smoke passed with a canonical transcription,
one workspace-opening response and an agent-start result requiring confirmation.
Real device-owner authentication was required by the production approval state;
none was simulated. Native hands and reasoning in this smoke were test doubles,
the test invoked wake directly, and Claude was not started. The physical clap,
approval and IDE rehearsal remains outstanding.

Post-fix validation: the full check passed 2,053 tests with two skipped and no
failures. Doctor reported 52 OK, 11 warnings and no failures. The release was
signed and installed in place, and deep/strict code-signature verification passed.


## Double-clap recording calibration (October 11)

The previous detector returned zero detections for all three supplied M4A files.
The revised production detector and extractor return exactly one double clap for
each file: New Recording 11 at 1.43 s, New Recording 10 at 1.15 s, and New Recording
8 at 1.19 s. Each also passes at gains 1, 0.5 and 0.25, with 512-, 1024- and
4096-sample buffers and 0-, 3- and 7-ms alignment shifts (81 recording variants).

`Scripts/ClapRecordingChecks.swift` retains signal-feature fixtures only, not the
original audio. The normal `wake-gate-check.sh claps` run verifies those fixtures,
removing either clap, filtered sustained bursts, quiet clicks, low-frequency thumps,
capture gaps, invalid samples, buffer-boundary invariance and the existing cooldown
and owner gate. Optional `clap-audio:/absolute/path/file.m4a` arguments decode a
supplied file offline through the production extractor. No microphone, network,
owner dialog or paid session runs in these checks. Live hardware wake and behavior
in untested rooms remain unverified; the authentication policy is unchanged.
