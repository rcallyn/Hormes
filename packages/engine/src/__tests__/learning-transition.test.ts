import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkCoordinator } from "../work/coordinator.ts";
import { WorkStore } from "../work/store.ts";
import type { WorkCommand, WorkReply, WorkScope } from "@hormes/protocol";
import type { Brain, BrainTask, BrainResult } from "@hormes/brain";

function fixture(t: { after(fn: () => void | Promise<void>): void }) {
  const dir = mkdtempSync(join(tmpdir(), "hormes-learning-transition-"));
  const replies: WorkReply[] = [];
  const requests: BrainTask[] = [];
  let noteFailure = false;
  let holdNotes = false;
  let finishNotes: (() => void) | undefined;
  const brain: Brain = {
    kind: "test", start: async () => ({ ready: true, detail: "ready" }),
    handle: async (task): Promise<BrainResult> => {
      requests.push(task);
      const current = work.store.state().active!;
      if (task.request.includes("lecture notes")) {
        if (holdNotes) {
          await new Promise<void>(resolve => { finishNotes = resolve; });
          if (task.signal.aborted) return { status: "failed", error: "Cancelled" };
        }
        if (noteFailure) return { status: "failed", error: "Summary service unavailable" };
        const lecture = current.lecture!;
        work.model(task.work!, "lecture", {
          text: "Exchange economies redistribute a fixed endowment. With x as numeraire, income is x endowment plus p times y endowment.",
          takeaways: ["The fixed endowment is redistributed; there is no production.", "At p = 3, endowment (2,1) has income 5."],
          sourceIds: [lecture.sourceId], revision: lecture.revision,
        });
      } else if (task.request.includes("exactly four")) {
        work.model(task.work!, "quiz", {
          title: "Previous lecture", sourceIds: current.sourceIds,
          cards: Array.from({ length: 4 }, (_, i) => ({ front: `Question ${i + 1}: income at p = 3?`, back: "2 + 3 = 5", options: ["2", "5", "3"], correctOption: 1 })),
        });
      }
      return { status: "done", summary: "Saved" };
    },
    cancel: async () => { finishNotes?.(); }, stop: async () => {},
  };
  const work = new WorkCoordinator({ stateDir: dir, redact: s => s, emit: reply => replies.push(reply), lane: () => ({ brain, runner: { setLane: () => {}, beginTurn: () => {} } }) });
  t.after(async () => { await work.stop(); rmSync(dir, { recursive: true, force: true }); });
  const send = (command: Omit<WorkCommand, "requestId"> & { requestId?: string }) => work.command({ ...command, requestId: command.requestId ?? randomUUID() });
  const capture = () => {
    work.record({ action: "lecture.begin", requestId: randomUUID() });
    const session = work.store.state().active!;
    work.store.captureInput(work.store.scope()!, session.lecture!.captureId!, randomUUID(), "Exchange economies redistribute a fixed endowment. With x normalized to one, income from (2,1) at p equals three is five.", true);
    return work.store.state().active!;
  };
  return { work, send, capture, requests, replies, dir, failNotes: (value: boolean) => { noteFailure = value; }, holdNotes: () => { holdNotes = true; }, releaseNotes: () => finishNotes?.() };
}

function quizSurface(work: WorkCoordinator) {
  const surface = work.store.state().active!.surface!;
  assert.equal(surface.kind, "quiz");
  if (surface.kind !== "quiz") throw new Error("Expected quiz");
  return surface;
}

