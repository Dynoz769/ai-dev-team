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

// ---------- rendering ----------
function render() {
  const { info, usage, tasks, agents } = state;
  const hour = new Date().getHours();
  $("#greeting").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"} 👋`;
  const active = tasks.filter((t) => !DONE.includes(t.status));
  $("#subtitle").textContent = `Your AI team has ${active.length} active task${active.length === 1 ? "" : "s"}`;
  $("#mockBanner").hidden = !info.mock;
  $("#wsName").textContent = info.workspace.split("/").pop();
  $("#wsPath").textContent = info.testCommand ? `tests: ${info.testCommand}` : "no test command";
  $("#modelName").textContent = info.model;
  const pct = Math.min(100, Math.round((usage.costUsd / info.budgetUsd) * 100));
  $("#usagePct").textContent = `${pct}%`;
  $("#usageBar").style.width = `${pct}%`;
  $("#usageText").textContent = `$${usage.costUsd.toFixed(2)} / $${info.budgetUsd}`;

  const working = info.roles.filter((r) => agents[r.id]?.status === "working").length;
  $("#officeStats").textContent = `${info.roles.length} agents · ${working} working · ${tasks.filter((t) => BUSY.includes(t.status)).length} tasks in progress`;
  $("#office").innerHTML = info.roles.map((r) => {
    const a = agents[r.id] ?? { status: "idle", activity: "Idle" };
    return `<div class="desk ${a.status}">
      <div class="avatar" style="background:${r.color}">${initials(r.name)}<span class="dot ${a.status === "working" ? "amber pulse" : "green"}"></span></div>
      <div><b>${esc(r.name)}</b><small title="${esc(a.activity)}">${a.taskCode ? esc(a.taskCode) + " · " : ""}${esc(a.activity)}</small></div>
    </div>`;
  }).join("");

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
