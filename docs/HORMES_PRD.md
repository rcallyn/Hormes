# Hormes: Product Requirements

Version 1.7 · 2026-10-11 · Working product definition for review

Repository location: `docs/HORMES_PRD.md` in the Hormes checkout. The output copy is a review deliverable. This PRD specifies work; creating it does not implement that work.

## 1. The product in one page

**Hormes is a voice-led Mac agent that carries work forward. It understands intended work, helps execute it, and preserves evidence of progress and unfinished tasks. Its primary interface is a dynamic island attached to the Mac's notch.**

The calendar organizes intent. Actual activity, explicit interactions, tool results and durable work state establish context and progress. A calendar entry can suggest a session; it cannot establish that the work happened.

Empty calendar time still matters. With activity awareness enabled, Hormes can record likely spontaneous work from foreground application and active-tab metadata, connect it to a relevant goal, and offer a useful later review. Optional calendar logging turns supported activity spans into retrospective blocks on a dedicated Hormes calendar. Inferred activity and demonstrated outcomes remain distinct.

The core object is a **Goal**. Sessions contribute observations and evidence to that goal. Learning is one mode and the whiteboard is one tool. General computer use, coding, meeting preparation, grocery preparation and optional travel planning share the same underlying context, actions and outcome records.

Quick requests remain quick: opening an app or answering a one-off question does not require a goal-creation flow. Create a durable goal for ongoing work when the user asks or accepts a proposed outcome.

**First user:** Tazeem, working and studying on this Mac. First new workflow: Intermediate Microeconomics, Class 10: Exchange Economies, using the actual course material.

**P0:** build the working calendar-day demo on this Mac. Retain Hormes's general agent capabilities; add a workspace that drops from the notch, saved work and a selected-note Tasks Inbox in Console, voice-led learning with a reused Scholar whiteboard, calendar context, a narrow meeting workflow and selected-note-to-grocery-cart preparation through the existing browser tools. Test reasoning through the OpenAI API first; subsequently evaluate local Qwen against the same tasks. Phone synchronization is optional P1 work and is not a release or demo dependency.

**Default learning surface: the single tool useful right now, with a few unlabeled icon controls. Handwritten whiteboard work, spoken flashcards, clickable MCQ quizzes, source images and compact break clocks each occupy their own surface. There are no tool tabs. Hormes writes the problem, asks the student to attempt it aloud, waits, and helps when the student stumbles. Spoken interaction is the primary learning interface.** Goal details, source material, work history, settings and transcripts are available on demand. They do not occupy permanent panels around the board.

**Interface division:** the notch is the live interaction surface; the workspace drops neatly from it; Console is where saved learning sessions, goals, the source-backed Tasks Inbox, grocery lists/checklists, optional travel research and meeting work are browsed and resumed. Closing a workspace folds it back into the notch and preserves its work in Console.

**Visual identity:** five simple white voice bars on black, shared by the app icon, menu bar, notch and draggable presence. No circular pet, eyes or coloured halo. The draggable waveform and notch share a gentle idle breath; dragging is direct, with a simple snap back into the notch. Console uses a restrained black-and-white library layout: course folders and goals at left, a chronological day strip, dated session records in the main pane, and **Library / Education / Agents / Activity** navigation. Agents opens to three named agents: **Forge** for coding, **Sage** for tutoring, and **Relay** for meetings. Selecting an agent shows its sessions underneath, with dates, session types and existing record/resume actions. Sage owns class, review, study and exam sessions; Relay owns meeting records; Forge owns coding records and connected coding sessions. Activity uses a plain saved-session list. Native menus, pickers and help replace custom floating controls. Credentials, necessary models, microphone, wake authentication and permissions live in one short settings sheet. Course folders retain session dates, session type and resume actions. Provider names may appear where configuring or diagnosing the actual integration requires them.

**The demonstration:** double-clap wake can open the day; “win compile15, make no mistakes!” creates the bounded EvoSim coding goal, not a promise of a tournament result. Follow a hypothetical student's calendar through class → quick review → whiteboard study → independent exam practice → a verified EvoSim coding block → a remote VC meeting → preparing groceries from a selected Apple Note → break. Earlier work informs later blocks. The exact schedule and edit are a proposed storyboard, not an additional fixed product specification.

The first release is complete only when the real loop works. A UI preview, an eloquent explanation or a correct model response is insufficient.

## 2. Decisions and scope authority

| Decision | Status |
| --- | --- |
| Build on Hormes's interface and execution architecture | Confirmed in conversation |
| Dynamic notch expansion; sleek, restrained styling; remove the cartoon emphasis | Confirmed in conversation |
| Hormes identity throughout source, package names, CLI, bundle and local state; original MIT notice retained in LICENSE | Confirmed rebrand, October 11 |
| White voice-wave mark; monochrome Console with one Agents rail and settings on demand | Confirmed in conversation, October 11 |
| Hackathon simplification: remove character physics/fleet, conversation administration, custom floating UI, generic automation/memory admin and settings/tuning breadth | Confirmed in conversation, October 11; preserve core execution, saved work, safety and self-edit |
| Whiteboard, spoken flashcards, clickable MCQs, images and break clocks are separate focused notch surfaces | Confirmed in conversation, October 11; no tool tabs |
| Class capture → notes/takeaways → four MCQs on next-class entry → new lecture → later tutoring | Confirmed in conversation, October 11 |
| Adapt NotchPrompt’s restrained caption treatment | User-supplied UI reference; preserve attribution |
| Optional local double-clap wake; word / clap / both in Settings, with existing authentication | Confirmed in conversation, October 11 |
| EvoSim coding segment: VS Code, Claude, trusted correctness checks and measured optimization | Confirmed in conversation, October 11 |
| Learning is one mode of a broader work agent | Confirmed in conversation |
| Calendar plus actual context; support spontaneous work | Established product direction |
| Infer spontaneous work in empty calendar windows from active app/tab metadata; carry it into later review and optional retrospective calendar blocks | Requested October 11; P1 implementation after the core demo loop; no continuous screen recording |
| Persist work, evidence and unfinished tasks around goals | Established product direction |
| Workspaces drop from the notch with neat, restrained animation | Confirmed in conversation |
| Saved learning sessions and other work live in Console | Confirmed in conversation |
| Copy and adapt Scholar's existing whiteboard code | Confirmed in conversation; do not build a new canvas engine |
| GPT API first; local Qwen reasoning next on this Mac | Confirmed in conversation |
| Gemini Live for native realtime voice; keep local Qwen reasoning configurable | Confirmed in conversation, 2026-10-11 |
| VC preparation → explicit capture → Gmail draft to JacobY@transposeplatform.vc with pitch deck only; separate owner-authenticated send; reconnect pending | Confirmed in conversation, October 11 |
| Exchange Economies as the first learning workflow | Established first build target |
| Phone synchronization removed from P0 | Confirmed in conversation; optional later work |
| Develop from the calendar-led 90-second demo loop | Confirmed in conversation |
| Hypothetical busy day, groceries and a VC meeting | Groceries replace the earlier NYC travel demo beat; exact timing remains editable |
| Prioritize the learning and grocery execution loops | Develop from the observable demo results; supporting blocks stay narrow |
| Embedded web canvas, numeric timing targets and suggestion budgets below | Engineering recommendations for this draft; open to revision |

