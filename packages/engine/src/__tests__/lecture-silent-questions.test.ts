import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { WorkCommand, WorkReply } from "@hormes/protocol";
import { world, until, tempDir, testConfig } from "./world.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }, provider: "openai" | "gemini" = "openai") {
  const dir = tempDir("hormes-silent-class-");
  const w = world({ config: testConfig(dir, { openaiApiKey: "sk-test-not-used", geminiApiKey: "test-gemini-not-used" }) }, { dir, voiceProvider: provider });
  t.after(() => w.engine.stop());
  const replies: WorkReply[] = []; let audio = 0;
  w.engine.on("event", e => { if (e.type === "work.state") replies.push(e.reply); });
  w.engine.on("audio", () => audio++);
  await w.engine.start(); await w.engine.ready();
  const send = (c: Omit<WorkCommand,"requestId"> & { requestId?: string }) => w.engine.command({ type: "work.command", command: { ...c, requestId: c.requestId ?? randomUUID() } });
  await send({ action: "start", mode: "class" }); await send({ action: "lecture.begin" });
  const active = () => w.engine.work.store.state().active!;
  const live = w.lives.at(-1)!;
  const teacher = (text: string, start = 1000) => { live.emit("inputTranscript", text, start, start+600); live.emit("turnEnd", "user"); };
  teacher("The price ratio compares the price of y to the price of x.");
  return { w, send, active, live, teacher, replies, audio: () => audio };
}

for (const provider of ["openai", "gemini"] as const) test(`${provider}: a written class answer preserves the recording and excludes AI audio/source injection`, async t => {
  const f = await fixture(t, provider), {w,send,active,live,teacher} = f;
  const captureId = active().lecture!.captureId, sourceId = active().lecture!.sourceId;
  const command = { action: "lecture.question" as const, requestId: "written-question", sessionId: active().id, text: "Why can we set one price to one?" };
  const asking = send(command);
  await until(() => w.threads.brains.some(b => b.tasks.length > 0));
  const brain = w.threads.brains.find(b => b.tasks.length > 0)!;
  assert.equal(brain.tasks[0]!.lectureQuestion, true);
  assert.equal(brain.tasks[0]!.interactionMode, "general");
  assert.match(brain.tasks[0]!.workInstructions!, /written.*question/);
  assert.equal(active().lecture!.answer!.status, "thinking");
  teacher("Only relative prices determine these budget choices.", 2000);
  brain.sink!.commentary("Choosing a numeraire changes units, not relative prices.");
  live.emit("outputTranscript", "This must never be said", 2200, 2500);
  live.emit("audio", Buffer.alloc(480, 9));
  live.emit("delegation", "untrusted-lecture-request", "client", live.nowMs);
  assert.equal(f.audio(), 0); assert.deepEqual(live.commentary, []);
  assert.equal(active().lecture!.captureId, captureId); assert.equal(live.currentState, "started");
  assert.equal(w.lives.length, 1); assert.equal(active().lecture!.status, "recording");
  const context = await brain.runner.run("work", {operation:"context",payload:{}});
  assert.equal(context.result.kind,"text");
  for (const [tool,input] of [["speak_progress",{text:"Speak"}],["work",{operation:"lecture",payload:{text:"Forged notes"}}],["work",{operation:"break",payload:{seconds:30}}],["tasks",{operation:"import",payload:{}}]] as const) {
    const outcome = await brain.runner.run(tool,input);
    assert.equal(outcome.result.kind,"error");
    assert.match(outcome.result.kind === "error" ? outcome.result.message : "",/silent lecture question/);
  }
  brain.resolve!({status:"done",summary:"We measure prices in units of x; relative prices and the budget choices are unchanged."}); await asking;
  assert.equal(active().lecture!.answer!.status,"ready");
  teacher("The lecture continues after the written explanation.", 4000);
  assert.equal(active().lecture!.revision,3);
  assert.equal(active().lecture!.answer!.question,command.text);
  assert.ok(active().lecture!.answer!.sourceIds.includes(sourceId));
  assert.match(active().lecture!.answer!.text!,/units of x/);
  const source = w.engine.work.store.state().sources.find(s=>s.id===sourceId)!.text;
  assert.match(source,/Only relative prices/); assert.doesNotMatch(source,/numeraire|units of x|must never/);
  assert.equal(w.engine.work.store.state().evidence.length,0); assert.equal(w.brain.tasks.length,0);
  assert.ok(f.replies.every(r=>!r.speech)); assert.equal(f.audio(),0);
  await send(command); assert.equal(brain.tasks.length,1,"replay does not request a second answer");
});

