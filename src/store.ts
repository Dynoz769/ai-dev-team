import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { config } from "./config.ts";
import type { RoleId } from "./agents.ts";

export type TaskStatus =
  | "discussing" // agents are debating the task
  | "awaiting_approval" // spec written, waiting for the owner
  | "building" // engineers are coding
  | "testing" // QA is running tests
  | "ready_for_review" // code is on a branch, waiting for the owner
  | "merged"
  | "rejected"
  | "failed";

export type Author = RoleId | "owner" | "system";

export interface Message {
  id: number;
  author: Author;
  text: string;
  at: string;
}

export interface LogEntry {
  at: string;
  author: Author;
  text: string;
}

export interface Task {
  id: number;
  code: string;
  title: string;
  description: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  spec?: string;
  approved?: boolean;
  openQuestions?: string[];
  branch?: string;
  baseBranch?: string;
  diff?: string;
  testOutput?: string;
  logs: LogEntry[];
  error?: string;
}

export interface AgentState {
  status: "idle" | "working";
  activity: string;
  taskCode?: string;
}

export interface Usage {
  month: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

interface Db {
  nextId: number;
  nextMessageId: number;
  tasks: Task[];
  usage: Usage;
}

const file = path.join(config.dataDir, "db.json");
const thisMonth = () => new Date().toISOString().slice(0, 7);

function load(): Db {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    nextId: 1001,
    nextMessageId: 1,
    tasks: [],
    usage: { month: thisMonth(), costUsd: 0, inputTokens: 0, outputTokens: 0 },
  };
}

const db = load();
const agents: Partial<Record<RoleId, AgentState>> = {};

export const events = new EventEmitter();

let saveTimer: NodeJS.Timeout | undefined;
function changed() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db, null, 2));
  }, 200);
  events.emit("change");
}

// A server restart interrupts any running work; mark it so the owner can retry.
for (const t of db.tasks) {
  if (t.status === "discussing" || t.status === "building" || t.status === "testing") {
    t.status = "failed";
    t.error = "Interrupted by a server restart. Use Retry to run this stage again.";
  }
}

const now = () => new Date().toISOString();

export const store = {
  snapshot() {
    return { tasks: db.tasks, agents, usage: db.usage };
  },

  getTask(id: number) {
    const t = db.tasks.find((t) => t.id === id);
    if (!t) throw new Error(`No task ${id}`);
    return t;
  },

  createTask(title: string, description: string): Task {
    const id = db.nextId++;
    const task: Task = {
      id,
      code: `TASK-${id}`,
      title,
      description,
      status: "discussing",
      createdAt: now(),
      updatedAt: now(),
      messages: [],
      logs: [],
    };
    db.tasks.unshift(task);
    changed();
    return task;
  },

  update(task: Task, patch: Partial<Task>) {
    Object.assign(task, patch, { updatedAt: now() });
    changed();
  },

  addMessage(task: Task, author: Author, text: string) {
    task.messages.push({ id: db.nextMessageId++, author, text, at: now() });
    task.updatedAt = now();
    changed();
  },

  log(task: Task, author: Author, text: string) {
    const max = 4000;
    task.logs.push({ at: now(), author, text: text.length > max ? text.slice(0, max) + "\n…(truncated)" : text });
    if (task.logs.length > 500) task.logs.splice(0, task.logs.length - 500);
    changed();
  },

  setAgent(role: RoleId, state: AgentState) {
    agents[role] = state;
    changed();
  },

  addUsage(inputTokens: number, outputTokens: number, costUsd: number) {
    if (db.usage.month !== thisMonth()) {
      db.usage = { month: thisMonth(), costUsd: 0, inputTokens: 0, outputTokens: 0 };
    }
    db.usage.inputTokens += inputTokens;
    db.usage.outputTokens += outputTokens;
    db.usage.costUsd += costUsd;
    changed();
  },
};