The hackathon surface intentionally excludes autonomous character flights/collisions/satellites, conversation pin/archive/trash management and search, bespoke popups/tooltips/dithering, generic automation or memory browsers/editors, accent palettes, billing displays and diagnostic/tuning panels. Calendar/break/reminder behavior, durable records, voice memory, approved execution and the self-edit runtime remain.

This document supersedes earlier interface previews and the demo plan where they conflict. Screenshots and prior assistant-generated proposals are reference material, not additional product requirements. Changes to release scope must be written here rather than silently inferred from another brainstorm.

Implementation update: the first native work/whiteboard slice is now built. The inherited marketing playground and mascot rendering stack are retired; only the runtime execution foundation and current Hormes interfaces remain in scope. See [HORMES_BUILD.md](HORMES_BUILD.md) for implemented behavior, tests and remaining release gates. The baseline inventory below records the pre-implementation inspection.

## 3. What actually exists today

Repository inspection and `pnpm run doctor`, 2026-10-10. “Implemented” means code exists in this checkout; it does not mean every integration has passed a live end-to-end test.

| Capability | Current state | Implication |
| --- | --- | --- |
| Native notch, voice, Console and screen annotation overlay | Implemented in Hormes | Reuse; refine presentation and add workspace states |
| Mac GUI control, file/web/shell tools and coding-agent connectors | Implemented, policy-gated | Preserve the existing execution path and approvals |
| Shell isolation and device-owner approval protocol | Implemented hardening | Preserve; real authentication dialog validation remains a separate check |
| Conversation memory and append-only action ledger | Implemented modules | Neither is the proposed goal/evidence system; doctor reports no memory store yet |
| Automations, watchers and agent status | Implemented | Useful event sources; do not equate scheduling with completed work |
| Proactive suggestions | Narrow opt-in blocked-agent pilot | Does not yet infer study needs or activate calendar modes |
| Calendar access | EventKit permission support exists | A typed event reader and calendar-to-goal/session mapping are new work |
| Local model transport | Implemented for supported local servers | Doctor finds no server running; actual Qwen behavior is unvalidated |
| OpenAI access | Doctor validates the configured key and model availability | Current default brain is `auto`, expected to choose Codex; explicitly select API reasoning for the proposed test |
| Goal records, evidence-based progress and mode controller | Not implemented in the inspected product modules | New core work, including saved learning/work views in Console |
| Shared learning whiteboard with live spoken tutoring | Interactive design preview only; Scholar supplies reusable canvas code | Integration into Hormes is new work |
| Meeting briefs and grocery cart preparation tied to durable goals | Durable records and browser tools exist; a real selected Notes/Instacart account rehearsal remains required | Verify the bounded demo slices without claiming sending or purchase |
| Phone continuity | Simulated in the preview | Optional P1; not required for P0 |
| Runtime during this audit | Installed app exists; no daemon answering | Do not describe the product as currently running or record a live success claim |

Source pointers: `apps/mac/Sources/Hormes/UI/Orb/NotchPanel.swift`, `packages/brain/src/tools.ts`, `packages/brain/src/local.ts`, `packages/engine/src/proactive.ts`, `packages/memory/src/`, `packages/protocol/src/index.ts`, `AGENTS.md`.

## 4. Modes and release priorities

| Mode | User job | P0 demo slice | Later |
| --- | --- | --- | --- |
| General work | Ask Hormes to inspect, explain or operate the Mac | Existing Hormes tools, voice and approvals; minimal island entry | Broader goal-aware context and specialized workspaces |
| Learning | Understand a concept and demonstrate independent performance | Reused editable board, spoken walkthrough, practice, hints, reference checks and saved sessions in Console | More subjects, delayed recall delivery and richer assessment |
| Coding | Carry a project toward a working artifact | EvoSim in VS Code; Claude modifies the candidate; independent tests and benchmark; saved actual tool receipts | General project criteria and broader verified completion |
| Meeting/work preparation | Prepare and carry a commitment forward | Source-backed VC briefing, explicit silent capture and reviewed email draft with checked requested files | Broader Phos workflows, integrations and approved external follow-up |
| Groceries | Prepare the requested items from a selected note | Import one selected Apple Note, preserve the list, make an execution checklist, prepare the cart from actual browser evidence, stop for review | Additional providers and explicitly authorized list export |
| Travel planning | Find a supported route under stated constraints | Optional retained capability; outside the required recording | More providers and separately authorized booking workflows |
| Class support | Capture class context and carry it into recall and homework | Explicit lecture capture, notch captions, dated transcript/notes/takeaways, silent written Q&A during continuous capture and four MCQs before the next class | Long-lecture robustness, broader course import and system-audio capture |
| Break | Stop interruptions and preserve unfinished work | Quiet notch, saved checkpoint, proactive offers paused | Explicit distraction controls |

“Cram” is a strategy within Learning: prioritize explicit exam topics, available time and demonstrated gaps. It is not a separate platform or permission to invent deadlines.

The core can represent any goal. P0 validates the supported learning criteria, meeting artifacts and grocery browser receipts. It does not claim generic automatic proof that arbitrary projects are complete. Different activities may have different goals; shared state does not force a meeting or grocery task into the learning goal.

**P0 release gates:** same-Mac continuity, the notch/workspace/Console contract, learning, EvoSim coding and grocery preparation end to end, and the narrow supporting calendar blocks. **P1:** metadata-based spontaneous-work awareness, optional retrospective calendar logging, optional phone continuation and local Qwen evaluation after the GPT loop works. These do not gate the first recording. Qwen remains the next reasoning-provider stage.

Explicitly outside P0: mandatory phone synchronization or an always-available continuity service; pooled compute; unrestricted remote computer control; merging all of Phos and Scholar into Hormes; always-on lecture capture; general screen surveillance; automatic app/site blocking; fully local speech and vision; autonomous installation or downloading of model weights. The EvoSim coding block is now a required demo candidate. The final 90-second edit must prioritize its two strongest completed loops rather than give every mode equal airtime.

## 5. Dynamic island and workspace requirements

### Interface states

| State | Visible content | Entry and exit |
| --- | --- | --- |
| Resting | Small restrained presence at the notch | Default when there is no useful interaction |
| Ambient cue | One short actionable suggestion and status | Only after a qualified event; expires or can be dismissed |
| Brief interaction | Current request, response/approval or essential task controls | User opens the island; folds back when the interaction ends |
| Active mode workspace | The current tool fills the work surface | Drops downward from the notch on user acceptance or explicit start |
| Paused/break | Quiet minimal state; resumable work | User pauses or accepts a scheduled break; resume restores the work surface |

Use Hormes's existing native AppKit/CoreGraphics notch attachment, geometry and interaction foundations. The workspace must read as a continuation of the notch: its top stays visually attached beneath the notch while the black surface unfolds downward and grows to the size the task needs. Collapse reverses that motion back into the notch. It must not appear as a detached floating window or an unrelated dashboard, and no duplicate island card remains above the expanded board.

Animate geometry, clipping and content reveal together, using the existing native interaction system. Keep movement short and settled, with no cartoon bounce or jelly motion. Content must not jump, flash an unstyled web view or steal focus midway through expansion. Respect Reduce Motion with a simple fade or immediate layout. Exact durations are a tuning choice; the acceptance criterion is a smooth, reversible drop from the notch across supported displays.

