import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { WorkStore, exchangeAnswer } from "../work/store.ts";
import type { WorkCommand, WorkGoal, WorkGoalInput } from "@hormes/protocol";

const DAY = 86_400_000;
const learning = (): WorkGoalInput => ({ title: "Understand welfare", outcome: "Explain welfare tradeoffs without notes", kind: "learning", courseId: "microeconomics", criteria: ["Explain a new case without hints", "Identify a counterexample"] });
const editable = (goal: WorkGoal): WorkGoalInput => ({ title: goal.title, outcome: goal.outcome ?? goal.title, kind: goal.kind, criteria: goal.criteria, ...(goal.courseId ? { courseId: goal.courseId } : {}), ...(goal.deadline !== undefined ? { deadline: goal.deadline } : {}) });
function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-goals-"));
  let now = Date.UTC(2026, 9, 11);
  const store = new WorkStore(dir, () => now);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const send = (command: Omit<WorkCommand, "requestId"> & { requestId?: string }) => store.command({ ...command, requestId: command.requestId ?? randomUUID() });
  const solveExam = (goalId?: string) => {
    send({ action: "start", mode: "exam", ...(goalId ? { goalId } : {}) });
    const exercise = store.state().active!.exercise!;
    const a = exercise.prompt.match(/A owns \((\d+), (\d+)\)/)!;
    const b = exercise.prompt.match(/B owns \((\d+), (\d+)\)/)!;
    const result = exchangeAnswer([Number(a[1]), Number(a[2])], [Number(b[1]), Number(b[2])]);
    send({ action: "submit", text: `${result.price};${result.allocation.join(",")}` });
  };
  const history = (id: string): WorkGoal[] => {
    const db = new DatabaseSync(join(dir, "work", "work.sqlite"), { readOnly: true });
    try { return db.prepare("SELECT value FROM activity WHERE kind='goal' AND record_id=? ORDER BY seq").all(id).map(r => JSON.parse(String(r.value)) as WorkGoal); }
    finally { db.close(); }
  };
  return { dir, store, send, solveExam, history, advance: (ms: number) => { now += ms; } };
}

test("explicit goal creation is durable, idempotent and does not open or change a session", t => {
  const { store, send, dir, history } = fixture(t);
  const input = { ...learning(), title: "  Understand welfare  ", deadline: Date.UTC(2026, 10, 1) };
  const command: WorkCommand = { action: "goal.create", requestId: "new_goal", goalInput: input };
  assert.equal(store.command(command), true);
  assert.equal(store.command(command), false);
  const goal = store.state().goals[0]!;
  assert.equal(store.state().goals.length, 1);
  assert.equal(store.state().active, undefined);
  assert.equal(store.state().sessions.length, 0);
  assert.equal(goal.title, "Understand welfare");
  assert.equal(goal.deadline, input.deadline);
  assert.equal(goal.assessment, "user-review");
  assert.equal(goal.criteriaVersion, 1);
  assert.equal(goal.state, "in-progress");
  assert.equal(history(goal.id).length, 1);
  send({ action: "start", mode: "study", goalId: goal.id });
  const active = store.state().active!;
  assert.equal(active.goalId, goal.id);
  assert.equal(active.courseId, "microeconomics");
  send({ action: "goal.create", goalInput: { title: "Share deck", outcome: "Investor receives reviewed deck", kind: "meeting", criteria: ["Approved follow-up is sent"] } });
  assert.deepEqual(store.state().active, active);
  const saved = store.state(); store.close();
  const reopened = new WorkStore(dir);
  try { assert.deepEqual(reopened.state().goals, saved.goals); } finally { reopened.close(); }
  assert.deepEqual(store.state().goals, saved.goals);
});

test("revision enforces the displayed version, supports deadline clearing and preserves original history", t => {
  const { store, send, history } = fixture(t);
  send({ action: "goal.create", goalInput: { ...learning(), deadline: Date.UTC(2026, 10, 1) } });
  const original = store.state().goals[0]!;
  const command: WorkCommand = { action: "goal.revise", requestId: "revise_once", goalId: original.id, expectedGoalVersion: original.version, goalInput: { ...learning(), title: "Welfare review" } };
  assert.equal(store.command(command), true);
  assert.equal(store.command(command), false);
  const revised = store.state().goals[0]!;
  assert.equal(revised.version, original.version + 1);
  assert.equal(revised.criteriaVersion, original.criteriaVersion);
  assert.equal(revised.deadline, undefined);
  assert.deepEqual(history(original.id), [original, revised]);
  const before = store.state();
  assert.throws(() => send({ ...command, requestId: "stale_edit" }), /changed.*Reload/);
  assert.deepEqual(store.state(), before);
  assert.throws(() => send({ ...command, requestId: "wrong_goal", goalId: "missing" }), /saved goal/);
  assert.deepEqual(store.state(), before);
});

