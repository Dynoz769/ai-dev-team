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

/**
 * One call to Claude. Every agent in the app goes through here so that model choice,
 * refusal fallback and the usage meter live in one place.
 */
export async function callClaude(purpose: Purpose, params: Params): Promise<Anthropic.Beta.Messages.BetaMessage> {
  if (config.mock) return mockResponse(purpose, params);

  client ??= new Anthropic();
  const message = await client.beta.messages
    .stream({
      model: config.model,
      max_tokens: 32000,
      // If a safety classifier declines, the API retries on a suitable fallback model itself.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Caches the stable prefix (tools, system prompt, earlier turns) so long agent loops stay cheap.
      cache_control: { type: "ephemeral" },
      ...params,
    })
    .finalMessage();

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