Compact review, meeting preparation, grocery progress and optional travel controls use the same drop-down language at smaller sizes. Learning can grow into an immersive board, but retains the notch attachment and an obvious way to fold back. Changing context checkpoints the old workspace and offers the next action; a calendar transition alone never forces expansion.

Presentation: opaque black work surface, readable system typography, gray controls and one restrained status accent. Reduce the expressive eyes, jelly motion and decorative gradients. Respect Reduce Motion. Detailed failures and approvals remain accessible and must not be hidden by the simpler appearance.

### Learning workspace contract

- The board is the dominant and default visible surface. No permanent goal header, evidence cards, history feed, chat sidebar or large answer form.
- A single quiet strip provides selection, pen, eraser, microphone/mute and fold-away icons with accessible names. No visible Ask, Check, Sound on, Mic listening, Console, mode heading or status row in the learning surface. Saved work remains in Console outside the lesson.
- Essential board operations: pen, eraser, selection, editable text/equations, movable diagram objects, undo/redo and pan/zoom. Save the editable scene and ink, not only a screenshot.
- Hormes uses a handwritten face for editable board equations and annotations, with progressive writing. Load the bundled font before measuring text. Preserve actual freehand student ink and reusable diagram tools. The initial problem is unboxed handwriting, not a typed card or chat message.
- The demo interaction is problem → spoken invitation → student attempt/stumble → a small spoken and handwritten hint → another attempt. Stop and wait between steps; silence does not justify revealing the solution.
- The student can interrupt, draw, type, move an object, ask a question, request a hint, pause or exit at any time.
- The problem belongs on the board. Attempts and requests for help come from native voice, without a text form. The application checks narrowly supported explicit numeric utterances from settled microphone transcripts and records their provenance. Ambiguous or open-ended reasoning stays ungraded; the model cannot submit invented student answers. Accessibility alternatives can be added without changing this default interaction.
- Source references, the goal, progress and work history are available on request through a temporary inspector. Optional captions/transcripts provide an alternative to audio; there is no default transcript wall.
- Student work and tutor-generated content retain provenance in stored state. An undo does not erase the record that a hint was delivered.
- Closing a workspace stops its active voice interaction, folds the surface back into the notch, and preserves acknowledged work in Console. A pending unsaved write must be visible rather than falsely reported as saved.
- A black immersive surface may reduce visual distractions. It must retain an immediate exit. OS-level app blocking is a later explicit feature.

The earlier embedded whiteboard preview is a functional interaction sketch. Its persistent header, answer row, footer and separate notch card are not the final layout specification.

### Console is the saved-work surface


The open notch has one horizontal voice header, full-width conversation or approval content, and a quiet composer. Start/pause, stop, microphone, send and library controls remain available as relevant; screenshot/circle utilities, a separate sleep button and routine billing figures do not occupy the island. Approvals, reminders and problem remedies keep their explicit controls. Recording and break indicators remain visible when active. The active learning tool keeps its own focused surface.

Console opens to Library. Course folders and goals filter the saved records; each dated row identifies session type, time, state and next action. Selecting a row opens a dedicated reading pane, with resume as a separate action. The current calendar and unfinished work provide continuity without a metrics dashboard. Start/demo controls sit behind a discreet tools menu. Agents shows current delegated tasks and discovered sessions without a voice composer or provider picker. Selecting a row opens its conversation. Activity retains execution history, while settings and permissions open on demand.

Extend the existing Console rather than creating a separate history application. Learning sessions and other work must be discoverable there, organized under class/course folders, then real date, with the session type (Class, Review, Study or Exam prep), time, state and next unfinished action. Goals remain a filter across sessions. Meeting, grocery and optional travel records belong under Other work. Groceries do not add a fourth named agent; Agents remains Forge, Sage and Relay. Opening Console is not required for saving; it displays durable engine-owned records.

Selecting a saved session reads its notes without resuming work or opening the microphone; notes remain retrievable beyond the recent-history window.

For a learning session, preserve and expose the editable board checkpoint, course/source references, exercises, submitted attempts, hints delivered, checked results, feedback and next exercise. A transcript can be linked when available; saving the session does not require raw audio recording. Meeting work exposes the brief, its sources and proposed or accepted commitments. Grocery work exposes the exact imported note, its identity/revision, original requested items, separate assistant checklist, item-level browser receipts and pending cart review. Optional travel work exposes constraints, checked options, source links, retrieval times and the pending review action.

Resume from a Console entry restores the appropriate workspace beneath the notch. Closing Console, pausing, switching modes and restarting the app cannot discard committed work. Show pending, failed and incomplete states honestly. Preserve the existing Console views for agent sessions, conversations, approvals and the append-only ledger; learning/work sessions must remain distinguishable from external coding-agent sessions.

### Education: a goal and a useful next step

Education is a Console view over the same goals, sessions and evidence. Its home
answers what the learner is working toward, why it matters and what to do next.
One prominent goal card resumes the saved lesson and its original board, or starts
learning for that exact goal and course. A short list of supported practice options
explains their relevance; an actual missed check can move an option to the front
without diagnosing a misconception. Other goals and practice history sit behind
secondary disclosures. There is no inferred course-completion percentage.

Explore concepts is secondary. It groups concepts by subject; the curated Grade 5,
middle-school, high-school and college groupings appear only in concept details.
These are not an official curriculum or an inferred personal school history.
Viewing a later course or reaching a birthday cannot fill in earlier skills.
An unsupported automatic exercise offers goal creation for guided learning, rather
than a dead-end practice message; it must not claim a score or supported assessment.

Practice records expose independent correct/attempt counts separately from attempts
with hints. Home summaries describe exact saved attempts, not lifetime mastery.
Selecting a skill reveals the original answer, checked criterion, assistance,
real date, limitations and saved-session link. Invalidated evidence stays in the
source record but is removed from assessment. Real and demo work remain separate.
Reading Education or inspecting a saved attempt does not open the microphone.

The first supported path connects fractions, equivalent ratios and linear
equations to exchange-economy income, prices and allocations. A failed economics
answer may justify checking a prerequisite; it does not diagnose which skill is
missing. A student can start an application-authored prerequisite check, receive
a small spoken/handwritten hint, try a fresh independent check, and return to a
fresh economics problem. The original problem and ink remain saved. Passing the
prerequisite alone does not establish transfer, complete the economics goal or
assess a school grade. Functions and broader subjects remain unassessed until a
supported assessment exists. This adds a bounded demo path, not a complete
children's curriculum or validation of teaching children.

Acceptance: current economics work → explicit prerequisite check → wrong attempt
→ delivered help → assisted correction → distinct independent check → fresh
economics application. The map must show the actual attempts and assistance after
restart, honor evidence withdrawal, and keep demo attempts out of real progress.

### Reuse the whiteboard implementation

Copy and adapt the selected Scholar Excalidraw implementation from `Taz33m/scholar`, available locally in `/Users/tazeemmahashin/Documents/ChatGPT/scholar`. Start with `frontend/components/canvas-excalidraw.tsx`, `frontend/lib/excalidraw-canvas-adapter.ts`, `frontend/lib/canvas-adapter.ts` and `frontend/lib/canvas-plan.ts`. Reuse their scene serialization, validated operations and relevant tests. The Excalidraw adapter already applies plans; its shared executor result types can be separated from the tldraw runtime.