test("changing completed criteria reopens the goal without rewriting prior success or evidence", t => {
  const { store, send, solveExam, advance, history } = fixture(t);
  solveExam(); solveExam(); advance(DAY); solveExam();
  const completed = store.state().goals[0]!, evidence = store.state().evidence, priorSession = store.state().active!;
  assert.equal(completed.state, "complete");
  send({ action: "goal.revise", goalId: completed.id, expectedGoalVersion: completed.version, goalInput: { ...editable(completed), criteria: ["Prove welfare theorems for a new case"] } });
  const revised = store.state().goals[0]!;
  assert.equal(revised.state, "in-progress");
  assert.equal(revised.assessment, "user-review");
  assert.equal(revised.criteriaVersion, 2);
  assert.deepEqual(store.state().evidence, evidence);
  assert.ok(history(completed.id).some(g => g.state === "complete" && g.criteriaVersion === 1));
  assert.deepEqual(store.state().active!.exercise, priorSession.exercise, "revising criteria preserves the saved session's original exercise");
  send({ action: "start", mode: "exam", goalId: completed.id });
  assert.equal(store.state().active!.exercise, undefined);
  assert.equal(store.state().active!.sourceIds.includes("course_exchange"), false);
  assert.throws(() => send({ action: "submit", text: "2;3,1.5,3,1.5" }), /no exercise/);
  assert.deepEqual(store.state().evidence, evidence);
  assert.deepEqual(store.state().sessions.find(session => session.id === priorSession.id)!.exercise, priorSession.exercise);
  assert.equal(store.state().goals[0]!.state, "in-progress", "old numeric evidence cannot complete different criteria");
  assert.match(JSON.parse(store.context(store.scope()!)).goalAssessment, /Custom criteria require user review/);
});

test("changing only the outcome reopens fixed completion, while title and deadline edits preserve it", t => {
  const { store, send, solveExam, advance } = fixture(t);
  solveExam(); solveExam(); advance(DAY); solveExam();
  let goal = store.state().goals[0]!;
  send({ action: "goal.revise", goalId: goal.id, expectedGoalVersion: goal.version, goalInput: { ...editable(goal), title: "My exchange practice", deadline: Date.UTC(2026, 10, 1) } });
  goal = store.state().goals[0]!;
  assert.equal(goal.state, "complete"); assert.equal(goal.assessment, "exchange-reference"); assert.equal(goal.criteriaVersion, 1);
  send({ action: "goal.revise", goalId: goal.id, expectedGoalVersion: goal.version, goalInput: { ...editable(goal), outcome: "Master all of economics" } });
  goal = store.state().goals[0]!;
  assert.equal(goal.state, "in-progress"); assert.equal(goal.assessment, "user-review"); assert.equal(goal.criteriaVersion, 2);
});

test("user-created criteria cannot acquire the fixed checker even by copying its exact strings", t => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "exam" });
  const reference = store.state().goals[0]!;
  send({ action: "goal.create", goalInput: editable(reference) });
  const custom = store.state().goals.find(g => g.id !== reference.id)!;
  for (const mode of ["study", "exam", "review"] as const) {
    send({ action: "start", mode, goalId: custom.id });
    assert.equal(store.state().active!.exercise, undefined);
    assert.equal(store.state().active!.recallPlan, undefined);
    assert.equal(store.state().active!.sourceIds.includes("course_exchange"), false);
    assert.throws(() => send({ action: "submit", text: "2;3,1.5,3,1.5" }), /no exercise/);
  }
  assert.equal(store.state().evidence.filter(e => e.goalId === custom.id).length, 0);
  assert.equal(store.state().goals.find(g => g.id === custom.id)!.state, "in-progress");
  assert.equal(store.state().goals.find(g => g.id === custom.id)!.assessment, "user-review");
});

