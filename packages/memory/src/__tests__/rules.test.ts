import { test } from "node:test";
import assert from "node:assert/strict";
import { OPENAI_THRESHOLDS } from "../limits.ts";
import { isReversal, RulesDecider, RulesExtractor } from "../extract/rules.ts";
import type { ExtractInput, ExtractLine } from "../types.ts";
import { item } from "./helpers.ts";

/**
 * The free extractor: each spoken pattern becomes the expected third-person
 * sentence with its kind and weights; Hormes's lines never do; ≤ 8 per run.
 * The rules decider: newest wins above the update threshold, ADD in the band.
 */

const cases: readonly [string, string, string, number, number][] = [
  ["call me Kev", "fact", "User goes by Kev", 1.0, 0.9],
  ["My name is Hormes contributors", "fact", "User goes by Hormes contributors", 1.0, 0.9],
  ["I prefer short answers", "preference", "User prefers short answers", 0.6, 0.7],
  ["i don't like long explanations.", "preference", "User dislikes long explanations", 0.6, 0.7],
  ["I can't stand autoplay", "preference", "User cannot stand autoplay", 0.6, 0.7],
  ["my dentist is Dr. Patel", "contact", "User's dentist is Dr. Patel", 0.6, 0.7],
  ["my office is in SoMa", "place", "User's office is in SoMa", 0.6, 0.7],
  ["my favorite editor is Zed", "fact", "User's favorite editor is Zed", 0.6, 0.7],
  ["from now on read the diff before saying a PR is fine", "procedure", "How User likes it done: read the diff before saying a PR is fine", 0.8, 0.8],
  ["always ask before pushing", "procedure", "How User likes it done: always ask before pushing", 0.8, 0.8],
  ["never touch the prod database", "procedure", "How User likes it done: never touch the prod database", 0.8, 0.8],
  ["speak in english", "preference", "User wants answers in English", 1.0, 0.9],
  ["Hey Hormes, please remember that I prefer dark mode", "preference", "User prefers dark mode", 0.9, 0.9],
  ["remember that my wife is Anna", "contact", "User's wife is Anna", 0.9, 0.9],
  ["remember I'm allergic to nothing but meetings", "fact", "User is allergic to nothing but meetings", 0.9, 0.9],
  ["remember that the standup moved to ten", "fact", "User asked Hormes to remember: the standup moved to ten", 0.9, 0.9],
  ["keep in mind that my flight lands at noon", "fact", "User's flight lands at noon", 0.9, 0.9],
];

test("rules.classify: each pattern yields its kind, sentence and weights; a 'remember' carries origin user", () => {
  for (const [line, kind, text, importance, confidence] of cases) {
    const c = RulesExtractor.classify(line);
    assert.ok(c, `no candidate for: ${line}`);
    assert.equal(c.kind, kind, line);
    assert.equal(c.text, text, line);
    assert.equal(c.importance, importance, line);
    assert.equal(c.confidence, confidence, line);
    assert.equal(c.origin, /remember|keep in mind/i.test(line) ? "user" : "extracted", line);
    assert.ok(c.subjects.length <= 5 && c.subjects.every((s) => s === s.toLowerCase()));
  }
});

test("rules.classify: lines that match no rule yield nothing (task talk, questions, transient states)", () => {
  for (const line of ["open the diff for the auth branch", "what is the Claude session doing", "I'm in a meeting now", "yes", "thanks", "remember"]) {
    assert.equal(RulesExtractor.classify(line), undefined, line);
  }
});

test("rules.classify: ordinary voice chatter never becomes a memory — 'never mind', 'call me back', 'I like that', 'I never said that', 'I always forget' yield nothing", () => {
  const chatter = [
    "never mind", "never mind that", "Never mind, forget it", "never do that", "always", "never mind about the diff",
    "call me back", "call me later", "call me when it's done", "call me tomorrow morning", "call me in an hour", "call me User please tomorrow",
    "I like that", "I like it", "I don't like this", "I prefer this one", "I love it", "I can't stand that", "I never said that", "I always forget", "I usually think so",
    "I never meant that", "I like that one better", "I always guess wrong",
  ];
  for (const line of chatter) assert.equal(RulesExtractor.classify(line), undefined, `false memory from: ${line}`);
  // the real shapes next to them still land
  assert.equal(RulesExtractor.classify("call me Kev please")?.text, "User goes by Kev", "a trailing please is politeness, not a name");
  assert.equal(RulesExtractor.classify("call me Hormes contributors")?.text, "User goes by Hormes contributors");
  assert.equal(RulesExtractor.classify("never touch the prod database")?.kind, "procedure");
  assert.equal(RulesExtractor.classify("always ask before pushing")?.kind, "procedure");
  assert.equal(RulesExtractor.classify("I prefer that you ask before pushing")?.text, "User prefers that you ask before pushing", "a long object that starts with a pronoun is still a preference");
  assert.equal(RulesExtractor.classify("I always want the short version")?.text, "User always want the short version");
  assert.equal(RulesExtractor.classify("remember that I like that")?.text, "User asked Hormes to remember: I like that", "an explicit remember is User's call — recorded as asked");
});

