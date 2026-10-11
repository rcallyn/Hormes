/** Deliberately narrow: a transcript is evidence, a model's guess about it isn't. */
const words: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
const tens: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordValue(table: Record<string, number>, word: string): number | undefined { return Object.hasOwn(table, word) ? table[word] : undefined; }
function underHundred(tokens: string[]): number | undefined {
  if (tokens.length === 1) return wordValue(words, tokens[0]!) ?? wordValue(tens, tokens[0]!);
  if (tokens.length === 2) {
    const ten = wordValue(tens, tokens[0]!), unit = wordValue(words, tokens[1]!);
    if (ten !== undefined && unit !== undefined && unit > 0 && unit < 10) return ten + unit;
  }
  return undefined;
}
function underThousand(tokens: string[]): number | undefined {
  if (tokens[1] !== "hundred") return underHundred(tokens);
  const unit = wordValue(words, tokens[0]!);
  if (unit === undefined || unit < 1 || unit > 9) return undefined;
  if (tokens.length === 2) return unit * 100;
  const rest = underHundred(tokens.slice(tokens[2] === "and" ? 3 : 2));
  return rest !== undefined && rest > 0 ? unit * 100 + rest : undefined;
}
/** A fixed English grammar, never expression evaluation or a model guess. */
function integer(text: string): string | undefined {
  if (/^\d+$/.test(text)) return text;
  let tokens = text.split(" "), value = 0, previousScale = Infinity;
  while (tokens.some(token => token === "million" || token === "thousand")) {
    const index = tokens.findIndex(token => token === "million" || token === "thousand");
    const scale = tokens[index] === "million" ? 1_000_000 : 1_000;
    const group = underThousand(tokens.slice(0, index));
    if (scale >= previousScale || group === undefined || group < 1) return undefined;
    value += group * scale; previousScale = scale; tokens = tokens.slice(index + 1);
  }
  if (!tokens.length) return value ? String(value) : undefined;
  const afterAnd = tokens[0] === "and";
  if (afterAnd) tokens = tokens.slice(1);
  const last = underThousand(tokens);
  if (last === undefined || (value > 0 && last === 0) || (afterAnd && (!value || last >= 100))) return undefined;
  return String(value + last);
}
function scalar(text: string): string | undefined {
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return text;
  const decimal = text.match(/^(?:(.+) )?point (.+)$/);
  if (!decimal) return integer(text);
  const whole = decimal[1] ? integer(decimal[1]) : "0";
  const digits = decimal[2]!.split(" ").map(word => { const digit = wordValue(words, word); return /^\d+$/.test(word) ? word : digit !== undefined && digit < 10 ? String(digit) : undefined; });
  return whole !== undefined && digits.every(digit => digit !== undefined) ? `${whole}.${digits.join("")}` : undefined;
}
export function spokenNumber(value: string): string | undefined {
  let text = value.toLowerCase().trim().replace(/[.!?]+$/, "").replace(/(?<=[a-z])-(?=[a-z])/g, " ").replace(/\s+/g, " ");
  if (!text || text.length > 200) return undefined;
  if (/^[+\-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*\d+)?$/.test(text)) return text.includes("/") && Number(text.split("/")[1]) === 0 ? undefined : text;
  const sign = /^(?:minus|negative) /.test(text) ? "-" : "";
  text = text.replace(/^(?:minus|negative|plus|positive) /, "");
  if (["half", "a half", "one half"].includes(text)) return `${sign}1/2`;
  if (["a quarter", "one quarter"].includes(text)) return `${sign}1/4`;
  const fraction = text.match(/^(.+) (?:over|divided by) (.+)$/);
  if (fraction) {
    const n = scalar(fraction[1]!), d = scalar(fraction[2]!);
    if (n !== undefined && d !== undefined && Number(d) !== 0) return `${sign}${n}/${d}`;
    return undefined;
  }
  const halves = text.match(/^(.+) (halves|quarters)$/);
  if (halves) { const n = integer(halves[1]!); return n !== undefined ? `${sign}${n}/${halves[2] === "halves" ? 2 : 4}` : undefined; }
  const number = scalar(text);
  return number !== undefined ? `${sign}${number}` : undefined;
}
export type SpokenAttempt = { answer: string } | { help: true };
export function spokenAttempt(text: string, kind: "exchange" | "review" | "foundation"): SpokenAttempt | undefined {
  const clean = text.toLowerCase().replace(/’/g, "'").trim().replace(/^[\s,]*(?:hormes|hormes)[,\s]+/, "");
  // ASR may repeat a complete sentence. Accept only identical repetitions;
  // conflicting answers and additional reasoning still fail closed.
  const sentences = clean.split(/\.\s+/).map((part) => part.replace(/[.!?]+$/, "").trim());
  if (sentences.length > 1 && sentences.every((part) => part === sentences[0])) return spokenAttempt(sentences[0]!, kind);
  const withholdHelp = /\b(?:no hints?|without (?:help|hints?)|don'?t (?:help|tell|give|show)|do not (?:help|tell|give|show)|let me (?:try|think|work))\b/.test(clean);
  if (!withholdHelp && /^(?:(?:i(?:'m| am) |i feel |i got )?stuck\b|i (?:don'?t|do not) (?:know|understand)\b|i can'?t (?:figure|solve|work out)\b|(?:can|could) you (?:help|give me a hint)\b|(?:please )?(?:help me|give me a hint)\b|i need (?:help|a hint)\b)/.test(clean)) return { help: true };
  // Check an explicitly identified answer, not a number mentioned while reasoning.
  const label = kind === "review" ? "income|answer" : kind === "foundation" ? "answer|value|x" : "price(?: ratio)?|p";
  // “My answer is” is itself an explicit submission label; it does not need
  // another “answer/price/income is” after it. The payload still goes through
  // the same narrow numeric and allocation parsers below.
  const match = clean.match(new RegExp(`^(?:(?:i think|i got|my answer is)\\s+)?(?:the\\s+)?(?:${label})\\s*(?:is|equals|=)\\s+(.+)$`))
    ?? clean.match(/^my answer is\s+(.+)$/);
  if (!match) return;
  const [priceText, ...tail] = match[1]!.split(/(?:;|\.(?:\s+|$))\s*/).filter(Boolean);
  const price = spokenNumber(priceText!); if (price === undefined) return;
  if (!tail.length) return { answer: price };
  if (kind !== "exchange" || tail.length !== 2) return;
  const allocation = tail.map((sentence, index) => sentence.match(new RegExp(`^${index === 0 ? "a" : "b"} (?:gets|has) (.+?) (?:of )?x and (.+?) (?:of )?y$`)));
  if (allocation.some((part) => !part)) return;
  const values = allocation.flatMap((part) => [spokenNumber(part![1]!), spokenNumber(part![2]!)]);
  if (values.some((value) => value === undefined)) return;
  return { answer: `${price};${values.join(",")}` };
}
