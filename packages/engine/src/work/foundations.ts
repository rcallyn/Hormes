/** Application-authored prerequisite checks. Answers never enter the public exercise. */
export const FOUNDATION_SKILLS = ["fractions", "ratios", "linear-equations"] as const;
export type FoundationSkill = (typeof FOUNDATION_SKILLS)[number];
export interface FoundationProblem {
  skillId: FoundationSkill | "exchange-income";
  criterion: "fraction-division" | "ratio-reduction" | "linear-equation" | "price-convention-recall";
  title: string;
  prompt: string;
  lines: string[];
  answer: number;
  signature: string;
  limitation: string;
}
export function foundationProblem(skillId: FoundationProblem["skillId"], ordinal: number): FoundationProblem {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 10_000) throw new Error("No fresh prerequisite check is available.");
  const n = ordinal + 2;
  const base = { skillId, signature: `${skillId}:${ordinal}` };
  if (skillId === "fractions") {
    const expression = `(${n}/${n + 1}) ÷ (${n + 1}/${n + 2})`;
    return { ...base, criterion: "fraction-division", title: "Dividing fractions", prompt: `Calculate ${expression}. Give the value as a fraction or decimal.`, lines: ["Dividing fractions", expression, "What value do you get?"], answer: n * (n + 2) / ((n + 1) ** 2), limitation: "Checks this numeric division only; it does not assess all fraction skills or a school grade." };
  }
  if (skillId === "ratios") {
    const a = n * (n + 2), b = (n + 3) * (n + 2);
    return { ...base, criterion: "ratio-reduction", title: "Equivalent ratios", prompt: `Express the ratio ${a} to ${b} as a number. A fraction or decimal is fine.`, lines: ["Equivalent ratios", `${a} : ${b}`, "Express this ratio as a number."], answer: n / (n + 3), limitation: "Checks the numeric ratio value only; an equivalent answer does not establish lowest-term notation or broader proportional reasoning." };
  }
  if (skillId === "linear-equations") {
    const a = n + 1, b = n + 3, answer = n + 2, c = a * answer + b;
    return { ...base, criterion: "linear-equation", title: "Solving a linear equation", prompt: `Find x: ${a}x + ${b} = ${c}.`, lines: ["Solving a linear equation", `${a}x + ${b} = ${c}`, "Find x."], answer, limitation: "Checks the solution to this linear equation only; it does not establish algebra mastery." };
  }
  if (skillId === "exchange-income") {
    const x = n, y = n + 1, price = n + 2;
    return { ...base, criterion: "price-convention-recall", title: "Valuing an endowment", prompt: `With p = pᵧ / pₓ and pₓ = 1, A owns (${x}, ${y}). What is A's income when p = ${price}?`, lines: ["Valuing an endowment", "p = pᵧ / pₓ     pₓ = 1", `A owns (${x}, ${y}).     p = ${price}`, "What is A's income?"], answer: x + price * y, limitation: "Checks this endowment's numeric income under the stated price convention only; it does not establish economic understanding or course mastery." };
  }
  throw new Error("Choose a supported prerequisite skill.");
}
