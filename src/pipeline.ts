import type Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.ts";
import { store, type Task } from "./store.ts";
import { callClaude, textOf, type Purpose } from "./llm.ts";
import { ROLES, role, discussionSystemPrompt, SPEC_SYSTEM_PROMPT, ENGINEER_SYSTEM_PROMPT, QA_SYSTEM_PROMPT, type RoleId } from "./agents.ts";
import { engineerTools, qaTools, executeTool, run, shq } from "./tools.ts";
import { git, projectContext } from "./workspace.ts";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

function authorName(a: string) {
  if (a === "owner") return "Owner";
  if (a === "system") return "System";
  return role(a as RoleId).name;
}

function transcript(task: Task) {
  if (!task.messages.length) return "(no messages yet)";
  return task.messages.map((m) => `[${authorName(m.author)}]: ${m.text}`).join("\n\n");
}

function taskBlock(task: Task) {
  return `Task ${task.code}: ${task.title}\n\n${task.description || "(no description)"}`;
}

/** Runs a stage and turns any error into a visible failed state instead of a crash. */
async function guarded(task: Task, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.log(task, "system", `Error: ${msg}`);
    store.update(task, { status: "failed", error: msg });
  } finally {
    for (const r of ROLES) store.setAgent(r.id, { status: "idle", activity: "Idle" });
  }
}

// ---------- Stage 1: discussion → spec ----------

async function post(task: Task, r: RoleId, instruction: string, ctx: string) {
  store.setAgent(r, { status: "working", activity: "Thinking…", taskCode: task.code });
  const m = await callClaude("discuss", {
    system: discussionSystemPrompt(role(r), ctx),
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content: `${taskBlock(task)}\n\n--- Team chat so far ---\n${transcript(task)}\n--- End of chat ---\n\n${instruction}`,
      },
    ],
  });
  store.setAgent(r, { status: "idle", activity: "Waiting", taskCode: task.code });
  const text = textOf(m);
  if (text && text.trim().toUpperCase() !== "PASS") store.addMessage(task, r, text);
}

export function discuss(task: Task) {
  return guarded(task, async () => {
    store.update(task, { status: "discussing", error: undefined });
    const ctx = await projectContext();

    for (const r of ROLES) {
      await post(task, r.id, `Post your opening take as the ${role(r.id).name}.`, ctx);
    }
    // Challenge round: agents only speak up if they disagree or were asked something.
    for (const r of ROLES) {
      await post(
        task,
        r.id,
        `Second round. Reply only if you disagree with something, a question was addressed to you, or something important is still missing. Otherwise reply with exactly: PASS`,
        ctx,
      );
    }
    await writeSpec(task, ctx);
  });
}

async function writeSpec(task: Task, ctx?: string) {
  ctx ??= await projectContext();
  store.setAgent("product", { status: "working", activity: "Writing spec…", taskCode: task.code });
  const m = await callClaude("spec", {
    system: `${SPEC_SYSTEM_PROMPT}\n\n${ctx}`,
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            spec: { type: "string", description: "The full spec in markdown" },
            openQuestions: { type: "array", items: { type: "string" } },
          },
          required: ["spec", "openQuestions"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content: `${taskBlock(task)}\n\n--- Team chat ---\n${transcript(task)}\n--- End ---${task.spec ? `\n\nPrevious spec (revise it using the owner's latest feedback):\n${task.spec}` : ""}`,
      },
    ],
  });
  const out = JSON.parse(textOf(m)) as { spec: string; openQuestions: string[] };
  const qs = out.openQuestions.length ? `\n\nQuestions for you (I assumed defaults, override in the chat):\n${out.openQuestions.map((q) => `• ${q}`).join("\n")}` : "";
  store.addMessage(task, "product", `${task.spec ? "Spec updated" : "Spec is ready"} for your review. See the Spec tab.${qs}`);
  store.update(task, { status: "awaiting_approval", spec: out.spec, openQuestions: out.openQuestions });
}

/** Owner replied while the spec is waiting for approval: the Product Lead revises it. */
export function reviseSpec(task: Task) {
  return guarded(task, async () => {
    store.update(task, { status: "discussing", error: undefined });
    const ctx = await projectContext();
    await post(task, "techlead", "The owner just replied. If it changes anything technical, say how in 1-3 sentences. Otherwise reply with exactly: PASS", ctx);
    await writeSpec(task, ctx);
  });
}

// ---------- Stage 2: build → test → fix → review ----------

