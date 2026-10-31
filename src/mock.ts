import type Anthropic from "@anthropic-ai/sdk";
import type { Purpose } from "./llm.ts";

/**
 * MOCK=1: scripted stand-in for Claude so you can click through the whole pipeline
 * (discussion → spec → build → QA → review) without an API key or spending money.
 * The output is obviously fake; it only exercises the plumbing.
 */
type Msg = Anthropic.Beta.Messages.BetaMessage;
type Params = { system?: unknown; messages: Anthropic.Beta.Messages.BetaMessageParam[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function message(content: unknown[], stop: Msg["stop_reason"]): Msg {
  return {
    id: "mock",
    type: "message",
    role: "assistant",
    model: "mock",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Msg;
}
const text = (t: string, stop: Msg["stop_reason"] = "end_turn") => message([{ type: "text", text: t }], stop);
const tool = (name: string, input: object) =>
  message([{ type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2)}`, name, input }], "tool_use");

const OPENERS: Record<string, string> = {
  "Product Lead": "[mock] Main use case first: what problem does this solve for the user? I'd keep v1 small. Owner: is this needed for all customers or just one segment?",
  "UI/UX Designer": "[mock] The flow should fit in the existing screen, with clear empty and error states.",
  "Tech Lead": "[mock] Let's reuse the existing module rather than add a new service. Smallest change that works.",
  "Frontend Engineer": "[mock] UI work looks small: one component plus a call to the API.",
  "Backend Engineer": "[mock] One new function and a test; no schema change needed.",
  "QA Engineer": "[mock] Edge cases: invalid input, overlapping times, and the empty case. Each requirement needs a test.",
};

export async function mockResponse(purpose: Purpose, params: Params): Promise<Msg> {
  await sleep(400);
  const system = String(params.system ?? "");
  const turns = params.messages.length;

  if (purpose === "discuss") {
    const name = Object.keys(OPENERS).find((n) => system.startsWith(`You are the ${n}`)) ?? "Tech Lead";
    const last = params.messages.at(-1)?.content;
    const isSecondRound = typeof last === "string" && /reply with exactly: PASS/.test(last);
    if (isSecondRound) return text(name === "Tech Lead" ? "[mock] Agreed with QA; tests will cover the edge cases." : "PASS");
    return text(OPENERS[name]);
  }

  if (purpose === "spec") {
    return text(
      JSON.stringify({
        spec: "## Goal\n[mock] Add the requested feature.\n\n## Requirements\n1. A `MOCK_CHANGE.md` file exists describing the change.\n\n## Test plan\n- Existing tests still pass.",
        openQuestions: ["[mock] Should this apply to all customers? (assumed: yes)"],
      }),
    );
  }

  if (purpose === "engineer") {
    if (turns === 1) return tool("list_files", {});
    if (turns === 3)
      return tool("write_file", { path: "MOCK_CHANGE.md", content: "# Mock change\n\nWritten by the mock engineer to test the pipeline.\n" });
    return text("[mock] Added MOCK_CHANGE.md. Nothing else changed.");
  }

  // qa
  if (turns === 1) return tool("run_command", { command: "git status --short" });
  return text("[mock] MOCK_CHANGE.md is present and tests pass.\nVERDICT: PASS");
}
