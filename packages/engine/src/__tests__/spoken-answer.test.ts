import { test } from "node:test";
import assert from "node:assert/strict";
import { spokenAttempt, spokenNumber } from "../work/spoken-answer.ts";

test("identical repeated ASR answers are checked; conflicts and added reasoning are not", () => {
  assert.deepEqual(spokenAttempt("The price is one half. The price is one half.", "exchange"), { answer: "1/2" });
  assert.equal(spokenAttempt("The price is one half. The price is two.", "exchange"), undefined);
  assert.equal(spokenAttempt("The price is one half. Actually I don't know.", "exchange"), undefined);
});

test("spoken numeric answers retain fractions and decimals without evaluating expressions", () => {
  for (const [words, number] of [["one half", "1/2"], ["five quarters", "5/4"], ["seven halves", "7/2"], ["three over two", "3/2"], ["zero point five", "0.5"], ["-2", "-2"]]) assert.equal(spokenNumber(words!), number);
  for (const words of ["one over zero", "process.exit()", "two plus three", "one or two", "Infinity"]) assert.equal(spokenNumber(words), undefined);
});
test("explicit spoken attempts check only the named criterion; reasoning and ambiguous speech remain ungraded", () => {
  assert.deepEqual(spokenAttempt("I think the price is one half.", "exchange"), { answer: "1/2" });
  assert.deepEqual(spokenAttempt("The price is 0.5.", "exchange"), { answer: "0.5" });
  assert.deepEqual(spokenAttempt("The income is five", "review"), { answer: "5" });
  assert.deepEqual(spokenAttempt("The price is one half. A gets five quarters of x and five halves of y. B gets seven quarters of x and seven halves of y.", "exchange"), { answer: "1/2;5/4,5/2,7/4,7/2" });
  for (const text of ["Should the price be two?", "The income is five", "The price is one or two", "Maybe add two to the budget", "The tutor said the price is two", "The price is two. Actually I don't know", "Two"]) assert.equal(spokenAttempt(text, "exchange"), undefined);
  assert.deepEqual(spokenAttempt("I'm stuck!", "exchange"), { help: true });
  for (const text of ["I’m stuck on A's budget", "I don't know where to start", "I can't figure this out", "Could you give me a hint about the budget?"]) assert.deepEqual(spokenAttempt(text, "exchange"), { help: true });
  for (const text of ["I'm stuck, but let me try", "I don't know yet. Don't help me", "I need help but no hints", "The tutor said I'm stuck"]) assert.equal(spokenAttempt(text, "exchange"), undefined);
  assert.equal(spokenAttempt("I was stuck yesterday", "exchange"), undefined);
});


test("my answer is submits a narrow numeric value in foundation, review and exchange practice", () => {
  for (const kind of ["foundation", "review", "exchange"] as const) {
    assert.deepEqual(spokenAttempt("My answer is eight over nine.", kind), { answer: "8/9" });
    assert.deepEqual(spokenAttempt("Hormes, my answer is zero point five.", kind), { answer: "0.5" });
    assert.deepEqual(spokenAttempt("My answer is eight over nine. My answer is eight over nine.", kind), { answer: "8/9" });
  }
  assert.deepEqual(spokenAttempt("My answer is one half. A gets five quarters of x and five halves of y. B gets seven quarters of x and seven halves of y.", "exchange"), { answer: "1/2;5/4,5/2,7/4,7/2" });
});

test("my answer phrasing does not admit background numbers, contradictory answers or added reasoning", () => {
  const rejected = [
    "Eight over nine", "The tutor said my answer is eight over nine", "Is my answer eight over nine?",
    "My answer was eight over nine", "My answer is eight over nine because I inverted the second fraction",
    "My answer is eight over nine. Actually I don't know", "My answer is eight over nine. My answer is one",
    "My answer is one or two", "My answer is eight over zero", "My answer is two plus three",
    "My answer is eight over nine; give me the next step", "I don't know yet. Don't help me",
  ];
  for (const kind of ["foundation", "review", "exchange"] as const) {
    for (const text of rejected) assert.equal(spokenAttempt(text, kind), undefined, `${kind}: ${text}`);
    assert.deepEqual(spokenAttempt("I need a hint", kind), { help: true });
    assert.equal(spokenAttempt("I need help but no hints", kind), undefined);
  }
  for (const kind of ["foundation", "review"] as const) assert.equal(spokenAttempt("My answer is one half. A gets one x and one y. B gets one x and one y.", kind), undefined);
});

test("fresh prerequisite checks accept natural compound English numbers without broadening submission intent", () => {
  for (const [speech, value] of [
    ["twenty-four over twenty-five", "24/25"],
    ["ninety nine divided by one hundred", "99/100"],
    ["one hundred and forty four over one hundred and sixty nine", "144/169"],
    ["two thousand and five", "2005"],
    ["one hundred million forty thousand and four", "100040004"],
    ["negative twenty four", "-24"],
    ["minus twenty four over twenty five", "-24/25"],
    ["twenty four point two five", "24.25"],
    ["point nine six", "0.96"],
    ["zero point 96", "0.96"],
    ["twenty four quarters", "24/4"],
  ]) {
    assert.equal(spokenNumber(speech!), value, speech);
    assert.deepEqual(spokenAttempt(`My answer is ${speech}.`, "foundation"), { answer: value }, speech);
  }
  for (const speech of [
    "twenty four over zero", "24/0", "twenty four over twenty five over two",
    "twenty four plus one", "twenty twenty", "twenty zero", "one hundred hundred",
    "one hundred and", "one thousand thousand", "one thousand one million",
    "one million and one hundred", "and five", "zero thousand", "negative minus two",
    "zero point twenty five", "constructor", "__proto__", "toString",
    "twenty four because I divided", "twenty four. No, twenty five",
  ]) assert.equal(spokenNumber(speech), undefined, speech);
  assert.equal(spokenAttempt("I heard twenty four over twenty five", "foundation"), undefined);
});