async function agentLoop(task: Task, opts: {
  purpose: Purpose;
  system: string;
  prompt: string;
  tools: Anthropic.Beta.Messages.BetaTool[];
  allowWrites: boolean;
  roles: RoleId[];
  effort: "low" | "medium" | "high" | "xhigh";
}): Promise<string> {
  const author = opts.roles[0];
  const messages: MessageParam[] = [{ role: "user", content: opts.prompt }];

  for (let step = 0; step < config.maxAgentSteps; step++) {
    const m = await callClaude(opts.purpose, {
      system: opts.system,
      tools: opts.tools,
      output_config: { effort: opts.effort },
      messages,
    });
    messages.push({ role: "assistant", content: m.content });

    if (m.stop_reason === "pause_turn") continue;
    const calls = m.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    if (m.stop_reason !== "tool_use" || !calls.length) {
      if (m.stop_reason === "max_tokens") {
        messages.push({ role: "user", content: "You hit the output limit. Continue, using smaller edits." });
        continue;
      }
      return textOf(m);
    }

    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      const summary = describeCall(call.name, input);
      for (const r of opts.roles) store.setAgent(r, { status: "working", activity: summary, taskCode: task.code });
      try {
        const out = await executeTool(call.name, input, opts.allowWrites);
        store.log(task, author, `${summary}\n${out}`);
        results.push({ type: "tool_result", tool_use_id: call.id, content: out });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        store.log(task, author, `${summary}\nERROR: ${msg}`);
        results.push({ type: "tool_result", tool_use_id: call.id, content: msg, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return `(Stopped after ${config.maxAgentSteps} tool steps without finishing.)`;
}

function describeCall(name: string, input: Record<string, unknown>) {
  switch (name) {
    case "run_command": return `$ ${input.command}`;
    case "search": return `search /${input.pattern}/`;
    case "list_files": return `list ${input.path || "."}`;
    default: return `${name} ${input.path ?? ""}`;
  }
}

// Only one task can use the repository at a time.
let buildQueue: Promise<void> = Promise.resolve();

export function build(task: Task) {
  store.update(task, { status: "building", error: undefined });
  store.log(task, "system", "Queued for build.");
  buildQueue = buildQueue.then(() => guarded(task, () => doBuild(task)));
  return buildQueue;
}

async function doBuild(task: Task) {
  if (!task.spec) throw new Error("No approved spec.");
  const dirty = (await git("status --porcelain")).trim();
  if (dirty) throw new Error(`The workspace has uncommitted changes. Commit or stash them first:\n${dirty}`);

  const base = task.baseBranch ?? (await git("rev-parse --abbrev-ref HEAD")).trim();
  const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const branch = `ai/${task.code.toLowerCase()}-${slug}`;
  if ((await git(`branch --list ${branch}`)).trim()) await git(`branch -D ${branch}`); // retry starts fresh
  await git(`checkout -b ${branch} ${base}`);
  store.update(task, { branch, baseBranch: base, diff: undefined, testOutput: undefined });
  store.addMessage(task, "techlead", `Spec approved. Working on branch \`${branch}\`.`);

  try {
    let feedback = "";
    for (let round = 0; round <= config.maxFixRounds; round++) {
      // Engineers implement (or fix).
      store.update(task, { status: "building" });
      const summary = await agentLoop(task, {
        purpose: "engineer",
        system: `${ENGINEER_SYSTEM_PROMPT}\n\n${await projectContext()}`,
        prompt: feedback
          ? `${taskBlock(task)}\n\nApproved spec:\n${task.spec}\n\nQA rejected the current implementation. The code changes so far are already in the working tree. Fix these problems:\n${feedback}`
          : `${taskBlock(task)}\n\nApproved spec:\n${task.spec}\n\nImplement it.`,
        tools: engineerTools,
        allowWrites: true,
        roles: ["techlead", "frontend", "backend"],
        effort: "high",
      });
      store.addMessage(task, "techlead", summary || "Implementation done.");

      // QA verifies.
      store.update(task, { status: "testing" });
      let testOutput = "";
      if (config.testCommand) {
        store.setAgent("qa", { status: "working", activity: `$ ${config.testCommand}`, taskCode: task.code });
        const t = await run(config.testCommand);
        testOutput = `$ ${config.testCommand}\nexit code ${t.code}\n${t.output}`;
        store.log(task, "qa", testOutput);
        store.update(task, { testOutput });
      }
      const diff = await git(`diff ${base}`, true);
      const report = await agentLoop(task, {
        purpose: "qa",
        system: QA_SYSTEM_PROMPT,
        prompt: `${taskBlock(task)}\n\nApproved spec:\n${task.spec}\n\nDiff against ${base} (uncommitted changes in the working tree):\n${diff.slice(0, 60_000) || "(empty diff)"}\n\n${testOutput ? `Test run:\n${testOutput.slice(0, 20_000)}` : "No test command is configured; run whatever checks make sense."}`,
        tools: qaTools,
        allowWrites: false,
        roles: ["qa"],
        effort: "medium",
      });
      store.addMessage(task, "qa", report);

      if (/VERDICT:\s*PASS/i.test(report)) break;
      if (round === config.maxFixRounds) {
        store.addMessage(task, "system", `QA still failing after ${config.maxFixRounds} fix rounds. Handing over for your review anyway.`);
        break;
      }
      feedback = report;
    }
  } finally {
    // Always leave the repo clean and back on the base branch, keeping the work on the task branch.
    await git("add -A");
    if ((await git("status --porcelain")).trim()) {
      await git(`commit -m ${shq(`${task.code}: ${task.title}`)} -m ${shq("Implemented by AI Dev Team.")}`);
    }
    await git(`checkout ${base}`);
  }

  const diff = await git(`diff ${base}...${branch}`, true);
  store.update(task, { status: "ready_for_review", diff });
  store.addMessage(task, "techlead", `Ready for your review on branch \`${branch}\`. See the Changes tab.`);
}

export async function merge(task: Task) {
  if (!task.branch || !task.baseBranch) throw new Error("Nothing to merge");
  const dirty = (await git("status --porcelain")).trim();
  if (dirty) throw new Error("The workspace has uncommitted changes; commit or stash them first.");
  await git(`checkout ${task.baseBranch}`);
  await git(`merge --no-ff ${task.branch} -m ${shq(`Merge ${task.code}: ${task.title}`)}`);
  store.update(task, { status: "merged" });
  store.addMessage(task, "system", `Merged \`${task.branch}\` into \`${task.baseBranch}\`.`);
}

export async function reject(task: Task) {
  if (task.branch) await git(`branch -D ${task.branch}`).catch(() => {});
  store.update(task, { status: "rejected" });
  store.addMessage(task, "system", "Rejected by the owner. Branch deleted.");
}

export function retry(task: Task) {
  if (task.approved) return build(task);
  return task.spec ? reviseSpec(task) : discuss(task);
}
