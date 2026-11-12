/* =========================================================
   PromptVault · 提示词弹药库  —  核心逻辑
   数据完全存储于 localStorage，不上传任何服务器
   ========================================================= */
"use strict";

const STORE_KEY = "promptvault_v1";
const THEME_KEY = "promptvault_theme";
const VAR_RE = /\{\{([^{}]+)\}\}/g;

const COLORS = ["#4f6ef7", "#e5484d", "#f5a623", "#12a594", "#8764ea", "#ea4c89", "#0f7b6c", "#64748b"];

const CATEGORIES = ["全部", "编程开发", "写作创作", "办公效率", "学习提升", "数据分析", "营销运营", "生活助手", "未分类"];

/* ---------------- 状态 ---------------- */
let state = {
  prompts: [],
  view: "list",            // list | dashboard
  search: "",
  category: "全部",
  favOnly: false,
  activeTag: null,
  sort: "updated",
  editingId: null,         // 当前编辑的提示词
  fillId: null,            // 当前填空的提示词
  fillInputs: {},          // 填空表单内容
  presetImported: false,
};

/* ---------------- 工具函数 ---------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function relTime(ts) {
  if (!ts) return "从未使用";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return m + " 分钟前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.floor(h / 24);
  if (d < 30) return d + " 天前";
  return new Date(ts).toLocaleDateString("zh-CN");
}

function getVars(content) {
  const set = new Set();
  let m;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(content || ""))) set.add(m[1].trim());
  return [...set];
}

function fillTemplate(content, values) {
  return (content || "").replace(VAR_RE, (_, name) => {
    const v = values[name.trim()];
    return v ? v : `{{${name.trim()}}}`;
  });
}

function highlight(text, kw) {
  const escaped = esc(text);
  if (!kw) return escaped;
  const safe = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(new RegExp(`(${safe})`, "gi"), "<mark>$1</mark>");
}

/* ---------------- 存储 ---------------- */
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.prompts = Array.isArray(data.prompts) ? data.prompts : [];
      state.presetImported = !!data.presetImported;
    }
  } catch (e) {
    console.warn("读取本地数据失败", e);
  }
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    prompts: state.prompts,
    presetImported: state.presetImported,
  }));
}

/* ---------------- Toast ---------------- */
function toast(msg, opts = {}) {
  const wrap = $("#toastWrap");
  const el = document.createElement("div");
  el.className = "toast" + (opts.type === "err" ? " err" : "");
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (opts.action) {
    const btn = document.createElement("button");
    btn.textContent = opts.action.label;
    btn.onclick = () => { opts.action.onClick(); dismiss(); };
    el.appendChild(btn);
  }
  wrap.appendChild(el);
  const dismiss = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 260);
    if (opts.timer) clearTimeout(opts.timer);
  };
  opts.timer = setTimeout(dismiss, opts.duration ?? 2200);
}

/* ---------------- 渲染：筛选栏 ---------------- */
function renderChips() {
  const used = new Set(state.prompts.map(p => p.category));
  const cats = CATEGORIES.filter(c => c === "全部" || used.has(c) || c === state.category);
  $("#catChips").innerHTML = cats.map(c =>
    `<button class="chip ${state.category === c ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}${c !== "全部" ? ` <span style="opacity:.6">${state.prompts.filter(p => p.category === c).length}</span>` : ""}</button>`
  ).join("");
}

function renderTagBox() {
  const tagCount = new Map();
  state.prompts.forEach(p => (p.tags || []).forEach(t => tagCount.set(t, (tagCount.get(t) || 0) + 1)));
  const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  $("#tagBox").innerHTML = tags.map(([t, n]) =>
    `<button class="tag-pill ${state.activeTag === t ? "active" : ""}" data-tag="${esc(t)}">#${esc(t)}·${n}</button>`
  ).join("");
}

