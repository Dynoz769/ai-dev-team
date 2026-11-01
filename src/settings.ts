import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.ts";
import { store, events } from "./store.ts";
import { prepareWorkspace } from "./workspace.ts";
import { resetClient } from "./llm.ts";
import { run, shq } from "./tools.ts";

const ENV_FILE = path.resolve(".env");

/** Update keys in .env, keeping every other line (and comments) as they are. */
function writeEnv(updates: Record<string, string>) {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : [];
  const done = new Set<string>();
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Z_]+)\s*=/);
    if (m && m[1] in updates) {
      done.add(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) if (!done.has(k)) out.push(`${k}=${v}`);
  fs.writeFileSync(ENV_FILE, out.join("\n").replace(/\n*$/, "\n"));
  for (const [k, v] of Object.entries(updates)) process.env[k] = v;
}

export function getSettings() {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  return {
    hasKey: !!key,
    keyHint: key ? `…${key.slice(-4)}` : "",
    workspaceDir: config.usingDemo ? process.env.WORKSPACE_DIR ?? "" : config.workspaceDir,
    usingDemo: config.usingDemo,
    warning: config.workspaceWarning,
    testCommand: config.testCommand,
    model: config.model,
    practice: config.mock,
  };
}

function guessTestCommand(dir: string) {
  const pkg = path.join(dir, "package.json");
  if (fs.existsSync(pkg)) {
    try {
      const test = JSON.parse(fs.readFileSync(pkg, "utf8")).scripts?.test ?? "";
      if (test && !test.includes("no test specified")) return "npm test";
    } catch {}
  }
  if (fs.existsSync(path.join(dir, "pytest.ini")) || fs.existsSync(path.join(dir, "pyproject.toml"))) return "pytest";
  if (fs.existsSync(path.join(dir, "go.mod"))) return "go test ./...";
  if (fs.existsSync(path.join(dir, "Cargo.toml"))) return "cargo test";
  return "";
}

export interface SettingsInput {
  apiKey?: string;
  workspaceDir?: string;
  testCommand?: string;
  model?: string;
  practice?: boolean;
  initGit?: boolean;
}

export async function saveSettings(input: SettingsInput): Promise<{ ok: true } | { error: string; needsGit?: boolean }> {
  if (store.snapshot().tasks.some((t) => ["discussing", "building", "testing"].includes(t.status))) {
    return { error: "The team is busy on a task. Wait until it's done, then change settings." };
  }
  const updates: Record<string, string> = {};

  // API key: check it really works before saving.
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    try {
      await new Anthropic({ apiKey, maxRetries: 0, timeout: 20_000 }).models.list({ limit: 1 });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        return { error: "That API key didn't work. Copy it again from console.anthropic.com → API Keys." };
      }
      if (err instanceof Anthropic.APIError) return { error: `Couldn't check the key: ${err.message}` };
      return { error: "Couldn't reach Anthropic to check the key. Check your internet connection." };
    }
    updates.ANTHROPIC_API_KEY = apiKey;
  }

  // Project folder.
  let newDir = config.workspaceDir;
  if (input.workspaceDir !== undefined) {
    const raw = input.workspaceDir.trim().replace(/^["']|["']$/g, "");
    if (!raw) {
      updates.WORKSPACE_DIR = "";
      newDir = "";
    } else {
      let dir = path.resolve(raw.replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || "~"));
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { error: `Folder not found: ${dir}` };
      // A folder inside an existing git project: work on that whole project.
      const top = await run("git rev-parse --show-toplevel", dir, 20_000);
      if (top.code === 0 && top.output.trim()) dir = path.resolve(top.output.trim());
      if (!fs.existsSync(path.join(dir, ".git"))) {
        if (!input.initGit) {
          return { error: `This folder isn't set up for git yet. The team needs git to keep its work separate from yours.`, needsGit: true };
        }
        const steps = [
          "git init",
          "git add -A",
          `git -c user.name=${shq("AI Dev Team")} -c user.email=ai-dev-team@example.com commit -q --allow-empty -m ${shq("Starting point before AI Dev Team")}`,
        ];
        for (const cmd of steps) {
          const r = await run(cmd, dir, 120_000);
          if (r.code !== 0) return { error: `Setting up git failed:\n${r.output}` };
        }
      }
      updates.WORKSPACE_DIR = dir;
      newDir = dir;
      if (input.testCommand === undefined) updates.TEST_COMMAND = guessTestCommand(dir);
    }
  }
  if (input.testCommand !== undefined) updates.TEST_COMMAND = input.testCommand.trim();
  if (input.model) updates.MODEL = input.model;

  const hasKey = !!(apiKey || process.env.ANTHROPIC_API_KEY);
  if (input.practice === false && !hasKey) return { error: "Add your API key first to use real AI workers." };
  if (input.practice !== undefined) updates.MOCK = input.practice ? "1" : "0";

  writeEnv(updates);

  // Apply right away, no restart needed.
  if ("ANTHROPIC_API_KEY" in updates) resetClient();
  if ("MODEL" in updates) config.model = updates.MODEL;
  if ("MOCK" in updates) config.mock = updates.MOCK === "1";
  if ("WORKSPACE_DIR" in updates || "TEST_COMMAND" in updates) {
    config.workspaceDir = newDir;
    config.testCommand = process.env.TEST_COMMAND ?? "";
    await prepareWorkspace();
  }
  events.emit("change");
  return { ok: true };
}
