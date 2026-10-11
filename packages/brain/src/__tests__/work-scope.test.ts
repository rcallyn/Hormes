import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRunner, makeSink, makeTask, FakeHands } from "./fakes.ts";

test("work runner blocks execution and stale capability before touching native hands", async () => {
  let calls = 0, active = true;
  class Hands extends FakeHands { override async request<T>(op: string): Promise<T> { calls++; return super.request<T>(op); } }
  const { runner } = makeRunner({ work: { isActive: () => active, model: () => "context", receipt() { return undefined; } } }, new Hands());
  runner.attach(makeSink().sink, { ...makeTask("Study"), work: { sessionId: "session", mode: "study" } });
  assert.equal((await runner.run("left_click", { coordinate: [10, 10] })).result.kind, "error");
  assert.equal((await runner.run("run_shell", { command: "echo bypass" })).result.kind, "error");
  assert.equal((await runner.run("work", { operation: "context", payload: {} })).result.kind, "text");
  active = false;
  assert.equal((await runner.run("work", { operation: "context", payload: {} })).result.kind, "error");
  assert.equal(calls, 0);
});

test("work keeps multiline handwriting as a structured payload without a second JSON decoding pass", async () => {
  let received:unknown;
  const {runner}=makeRunner({work:{isActive:()=>true,model:(_scope,_operation,payload)=>{received=payload;return 'queued';},receipt(){return undefined;}}});
  runner.attach(makeSink().sink,{...makeTask('A small handwritten hint'),work:{sessionId:'session',mode:'study'}});
  const payload={summary:'Budget hint',operations:[{type:'write',tempId:'hint',text:'mₐ = 2 + p\nTry the next step',x:60,y:320}]};
  assert.equal((await runner.run('work',{operation:'board',payload})).result.kind,'text');assert.deepEqual(received,payload);
  assert.equal((await runner.run('work',{operation:'board',payload:JSON.stringify(payload)})).result.kind,'error');
});