test("saved course binding stays compatible across creation, manual start, calendar linking and revision", t => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "class", courseId: "biology", courseTitle: "Biology" });
  send({ action: "pause" });
  send({ action: "goal.create", goalInput: { ...learning(), courseId: "biology", title: "Cell division" } });
  const custom = store.state().goals.find(g => g.title === "Cell division")!;
  send({ action: "start", mode: "study", goalId: custom.id });
  assert.equal(store.state().active!.courseId, "biology");
  assert.equal(store.state().active!.exercise, undefined, "other courses cannot receive the fixed Microeconomics grader");
  const startsAt = Date.UTC(2026, 9, 11);
  send({ action: "calendar", events: [{ id: "biology-event", title: "Biology study", startsAt, endsAt: startsAt + 3_600_000, calendar: "Study", demo: false }] });
  send({ action: "calendar.link", blockId: "biology-event", mode: "study", goalId: custom.id, courseId: "biology" });
  assert.equal(store.state().calendar[0]!.goalId, custom.id);
  const before = store.state();
  for (const goalInput of [{ ...editable(custom), courseId: "microeconomics" }, { ...editable(custom), kind: "meeting", courseId: undefined }] as unknown as WorkGoalInput[]) {
    assert.throws(() => send({ action: "goal.revise", goalId: custom.id, expectedGoalVersion: custom.version, goalInput }), /cannot change/);
    assert.deepEqual(store.state(), before);
  }
  assert.throws(() => send({ action: "start", mode: "meeting", goalId: custom.id }), /compatible/);
  assert.deepEqual(store.state(), before);
});

test("invalid goal inputs and caller-selected state are rejected atomically", t => {
  const { store, send } = fixture(t);
  const before = store.state();
  const invalid: unknown[] = [undefined, {}, { ...learning(), title: " " }, { ...learning(), outcome: "x".repeat(2001) }, { ...learning(), criteria: [] }, { ...learning(), criteria: ["one", " one "] }, { ...learning(), criteria: ["x".repeat(501)] }, { ...learning(), criteria: Array.from({ length: 13 }, (_, i) => String(i)) }, { ...learning(), deadline: NaN }, { ...learning(), deadline: 1.5 }, { ...learning(), deadline: 9e15 }, { ...learning(), courseId: "missing" }, { ...learning(), courseId: undefined }, { ...learning(), kind: "meeting" }, { ...learning(), state: "complete" }, { ...learning(), assessment: "exchange-reference" }];
  for (const goalInput of invalid) {
    assert.throws(() => send({ action: "goal.create", goalInput } as WorkCommand));
    assert.deepEqual(store.state(), before);
  }
  assert.throws(() => send({ action: "goal.create", goalInput: learning(), goalId: "goal_learning" }), /assigned by the application/);
  assert.throws(() => send({ action: "goal.revise", goalInput: learning(), goalId: "missing" }), /current version/);
  assert.deepEqual(store.state(), before);
});

test("model tools cannot author, revise or complete goals and intervening progress rejects a stale edit", t => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "exam" });
  const goal = store.state().goals[0]!, scope = store.scope()!, before = store.state();
  for (const op of ["goal.create", "goal.revise", "goal.complete"]) {
    assert.throws(() => store.model(scope, op, { goalId: goal.id, goalInput: learning(), state: "complete" }), /Unknown work operation/);
    assert.deepEqual(store.state(), before);
  }
  send({ action: "submit", text: "9" });
  const afterProgress = store.state();
  assert.throws(() => send({ action: "goal.revise", goalId: goal.id, expectedGoalVersion: goal.version, goalInput: editable(goal) }), /changed.*Reload/);
  assert.deepEqual(store.state(), afterProgress);
});

test("legacy fixed goals retain completion only with the original supported criteria", t => {
  const { store, send, dir, solveExam, advance } = fixture(t);
  send({ action: "start", mode: "exam" });
  const original = store.state().goals[0]!;
  const { assessment: _assessment, outcome: _outcome, criteriaVersion: _criteriaVersion, ...legacy } = original;
  store.close();
  const db = new DatabaseSync(join(dir, "work", "work.sqlite"));
  try { db.prepare("UPDATE records SET value=? WHERE kind='goal' AND id=?").run(JSON.stringify(legacy), legacy.id); }
  finally { db.close(); }
  send({ action: "goal.revise", goalId: legacy.id, expectedGoalVersion: legacy.version, goalInput: { ...editable(legacy), title: "Renamed legacy goal" } });
  assert.equal(store.state().goals[0]!.assessment, "exchange-reference");
  solveExam(); solveExam(); advance(DAY); solveExam();
  assert.equal(store.state().goals[0]!.state, "complete");
});