/* ---------------- 渲染：卡片 ---------------- */
function visiblePrompts() {
  let list = state.prompts.slice();
  const kw = state.search.trim().toLowerCase();
  if (kw) {
    list = list.filter(p =>
      (p.title || "").toLowerCase().includes(kw) ||
      (p.content || "").toLowerCase().includes(kw) ||
      (p.tags || []).some(t => t.toLowerCase().includes(kw)) ||
      (p.category || "").toLowerCase().includes(kw)
    );
  }
  if (state.category !== "全部") list = list.filter(p => p.category === state.category);
  if (state.favOnly) list = list.filter(p => p.favorite);
  if (state.activeTag) list = list.filter(p => (p.tags || []).includes(state.activeTag));

  const sorters = {
    updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    used: (a, b) => (b.useCount || 0) - (a.useCount || 0) || (b.lastUsedAt || 0) - (a.lastUsedAt || 0),
    title: (a, b) => (a.title || "").localeCompare(b.title || "", "zh-CN"),
  };
  list.sort(sorters[state.sort] || sorters.updated);
  return list;
}

function renderCards() {
  const grid = $("#cardGrid");
  const list = visiblePrompts();
  const kw = state.search.trim();

  const realEmpty = state.prompts.length === 0;
  const noResult = !realEmpty && list.length === 0;
  $("#emptyState").classList.toggle("hidden", list.length > 0);
  if (realEmpty) {
    $("#emptyTitle").textContent = "弹药库还是空的";
    $("#emptyDesc").textContent = "新建第一条提示词，或导入精选弹药库开箱即用";
    $("#emptyPreset").classList.remove("hidden");
  } else if (noResult) {
    $("#emptyTitle").textContent = "没有匹配的提示词";
    $("#emptyDesc").textContent = "换个关键词，或清除筛选条件试试";
    $("#emptyPreset").classList.add("hidden");
  }

  grid.innerHTML = list.map((p, i) => {
    const vars = getVars(p.content);
    const accent = p.color || COLORS[0];
    const tags = (p.tags || []).slice(0, 3).map(t => `<span class="p-tag">#${esc(highlight(t, kw))}</span>`).join("");
    return `
    <article class="p-card" data-id="${p.id}" style="--card-accent:${accent}; animation-delay:${Math.min(i * 30, 300)}ms">
      <div class="p-card-top">
        <div class="p-title">${highlight(p.title, kw)}</div>
        <button class="p-fav ${p.favorite ? "on" : ""}" data-act="fav" title="收藏">★</button>
      </div>
      <div class="p-content">${highlight(p.content, kw)}</div>
      ${vars.length ? `<div class="p-vars">${vars.slice(0, 4).map(v => `<span class="var-chip">{{${esc(v)}}}</span>`).join("")}${vars.length > 4 ? `<span class="var-chip">+${vars.length - 4}</span>` : ""}</div>` : ""}
      <div class="p-meta">
        <span class="p-cat">${esc(p.category || "未分类")}</span>
        ${tags}
        <span class="p-stats"><span title="复制次数">⧉ ${p.useCount || 0}</span><span title="最近使用">${relTime(p.lastUsedAt)}</span></span>
      </div>
      <div class="p-actions">
        <button class="p-act" data-act="fill">${vars.length ? "⚡ 填空" : "⧉ 复制"}</button>
        <button class="p-act" data-act="edit">✎ 编辑</button>
        <button class="p-act" data-act="version">⟲ 版本</button>
        <button class="p-act" data-act="share">↗ 分享</button>
        <button class="p-act del" data-act="del">🗑</button>
      </div>
    </article>`;
  }).join("");
}

