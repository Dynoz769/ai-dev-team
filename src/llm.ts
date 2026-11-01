import Anthropic from "@anthropic-ai/sdk";
import { config, PRICES } from "./config.ts";
import { store } from "./store.ts";
import { mockResponse } from "./mock.ts";

type Params = Omit<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, "model" | "max_tokens" | "stream"> & {
  max_tokens?: number;
};
export type Purpose = "discuss" | "spec" | "engineer" | "qa";

let client: Anthropic | undefined;

export class RefusalError extends Error {}

/** Forget the cached client, e.g. after the API key changes in Settings. */
export function resetClient() {
  client = undefined;
}

/** Called while Claude is still writing a tool call, so the office can show who is doing what. */
export type OnToolStart = (name: string, partialInput: Record<string, unknown>) => void;

/**
 * One call to Claude. Every agent in the app goes through here so that model choice,
 * refusal fallback and the usage meter live in one place.
 */
export async function callClaude(purpose: Purpose, params: Params, onToolStart?: OnToolStart): Promise<Anthropic.Beta.Messages.BetaMessage> {
  if (config.mock) return mockResponse(purpose, params, onToolStart);

  client ??= new Anthropic();
  let currentTool = "";
  let keysSeen = 0;
  const stream = client.beta.messages
    .stream({
      model: config.model,
      max_tokens: 32000,
      // If a safety classifier declines, the API retries on a suitable fallback model itself.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Caches the stable prefix (tools, system prompt, earlier turns) so long agent loops stay cheap.
      cache_control: { type: "ephemeral" },
      ...params,
    });
  if (onToolStart) {
    stream.on("streamEvent", (ev) => {
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
        currentTool = ev.content_block.name;
        keysSeen = 0;
        onToolStart(currentTool, {});
      }
    });
    // Report again each time a new field starts streaming: by the time `content` starts,
    // `path` is complete, so the right engineer can be shown at work.
    stream.on("inputJson", (_delta, snapshot) => {
      const s = (snapshot ?? {}) as Record<string, unknown>;
      const keys = Object.keys(s).length;
      if (currentTool && keys > keysSeen) {
        keysSeen = keys;
        onToolStart(currentTool, s);
      }
    });
  }
  const message = await stream.finalMessage();

  recordUsage(message);
  if (message.stop_reason === "refusal") {
    throw new RefusalError(message.stop_details?.explanation || "The model declined this request.");
  }
  return message;
}

function recordUsage(m: Anthropic.Beta.Messages.BetaMessage) {
  const [inPrice, outPrice] = PRICES[m.model] ?? PRICES[config.model] ?? [4, 20];
  const u = m.usage;
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const cost =
    (u.input_tokens * inPrice +
      (u.cache_creation_input_tokens ?? 0) * inPrice * 1.25 +
      (u.cache_read_input_tokens ?? 0) * inPrice * 0.1 +
      u.output_tokens * outPrice) /
    1_000_000;
  store.addUsage(input, u.output_tokens, cost);
}

export function textOf(m: Anthropic.Beta.Messages.BetaMessage) {
  return m.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