test("invalid, stale and concurrent questions leave the original capture and question untouched", async t => {
  const f=await fixture(t), {w,send,active,live}=f;
  const captureId=active().lecture!.captureId;
  for(const command of [{text:"",sessionId:active().id},{text:"Question",sessionId:"missing"}]) await send({action:"lecture.question",...command});
  assert.equal(w.threads.brains.filter(b=>b.tasks.length).length,0);
  const asking=send({action:"lecture.question",requestId:"current-question",sessionId:active().id,text:"Explain relative prices"});
  await until(()=>w.threads.brains.some(b=>b.tasks.length)); const brain=w.threads.brains.find(b=>b.tasks.length)!;
  await send({action:"lecture.question",requestId:"other-question",sessionId:active().id,text:"Replace that question"});
  assert.equal(active().lecture!.answer!.requestId,"current-question"); assert.equal(brain.cancels,0);
  assert.equal(active().lecture!.captureId,captureId); assert.equal(live.currentState,"started");
  brain.resolve!({status:"failed",error:"Synthetic cloud failure"}); await asking;
  assert.equal(active().lecture!.answer!.status,"failed");assert.match(active().lecture!.answer!.error!,/Synthetic cloud failure/);
  f.teacher("Capture continues even when the answer fails.",3000);
  assert.match(w.engine.work.store.state().sources.find(s=>s.id===active().lecture!.sourceId)!.text,/Capture continues/);
});

test("typed general input during a lecture uses the same silent path; pause cancels only the pending answer", async t=>{
  const f=await fixture(t),{w,active,live,send}=f;
  const asking=w.engine.sayText("Explain the last sentence in writing");
  await until(()=>w.threads.brains.some(b=>b.tasks.length));const brain=w.threads.brains.find(b=>b.tasks.length)!;
  assert.equal(brain.tasks[0]!.lectureQuestion,true);assert.equal(live.commentary.length,0);
  await send({action:"lecture.pause"});await asking;
  assert.equal(active().lecture!.status,"paused");assert.equal(active().lecture!.answer!.status,"failed");
  assert.equal(live.currentState,"closed");assert.equal(active().lecture!.answer!.text,undefined);
  assert.ok(brain.tasks[0]!.signal.aborted);assert.equal(f.audio(),0);
});

test("switching sessions discards late written answer content and retains the original lecture", async t=>{
  const f=await fixture(t),{w,send,active,live}=f;
  const original=active();
  const asking=send({action:"lecture.question",sessionId:original.id,text:"Explain this captured definition"});
  await until(()=>w.threads.brains.some(b=>b.tasks.length));const brain=w.threads.brains.find(b=>b.tasks.length)!;
  const late=brain.sink!.commentary;
  await send({action:"start",mode:"study"});await asking;
  late("Late answer must not appear in the new lesson");
  assert.equal(active().mode,"study");assert.equal(active().lecture,undefined);
  const saved=w.engine.work.store.state().sessions.find(s=>s.id===original.id)!;
  assert.equal(saved.lecture!.answer!.status,"failed");assert.equal(saved.lecture!.answer!.text,undefined);
  assert.ok(brain.tasks[0]!.signal.aborted);assert.equal(live.currentState,"closed");
  assert.match(w.engine.work.store.state().sources.find(s=>s.id===saved.lecture!.sourceId)!.text,/price ratio/);
});
