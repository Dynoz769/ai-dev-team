import type Anthropic from "@anthropic-ai/sdk";
import type { Purpose, OnToolStart } from "./llm.ts";

/**
 * MOCK=1: scripted stand-in for Claude so you can click through the whole pipeline
 * (discussion → spec → build → QA → review) without an API key or spending money.
 * The output is obviously fake; it only exercises the plumbing.
 */
type Msg = Anthropic.Beta.Messages.BetaMessage;
type Params = { system?: unknown; messages: Anthropic.Beta.Messages.BetaMessageParam[] };

let qaRuns = 0;
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

export async function mockResponse(purpose: Purpose, params: Params, onToolStart?: OnToolStart): Promise<Msg> {
  await sleep(purpose === "discuss" ? 2200 : 900);
  const m = respond(purpose, params);
  // Like the real stream: report the tool while it's "being written", then take a moment.
  const call = m.content.find((b) => b.type === "tool_use");
  if (call && call.type === "tool_use") onToolStart?.(call.name, call.input as Record<string, unknown>);
  if (purpose !== "discuss") await sleep(call ? 1600 : 600);
  return m;
}

function respond(purpose: Purpose, params: Params): Msg {
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
    const steps = [
      () => tool("list_files", {}),
      () => tool("read_file", { path: "src/bookings.js" }),
      () => tool("read_file", { path: "README.md" }),
      () => tool("write_file", { path: "public/rooms.html", content: "<h1>Rooms</h1>\n<!-- mock frontend change -->\n" }),
      () => tool("write_file", { path: "MOCK_CHANGE.md", content: "# Mock change\n\nWritten by the mock engineer to test the pipeline.\n" }),
      () => tool("edit_file", { path: "README.md", old_text: "AI Dev Team.", new_text: "AI Dev Team. See MOCK_CHANGE.md." }),
      () => tool("run_command", { command: "npm test" }),
    ];
    const isFix = JSON.stringify(params.messages[0].content).includes("QA rejected");
    const i = (turns - 1) / 2;
    if (isFix) return i === 0 ? tool("read_file", { path: "MOCK_CHANGE.md" }) : text("[mock] Fixed what QA reported.");
    return i < steps.length ? steps[i]() : text("[mock] Added MOCK_CHANGE.md and linked it from the README.");
  }

  // qa: rejects the first attempt so you can see the fix loop, then passes.
  if (turns === 1) return tool("run_command", { command: "git status --short" });
  if (turns === 3) return tool("read_file", { path: "MOCK_CHANGE.md" });
  qaRuns++;
  return qaRuns % 2 === 1
    ? text("[mock] MOCK_CHANGE.md doesn't say which task it belongs to.\nVERDICT: FAIL")
    : text("[mock] Looks good now and tests pass.\nVERDICT: PASS");
}