Recommended integration: bundle a small React/Excalidraw web surface in a native `WKWebView` hosted by Hormes's notch workspace. Keep native voice, controls and execution orchestration. Add a narrow typed bridge for ready/state notifications, validated board operations, student edits and durable scene saves. The bridge must not offer arbitrary shell, network or native code execution.

Adapt the white background and surrounding UI to the black minimal workspace, with clean readable text/strokes and the small tool strip. Replace Scholar's browser `localStorage` as the authoritative save mechanism with the Hormes work store and Console-backed session records. A local browser cache may supplement acknowledged saves. Retain provenance for student and tutor objects and report partial/failed plan application.

Do not copy the entire Next.js application, Gemini voice stack, Supabase setup or both canvas engines. Preserve applicable source attribution and dependency licenses. New dependency/build changes need an explicit reason when implementation is reviewed. Integration status and verification limits are recorded in HORMES_BUILD.md.

## 6. Core work model

Use a small durable store with an append-only activity history. Avoid rebuilding an enterprise workflow platform. The application owns records, validation, permissions and completion; the model proposes explanations, plans, assessments and interventions.

Reuse Hormes for interaction and execution, Scholar's actual canvas code for the whiteboard, and Phos' durable-ledger, notification and provenance patterns for operational state. This is one coherent product, not three full applications placed behind a mode picker.

| Record | Minimum responsibility |
| --- | --- |
| `Goal` | Desired outcome; versioned success criteria; optional deadline; state; linked sources/artifacts; next unfinished step; version |
| `Session` | Goal; mode; start/end; optional calendar reference; resumable workspace/checkpoint |
| `Observation` | What happened; source; real timestamp and engine-owned order; actor; related session and artifact |
| `Evidence` | Which criterion an observation supports; assessment method; assistance; limitations; provenance; validity |
| `Intervention` | Suggested or authorized action; reason and supporting context; lifecycle; expiry; outcome |

Domain records such as exercises, attempts and board scenes supplement these five records. They do not replace the Goal as the organizing object.

Rules:

1. P0 goals persist across sessions, mode switches, app/engine restarts and provider changes on this Mac. Future device sync must preserve the same contracts but is not required now. Calendar events are optional context, not the primary key.
2. A generated explanation, exercise, summary or completion claim is assistant output. It is not fresh evidence of student learning or a successfully executed action.
3. A submitted student attempt is an observation. Its checked result becomes evidence only for the criterion actually assessed.
4. Preserve independent, hinted/assisted and delayed recall attempts separately. Record help delivered through speech as well as through the board.
5. Independent practice begins explicitly. Hormes withholds hints and solutions until the attempt is submitted or help is requested. Instruction in an earlier session does not by itself make a fresh attempt assisted.
6. One wrong answer does not establish a recurring misconception. A recurring-gap intervention must cite the attempts that support it.
7. Completion is a validated application transition requiring the declared criteria. Preserve limitations, uncertain grading and remaining work.
8. Save a submission, assessment and resulting goal change atomically. Request IDs prevent duplicate evidence; expected versions prevent silent overwrites. Engine ordering resolves hint/submission races. Late results stay attached to their original goal/session and cannot mutate a newly opened workspace.
9. Corrections append a revision or invalidate evidence with a reason. Do not rewrite history to manufacture independent success.

For the first exercise family, deterministic reference checks validate the price ratio, budgets and market-clearing allocations. Open-ended reasoning feedback may be provisional; the LLM must not independently decide that a learner has mastered the course.

Use SQLite plus the small activity history for P0. Console reads these records and the existing action ledger; it must not invent historical rows from a model summary. Saving a grocery cart review does not mean checkout or purchase happened. Saving an optional travel recommendation does not mean travel was booked. Saving a meeting commitment does not mean the commitment was completed.

## 7. Context, calendar and proactive behavior

Read relevant events from the user's selected macOS calendars, with explicit permission. The current integration reads events and links them to goals; it does not create or edit calendar events. The P1 retrospective logging workflow below adds a separately enabled, narrow calendar writer.

An event-to-goal association must be user-confirmed or explicitly configured. An unlinked event can produce a proposed association, not an automatic learning/coding session. Handle rescheduled or cancelled events, overlapping blocks, time zones and events without a known goal. Calendar failure leaves manual start fully usable.

A qualifying study block can prompt “Continue your exchange-economy practice?” using the saved unfinished step. Accepting opens the relevant workspace. A dismissed suggestion must not return repeatedly during the same block.

Additional valid context: an explicit student attempt, a completed or failed verified task, an agent status change, or the user starting work spontaneously. Opening an app or being inactive is insufficient evidence of a learning gap or lack of progress.

### Spontaneous work in empty calendar windows (P1)

When the Mac is unlocked and in use, an opt-in observer uses foreground application, active browser tab title, sanitized URL/domain, focus transitions and idle boundaries. It does not record the screen, microphone, keystrokes or page bodies. Record only the active tab in the foreground browser; a tab sitting open in the background is not work evidence. If context access is unavailable, preserve the gap rather than silently starting screen capture. Pause awareness during lock, sleep and excluded apps/sites. Browser private contexts must be excluded where reliably detectable; unsupported exclusion is reported before observation is enabled. Keep raw metadata local and short-lived; require a separate choice before sending browsing context to cloud reasoning.

Group sustained compatible observations into an activity span with actual start/end bounds, active duration, supporting observation IDs, inferred label, confidence and classification provenance. Split at idle periods or material context changes; avoid minute-by-minute calendar clutter. An empty calendar interval is the first target, but a planned event does not prove that the observed work matched it. Suggestions during scheduled work must not silently rewrite the planned event. Use the existing session/observation concepts for continuity and retain inferred status until the user confirms or stronger task evidence arrives. Unmapped activity does not need a new goal for every tab.

| Observed context | Supported record | Possible next action |
| --- | --- | --- |
| Sustained foreground use of a YouTube video titled around a math concept | Likely math review, with the video reference and observed active interval | Offer a short recall quiz later; obtain an authorized transcript or course reference when needed for source-specific questions |
| Sustained foreground use of the configured Handshake task site | Likely Handshake work, with observed active time | Log a retrospective Handshake block; do not infer submitted tasks, earnings or completion from tab metadata |
| Many unrelated tabs or sparse focus samples | Unclassified or mixed activity | Keep a private tentative record; offer a correction only when useful |

Viewing a resource is exposure, not mastery. Record a later submitted answer and its assistance separately. A video title can suggest a topic; it cannot establish exactly what was taught. Topic-based practice must be labeled as such until source content is available. Follow-up offers use the shared attention budget, relevance, expiry and quiet-state rules; passive observation never arms forced recall or opens the microphone.

Activity history lives in Console with dates, source references, inferred/confirmed state and correction/exclusion controls. Corrections preserve an activity-log event and improve later classification. Make retention and clearing controls explicit; minimize URL storage by dropping query strings/fragments unless a safe content identifier is needed. Do not retain credentials or token-bearing URLs.

Calendar logging is off until the user enables it and chooses an eligible dedicated Hormes calendar. The application then owns a narrow writer for supported retrospective spans: an agreed minimum duration/confidence, a stable span-to-event ID, rechecked calendar gaps, actual observed bounds and an inferred-activity description. This configured authorization permits qualifying additions without a question for every block. Lower-confidence classifications stay in Console for review. Calendar entries include a link back to the saved activity, not a browsing-history dump. Retries cannot duplicate blocks; later corrections update only Hormes-owned entries under the same authorization. Do not overwrite existing personal events, invite attendees, or create prospective commitments from browsing. Display the calendar's sync/sharing destination when enabling logging, and keep all writes within the application permission boundary.

