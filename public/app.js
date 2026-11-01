const $ = (s, el = document) => el.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let state = null;
let selectedId = null;
let filter = "active";
let tab = "discussion";

const STATUS = {
  discussing: "Discussing",
  awaiting_approval: "Needs your approval",
  building: "Building",
  testing: "Testing",
  ready_for_review: "Ready for review",
  merged: "Merged",
  rejected: "Rejected",
  failed: "Failed",
};
const DONE = ["merged", "rejected"];
const BUSY = ["discussing", "building", "testing"];

// ---------- helpers ----------
const role = (id) => state.info.roles.find((r) => r.id === id);
const initials = (name) => name.replace("UI/UX", "UX").split(/[\s/]+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
function avatar(author, cls = "") {
  if (author === "owner") return `<div class="avatar ${cls}" style="background:#e7eaf0">You</div>`;
  if (author === "system") return `<div class="avatar ${cls}" style="background:#5b6478">⚙</div>`;
  const r = role(author);
  return `<div class="avatar ${cls}" style="background:${r.color}">${initials(r.name)}</div>`;
}
const authorName = (a) => (a === "owner" ? "You" : a === "system" ? "System" : role(a).name);

/** Tiny markdown renderer: enough for specs (headings, lists, bold, code). */
function md(src = "") {
  const blocks = [];
  src = src.replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code) => `\u0000${blocks.push(code) - 1}\u0000`);
  let html = esc(src)
    .replace(/^### (.*)$/gm, "<h3>$1</h3>").replace(/^## (.*)$/gm, "<h2>$1</h2>").replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^(?:[-*] .*(?:\n|$))+/gm, (m) => `<ul>${m.trim().split("\n").map((l) => `<li>${l.slice(2)}</li>`).join("")}</ul>`)
    .replace(/^(?:\d+\. .*(?:\n|$))+/gm, (m) => `<ol>${m.trim().split("\n").map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("")}</ol>`)
    .replace(/\n{2,}/g, "<br><br>");
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre>${esc(blocks[i])}</pre>`);
}
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

function diffHtml(diff) {
  return diff.split("\n").map((l) => {
    const cls = l.startsWith("diff --git") ? "file" : l.startsWith("@@") ? "hunk" : l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : "";
    return `<span class="${cls}">${esc(l)}</span>`;
  }).join("\n");
}

async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) alert(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- the 3D office ----------
import { createOffice3D } from "./office3d.js";

let office = null;
const speech = {}; // role -> { text, until }
let seenMessages = null;
let speechTimer;

/** New chat messages from agents pop up as speech bubbles for a few seconds. */
function collectSpeech() {
  const all = state.tasks.flatMap((t) => t.messages);
  if (!seenMessages) { seenMessages = new Set(all.map((m) => m.id)); return; }
  for (const m of all) {
    if (seenMessages.has(m.id)) continue;
    seenMessages.add(m.id);
    if (!state.info.roles.some((r) => r.id === m.author)) continue;
    const text = m.text.replace(/\s+/g, " ").replace(/^\[mock\] /, "");
    speech[m.author] = { text: text.length > 110 ? text.slice(0, 107) + "…" : text, until: Date.now() + 6000 };
  }
  clearTimeout(speechTimer);
  const next = Math.min(...Object.values(speech).map((s) => s.until).filter((u) => u > Date.now()));
  if (Number.isFinite(next)) speechTimer = setTimeout(renderOffice, next - Date.now() + 50);
}

function renderOffice() {
  if (!office) {
    try {
      office = createOffice3D($("#office"), state.info.roles);
    } catch (err) {
      $("#office").innerHTML = `<div class="empty">The 3D office needs WebGL, which this browser doesn't support.<br><small>${esc(err.message)}</small></div>`;
      office = { update() {} };
    }
  }
  collectSpeech();
  const taskByCode = Object.fromEntries(state.tasks.map((t) => [t.code, t]));
  let meetingTask = null;
  const perAgent = {};
  for (const r of state.info.roles) {
    const a = state.agents[r.id] ?? { mode: "idle", activity: "Free", status: "idle" };
    const task = a.taskCode ? taskByCode[a.taskCode] : null;
    const talking = speech[r.id]?.until > Date.now();
    // At the table while meeting, and while thinking/talking during a discussion.
    const atTable = a.mode === "meeting" || (task?.status === "discussing" && (a.mode === "thinking" || talking));
    if (atTable && task) meetingTask = task;
    perAgent[r.id] = {
      mode: a.mode,
      activity: `${a.taskCode ? a.taskCode + " · " : ""}${a.activity}`,
      label: talking ? "Talking" : a.mode === "idle" ? "Free" : a.activity,
      talking,
      speech: talking ? esc(speech[r.id].text) : "",
      atTable,
    };
  }
  office.update(perAgent, meetingTask ? `${meetingTask.code} · ${meetingTask.title}` : "");
}