test("rules.extract: only User's lines produce candidates, evidence is the line number, and a run stops at 8", async () => {
  const lines: ExtractLine[] = [];
  let n = 0;
  for (let i = 0; i < 12; i++) {
    lines.push({ n: ++n, speaker: "User", text: `I prefer option number ${i}`, at: i });
    lines.push({ n: ++n, speaker: "Hormes", text: "I prefer that you say so", at: i });
  }
  const input: ExtractInput = { day: "2026-09-11", lines, requests: [], userLines: 12, pendingUserLines: 12, upToAt: 11, truncated: false, dropped: 0 };
  const out = await new RulesExtractor().extract(input);
  assert.equal(out.length, 8);
  assert.deepEqual(out.map((c) => c.evidence), [[1], [3], [5], [7], [9], [11], [13], [15]], "odd lines are User's");
  assert.ok(out.every((c) => c.text.startsWith("User prefers option number")));
});

test("rules decider: ≥ update → UPDATE with the candidate's words (newest wins); in the band an antonym swap updates, anything else adds; never a contradiction", async () => {
  const d = new RulesDecider();
  const existing = item({ id: "m_1", text: "User prefers dark mode", kind: "preference" });
  const c = { kind: "preference" as const, text: "User prefers light mode", subjects: [], importance: 0.6, confidence: 0.7, evidence: [1] };
  const ctx = { thresholds: OPENAI_THRESHOLDS, now: 0 };
  assert.deepEqual(await d.decide(c, [{ item: existing, sim: 0.92 }], ctx), { op: "UPDATE", target: "m_1", text: "User prefers light mode", contradicts: false, replaces: true }, "above update, an antonym swap is newest-wins AND marked as replacing the old evidence");
  assert.deepEqual(await d.decide({ ...c, text: "User likes dark mode" }, [{ item: existing, sim: 0.95 }], ctx), { op: "UPDATE", target: "m_1", text: "User likes dark mode", contradicts: false, replaces: false }, "above update, a paraphrase is newest-wins and folds evidence");
  assert.deepEqual(await d.decide(c, [{ item: existing, sim: 0.8 }], ctx), { op: "UPDATE", target: "m_1", text: "User prefers light mode", contradicts: false, replaces: true }, "in the band, a one-word antonym swap is a reversal");
  const other = { ...c, text: "User prefers a light editor theme" };
  assert.deepEqual(await d.decide(other, [{ item: existing, sim: 0.8 }], ctx), { op: "ADD", contradicts: false }, "in the band, anything else is a different thing");
  assert.ok(isReversal("User prefers short answers", "User prefers long answers"));
  assert.ok(isReversal("How User likes it done: always ask before pushing", "How User likes it done: never ask before pushing"));
  assert.ok(!isReversal("User prefers short answers", "User wants answers in English"));
  assert.ok(!isReversal("User's dentist is Dr. Patel", "User's doctor is Dr. Patel"), "dentist/doctor is not a reversal");
  assert.deepEqual(await d.decide(c, [{ item: existing, sim: 0.65 }], { ...ctx, thresholds: { update: 0.6, band: 0.4, dup: 0.7 } }), { op: "UPDATE", target: "m_1", text: "User prefers light mode", contradicts: false, replaces: true }, "the embedder's own table decides the lane");
});

test("release F1: the rules mint sentences about whoever the name says — the same shapes with Sam as subject, no literal User; the extractor instance carries the name, and the default stays User", async () => {
  for (const [line, kind, text] of cases) {
    const c = RulesExtractor.classify(line, "Sam");
    assert.ok(c, `no candidate for: ${line}`);
    assert.equal(c.kind, kind, line);
    assert.equal(c.text, text.replace(/^(How )?User/, "$1Sam"), `${line}: the subject moves, a name the user spoke ("Hormes contributors") stays`);
    assert.doesNotMatch(c.text.replace(/Hormes contributors/, ""), /User/, `${line}: only a name the user spoke ("My name is Hormes contributors") may keep the word`);
  }
  assert.equal(RulesExtractor.classify("I prefer short answers")?.text, "User prefers short answers", "the default is unchanged");
  const input: ExtractInput = {
    day: "2026-09-11",
    lines: [
      { n: 1, speaker: "User", text: "I prefer short answers", at: 1 } as ExtractLine,
      { n: 2, speaker: "Hormes", text: "I prefer long ones", at: 2 } as ExtractLine,
      { n: 3, speaker: "User", text: "remember that my wife is Anna", at: 3 } as ExtractLine,
    ],
    requests: [],
    userLines: 2,
    pendingUserLines: 2,
    upToAt: 3,
    truncated: false,
    dropped: 0,
  };
  const out = await new RulesExtractor("Sam").extract(input);
  assert.deepEqual(out.map((c) => c.text), ["Sam prefers short answers", "Sam's wife is Anna"], "the user's lines only, in his name");
});
