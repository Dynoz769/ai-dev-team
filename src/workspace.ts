import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { run } from "./tools.ts";

export async function git(args: string, allowFail = false): Promise<string> {
  const { code, output } = await run(`git ${args}`, config.workspaceDir, 120_000);
  if (code !== 0 && !allowFail) throw new Error(`git ${args} failed:\n${output}`);
  return output;
}

/** Commit/merge as the user if git knows who they are, otherwise as "AI Dev Team" (fresh installs have no identity). */
export async function authorFlags(): Promise<string> {
  const email = (await git("config user.email", true)).trim();
  const name = (await git("config user.name", true)).trim();
  return email && name ? "" : `-c user.name="AI Dev Team" -c user.email=ai-dev-team@example.com `;
}

/**
 * What the agents know about the project: its file list, README and any agent/contributor notes.
 * Goes in the system prompt, so it stays identical between calls and gets cached.
 */
export async function projectContext(): Promise<string> {
  const root = config.workspaceDir;
  const { output: files } = await run("git ls-files | head -400", root);
  const parts = [`# The project\nRepository: ${path.basename(root)}\n\nFiles:\n${files.trim() || "(empty repo)"}`];
  for (const name of ["AGENTS.md", "CLAUDE.md", "README.md", "CONTRIBUTING.md", "package.json"]) {
    const f = path.join(root, name);
    if (fs.existsSync(f)) parts.push(`## ${name}\n${fs.readFileSync(f, "utf8").slice(0, 4000)}`);
  }
  return parts.join("\n\n");
}

/** Checks the configured repo, or creates a small demo repo so the app can be tried right away. */
export async function prepareWorkspace() {
  config.workspaceWarning = "";
  config.usingDemo = false;
  if (config.workspaceDir) {
    if (fs.existsSync(path.join(config.workspaceDir, ".git"))) return;
    // Don't crash on a bad folder: fall back to the demo and say why in Settings.
    config.workspaceWarning = fs.existsSync(config.workspaceDir)
      ? `${config.workspaceDir} isn't set up for git yet. Open Settings to fix it.`
      : `Folder not found: ${config.workspaceDir}. Open Settings to choose another.`;
    console.warn(config.workspaceWarning + " Using the demo project for now.");
  }
  const dir = path.join(config.dataDir, "demo-workspace");
  config.workspaceDir = dir;
  config.usingDemo = true;
  if (!config.testCommand) config.testCommand = "npm test";
  if (fs.existsSync(path.join(dir, ".git"))) return;

  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  const write = (f: string, s: string) => fs.writeFileSync(path.join(dir, f), s);
  write("package.json", JSON.stringify({ name: "demo-bookings", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n");
  write("README.md", "# Demo bookings\n\nA tiny room-booking library used to try out AI Dev Team.\n");
  write(
    "src/bookings.js",
    `export const rooms = [
  { id: "A", name: "Studio A", pricePerHour: 50, capacity: 4 },
  { id: "B", name: "Studio B", pricePerHour: 80, capacity: 8 },
];

const bookings = [];

/** True if the room has no booking overlapping [start, end). Times are Date objects. */
export function isAvailable(roomId, start, end) {
  return !bookings.some((b) => b.roomId === roomId && b.start < end && start < b.end);
}

export function book(roomId, start, end) {
  const room = rooms.find((r) => r.id === roomId);
  if (!room) throw new Error("Unknown room " + roomId);
  if (!(start < end)) throw new Error("start must be before end");
  if (!isAvailable(roomId, start, end)) throw new Error("Room is not available");
  const hours = (end - start) / 3_600_000;
  const booking = { id: bookings.length + 1, roomId, start, end, price: hours * room.pricePerHour };
  bookings.push(booking);
  return booking;
}

export function _reset() {
  bookings.length = 0;
}
`,
  );
  write(
    "test/bookings.test.js",
    `import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { book, isAvailable, _reset } from "../src/bookings.js";

const at = (h) => new Date(Date.UTC(2026, 0, 1, h));
beforeEach(_reset);

test("books a free room and prices it by the hour", () => {
  assert.equal(book("A", at(9), at(11)).price, 100);
});

test("rejects overlapping bookings", () => {
  book("A", at(9), at(11));
  assert.equal(isAvailable("A", at(10), at(12)), false);
  assert.throws(() => book("A", at(10), at(12)));
});
`,
  );
  await git("init -q -b main");
  await git('config user.name "AI Dev Team"');
  await git('config user.email "ai-dev-team@example.com"');
  await git("add -A");
  await git('commit -q -m "Demo project"');
}
