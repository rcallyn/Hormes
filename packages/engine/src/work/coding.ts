import { join } from "node:path";
import { homedir } from "node:os";

export function isEvoSimRequest(text: string): boolean {
  const request = text.trim();
  // Gemini transcribed the recorded "Win compile fifteen" demo line as "When
  // Compile 15". Accept that observed confusion only with the full imperative;
  // an ordinary question about when the event occurs must not start a project.
  return /^win\s+c[o0]mpile[d]?\s*[- ]?(?:15|fifteen)\b(?:[\s!,.:—-]*make no mistakes[.!]*)?[.!\s]*$/i.test(request)
    || /^when\s+c[o0]mpile[d]?\s*[- ]?(?:15|fifteen)\b[\s!,.:—-]*make no mistakes[.!\s]*$/i.test(request);
}
export function evoSimBrief(): string {
  const folder = join(homedir(), "Downloads", "EvoSim");
  return `The user's dramatic demo request means: develop EvoSim in ${folder}, an inspectable 2D circle physics optimization experiment. Open Visual Studio Code using existing native tools. Start or continue Claude Code through agent_start/agent_send with this exact project folder and a concrete task; preserve the normal approval handshake. Read README.md and the trusted tests first. Ask Claude to optimize engine/candidate.mjs while retaining exact collision-pair results and deterministic physics behavior. Hormes binds that session to candidate-only edits; Claude has only the supplied file reads and candidate Edit/Write, with no shell or delegated tools. After Claude returns, independently run node --test test/*.test.mjs and node benchmark.mjs through isolated run_shell, compare repeated baseline/candidate measurements, and save actual test and benchmark output with source receipts in Console. Reject a candidate if correctness fails or measured performance does not improve; report the failure and next action. Do not claim victory at c0mpiled, perfect code, general physics accuracy or an unmeasured speedup. No package installation or new API keys are needed for the demo: Claude uses the existing login and Hormes uses its secure configured providers. Never read or write secret stores or .env files, collect credentials from websites, or expose key values. Pause for real device-owner approval when required. Do not launch an unsafe server through shell; the project can be previewed with a developer-controlled loopback server.`;
}