/* ---------------- 渲染：看板 ---------------- */
function renderDashboard() {
  const ps = state.prompts;
  $("#statTotal").textContent = ps.length;
  $("#statFav").textContent = ps.filter(p => p.favorite).length;
  $("#statCopies").textContent = ps.reduce((s, p) => s + (p.useCount || 0), 0);
  $("#statVersions").textContent = ps.reduce((s, p) => s + ((p.versions || []).length), 0);

  // 分类分布
  const dist = new Map();
  ps.forEach(p => dist.set(p.category || "未分类", (dist.get(p.category || "未分类") || 0) + 1));
  const entries = [...dist.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(e => e[1]));
  $("#catDist").innerHTML = entries.length
    ? entries.map(([c, n]) => `
      <div class="dist-row">
        <span class="dist-name">${esc(c)}</span>
        <div class="dist-bar-wrap"><div class="dist-bar" style="width:${(n / max) * 100}%"></div></div>
        <span class="dist-num">${n}</span>
      </div>`).join("")
    : `<div class="version-empty">暂无数据</div>`;

  // TOP 5
  const top = ps.slice().sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).filter(p => p.useCount > 0).slice(0, 5);
  $("#topUsed").innerHTML = top.length
    ? top.map((p, i) => `
      <div class="used-row" data-id="${p.id}">
        <span class="used-rank">${i + 1}</span>
        <span class="used-name">${esc(p.title)}</span>
        <span class="used-count">×${p.useCount}</span>
      </div>`).join("")
    : `<div class="version-empty">还没有使用记录，去复制第一条吧</div>`;
}

/* ---------------- 主渲染 ---------------- */
function renderAll() {
  const isDash = state.view === "dashboard";
  $("#dashboardView").classList.toggle("hidden", !isDash);
  $("#listView").classList.toggle("hidden", isDash);
  $("#dashboardBtn").style.display = isDash ? "none" : "";
  if (isDash) renderDashboard();
  else { renderChips(); renderTagBox(); renderCards(); }
}

/* ---------------- CRUD ---------------- */
function upsertPrompt(data) {
  const now = Date.now();
  if (state.editingId) {
    const p = state.prompts.find(x => x.id === state.editingId);
    if (!p) return;
    if (p.content !== data.content && p.content) {
      // 内容变化时保存版本快照
      p.versions = p.versions || [];
      p.versions.unshift({ content: p.content, savedAt: now, note: "修改前自动快照" });
      if (p.versions.length > 30) p.versions.pop();
    }
    Object.assign(p, data, { updatedAt: now });
  } else {
    state.prompts.unshift({
      id: uid(), favorite: false, useCount: 0, lastUsedAt: null,
      versions: [], createdAt: now, ...data, updatedAt: now,
    });
  }
  save();
}

function deletePrompt(id) {
  const idx = state.prompts.findIndex(p => p.id === id);
  if (idx < 0) return;
  const [removed] = state.prompts.splice(idx, 1);
  save();
  renderAll();
  toast(`已删除「${removed.title}」`, {
    duration: 5200,
    action: { label: "撤销", onClick: () => { state.prompts.splice(idx, 0, removed); save(); renderAll(); } },
  });
}

function toggleFav(id) {
  const p = state.prompts.find(x => x.id === id);
  if (!p) return;
  p.favorite = !p.favorite;
  save(); renderCards();
}

async function copyText(text, promptId) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); ta.remove();
  }
  if (promptId) {
    const p = state.prompts.find(x => x.id === promptId);
    if (p) { p.useCount = (p.useCount || 0) + 1; p.lastUsedAt = Date.now(); save(); }
  }
}

/* ---------------- 编辑弹窗 ---------------- */
function openEdit(id) {
  state.editingId = id || null;
  const p = id ? state.prompts.find(x => x.id === id) : null;
  $("#editModalTitle").textContent = p ? "编辑提示词" : "新建提示词";
  $("#fTitle").value = p ? p.title : "";
  $("#fContent").value = p ? p.content : "";
  $("#fTags").value = p ? (p.tags || []).join(", ") : "";
  $("#fCategory").value = p ? (p.category || "未分类") : "未分类";
  renderColorRow(p ? p.color : COLORS[0]);
  updateVarHint();
  const note = p && p.versions && p.versions.length ? `已保存 ${p.versions.length} 个历史版本` : "";
  $("#editFootNote").textContent = note;
  showModal("editModal");
  setTimeout(() => $("#fTitle").focus(), 80);
}

function renderColorRow(active) {
  $("#colorRow").innerHTML = COLORS.map(c =>
    `<span class="color-dot ${c === active ? "active" : ""}" data-color="${c}" style="background:${c}"></span>`
  ).join("");
}