async function waitForNotes(requests: BrainTask[]) {
  for (let i = 0; i < 20 && !requests.some(task => task.request.includes("lecture notes")); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(requests.some(task => task.request.includes("lecture notes")));
}

test("direct next-class entry saves current notes, accepts only MCQ clicks, and reopens with the old lecture intact", async t => {
  const { work, send, capture, requests, replies, dir } = fixture(t);
  await send({ action: "start", mode: "class" });
  const original = capture();
  await send({ action: "class.next", sessionId: original.id, title: "Statistics", courseId: "statistics", courseTitle: "Statistics" });
  assert.equal(replies.filter(reply => !reply.ok).length, 0);
  assert.equal(requests.length, 2);
  assert.match(requests[0]!.request, /lecture notes/);
  assert.match(requests[1]!.request, /exactly four/);
  const saved = work.store.state().sessions.find(session => session.id === original.id)!;
  assert.equal(saved.lecture!.status, "finished");
  assert.equal(saved.lecture!.notes!.revision, original.lecture!.revision);
  assert.deepEqual(saved.lecture!.notes!.sourceIds, [original.lecture!.sourceId]);
  const review = work.store.state().active!;
  const scope: WorkScope = work.store.scope()!;
  for (let i = 0; i < 4; i++) {
    const surface = quizSurface(work);
    const spoken = work.store.voice(scope, `discussion-${i}`, i === 0 ? "I think I need to review the budget first." : "The answer is five.", surface.id);
    assert.deepEqual(spoken, {});
    assert.equal(quizSurface(work).back, undefined);
    assert.equal(work.store.state().recallAttempts!.length, i);
    await send({ action: "quiz.answer", sessionId: review.id, surfaceId: surface.id, choiceIndex: i === 0 ? 0 : 1 });
    work.store.voice(scope, `next-${i}`, "Next question", surface.id);
    assert.equal(quizSurface(work).id, surface.id, "spoken next cannot bypass the click gate");
    await send({ action: "tool.next", sessionId: review.id });
  }
  const next = work.store.state().active!;
  assert.equal(next.mode, "class"); assert.equal(next.courseId, "statistics");
  assert.equal(next.lecture!.status, "ready"); assert.equal(next.lecture!.revision, 0);
  const attempts = work.store.state().recallAttempts!;
  assert.equal(attempts.length, 4); assert.ok(attempts.every(a => a.input === "choice"));
  assert.equal(attempts[0]!.result, "incorrect");
  work.store.close(); const reopen = new WorkStore(dir);
  try {
    assert.equal(reopen.state().active!.id, next.id);
    assert.equal(reopen.state().sessions.find(s => s.id === original.id)!.lecture!.notes!.takeaways.length, 2);
    assert.equal(reopen.state().recallAttempts!.length, 4);
  } finally { reopen.close(); }
});

test("failed transition notes leave the captured class retryable without a partial review", async t => {
  const { work, send, capture, replies, failNotes } = fixture(t);
  await send({ action: "start", mode: "class" }); const original = capture();
  failNotes(true);
  const command = { action: "class.next" as const, requestId: randomUUID(), sessionId: original.id, title: "Next lecture" };
  await send(command);
  assert.equal(work.store.state().active!.id, original.id);
  assert.equal(work.store.state().active!.lecture!.status, "finished");
  assert.equal(work.store.state().sessions.length, 1);
  assert.match(replies.at(-1)!.message!, /transcript is saved.*retry/i);
  assert.match(work.store.state().sources.find(s => s.id === original.lecture!.sourceId)!.text, /fixed endowment/);
  failNotes(false); await send(command);
  assert.equal(work.store.state().active!.classReview!.state, "ready");
  assert.equal(work.store.state().sessions.length, 2);
});

test("the next-class demo block finalizes notes without a separate End lecture click", async t => {
  const { work, send, capture } = fixture(t);
  await send({ action: "demo", blockId: "class" }); const original = capture();
  await send({ action: "demo", blockId: "class2" });
  assert.equal(work.store.state().active!.classReview!.fromSessionId, original.id);
  assert.equal(work.store.state().active!.demo, true);
  assert.equal(work.store.state().sessions.find(s => s.id === original.id)!.lecture!.notes!.revision, original.lecture!.revision);
});

test("a cancelled notes generation cannot reopen the old next-class target", async t => {
  const { work, send, capture, requests, holdNotes, replies } = fixture(t);
  await send({ action: "start", mode: "class" }); capture(); holdNotes();
  const requestId = randomUUID();
  const transition = send({ action: "class.next", requestId, title: "Superseded next class" });
  await waitForNotes(requests);
  assert.ok(replies.some(reply => reply.requestId === requestId && reply.ok), "acknowledge saved capture while the model is still working, before the UI timeout");
  await send({ action: "pause" }); await transition;
  assert.equal(work.store.state().active, undefined);
  assert.equal(work.store.state().sessions.length, 1);
  assert.equal(replies.filter(reply => !reply.ok).length, 0);
});

test("resuming lecture capture while transition notes run prevents a late next-class switch", async t => {
  const { work, send, capture, requests, holdNotes, releaseNotes } = fixture(t);
  await send({ action: "start", mode: "class" }); const original = capture(); holdNotes();
  const transition = send({ action: "class.next", title: "Superseded next class" });
  await waitForNotes(requests);
  work.record({ action: "lecture.begin", sessionId: original.id, requestId: randomUUID() });
  releaseNotes(); await transition;
  assert.equal(work.store.state().active!.id, original.id);
  assert.equal(work.store.state().active!.lecture!.status, "recording");
  assert.equal(work.store.state().sessions.length, 1);
});