The current browser tools can read front-window tab metadata and the front app. Continuous activity aggregation, reliable idle/private-context exclusion, activity-to-goal association and this scoped calendar writer are new work. Documented requirements are not a claim that tracking is already enabled.

Acceptance: a foreground math-resource span during a real calendar gap creates a tentative review record; authorized calendar logging creates exactly one retrospective block; the later quiz records its own attempt. A Handshake span produces time evidence without fabricated task completion. Background tabs, idle/locked time, excluded/private contexts, ambiguous topics, restart, duplicate delivery, calendar overlaps and denied access must be exercised before enabling unattended logging.

### Attention and context transitions

Default behavior is silence. No unsolicited voice wake or microphone capture. Outside an explicitly active learning plan, no forced mode switch or workspace expansion. An armed recall plan can present its due front from the notch within that learning session; it defers during lock, sleep, busy conversation and breaks. Pausing the session stops these transitions. Suggestions need a specific useful next action, evidence/context, expiry and dismissal. Keep one offer visible at a time and suppress offers during active conversation, focused work, breaks and a locked screen.

Initial engineering recommendation: start with the existing pilot's three offers per day, 30-minute cooldown and ten-minute expiry, plus same-block suppression. Validate usefulness with the user before relaxing these values. Treat calendar awareness and the existing blocked-agent pilot as distinct detectors under one attention policy; preserve the pilot's tool restrictions.

For the video, provide a clearly labeled hypothetical day fixture and an explicit demo clock. It advances calendar context through the same mode/session APIs; it does not edit the user's real calendar. Guided block advancement is an explicit user/demo action, not evidence that background anticipation or unrestricted interruptions work. Keep real event ingestion separate and describe which path is recorded. Real timestamps and search retrieval times remain real; accelerated calendar time cannot satisfy delayed-recall criteria or fabricate elapsed work.

On a context change, checkpoint the current session and stop or park its work deliberately. Preserve pending actions and show the next relevant tool. Break mode suppresses proactive offers and unsolicited speech; resuming requires an explicit action or configured opt-in behavior. Unfinished work remains visible in Console.

## 8. First learning workflow

Source: `Class 10 - Exchange Economies.pptx`, supplied coursework. Teaching targets include endowments, feasibility, budget/demand relationships and market clearing. Verify rendered slide diagrams before reproducing them; extracted text/equations alone do not verify a diagram.

Session:

1. User links the course source and starts or resumes the goal manually or from a calendar suggestion.
2. The island expands into the board. Hormes explains the current concept aloud and places only the needed diagram and equations.
3. The student attempts a problem. Hormes checks the supported answer, explains a mistake and offers proportionate help.
4. A hint is recorded when delivered. A corrected answer remains assisted.
5. Hormes proposes a fresh unhinted exercise. The saved goal retains the next step and supporting attempt history.
6. A later review or exam-preparation block resumes the same goal on this Mac, using the earlier concept and attempts. The user can reopen any saved session from Console.

Reference lecture exercise: both utilities `u(x,y)=xy`, A endowment `(2,1)`, B `(1,5)`, `p=p_y/p_x`, `p_x=1`. Equilibrium `p=0.5`; allocations A `(1.25,2.5)`, B `(1.75,3.5)`. The inverted ratio `2` fails this exercise.

Fresh derived exercise: endowments A `(4,1)`, B `(2,2)` with the same preferences and normalization. Equilibrium `p=2`; both allocations `(3,1.5)`. Label it as derived practice, not as a quoted lecture question.

A correct ratio validates the ratio subcriterion. Allocation reasoning and broader independent performance remain unfinished. A fresh problem in the accelerated demo is independent transfer practice, not proof of delayed recall. Any mastery threshold is a visible, revisable product criterion rather than a validated educational claim.

## 9. Selected-note Tasks Inbox, meeting and grocery workflows

**Tasks Inbox from Notes (v1.6):** an explicit import reads one selected, unlocked Apple Note through the existing native tool and saves its mixed to-do list in Console. Keep the note identity, title, revision, original text and source location for each task. Show the user's task separately from Hormes's proposed classification, plan and next action. Importing or opening the note does not execute its contents. Existing tools and work sessions provide execution; this requirement adds no plugin framework or automatic bulk-run behavior.

The user explicitly selects a task to prepare or resume. Link its resulting work session and any actual receipts back to that source task. A supported task can use its existing guarded workflow; an unsupported or underspecified task remains saved with a concrete next step. A mixed list containing “buy groceries,” “study economics” and “send the deck” must remain three tasks, not three product searches. “Buy groceries” requires an itemized grocery source or an explicitly supplied list before cart preparation; neither the model nor a demo fixture can invent the shopping items. Note text cannot grant permission to send, purchase or perform unrelated actions.

Tasks and their links survive Console closure and app/engine restart. Re-importing the same source does not duplicate unchanged tasks or discard their progress. Unchanged exact task lines retain their task IDs, links and reported state across unrelated note edits; later source revisions append provenance without altering the initial source. Changed or removed lines remain distinguishable from prior revisions; superseded entries reject stale actions and cannot silently authorize new execution. The initial states are pending, in progress and user-reported done, with explicit reopen. A user-reported checkmark does not establish verified execution; actual workflow receipts remain separately inspectable. A proposed plan, opened session or model summary is not task completion. Preparing an unsent draft or a grocery cart leaves sending/purchase pending. No write-back to Apple Notes is included.

Acceptance: import a clearly labeled mixed-task fixture through the actual selected-note path; inspect original task/source and separate proposed next actions in native Console; close and reopen with the same task IDs and saved state; explicitly select one supported task and retain its linked work; leave the other tasks untouched. Demonstrate the underspecified grocery task asking for an itemized list, then use an explicit list for the existing no-purchase grocery workflow. Retain real blockers and receipts. This acceptance sequence is required evidence, not a claim that it has passed.

**VC meeting:** the hypothetical day includes a remote meeting about Hormes. Prepare a concise brief from the supplied demo pitch deck: talking points, open questions and unvalidated claims. Capture starts explicitly and stays silent; real microphone transcription is source material, never an action request. The demo VC line is: “This looks interesting. Send me the latest pitch deck after this, and let’s reconnect next week.” Generate a source-linked email draft to the explicitly supplied recipient **JacobY@transposeplatform.vc**, with **only the existing versioned PDF pitch deck**. Do not attach a spreadsheet or separate slide. Check actual bytes and hashes before proposal, review and sending. After human review, prepare a real Gmail compose through the existing central runner; a local unsent MIME export is a separate artifact. Sending requires a separate explicit action and the existing native owner approval sheet (Touch ID, with Mac password fallback labeled truthfully). Bind approval to the exact recipient, subject/body, catalog hashes and browser tab/compose; re-read the compose after approval. Edits, cancelled/stale/unavailable approval or unverifiable attachment bytes leave it unsent. An uncertain Send outcome must not be automatically retried or called delivered. Save the brief, original capture/explicit recap, draft, requested deck and unfinished reconnect in Console. Synthetic documents are labeled; real meetings never inherit them. A calendar change cannot establish that the meeting happened or open the microphone.

