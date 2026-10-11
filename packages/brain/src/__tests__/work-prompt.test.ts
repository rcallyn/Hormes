import { test } from "node:test";
import assert from "node:assert/strict";
import { delegationPrompt, historyPrompt } from "../anthropic.ts";
import { makeTask } from "./fakes.ts";

for (const mode of ["grocery", "meeting", "travel", "coding", "class", "break"] as const) test(`${mode} work does not inherit whiteboard tutoring instructions`, () => {
  const task = { ...makeTask("Continue the requested work"), work: { sessionId: "saved", mode }, workInstructions: "Use only this mode's allowed tools. Never checkout or purchase." };
  const rendered = delegationPrompt(task);
  assert.doesNotMatch(rendered, /work\.board|handwritten hint|Give one small step and wait|checks spoken attempts/);
  assert.match(rendered, /Never checkout or purchase/, "the concrete task constraints are retained");
  assert.equal(historyPrompt(task), rendered, "the same instructions persist in carried history");
});

test("application workflow steps stay separate from already-found source data in every shared prompt", () => {
  const request = "Prepare my grocery cart from the selected note.";
  const task = { ...makeTask(request), work: { sessionId: "saved", mode: "grocery" as const }, groceryRun: true,
    workInstructions: "Read the existing cart, preserve unrelated items, and save a receipt-backed cart review. Never checkout.",
    notes: ["SOURCE_DATA: Milk; Eggs; Bananas. Original note and fresh browser receipt are saved."],
  };
  for (const prompt of [delegationPrompt(task), historyPrompt(task)]) {
    const guidance = prompt.indexOf("Application workflow instructions for this request");
    const currentRequest = prompt.indexOf(`User said: "${request}"`);
    const found = prompt.indexOf("Already done or found by Hormes");
    assert.ok(guidance >= 0 && guidance < currentRequest && currentRequest < found);
    assert.match(prompt.slice(guidance, currentRequest), /Read the existing cart.*Never checkout/);
    assert.doesNotMatch(prompt.slice(found), /Read the existing cart|Never checkout/);
    assert.doesNotMatch(prompt.slice(guidance, currentRequest), /SOURCE_DATA/);
    assert.match(prompt.slice(found), /SOURCE_DATA/);
  }
});
for (const mode of ["study", "exam", "review"] as const) test(`${mode} tutoring instruction is conditional on the current learning request`, () => {
  const task = { ...makeTask("What is on my calendar today?"), interactionMode: "education" as const, work: { sessionId: "saved", mode } };
  const rendered = delegationPrompt(task);
  assert.match(rendered, /When the current request concerns learning/);
  assert.match(rendered, /work\.board/, "requested learning still has handwritten hints");
  assert.match(rendered, /explicit schedule question.*read_calendar/);
  assert.doesNotMatch(rendered, /session: read work.context first/);
});


test("saved learning work without an explicit education binding stays a general assistant task", () => {
  const task = { ...makeTask("What is on my calendar today?"), work: { sessionId: "saved", mode: "study" as const } };
  const prompt = delegationPrompt(task);
  assert.match(prompt, /General assistant interaction/);
  assert.doesNotMatch(prompt, /work\.board|Give one small step|checks spoken attempts/);
});


test("saved unfinished work has its own data label before the request, separate from completed reflex notes", () => {
  const task = { ...makeTask("Prepare my grocery cart now"), work: { sessionId: "saved", mode: "grocery" as const }, groceryRun: true,
    workInstructions: "Execute with tools. Never checkout.", workContext: '{"phase":"working","items":[{"request":"Milk","state":"pending"}]}',
    notes: ["An actual prior reflex checked the browser setting."],
  };
  for (const prompt of [delegationPrompt(task), historyPrompt(task)]) {
    const data = prompt.indexOf("Current saved work state and source data");
    const request = prompt.indexOf('User said: "Prepare my grocery cart now"');
    const completed = prompt.indexOf("Already done or found by Hormes");
    assert.ok(data >= 0 && data < request && request < completed);
    assert.match(prompt.slice(data, request), /unfinished plans.*not proof this request is complete/);
    assert.match(prompt.slice(data, request), /"state":"pending"/);
    assert.doesNotMatch(prompt.slice(completed), /"state":"pending"|Execute with tools/);
    assert.match(prompt.slice(completed), /actual prior reflex/);
  }
});
