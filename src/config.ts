import fs from "node:fs";
import path from "node:path";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  model: env.MODEL || "claude-opus-5-5",
  workspaceDir: env.WORKSPACE_DIR ? path.resolve(env.WORKSPACE_DIR) : "",
  /** True when the app fell back to the built-in demo project. */
  usingDemo: false,
  /** Shown in Settings when the configured project folder couldn't be used. */
  workspaceWarning: "",
  testCommand: env.TEST_COMMAND ?? "",
  monthlyBudgetUsd: Number(env.MONTHLY_BUDGET_USD || 500),
  // Practice mode (scripted agents, no API calls): on when asked for, or when there's no API key yet.
  mock: env.MOCK === "1" || (env.MOCK !== "0" && !env.ANTHROPIC_API_KEY),
  dataDir: path.resolve("data"),
  /** How many times QA can send failing work back to the engineers before giving up. */
  maxFixRounds: Number(env.MAX_FIX_ROUNDS || 3),
  /** Upper bound on tool calls in one coding session, so a stuck agent can't loop forever. */
  maxAgentSteps: Number(env.MAX_AGENT_STEPS || 60),
};

/** USD per million tokens [input, output]. Used for the usage meter only. */
export const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};