// ---------- rendering ----------
function render() {
  const { info, usage, tasks, agents } = state;
  const hour = new Date().getHours();
  $("#greeting").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"} 👋`;
  const active = tasks.filter((t) => !DONE.includes(t.status));
  $("#subtitle").textContent = `Your AI team has ${active.length} active task${active.length === 1 ? "" : "s"}`;
  $("#mockBanner").hidden = !info.mock;
  $("#wsName").textContent = info.usingDemo ? "Demo project" : info.workspace.split(/[\\/]/).pop();
  $("#wsPath").textContent = info.testCommand ? `tests: ${info.testCommand}` : "no test command";
  $("#modelName").textContent = info.model;
  const pct = Math.min(100, Math.round((usage.costUsd / info.budgetUsd) * 100));
  $("#usagePct").textContent = `${pct}%`;
  $("#usageBar").style.width = `${pct}%`;
  $("#usageText").textContent = `$${usage.costUsd.toFixed(2)} / $${info.budgetUsd}`;

  const working = info.roles.filter((r) => agents[r.id]?.status === "working").length;
  $("#officeStats").textContent = `${info.roles.length} agents · ${working} working · ${tasks.filter((t) => BUSY.includes(t.status)).length} tasks in progress`;
  renderOffice();

  const list = tasks.filter((t) => (filter === "done") === DONE.includes(t.status));
  $("#taskList").innerHTML = list.length ? list.map((t) => `
    <div class="task-row ${t.id === selectedId ? "selected" : ""}" data-id="${t.id}">
      <span class="code">${t.code}</span>
      <div><b>${esc(t.title)}</b><small>${esc((t.description || "").slice(0, 110))}</small></div>
      <span class="pill ${t.status}">${STATUS[t.status]}</span>
      <span class="when">${ago(t.updatedAt)}</span>
    </div>`).join("") : `<div class="empty">${filter === "done" ? "Nothing finished yet." : "No active tasks. Click “New Task” to give the team something to do."}</div>`;

  renderDetail();
}