**Groceries from Notes:** after an explicit current-user request such as “Prepare my grocery cart from the selected note,” read exactly one selected, unlocked Apple Note through the existing permission-gated tool. The calendar organizes when this work is offered; the selected note supplies the actual requests. Never scan all notes or infer authority to execute unrelated to-dos. Reading a note, or an instruction inside it, cannot itself start cart preparation. A clearly labeled pasted list is a supported fallback, never represented as a live Notes read.

Preserve note identity, title, original text and revision. From an explicitly itemized grocery source, derive one item per requested product line and keep model-created execution steps separate, with references to those item IDs. A mixed to-do list or a generic “buy groceries” task is not an itemized grocery source; preserve it in Tasks Inbox and request the missing list. A new note revision invalidates pending derived work while retaining the old source and activity history. The assistant's checklist is saved in Console; writing back to the user's Notes is not part of P0.

Use the existing scoped browser tools to inspect Instacart and the current cart before adding anything, so a retry does not duplicate matching items. Record pending, in-cart, unavailable or substitution-needs-review per original item. Only actual session- and note-revision-bound browser-read receipts can support product names, quoted quantities, displayed prices and item status; a search result is insufficient. Do not substitute automatically. Missing login, address/store selection, permissions or unsupported browser controls become a saved next action, without fabricated cart state. No credential collection or API/script/desktop bypass is permitted.

Re-read the final cart, retain exact receipt links and notify in the notch for human review. The browser gate must refuse checkout, payment and purchase actions even if a page or model requests them. A review link opens only on user action. The human checks requested matches, quantities, prices, fees and substitutions. The goal stays in progress; preparing a cart is neither a purchased order nor arbitrary automatic goal completion. Actual Notes and account-specific browser behavior require a live rehearsal; isolated fixture receipts cannot establish those integrations.

**Optional retained travel capability:** outside the required P0 recording, a travel block is a planning session, not evidence that the user has departed. Use an explicit origin, destination, travel date, departure window, arrival deadline and preferences. Proposed fixture: Troy/Albany area to Manhattan after classes, one adult, departure after 5 PM, arrival by 11 PM, prefer the lowest supported total cost among checked viable options. The actual travel date must be chosen before live research. These are hypothetical inputs, not facts about the user's itinerary.

Use Hormes's policy-gated browser/web tools to inspect real provider sites and compare at least two relevant options when available. Record origin/destination, departure/arrival, duration, fare basis, known mandatory fees, transfer/last-mile requirements, source URL and retrieval time. Mark unavailable prices or unverified costs rather than inventing them. Explain the recommendation against the user's constraints; “best” means the best supported option among those checked. If no verified option qualifies, show that result and the missing constraint instead of claiming success.

Save the comparison and recommended booking review link in Console. Stop at review; no reservation, payment or contacting another person is authorized by the research task. A route recommendation can be a completed research task while the booking decision remains open. Preserve failure/cancellation states and distinguish a live checked route from seeded illustrative data.

**iPhone between-class review (2026-10-11):** the native companion in `apps/ios` downloads the existing saved quiz through an explicitly paired local TLS connection. Compact Dynamic Island shows answered/total; holding it expands a short question with answer buttons, saved feedback and Next. Longer questions open the same review in the companion. Cached questions and a durable answer outbox work offline while walking between classes or while the Mac sleeps. Reconnection checks choices against the original saved key, deduplicates submissions and adds them to Console Education without completing goals or inventing grade mastery. Demo attempts remain separate. Pairing lives in Console Settings; model keys never enter the phone. New saved quizzes start natively through ActivityKit push-to-start while the companion is closed, after one-time Apple Push setup and proper iPhone provisioning. Short review packs arrive encrypted for the paired phone and are saved in background runtime; larger packs use local TLS download. Foreground downloads also start automatically, without a trigger button. Pairing and answer uploads still use shared Wi-Fi; no internet relay is present. Apple developer signing and APNs delivery require physical-device verification. The Mac remains the primary demo surface. See `apps/ios/README.md`.

## 10. Models, voice and execution

Gemini Live is the default native voice provider. Replies and generated teaching
content default to English; only the current user's explicit translation or
language-change request can change that. Foreign source passages, quoted speech,
media and uncertain transcription do not change the response language. Original
captured lecture/meeting speech remains verbatim. Tutor prompts ask for one
attempt, wait, and offer targeted help after a stumble; they do not include worked
answer examples or claim correctness before an application check. Scholar's
existing language and tutoring rules inform this adaptation. Model compliance
requires bounded live checks as well as prompt/transport regressions.

Stage A: explicitly select the OpenAI API reasoning backend and an available configured GPT model. Use Gemini Live for native realtime voice through Hormes's existing audio graph and delegation layer. Voice and reasoning are separate settings; the original OpenAI voice transport remains selectable. API access and Codex's ChatGPT login are separate paths. A valid key alone does not prove the live tutoring loop.

Stage B: explicitly select a local Qwen model served through the supported local interface on this machine. Reuse the goal/assessment/tool contracts and run the same exercise fixtures. Validate structured outputs, cancellation, latency and teaching quality before declaring parity. Do not automatically download weights or launch a server.

Stage C: evaluate local speech recognition, synthesis and image understanding separately. Local Qwen reasoning alone does not make voice, embeddings or memory processing local. Describe each data path accurately.

Gemini receives microphone audio and application context only during an explicitly opened voice session. It has one delegation function, with actions executed by the existing brain and ToolRunner. It cannot submit a student answer from its own function arguments. Quiet waiting must not be treated as a failed connection. Voice startup failures remain visible; do not silently open another paid provider or download a local model.

The reasoning provider cannot own completion state or bypass a mode's tool scope. New mode tools still use the central ToolRunner and policy. Keep the nonblocking voice/delegation design, append-only ledger, secret redaction, shell isolation and device-owner approvals.

**Later-phase workflow customization, outside this P0 pass:** after the Tasks, learning and grocery loops are stable, let users configure each mode's sources, triggers and quiet windows, permitted existing tools within central policy, completion checks, retained state and presentation. Preserve the current Mac/voice foundation and durable work contracts. This is product direction, not implemented capability or blanket permission for background actions. Automatic Notes scanning, arbitrary imported coding execution, a generic plugin framework and installing external extensions are outside this pass.

Approval is distinct from teaching interaction. Saying “yes” to a lesson question is not proof of authorization for a broader Mac action. Use the existing authenticated approval path for capabilities that require it.

The learning-mode contract must provide bounded board operations, approved source access, attempt submission and progress proposals. Reference answers must not reach the independent-practice client or voice plane before feedback is allowed. Malformed model output or a timeout cannot complete a goal or silently mutate a scene.

No cloud request or recording is needed to read this PRD or inspect existing records. During active cloud sessions, show connection/microphone state and retain the existing usage visibility and stop controls.

## 11. Build order and acceptance

| Milestone | Deliverable | Acceptance gate |
| --- | --- | --- |
| A: Freeze the demo loop | Hypothetical day fixture, constraints, source assets and each shot's observable result | One coherent chronology; fixtures labeled; exact times can change without changing product rules |
| B: Build the showcase slices | Copy/adapt Scholar's board into the notch; run learning and selected-note-to-cart preparation | Real speech/board interaction, checked attempt and browser-observed grocery cart; prioritize these two slices |
| C: Persist the work | Typed records, SQLite, activity history and Console browsing/resume | Sessions, scenes, evidence, briefs, original grocery lists and cart receipts survive mode switches and restart; duplicate/stale results handled |
| D: Connect the day | Calendar/mode controller, manual start, quiet class support, review, exam practice, narrow VC brief and break | Earlier work feeds later blocks; compact surfaces drop from the notch; actual event and demo-fixture paths identified |
| E: Record and submit | Rehearsed 90-second capture of working software | Three complete rehearsals; real results, honest timing edits, accessible video/repository links |
| F: Local evaluation | Explicit Qwen reasoning selection | Same state/grading fixtures pass; capability differences documented; voice remains described accurately |