test("unsupported legacy criteria cannot inherit the fixed verifier", t => {
  const { store, send, dir } = fixture(t);
  send({ action: "start", mode: "exam" });
  const original = store.state().goals[0]!;
  const { assessment: _assessment, outcome: _outcome, criteriaVersion: _criteriaVersion, ...legacy } = original;
  legacy.criteria = ["Prove a new welfare result"];
  store.close();
  const db = new DatabaseSync(join(dir, "work", "work.sqlite"));
  try { db.prepare("UPDATE records SET value=? WHERE kind='goal' AND id=?").run(JSON.stringify(legacy), legacy.id); }
  finally { db.close(); }
  send({ action: "start", mode: "exam" });
  assert.equal(store.state().active!.exercise, undefined);
  assert.throws(() => send({ action: "submit", text: "2;3,1.5,3,1.5" }), /no exercise/);
  assert.equal(store.state().evidence.length, 0);
  assert.equal(store.state().goals[0]!.state, "in-progress");
  assert.match(JSON.parse(store.context(store.scope()!)).goalAssessment, /Custom criteria require user review/);
});

test("custom coding goals are saved for planning and cannot start, link or resume the EvoSim executor", t => {
  const { store, send, dir } = fixture(t);
  send({ action: "start", mode: "coding" });
  const original = store.state().active!, builtIn = store.state().goals[0]!;
  send({ action: "goal.create", goalInput: editable(builtIn) });
  const custom = store.state().goals.find(g => g.id !== builtIn.id)!;
  send({ action: "start", mode: "study" });
  const startsAt = Date.UTC(2026, 9, 11);
  send({ action: "calendar", events: [{ id: "coding-event", title: "Build my project", startsAt, endsAt: startsAt + 3_600_000, calendar: "Work", demo: false }] });
  // A pre-upgrade stored session must not bypass the same boundary on resume.
  store.close();
  const db = new DatabaseSync(join(dir, "work", "work.sqlite"));
  try { db.prepare("INSERT INTO records VALUES('session',?,?)").run("legacy_custom_coding", JSON.stringify({ ...original, id: "legacy_custom_coding", goalId: custom.id, state: "paused" })); }
  finally { db.close(); }
  const before = store.state();
  for (const command of [
    { action: "start", mode: "coding", goalId: custom.id },
    { action: "start", mode: "coding", blockId: "coding-event", goalId: custom.id },
    { action: "calendar.link", mode: "coding", blockId: "coding-event", goalId: custom.id },
    { action: "resume", sessionId: "legacy_custom_coding" },
  ] as const) {
    assert.throws(() => send(command), /saved for planning.*built-in EvoSim/);
    assert.deepEqual(store.state(), before, "rejected custom execution leaves active work and links intact");
  }
  send({ action: "resume", sessionId: original.id });
  assert.equal(store.state().active!.id, original.id, "supported bounded coding still resumes");
});

test("an existing EvoSim session cannot be silently retargeted by revising its goal outcome", t => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "coding" });
  let goal = store.state().goals[0]!;
  const before = store.state();
  assert.throws(() => send({ action: "goal.revise", goalId: goal.id, expectedGoalVersion: goal.version, goalInput: { ...editable(goal), outcome: "Build an unrelated app" } }), /fixed after work starts/);
  assert.deepEqual(store.state(), before);
  send({ action: "goal.revise", goalId: goal.id, expectedGoalVersion: goal.version, goalInput: { ...editable(goal), title: "My bounded benchmark", criteria: ["Review the protected benchmark receipt"] } });
  goal = store.state().goals[0]!;
  assert.equal(goal.title, "My bounded benchmark");
  assert.equal(goal.assessment, "user-review");
  send({ action: "pause" });
  assert.throws(() => send({ action: "goal.revise", goalId: goal.id, expectedGoalVersion: goal.version, goalInput: { ...editable(goal), outcome: "Build an unrelated app" } }), /fixed after work starts/);
});

test("a revised unstarted built-in coding outcome cannot inherit execution through a default start or link", t => {
  const { store, send } = fixture(t);
  const startsAt = Date.UTC(2026, 9, 11);
  send({ action: "calendar", events: [{ id: "coding-event", title: "Project", startsAt, endsAt: startsAt + 3_600_000, calendar: "Work", demo: false }] });
  send({ action: "calendar.link", blockId: "coding-event", mode: "coding" });
  const goal = store.state().goals[0]!;
  send({ action: "goal.revise", goalId: goal.id, expectedGoalVersion: goal.version, goalInput: { ...editable(goal), outcome: "Create another application" } });
  const before = store.state();
  assert.throws(() => send({ action: "start", mode: "coding" }), /saved for planning/);
  assert.throws(() => send({ action: "calendar.link", mode: "coding", blockId: "coding-event" }), /saved for planning/);
  assert.deepEqual(store.state(), before);
});


