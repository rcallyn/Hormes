/** Explicit synthetic rehearsal content. This is never a model answer or mastery evidence. */
export const LECTURE_DEMO_QUESTION = "Why can we set the price of X to one?";
export const LECTURE_DEMO_ANSWER = "Divide all prices and income by the same positive number. Prices (2, 4) become (1, 2); affordable bundles are unchanged.";
const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
export function lectureDemoAnswer(demo: boolean, question: string, transcript: string): string | undefined {
  if (!demo || words(question) !== words(LECTURE_DEMO_QUESTION)) return undefined;
  // The scripted explanation is available only after the actual capture has
  // supplied its premises. Empty/demo-calendar state alone is insufficient.
  if (!/prices?/i.test(transcript) || !/income/i.test(transcript) || !/divide/i.test(transcript) || !/normaliz|relative|ratio/i.test(transcript) || !/afford|budget/i.test(transcript)) return undefined;
  const numbers: Record<string, string> = { one: "1", two: "2", four: "4", eight: "8" };
  const facts = words(transcript).replace(/\b(one|two|four|eight)\b/g, word => numbers[word]!);
  if (!facts.includes("x costs 2") || !facts.includes("y costs 4") || !facts.includes("4 units of x")) return undefined;
  return LECTURE_DEMO_ANSWER;
}
export const LECTURE_DEMO_REVIEW = {
  title: "Exchange economies: prices and endowments",
  cards: [
    { front: "What determines income in this exchange economy?", options: ["The market value of your endowment", "Your number of goods only", "A fixed wage", "The price of X alone"], correctOption: 0, back: "Value each endowed good at its market price, then add those values." },
    { front: "X costs 2 and Y costs 4. With X normalized to 1, what is the price of Y?", options: ["0.5", "1", "2", "4"], correctOption: 2, back: "Divide both prices by 2: (2, 4) becomes (1, 2). The ratio Y/X stays 2." },
    { front: "You own 4 X and no Y. At normalized prices (1, 2), what is your income?", options: ["2", "4", "8", "16"], correctOption: 1, back: "Your endowment is worth 4 × 1 + 0 × 2 = 4 in the new units." },
    { front: "Why can you still buy 2 Y after normalization?", options: ["Income and all prices scale equally", "Only the price of X changes", "Your endowment doubles", "Y becomes free"], correctOption: 0, back: "Before: income 8 / price 4 = 2 Y. After: income 4 / price 2 = 2 Y." },
  ],
};
export function phoneReviewPayload(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!value || typeof value !== "object") throw new Error("No valid phone review was returned.");
  const payload = value as Record<string, unknown>, cards = payload["cards"];
  if (typeof payload["title"] !== "string" || !payload["title"].trim() || payload["title"].length > 60 || !Array.isArray(cards) || cards.length !== 4) throw new Error("The phone review requires a title and exactly four questions.");
  for (const card of cards) {
    if (!card || typeof card.front !== "string" || !card.front.trim() || card.front.length > 150 || typeof card.back !== "string" || !card.back.trim() || card.back.length > 500 || !Array.isArray(card.options) || card.options.length < 2 || card.options.length > 4 || card.options.some((x: unknown) => typeof x !== "string" || !x.trim() || x.length > 42) || new Set(card.options).size !== card.options.length || !Number.isInteger(card.correctOption) || card.correctOption < 0 || card.correctOption >= card.options.length) throw new Error("Phone questions require short fronts, two to four distinct choices and a valid answer key.");
  }
  return payload;
}