let detailFor = null;
function renderDetail() {
  const t = state.tasks.find((x) => x.id === selectedId);
  const el = $("#detail");
  if (!t) { el.innerHTML = `<div class="empty">Select a task, or create a new one.</div>`; detailFor = null; return; }

  // Build the frame once per task so the message box keeps what you're typing.
  if (detailFor !== t.id) {
    detailFor = t.id;
    el.innerHTML = `<div class="detail-head"></div>
      <div class="tabs">${["discussion", "spec", "changes", "logs"].map((k) => `<button data-tab="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>
      <div class="detail-body"></div><div class="action-bar"></div>
      <form class="composer"><input placeholder="Message the team…" /><button class="primary">Send</button></form>`;
    $(".composer", el).onsubmit = async (e) => {
      e.preventDefault();
      const input = $(".composer input", el);
      if (!input.value.trim()) return;
      const text = input.value; input.value = "";
      await api(`/api/tasks/${t.id}/messages`, { text });
    };
  }
  el.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));

  $(".detail-head", el).innerHTML = `<span class="code" style="color:var(--muted);font-size:12px">${t.code}</span> <span class="pill ${t.status}">${STATUS[t.status]}</span>
    <h3>${esc(t.title)}</h3><small>${esc(t.description)}</small>`;

  const body = $(".detail-body", el);
  const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  const err = t.status === "failed" && t.error ? `<div class="error">${esc(t.error)}</div>` : "";

  if (tab === "discussion") {
    const busy = Object.entries(state.agents).filter(([, a]) => a.status === "working" && a.taskCode === t.code).map(([id]) => role(id).name);
    body.innerHTML = err + (t.messages.map((m) => `<div class="msg ${m.author}">${avatar(m.author, "sm")}
        <div><div class="who">${esc(authorName(m.author))}<small>${new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div>
        <div class="text">${inline(m.text)}</div></div></div>`).join("") || `<div class="empty">The team is getting started…</div>`)
      + (busy.length ? `<div class="typing">${esc(busy.join(", "))} ${busy.length > 1 ? "are" : "is"} working…</div>` : "");
  } else if (tab === "spec") {
    body.innerHTML = err + (t.spec ? `<div class="md">${md(t.spec)}</div>` : `<div class="empty">The spec will appear here once the discussion is done.</div>`);
  } else if (tab === "changes") {
    body.innerHTML = err + (t.branch ? `<small>Branch <code>${esc(t.branch)}</code> from <code>${esc(t.baseBranch)}</code></small>` : "")
      + (t.diff ? `<pre class="diff">${diffHtml(t.diff)}</pre>` : `<div class="empty">No code changes yet.</div>`)
      + (t.testOutput ? `<h4>Last test run</h4><pre>${esc(t.testOutput)}</pre>` : "");
  } else {
    body.innerHTML = err + (t.logs.length ? t.logs.slice().reverse().map((l) => `<div class="log"><small>${new Date(l.at).toLocaleTimeString()} · ${esc(authorName(l.author))}</small><pre>${esc(l.text)}</pre></div>`).join("") : `<div class="empty">No activity yet.</div>`);
  }
  if (tab === "discussion" && nearBottom) body.scrollTop = body.scrollHeight;

  const bar = $(".action-bar", el);
  const actions = {
    awaiting_approval: `<span class="hint">Review the Spec tab. Reply in the chat to request changes, or approve to start coding.</span>
      <button class="primary" data-act="approve">Approve spec & build</button><button class="danger" data-act="reject">Reject</button>`,
    ready_for_review: `<span class="hint">Review the Changes tab. Merge into <code>${esc(t.baseBranch)}</code> or reject.</span>
      <button class="primary" data-act="merge">Merge</button><button class="danger" data-act="reject">Reject</button>`,
    failed: `<span class="hint">Something went wrong. Fix the cause (see the error) and retry.</span>
      <button class="primary" data-act="retry">Retry</button><button class="danger" data-act="reject">Discard</button>`,
  };
  bar.innerHTML = actions[t.status] ?? `<span class="hint">${BUSY.includes(t.status) ? "The team is working on this. You can still post in the chat." : ""}</span>`;
  bar.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.act === "reject" && !confirm("Reject this task?")) return;
    b.disabled = true;
    await api(`/api/tasks/${t.id}/${b.dataset.act}`);
  }));
}

// ---------- events ----------
document.addEventListener("click", (e) => {
  const row = e.target.closest(".task-row");
  if (row) { selectedId = Number(row.dataset.id); tab = "discussion"; render(); }
  const tb = e.target.closest("#taskTabs [data-filter]");
  if (tb) { filter = tb.dataset.filter; document.querySelectorAll("#taskTabs button").forEach((b) => b.classList.toggle("active", b === tb)); render(); }
  const dt = e.target.closest("#detail [data-tab]");
  if (dt) { tab = dt.dataset.tab; renderDetail(); }
});

$("#newTaskBtn").onclick = () => $("#newTask").showModal();

// ---------- settings ----------
const settingsForm = $("#settingsForm");
async function openSettings() {
  const st = await (await fetch("/api/settings")).json();
  const f = settingsForm.elements;
  f.apiKey.value = "";
  f.apiKey.placeholder = st.hasKey ? `Saved (${st.keyHint}). Paste a new key to replace it.` : "sk-ant-…";
  f.workspaceDir.value = st.workspaceDir || "";
  f.testCommand.value = st.usingDemo && !st.workspaceDir ? "" : st.testCommand || "";
  f.model.value = st.model;
  f.practice.checked = st.practice;
  $("#settingsIntro").textContent = !st.hasKey
    ? "Welcome! You're in practice mode, so you can look around for free. To have real AI workers build your project, paste your API key and choose your project folder."
    : st.usingDemo ? "Your API key is set. Choose your project folder so the team works on your code instead of the demo." : "";
  showSettingsError(st.warning || "");
  $("#initGitBtn").hidden = true;
  $("#settings").showModal();
}
function showSettingsError(msg, ok = false) {
  const el = $("#settingsError");
  el.hidden = !msg;
  el.textContent = msg;
  el.className = ok ? "ok" : "error";
}
async function saveSettings(initGit = false) {
  const f = settingsForm.elements;
  const body = {
    workspaceDir: f.workspaceDir.value,
    model: f.model.value,
    practice: f.practice.checked,
    initGit,
  };
  if (f.apiKey.value.trim()) {
    body.apiKey = f.apiKey.value.trim();
    if (f.practice.checked && !initGit) body.practice = false; // adding a key means they want the real thing
  }
  if (f.testCommand.value.trim() || f.workspaceDir.value.trim() === "") body.testCommand = f.testCommand.value;
  $("#settingsSave").disabled = true;
  $("#settingsSave").textContent = body.apiKey ? "Checking key…" : "Saving…";
  try {
    const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.error) {
      showSettingsError(data.error);
      $("#initGitBtn").hidden = !data.needsGit;
      return;
    }
    $("#initGitBtn").hidden = true;
    const st = await (await fetch("/api/settings")).json();
    f.apiKey.value = "";
    f.apiKey.placeholder = st.hasKey ? `Saved (${st.keyHint}). Paste a new key to replace it.` : "sk-ant-…";
    f.workspaceDir.value = st.workspaceDir || "";
    f.testCommand.value = st.usingDemo && !st.workspaceDir ? "" : st.testCommand || "";
    f.practice.checked = st.practice;
    showSettingsError(
      st.practice ? "Saved. You're still in practice mode (untick it to use real AI workers)."
        : `Saved. Real AI workers are ready${st.usingDemo ? " (on the demo project)" : ` on ${st.workspaceDir}`}. Create a task to start!`,
      true,
    );
  } finally {
    $("#settingsSave").disabled = false;
    $("#settingsSave").textContent = "Save";
  }
}
$("#settingsBtn").onclick = openSettings;
$("#mockBanner").onclick = openSettings;
$("#settingsCancel").onclick = () => $("#settings").close();
$("#initGitBtn").onclick = () => saveSettings(true);
settingsForm.onsubmit = (e) => { e.preventDefault(); saveSettings(); };
// First visit: show the welcome/settings screen once.
fetch("/api/settings").then((r) => r.json()).then((st) => {
  if (!st.hasKey && !localStorage.getItem("aiDevTeamWelcomed")) {
    localStorage.setItem("aiDevTeamWelcomed", "1");
    openSettings();
  }
});
$("#newTaskForm").onsubmit = async (e) => {
  if (e.submitter?.value !== "create") return;
  const f = new FormData(e.target);
  const t = await api("/api/tasks", { title: f.get("title"), description: f.get("description") });
  e.target.reset();
  if (t.id) { selectedId = t.id; filter = "active"; tab = "discussion"; }
};

const es = new EventSource("/api/events");
es.onmessage = (e) => { state = JSON.parse(e.data); render(); };
setInterval(() => state && render(), 30_000); // keep "x min ago" fresh