Develop from the shots: prove the board and grocery actions first, then connect their real records through the calendar and Console. A small durable save path is needed during B; C completes the shared schema and archive. Prioritize the learning and grocery execution loops, and reuse existing controls/tools for supporting blocks. Phone work does not delay any milestone.

P0 acceptance includes:

- Fresh launch, manual start, calendar-linked start, pause/resume and app quit/reopen preserve the correct work.
- Every active surface drops neatly from and folds back into the notch; no detached dashboard, duplicate island or cartoon bounce. Reduce Motion works.
- The default teaching view contains only the board and minimal controls. Inspectors are dismissible and not persistent.
- Console lists saved learning/work sessions and can reopen the correct editable scene, attempts, source context and next action. Closing Console does not stop saving.
- The Tasks Inbox imports only the selected note, preserves original tasks/source revision separately from assistant plans, deduplicates unchanged re-imports and survives reopen. Import alone executes nothing. Explicitly dispatched supported work links back to its task; unsupported or underspecified tasks retain a next action. A mixed to-do list cannot become shopping products, and completion cannot be inferred from a model summary or merely opening a workflow.
- Board edits and assessments remain separate; a drawn or typed note alone never becomes a graded submission.
- Hint disclosure through any channel changes assistance tracking. Undo, cancellation and switching modes cannot erase that disclosure.
- Source-generated exercises are labeled correctly; assistant outputs do not become fresh source evidence.
- The class question becomes the review/study context; a fresh exam-practice attempt uses earlier work without exposing its solution prematurely.
- A VC brief links to supplied sources; its accepted follow-up remains pending until supported completion evidence exists.
- The VC request must produce a real Gmail draft to the explicit recipient with only the existing pitch deck. Missing or changed files, a newer recap or a replaced draft block review. Sending requires fresh owner authentication bound to the exact reviewed content and compose, followed by an unchanged live readback; cancellation leaves it unsent. Review alone cannot establish sending or scheduling.
- A selected Apple Note or explicitly labeled pasted list remains immutable source material. Assistant plans cannot rewrite user tasks or authorize more items. Actual browser receipts support each in-cart/unavailable/substitution-review state; a product-search Add button is not cart evidence. Re-read the final cart; stop before checkout or purchase and open a review notification in the notch. Blocked Notes/browser/login/store/address steps remain actionable, with progress preserved.
- Optional travel research retains its checked constraints and sources; it is no longer a required P0 demo gate.
- Break mode saves work, folds the active surface away and suppresses new proactive offers and unsolicited speech.
- Offline, stale, duplicate, malformed and timeout cases preserve acknowledged work and cannot manufacture completion.
- Calendar suggestions remain budgeted, expire, respect quiet/locked/active states and never initiate microphone capture.
- Demo time is visibly accelerated; real source timestamps and learning evidence cannot be manufactured by the demo clock.
- Required repository checks pass and affected native components are built for implementation changes. No unrestricted shell fallback or unauthenticated approval path is added.

Measure session results and errors: independent validated criteria, assisted attempts, next-step accuracy, continuity failures and accepted/dismissed interventions. Time spent and message volume are not learning success metrics.

Proposed performance targets for evaluation: local controls respond within 100 ms; local committed writes acknowledge within one second; interruption starts silencing speech within 250 ms; warm tutor response begins within two seconds at the median. These are targets, not current measurements or release promises. Report observed timings and failures.

## 12. Proposed 90-second calendar-day demo

This is a hypothetical busy student's day, shown on one Mac. The calendar is the narrative thread; highlight each block as demo time advances. All mode changes, saved work, tutoring and browser actions must be real product behavior. Times below allocate exactly 90 seconds and can be revised after rehearsal.

| Video time | Calendar context | Working action and observable result |
| --- | --- | --- |
| 0–5 s | Day overview | Busy-day calendar; double-clap wake and the concrete EvoSim goal |
| 5–13 s | 9 AM: Class | Actual mocked-lecture captions and saved takeaways |
| 13–20 s | Noon: Next class | Four actual MCQ answers, including one mistake; next lecture ready |
| 20–36 s | 1 PM: Study | Handwritten problem, spoken attempt, stumble and small hint |
| 36–44 s | 3 PM: Exam prep | Fresh independent problem; supported check, without a mastery claim |
| 44–56 s | 3:30 PM: Coding | Actual VS Code/Claude work and trusted EvoSim verification, with acceleration labeled |
| 56–60 s | 4 PM: Before VC meeting | Prepared source-grounded briefing drops from the notch |
| 60–67 s | During VC meeting | Investor asks for the pitch deck and a next-week reconnect; actual captions |
| 67–73 s | After VC meeting | Actual Gmail draft with pitch deck only; reviewed, unsent until owner authentication; reconnect pending |
| 73–84 s | 5 PM: Groceries | Selected Apple Note → separate checklist → real cart observations → notch review; nothing purchased |
| 84–86 s | 7 PM: Break | Quiet notch and preserved work |
| 86–90 s | Closing reveal | Dated class work, coding receipts and unfinished VC/grocery actions in Console |

The two showcase moments are knowledge carrying from class into independent practice, and the same agent changing from tutor into an agent preparing requested groceries in a real browser. The VC slice adds a work context; it must remain small enough to work end to end. This is one day with persistent work, not six unrelated feature introductions.

Use hard cuts and clearly marked time advances. Accelerated browsing can be labeled or cut between actual tool results; do not imply the full task completed in the visible seconds. A hypothetical calendar is not a fabricated provider result. A compressed day is not proof of delayed recall. Let the real tutor speak without competing narration.

Before recording, settle the explicitly selected grocery note, the signed-in store/address context, the supplied VC source and recap, and the versioned learning criteria. These are concrete demo inputs, not reasons to reopen the product brainstorm. Keep a larger learning goal open when only one subcriterion was checked; keep purchase and follow-up actions pending when they were only prepared.

Exact provider choices, animation duration and budget controls remain engineering settings. They do not add permanent controls around the board. This PRD supersedes earlier phone-led demo plans and interface previews. The prototype and historical judging research inform the edit; neither establishes that a feature is shipped.

## Focused learning tools: October 11 update

Spaced recall is an application-owned tool in the tutor's arsenal. Saving a source-backed memorization deck arms a durable due clock. At an eligible interval, only the front drops beneath the notch. A settled microphone answer or “I forgot” reveals the back; there is no flip button. Partial transcripts, model tool arguments, typed chat and late answers from a different card cannot manufacture a recall attempt. Hints and questions keep the front hidden. Students can pause recall in Console or fold/pause the session.

The initial schedule is a transparent heuristic: first recall after one minute, independent exact matches progress through 5 minutes, 20 minutes, 1 day, 3 days and 7 days; lapses return after one minute and ungraded answers after two. Prompts are separated by at least one minute and only one appears at a time. This is not claimed to be an optimal schedule. Exact accepted phrases are narrow authored references; other language is ungraded when no accepted phrases are provided. These checks never establish overall learning-goal completion.