test("a custom monopoly-pricing goal never injects exchange exercises, flashcards or another goal's lecture", t => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "class" }); send({ action: "lecture.begin" });
  let lecture = store.state().active!.lecture!;
  store.captureInput(store.scope()!, lecture.captureId!, "exchange-capture", "Exchange economies clear a fixed endowment across consumers.", true);
  const unrelatedSource = lecture.sourceId;
  send({ action: "lecture.pause" });
  send({ action: "goal.create", goalInput: { ...learning(), title: "Monopoly pricing", outcome: "Find a monopolist's optimal price", criteria: ["Compare marginal revenue with marginal cost on a new problem"] } });
  const goal = store.state().goals.find(g => g.title === "Monopoly pricing")!;
  for (const mode of ["study", "exam", "review"] as const) {
    send({ action: "start", mode, goalId: goal.id });
    const session = store.state().active!;
    assert.equal(session.title, goal.title); assert.equal(session.courseId, "microeconomics");
    assert.equal(session.exercise, undefined); assert.equal(session.recallPlan, undefined);
    assert.equal(session.sourceIds.includes("course_exchange"), false);
    assert.equal(session.sourceIds.includes(unrelatedSource), false);
    send({ action: "lesson.begin" });
    assert.equal(store.state().active!.pendingPlan, undefined, "no unrelated problem is queued on the blank board");
    store.voice(store.scope()!, `numeric-${mode}`, "The price is two.");
    assert.equal(store.state().evidence.length, 0);
    assert.equal(store.state().decks!.filter(deck => deck.goalId === goal.id).length, 0);
    const context = JSON.parse(store.context(store.scope()!));
    assert.equal(context.goal.outcome, goal.outcome);
    assert.deepEqual(context.sources, []);
  }
  assert.equal(store.state().goals.find(g => g.id === goal.id)!.state, "in-progress");
});

test("custom study retains its own lecture while excluding another goal in the same course", t => {
  const { store, send } = fixture(t);
  send({ action: "goal.create", goalInput: { ...learning(), title: "Monopoly pricing" } });
  const firstGoal = store.state().goals[0]!;
  send({ action: "start", mode: "class", goalId: firstGoal.id }); send({ action: "lecture.begin" });
  const lecture = store.state().active!.lecture!;
  store.captureInput(store.scope()!, lecture.captureId!, "monopoly-capture", "A monopoly compares marginal revenue and marginal cost.", true);
  send({ action: "lecture.pause" });
  send({ action: "goal.create", goalInput: { ...learning(), title: "Risk preferences" } });
  const secondGoal = store.state().goals.find(g => g.title === "Risk preferences")!;
  send({ action: "start", mode: "study", goalId: secondGoal.id });
  assert.equal(store.state().active!.sourceIds.includes(lecture.sourceId), false);
  send({ action: "start", mode: "study", goalId: firstGoal.id });
  assert.deepEqual(store.state().active!.sourceIds, [lecture.sourceId]);
  assert.match(store.context(store.scope()!), /marginal revenue and marginal cost/);
  assert.equal(store.state().active!.exercise, undefined);
  store.model(store.scope()!, "deck", { title: "Monopoly recall", sourceIds: [lecture.sourceId], cards: [{ front: "Which two quantities does a monopoly compare?", back: "Marginal revenue and marginal cost", answers: ["marginal revenue and marginal cost"] }] });
  const armed = store.state().active!;
  assert.ok(armed.recallPlan?.enabled, "explicitly created custom recall remains usable");
  send({ action: "pause" }); send({ action: "resume", sessionId: armed.id });
  assert.deepEqual(store.state().active!.recallPlan, armed.recallPlan, "resuming actual saved custom work retains its explicit recall plan");
});


test("revising an exchange goal does not automatically re-arm its old curriculum in new study", t => {
  const { store, send } = fixture(t);
  send({ action: "start", mode: "review" });
  const oldSession = store.state().active!, goal = store.state().goals[0]!, decks = store.state().decks;
  assert.equal(oldSession.surface!.kind, "flashcard"); assert.ok(oldSession.recallPlan);
  send({ action: "goal.revise", goalId: goal.id, expectedGoalVersion: goal.version, goalInput: { ...editable(goal), title: "Monopoly pricing", outcome: "Learn monopoly pricing", criteria: ["Compare marginal revenue and marginal cost"] } });
  send({ action: "start", mode: "study", goalId: goal.id });
  const current = store.state().active!;
  assert.equal(current.title, "Monopoly pricing");
  assert.equal(current.exercise, undefined); assert.equal(current.recallPlan, undefined);
  assert.equal(current.sourceIds.includes("course_exchange"), false);
  assert.deepEqual(store.state().decks, decks, "the historical deck is preserved for explicit review");
  assert.deepEqual(store.state().sessions.find(session => session.id === oldSession.id)!.surface, oldSession.surface);
});
