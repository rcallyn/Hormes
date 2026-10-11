import { join } from "node:path";
import { homedir } from "node:os";
import { CodingProfileStore } from "./claude-code/coding-profile.ts";
import type { AgentConnector } from "./types.ts";
import { ClaudeCodeConnector } from "./claude-code/connector.ts";
import { SessionsConnector } from "./sessions/connector.ts";

export interface DefaultConnectorOptions {
  readonly stateDir?: string;
  readonly claudeModel?: string | undefined;
  readonly claudeBin?: string | undefined;
  /** The user's name as the connectors' lines say it (the engine's effective name). */
  readonly userName?: (() => string) | undefined;
}

/**
 * The connectors Hormes ships with, built the same way by the app and the CLI.
 * Sessions first: the agent sessions already on this Mac (Claude Code, Codex,
 * other CLIs found on disk or running) are the agents User means. Claude Code
 * is how a session is continued headlessly. Nothing here is tied to one tool; the
 * herdr and T3 Code connectors were removed 2026-09-10 (git history before 1ff11e2).
 */
export function defaultConnectors(opts: DefaultConnectorOptions = {}): AgentConnector[] {
  const userName = opts.userName ? { userName: opts.userName } : {};
  const codingProfiles = new CodingProfileStore(join(opts.stateDir ?? process.env["HORMES_STATE_DIR"] ?? join(homedir(), ".hormes"), "coding-profiles"));
  return [
    new SessionsConnector({ dropApiKey: true, codingProfiles, ...userName }),
    new ClaudeCodeConnector({
      codingProfiles,
      ...(opts.claudeModel ? { model: opts.claudeModel } : {}),
      ...(opts.claudeBin ? { pathToClaudeCodeExecutable: opts.claudeBin } : {}),
      dropApiKey: true,
      ...userName,
    }),
  ];
}
