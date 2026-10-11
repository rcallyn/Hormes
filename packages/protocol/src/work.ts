/** Durable Hormes work. Calendar time is presentation context; `at` is always real time. */
export const WORK_MODES = ["class", "review", "study", "exam", "coding", "meeting", "travel", "grocery", "break"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export interface WorkScope { readonly sessionId: string; readonly mode: WorkMode }
export interface WorkCourse { id: string; title: string }
export interface WorkGoal {
  id: string; title: string; kind: "learning" | "meeting" | "travel" | "grocery" | "coding";
  state: "in-progress" | "complete"; criteria: string[]; next: string;
  version: number; updatedAt: number;
  courseId?: string;
  /** Optional for legacy records; new authored goals always declare an outcome. */
  outcome?: string; deadline?: number; criteriaVersion?: number;
  /** Only the application can select a supported automatic verifier. */
  assessment?: "exchange-reference" | "user-review";
}
/** Full user-authored replacement; omit deadline to clear it when revising. */
export interface WorkGoalInput {
  title: string; outcome: string; kind: WorkGoal["kind"]; criteria: string[];
  deadline?: number; courseId?: string;
}
export interface WorkSource {
  id: string; title: string; kind: "course" | "demo" | "web" | "lecture" | "meeting" | "code" | "note";
  text: string; at: number; url?: string; path?: string;
  origin: "supplied" | "tool";
  courseId?: string;
}
export interface WorkObservation {
  id: string; goalId: string; sessionId: string; at: number;
  kind: "question" | "answer" | "hint" | "tutor" | "recap" | "tool" | "action" | "lecture" | "meeting";
  actor: "student" | "assistant" | "tool" | "lecturer" | "participant"; text: string; exerciseId?: string;
  input?: "voice" | "typed"; utteranceId?: string;
}
export interface WorkEvidence {
  id: string; observationId: string; sessionId: string; goalId: string;
  exerciseId: string; at: number; criterion: string; correct: boolean;
  assistance: "independent" | "assisted"; method: "reference-check";
  answer: string; feedback: string; limitations: string;
  /** User correction; the original observation and assessment remain in history. */
  invalidated?: { at: number; reason: string };
}
export interface WorkIntervention {
  id: string; goalId: string; sessionId: string; at: number;
  kind: "practice" | "follow-up" | "travel-review";
  state: "proposed" | "accepted" | "done"; text: string; reason: string;
  sourceIds: string[];
}
export interface WorkExercise {
  id: string; title: string; prompt: string; sourceId: string;
  kind: "review" | "exchange" | "foundation"; independent: boolean;
}
export interface WorkBoardPlan { id: string; json: string; at: number; purpose: "problem" | "tutor" }
/** The renderer receives a card back only after a real spoken attempt. */
export type WorkLearningSurface =
  | { id: string; kind: "whiteboard" }
  | { id: string; kind: "lecture" | "class-review" }
  | { id: string; kind: "flashcard" | "quiz"; deckId: string; cardId: string; front: string; options?: string[]; index: number; total: number; back?: string; attemptId?: string; revealedAt?: number }
  | { id: string; kind: "image"; sourceId: string; url: string; caption: string }
  | { id: string; kind: "break"; endsAt: number; reason: string };
export interface WorkRecallPlan {
  deckId: string; enabled: boolean; nextDueAt: number; resumeSurface?: WorkLearningSurface;
}
export interface WorkDeck {
  id: string; title: string; goalId: string; courseId?: string; sourceIds: string[];
  createdAt: number; cardCount: number; origin: "supplied" | "assistant"; demo: boolean; purpose: "recall" | "quiz";
}
export interface WorkRecallAttempt {
  origin?: "iphone"; deviceId?: string; clientAnsweredAt?: number;
  id: string; sessionId: string; goalId: string; deckId: string; cardId: string;
  at: number; front: string; answer: string; back: string;
  result: "correct" | "incorrect" | "forgot" | "ungraded";
  method: "exact-reference" | "ungraded"; assisted: boolean; demo: boolean;
  input: "voice" | "choice"; utteranceId?: string; choiceIndex?: number; nextDueAt: number; intervalMs: number;
}
export interface WorkLecture {
  status: "ready" | "recording" | "paused" | "question" | "finished";
  sourceId: string; revision: number; captureId?: string; startedAt?: number;
  draft?: string; caption?: string;
  answer?: { requestId: string; question: string; status: "thinking" | "ready" | "failed"; text?: string; error?: string; at: number; sourceIds: string[] };
  notes?: { text: string; takeaways: string[]; sourceIds: string[]; revision: number; at: number };
}
export interface WorkClassTarget { title: string; courseId: string; courseTitle: string; goalId?: string; calendarId?: string; calendarStartsAt?: number }
export interface WorkClassReview { fromSessionId: string; target: WorkClassTarget; state: "preparing" | "ready" | "failed"; error?: string }
/** Original capture and generated outputs stay separate. Review is never a send receipt. */
export interface WorkMeetingAttachment {
  id: string; sourceId: string; title: string; name: string; path: string;
  kind: "deck" | "spreadsheet"; mimeType: string; bytes: number; sha256: string;
  version: string; demo: boolean;
}
export interface WorkMeetingGmail {
  app: string; windowId: number; tabId: number; composeId: string; fingerprint: string; verifiedAt: number;
  status: "draft-prepared" | "send-attempted" | "send-requested"; byteBoundAttachments: boolean; error?: string;
}
export interface WorkMeeting {
  status: "ready" | "recording" | "paused" | "finished";
  sourceId: string; revision: number; captureId?: string; caption?: string; draft?: string;
  attachments: WorkMeetingAttachment[];
  brief?: { text: string; sourceIds: string[]; at: number };
  followUp?: {
    id: string; subject: string; body: string; to?: string; sourceIds: string[]; revision: number;
    attachmentIds: string[]; requests: string[]; reconnect?: string; at: number;
    reviewedAt?: number; exportPath?: string; gmail?: WorkMeetingGmail;
  };
}
export interface WorkSession {
  id: string; goalId: string; mode: WorkMode; title: string;
  state: "active" | "paused"; createdAt: number; updatedAt: number;
  next: string; version: number; calendarId?: string; demo: boolean;
  calendarStartsAt?: number;
  courseId?: string;
  education?: { skillId: string; returnSessionId?: string };
  exercise?: WorkExercise; scene?: string; sceneRevision: number;
  pendingPlan?: WorkBoardPlan;
  surface?: WorkLearningSurface; recallPlan?: WorkRecallPlan;
  focusClock?: { endsAt: number; breakSeconds: number };
  lecture?: WorkLecture; classReview?: WorkClassReview;
  meeting?: WorkMeeting;
  sourceIds: string[]; artifact?: string; artifactSourceIds: string[];
  travel?: TravelConstraints;
  grocery?: WorkGrocery;
}
/** Exact, read-only selection import shared by policy and the work store. */
export const READ_SELECTED_GROCERY_NOTE_SCRIPT = `tell application "Notes"
  set picked to selection
  if (count of picked) is not 1 then error "Select one grocery note in Notes."
  set chosen to item 1 of picked
  if password protected of chosen then error "Select an unlocked, unprotected grocery note."
  return "HORMES_SELECTED_NOTE_V1" & linefeed & (id of chosen as text) & linefeed & (modification date of chosen as text) & linefeed & (name of chosen as text) & linefeed & (plaintext of chosen as text)
end tell`;
export interface WorkGroceryItem {
  id: string; request: string;
  state: "pending" | "in-cart" | "unavailable" | "substitution-needs-review";
  receiptId?: string; quote?: string; product?: string; priceText?: string; url?: string; checkedAt?: number;
}
export interface WorkGrocery {
  phase: "needs-list" | "ready" | "working" | "review";
  note?: { id: string; title: string; revision: string; origin: "apple-notes" | "pasted"; sourceId: string; importedAt: number };
  /** Exact requested lines come from the imported note, never the assistant plan. */
  items: WorkGroceryItem[];
  plan: { id: string; text: string; itemIds: string[]; origin: "assistant" }[];
  review?: { at: number; summary: string; receiptIds: string[] };
  blocked?: { at: number; reason: string };
}
export interface TravelConstraints {
  origin: string; destination: string; date: string;
  departAfter: string; arriveBefore: string; preference: string;
}
export interface WorkCalendarSource { id: string; title: string; account: string }
export interface WorkCalendarEvent {
  id: string; title: string; startsAt: number; endsAt: number;
  calendar: string; sourceCalendarId?: string; mode?: WorkMode; goalId?: string; demo: boolean;
}
export interface WorkSessionSummary extends Omit<WorkSession, "scene" | "pendingPlan" | "travel"> {}
export interface WorkOffer {
  id: string; eventId: string; mode: WorkMode; title: string; reason: string;
  at: number; expiresAt: number; eventStartsAt: number;
}
/** Curated prerequisite organization, never inferred personal school history. */
export interface WorkEducationStage { id: string; title: string; description: string }
export interface WorkEducationSubject { id: string; title: string }
export interface WorkEducationEvidence {
  id: string; sessionId: string; goalId: string; observationId: string; exerciseId: string;
  at: number; correct: boolean; assistance: "independent" | "assisted";
  criterion: string; answer: string; feedback: string; limitations: string;
}
export interface WorkEducationPractice {
  skillId: string; goalId: string; courseId: string; label: string; reason: string;
}
export interface WorkEducationProgress {
  status: "unassessed" | "practicing" | "independent-checks";
  independentCorrect: number; independentAttempts: number;
  assistedCorrect: number; assistedAttempts: number;
  /** Durable attempt order; withdrawn or unlinked records are never included. */
  evidence: WorkEducationEvidence[];
  nextPractice?: WorkEducationPractice;
}
export interface WorkEducationSkill {
  id: string; title: string; description: string; stageId: string; subjectId: string;
  prerequisiteIds: string[];
  real: WorkEducationProgress; demo: WorkEducationProgress;
}
export interface WorkEducation {
  version: 1; limitation: string;
  stages: WorkEducationStage[]; subjects: WorkEducationSubject[];
  skills: WorkEducationSkill[];
  /** Actual open learning goals for Today, without claiming a current grade. */
  activeGoalIds: string[];
}
export type WorkTaskMode = "study" | "meeting" | "coding" | "grocery";
/** An imported source line is intent, never authorization or verified completion. */
export interface WorkTask {
  id: string; sourceId: string; noteId: string; noteTitle: string; noteRevision: string;
  text: string; line: number; status: "pending" | "in-progress" | "user-reported-done";
  version: number; createdAt: number; updatedAt: number;
  suggestedMode?: WorkTaskMode; mode?: WorkTaskMode; goalId?: string; sessionId?: string;
  reportedDoneAt?: number; supersededAt?: number;
  sourceHistory?: { sourceId: string; noteRevision: string; line: number; at: number }[];
}
export interface WorkState {
  tasks?: WorkTask[];
  education?: WorkEducation;
  courses?: WorkCourse[];
  goals: WorkGoal[]; sessions: WorkSessionSummary[]; active?: WorkSession;
  observations: WorkObservation[]; evidence: WorkEvidence[];
  interventions: WorkIntervention[]; sources: WorkSource[];
  calendar: WorkCalendarEvent[]; calendarSources?: WorkCalendarSource[]; selectedCalendarIds?: string[]; demoBlock?: string;
  quiet: boolean; busy: boolean; status: string;
  calendarEnabled: boolean; offer?: WorkOffer;
  decks?: WorkDeck[]; recallAttempts?: WorkRecallAttempt[];
}
export type WorkAction = "tasks.import" | "tasks.start" | "tasks.done" | "tasks.reopen" | "grocery.import" | "grocery.run" | "education.practice" | "education.return" | "goal.create" | "goal.revise" | "refresh" | "inspect" | "start" | "resume" | "pause" | "scene.save" | "board.applied" |
  "submit" | "evidence.invalidate" | "hint" | "question" | "ask" | "recap" | "accept" | "demo" | "calendar" | "travel" |
  "calendar.configure" | "calendar.link" | "offer.accept" | "offer.dismiss" | "lesson.prepare" | "lesson.begin" |
  "recall.configure" | "tool.next" | "quiz.answer" | "break.start" | "break.end" |
  "lecture.begin" | "lecture.pause" | "lecture.end" | "lecture.question" | "lecture.notes" | "class.next" | "class.review.retry" |
  "meeting.prepare" | "meeting.begin" | "meeting.pause" | "meeting.end" | "meeting.follow-up" | "meeting.review" | "meeting.gmail-draft" | "meeting.send";
export interface WorkCommand {
  action: WorkAction; requestId: string; sessionId?: string; mode?: WorkMode;
  text?: string; scene?: string; revision?: number; planId?: string; success?: boolean;
  blockId?: string; interventionId?: string; travel?: TravelConstraints;
  evidenceId?: string; skillId?: string; taskId?: string; expectedTaskVersion?: number;
  events?: WorkCalendarEvent[]; calendarSources?: WorkCalendarSource[]; selectedCalendarIds?: string[];
  goalId?: string; goalInput?: WorkGoalInput; expectedGoalVersion?: number;
  enabled?: boolean; offerId?: string;
  deckId?: string; durationSeconds?: number;
  surfaceId?: string; choiceIndex?: number;
  title?: string; courseId?: string; courseTitle?: string;
}
export interface WorkReply {
  requestId: string; ok: boolean; message?: string; speech?: string; voicePhase?: string; state: WorkState;
  /** Application-owned response to explicit user intent, never a model payload. */
  presentation?: "open";
}
