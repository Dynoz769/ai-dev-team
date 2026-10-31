import express, { type Request, type Response, type NextFunction } from "express";
import { config } from "./config.ts";
import { store, events } from "./store.ts";
import { ROLES } from "./agents.ts";
import { prepareWorkspace } from "./workspace.ts";
import { discuss, reviseSpec, build, merge, reject, retry } from "./pipeline.ts";

await prepareWorkspace();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const info = () => ({
  model: config.mock ? "mock" : config.model,
  workspace: config.workspaceDir,
  testCommand: config.testCommand,
  budgetUsd: config.monthlyBudgetUsd,
  mock: config.mock,
  roles: ROLES,
});

app.get("/api/state", (_req, res) => res.json({ ...store.snapshot(), info: info() }));

// Live updates: the dashboard re-renders from each snapshot.
app.get("/api/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  let pending: NodeJS.Timeout | undefined;
  const send = () => {
    pending ??= setTimeout(() => {
      pending = undefined;
      res.write(`data: ${JSON.stringify({ ...store.snapshot(), info: info() })}\n\n`);
    }, 150);
  };
  send();
  events.on("change", send);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    events.off("change", send);
    clearInterval(ping);
    clearTimeout(pending);
  });
});

const task = (req: Request) => store.getTask(Number(req.params.id));
const ok = (res: Response) => res.json({ ok: true });

app.post("/api/tasks", (req, res) => {
  const title = String(req.body.title ?? "").trim();
  if (!title) return res.status(400).json({ error: "Title is required" });
  const t = store.createTask(title, String(req.body.description ?? "").trim());
  void discuss(t);
  res.json(t);
});

app.post("/api/tasks/:id/messages", (req, res) => {
  const t = task(req);
  const text = String(req.body.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "Message is empty" });
  store.addMessage(t, "owner", text);
  if (t.status === "awaiting_approval") void reviseSpec(t);
  ok(res);
});

app.post("/api/tasks/:id/approve", (req, res) => {
  const t = task(req);
  if (t.status !== "awaiting_approval") return res.status(409).json({ error: "Task is not waiting for approval" });
  store.update(t, { approved: true });
  void build(t);
  ok(res);
});

app.post("/api/tasks/:id/merge", async (req, res) => {
  const t = task(req);
  if (t.status !== "ready_for_review") return res.status(409).json({ error: "Task is not ready for review" });
  await merge(t);
  ok(res);
});

app.post("/api/tasks/:id/reject", async (req, res) => {
  await reject(task(req));
  ok(res);
});

app.post("/api/tasks/:id/retry", (req, res) => {
  const t = task(req);
  if (t.status !== "failed") return res.status(409).json({ error: "Only failed tasks can be retried" });
  void retry(t);
  ok(res);
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err.message });
});

// Agents can run shell commands in your repo, so only listen on this machine unless told otherwise.
const host = process.env.HOST || "127.0.0.1";
app.listen(config.port, host, () => {
  console.log(`AI Dev Team running at http://${host === "0.0.0.0" ? "localhost" : host}:${config.port}`);
  console.log(`Workspace: ${config.workspaceDir}${config.mock ? "  (MOCK mode: no API calls)" : ""}`);
});