Quiz is a separate clickable MCQ surface. Each question has 2–6 choices, an authored reference index and an explanation. Clicking records the selected choice before showing the explanation; the next question waits for a click, with no automatic quiz advancement. Voice is optional for discussing a quiz. Quizzes need no microphone or paid voice session. The tutor selects the quiz through the same scoped work tool; Console also offers preparation without starting voice.

Images use a separate focused source-image surface and require an HTTPS source actually read in the bound session. Broken or inaccessible images report failure; the product does not claim image generation is implemented. The existing Scholar whiteboard and student ink remain saved through tool changes.

Learning sessions carry a 25-minute focus clock with a five-minute recovery block. The tutor can select a shorter or longer 30–1800-second break based on the current work. A break collapses to a compact clock beneath the notch, saves continuity, suppresses recall and closes paid voice. Expiry restores the previous tool without reopening the microphone. A locked or sleeping Mac defers transitions; there is no catch-up burst. A resumed session begins a fresh focus block.

Console stores decks and dated recall/quiz attempts under the same course association as the session. Records retain front, answer/choice, reference back, timestamp, help, grading method, demo provenance and next due time. Demonstration attempts remain separate from claims of human mastery. Neither phone synchronization nor Anki integration is a P0 dependency.

Acceptance demonstration: source-backed deck → real due interval → front → spoken “I forgot” → revealed back and persisted lapse → separate MCQ quiz with actual clicks and no microphone → compact timed break → quiet recovery → reopen the same class session with its ink and all attempts. The long calendar-day narrative remains the 90-second video framing; time compression must be clearly represented.


## 15. Class capture and next-class recall

Lecture capture starts explicitly. A class event, accepting a calendar offer, or finishing a quiz cannot silently open the microphone. The caption panel drops from the existing notch host, using a black contour, soft edge fades and a small icon strip inspired by NotchPrompt. It displays real speech recognition, never an advancing prewritten lecture script. Interim hypotheses are display-only; finalized segments become the original timestamped lecture transcript.

During capture the tutor is silent and lecture speech cannot issue computer actions, supply a student answer or satisfy learning criteria. Teacher transcription appears in red. Press the question icon or Q to enter an explicit written question without pausing the recording. Hormes answers in white text beneath the ongoing captions; the notch smoothly grows with the answer, with bounded scrolling for long replies. Neither the answer nor the thinking state restarts or interrupts the capture transport, and lecture mode produces no spoken answer. Class questions and assistant answers remain separate from the original lecture source and are saved with the session.

Ending capture generates written notes and 1–8 main takeaways from that session’s captured transcript. Store the original source, generated summary, source references, transcript revision and generation date separately. Console organizes these records under the course folder, actual date/time and Class session type. A failed summary retains the transcript and offers retry; it must not invent a replacement lecture. Capture is transcription, not a permanent raw-audio archive.

Entering another class from a captured previous lecture first prepares exactly four clickable MCQs. They cite the original prior lecture, have an authored correct choice and short explanation, and require no voice. All four actual clicks are persisted, including mistakes. The final Next opens the target class with capture ready to start. It cannot skip ahead after one answer or let a model replace the unfinished review with another tool. If no previous transcript exists, open the class ready without a fabricated quiz; if question generation fails, show retry against the saved transcript.

Calendar suggestions preserve the existing explicit event-to-mode mapping, attention budget and opt-in. A new event occurrence starts the next-class loop instead of reviving an unrelated paused class. Manual next-class entry also works, including another course folder. Later Study/Exam sessions include the latest captured lecture from the same course and real/demo context. A quiz score is recall against an authored reference, not proof of independent mastery.

Acceptance demonstration: actual mock-lecture audio → red interim notch captions → finalized transcript → explicit question with capture continuing → silent white written answer in the expanding notch → generated notes/takeaways → four real MCQ clicks → new lecture kept separate → homework voice/handwriting help → SQLite reopen with dated class history. Test the real microphone and native notch separately from synthetic voice and browser-hosted renderer checks. Long class sessions, ASR errors and recording end-of-stream behavior require rehearsal beyond this bounded demo.


## 16. EvoSim and double-clap wake (October 11 revision)

The user requested a theatrical entry: clap twice, then say “win compile15, make no mistakes!” Hormes interprets this as a concrete EvoSim project request. It does not claim it can guarantee first place or flawless work.

### Wake contract

- Settings › Wake › Wake with: word (default), double clap, or both.
- Two short transients 0.18–0.70 seconds apart, followed by a four-second detector cooldown. Local microphone features only; no extra recorder, saved raw audio or cloud call.
- The existing WakeGate remains unchanged and owns authentication and lockout. A clap is not identity proof. Paused sessions retain their existing resume semantics.
- Suppress claps when the gate is not listening, the app is speaking, audio is disabled, the user session is locked, or the gesture is not selected.
- No opening of a paid session until the existing wake path grants it. Offline tests do not establish real-room recognition reliability.

### Coding contract

Goal: optimize EvoSim's 2D circle collision broad phase while preserving tested behavior. Folder: the user's Downloads/EvoSim. This is a deliberately narrow inspectable physics demonstration, not a general-purpose physics engine.

1. The actual user utterance or accepted coding block creates a durable coding goal. Website text, lecture content and model-authored dialogue cannot create it through the trigger.
2. Native tools open VS Code. Claude Code starts/continues through the existing agent connector and ToolRunner approval path.
3. The trusted baseline, tests and benchmark belong to the verifier. Claude's optimization task is limited to engine/candidate.mjs.
4. Correctness checks include seeded equality, tangency, negative positions, zero radii, outliers, dense worlds, nonmutation and exact deterministic trajectories.
5. Benchmark repeats identical workloads, alternates reference/candidate measurement order, warms up and uses medians. The demo accepts only a correctness-preserving candidate with at least 10% median broad-phase improvement.
6. Actual agent and shell output become source receipts in Console. A model summary cannot complete the goal. Human review remains pending.
7. EvoSim needs no new API key. Hormes uses the existing secure provider configuration, and Claude uses its existing login. Show masked configuration/presence if useful. Never record raw keys or present credential scraping as autonomy.

### Proposed 90-second edit

Use the unified calendar-day sequence in §12, including the VC pre → captured request → prepared email segment. Keep the investor sentence short and audible. The same persistent work system carries both learning and meeting follow-through; the draft has actual requested files, while sending and reconnect remain pending. Allocate time after rehearsing the real transitions.

This is a recording proposal. Do not imply continuous real-time execution where cuts or speed-up are used. Do not label the current coding segment as a fully live clap-to-Claude success until the native wake, owner approval and spoken handoff have been rehearsed together. Keep the broader calendar-day product requirements; recording should select a coherent, inspectable story.

## Explicit schedule queries: October 11 delivery

A spoken schedule question uses a typed fresh EventKit query through the native app. Query windows are 1–7 local calendar days, with timezone-aware day boundaries. Existing full Calendar access is reused; denied access is reported. Configured calendar IDs remain the read boundary. When no calendars have been selected, an explicit question may read available calendars for that query without enabling proactive observation or changing configuration. Results include actual event times, source calendars, read time and truncation. Empty, unavailable and stale results remain distinguishable; no window title or Notes document substitutes for calendar evidence.
