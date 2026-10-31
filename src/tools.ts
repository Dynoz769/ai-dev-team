import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.ts";

type Tool = Anthropic.Beta.Messages.BetaTool;

const str = { type: "string" } as const;

const READ_TOOLS: Tool[] = [
  {
    name: "list_files",
    description: "List files in the repository (respects .gitignore). Optionally only under a sub-directory.",
    input_schema: { type: "object", properties: { path: { ...str, description: "Sub-directory, relative to repo root" } }, required: [] },
  },
  {
    name: "read_file",
    description: "Read a text file. Returns numbered lines. Use start_line/end_line for big files.",
    input_schema: {
      type: "object",
      properties: { path: str, start_line: { type: "integer" }, end_line: { type: "integer" } },
      required: ["path"],
    },
  },
  {
    name: "search",
    description: "Search tracked files for a regular expression (git grep -E). Returns matching lines with file:line.",
    input_schema: { type: "object", properties: { pattern: str, path: { ...str, description: "Limit to this path" } }, required: ["pattern"] },
  },
  {
    name: "run_command",
    description:
      "Run a shell command in the repo root (e.g. install deps, build, lint, run tests, git diff/status). 5 minute timeout. Do not use it for git commit/push/checkout/reset; the orchestrator handles git.",
    input_schema: { type: "object", properties: { command: str }, required: ["command"] },
  },
];

const WRITE_TOOLS: Tool[] = [
  {
    name: "write_file",
    description: "Create or overwrite a file with the full content given.",
    input_schema: { type: "object", properties: { path: str, content: str }, required: ["path", "content"] },
  },
  {
    name: "edit_file",
    description: "Replace one exact occurrence of old_text with new_text in a file. old_text must match exactly once; include surrounding lines to make it unique.",
    input_schema: { type: "object", properties: { path: str, old_text: str, new_text: str }, required: ["path", "old_text", "new_text"] },
  },
];

export const engineerTools = [...READ_TOOLS, ...WRITE_TOOLS];
export const qaTools = READ_TOOLS;

const MAX_OUTPUT = 20_000;
const clip = (s: string) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…(${s.length - MAX_OUTPUT} more chars truncated)` : s);

/** Resolve a model-supplied path and refuse anything outside the workspace (.., absolute paths, symlinks out). */
function safePath(p: unknown): string {
  if (typeof p !== "string" || !p) throw new Error("path must be a non-empty string");
  const root = fs.realpathSync(config.workspaceDir);
  const target = path.resolve(root, p);
  let real = target;
  // For new files, check the nearest existing parent directory instead.
  let probe = target;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  real = path.join(fs.realpathSync(probe), path.relative(probe, target));
  const rel = path.relative(root, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`path escapes the repository: ${p}`);
  if (rel === ".git" || rel.startsWith(".git" + path.sep)) throw new Error("the .git directory is off limits");
  return real;
}

export function run(command: string, cwd = config.workspaceDir, timeoutMs = 5 * 60_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
    let output = "";
    const onData = (d: Buffer) => {
      output += d.toString();
      if (output.length > MAX_OUTPUT * 4) output = output.slice(-MAX_OUTPUT * 2);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      output += `\n[timed out after ${timeoutMs / 1000}s]`;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: clip(output) });
    });
  });
}

/** Quote a string for bash. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const BLOCKED_GIT = /\bgit\s+(push|commit|checkout|switch|reset|rebase|merge|branch\s+-[dD]|clean|stash)\b/;

export async function executeTool(name: string, input: Record<string, unknown>, allowWrites: boolean): Promise<string> {
  switch (name) {
    case "list_files": {
      const { output } = await run("git ls-files -co --exclude-standard");
      const prefix = typeof input.path === "string" && input.path && input.path !== "." ? input.path.replace(/\/?$/, "/") : "";
      const files = output.split("\n").filter((f) => f && f.startsWith(prefix));
      return files.length > 800 ? files.slice(0, 800).join("\n") + `\n…and ${files.length - 800} more` : files.join("\n") || "(no files)";
    }
    case "read_file": {
      const file = safePath(input.path);
      if (!fs.existsSync(file)) throw new Error(`file not found: ${input.path}`);
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const start = Math.max(1, Number(input.start_line) || 1);
      const end = Math.min(lines.length, Number(input.end_line) || start + 1999);
      const body = lines.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join("\n");
      return clip(body + (end < lines.length ? `\n…(file has ${lines.length} lines; read more with start_line=${end + 1})` : ""));
    }
    case "search": {
      if (typeof input.pattern !== "string") throw new Error("pattern must be a string");
      const where = typeof input.path === "string" && input.path ? ` -- ${shq(input.path)}` : "";
      const { output } = await run(`git grep -n -I -E -e ${shq(input.pattern)}${where} | head -200`);
      return output || "(no matches)";
    }
    case "run_command": {
      if (typeof input.command !== "string") throw new Error("command must be a string");
      if (BLOCKED_GIT.test(input.command)) throw new Error("that git command is not allowed; the orchestrator handles commits and branches");
      const { code, output } = await run(input.command);
      return `exit code ${code}\n${output}`;
    }
    case "write_file": {
      if (!allowWrites) throw new Error("you have read-only access");
      if (typeof input.content !== "string") throw new Error("content must be a string");
      const file = safePath(input.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, input.content);
      return `wrote ${input.path} (${input.content.split("\n").length} lines)`;
    }
    case "edit_file": {
      if (!allowWrites) throw new Error("you have read-only access");
      if (typeof input.old_text !== "string" || typeof input.new_text !== "string") throw new Error("old_text and new_text must be strings");
      const file = safePath(input.path);
      const text = fs.readFileSync(file, "utf8");
      const count = text.split(input.old_text).length - 1;
      if (count !== 1) throw new Error(`old_text matched ${count} times; it must match exactly once`);
      fs.writeFileSync(file, text.replace(input.old_text, () => input.new_text as string));
      return `edited ${input.path}`;
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}