function updateVarHint() {
  const vars = getVars($("#fContent").value);
  const hint = $("#varHint");
  hint.classList.toggle("hidden", vars.length === 0);
  hint.innerHTML = vars.length ? `检测到 ${vars.length} 个变量：<b>${vars.map(esc).join("</b>、<b>")}</b> — 使用时会弹出填空表单` : "";
}

function saveEdit() {
  const title = $("#fTitle").value.trim();
  const content = $("#fContent").value.trim();
  if (!title) { toast("请填写标题", { type: "err" }); $("#fTitle").focus(); return; }
  if (!content) { toast("请填写内容", { type: "err" }); $("#fContent").focus(); return; }
  const tags = $("#fTags").value.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
  upsertPrompt({
    title, content,
    category: $("#fCategory").value,
    tags, color: currentColor,
  });
  hideModal("editModal");
  renderAll();
  toast(state.editingId ? "已保存修改" : "已创建提示词");
}

let currentColor = COLORS[0];
document.addEventListener("click", (e) => {
  const dot = e.target.closest(".color-dot");
  if (dot) { currentColor = dot.dataset.color; renderColorRow(currentColor); }
});

/* ---------------- 填空弹窗 ---------------- */
function openFill(id) {
  const p = state.prompts.find(x => x.id === id);
  if (!p) return;
  state.fillId = id;
  state.fillInputs = {};
  const vars = getVars(p.content);
  $("#fillModalTitle").textContent = `填空生成 · ${p.title}`;
  $("#fillForm").innerHTML = vars.map(v => `
    <div class="fill-item">
      <label><span class="var-name">{{${esc(v)}}}</span></label>
      ${v.length > 12 || /内容|代码|文字|原文|描述|数据|内容/.test(v)
        ? `<textarea rows="3" data-var="${esc(v)}" placeholder="输入 ${esc(v)}…"></textarea>`
        : `<input type="text" data-var="${esc(v)}" placeholder="输入 ${esc(v)}…">`}
    </div>`).join("");
  updateFillPreview();
  showModal("fillModal");
  const first = $("#fillForm textarea, #fillForm input");
  if (first) setTimeout(() => first.focus(), 80);
}

function updateFillPreview() {
  const p = state.prompts.find(x => x.id === state.fillId);
  if (!p) return;
  const values = {};
  $$("#fillForm [data-var]").forEach(el => { values[el.dataset.var] = el.value; });
  const filled = fillTemplate(p.content, values);
  const html = esc(filled).replace(/\{\{([^{}]+)\}\}/g, '<span class="pv-empty">{{$1}}</span>');
  $("#fillPreview").innerHTML = html;
}

/* ---------------- 版本弹窗 ---------------- */
function openVersions(id) {
  const p = state.prompts.find(x => x.id === id);
  if (!p) return;
  $("#versionModalTitle").textContent = `版本历史 · ${p.title}`;
  const vs = p.versions || [];
  $("#versionList").innerHTML = vs.length
    ? vs.map((v, i) => `
      <div class="version-item">
        <div class="version-head">
          <span class="version-time">v${vs.length - i} · ${new Date(v.savedAt).toLocaleString("zh-CN")}</span>
          <span class="version-note">${esc(v.note || "")}</span>
          <button class="btn sm ghost" data-rollback="${i}">回滚到此版</button>
        </div>
        <div class="version-content">${esc(v.content)}</div>
      </div>`).join("")
    : `<div class="version-empty">暂无历史版本。编辑并修改内容后会自动生成快照。</div>`;
  $("#versionList").dataset.pid = id;
  showModal("versionModal");
}

function rollback(pid, vIndex) {
  const p = state.prompts.find(x => x.id === pid);
  if (!p || !p.versions || !p.versions[vIndex]) return;
  const v = p.versions[vIndex];
  p.versions.unshift({ content: p.content, savedAt: Date.now(), note: "回滚前快照" });
  p.content = v.content;
  p.updatedAt = Date.now();
  save();
  hideModal("versionModal");
  renderAll();
  toast("已回滚到历史版本");
}

/* ---------------- 分享码 ---------------- */
function encodeShare(p) {
  const payload = { t: p.title, c: p.content, cat: p.category, tags: p.tags || [], color: p.color };
  return "PVAULT1:" + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}
function decodeShare(code) {
  code = code.trim();
  if (!code.startsWith("PVAULT1:")) return null;
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob(code.slice(8)))));
    if (!obj.t || !obj.c) return null;
    return obj;
  } catch { return null; }
}

/* ---------------- 导入导出 ---------------- */
function doExport() {
  const blob = new Blob([JSON.stringify({ app: "PromptVault", version: 1, exportedAt: new Date().toISOString(), prompts: state.prompts }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `promptvault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("已导出备份文件");
}

function doImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = Array.isArray(data) ? data : (data.prompts || []);
      const existIds = new Set(state.prompts.map(p => p.id));
      let added = 0;
      incoming.forEach(item => {
        if (!item.title || !item.content) return;
        if (item.id && existIds.has(item.id)) return;
        state.prompts.push({
          id: item.id || uid(), favorite: !!item.favorite, useCount: item.useCount || 0,
          lastUsedAt: item.lastUsedAt || null, versions: item.versions || [],
          createdAt: item.createdAt || Date.now(), updatedAt: item.updatedAt || Date.now(),
          title: item.title, content: item.content, category: item.category || "未分类",
          tags: item.tags || [], color: item.color || COLORS[0],
        });
        added++;
      });
      save(); renderAll(); hideModal("ioModal");
      toast(`导入完成，新增 ${added} 条`);
    } catch {
      toast("文件格式不正确，导入失败", { type: "err" });
    }
  };
  reader.readAsText(file);
}

function importPresets() {
  const existIds = new Set(state.prompts.map(p => p.id));
  let added = 0;
  PRESET_PROMPTS.forEach((item, i) => {
    const id = "preset-" + i;
    if (existIds.has(id)) return;
    state.prompts.push({
      id, title: item.title, content: item.content, category: item.category,
      tags: item.tags || [], color: item.color || COLORS[0],
      favorite: false, useCount: 0, lastUsedAt: null, versions: [],
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    added++;
  });
  state.presetImported = true;
  save(); renderAll();
  toast(`已导入精选库 ${added} 条`);
}

/* ---------------- 命令面板 ---------------- */
function openCmd() {
  $("#cmdInput").value = "";
  renderCmdList("");
  showModal("cmdModal");
  setTimeout(() => $("#cmdInput").focus(), 60);
}

function renderCmdList(q) {
  const kw = q.trim().toLowerCase();
  const commands = [
    { ico: "＋", label: "新建提示词", sub: "N", run: () => openEdit(null) },
    { ico: "📦", label: "导入精选库", sub: "24 条", run: importPresets },
    { ico: "📊", label: "打开数据看板", sub: "", run: () => { state.view = "dashboard"; renderAll(); } },
    { ico: "⇅", label: "导入 / 导出数据", sub: "", run: () => showModal("ioModal") },
    { ico: "🌙", label: "切换亮/暗主题", sub: "", run: toggleTheme },
  ].filter(c => !kw || c.label.toLowerCase().includes(kw));

  const matches = state.prompts
    .filter(p => kw && ((p.title || "").toLowerCase().includes(kw) || (p.tags || []).some(t => t.toLowerCase().includes(kw))))
    .slice(0, 6)
    .map(p => ({ ico: "🧲", label: p.title, sub: `${p.category} · ⧉${p.useCount || 0}`, run: () => quickCopy(p) }));

  const items = [...commands, ...matches];
  $("#cmdList").innerHTML = items.length
    ? items.map((c, i) => `<div class="cmd-item ${i === 0 ? "sel" : ""}" data-cmd="${i}"><span class="cmd-ico">${c.ico}</span><span>${esc(c.label)}</span><span class="cmd-sub">${esc(c.sub)}</span></div>`).join("")
    : `<div class="cmd-empty">没有匹配的命令或提示词</div>`;
  $("#cmdList")._items = items;
}

async function quickCopy(p) {
  const vars = getVars(p.content);
  if (vars.length) { openFill(p.id); return; }
  await copyText(p.content, p.id);
  toast(`已复制「${p.title}」`);
}

/* ---------------- 弹窗管理 ---------------- */
function showModal(id) { $("#" + id).classList.remove("hidden"); }
function hideModal(id) { $("#" + id).classList.add("hidden"); }
function hideAllModals() { $$(".modal-mask").forEach(m => m.classList.add("hidden")); }

/* ---------------- 主题 ---------------- */
function toggleTheme() {
  const dark = document.body.classList.toggle("dark");
  localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  $("#themeBtn").textContent = dark ? "☀️" : "🌙";
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  // 顶栏
  $("#brandHome").onclick = () => { state.view = "list"; state.category = "全部"; state.search = ""; $("#searchInput").value = ""; renderAll(); };
  $("#newBtn").onclick = () => openEdit(null);
  $("#themeBtn").onclick = toggleTheme;
  $("#dashboardBtn").onclick = () => { state.view = "dashboard"; renderAll(); };
  $("#dashboardBack").onclick = () => { state.view = "list"; renderAll(); };
  $("#importExportBtn").onclick = () => showModal("ioModal");

  let searchTimer;
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value; renderCards(); }, 120);
  });
  $("#favOnly").addEventListener("change", (e) => { state.favOnly = e.target.checked; renderCards(); });
  $("#sortSelect").addEventListener("change", (e) => { state.sort = e.target.value; renderCards(); });

  // 筛选 chips / tags（事件委托）
  $("#catChips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.category = chip.dataset.cat;
    renderChips(); renderCards();
  });
  $("#tagBox").addEventListener("click", (e) => {
    const pill = e.target.closest(".tag-pill");
    if (!pill) return;
    state.activeTag = state.activeTag === pill.dataset.tag ? null : pill.dataset.tag;
    renderTagBox(); renderCards();
  });

  // 卡片操作（委托）
  $("#cardGrid").addEventListener("click", async (e) => {
    const card = e.target.closest(".p-card");
    if (!card) return;
    const id = card.dataset.id;
    const act = e.target.closest("[data-act]")?.dataset.act;
    const p = state.prompts.find(x => x.id === id);
    if (!p) return;
    if (!act) { await quickCopy(p); if (!getVars(p.content)) renderCards(); return; }
    switch (act) {
      case "fav": toggleFav(id); break;
      case "fill": openFill(id); break;
      case "edit": openEdit(id); break;
      case "version": openVersions(id); break;
      case "del": deletePrompt(id); break;
      case "share": {
        const code = encodeShare(p);
        await navigator.clipboard.writeText(code).catch(() => {});
        toast("分享码已复制，发给朋友即可导入");
        break;
      }
    }
  });

  // 看板 top used 点击
  $("#topUsed").addEventListener("click", (e) => {
    const row = e.target.closest(".used-row");
    if (!row) return;
    state.view = "list"; renderAll();
    const p = state.prompts.find(x => x.id === row.dataset.id);
    if (p) quickCopy(p);
  });

  // 编辑弹窗
  $("#saveBtn").onclick = saveEdit;
  $("#fContent").addEventListener("input", updateVarHint);
  $("#colorRow").addEventListener("click", (e) => {
    const dot = e.target.closest(".color-dot");
    if (dot) { currentColor = dot.dataset.color; renderColorRow(currentColor); }
  });

  // 填空弹窗
  $("#fillForm").addEventListener("input", updateFillPreview);
  $("#fillCopyBtn").onclick = async () => {
    const p = state.prompts.find(x => x.id === state.fillId);
    if (!p) return;
    const values = {};
    $$("#fillForm [data-var]").forEach(el => { values[el.dataset.var] = el.value; });
    const missing = getVars(p.content).filter(v => !values[v]);
    if (missing.length) {
      toast(`还有 ${missing.length} 个变量未填写：${missing.join("、")}`, { type: "err" });
      return;
    }
    await copyText(fillTemplate(p.content, values), p.id);
    hideModal("fillModal");
    renderCards();
    toast("成品已复制到剪贴板");
  };

  // 版本弹窗
  $("#versionList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-rollback]");
    if (btn) rollback($("#versionList").dataset.pid, Number(btn.dataset.rollback));
  });

  // 导入导出
  $("#exportBtn").onclick = doExport;
  $("#importFile").addEventListener("change", (e) => { if (e.target.files[0]) doImport(e.target.files[0]); });
  $("#shareImportBtn").onclick = () => {
    const obj = decodeShare($("#shareInput").value);
    if (!obj) { toast("分享码无效", { type: "err" }); return; }
    state.prompts.unshift({
      id: uid(), title: obj.t, content: obj.c, category: obj.cat || "未分类",
      tags: obj.tags || [], color: obj.color || COLORS[0],
      favorite: false, useCount: 0, lastUsedAt: null, versions: [],
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    save(); $("#shareInput").value = ""; renderAll();
    toast(`已导入「${obj.t}」`);
  };

  // 精选库（空状态按钮）
  $("#emptyPreset").onclick = importPresets;
  $("#emptyNew").onclick = () => openEdit(null);

  // 命令面板
  $("#cmdInput").addEventListener("input", (e) => renderCmdList(e.target.value));
  $("#cmdList").addEventListener("click", (e) => {
    const item = e.target.closest(".cmd-item");
    if (!item) return;
    const cmd = $("#cmdList")._items?.[Number(item.dataset.cmd)];
    if (cmd) { hideModal("cmdModal"); cmd.run(); }
  });
  $("#cmdInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = $("#cmdList")._items?.[0];
      if (first) { hideModal("cmdModal"); first.run(); }
    }
  });

  // 通用关闭
  document.addEventListener("click", (e) => {
    const closer = e.target.closest("[data-close]");
    if (closer) hideModal(closer.dataset.close);
    if (e.target.classList?.contains("modal-mask")) e.target.classList.add("hidden");
  });

  // 快捷键
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const anyModalOpen = $$(".modal-mask:not(.hidden)").length > 0;
      if (anyModalOpen) hideAllModals();
      openCmd();
      return;
    }
    if (e.key === "Escape") { hideAllModals(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if (typing) return;
    if (e.key === "/") { e.preventDefault(); $("#searchInput").focus(); }
    if (e.key.toLowerCase() === "n" && !$$(".modal-mask:not(.hidden)").length) { e.preventDefault(); openEdit(null); }
  });
}

/* ---------------- 启动 ---------------- */
function init() {
  if (localStorage.getItem(THEME_KEY) === "dark") {
    document.body.classList.add("dark");
    $("#themeBtn").textContent = "☀️";
  }
  load();
  // 首次访问自动导入精选库，让新用户立刻有内容可用
  if (state.prompts.length === 0 && !state.presetImported) {
    importPresets();
    toast(`已为你预置 ${PRESET_PROMPTS.length} 条精选提示词，开箱即用`);
  }
  $("#emptyPreset").textContent = `📦 导入精选库（${PRESET_PROMPTS.length} 条）`;
  bindEvents();
  renderAll();
  runDemoMode();
}

/* 演示模式：通过 #demo=xxx 直达指定界面状态（也便于录屏与分享深链） */
function runDemoMode() {
  const m = location.hash.match(/demo=(\w+)/);
  if (!m) return;
  const mode = m[1];
  if (mode === "dark") { if (!document.body.classList.contains("dark")) toggleTheme(); return; }
  if (mode === "dashboard") { state.view = "dashboard"; renderAll(); return; }
  if (mode === "edit") { openEdit(state.prompts.find(p => getVars(p.content).length)?.id || null); return; }
  if (mode === "fill") {
    const p = state.prompts.find(x => getVars(x.content).length);
    if (p) { openFill(p.id); const first = $("#fillForm textarea, #fillForm input"); if (first) first.value = mode === "fill" ? "示例内容" : ""; updateFillPreview(); }
    return;
  }
  if (mode === "cmd") { openCmd(); return; }
  if (mode === "io") { showModal("ioModal"); return; }
}

init();
