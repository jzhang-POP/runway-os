import { S, ready, wins } from "./core/state.js";
import { $, $$, cap, clampN, desk, esc, fmt, icoLabel, menuEl, reduced, startBtn, startMenu } from "./core/dom.js";
import { OFFLINE, api } from "./core/api.js";
import { FAV, R_BITS, ledHTML, logoSVG, spark } from "./core/graphics.js";
import { morph } from "./core/morph.js";
import { ACTIVE, QUEUED, assetsOf, childrenOf, costHTML, costOf, createdMs, fileItem, filesOf, miniThumb, nameOf, newestFirst, plural, relHTML, runOf, runSig, statusHTML, statusInfo, thumbInner, thumbOf, typeIcon, typicalMs } from "./core/status.js";
import { absTime, ago, dur, sleep, tOf, upTo } from "./core/time.js";
import { GEN_BTN, announce, balloon, copyJob, copyText, emptyAct, fileAction, itemId, loadingOr, init as uiInit } from "./core/ui.js";
import { D, px } from "./wm/geometry.js";
import { APP_KEYS, KINDS, RENDER, SIG } from "./wm/kinds.js";
import { KEY, resetLayout, restoreLayout, save } from "./wm/persist.js";
import { CMP_BTN, CMP_MAX, MULTI, activeSync, cmpBase, cmpBtnSync, extendSel, isSel, menuSelect, moveSel, multiClick, selIds, selNote, select, selectAll } from "./wm/selection.js";
import { sheetHTML, sheetKeys } from "./wm/sheet.js";
import { renderTasks, renderTray, setStart, init as taskbarInit } from "./wm/taskbar.js";
import { cascadeAll, close, defaultOpen, fit, fitActions, focus, focusInto, frontWin, minOf, minimize, open, place, renderWin, restore, retitle, snapHalf, tileAll, toggleMax, winOf, init as windowsInit } from "./wm/windows.js";
import { arrangeIcons, layoutIcons, init as iconsInit } from "./desktop/icons.js";

// drag and drop of saved files between windows (Jobs rows, gallery tiles, the viewer) into Generate's inputs
const DRAG_TYPE = "application/x-runway-run";

/* jobs table */
const COLS = [
  { key: "name", label: "Name", get: r => r.prompt.toLowerCase() },
  { key: "type", label: "Type", get: r => r.type },
  { key: "model", label: "Model", get: r => r.model },
  { key: "status", label: "Status", get: r => ["running", "throttled", "pending", "failed", "cancelled", "succeeded"].indexOf(r.status) },
  { key: "cost", label: "Credits", num: true, get: r => costOf(r) ?? -1 },
  { key: "created", label: "Created", get: r => createdMs(r) },
];
function jobsFor(w) {
  const q = w.q.trim().toLowerCase(), col = COLS.find(c => c.key === w.sort.key) || COLS[5];
  return S.data.runs
    .filter(r => (w.filter === "all" || r.type === w.filter) && (!q || [r.prompt, r.model, r.taskId, r.asset, r.settings].some(v => String(v || "").toLowerCase().includes(q))))
    .sort((a, b) => { const x = col.get(a), y = col.get(b); return (x < y ? -1 : x > y ? 1 : 0) * w.sort.dir || createdMs(b) - createdMs(a); });
}
const SHORTCUTS = [
  ["Windows", [
    ["Cmd+W or Alt+W", "Close the window (Cmd+W only in full screen)"],
    ["Cmd+M or Alt+↓", "Minimize"],
    ["Alt+↑", "Maximize or restore"],
    ["Alt+← / Alt+→", "Snap to the left or right half"],
    ["Cmd+` or Alt+`", "Switch to the next window"],
    ["Ctrl+Cmd+F or F11", "Full screen, where Cmd+W reaches Runway OS"],
    ["Alt+Space", "Window menu (Move, Size…)"],
    ["Ctrl+Esc", "Start menu"],
    ["Esc", "Close a menu, a viewer, Compare or Properties"],
    ["Cmd+,", "Options"],
    ["Cmd+?", "This list"],
  ]],
  ["Open apps (when you're not typing in a field)", Object.entries(APP_KEYS).filter(([k]) => KINDS[k]).map(([k, key]) => ["Alt+" + key, ({ generate: "Generate", terminal: "Terminal", jobs: "Jobs", tree: "Job tree", usage: "Usage", activity: "Activity", images: "Images", videos: "Videos", audio: "Audio", options: "Options", notes: "Notes", keys: "This list (also F1 or ?)" })[k]])],
  ["Jobs and files", [
    ["↑ ↓ ← →, Home, End", "Move the selection"],
    ["Enter, Cmd+O or Cmd+↓", "Open"],
    ["Cmd+I or Alt+Enter", "Properties (Get Info)"],
    ["Cmd+F", "Search jobs"],
    ["Cmd+C", "Copy the selected job (its task ID)"],
    ["Cmd+V in Generate", "Use the copied job, or a copied image file, as an input"],
    ["Shift+F10 or right-click", "Job menu"],
    ["Cmd+click, Shift+click", "Select several jobs or files"],
    ["Shift+↑ ↓ ← →", "Extend the selection"],
    ["Cmd+A", "Select all"],
    ["Alt+C", "Compare the selected files"],
  ]],
  ["Text fields", [
    ["Cmd+X, Cmd+C, Cmd+V", "Cut, copy, paste"],
    ["Cmd+A", "Select all"],
    ["Cmd+Z, Shift+Cmd+Z", "Undo, redo"],
    ["Cmd+Enter in Generate", "Generate"],
    ["Cmd+Shift+S in Generate", "Save the prompt to Notes"],
  ]],
  ["Viewer", [
    ["← →", "Previous or next file"],
    ["Space", "Play or pause"],
    ["M", "Mute"],
    [", .", "Step one frame"],
  ]],
  ["Compare", [
    ["← →", "Move the wipe divider (Shift: 10%)"],
    ["Space", "Play or pause all"],
    ["Enter", "Open the selected file"],
  ]],
];
function keysRender(w) {
  if (w.shell) return;
  w.shell = true;
  w.body.innerHTML = `
        <div class="pwrap keys" data-keep="keys">
          ${SHORTCUTS.filter(([, rows]) => rows.length).map(([title, rows]) => `<fieldset class="group"><legend>${esc(title)}</legend>
            <dl class="ptbl keytbl">${rows.map(([k, v]) => `<dt>${k.split(/( or |, | \/ )/).map(part => /^( or |, | \/ )$/.test(part) ? `<span class="muted">${part}</span>` : `<kbd>${esc(part)}</kbd>`).join("")}</dt><dd>${esc(v)}</dd>`).join("")}</dl></fieldset>`).join("")}
          <p class="muted">Chrome keeps Cmd+W, Cmd+T, Cmd+N and Cmd+Q for itself, except in full screen, where Runway OS gets Cmd+W. The Alt shortcuts work everywhere.</p>
        </div>`;
}
// "System Properties": a Win95 property sheet with General, Usage and Connection tabs
function overviewRender(w) {
  const runs = S.data.runs, running = runs.filter(r => r.status === "running"), queued = runs.filter(r => QUEUED.has(r.status));
  const v = { balance: S.data.balance };
  const fl = "";
  const delta = S.sessionStart != null && S.data.balance != null ? S.sessionStart.balance - S.data.balance : 0;
  const ps = running.map(r => r.progress).filter(p => p != null);
  const det = running.length && ps.length === running.length ? Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 100) : null;
  const checked = S.data.balanceAt ? new Date(S.data.balanceAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
  const count = t => runs.filter(r => r.type === t && r.asset).length;
  const tab = w.tab || "general", T = [["general", "General"], ["usage", "Usage"], ["connection", "Connection"]];
  let panel = "";
  if (tab === "general") {
    panel = `
          <div class="sp-gen">
            <div class="sp-logo">${logoSVG("#ffffff")}</div>
            <dl class="sp-facts">
              <dt>System:</dt><dd>runway os<br><span class="muted">Runway API 2024-11-06</span></dd>
              <dt>Credits left:</dt><dd><div class="led sunken${fl}" role="img" aria-label="${v.balance == null ? "Balance unknown" : fmt(v.balance) + " credits left"}">${ledHTML(v.balance)}</div>
                <span class="muted">${delta > 0 ? `<span class="down">▼ ${fmt(delta)}</span> since you opened this at ${esc(S.sessionStart.at)}` : checked ? `Checked at ${esc(checked)}` : "Waiting for Runway"}</span></dd>
              <dt>Activity:</dt><dd>${running.length ? `Rendering ${running.length} job${running.length > 1 ? "s" : ""}${det != null ? ` · ${det}%` : "…"}` : queued.length ? `${queued.length} job${queued.length > 1 ? "s" : ""} queued…` : "Idle. No jobs rendering."}
                <div class="prog sunken${running.length + queued.length && det == null ? " busy" : ""}"><i style="${det != null ? `width:${det}%;opacity:1` : ""}"></i></div></dd>
            </dl>
          </div>`;
  } else if (tab === "usage") {
    const sp = spark(S.data.history, 480, 120, true);
    const row = (label, val, open) => `<button class="sp-row" data-open="${open}"><span>${label}</span><b>${val}</b></button>`;
    panel = `
          <fieldset class="group"><legend>Your jobs</legend>
            <div class="sp-rows">
              ${row("Jobs logged", fmt(runs.length), "jobs")}
              ${row("Credits spent", fmt(runs.reduce((s, r) => s + (r.credits || 0), 0)), "jobs")}
              ${row("Rendering or queued", fmt(running.length + queued.length), "jobs")}
              ${row("Images", fmt(count("image")), "images")}
              ${row("Videos", fmt(count("video")), "videos")}
              ${row("Audio files", fmt(count("audio")), "audio")}
            </div>
          </fieldset>
          <fieldset class="group sp-chart"><legend>Org balance · last 24 h</legend>
            ${sp.svg || '<div class="spark-empty big">Collecting balance history. The chart fills in as the server checks every 20 s.</div>'}
            <div class="muted">${sp.spent != null ? `Your org spent ${fmt(sp.spent)} credits in the last 24 h.` : ""}</div>
          </fieldset>`;
  } else {
    const where = S.data.keySource === "file" ? "saved in .runway_key" : S.data.keySource === "env" ? "from RUNWAYML_API_SECRET" : "none";
    panel = `
          <fieldset class="group"><legend>Runway API</legend>
            <dl class="sp-facts tight">
              <dt>Status:</dt><dd><span class="live ${S.conn.cls}">${esc(S.conn.text)}</span></dd>
              <dt>API key:</dt><dd>${S.data.live ? `Ending in ${esc(S.data.keyHint || "…")} <span class="muted">(${where})</span>` : "Not set"}</dd>
              <dt>Balance:</dt><dd>${checked ? `Checked at ${esc(checked)}` : "Not checked yet"}</dd>
              <dt>Sync:</dt><dd>Jobs every 8 s, balance every 20 s</dd>
              <dt>Server:</dt><dd>${esc(location.host)}</dd>
            </dl>
            <div class="actions"><button class="raised btn-s" data-open="key">${icoLabel("i-key", "Change key…")}</button></div>
          </fieldset>`;
  }
  morph(w.body, sheetHTML(T, tab, panel));
  sheetKeys(w);
  w.prev = v;
}
function jobsRender(w) {
  if (!w.shell) {
    w.shell = true;
    w.body.innerHTML = `
          <div class="toolbar">
            <div class="seg-tabs" role="group" aria-label="Filter by type"></div>
            <input class="field" type="search" placeholder="Search prompts, models, IDs" aria-label="Search jobs" value="${esc(w.q)}">
            ${CMP_BTN}
          </div>
          <div class="table sunken" tabindex="0" role="grid" aria-multiselectable="true" aria-label="Jobs" data-keep="list">
            <div class="thead" role="row">${COLS.map(c => `<div class="th c-${c.key}${c.num ? " num" : ""}" role="columnheader" aria-sort="none"><button class="raised" data-sort="${c.key}">${c.label}<i class="arrow"></i></button></div>`).join("")}</div>
            <div class="rows"></div>
          </div>
          <div class="statusbar"><span class="sunken seg grow"></span><span class="sunken seg"></span><span class="sunken seg"></span></div>`;
    $(".field", w.body).addEventListener("input", e => { w.q = e.target.value; RENDER.jobs(w); save(); });
    // empty list: "Clear search" empties the search box and puts the cursor back in it
    $(".rows", w.body).addEventListener("click", e => {
      if (!e.target.closest("[data-clearq]")) return;
      const f = $(".field", w.body); f.value = w.q = ""; RENDER.jobs(w); save(); f.focus();
    });
  }
  const list = jobsFor(w), types = ["all", ...new Set(S.data.runs.map(r => r.type))];
  $(".seg-tabs", w.body).innerHTML = types.map(t => `<button class="raised" data-filter="${esc(t)}" aria-pressed="${t === w.filter}">${t === "all" ? "All" : esc(plural(t))}</button>`).join("");
  $$(".th [data-sort]", w.body).forEach(b => { b.parentElement.setAttribute("aria-sort", b.dataset.sort === w.sort.key ? (w.sort.dir > 0 ? "ascending" : "descending") : "none"); });
  morph($(".rows", w.body), list.length ? list.map(r => `
        <div class="row${isSel(w, r.taskId) ? " sel" : ""}" role="row" id="${itemId(w, r.taskId)}" data-id="${esc(r.taskId)}" aria-selected="${isSel(w, r.taskId)}"${r.asset ? ' draggable="true"' : ""}>
          <div class="c c-name" role="gridcell">${miniThumb(r)}<span class="nm"><b title="${esc(r.prompt)}">${esc(r.prompt)}</b><small>${esc(r.asset || r.settings)}${filesOf(r).length > 1 ? ` <span class="muted">· ${filesOf(r).length} files</span>` : ""}</small></span></div>
          <div class="c c-type" role="gridcell">${esc(cap(r.type))}</div>
          <div class="c c-model" role="gridcell" title="${esc(r.model)}">${esc(r.model)}</div>
          <div class="c c-status" role="gridcell">${statusHTML(r)}</div>
          <div class="c c-cost num" role="gridcell">${costHTML(r)}</div>
          <div class="c c-created" role="gridcell">${relHTML(r.createdAt || r.date)}</div>
        </div>${filesOf(r).slice(1).map((_, k) => { const f = fileItem(r, k + 1); return `
        <div class="row kid${isSel(w, f.taskId) ? " sel" : ""}" role="row" id="${itemId(w, f.taskId)}" data-id="${esc(f.taskId)}" aria-selected="${isSel(w, f.taskId)}" draggable="true">
          <div class="c c-name" role="gridcell">${miniThumb(f)}<span class="nm"><b title="${esc(f.asset)}">${esc(f.asset)}</b><small>File ${k + 2} of ${filesOf(r).length}</small></span></div>
          <div class="c c-type" role="gridcell">${esc(cap(r.type))}</div>
          <div class="c c-model" role="gridcell"></div><div class="c c-status" role="gridcell"></div><div class="c c-cost num" role="gridcell"></div><div class="c c-created" role="gridcell"></div>
        </div>`; }).join("")}`).join("")
    : `<div role="row"><div role="gridcell">${loadingOr(w.q ? `No jobs match “${esc(w.q)}”.${emptyAct('<button class="raised btn-s" data-clearq>Clear search</button>')}`
      : `No jobs yet. Jobs show up here as soon as they're submitted.${emptyAct(GEN_BTN)}`)}</div></div>`);
  activeSync(w);
  const segs = $$(".statusbar .seg", w.body);
  segs[0].textContent = `${list.length} object${list.length === 1 ? "" : "s"}${selNote(w)}`;
  cmpBtnSync(w);
  segs[1].textContent = `${fmt(list.reduce((s, r) => s + (r.credits || 0), 0))} credits`;
  segs[2].textContent = "Double-click or Enter to open";
}
function viewerRender(w) {
  const r = runOf(w.arg);
  if (!r || !r.asset) { w.rendered = null; w.body.innerHTML = loadingOr(r ? "This file isn't saved yet. It opens here when the job finishes." : "This job is no longer in runs.json."); return; }
  const list = assetsOf(r.type), i = list.findIndex(x => x.taskId === r.taskId);
  const nav = `<button class="raised btn-s" data-step="-1" ${i <= 0 ? "disabled" : ""} title="Newer (←)">◀</button><span class="sunken seg">${i + 1} / ${list.length}</span><button class="raised btn-s" data-step="1" ${i >= list.length - 1 ? "disabled" : ""} title="Older (→)">▶</button>`;
  if (w.rendered === r.asset) { $(".nav", w.body).innerHTML = nav; return; }
  w.rendered = r.asset;
  const src = encodeURI(r.asset), audio = r.type === "audio", video = r.type === "video" || audio;
  w.body.innerHTML = `
        <div class="stage sunken${audio ? " audio" : ""}" data-keep="stage" data-id="${esc(r.taskId)}" draggable="true" title="${video ? "" : "Click to toggle actual size"}">${audio
      ? `<svg class="aud-ico" aria-hidden="true"><use href="#i-audio"/></svg><div class="aud-txt">${esc(r.prompt)}</div><audio src="${src}" controls autoplay></audio>`
      : video ? `<video src="${src}" poster="${thumbOf(r)}" controls autoplay muted loop playsinline></video>`
      : `<img src="${src}" alt="${esc(r.prompt)}" draggable="false">`}</div>
        <div class="footbar">
          <span class="nav">${nav}</span>
          <span class="sunken seg grow info" title="${esc(r.prompt)}">${esc(r.model)} · ${esc(r.settings)} · ${costHTML(r)} cr</span>
          ${video ? "" : `<button class="raised btn-s zoombtn" title="Toggle actual size">${icoLabel("i-zoom", "Fit")}</button>`}
          <button class="raised btn-s" data-open="props" data-id="${esc(r.taskId)}" title="Alt+Enter">${icoLabel("i-doc", "Properties")}</button>
          <button class="raised btn-s" data-file="reveal" data-name="${esc(r.asset)}">${icoLabel("i-finder", "Show in Finder")}</button>
        </div>`;
  const media = $(audio ? "audio" : video ? "video" : "img", w.body), info = $(".info", w.body);
  const addDims = (wd, ht, extra = "") => { info.innerHTML += ` · ${wd}×${ht}${extra}`; };
  if (audio) media.addEventListener("loadedmetadata", () => { info.innerHTML += ` · ${media.duration.toFixed(1)}s`; }, { once: true });
  else if (video) media.addEventListener("loadedmetadata", () => addDims(media.videoWidth, media.videoHeight, ` · ${media.duration.toFixed(1)}s`), { once: true });
  else { media.complete && media.naturalWidth ? addDims(media.naturalWidth, media.naturalHeight) : media.addEventListener("load", () => addDims(media.naturalWidth, media.naturalHeight), { once: true }); bindZoom(w); }
}
function propsRender(w) {
  const r = runOf(w.arg);
  if (!r) { morph(w.body, loadingOr("This job is no longer in runs.json.")); return; }
  const parent = r.parent ? runOf(r.parent) : null, kids = childrenOf(r.taskId), took = r.finishedAt && r.createdAt ? tOf(r.finishedAt) - tOf(r.createdAt) : null;
  const chip = x => `<button class="chip raised" data-open="props" data-id="${esc(x.taskId)}" title="${esc(x.prompt)}">${miniThumb(x)}<span>${esc(nameOf(x))}</span></button>`;
  const rows = [
    ["Status", statusHTML(r)],
    ["Credits", r.credits != null ? `${fmt(r.credits)}${r.costSource === "runway" ? ' <span class="muted">reported by Runway</span>' : ""}` : r.estimatedCredits != null ? `~${fmt(r.estimatedCredits)} <span class="muted">estimate</span>` : "—"],
    ...(r.quotedCredits != null ? [["Quoted", `${r.quoteExact ? "" : "≈ "}${fmt(r.quotedCredits)}${r.credits != null ? (r.credits === r.quotedCredits ? ' <span class="muted">matches the charge</span>' : ` <span class="bad">charge differs by ${fmt(r.credits - r.quotedCredits)}</span>`) : ' <span class="muted">before submitting</span>'}`]] : []),
    ["Created", r.createdAt ? `${esc(absTime(tOf(r.createdAt)))} <span class="muted">(${relHTML(r.createdAt)})</span>` : esc(r.date)],
    ...(took ? [["Took", dur(took)]] : []),
    ["Model", esc(r.model)], ["Settings", esc(r.settings)],
    ...(r.failure ? [["Failure", `<span class="bad">${esc(r.failure)}</span>${r.failureCode ? ` <code>${esc(r.failureCode)}</code>` : ""}`]] : []),
    ["Task ID", `<code>${esc(r._of || r.taskId)}</code>`], ["File", r.asset ? esc(r.asset) + (filesOf(r).length > 1 ? ` <span class="muted">(file ${r._n || 1} of ${filesOf(r).length})</span>` : "") : "Not saved yet"],
    ...(parent ? [["Made from", parent.asset && r.asset ? `<span class="chips">${chip(parent)}<button class="raised btn-s" data-compare="${esc(parent.taskId + "," + r.taskId)}" title="This file and its source side by side">${icoLabel("i-compare", "Compare")}</button></span>` : chip(parent)]] : []),
    ...(kids.length ? [["Used in", `<span class="chips">${kids.map(chip).join("")}</span>`]] : []),
  ];
  morph(w.body, `
        <div class="pwrap" data-keep="p">
          <div class="ptop">${r.asset ? `<button class="thumb sunken" data-open="viewer" data-id="${esc(r.taskId)}" title="Open">${thumbInner(thumbOf(r), r.type)}</button>` : `<span class="thumb sunken">${thumbInner(null, r.type)}</span>`}
            <div><b>${esc(nameOf(r))}</b><div class="muted">${esc(cap(r.type))} · ${esc(r.model)}</div></div></div>
          <hr class="etch">
          <dl class="ptbl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
          <hr class="etch">
          <div class="plabel">Prompt</div>
          <div class="promptbox sunken">${esc(r.prompt)}</div>
          <div class="actions" role="group" aria-label="This file">
            ${r.asset ? `<button class="raised btn-s b-default" data-open="viewer" data-id="${esc(r.taskId)}">${icoLabel(typeIcon(r.type), "Open")}</button><button class="raised btn-s" data-file="reveal" data-name="${esc(r.asset)}">${icoLabel("i-finder", "Show in Finder")}</button>` : ""}
            ${ACTIVE.has(r.status) ? `<button class="raised btn-s b-danger" data-cancel="${esc(r.taskId)}">${icoLabel("i-stop", "Cancel job")}</button>` : ""}
            <button class="raised btn-s" data-copy="${esc(r.prompt)}" data-done="Prompt copied">${icoLabel("i-copy", "Copy prompt")}</button>
            <button class="raised btn-s" data-copy="${esc(r._of || r.taskId)}" data-done="ID copied">${icoLabel("i-copy", "Copy task ID")}</button>
            ${r.failure ? `<button class="raised btn-s" data-copy="${esc(r.failure)}" data-done="Error copied">${icoLabel("i-copy", "Copy error")}</button>` : ""}
          </div>
          <div class="actions" role="group" aria-label="Make from this">
            ${r.type === "image" && r.asset ? `<button class="raised btn-s" data-gen="animate" data-id="${esc(r.taskId)}">${icoLabel("i-animate", "Animate…")}</button>` : ""}
            ${(r.type === "image" || r.type === "video") && r.asset ? `<button class="raised btn-s" data-gen="upscale" data-id="${esc(r.taskId)}">${icoLabel("i-upscale", "Upscale…")}</button>` : ""}
            ${r.type === "video" && r.asset ? `<button class="raised btn-s" data-gen="sound" data-id="${esc(r.taskId)}">${icoLabel("i-sound", "Add sound…")}</button><button class="raised btn-s" data-gen="hdr" data-id="${esc(r.taskId)}">${icoLabel("i-hdr", "Convert to HDR…")}</button>` : ""}
            <button class="raised btn-s${r.asset || ACTIVE.has(r.status) ? "" : " b-default"}" data-gen="again" data-id="${esc(r.taskId)}">${icoLabel("i-again", "Generate again…")}</button>
          </div>
        </div>`);
  fitActions(w);
}

function gallery(w, type) {
  if (!w.shell) {
    w.shell = true;
    w.body.innerHTML = `
        <div class="toolbar"><label class="sizer">Size <input type="range" min="84" max="260" step="4" value="${w.size}" aria-label="Thumbnail size" aria-valuetext="${w.size} px thumbnails"></label>${CMP_BTN}</div>
        <div class="gridwrap sunken" data-keep="grid" tabindex="0" role="listbox" aria-multiselectable="true" aria-label="${plural(type)}"><div class="grid"></div></div>
        <div class="statusbar"><span class="sunken seg grow"></span><span class="sunken seg">${type === "video" ? "Hover to preview · " : ""}Double-click or Enter to open</span></div>`;
    $("input", w.body).addEventListener("input", e => { w.size = +e.target.value; e.target.setAttribute("aria-valuetext", `${w.size} px thumbnails`); $(".grid", w.body).style.setProperty("--tile", w.size + "px"); save(); });
  }
  const items = assetsOf(type), grid = $(".grid", w.body), wrap = $(".gridwrap", w.body);
  grid.style.setProperty("--tile", w.size + "px");
  morph(grid, items.length ? items.map(r => `
      <div class="tile${isSel(w, r.taskId) ? " sel" : ""}" role="option" id="${itemId(w, r.taskId)}" data-id="${esc(r.taskId)}" aria-selected="${isSel(w, r.taskId)}" aria-label="${esc(r.asset)}" title="${esc(r.prompt)}" draggable="true">
        <span class="thumb sunken">${thumbInner(thumbOf(r), type)}${type === "video" ? '<span class="play"></span>' : ""}</span>
        <span class="cap">${esc(r.asset)}</span>
      </div>`).join("") : loadingOr(`No ${type === "audio" ? "audio" : type + "s"} yet. Finished ${type === "audio" ? "audio files are" : type + "s are"} saved here automatically.${emptyAct(GEN_BTN)}`));
  // a listbox holds only options: while empty the box is a plain group around the message and its button, and no tab stop
  wrap.setAttribute("role", items.length ? "listbox" : "group");
  items.length ? wrap.setAttribute("tabindex", "0") : wrap.removeAttribute("tabindex");
  activeSync(w);
  $(".statusbar .seg", w.body).textContent = `${items.length} object${items.length === 1 ? "" : "s"}${selNote(w)}`;
  cmpBtnSync(w);
  if (type === "video" && !w.hoverBound) {
    w.hoverBound = true;
    grid.addEventListener("pointerover", e => {
      const t = e.target.closest(".tile"); if (!t || t.contains(e.relatedTarget) || $("video", t)) return;
      const r = runOf(t.dataset.id); if (!r) return;
      const v = Object.assign(document.createElement("video"), { src: encodeURI(r.asset), muted: true, loop: true, playsInline: true, autoplay: true });
      v.setAttribute("data-live", "");
      $(".thumb", t).append(v);
    });
    grid.addEventListener("pointerout", e => { const t = e.target.closest(".tile"); if (t && !t.contains(e.relatedTarget)) $("video", t)?.remove(); });
  }
}

/* job tree: each job under the jobs and uploaded files it was made from (r.inputs, else r.parent), drawn as a skill tree.
   A job can have several inputs, so a branch is a small graph: it's laid out in layers (longest path from its sources),
   with the order in each layer chosen to cross few lines and each job placed over the middle of what was made from it. */
const baseId = id => String(id ?? "").split("~")[0];
const OPS = {
  image_to_video: ["Animate", "i-animate"], image_upscale: ["Upscale", "i-upscale"], video_upscale: ["Upscale", "i-upscale"],
  video_to_audio: ["Sound", "i-sound"], video_to_hdr: ["HDR", "i-hdr"], image_to_vector: ["Vectorize", "i-wand"],
  video_to_video: ["Restyle", "i-wand"], character_performance: ["Perform", "i-wand"], speech_to_speech: ["Voice", "i-wand"],
  voice_isolation: ["Isolate", "i-wand"], voice_dubbing: ["Dub", "i-wand"],
};
// what was done to the main input to get this job; old rows have no endpoint, and a video made from a job was an image_to_video
const opOf = r => OPS[r.endpoint] || (!r.endpoint && r.type === "video" ? OPS.image_to_video : [r.task || "Derived", "i-wand"]);
// an input field in plain words, for the lines of inputs other than the main one
const FIELD_WORDS = {
  promptImage: "Start frame", promptImages: "Start frame", firstFrame: "Start frame", lastFrame: "End frame", imageUri: "Image",
  referenceImage: "Reference", referenceImages: "Reference", referenceImageUri: "Reference", styleImages: "Style",
  videoUri: "Video", promptVideo: "Video", referenceVideo: "Reference video", referenceVideos: "Reference video",
  audioUri: "Audio", referenceAudio: "Reference audio", referenceAudios: "Reference audio", characterImage: "Character", maskUri: "Mask",
};
const fieldWords = f => FIELD_WORDS[f] || cap(String(f || "input").replace(/([A-Z])/g, " $1").toLowerCase().replace(/ uri$/, "").trim());
const SIDE_FIELD = /^(reference|style|mask|lastFrame)/; // never the main input: the line says the field instead of the operation
// a job's inputs; rows made before inputs were logged have only a parent, which was the main input
const srcsOf = r => (Array.isArray(r.inputs) && r.inputs.length ? r.inputs : r.parent ? [{ field: "", run: r.parent }] : []);
const kindOfFile = f => (/\.(mp4|mov|webm|m4v)$/i.test(f) ? "video" : /\.(mp3|wav|flac|ogg|m4a|aac|opus)$/i.test(f) ? "audio" : "image");
// sizes at scale 1: node width, node height, gaps between columns and levels, canvas padding, branch minimum width,
// a line passing a level (its column), first line below a level, space between stacked lines and between stacked line labels
const TR = { nw: 96, nh: 110, hg: 18, vg: 52, pad: 18, min: 220, dw: 12, t0: 14, step: 8, lab: 22 };
// the graph and its layout depend only on links and dates (and the UI scale): built once per change, not on every poll
function treeGraph() {
  const sig = S.scale + "\n" + S.data.runs.map(r => `${r.taskId}\t${createdMs(r)}\t${r.inputs?.length ? JSON.stringify(r.inputs) : r.parent || ""}`).join("\n");
  if (S.treeMemo?.sig === sig) return S.treeMemo;
  const by = new Map(S.data.runs.map(r => [r.taskId, r])), nodes = new Map(), pairs = new Map();
  const node = (key, kind, id, t) => {
    let n = nodes.get(key);
    if (!n) nodes.set(key, (n = { key, kind, id, t, ins: [], outs: [] }));
    else if (t < n.t) n.t = t; // an uploaded file or missing job sorts by its first use
    return n;
  };
  S.data.runs.forEach(r => node(r.taskId, "run", r.taskId, createdMs(r)));
  S.data.runs.forEach(r => {
    const srcs = srcsOf(r), main = srcs.findIndex(i => !SIDE_FIELD.test(i.field || "")), t = createdMs(r);
    let frames = 0;
    srcs.forEach((i, k) => {
      let from, file = 0;
      if (i.run) {
        const [b, n] = String(i.run).split("~");
        from = by.has(b) ? nodes.get(b) : node("?" + b, "missing", b, t);
        file = n ? +n || 0 : 0; // "taskId~n": the n-th file of a job with several
      } else if (i.input) from = node("in:" + i.input, "upload", String(i.input), t);
      if (!from || from.key === r.taskId) return;
      const ek = from.key + ">" + r.taskId;
      let e = pairs.get(ek);
      if (!e) { pairs.set(ek, (e = { from: from.key, to: r.taskId, main: false, labels: [], files: [] })); from.outs.push(e); nodes.get(r.taskId).ins.push(e); }
      // a second start frame is the end frame (promptImage as a list of first and last)
      const word = i.field === "promptImage" && frames++ ? "End frame" : fieldWords(i.field);
      if (k === main) e.main = true;
      else if (!e.labels.includes(word)) e.labels.push(word);
      if (file && !e.files.includes(file)) e.files.push(file);
    });
  });
  // branches: connected groups of nodes
  const comp = new Map(), groups = [];
  nodes.forEach(n => {
    if (comp.has(n.key) || (!n.ins.length && !n.outs.length)) return;
    const g = [], stack = [n]; comp.set(n.key, g);
    while (stack.length) {
      const m = stack.pop(); g.push(m);
      for (const e of [...m.ins, ...m.outs]) for (const k of [e.from, e.to]) if (!comp.has(k)) { comp.set(k, g); stack.push(nodes.get(k)); }
    }
    groups.push(g);
  });
  const branches = groups.map(g => treeLayout(g, nodes)).sort((a, b) => b.last - a.last);
  const solo = S.data.runs.filter(r => !comp.has(r.taskId)).sort((a, b) => createdMs(b) - createdMs(a)).map(r => r.taskId);
  return (S.treeMemo = { sig, branches, solo });
}
// one branch, Sugiyama style: drop cycles, layer, add a waypoint where a line passes a level, order the levels, place, route
function treeLayout(g, nodes) {
  const byT = (a, b) => a.t - b.t || (a.key < b.key ? -1 : 1);
  g.sort(byT);
  // cycles can't come from Runway, but a hand-edited runs.json could have them: the line that closes a loop isn't drawn
  const state = new Map(), live = new Set();
  const dfs = n => {
    state.set(n.key, 1);
    n.outs.slice().sort((a, b) => byT(nodes.get(a.to), nodes.get(b.to))).forEach(e => {
      const s = state.get(e.to);
      if (s === 1) return;
      live.add(e);
      if (!s) dfs(nodes.get(e.to));
    });
    state.set(n.key, 2);
  };
  g.forEach(n => state.has(n.key) || dfs(n));
  const ins = new Map(g.map(n => [n.key, n.ins.filter(e => live.has(e))])), outs = new Map(g.map(n => [n.key, n.outs.filter(e => live.has(e))]));
  // layers: longest path from the sources; a source then moves down to sit just above the first job made from it
  const layer = new Map(), deg = new Map(g.map(n => [n.key, ins.get(n.key).length])), order = g.filter(n => !deg.get(n.key));
  order.forEach(n => layer.set(n.key, 0));
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    outs.get(n.key).forEach(e => {
      layer.set(e.to, Math.max(layer.get(e.to) ?? 0, layer.get(n.key) + 1));
      deg.set(e.to, deg.get(e.to) - 1);
      if (!deg.get(e.to)) order.push(nodes.get(e.to));
    });
  }
  g.forEach(n => { if (!ins.get(n.key).length && outs.get(n.key).length) layer.set(n.key, Math.min(...outs.get(n.key).map(e => layer.get(e.to))) - 1); });
  // layout items: the nodes, plus a waypoint on each level a line passes; each line becomes a chain of hops
  const items = new Map(), L = [];
  const item = (key, lv, real, t) => { const it = { key, lv, real, t, up: [], down: [], x: 0 }; items.set(key, it); (L[lv] ||= []).push(it); return it; };
  g.forEach(n => item(n.key, layer.get(n.key), true, n.t));
  const chains = [];
  g.forEach(n => outs.get(n.key).forEach(e => {
    const chain = [items.get(e.from)];
    for (let lv = layer.get(e.from) + 1; lv < layer.get(e.to); lv++) chain.push(item(`${e.from}>${e.to}@${lv}`, lv, false, n.t));
    chain.push(items.get(e.to));
    for (let i = 1; i < chain.length; i++) { chain[i - 1].down.push(chain[i]); chain[i].up.push(chain[i - 1]); }
    chains.push({ e, chain });
  }));
  // order within levels: oldest first, then barycenter sweeps down and up; keep the order with the fewest crossings
  for (let lv = 0; lv < L.length; lv++) L[lv] ||= [];
  const idx = () => L.forEach(l => l.forEach((it, i) => (it.i = i)));
  const bary = (l, nb) => { l.forEach(it => { const ns = nb(it); it.b = ns.length ? ns.reduce((s, m) => s + m.i, 0) / ns.length : it.i; }); l.sort((a, b) => a.b - b.b || a.i - b.i); l.forEach((it, i) => (it.i = i)); };
  const crossings = () => {
    let c = 0;
    for (let lv = 0; lv < L.length - 1; lv++) {
      const es = L[lv].flatMap(a => a.down.map(b => [a.i, b.i])).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) if (es[j][0] > es[i][0] && es[j][1] < es[i][1]) c++;
    }
    return c;
  };
  L[0].sort((a, b) => a.t - b.t); idx();
  for (let lv = 1; lv < L.length; lv++) { L[lv].sort((a, b) => a.t - b.t); L[lv].forEach((it, i) => (it.i = i)); bary(L[lv], it => it.up); }
  let best = L.map(l => l.slice()), bestC = crossings();
  for (let pass = 0; pass < 4 && bestC; pass++) {
    for (let lv = 1; lv < L.length; lv++) bary(L[lv], it => it.up);
    for (let lv = L.length - 2; lv >= 0; lv--) bary(L[lv], it => it.down);
    const c = crossings();
    if (c < bestC) { bestC = c; best = L.map(l => l.slice()); }
  }
  best.forEach((l, lv) => (L[lv] = l)); idx();
  // x: pack each level, then pull items toward the mean of their neighbours, ending with parents over their children
  const nw = px(TR.nw), wOf = it => (it.real ? nw : px(TR.dw)), sep = (a, b) => (wOf(a) + wOf(b)) / 2 + (a.real && b.real ? px(TR.hg) : px(8));
  const fit = (l, want) => {
    const a = [], b = [];
    l.forEach((it, i) => (a[i] = i ? Math.max(want[i], a[i - 1] + sep(l[i - 1], it)) : want[i]));
    for (let i = l.length - 1; i >= 0; i--) b[i] = i < l.length - 1 ? Math.min(want[i], b[i + 1] - sep(l[i], l[i + 1])) : want[i];
    l.forEach((it, i) => (it.x = (a[i] + b[i]) / 2)); // both sweeps keep the spacing, so their mean does too
  };
  L.forEach(l => l.forEach((it, i) => (it.x = i ? l[i - 1].x + sep(l[i - 1], it) : 0)));
  const mean = ns => ns.reduce((s, m) => s + m.x, 0) / ns.length;
  for (let pass = 0; pass < 4; pass++) {
    for (let lv = 1; lv < L.length; lv++) fit(L[lv], L[lv].map(it => (it.up.length ? mean(it.up) : it.x)));
    for (let lv = L.length - 2; lv >= 0; lv--) fit(L[lv], L[lv].map(it => (it.down.length ? mean(it.down) : it.x)));
  }
  const all = [...items.values()], x0 = Math.min(...all.map(it => it.x - wOf(it) / 2)), W0 = Math.max(...all.map(it => it.x + wOf(it) / 2)) - x0;
  const pad = px(TR.pad), W = Math.max(Math.ceil(W0) + 2 * pad, px(TR.min)), shift = pad + (W - 2 * pad - W0) / 2 - x0;
  all.forEach(it => (it.cx = Math.round(it.x + shift) & ~1)); // even, so 2 px lines stay on whole pixels
  // where lines enter a job: spread over its top when it has several inputs, in the order of where they come from
  const enter = new Map();
  all.forEach(it => {
    const m = it.up.length; if (!m) return;
    const sp = Math.min(px(36), Math.floor((nw - px(16)) / Math.max(1, m - 1))) & ~1;
    it.up.slice().sort((a, b) => a.cx - b.cx).forEach((u, r) => enter.set(u.key + ">" + it.key, { x: it.real ? it.cx + Math.round((r - (m - 1) / 2) * sp) & ~1 : it.cx, r, m }));
  });
  // stacked lines below each level: a line's horizontal run gets its own height when it would overlap another's
  const track = new Map(), gaps = [];
  L.forEach((l, lv) => {
    const spans = l.filter(it => it.down.length).map(it => {
      const xs = [it.cx, ...it.down.map(d => enter.get(it.key + ">" + d.key).x)];
      return { it, a: Math.min(...xs), b: Math.max(...xs) };
    }).sort((p, q) => p.a - q.a);
    const ends = [];
    spans.forEach(s => {
      if (s.b - s.a < 2) { track.set(s.it.key, 0); return; } // straight down: crossing a line is fine, sharing one isn't
      let t = ends.findIndex(e => e < s.a - px(6));
      if (t < 0) t = ends.length;
      ends[t] = s.b; track.set(s.it.key, t);
    });
    const rows = Math.max(1, ...(L[lv + 1] || []).filter(it => it.real).map(it => it.up.length));
    gaps[lv] = Math.max(px(TR.vg), px(TR.t0) + Math.max(0, ends.length - 1) * px(TR.step) + px(4) + rows * px(TR.lab) + px(4));
  });
  const top = [pad];
  for (let lv = 1; lv < L.length; lv++) top[lv] = top[lv - 1] + px(TR.nh) + gaps[lv - 1];
  const H = top[L.length - 1] + px(TR.nh) + pad, yt = it => top[it.lv], yb = it => top[it.lv] + px(TR.nh);
  const ty = it => (yb(it) + px(TR.t0) + track.get(it.key) * px(TR.step)) & ~1;
  // the lines: down from the source to its stacked height, across, down through each waypoint, into the job
  const edges = chains.map(({ e, chain }) => {
    let d = `M${chain[0].cx},${yb(chain[0])}`;
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1], b = chain[i], x = enter.get(a.key + ">" + b.key).x;
      d += `V${ty(a)}H${x}V${b.real ? yt(b) - px(4) : yb(b)}`;
    }
    const last = chain[chain.length - 2], to = chain[chain.length - 1], en = enter.get(last.key + ">" + to.key);
    const lo = ty(last), zt = en.m > 1 ? Math.max(...to.up.map(ty)) + px(4) : lo, zb = yt(to) - px(4);
    return { e, d, lx: en.x, ly: Math.round(zt + (en.r + 0.5) * (zb - zt) / en.m) };
  });
  const knots = g.filter(n => outs.get(n.key).length).map(n => { const it = items.get(n.key); return { key: n.key, x: it.cx, y: ty(it) }; });
  const jobs = g.filter(n => n.kind === "run");
  const head = jobs.find(n => !ins.get(n.key).length) || jobs[0];
  return { W, H, edges, knots, head: head.key, jobs: jobs.map(n => n.key), last: Math.max(...jobs.map(n => n.t)),
    nodes: g.map(n => ({ key: n.key, kind: n.kind, id: n.id, lv: layer.get(n.key), left: items.get(n.key).cx - Math.round(nw / 2), top: yt(items.get(n.key)) })),
    outs: new Map(g.map(n => [n.key, outs.get(n.key).map(e => e.to)])) };
}
function treeNodeHTML(w, n, style = "", lvl = 1) {
  const r = n.run, key = r ? r.taskId : n.key, sel = key === w.sel ? " sel" : "";
  const head = cls => `<div class="tnode ${cls}${sel}" role="treeitem" aria-level="${lvl}" id="${itemId(w, key)}" data-id="${esc(key)}" aria-selected="${!!sel}" style="${style}"`;
  if (n.kind === "upload") {
    const t = kindOfFile(n.id), have = (S.data.inputs || []).some(i => i.file === n.id);
    const src = !have ? null : t === "image" ? `inputs/${encodeURIComponent(n.id)}` : t === "video" ? `thumbs/${encodeURIComponent(n.id)}.jpg` : null;
    return `
      ${head("t-upload")} aria-label="${esc(`${n.id}, uploaded${have ? "" : ", no longer in inputs"}`)}" title="${esc(`inputs/${n.id}\n${have ? "Uploaded" : "Uploaded, no longer in the inputs folder"}`)}">
        <span class="tslot"><span class="thumb sunken">${thumbInner(src, t)}</span></span>
        <span class="tname">${esc(n.id)}</span><span class="tcost">Uploaded</span>
      </div>`;
  }
  if (!r) return `
      ${head("t-missing")} title="Source job ${esc(n.id)} isn't in runs.json">
        <span class="tslot"><span class="thumb sunken"><span class="empty">?</span></span></span>
        <span class="tname">Unknown source</span><span class="tcost muted">${esc(n.id.slice(0, 8))}</span>
      </div>`;
  const s = statusInfo(r), n2 = filesOf(r).length;
  const line = s.cls === "done" ? `${costHTML(r)} cr` : s.cls === "running" ? `${costHTML(r)} cr · ${s.p != null ? s.p + "%" : "…"}` : esc(s.label);
  return `
      ${head("t-" + s.cls)}${r.asset ? ' draggable="true"' : ""}
        aria-label="${esc(`${r.model}, ${s.label}, ${costOf(r) ?? 0} credits`)}" title="${esc(`${r.prompt}\n${r.model} · ${s.label} · ${costOf(r) ?? "—"} credits`)}">
        <span class="tslot"><span class="thumb sunken">${thumbInner(thumbOf(r), r.type)}</span>${n2 > 1 ? `<span class="tcount">×${n2}</span>` : ""}${s.cls === "failed" ? '<i class="tx"></i>' : ""}</span>
        <span class="tname">${esc(r.model)}</span><span class="tcost">${line}</span>
      </div>`;
}
// one branch from its memoized layout; only statuses, costs and the selection are filled in here
function treeBranchHTML(w, b, by, total) {
  const kind = key => (by.get(key) ? statusInfo(by.get(key)).cls : "queued"), rank = ["failed", "queued", "running", "done"];
  const typeOfNode = key => (key.startsWith("in:") ? kindOfFile(key.slice(3)) : by.get(key)?.type);
  // lines into the same job overlap where they share a source's stem: draw finished ones last so a branch with any finished job reads as lit
  const lit = b.edges.map(x => [x, rank.indexOf(kind(x.e.to))]).sort((p, q) => p[1] - q[1]);
  const lines = b.edges.map(x => `<path class="te-out" d="${x.d}"/>`).join("") + lit.map(([x]) => `<path class="te-in te-${kind(x.e.to)}" d="${x.d}"/>`).join("");
  const k = px(4) & ~1;
  const knots = b.knots.map(n => `<rect class="te-knot${b.outs.get(n.key).some(c => kind(c) === "done") ? " on" : ""}" x="${n.x - k}" y="${n.y - k}" width="${2 * k}" height="${2 * k}"/>`).join("");
  const tags = b.edges.map(({ e, lx, ly }) => {
    const to = by.get(e.to), [op, opIcon] = opOf(to), words = [...(e.main ? [op] : []), ...e.labels];
    const of = by.get(e.from) ? filesOf(by.get(e.from)).length : 0, fs = e.files.slice().sort((p, q) => p - q);
    if (of > 1 && fs.length) words.push(`file${fs.length > 1 ? "s" : ""} ${fs.length > 1 ? fs.slice(0, -1).join(", ") + " and " + fs[fs.length - 1] : fs[0]} of ${of}`);
    return `<span class="ttag t-${kind(e.to)}" style="left:${lx}px;top:${ly}px">${icoLabel(e.main ? opIcon : typeIcon(typeOfNode(e.from)), esc(words.join(" · ")))}</span>`;
  }).join("");
  const name = by.get(b.head)?.prompt || "Untitled";
  const nw = px(TR.nw);
  return `
      <section class="tbranch" aria-label="${esc(name)}">
        <div class="tb-head"><b title="${esc(name)}">${esc(name)}</b><span class="tb-sum">${b.jobs.length} job${b.jobs.length === 1 ? "" : "s"} · <b>${fmt(total)}</b> credits</span></div>
        <div class="tb-canvas" style="width:${b.W}px;height:${b.H}px">
          <svg class="tb-lines" width="${b.W}" height="${b.H}" viewBox="0 0 ${b.W} ${b.H}" shape-rendering="crispEdges" aria-hidden="true">${lines}${knots}</svg>
          ${tags}${b.nodes.map(n => treeNodeHTML(w, n.kind === "run" ? { run: by.get(n.key) } : n, `left:${n.left}px;top:${n.top}px;width:${nw}px`, n.lv + 1)).join("")}
        </div>
      </section>`;
}
function treeRender(w) {
  if (!w.shell) {
    w.shell = true;
    w.body.innerHTML = `
        <div class="toolbar"><label class="check"><input type="checkbox" class="tsolo"><span></span></label></div>
        <div class="tree-wrap sunken" data-keep="tree" tabindex="0" role="tree" aria-label="Job tree"></div>
        <div class="statusbar"><span class="sunken seg grow"></span><span class="sunken seg"></span><span class="sunken seg">Double-click or Enter to open</span></div>`;
    $(".tsolo", w.body).addEventListener("change", e => { w.solo = e.target.checked; renderWin(w); save(); });
  }
  const { branches, solo: soloIds } = treeGraph(), by = new Map(S.data.runs.map(r => [r.taskId, r])), wrap = $(".tree-wrap", w.body);
  const solo = soloIds.map(id => by.get(id)), totals = branches.map(b => b.jobs.reduce((s, id) => s + (costOf(by.get(id)) || 0), 0));
  $(".tsolo", w.body).checked = !!w.solo;
  $(".toolbar .check span", w.body).textContent = `Show jobs without links (${solo.length})`;
  const soloCredits = solo.reduce((s, r) => s + (costOf(r) || 0), 0);
  const soloHTML = w.solo && solo.length ? `
      <section class="tbranch tb-solo" aria-label="Jobs without links">
        <div class="tb-head"><b>Jobs without links</b><span class="tb-sum">${solo.length} job${solo.length === 1 ? "" : "s"} · <b>${fmt(soloCredits)}</b> credits</span></div>
        <div class="tb-flow">${solo.map(r => treeNodeHTML(w, { run: r }, `width:${px(TR.nw)}px`)).join("")}</div>
      </section>` : "";
  morph(wrap, branches.length ? branches.map((b, i) => treeBranchHTML(w, b, by, totals[i])).join("") + soloHTML
    : loadingOr(`No linked jobs yet. Right-click a job, then Animate, Upscale… to start a branch.${emptyAct(`<button class="raised btn-s b-default" data-open="jobs">${icoLabel("i-folder", "Open Jobs")}</button>`)}`) + soloHTML);
  // a tree holds only tree items: while empty the box is a plain group around the message and its button, and no tab stop
  const any = branches.length || soloHTML;
  wrap.classList.toggle("empty", !any);
  wrap.setAttribute("role", any ? "tree" : "group");
  any ? wrap.setAttribute("tabindex", "0") : wrap.removeAttribute("tabindex");
  activeSync(w);
  const jobs = branches.reduce((s, b) => s + b.jobs.length, 0) + (w.solo ? solo.length : 0), credits = totals.reduce((s, c) => s + c, 0) + (w.solo ? soloCredits : 0), selRun = runOf(w.sel);
  const selName = selRun ? selRun.asset || selRun.taskId : String(w.sel || "").startsWith("in:") ? w.sel.slice(3) : null;
  const segs = $$(".statusbar .seg", w.body);
  segs[0].textContent = `${branches.length} branch${branches.length === 1 ? "" : "es"} · ${jobs} job${jobs === 1 ? "" : "s"}${selName ? ` · ${selName} selected` : ""}`;
  segs[1].textContent = `${fmt(credits)} credits`;
}
// arrow keys move to the nearest node on screen in that direction, so they also cross between branches
function treeMove(w, key) {
  const items = $$(".tnode[data-id]", w.body); if (!items.length) return;
  const cur = items.find(el => el.dataset.id === w.sel);
  if (!cur || key === "Home" || key === "End") { select(w, (key === "End" ? items[items.length - 1] : items[0]).dataset.id, true); return; }
  const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  const mid = el => { const b = $(".tslot", el).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
  const [x0, y0] = mid(cur);
  let best = null, bs = Infinity;
  items.forEach(el => {
    if (el === cur) return;
    const [x, y] = mid(el), along = (x - x0) * dx + (y - y0) * dy, across = Math.abs((x - x0) * dy) + Math.abs((y - y0) * dx);
    if (along < 4) return;
    const sc = along + across * 2.5;
    if (sc < bs) { bs = sc; best = el; }
  });
  if (best) select(w, best.dataset.id, true);
}

// image viewer: click toggles fit / actual size, drag pans at actual size
function bindZoom(w) {
  const stage = $(".stage", w.body), img = $("img", stage), btn = $(".zoombtn", w.body);
  const set = (actual, cx, cy) => {
    const r = img.getBoundingClientRect(), fx = r.width ? (cx - r.left) / r.width : .5, fy = r.height ? (cy - r.top) / r.height : .5;
    stage.classList.toggle("actual", actual);
    $("span", btn).textContent = actual ? "100%" : "Fit";
    if (actual) { stage.scrollLeft = fx * img.naturalWidth - stage.clientWidth / 2; stage.scrollTop = fy * img.naturalHeight - stage.clientHeight / 2; }
  };
  btn.addEventListener("click", () => { const r = stage.getBoundingClientRect(); set(!stage.classList.contains("actual"), r.left + r.width / 2, r.top + r.height / 2); });
  stage.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY, sl = stage.scrollLeft, st = stage.scrollTop;
    let moved = false;
    stage.setPointerCapture(e.pointerId);
    const mv = ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      if (stage.classList.contains("actual")) { stage.scrollLeft = sl - (ev.clientX - sx); stage.scrollTop = st - (ev.clientY - sy); stage.classList.add("panning"); }
    };
    stage.addEventListener("pointermove", mv);
    stage.addEventListener("pointerup", ev => {
      stage.removeEventListener("pointermove", mv); stage.classList.remove("panning");
      if (!moved) set(!stage.classList.contains("actual"), ev.clientX, ev.clientY);
    }, { once: true });
  });
}

// move a viewer to the next or previous file of the same type
function step(w, delta) {
  const r = runOf(w.arg); if (!r) return;
  const list = assetsOf(r.type), next = list[list.findIndex(x => x.taskId === r.taskId) + delta];
  if (!next) return;
  const id = `viewer:${next.taskId}`;
  if (wins.has(id)) { close(w); focus(wins.get(id)); return; }
  wins.delete(w.id);
  Object.assign(w, { id, arg: next.taskId, rendered: null });
  w.el.dataset.id = id; wins.set(id, w);
  renderWin(w); renderTasks(); save();
}

/* ---------- generate: every Runway task and model, as forms built from Runway's API spec ---------- */
const aspectCache = new Map();
const COMMON = [[1, 1], [16, 9], [9, 16], [4, 3], [3, 4], [3, 2], [2, 3], [5, 4], [4, 5], [21, 9], [9, 21], [7, 4], [4, 7], [12, 5], [5, 12], [7, 3], [3, 7], [2, 1], [1, 2]];
const dims = ratio => String(ratio).split(":").map(Number);
const isWH = v => /^\d{3,5}:\d{3,5}$/.test(String(v));
function aspectName(a, b) {
  const r = a / b;
  let best = "", bd = Infinity;
  COMMON.forEach(([x, y]) => { const d = Math.abs(Math.log(r / (x / y))); if (d < bd) { bd = d; best = `${x}:${y}`; } });
  return bd < 0.03 ? best : r >= 1 ? `${r.toFixed(2)}:1` : `1:${(1 / r).toFixed(2)}`;
}
const optLabel = (f, v) => {
  if (f.name === "ratio" && isWH(v)) { const [a, b] = dims(v); return `${a}×${b} · ${aspectName(a, b)}`; }
  if (f.name === "duration" && v !== "auto") return `${v} seconds`;
  if (f.name === "scaleFactor") return `${v}×`;
  return String(v).replace(/_/g, " ");
};
const closestRatio = (list, aspect) => list.filter(isWH).reduce((best, x) => { const [a, b] = dims(x), d = Math.abs(Math.log(a / b / aspect)); return d < best.d - 1e-9 ? { x, d } : best; }, { x: null, d: Infinity }).x;
const secondsOf = r => r.duration ?? (+(String(r.settings || "").match(/(\d+)\s*s\b/)?.[1] || 0) || null);
const refKey = ref => (ref.run ? "r:" + ref.run : "i:" + ref.input);

const cats = () => [...new Set((S.CAT?.tasks || []).map(t => t.category))];
const tasksOf = cat => (S.CAT?.tasks || []).filter(t => t.category === cat);
const curTask = w => { const ts = tasksOf(w.gen.cat); return ts.find(t => t.endpoint === w.gen.ep[w.gen.cat]) || ts[0]; };
const curModel = w => { const t = curTask(w); if (!t) return null; const ms = t.models; return ms.find(m => m.id === w.gen.model[t.endpoint]) || ms[0]; };
// Additional parameters: free JSON for API fields the form doesn't cover
const xtext = w => (w.gen.extra ||= {})[mkey(w)] || "";
function genExtra(w) {
  const t = xtext(w).trim(); if (!t) return { obj: {} };
  try { const o = JSON.parse(t); return o && typeof o === "object" && !Array.isArray(o) ? { obj: o } : { err: "must be a JSON object, like {\"seed\": 42}" }; }
  catch (e) { return { err: "isn't valid JSON (" + e.message.replace(/^JSON\.parse: /, "").slice(0, 80) + ")" }; }
}
const mkey = w => { const t = curTask(w), m = curModel(w); return t && m ? `${t.endpoint}|${m.id}` : ""; };
const vals = w => (w.gen.vals[mkey(w)] ||= {});
const picks = w => (w.gen.media[mkey(w)] ||= {});

// everything that can feed a media field: finished jobs plus files uploaded into inputs/
function library(accept) {
  const out = [];
  newestFirst().flatMap(r => filesOf(r).map((_, i) => fileItem(r, i))).forEach(r => {
    const t = r.asset && (/\.(png|jpe?g|webp|gif|svg)$/i.test(r.asset) ? "image" : /\.(mp4|mov|webm|m4v)$/i.test(r.asset) ? "video" : /\.(mp3|wav|flac|ogg|m4a|aac|opus)$/i.test(r.asset) ? "audio" : r.type);
    if (r.asset && accept.includes(t)) out.push({ ref: { run: r.taskId }, name: r.asset, type: t, thumb: thumbOf(r), title: r.prompt });
  });
  (S.data.inputs || []).forEach(i => {
    if (accept.includes(i.type)) out.push({ ref: { input: i.file }, name: i.file, type: i.type, title: `${i.file} (uploaded)`,
      thumb: i.type !== "audio" ? `thumbs/${encodeURIComponent(i.file)}.jpg` : null });
  });
  return out;
}

const shownVal = (f, v) => (v !== undefined ? v : f.default ?? (f.kind === "select" && f.required ? f.options[0] : f.kind === "bool" ? !!f.default : ""));
// why Generate can't run yet, or null
function genBlock(w) {
  const m = curModel(w); if (!m) return "Loading models…";
  if (S.loaded && !S.data.live) return "Add your Runway API key to generate";
  const ex = genExtra(w);
  if (ex.err) return `Additional parameters ${ex.err}`;
  const need = (m.needs || []).filter(k => !(k in ex.obj));
  if (need.length) return `Fill in ${need.join(", ")} under Additional parameters`;
  const bad = Object.keys(ex.obj).filter(k => !(m.keys || []).includes(k));
  if (bad.length) return `${m.id} doesn't take ${bad.join(", ")}`;
  const v = vals(w), p = picks(w);
  for (const f of m.fields) {
    if (f.name in ex.obj) continue;
    if (f.kind === "media") {
      const n = (p[f.name] || []).length;
      if (f.required && n < Math.max(1, f.min || 0)) return `Pick ${f.array && (f.min || 1) > 1 ? `${f.min} files for` : "the"} ${f.label.toLowerCase()}`;
      continue;
    }
    if (f.kind === "const" || f.kind === "bool") continue;
    const val = shownVal(f, v[f.name]), s = String(val ?? "").trim();
    if (f.required && s === "") return f.name === "promptText" ? "Write a prompt to generate" : `Fill in ${f.label.toLowerCase()}`;
    if (f.maxLength && s.length > f.maxLength) return `${f.label} is ${fmt(s.length - f.maxLength)} characters over Runway's ${fmt(f.maxLength)} limit`;
  }
  return null;
}
// cost hint from what Runway actually charged for this model before
function genCost(w) {
  const m = curModel(w), t = curTask(w); if (!m) return "";
  const last = newestFirst().find(r => r.model === m.id && r.credits != null && r.costSource === "runway" && (!r.endpoint || r.endpoint === t.endpoint));
  if (!last) return `No ${m.id} jobs yet. Its cost shows in Jobs once Runway starts it`;
  const d = +shownVal(m.fields.find(f => f.name === "duration") || {}, vals(w).duration), s = secondsOf(last);
  if (d && s) { const per = last.credits / s; return `≈ ${fmt(Math.round(per * d))} credits at ${fmt(+per.toFixed(1))}/s, from your last ${m.id} job`; }
  return `≈ ${fmt(last.credits)} credits, like your last ${m.id} job`;
}

function genRender(w) {
  if (!S.CAT) { w.shell = false; w.body.innerHTML = `<div class="empty-list">${S.catFailed ? "Couldn't load Runway's model list. Check the connection, then reopen this window." : "Loading models…"}</div>`; return; }
  if (!w.shell) {
    w.shell = true;
    const id = "g" + S.uid;
    w.body.innerHTML = `
        <form class="gen" novalidate autocomplete="off">
          <div class="toolbar"><div class="seg-tabs" role="group" aria-label="Category"></div></div>
          <div class="gbody" data-keep="gen">
            <fieldset class="group"><legend>Task</legend>
              <div class="gform">
                <label for="${id}t" class="tlabel">Task</label><span class="combo tcombo"><select class="field" id="${id}t" data-g="task"></select></span>
                <label for="${id}m">Model</label><span class="combo"><select class="field" id="${id}m" data-g="model"></select></span>
              </div>
              <div class="gnote muted" hidden></div>
            </fieldset>
            <div class="gfields"></div>
          </div>
          <div class="gmsg" role="alert" hidden></div>
          <div class="footbar">
            <span class="sunken seg grow ghint" id="${id}h"></span>
            <button type="button" class="raised btn-s gkey" data-open="key" hidden>Add key…</button>
            <button type="submit" class="raised btn-go b-default" title="Ctrl+Enter" aria-describedby="${id}h" aria-keyshortcuts="Control+Enter"><svg class="ico"><use href="#i-wand"/></svg><span>Generate</span></button>
          </div>
          <input type="file" class="gfile" hidden>
        </form>`;
    const form = $(".gen", w.body), g = w.gen, fileIn = $(".gfile", form);
    form.addEventListener("submit", e => { e.preventDefault(); genSubmit(w); });
    form.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); genSubmit(w); } });
    const onField = e => {
      const el = e.target.closest("[data-f]"); if (!el) return;
      const f = curModel(w).fields.find(x => x.name === el.dataset.f); if (!f) return;
      const v = f.kind === "bool" ? el.checked : f.kind === "range" || f.kind === "number" ? (el.value === "" ? "" : +el.value) : el.value;
      vals(w)[f.name] = v;
      if (f.kind === "range") { const o = $(`output[data-for="${f.name}"]`, form); if (o) o.textContent = v; }
      if (f.kind === "range") el.setAttribute("aria-valuetext", String(v));
      if (f.kind === "longtext") { const c = $(`.gcount[data-for="${f.name}"]`, form); if (c) genCount(c, f, v); }
      if (f.name === "ratio") genRatioPreview(w);
      genRefresh(w); save();
    };
    form.addEventListener("input", e => {
      if (e.target.matches("[data-extra]")) { (g.extra ||= {})[mkey(w)] = e.target.value; genRefresh(w); save(); return; }
      onField(e);
    });
    form.addEventListener("change", e => {
      const k = e.target.dataset.g;
      if (k === "task") { g.ep[g.cat] = e.target.value; genSwitch(w); return; }
      if (k === "model") { g.model[curTask(w).endpoint] = e.target.value; genSwitch(w); return; }
      onField(e);
    });
    form.addEventListener("click", e => {
      const c = e.target.closest("[data-cat]");
      if (c) { g.cat = c.dataset.cat; genSwitch(w); return; }
      const xk = e.target.closest("[data-xkey]");
      if (xk) { genAddExtra(w, xk.dataset.xkey); return; }
      const it = e.target.closest("[data-mref]"); if (!it) return;
      const f = curModel(w).fields.find(x => x.name === it.dataset.field), p = picks(w);
      if (it.dataset.mref === "file") { fileIn.dataset.field = f.name; fileIn.accept = f.accept.map(a => a + "/*").join(","); fileIn.click(); return; }
      if (it.dataset.mref === "none") p[f.name] = [];
      else {
        const ref = JSON.parse(it.dataset.mref), cur = p[f.name] || [], has = cur.some(x => refKey(x) === refKey(ref));
        p[f.name] = f.array ? (has ? cur.filter(x => refKey(x) !== refKey(ref)) : [...cur, ref].slice(-(f.max || 10))) : [ref];
        if (!has && !f.array) genMatchAspect(w, ref);
      }
      genMsg(w, null); genStrips(w); genRefresh(w); save();
    });
    fileIn.addEventListener("change", () => { const file = fileIn.files[0], fld = fileIn.dataset.field; fileIn.value = ""; if (file) genUpload(w, file, fld); });
    // drop a file anywhere on the window: it goes to the first input that takes its type
    const dropKind = e => { const t = [...(e.dataTransfer?.types || [])]; return t.includes(DRAG_TYPE) ? "run" : t.includes("Files") ? "file" : null; };
    w.el.addEventListener("dragover", e => {
      if (!dropKind(e)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "copy"; w.el.classList.add("drop");
      $$("[data-strip].over", w.body).forEach(x => x.classList.remove("over")); e.target.closest?.("[data-strip]")?.classList.add("over");
    });
    w.el.addEventListener("dragleave", e => { if (!w.el.contains(e.relatedTarget)) { w.el.classList.remove("drop"); $$("[data-strip].over", w.body).forEach(x => x.classList.remove("over")); } });
    w.el.addEventListener("drop", e => {
      const kind = dropKind(e); if (!kind) return;
      e.preventDefault(); w.el.classList.remove("drop"); $$("[data-strip].over", w.body).forEach(x => x.classList.remove("over"));
      const onField = e.target.closest?.("[data-strip]")?.dataset.strip || null;
      if (kind === "file") { const file = e.dataTransfer.files[0]; if (file) genUpload(w, file, onField); return; }
      genDropRun(w, e.dataTransfer.getData(DRAG_TYPE), onField);
    });
    genSwitch(w, true);
    genApplyPending(w);
    return;
  }
  genStrips(w); genRefresh(w);
}

// category, task or model changed: rebuild the selectors and the model's fields
function genSwitch(w, first) {
  const g = w.gen, form = $(".gen", w.body);
  if (!cats().includes(g.cat)) g.cat = cats()[0];
  const t = curTask(w), m = curModel(w);
  g.ep[g.cat] = t.endpoint; g.model[t.endpoint] = m.id;
  $(".seg-tabs", form).innerHTML = cats().map(c => `<button type="button" class="raised" data-cat="${esc(c)}" aria-pressed="${c === g.cat}">${esc(c)}</button>`).join("");
  const ts = tasksOf(g.cat);
  $('[data-g="task"]', form).innerHTML = ts.map(x => `<option value="${esc(x.endpoint)}" ${x === t ? "selected" : ""}>${esc(x.label)} (${x.models.length})</option>`).join("");
  $(".tcombo", form).hidden = $(".tlabel", form).hidden = ts.length < 2;
  $('[data-g="model"]', form).innerHTML = t.models.map(x => `<option value="${esc(x.id)}" ${x === m ? "selected" : ""}>${esc(x.id)}${x.needs?.length ? " (needs additional parameters)" : ""}</option>`).join("");
  $(".gnote", form).hidden = true;
  genFields(w);
  if (!first) genMsg(w, null);
  genRefresh(w); save();
}

function genFieldHTML(w, f) {
  const v = shownVal(f, vals(w)[f.name]), id = `gf-${S.uid}-${f.name}`, tip = f.desc ? ` title="${esc(f.desc)}"` : "";
  const lab = `<label for="${id}"${tip}>${esc(f.label)}</label>`, hd = helpAttr(f), help = helpHTML(f);
  if (f.kind === "select") {
    const opts = (f.required || f.default != null ? [] : [`<option value="">Default</option>`])
      .concat(f.options.map(o => `<option value="${esc(o)}" ${String(o) === String(v) ? "selected" : ""}>${esc(optLabel(f, o))}</option>`)).join("");
    const sel = `<span class="combo"><select class="field" id="${id}" data-f="${esc(f.name)}"${hd}>${opts}</select></span>`;
    return lab + (f.name === "ratio" && f.options.some(isWH) ? `<span class="gsize">${sel}<span class="rpv sunken" title="Frame shape"><i></i></span></span>` : sel) + help;
  }
  if (f.kind === "bool") return `<span></span><label class="check"${tip}><input type="checkbox" data-f="${esc(f.name)}"${hd} ${v ? "checked" : ""}><span>${esc(f.label)}</span></label>` + help;
  if (f.kind === "range") return lab + `<span class="rangef"><input type="range" id="${id}" data-f="${esc(f.name)}" min="${f.min}" max="${f.max}" step="${f.step}" value="${esc(v === "" ? f.default ?? f.min : v)}" aria-valuetext="${vals(w)[f.name] === undefined ? `Default${f.default != null ? ` (${esc(f.default)})` : ""}` : esc(v)}"${hd}><output for="${id}" data-for="${esc(f.name)}">${v === "" ? "Default" : esc(v)}</output></span>` + help;
  if (f.kind === "number") return lab + `<input class="field num" type="number" id="${id}" data-f="${esc(f.name)}"${hd} ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""} step="${f.int ? 1 : "any"}" value="${esc(v)}" placeholder="${f.required ? "" : "Default"}">` + help;
  return lab + `<input class="field" type="text" id="${id}" data-f="${esc(f.name)}"${hd} value="${esc(v)}" ${f.maxLength ? `maxlength="${f.maxLength}"` : ""} placeholder="${f.required ? "" : "Optional"}">` + help;
}
// a field's help text: the first sentence of its description in Runway's spec, as plain text, up to about 140 characters.
// The full description stays in the label's title.
function genHint(f) {
  let s = String(f.desc || "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  s = (s.match(/^.*?[.!?](?=\s+[A-Z0-9"'(`]|$)/)?.[0] || s).replace(/`/g, "");
  if (s.length > 140) s = s.slice(0, 139).replace(/[\s,;:]+\S*$/, "") + "…";
  const bare = x => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^(the|a|an) /, "");
  return bare(s) === bare(f.label || "") ? "" : s; // nothing the label doesn't already say
}
const helpId = f => `gf-${S.uid}-${f.name}-h`;
const helpAttr = f => (genHint(f) ? ` aria-describedby="${helpId(f)}"` : "");
const helpHTML = f => { const h = genHint(f); return h ? `<div class="ghelp" id="${helpId(f)}">${esc(h)}</div>` : ""; };
function genFields(w) {
  const m = curModel(w), box = $(".gfields", w.body);
  if (!m) { box.innerHTML = ""; return; }
  const F = m.fields.filter(f => f.kind !== "const");
  const texts = F.filter(f => f.kind === "longtext" && !f.advanced), media = F.filter(f => f.kind === "media");
  const main = F.filter(f => !f.advanced && f.kind !== "longtext" && f.kind !== "media"), adv = F.filter(f => f.advanced && f.kind !== "media");
  box.innerHTML = texts.map(f => `
        <fieldset class="group"><legend${f.desc ? ` title="${esc(f.desc)}"` : ""}>${esc(f.label)}${f.required ? "" : ' <span class="muted">(optional)</span>'}</legend>
          <textarea class="field gprompt" rows="${f.name === "promptText" ? 5 : 2}" data-f="${esc(f.name)}" aria-label="${esc(f.label)}"${helpAttr(f)} spellcheck="true"></textarea>
          ${helpHTML(f) || f.maxLength ? `<div class="gtfoot">${helpHTML(f)}${f.maxLength ? `<div class="gcount muted" data-for="${esc(f.name)}"></div>` : ""}</div>` : ""}
        </fieldset>`).join("")
    + media.map(f => `
        <fieldset class="group"><legend${f.desc ? ` title="${esc(f.desc)}"` : ""}>${esc(f.label)} <span class="muted">${f.array ? `(up to ${f.max}${f.required ? "" : ", optional"})` : f.required ? "" : "(optional)"} · ${esc(f.accept.join(" or "))}</span></legend>
          <div class="strip" role="group" aria-label="${esc(f.label)}"${helpAttr(f)} data-strip="${esc(f.name)}"></div>
          ${helpHTML(f)}
        </fieldset>`).join("")
    + (main.length ? `<fieldset class="group"><legend>Settings</legend><div class="gform">${main.map(f => genFieldHTML(w, f)).join("")}</div></fieldset>` : "")
    + (adv.length ? `<details class="more group"${w.gen.adv ? " open" : ""}><summary>More options (${adv.length})</summary><div class="gform">${adv.map(f => genFieldHTML(w, f)).join("")}</div></details>` : "")
    + `<details class="more group xparams"${w.gen.advX || m.needs?.length || xtext(w).trim() ? " open" : ""}><summary>Additional parameters${m.extra?.length ? ` (${m.extra.length})` : ""}</summary>
          <p class="muted xnote">Sent with the request as JSON, on top of the form. ${m.extra?.length ? "Click a name to add it." : "This model has no fields beyond the form, but you can still set any of its fields here: " + esc((m.keys || []).join(", ")) + "."}</p>
          ${m.extra?.length ? `<div class="xkeys">${m.extra.map(x => `<button type="button" class="xkey" data-xkey="${esc(x.name)}" title="${esc(x.desc || x.hint)}"><b>${esc(x.name)}</b>${x.required ? ' <span class="xreq">required</span>' : ""}<span class="muted">${esc(x.hint)}</span></button>`).join("")}</div>` : ""}
          <textarea class="field xjson" data-extra rows="4" spellcheck="false" placeholder='{ "seed": 42 }' aria-label="Additional parameters as JSON"></textarea>
        </details>`;
  texts.forEach(f => { const ta = $(`textarea[data-f="${f.name}"]`, box); ta.value = vals(w)[f.name] ?? ""; const c = $(`.gcount[data-for="${f.name}"]`, box); if (c) genCount(c, f, ta.value); });
  $("details.more:not(.xparams)", box)?.addEventListener("toggle", e => { w.gen.adv = e.target.open; save(); });
  $("details.xparams", box).addEventListener("toggle", e => { w.gen.advX = e.target.open; save(); });
  $("[data-extra]", box).value = xtext(w);
  const promptTa = $('textarea[data-f="promptText"]', box);
  if (promptTa) promptTa.placeholder = curTask(w).output === "audio" ? "Describe the sound, or write the words to speak" : media.length ? "Describe what should happen" : `Describe the ${curTask(w).output}`;
  genStrips(w, true); genRatioPreview(w);
  genLibBar(w);
}
const genCount = (c, f, v) => { const n = String(v || "").trim().length; c.textContent = `${fmt(n)} / ${fmt(f.maxLength)}`; c.classList.toggle("bad", n > f.maxLength); };
function genRatioPreview(w) {
  const pv = $(".rpv i", w.body), sel = $('select[data-f="ratio"]', w.body); if (!pv || !sel) return;
  const v = sel.value; if (!isWH(v)) { pv.style.width = pv.style.height = "0"; return; }
  const [a, b] = dims(v), k = px(34) / Math.max(a, b);
  Object.assign(pv.style, { width: Math.max(4, Math.round(a * k)) + "px", height: Math.max(4, Math.round(b * k)) + "px" });
}

function genStrips(w, force) {
  const m = curModel(w); if (!m) return;
  m.fields.filter(f => f.kind === "media").forEach(f => {
    const strip = $(`[data-strip="${CSS.escape(f.name)}"]`, w.body); if (!strip) return;
    const lib = library(f.accept), on = new Set((picks(w)[f.name] || []).map(refKey));
    const sig = lib.map(x => refKey(x.ref)).join() + "|" + [...on].join();
    if (!force && strip.dataset.sig === sig) return;
    strip.dataset.sig = sig;
    const item = (key, thumb, cap, title, sel) => `<button type="button" class="sframe" data-field="${esc(f.name)}" data-mref="${esc(key)}"${sel == null ? "" : ` aria-pressed="${sel}"`} title="${esc(title)}"><span class="thumb sunken">${thumb}</span><span class="cap">${esc(cap)}</span></button>`;
    const had = strip.contains(document.activeElement) ? document.activeElement.dataset.mref : null; // keep focus on the frame that was used
    strip.innerHTML = [
      !f.required && !f.array && item("none", '<span class="empty">None</span>', "None", "Don't use one", !on.size),
      ...lib.map(x => item(JSON.stringify(x.ref), thumbInner(x.thumb, x.type), x.name, x.title, on.has(refKey(x.ref)))),
      item("file", '<span class="empty plus">+</span>', "Choose file…", `Choose a ${f.accept.join(" or ")} file from your Mac, or drop one on this window`, null),
    ].filter(Boolean).join("");
    if (had != null) [...strip.children].find(b => b.dataset.mref === had)?.focus({ preventScroll: true });
  });
}

// pick the size closest to the shape of the chosen image
function genMatchAspect(w, ref) {
  const f = curModel(w)?.fields.find(x => x.name === "ratio" && x.kind === "select"); if (!f) return;
  const item = library(["image", "video"]).find(x => refKey(x.ref) === refKey(ref)); if (!item || item.type !== "image") return;
  const k = refKey(ref), key = mkey(w);
  const apply = asp => { const r = closestRatio(f.options, asp); if (!r || mkey(w) !== key) return; vals(w).ratio = r; const sel = $('select[data-f="ratio"]', w.body); if (sel) sel.value = r; genRatioPreview(w); genRefresh(w); save(); };
  if (aspectCache.has(k)) return apply(aspectCache.get(k));
  const im = new Image();
  im.onload = () => { aspectCache.set(k, im.naturalWidth / im.naturalHeight); apply(im.naturalWidth / im.naturalHeight); };
  im.src = item.ref.run ? encodeURI(item.name) : `inputs/${encodeURIComponent(item.name)}`;
}

// a job or file dragged from Jobs, a gallery or the viewer: put it in the field it was dropped on, or the first field that takes its type
function genDropRun(w, id, fieldName) {
  const r = runOf(id), m = curModel(w); if (!r || !r.asset || !m) return;
  const kind = /\.(png|jpe?g|webp|gif|svg)$/i.test(r.asset) ? "image" : /\.(mp4|mov|webm|m4v)$/i.test(r.asset) ? "video" : /\.(mp3|wav|flac|ogg|m4a|aac|opus)$/i.test(r.asset) ? "audio" : r.type;
  const media = m.fields.filter(x => x.kind === "media");
  const f = media.find(x => x.name === fieldName && x.accept.includes(kind)) || media.find(x => x.accept.includes(kind));
  if (!f) { genMsg(w, media.length ? `${m.id} has no ${kind} input here. ${media.map(x => `${x.label} takes ${x.accept.join(" or ")}`).join("; ")}.` : `${m.id} doesn't take files. Pick a task with an input, e.g. Image to video.`); return; }
  if (fieldName && f.name !== fieldName) genMsg(w, `${media.find(x => x.name === fieldName)?.label || "That input"} doesn't take ${kind}, so ${r.asset} went into ${f.label}.`, true);
  else genMsg(w, null);
  const p = picks(w), ref = { run: r.taskId };
  p[f.name] = f.array ? [...(p[f.name] || []).filter(x => refKey(x) !== refKey(ref)), ref].slice(-(f.max || 10)) : [ref];
  genStrips(w, true); genMatchAspect(w, ref); genRefresh(w); save();
  focus(w);
}

// copy a file from the Mac into inputs/ and select it
async function genUpload(w, file, fieldName) {
  const kind = (file.type.split("/")[0] || "").toLowerCase(), m = curModel(w);
  const f = m?.fields.find(x => x.kind === "media" && (fieldName ? x.name === fieldName : x.accept.includes(kind)));
  if (!f) { genMsg(w, `${m?.id || "This model"} has no ${kind || "file"} input. Pick a task that takes one.`); return; }
  if (!f.accept.includes(kind)) { genMsg(w, `${f.label} takes ${f.accept.join(" or ")}. ${file.name} is ${kind ? "a" + (/^[aeiou]/.test(kind) ? "n " : " ") + kind : "another kind of"} file.`); return; }
  genMsg(w, `Copying ${file.name} into the inputs folder…`, true);
  try {
    const out = await api("/api/upload", null, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name) }, body: file });
    await poll();
    const p = picks(w), ref = { input: out.file };
    p[f.name] = f.array ? [...(p[f.name] || []), ref].slice(-(f.max || 10)) : [ref];
    genMsg(w, null); genStrips(w, true); genMatchAspect(w, ref); genRefresh(w); save();
  } catch (err) {
    genMsg(w, err.message);
  }
}

// add "name": <stub> to the Additional parameters JSON, keeping what is there
function genAddExtra(w, name) {
  const x = curModel(w).extra.find(e => e.name === name), ta = $("[data-extra]", w.body);
  const h = x?.hint || "";
  const stub = h.startsWith("array") ? [] : h.startsWith("{") ? {} : /^(integer|number)/.test(h) ? 0 : h.startsWith("one of: ") ? h.slice(8).split(", ")[0] : h.startsWith('"') ? JSON.parse(h) : "";
  let obj = {};
  try { obj = JSON.parse(ta.value.trim() || "{}"); } catch { genMsg(w, "Fix the JSON first, then add more parameters."); return; }
  if (!(name in obj)) obj[name] = stub;
  ta.value = JSON.stringify(obj, null, 2);
  (w.gen.extra ||= {})[mkey(w)] = ta.value;
  ta.focus(); genMsg(w, null); genRefresh(w); save();
}

function genRefresh(w, fromPrice) {
  const f = w.body, hint = $(".ghint", f); if (!hint) return;
  const why = genBlock(w), btn = $(".btn-go", f);
  const key = !why && curModel(w) ? JSON.stringify(genBody(w)) : "";
  if (!fromPrice && key) genPrice(w, key);
  const fresh = !!key && w.priceFor === key, pr = fresh ? w.price : null;
  let text = why;
  if (!why) {
    if (fresh && pr && pr.credits != null) text = `${pr.exact ? "" : "≈ "}${fmt(pr.credits)} credits · ${pr.breakdown || ""}${pr.note ? ` · ${pr.note}` : ""}`;
    else if (fresh) text = (pr?.note ? `Price unknown: ${pr.note}. ` : "") + genCost(w);
    else text = hint.classList.contains("why") ? "" : hint.textContent; // keep the last price on screen until the new one arrives
  }
  hint.classList.toggle("stale", !why && !fresh);
  hint.textContent = text; hint.title = text; hint.classList.toggle("why", !!why);
  if (!why && fresh) spendHint(w, hint, pr);
  if (!w.busy && (why || fresh)) $("span", btn).textContent = !why && pr?.credits != null ? `Generate · ${pr.exact ? "" : "≈"}${fmt(pr.credits)} cr` : "Generate";
  // blocked: aria-disabled keeps it focusable with the reason (.ghint) as its description; genSubmit refuses and shows the reason.
  // Only sending uses real disabled.
  btn.disabled = !!w.busy;
  why ? btn.setAttribute("aria-disabled", "true") : btn.removeAttribute("aria-disabled");
  $(".gkey", f).hidden = !S.loaded || S.data.live;
}
function genMsg(w, text, neutral) {
  const m = $(".gmsg", w.body); if (!m) return;
  m.hidden = !text; m.textContent = text || ""; m.classList.toggle("info", !!neutral);
}

// the request Generate would send, also used to price it
function genBody(w) {
  const t = curTask(w), m = curModel(w), v = vals(w), p = picks(w), values = {}, media = {};
  m.fields.forEach(f => {
    if (f.kind === "media") { if ((p[f.name] || []).length) media[f.name] = p[f.name]; return; }
    if (f.kind === "const") return;
    const val = shownVal(f, v[f.name]);
    if (f.kind === "bool") { if (v[f.name] !== undefined && !!v[f.name] !== !!f.default) values[f.name] = !!v[f.name]; return; }
    if (f.kind === "range" && v[f.name] === undefined) return; // untouched slider: Runway's default
    if (val !== "" && val != null) values[f.name] = typeof val === "string" ? val.trim() : val;
  });
  const extra = genExtra(w).obj || {};
  Object.keys(extra).forEach(k => { delete values[k]; delete media[k]; });
  return { endpoint: t.endpoint, model: m.id, values, media, extra };
}
// exact price from the server's pricing table, refreshed shortly after each change
const priceCache = new Map();
function genPrice(w, key) {
  clearTimeout(w.priceT);
  if (!key || key === w.priceFor || key === w.priceKey) return;
  if (priceCache.has(key)) { w.price = priceCache.get(key); w.priceFor = key; w.priceKey = key; genRefresh(w, true); return; }
  w.priceT = setTimeout(async () => {
    if (!wins.has(w.id) || !curModel(w)) return;
    w.priceKey = key;
    w.priceCtl?.abort(); const ctl = w.priceCtl = new AbortController();
    let out = null;
    try { out = await api("/api/price", JSON.parse(key), { signal: ctl.signal }); } catch (e) { if (e.name === "AbortError") return; }
    if (out) priceCache.set(key, out);
    if (w.priceKey !== key) return;
    w.price = out; w.priceFor = key; genRefresh(w, true);
  }, 200);
}

async function genSubmit(w) {
  const why = genBlock(w); if (why) { genMsg(w, why + "."); return; }
  if (w.busy) return;
  if (!(await spendCheck(w)) || w.busy) return;
  const t = curTask(w), m = curModel(w), btn = $(".btn-go", w.body), label = $("span", btn);
  const { values, media, extra: ex } = genBody(w);
  w.busy = true; btn.disabled = true; label.textContent = Object.keys(media).length ? "Uploading…" : "Sending…"; genMsg(w, null);
  try {
    const out = await api("/api/generate", { endpoint: t.endpoint, model: m.id, values, media, extra: ex });
    balloon({ title: "Job sent to Runway", text: `${t.label} · ${m.id} · queued`, icon: "i-wand", ms: 6000, onOpen: () => open("props", out.taskId, $("#tray-run")) });
    poll();
    activityShow(w, out);
  } catch (err) {
    genMsg(w, err.message);
  } finally {
    w.busy = false; genRefresh(w);
  }
}

/* ---------- Activity: jobs in progress and recently finished, like a download manager ---------- */
const fresh = {}; // rows the server just returned from /api/generate, shown until a poll brings them from runs.json
const sentRun = (w, id) => runOf(id) || fresh[id];
const etaText = end => (end > Date.now() ? `~${dur(end - Date.now())} left` : "longer than usual");
// every queued or rendering job, then finished ones from the last 24 h that weren't cleared, newest first
function activityList(w) {
  const since = Math.max(Date.now() - 86400000, w.act?.clearedAt || 0), hide = new Set(w.act?.hide || []);
  const ids = new Set(S.data.runs.map(r => r.taskId));
  const rows = [...S.data.runs, ...Object.values(fresh).filter(r => !ids.has(r.taskId))];
  return rows.filter(r => !hide.has(r.taskId) && (ACTIVE.has(r.status) || createdMs(r) >= since))
    .sort((a, b) => (ACTIVE.has(b.status) - ACTIVE.has(a.status)) || createdMs(b) - createdMs(a)).slice(0, 20);
}
function genSentItem(w, r) {
  const s = statusInfo(r), id = esc(r.taskId), name = `${r.task || cap(r.type)} · ${r.model}`;
  let st = `<span class="st ${s.cls}"><i class="dot"></i>${esc(s.label)}</span>`, acts = "";
  if (ACTIVE.has(r.status)) {
    const typ = s.cls === "running" ? typicalMs(r.model) : null, end = createdMs(r) + typ;
    if (s.cls === "running") st += `<span class="mprog sunken" aria-hidden="true"><i style="width:${s.p ?? 8}%" class="${s.p == null ? "ind" : ""}"></i></span>`;
    st += `<small class="muted">${relHTML(r.createdAt || r.date, "elapsed")}${typ ? ` · <span data-eta="${end}">${etaText(end)}</span>` : ""}</small>`;
    const busy = w.gsBusy?.has(r.taskId);
    acts = `<button type="button" class="raised btn-s b-danger" data-gs="cancel" data-run="${id}" aria-label="${busy ? "Cancelling" : "Cancel"} ${esc(name)}" ${busy ? "disabled" : ""}>${icoLabel("i-stop", busy ? "Cancelling…" : "Cancel")}</button>`;
  } else if (r.status === "succeeded") {
    const c = r.credits, q = r.quotedCredits;
    const cost = c != null ? `${fmt(c)} credits${q != null ? (c === q ? ", as quoted" : `, quoted ${r.quoteExact ? "" : "≈"}${fmt(q)}`) : ""}`
      : r.estimatedCredits != null ? `~${fmt(r.estimatedCredits)} credits, estimated` : "Cost not reported yet";
    st += `<small class="muted">${cost} · ${relHTML(r.finishedAt || r.createdAt || r.date)}</small>`;
    const label = r.asset ? "Open" : "Properties";
    acts = `<button type="button" class="raised btn-s b-default" data-gs="open" data-run="${id}" aria-label="${label} ${esc(r.asset || name)}">${icoLabel(r.asset ? typeIcon(r.type) : "i-doc", label)}</button>`;
  } else if (r.status === "failed") st += `<small class="gs-why" title="${esc(r.failure || "")}">${esc(r.failure || "Runway gave no reason")}</small>`;
  return `<li class="gs-item">
        <div class="gs-name" title="${esc(name + "\n" + r.prompt)}">${miniThumb(r)}<span><b>${esc(r.prompt)}</b><small class="muted">${esc(name)}</small></span></div><div class="gs-st">${st}</div>
        <div class="gs-acts">${acts}<button type="button" class="raised gs-x" data-gs="x" data-run="${id}" aria-label="Remove ${esc(name)} from this list" title="Remove from this list"><i class="g-close"></i></button></div>
      </li>`;
}
function activityRender(w) {
  w.act ||= { clearedAt: 0, hide: [] };
  if (!w.shell) {
    w.shell = true;
    w.body.innerHTML = `<div class="gsent act" data-keep="act"></div><div class="statusbar"><span class="sunken seg grow"></span></div>`;
    $(".act", w.body).addEventListener("click", async e => {
      const b = e.target.closest("button[data-gs]"); if (!b) return;
      const act = b.dataset.gs, id = b.dataset.run, r = id && sentRun(w, id);
      if (act === "open" && r) defaultOpen(r, b);
      else if (act === "cancel" && r) {
        (w.gsBusy ||= new Set()).add(id); activityRender(w);
        await cancelJob(r); await poll();
        w.gsBusy.delete(id); activityRender(w);
      } else if (act === "x") { w.act.hide = [...(w.act.hide || []), id].slice(-200); activityRender(w); save(); }
      else if (act === "clear") { w.act.clearedAt = Date.now(); w.act.hide = []; activityRender(w); save(); }
    });
  }
  const box = $(".act", w.body), list = activityList(w);
  const sig = JSON.stringify(list.map(r => [r.taskId, r.status, r.progress, r.credits, r.estimatedCredits, r.quotedCredits, r.failure, r.asset, typicalMs(r.model), !!w.gsBusy?.has(r.taskId)]));
  if (sig !== box.dataset.sig) {
    box.dataset.sig = sig;
    const a = document.activeElement, had = box.contains(a) ? a.dataset : null;
    const running = list.filter(r => ACTIVE.has(r.status)).length;
    morph(box, !list.length ? `<div class="empty-list">${S.loaded ? `Nothing in progress. Jobs you send show up here while they render.${emptyAct(GEN_BTN)}` : "Loading…"}</div>` : `
        <div class="gs-head"><span>${running ? `${running} in progress` : "Nothing in progress"}</span>${list.some(r => !ACTIVE.has(r.status)) ? '<button type="button" class="raised btn-s" data-gs="clear">Clear finished</button>' : ""}</div>
        <ul class="gs-list sunken">${list.map(r => genSentItem(w, r)).join("")}</ul>`);
    $(".statusbar .seg", w.body).textContent = `${list.length} job${list.length === 1 ? "" : "s"} · ${running} rendering or queued`;
    if (had) {
      const find = (gs, run) => $$("[data-gs]", box).find(b => b.dataset.gs === gs && !b.disabled && (run === undefined || b.dataset.run === run));
      (find(had.gs, had.run) || find("x", had.run) || find("x") || box)?.focus?.({ preventScroll: true });
    }
  }
}
// after a job is sent: show it in Activity, opening the window beside Generate if it isn't open; focus stays in Generate
function activityShow(gw, row) {
  fresh[row.taskId] = row;
  let aw = wins.get("activity");
  if (!aw) {
    aw = open("activity");
    // side by side with Generate: Activity on the right; slide Generate left, or narrow Activity, to make room
    const d = D(), gap = px(8), minW = Math.min(px(KINDS.activity.min[0]), d.w);
    let wd = Math.min(px(420), d.w);
    if (!gw.max && gw.wd + gap + minW <= d.w) {
      wd = Math.min(wd, d.w - gw.wd - gap);
      if (gw.x + gw.wd + gap + wd > d.w) { gw.x = Math.max(0, d.w - wd - gap - gw.wd); gw.snapped = false; place(gw); }
      Object.assign(aw, { wd, ht: Math.min(gw.ht, d.h), y: gw.y, x: gw.x + gw.wd + gap });
    } else Object.assign(aw, { wd, ht: Math.min(px(520), d.h), y: 0, x: d.w - wd });
    fit(aw); place(aw); save();
    focus(gw); $("textarea", gw.body)?.focus({ preventScroll: true });
  }
  activityRender(aw);
}

// open Generate prefilled from a job. mode: again | animate | upscale | sound | hdr
function genFrom(r, mode, src) {
  const w = open("generate", null, src), g = w.gen;
  const target = { animate: "image_to_video", upscale: r.type === "video" ? "video_upscale" : "image_upscale", sound: "video_to_audio", hdr: "video_to_hdr" }[mode]
    || r.endpoint || (r.type === "image" ? "text_to_image" : r.type === "audio" ? "text_to_speech" : r.parent ? "image_to_video" : "text_to_video");
  g.pending = { target, mode, run: r.taskId };
  save();
  if (S.CAT && w.shell) genApplyPending(w);
}
function genApplyPending(w) {
  const g = w.gen, pd = g.pending; if (!pd || !S.CAT) return;
  g.pending = null;
  const r = runOf(pd.run), t = S.CAT.tasks.find(x => x.endpoint === pd.target); if (!t) return;
  g.cat = t.category; g.ep[t.category] = t.endpoint;
  if (pd.mode === "again" && r) {
    if (t.models.some(m => m.id === r.model)) g.model[t.endpoint] = r.model;
    const key = `${t.endpoint}|${g.model[t.endpoint] || t.models[0].id}`;
    const { extra: rx, ...rp } = r.params || {};
    if (rx) (g.extra ||= {})[`${t.endpoint}|${g.model[t.endpoint] || t.models[0].id}`] = JSON.stringify(rx, null, 2);
    const v = r.params ? rp : { promptText: r.prompt.startsWith("(no prompt") ? "" : r.prompt, ratio: String(r.settings || "").split(" · ")[0], ...(secondsOf(r) ? { duration: secondsOf(r) } : {}) };
    g.vals[key] = v;
    const m = {};
    (r.inputs || (r.parent ? [{ field: "promptImage", run: r.parent }] : [])).forEach(i => { (m[i.field] ||= []).push(i.run ? { run: i.run } : { input: i.input }); });
    g.media[key] = m;
  } else if (r) {
    const m = t.models.find(x => x.id === g.model[t.endpoint]) || t.models[0];
    const key = `${t.endpoint}|${m.id}`, f = m.fields.find(x => x.kind === "media" && x.accept.includes(r.type));
    if (f) { g.media[key] = { ...(g.media[key] || {}), [f.name]: [{ run: r.taskId }] }; }
    if (pd.mode === "sound" && secondsOf(r)) g.vals[key] = { ...(g.vals[key] || {}), duration: secondsOf(r) };
    g.model[t.endpoint] = m.id;
  }
  genSwitch(w);
  if (pd.mode === "animate" && r) genMatchAspect(w, { run: r.taskId });
  $("textarea", w.body)?.focus();
}

async function cancelJob(r) {
  try {
    await api("/api/cancel", { taskId: r.taskId });
    balloon({ title: "Cancelling job", text: `${r.model} · ${r.taskId.slice(0, 8)}. It shows as Cancelled once Runway confirms.`, ms: 4000 });
    poll();
  } catch (err) {
    balloon({ title: "Couldn't cancel the job", text: err.message, ms: 6000 });
  }
}

/* ---------- terminal: a DOS-style prompt that speaks both dir and ls ---------- */
const bootAt = Date.now();
const DIRS = { images: "image", videos: "video", audio: "audio", jobs: null, inputs: "input", notes: null };
const TERM_HELP = [
  ["neofetch", "system info, with the logo"],
  ["ls, ll, dir [folder]", "list a folder (ls -l or ll for details)"],
  ["cd <folder>", "move to images, videos, audio, jobs, inputs or notes (cd .. to go up)"],
  ["tree [folder]", "show folders and files as a tree"],
  ["pwd", "show the current folder"],
  ["open, start <name>", "open a file or job in its window"],
  ["cat, type <name>", "show a job's details, or a note's text"],
  ["ps", "jobs rendering or queued"],
  ["balance", "credits left and spent today"],
  ["cost [days]", "credits spent per model (org) and per task (yours), default 30 days"],
  ["gen [prompt]", "open Generate, with the prompt filled in"],
  ["finder", "show the Runway folder in Finder"],
  ["history", "commands you typed"],
  ["bootlog, dmesg", "the startup checks, with their times"],
  ["clear, cls", "clear the screen"],
  ["reboot [--clean|--all]", "restart; --clean forgets the window layout, --all also resets Options"],
  ["shutdown", "open the Shut down dialog"],
  ["exit", "close the terminal"],
];

function termEntries(dir) {
  if (!dir) return Object.keys(DIRS).map(d => ({ name: d + "/", dir: d }));
  if (dir === "jobs") return newestFirst().map(r => ({ name: r.taskId.slice(0, 8), run: r }));
  if (dir === "inputs") return (S.data.inputs || []).map(i => ({ name: i.file, input: i }));
  if (dir === "notes") { noteListStale(); return (notesSt.list || []).map(n => ({ name: n.name, note: n })); }
  return assetsOf(DIRS[dir]).map(r => ({ name: r.asset, run: r }));
}
function termFind(w, arg) {
  const a = String(arg || "").replace(/^\.\//, "").replace(/^\/?(images|videos|audio|jobs|inputs|notes)\//i, "").toLowerCase(); if (!a) return null;
  return S.data.runs.find(r => (r.asset || "").toLowerCase() === a || r.taskId.toLowerCase().startsWith(a))
    || termEntries(w.term.cwd).map(e => e.run).filter(Boolean).find(r => (r.asset || "").toLowerCase().startsWith(a)) || null;
}

function neofetch() {
  const runs = S.data.runs, active = runs.filter(r => ACTIVE.has(r.status)).length;
  const up = Math.round((Date.now() - bootAt) / 60000), sp = spark(S.data.history);
  const count = t => runs.filter(r => r.type === t && r.asset).length;
  const info = [
    `<b class="t-acc">you</b>@<b class="t-acc">runway-os</b>`,
    "-------------",
    `<b class="t-acc">OS</b>: runway os (Win95 edition)`,
    `<b class="t-acc">Host</b>: ${esc(location.host)}`,
    `<b class="t-acc">Uptime</b>: ${up < 60 ? `${up} min` : `${Math.floor(up / 60)} h ${up % 60} min`}`,
    `<b class="t-acc">API</b>: ${S.data.live ? `Runway 2024-11-06, key ending ${esc(S.data.keyHint || "…")}` : "no key"}`,
    `<b class="t-acc">Credits</b>: <span class="t-red">${S.data.balance == null ? "?" : fmt(S.data.balance)}</span>`,
    `<b class="t-acc">Org, 24 h</b>: ${sp.spent != null ? `${fmt(sp.spent)} credits spent` : "collecting"}`,
    `<b class="t-acc">Jobs</b>: ${runs.length} (${fmt(runs.reduce((s, r) => s + (r.credits || 0), 0))} credits)`,
    `<b class="t-acc">Files</b>: ${count("image")} images, ${count("video")} videos, ${count("audio")} audio`,
    `<b class="t-acc">Rendering</b>: ${active || "idle"}`,
    "",
    ["#08090b", "#ff2b1c", "#5fdc7a", "#ffc94a", "#1f6fc4", "#c678dd", "#56b6c2", "#e4e4e8"].map(c => `<span class="t-sw" style="background:${c}"></span>`).join(""),
  ];
  const px = R_BITS.flatMap((row, y) => [...row].map((c, x) => (c === "1" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ""))).join("");
  const art = `<svg class="t-logo" viewBox="-1 -1 10 13" shape-rendering="crispEdges" aria-hidden="true">${px}</svg>`;
  return `<span class="t-neo">${art}<span>${info.join("\n")}</span></span>`;
}

const fileLink = r => `<a class="t-file" data-open="${r.asset ? "viewer" : "props"}" data-id="${esc(r.taskId)}">${esc(r.asset || r.taskId.slice(0, 8))}</a>`;
const dirLink = d => `<a class="t-dir" data-cd="${d}">${d}/</a>`;
// tree: folders with their entries; under jobs/, each job nests what it was made from
function termTree(dir) {
  const MAX = 20, out = [dir ? dirLink(dir) : "R:\\"];
  let files = 0;
  const jobNode = (r, seen) => {
    const html = `${fileLink({ ...r, asset: null })}  <span class="t-dim">${esc(r.prompt.slice(0, 40))}</span>`;
    if (seen.has(r.taskId) || seen.size > 6) return { html };
    const s2 = new Set(seen).add(r.taskId), srcs = r.inputs || (r.parent ? [{ run: r.parent }] : []), kids = [], keys = new Set();
    srcs.forEach(i => {
      const k = i.run ? "r:" + i.run : "i:" + i.input; if (keys.has(k)) return; keys.add(k);
      const src = i.run && runOf(i.run);
      if (src) kids.push(jobNode(src, s2));
      else if (i.input) kids.push({ html: `<span>inputs/${esc(i.input)}</span>` });
    });
    return { html, kids };
  };
  const folder = d => {
    const list = termEntries(d); files += list.length;
    const kids = list.slice(0, MAX).map(e => e.input ? { html: `<span>${esc(e.name)}</span>` } : e.note ? { html: noteTermLink(e.name) } : d === "jobs" ? jobNode(e.run, new Set()) : { html: fileLink(e.run) });
    if (list.length > MAX) kids.push({ html: `<span class="t-dim">… and ${list.length - MAX} more</span>` });
    return { html: dirLink(d), kids };
  };
  const walk = (kids, pre) => (kids || []).forEach((k, i) => {
    const last = i === kids.length - 1;
    out.push(pre + (last ? "└── " : "├── ") + k.html);
    walk(k.kids, pre + (last ? "    " : "│   "));
  });
  const dirs = dir ? [dir] : Object.keys(DIRS);
  walk(dir ? folder(dir).kids : dirs.map(folder), "");
  out.push("", `<span class="t-dim">${dirs.length} folder${dirs.length === 1 ? "" : "s"}, ${files} file${files === 1 ? "" : "s"}</span>`);
  return out.join("\n");
}

function termRun(w, raw) {
  const t = w.term, out = [], say = (h, cls = "") => out.push(cls ? `<span class="${cls}">${h}</span>` : h);
  const line = raw.trim();
  t.lines.push(`<span class="t-prompt">${esc(termPrompt(t))}</span>${esc(raw)}`);
  if (!line) return termPaint(w);
  t.hist.push(line); t.hi = t.hist.length;
  const [cmd0, ...args] = line.match(/"[^"]*"|\S+/g).map(x => x.replace(/^"|"$/g, ""));
  const cmd = cmd0.toLowerCase(), arg = args.join(" ");
  switch (cmd) {
    case "help": case "?":
      say(TERM_HELP.map(([c, d]) => `  <b class="t-acc">${esc(c.padEnd(22))}</b>${esc(d)}`).join("\n")); break;
    case "neofetch": case "ver": case "about": say(neofetch()); break;
    case "ls": case "ll": case "dir": {
      const long = args.includes("-l") || cmd === "dir" || cmd === "ll", target = args.find(a => !a.startsWith("-"));
      const dir = target ? target.replace(/\/$/, "").replace(/^\//, "").toLowerCase() : t.cwd;
      if (dir && dir !== ".." && !(dir in DIRS)) { say(`ls: ${esc(target)}: no such folder`, "t-err"); break; }
      const list = termEntries(dir === ".." ? null : dir);
      if (!list.length) { say("(empty)", "t-dim"); break; }
      say(list.map(e => {
        if (e.dir) return `<a class="t-dir" data-cd="${e.dir}">${e.name}</a>`;
        if (e.input) return `<span>${esc(e.name)}</span>`;
        if (e.note) return (long ? `${new Date(e.note.modified).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).padEnd(16)} ${String(fmt(e.note.size)).padStart(9)} B  ` : "") + noteTermLink(e.name);
        const r = e.run;
        if (!long) return dir === "jobs" ? `${fileLink({ ...r, asset: null })}  ${esc(r.prompt.slice(0, 50))}` : fileLink(r);
        const when = new Date(createdMs(r)).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        return `${when.padEnd(16)} ${String(r.credits ?? "-").padStart(5)} cr  ${esc((r.model || "").padEnd(18))} ${dir === "jobs" ? fileLink({ ...r, asset: null }) + "  " + esc(statusInfo(r).label) : fileLink(r)}`;
      }).join("\n"));
      if (long) say(`${list.length} item${list.length === 1 ? "" : "s"}`, "t-dim");
      break;
    }
    case "cd": case "chdir": {
      const d = (arg || "/").replace(/\/$/, "").replace(/^\//, "").toLowerCase();
      if (!d || d === ".." || d === "~" || d === "\\") t.cwd = null;
      else if (d === ".") break;
      else if (d in DIRS && !t.cwd) t.cwd = d;
      else say(`cd: ${esc(arg)}: no such folder${t.cwd ? " (cd .. first)" : ""}`, "t-err");
      break;
    }
    case "pwd": say(t.cwd ? `/${t.cwd}` : "/"); break;
    case "tree": {
      const d = arg ? arg.replace(/\/$/, "").replace(/^\//, "").toLowerCase() : t.cwd;
      if (d && !(d in DIRS)) { say(`tree: ${esc(arg)}: no such folder`, "t-err"); break; }
      say(termTree(d || null)); break;
    }
    case "open": case "start": {
      if (!arg) { say("usage: open <file, job ID or app: usage, generate, options, system, key>", "t-err"); break; }
      const app = { usage: "usage", generate: "generate", options: "options", system: "overview", jobs: "jobs", key: "key" }[arg.toLowerCase()];
      if (app && !(arg in DIRS && app === "jobs")) { open(app, null, w.el); say(`opened ${esc(arg)}`, "t-dim"); break; }
      if (arg.replace(/\/$/, "") in DIRS) { open(arg.replace(/\/$/, "") === "inputs" ? "jobs" : arg.replace(/\/$/, ""), null); say(`opened ${esc(arg)}`, "t-dim"); break; }
      const nm = noteTermFind(w, arg); if (nm) { openNote(nm, w.el); say(`opened ${esc(nm)}`, "t-dim"); break; }
      const r = termFind(w, arg); if (!r) { say(`open: ${esc(arg)}: not found`, "t-err"); break; }
      defaultOpen(r, w.el); say(`opened ${esc(r.asset || r.taskId)}`, "t-dim"); break;
    }
    case "cat": case "type": case "info": {
      const nm = noteTermFind(w, arg);
      if (nm) {
        noteGet(nm).then(d => { t.lines.push(esc(d.text) || '<span class="t-dim">(empty)</span>'); termPaint(w); })
          .catch(err => { t.lines.push(`<span class="t-err">${cmd}: ${esc(err.message)}</span>`); termPaint(w); });
        break;
      }
      const r = termFind(w, arg); if (!r) { say(`${cmd}: ${esc(arg || "?")}: not found`, "t-err"); break; }
      say([["task", r.taskId], ["file", r.asset || "not saved yet"], ["type", r.type], ["model", r.model], ["settings", r.settings], ["status", statusInfo(r).label], ["credits", r.credits ?? (r.estimatedCredits != null ? "~" + r.estimatedCredits : "-")], ["created", r.createdAt || r.date], ["prompt", r.prompt]]
        .map(([k, v]) => `<b class="t-acc">${k.padEnd(9)}</b>${esc(v)}`).join("\n"));
      break;
    }
    case "ps": case "top": {
      const act = S.data.runs.filter(r => ACTIVE.has(r.status));
      if (!act.length) { say("nothing rendering", "t-dim"); break; }
      say(act.map(r => { const p = r.progress != null ? Math.round(r.progress * 100) : null; return `${fileLink({ ...r, asset: null })}  ${esc(r.model.padEnd(18))} ${p != null ? "[" + "#".repeat(Math.round(p / 5)).padEnd(20, ".") + `] ${p}%` : statusInfo(r).label}`; }).join("\n"));
      break;
    }
    case "cost": case "usage": {
      say(spendTerm());
      const days = Math.max(1, Math.min(90, parseInt(args[0], 10) || 30));
      say(`asking Runway for ${days} days of usage…`, "t-dim"); t.lines.push(...out.splice(0)); termPaint(w);
      usageLoad(days).then(u => {
        const sum = usageSummary(u, 99), mine = usageMine(days);
        t.lines.push(`<b class="t-acc">org, last ${days} days</b>: <span class="t-red">${fmt(sum.total)}</span> credits`,
          ...sum.ranked.slice(0, 15).map(([m, v]) => `  ${esc(m.padEnd(30))}${String(fmt(v)).padStart(10)}  ${sum.total ? String(Math.round(v / sum.total * 100)).padStart(3) : "  0"}%`),
          sum.ranked.length > 15 ? `  <span class="t-dim">… and ${sum.ranked.length - 15} more models</span>` : "",
          `<b class="t-acc">your jobs</b>: ${fmt(mine.reduce((s, [, v]) => s + v.credits, 0))} credits`,
          ...mine.map(([k, v]) => `  ${esc(k.padEnd(30))}${String(fmt(v.credits)).padStart(10)}  ${v.jobs} job${v.jobs === 1 ? "" : "s"}`),
          `<span class="t-dim">open the Usage window for the chart: open usage</span>`);
        termPaint(w);
      }).catch(err => { t.lines.push(`<span class="t-err">cost: ${esc(err.message)}</span>`); termPaint(w); });
      break;
    }
    case "balance": case "credits": say(S.data.balance == null ? "balance unknown" : `<span class="t-red">${fmt(S.data.balance)}</span> credits left`); say(spendTerm()); break;
    case "gen": case "generate": {
      const gw = open("generate", null, w.el);
      if (arg && S.CAT && gw.shell) { vals(gw).promptText = arg; genFields(gw); genRefresh(gw); save(); }
      say("opened Generate", "t-dim"); break;
    }
    case "finder": case "explorer": fileAction("reveal", "runs.json"); say("showing the Runway folder in Finder", "t-dim"); break;
    case "history": say(t.hist.map((h, i) => `${String(i + 1).padStart(4)}  ${esc(h)}`).join("\n")); break;
    case "bootlog": case "dmesg": {
      if (!bootLog.length) { say("no startup checks logged yet", "t-dim"); break; }
      const at = new Date(performance.timeOrigin).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });
      say(`page loaded ${esc(at)}, times in seconds since then`, "t-dim");
      say(bootLog.map(l => `<span class="t-dim">[${(l.ms / 1000).toFixed(3).padStart(8)}]</span> ${esc(l.text)}${l.res ? " " : ""}${l.bad ? `<span class="t-err">${esc(l.res)}</span>` : esc(l.res)}`).join("\n"));
      break;
    }
    case "clear": case "cls": t.lines = []; break;
    case "echo": say(esc(arg)); break;
    case "date": case "time": say(esc(new Date().toString())); break;
    case "whoami": say("you"); break;
    case "exit": close(w); return;
    case "reboot": case "restart": {
      const mode = args.includes("--all") ? "all" : args.includes("--clean") ? "clean" : "restart";
      say(mode === "all" ? "restarting, resetting the layout and every option…" : mode === "clean" ? "restarting with a clean desktop…" : "restarting…", "t-dim");
      t.lines.push(...out.splice(0)); termPaint(w);
      setTimeout(() => restart(mode), 400);
      return;
    }
    case "shutdown": shutdownDialog(); say("opened Shut down", "t-dim"); break;
    case "sudo": say("nice try.", "t-err"); break;
    default: say(`'${esc(cmd0)}' is not a command. Type help.`, "t-err");
  }
  t.lines.push(...out);
  termPaint(w);
}
const termPrompt = t => `R:\\${t.cwd ? t.cwd.toUpperCase() : ""}> `;
function termPaint(w) {
  const t = w.term, out = $(".t-out", w.body);
  if (t.lines.length > 600) t.lines.splice(0, t.lines.length - 600);
  out.innerHTML = t.lines.join("\n") + (t.lines.length ? "\n" : "");
  $(".t-prompt.t-cur", w.body).textContent = termPrompt(t);
  const scr = $(".term", w.body); scr.scrollTop = scr.scrollHeight;
  const title = KINDS.terminal.title(w);
  if ($(".tt", w.el).textContent !== title) { retitle(w); renderTasks(); }
}

const termWelcome = t => t.lines.push(neofetch(), "", `<span class="t-dim">Type help for commands.</span>`);
// opened before the first poll: keep the prompt hidden until the data is in (8 s at most), so neofetch shows real numbers
async function termWait(w) {
  const t = w.term, line = $(".t-line", w.body);
  line.hidden = true;
  const ok = await upTo(ready, 8000);
  if (wins.get(w.id) !== w) return;
  if (!ok) t.lines.push(`<span class="t-err">Runway API not reachable — balance unavailable</span>`, "");
  termWelcome(t); line.hidden = false; termPaint(w);
  if (frontWin() === w && S.bootDone) $(".t-in", w.body).focus();
}

function termRender(w) {
  if (w.shell) return;
  w.shell = true;
  w.term ||= { cwd: null, lines: [], hist: [], hi: 0 };
  w.body.innerHTML = `<div class="term" data-keep="term"><pre class="t-out"></pre><label class="t-line"><span class="t-prompt t-cur"></span><input class="t-in" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Command"></label></div>`;
  const inp = $(".t-in", w.body), t = w.term;
  if (!t.lines.length) {
    if (S.loaded) termWelcome(t);
    else termWait(w);
  }
  termPaint(w);
  w.body.addEventListener("click", e => {
    const cd = e.target.closest("[data-cd]"); if (cd) { termRun(w, "cd " + cd.dataset.cd); inp.focus(); return; }
    if (!e.target.closest("a") && !getSelection().toString()) inp.focus();
  });
  inp.addEventListener("keydown", e => {
    if (e.key !== "Tab" && !["Shift", "Control", "Alt", "Meta"].includes(e.key)) t.tab = null; // any other key ends Tab cycling
    if (e.key === "Enter") { const v = inp.value; inp.value = ""; termRun(w, v); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      t.hi = clampN(t.hi + (e.key === "ArrowUp" ? -1 : 1), 0, t.hist.length);
      inp.value = t.hist[t.hi] || "";
    } else if (e.key === "Tab") {
      e.preventDefault();
      // several matches: Tab / Shift+Tab cycle through them, zsh style; the list prints once, on the first cycling Tab
      const c = t.tab;
      if (c) {
        if (!c.listed) { c.listed = true; t.lines.push(`<span class="t-prompt">${esc(termPrompt(t))}</span>${esc(inp.value)}`, c.hits.map(esc).join("  ")); termPaint(w); }
        c.i = c.i < 0 ? (e.shiftKey ? c.hits.length - 1 : 0) : (c.i + (e.shiftKey ? -1 : 1) + c.hits.length) % c.hits.length;
        inp.value = c.head + c.hits[c.i];
        return;
      }
      // complete the last word: a folder at the top level, or a file inside "folder/"
      const m = inp.value.match(/^(.*?)(\S*)$/), word = m[2], slash = word.lastIndexOf("/");
      const dirOnly = /^\s*(cd|chdir)\s/i.test(m[1]);
      let pre = "", stem = word, pool;
      if (slash >= 0) {
        const d = word.slice(0, slash).replace(/^\//, "").toLowerCase();
        pre = word.slice(0, slash + 1); stem = word.slice(slash + 1);
        pool = d in DIRS && !dirOnly ? termEntries(d).map(x => x.run?.asset || x.name) : [];
      } else if (!m[1].trim()) pool = TERM_HELP.flatMap(([c]) => c.split(/,\s*|\s+/)).filter(c => /^[a-z?]+$/.test(c));
      else pool = !t.cwd || dirOnly ? Object.keys(DIRS).map(d => d + "/") : termEntries(t.cwd).map(x => x.run?.asset || x.name);
      const hits = [...new Set(pool.filter(n => n && n.toLowerCase().startsWith(stem.toLowerCase())))];
      if (!hits.length) return;
      let common = hits[0];
      hits.forEach(h => { while (!h.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1); });
      if (hits.length === 1) { inp.value = m[1] + pre + hits[0] + (hits[0].endsWith("/") ? "" : " "); return; }
      t.tab = { head: m[1] + pre, hits, i: -1, word: stem, listed: false };
      // first Tab fills in the shared prefix; with nothing to add, it starts cycling right away
      if (common.length > stem.length) inp.value = m[1] + pre + common;
      else inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: e.shiftKey }));
    } else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); t.lines = []; termPaint(w); }
  });
  setTimeout(() => inp.focus(), 0);
}

/* ---------- notes: plain-text files in notes/, a NoPaste-style editor, and links that carry a whole note ----------
   A link is the text, deflate-raw compressed and base64url encoded into the fragment (#note=…&l=…), as in Blender's
   NoPaste: the fragment never reaches a server, and the link alone is the note. */
const NOTE_LANGS = [["text", "Plain text", "txt"], ["python", "Python", "py"], ["javascript", "JavaScript", "js"], ["json", "JSON", "json"], ["markdown", "Markdown", "md"], ["shell", "Shell", "sh"], ["html", "HTML", "html"], ["css", "CSS", "css"]];
const NOTE_DRAFT = "\u0000link"; // w.sel while the unsaved note from a link is open
const NOTE_PREF = "runway-os-notes-v1";
const NOTE_LINK_WARN = 8000;
const notesSt = { list: null, err: "", at: 0, draft: null, dirty: new Set() };
const langOfName = n => (NOTE_LANGS.find(l => l[2] === (/\.([^.]+)$/.exec(n || "")?.[1] || "").toLowerCase()) || NOTE_LANGS[0])[0];
const extOf = lang => (NOTE_LANGS.find(l => l[0] === lang) || NOTE_LANGS[0])[2];
// a typed name keeps its own known extension, else gets the current language's
const noteFileName = (v, lang) => (NOTE_LANGS.some(l => new RegExp(`\\.${l[2]}$`, "i").test(v.trim())) ? v.trim() : `${v.trim()}.${extOf(lang)}`);
export const noteTitle = w => w.ed?.name || (w.ed ? "From link" : "");
const noteSize = n => (n < 1024 ? `${fmt(n)} bytes` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
const noteTermLink = name => `<a class="t-file" data-note-open="${esc(name)}">${esc(name)}</a>`;
// terminal: a name in notes/ (cd notes first, or write notes/<name>)
function noteTermFind(w, arg) {
  const a = String(arg || "").trim(), m = /^\/?notes\/(.+)$/i.exec(a);
  if (!m && w.term?.cwd !== "notes") return null;
  const q = (m ? m[1] : a).toLowerCase(), list = (notesSt.list || []).map(n => n.name);
  return q ? list.find(n => n.toLowerCase() === q) || list.find(n => n.toLowerCase().startsWith(q)) || null : null;
}

/* syntax highlighting: one regex per language, its alternatives tried left to right; every rule is [token class, regex] */
const NRX = {
  dq: /"(?:\\.|[^"\\\n])*"?/, sq: /'(?:\\.|[^'\\\n])*'?/, bt: /`(?:\\[\s\S]|[^`\\])*`?/,
  num: /(?<![\w.])(?:0[xX][\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/,
  block: /\/\*[\s\S]*?(?:\*\/|(?![\s\S]))/, line: /\/\/.*/, hash: /#.*/,
};
const KW = words => new RegExp(`\\b(?:${words.split(" ").join("|")})\\b`);
const NOTE_RULES = {
  python: [["c", NRX.hash], ["s", /[rRbBuUfF]{0,2}(?:"""[\s\S]*?(?:"""|(?![\s\S]))|'''[\s\S]*?(?:'''|(?![\s\S])))/], ["s", NRX.dq], ["s", NRX.sq], ["p", /^\s*@[\w.]+/],
    ["k", KW("and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self")], ["n", NRX.num]],
  javascript: [["c", NRX.line], ["c", NRX.block], ["s", NRX.dq], ["s", NRX.sq], ["s", NRX.bt],
    ["k", KW("async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield")], ["n", NRX.num]],
  json: [["p", /"(?:\\.|[^"\\\n])*"(?=\s*:)/], ["s", NRX.dq], ["k", KW("true false null")], ["n", /-?(?<![\w.])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/]],
  markdown: [["s", /^```[\s\S]*?(?:^```.*|(?![\s\S]))/], ["k", /^#{1,6}\s.*/], ["c", /^>.*/], ["s", /`[^`\n]+`/], ["k", /^\s*(?:[-*+]|\d+[.)])(?=\s)/],
    ["p", /\*\*[^*\n]+\*\*|__[^_\n]+__/], ["n", /!?\[[^\]\n]*\]\([^)\n]*\)/]],
  shell: [["c", /(?:^|(?<=\s))#.*/], ["s", NRX.dq], ["s", NRX.sq], ["p", /\$\{[^}\n]*\}|\$(?:\w+|[@#?$!*-])/],
    ["k", KW("if then else elif fi for while until do done case esac in function return local export source exit set unset echo cd sudo")], ["n", NRX.num]],
  html: [["c", /<!--[\s\S]*?(?:-->|(?![\s\S]))/], ["k", /<\/?[A-Za-z][\w:-]*|\/?>/], ["p", /[\w:-]+(?==)/], ["s", /(?<==)(?:"[^"]*"|'[^']*')/], ["n", /&#?\w+;/]],
  css: [["c", NRX.block], ["s", NRX.dq], ["s", NRX.sq], ["k", /@[\w-]+|!important/], ["p", /[\w-]+(?=\s*:(?!:)[^{;\n]*(?:;|$))/],
    ["n", /#[\da-fA-F]{3,8}\b|(?<![\w-])-?(?:\d*\.)?\d+(?:px|em|rem|vh|vw|vmin|vmax|ch|ms|s|deg|fr|%)?/]],
};
const noteRx = {};
// HTML for the <pre> under the textarea; a token never spans a line break, so the result splits into lines on "\n"
function noteHL(text, lang) {
  const rules = NOTE_RULES[lang];
  if (!rules || text.length > 400000) return esc(text);
  const rx = (noteRx[lang] ||= new RegExp(rules.map(([, r]) => `(${r.source})`).join("|"), "gm"));
  let out = "", at = 0, m;
  rx.lastIndex = 0;
  while ((m = rx.exec(text))) {
    if (!m[0]) { rx.lastIndex++; continue; }
    const k = rules[m.findIndex((g, i) => i > 0 && g !== undefined) - 1][0];
    out += esc(text.slice(at, m.index)) + m[0].split("\n").map(p => (p ? `<span class="tk-${k}">${esc(p)}</span>` : "")).join("\n");
    at = rx.lastIndex;
  }
  return out + esc(text.slice(at));
}

/* links: deflate-raw, then base64url */
async function noteEncode(text, lang) {
  const z = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  let bin = "";
  for (let i = 0; i < z.length; i += 0x8000) bin += String.fromCharCode(...z.subarray(i, i + 0x8000));
  return `${location.origin}/#note=${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}&l=${lang}`;
}
async function noteDecode(data) {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/")), bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  if (text.length > 2e6) throw new Error("too long");
  return text;
}

/* server calls */
async function noteFetch(path) {
  let res;
  try { res = await fetch(path, { cache: "no-store" }); } catch { throw new Error(OFFLINE); }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `The server answered ${res.status}.`);
  return out;
}
const noteGet = name => noteFetch(`/api/notes/${encodeURIComponent(name)}`);
const notesEach = fn => wins.forEach(w => { if (w.kind === "notes" && w.shell) fn(w); });
async function notesLoad() {
  notesSt.at = Date.now();
  try { notesSt.list = (await noteFetch("/api/notes")).notes || []; notesSt.err = ""; }
  catch (e) { notesSt.err = e.message; }
  notesEach(notesPaint);
}
const noteListStale = () => { if (Date.now() - notesSt.at > 3000) notesLoad(); };
function noteListPut(info, was) {
  const list = (notesSt.list || []).filter(n => n.name !== info.name && n.name !== was);
  list.push(info);
  notesSt.list = list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  notesEach(notesPaint);
}

/* saving: ~800 ms after typing stops, on Ctrl/Cmd+S, before switching notes, and when the page goes away */
async function noteSave(ed) {
  clearTimeout(ed.timer);
  while (ed.busy) await ed.busy;
  if (!ed.name || ed.text === ed.saved) { notesSt.dirty.delete(ed); return; }
  const text = ed.text, w = ed.w;
  // "Saving…" only shows when the server is slow, so a quick save goes straight from Unsaved to Saved
  const slow = setTimeout(() => { if (ed.busy) { ed.state = "saving"; noteStatus(w); } }, 400);
  ed.busy = api("/api/notes", { name: ed.name, text }).then(info => {
    ed.saved = text; noteListPut(info);
    ed.state = ed.text === text ? "saved" : "unsaved";
    if (ed.state === "saved") notesSt.dirty.delete(ed);
    if (w.ntMsg?.err) w.ntMsg = null;
  }).catch(e => { ed.state = "error"; w.ntMsg = { text: `Couldn't save: ${e.message}`, warn: true, err: true }; })
    .finally(() => { clearTimeout(slow); ed.busy = null; if (w.ed === ed) noteStatus(w); });
  await ed.busy;
}
const notesFlush = () => Promise.all([...notesSt.dirty].map(noteSave));

// show a note (a name in notes/, or NOTE_DRAFT) in the editor; a newer call wins over one still loading
async function noteShow(w, key, focusEd) {
  const seq = (w.ntSeq = (w.ntSeq || 0) + 1);
  w.sel = key; save();
  await notesFlush();
  if (seq !== w.ntSeq) return;
  if (key === NOTE_DRAFT) {
    if (!notesSt.draft) return;
    w.ed = { w, name: null, text: notesSt.draft.text, saved: null, lang: notesSt.draft.lang, state: "draft" };
  } else {
    try {
      const d = await noteGet(key);
      if (seq !== w.ntSeq) return;
      w.ed = { w, name: d.name, text: d.text, saved: d.text, lang: langOfName(d.name), state: "saved" };
    } catch (e) {
      if (seq !== w.ntSeq) return;
      w.ntMsg = { text: e.message, warn: true };
      w.ed = null; w.sel = null;
      await notesLoad();
      return;
    }
  }
  w.ntMsg = key === NOTE_DRAFT ? { text: "Opened from a link. Save as note to keep it." } : null;
  noteFill(w);
  if (focusEd) $(".nt-ta", w.body)?.focus({ preventScroll: true });
}
function openNote(name, src) {
  const w = open("notes", null, src);
  noteShow(w, name, true);
  return w;
}
// put the current note in the textarea (only when switching notes, never while typing)
function noteFill(w) {
  const ta = $(".nt-ta", w.body), sc = $(".nt-scroll", w.body);
  if (!ta || !w.ed) return;
  ta.value = w.ed.text;
  ta.setSelectionRange(0, 0);
  sc.scrollTop = 0; sc.scrollLeft = 0;
  notePaint(w); notesPaint(w);
}
// the highlighted copy and the line numbers, under the textarea
function notePaint(w) {
  const ta = $(".nt-ta", w.body), hl = $(".nt-hl", w.body), sc = $(".nt-scroll", w.body);
  if (!ta || !w.ed) return;
  const lines = noteHL(ta.value, w.ed.lang).split("\n");
  hl.innerHTML = lines.map((l, i) => `<div class="nl"><span class="nn">${i + 1}</span>${l}</div>`).join("");
  sc.style.setProperty("--nt-d", Math.max(2, String(lines.length).length));
  ta.scrollTop = 0; ta.scrollLeft = 0; // the textarea is as big as its text: it never scrolls itself, .nt-scroll does
}
// keep the caret in view: the textarea never scrolls (it's as big as its text), so .nt-scroll has to follow the caret.
// The caret's spot is measured in the highlighted copy of its line, which wraps exactly like the textarea.
function noteReveal(w) {
  const ta = $(".nt-ta", w.body), sc = $(".nt-scroll", w.body), hl = $(".nt-hl", w.body);
  if (!ta || document.activeElement !== ta) return;
  const v = ta.value, s = ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd;
  const a = v.lastIndexOf("\n", s - 1) + 1, el = hl.children[v.slice(0, a).split("\n").length - 1]; if (!el) return;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement.classList.contains("nn") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  let left = s - a, node, rect = null;
  while ((node = walk.nextNode()) && left > node.length) left -= node.length;
  if (node) { const r = document.createRange(); r.setStart(node, left); r.collapse(true); rect = r.getClientRects()[0] || r.getBoundingClientRect(); }
  if (!rect || !rect.height) { const e = el.getBoundingClientRect(); rect = { top: e.top, bottom: e.top + parseFloat(getComputedStyle(ta).lineHeight), left: e.left, right: e.left }; } // an empty line
  const box = sc.getBoundingClientRect(), pad = 4, gut = el.firstChild.offsetWidth;
  if (rect.top < box.top + pad) sc.scrollTop -= box.top + pad - rect.top;
  else if (rect.bottom > box.top + sc.clientHeight - pad) sc.scrollTop += rect.bottom - (box.top + sc.clientHeight - pad);
  if (rect.left < box.left + gut + pad) sc.scrollLeft -= box.left + gut + pad - rect.left;
  else if (rect.right > box.left + sc.clientWidth - pad * 4) sc.scrollLeft += rect.right - (box.left + sc.clientWidth - pad * 4);
}
function noteStatus(w) {
  const segs = $$(".statusbar .seg", w.body); if (segs.length < 3) return;
  const ed = w.ed, [msg, pos, st] = segs, m = w.ntMsg;
  const lines = ed ? ed.text.split("\n").length : 0;
  msg.textContent = m ? m.text : ed ? `${fmt(lines)} line${lines === 1 ? "" : "s"}, ${fmt(ed.text.length)} character${ed.text.length === 1 ? "" : "s"}`
    : notesSt.list ? `${notesSt.list.length} note${notesSt.list.length === 1 ? "" : "s"}` : "";
  msg.title = msg.textContent;
  msg.classList.toggle("why", !!m?.warn);
  const ta = $(".nt-ta", w.body);
  if (ed && ta) {
    const s = ta.selectionStart, before = ed.text.slice(0, s);
    pos.textContent = `Ln ${fmt(before.split("\n").length)}, Col ${fmt(s - before.lastIndexOf("\n"))}`;
  }
  st.textContent = ed ? { draft: "Not saved", unsaved: "Unsaved", saving: "Saving…", saved: "Saved", error: "Not saved" }[ed.state] : "";
  pos.hidden = st.hidden = !ed;
}
// everything but the textarea: the list, the toolbar, the status bar and the title
function notesPaint(w) {
  const list = notesSt.list, ed = w.ed, draft = notesSt.draft, has = !!ed, isDraft = has && !ed.name;
  const keys = [...(draft ? [NOTE_DRAFT] : []), ...(list || []).map(n => n.name)];
  const empty = !list || !keys.length;
  const box = $(".nt-list", w.body), emptyEl = $(".nt-empty", w.body);
  box.hidden = $(".nt-frame", w.body).hidden = empty;
  emptyEl.hidden = !empty;
  if (empty) {
    const html = notesSt.err ? `Couldn't load the notes. ${esc(notesSt.err)}${emptyAct('<button class="raised btn-s" data-nt="reload">Try again</button>')}`
      : !list ? "Loading…"
      : `No notes yet.${emptyAct(`<button class="raised btn-s b-default" data-nt="new">${icoLabel("i-notes", "New note")}</button>`)}`;
    if (emptyEl.innerHTML !== html) emptyEl.innerHTML = html;
  } else {
    morph(box, keys.map(k => {
      const n = k === NOTE_DRAFT ? null : list.find(x => x.name === k), sel = k === w.sel;
      return `<div class="nt-item${sel ? " sel" : ""}" role="option" id="${itemId(w, k === NOTE_DRAFT ? "draft" : k)}" data-nt-item="${esc(k)}" aria-selected="${sel}" draggable="true" title="${esc(n ? n.name : "From link")}">
          <b>${esc(n ? n.name : "From link")}</b><small>${n ? `${noteSize(n.size)} · ${relHTML(n.modified)}` : "Not saved"}</small></div>`;
    }).join(""));
    const cur = $(".nt-item.sel", box);
    cur ? box.setAttribute("aria-activedescendant", cur.id) : box.removeAttribute("aria-activedescendant");
    if (cur && (cur.offsetTop < box.scrollTop || cur.offsetTop + cur.offsetHeight > box.scrollTop + box.clientHeight)) cur.scrollIntoView({ block: "nearest" });
  }
  const tb = $(".nt-tools", w.body), show = (sel, on) => { $(sel, tb).hidden = !on; };
  show('[data-nt="keep"]', isDraft);
  show('[data-nt="rename"]', has && !isDraft);
  show('[data-nt="delete"]', has);
  show(".combo", has); show(".check", has); show('[data-nt="link"]', has); show('[data-nt="use"]', has);
  const del = $('[data-nt="delete"] span', tb), dl = isDraft ? "Discard" : "Delete";
  if (del.textContent !== dl) del.textContent = dl;
  if (has) $('[data-nt="lang"]', tb).value = ed.lang;
  $('[data-nt="wrap"]', tb).checked = !!S.notePref.wrap;
  noteStatus(w);
  if ($(".tt", w.el).textContent !== KINDS.notes.title(w)) { retitle(w); renderTasks(); }
}
function noteWrap(w) {
  const ta = $(".nt-ta", w.body); if (!ta) return;
  $(".nt-scroll", w.body).classList.toggle("wrap", !!S.notePref.wrap);
  ta.wrap = S.notePref.wrap ? "soft" : "off";
}

/* editing: replace a range through execCommand so Cmd+Z undoes it (setRangeText as a fallback) */
function noteEdit(ta, start, end, text) {
  ta.setSelectionRange(start, end);
  if (!document.execCommand(text ? "insertText" : "delete", false, text)) {
    ta.setRangeText(text, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
// Ctrl/Cmd+D: delete the lines the selection touches
function noteDelLine(ta) {
  const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, a = v.lastIndexOf("\n", s - 1) + 1;
  let b = v.indexOf("\n", e > s && v[e - 1] === "\n" ? e - 1 : e);
  if (b < 0 && a > 0) { const p = v.lastIndexOf("\n", a - 2) + 1; noteEdit(ta, a - 1, v.length, ""); ta.setSelectionRange(p, p); return; }
  noteEdit(ta, a, b < 0 ? v.length : b + 1, "");
  ta.setSelectionRange(a, a);
}
// Tab: two spaces at the caret, or indent the selected lines; Shift+Tab: outdent
function noteIndent(ta, out) {
  const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
  if (!out && s === e) { noteEdit(ta, s, e, "  "); return; }
  const a = v.lastIndexOf("\n", s - 1) + 1;
  let b = v.indexOf("\n", e > s && v[e - 1] === "\n" ? e - 1 : e); if (b < 0) b = v.length;
  const old = v.slice(a, b).split("\n"), neu = old.map(l => (out ? l.replace(/^(?: {1,2}|\t)/, "") : "  " + l)), text = neu.join("\n");
  if (text === v.slice(a, b)) return;
  noteEdit(ta, a, b, text);
  ta.setSelectionRange(Math.max(a, s + neu[0].length - old[0].length), Math.max(a, e + text.length - (b - a)));
}

/* dialogs for New name, Rename, Save as note, Delete: the Shut down dialog's frame, modal, Esc cancels.
   act runs on OK; when it throws, its message shows in the dialog and the dialog stays open. */
function noteDialog({ title, msg, value, ok, danger, act }) {
  if ($("#notedlg")) return Promise.resolve(false);
  return new Promise(resolve => {
    const back = document.activeElement, ask = value != null, d = document.createElement("div");
    d.id = "notedlg"; d.className = "shutdown";
    d.innerHTML = `
        <div class="sd-win window front raised" role="${ask ? "dialog" : "alertdialog"}" aria-modal="true" aria-labelledby="nd-t" aria-describedby="nd-m">
          <div class="titlebar"><span class="t"><svg class="ico ticon" aria-hidden="true"><use href="#i-notes"/></svg><span class="tt" id="nd-t">${esc(title)}</span></span></div>
          <div class="sd-body">
            <svg class="sd-ico" aria-hidden="true"><use href="#${danger ? "i-remove" : "i-notes"}"/></svg>
            <div class="nd-col">
              ${ask ? `<label for="nd-in" id="nd-m">${esc(msg)}</label><input class="field" id="nd-in" spellcheck="false" autocomplete="off" maxlength="100">` : `<p id="nd-m">${esc(msg)}</p>`}
              <div class="gmsg" role="alert" hidden></div>
            </div>
          </div>
          <div class="sheet-foot"><span class="grow"></span><button class="raised btn-ok b-default" data-nd="ok">${esc(ok)}</button><button class="raised btn-ok" data-nd="cancel">Cancel</button></div>
        </div>`;
    document.body.append(d);
    const inp = $("#nd-in", d), err = $(".gmsg", d), okBtn = $('[data-nd="ok"]', d);
    if (inp) { inp.value = value; const dot = value.lastIndexOf("."); inp.focus(); inp.setSelectionRange(0, dot > 0 ? dot : value.length); } else okBtn.focus();
    let busy = false;
    const finish = res => { removeEventListener("keydown", onKey, true); d.remove(); back?.focus?.({ preventScroll: true }); resolve(res); };
    const submit = async () => {
      if (busy) return;
      busy = true; okBtn.disabled = true; err.hidden = true;
      try { await act(inp ? inp.value : true); finish(true); }
      catch (e) { err.textContent = e.message; err.hidden = false; busy = false; okBtn.disabled = false; (inp || okBtn).focus(); }
    };
    // modal: takes every key while open; Tab stays inside
    const onKey = e => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); finish(false); return; }
      if (e.key === "Enter" && !e.target.closest('[data-nd="cancel"]')) { e.preventDefault(); submit(); return; }
      if (e.key === "Tab") {
        const f = $$("input, button:not(:disabled)", d), i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    };
    addEventListener("keydown", onKey, true);
    d.addEventListener("click", e => { const b = e.target.closest("[data-nd]"); if (b) b.dataset.nd === "ok" ? submit() : finish(false); });
    d.addEventListener("contextmenu", e => { if (!e.shiftKey) e.preventDefault(); }); // the in-app menu would open under the dialog
  });
}

/* toolbar actions */
async function noteNew(w) {
  await notesFlush();
  const taken = new Set((notesSt.list || []).map(n => n.name.toLowerCase()));
  let i = 1, name = "Untitled.txt";
  while (taken.has(name.toLowerCase())) name = `Untitled ${++i}.txt`;
  try {
    const info = await api("/api/notes", { name, text: "", create: true });
    noteListPut(info);
    await noteShow(w, info.name, true);
    w.ntMsg = { text: `Created ${info.name}. Rename it with Rename… or F2 in the list.` }; noteStatus(w);
  } catch (e) { w.ntMsg = { text: e.message, warn: true }; noteStatus(w); }
}
// after a rename (or a language change, which changes the extension)
function noteRenamed(w, ed, info, was) {
  ed.name = info.name; ed.lang = langOfName(info.name);
  if (w.sel === was) { w.sel = info.name; save(); }
  noteListPut(info, was); notePaint(w); notesPaint(w);
}
async function noteRename(w) {
  const ed = w.ed; if (!ed?.name) return;
  await notesFlush();
  await noteDialog({ title: "Rename note", msg: "New name:", value: ed.name, ok: "Rename", act: async v => {
    const was = ed.name, info = await api("/api/notes/rename", { name: was, to: noteFileName(v, ed.lang) });
    noteRenamed(w, ed, info, was);
  } });
}
async function noteLang(w, lang) {
  const ed = w.ed; if (!ed || lang === ed.lang) return;
  if (!ed.name) { ed.lang = notesSt.draft.lang = lang; notePaint(w); notesPaint(w); return; }
  await notesFlush();
  const was = ed.name;
  try { noteRenamed(w, ed, await api("/api/notes/rename", { name: was, to: was.replace(/\.[^.]*$/, "") + "." + extOf(lang) }), was); w.ntMsg = { text: `Renamed to ${ed.name}` }; }
  catch (e) { w.ntMsg = { text: e.message, warn: true }; }
  notesPaint(w);
}
async function noteDelete(w) {
  const ed = w.ed; if (!ed) return;
  const keys = [...(notesSt.draft ? [NOTE_DRAFT] : []), ...(notesSt.list || []).map(n => n.name)], key = ed.name || NOTE_DRAFT, at = keys.indexOf(key);
  const ok = await noteDialog(ed.name
    ? { title: "Delete note", msg: `Delete ${ed.name}? The file is removed from the notes folder.`, ok: "Delete", danger: true, act: async () => {
        clearTimeout(ed.timer); notesSt.dirty.delete(ed); while (ed.busy) await ed.busy;
        await api("/api/notes/delete", { name: ed.name });
        notesSt.list = (notesSt.list || []).filter(n => n.name !== ed.name);
      } }
    : { title: "Discard note", msg: "Discard the note from the link? It isn't saved anywhere else.", ok: "Discard", danger: true, act: async () => { notesSt.draft = null; } });
  if (!ok) return;
  const rest = keys.filter(k => k !== key), next = rest[Math.min(Math.max(at, 0), rest.length - 1)];
  w.ed = null; w.ntMsg = null;
  if (next) noteShow(w, next); else { w.sel = null; save(); }
  notesEach(notesPaint);
}
async function noteKeep(w) {
  const ed = w.ed; if (!ed || ed.name) return;
  await noteDialog({ title: "Save as note", msg: "Name:", value: `From link.${extOf(ed.lang)}`, ok: "Save", act: async v => {
    const info = await api("/api/notes", { name: noteFileName(v, ed.lang), text: ed.text, create: true });
    notesSt.draft = null;
    Object.assign(ed, { name: info.name, saved: ed.text, lang: langOfName(info.name), state: "saved" });
    w.sel = info.name; w.ntMsg = { text: `Saved as ${info.name}` }; save();
    noteListPut(info); notePaint(w);
  } });
}
async function noteCopyLink(w) {
  const ed = w.ed; if (!ed) return;
  try {
    const url = await noteEncode(ed.text, ed.lang);
    await navigator.clipboard.writeText(url);
    const n = url.length;
    w.ntMsg = n > NOTE_LINK_WARN ? { text: `Link copied, ${fmt(n)} characters. Some apps cut links longer than ${fmt(NOTE_LINK_WARN)} characters.`, warn: true } : { text: `Link copied, ${fmt(n)} characters.` };
  } catch (e) { w.ntMsg = { text: e.name === "NotAllowedError" ? "The browser blocked clipboard access." : `Couldn't make the link: ${e.message}`, warn: true }; }
  noteStatus(w);
}

function notesRender(w) {
  if (w.shell) { notesPaint(w); return; }
  w.shell = true;
  w.body.innerHTML = `
      <div class="toolbar nt-tools">
        <button class="raised btn-s" data-nt="new">${icoLabel("i-notes", "New")}</button>
        <button class="raised btn-s b-default" data-nt="keep" hidden>${icoLabel("i-save", "Save as note…")}</button>
        <button class="raised btn-s" data-nt="rename" hidden><span>Rename…</span></button>
        <button class="raised btn-s b-danger" data-nt="delete" hidden>${icoLabel("i-remove", "Delete")}</button>
        <span class="combo" hidden><select class="field" data-nt="lang" aria-label="Language">${NOTE_LANGS.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></span>
        <label class="check" hidden><input type="checkbox" data-nt="wrap"><span>Wrap lines</span></label>
        <button class="raised btn-s" data-nt="use" hidden title="Replace Generate's prompt with the selected text, or with the whole note">${icoLabel("i-wand", "Use as prompt")}</button>
        <span class="grow"></span>
        <button class="raised btn-s" data-nt="link" hidden title="Copy a link that holds the whole note">${icoLabel("i-copy", "Copy link")}</button>
        <button class="raised btn-s" data-nt="finder">${icoLabel("i-finder", "Show in Finder")}</button>
      </div>
      <div class="nt-main">
        <div class="nt-list sunken" role="listbox" tabindex="0" aria-label="Notes" hidden></div>
        <div class="nt-frame sunken" hidden><div class="nt-scroll"><div class="nt-code"><pre class="nt-hl" aria-hidden="true"></pre><textarea class="nt-ta" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Note text" aria-description="Tab inserts two spaces. Press Esc, then Tab, to leave the editor."></textarea></div></div></div>
        <div class="empty-list nt-empty"></div>
      </div>
      <div class="statusbar"><span class="sunken seg grow"></span><span class="sunken seg nt-pos" hidden></span><span class="sunken seg nt-state" hidden></span></div>`;
  const ta = $(".nt-ta", w.body), box = $(".nt-list", w.body);
  noteWrap(w);
  w.body.addEventListener("click", e => {
    const it = e.target.closest("[data-nt-item]");
    if (it) { if (it.dataset.ntItem !== w.sel || !w.ed) noteShow(w, it.dataset.ntItem); box.focus({ preventScroll: true }); return; }
    const b = e.target.closest("button[data-nt]"); if (!b) return;
    ({ new: noteNew, use: noteUseAsPrompt, keep: noteKeep, rename: noteRename, delete: noteDelete, link: noteCopyLink, reload: notesLoad,
      finder: () => api("/api/notes/reveal", w.ed?.name ? { name: w.ed.name } : {}).catch(err => { w.ntMsg = { text: err.message, warn: true }; noteStatus(w); }) })[b.dataset.nt]?.(w);
  });
  w.body.addEventListener("change", e => {
    if (e.target.matches('[data-nt="lang"]')) noteLang(w, e.target.value);
    if (e.target.matches('[data-nt="wrap"]')) {
      S.notePref.wrap = e.target.checked;
      try { localStorage.setItem(NOTE_PREF, JSON.stringify(S.notePref)); } catch {}
      notesEach(noteWrap);
    }
  });
  ta.addEventListener("input", () => {
    const ed = w.ed; if (!ed) return;
    ed.text = ta.value; w.ntMsg = null;
    if (!ed.name) notesSt.draft.text = ed.text;
    else {
      if (ed.state !== "saving") ed.state = ed.text === ed.saved ? "saved" : "unsaved";
      clearTimeout(ed.timer);
      if (ed.text !== ed.saved) { notesSt.dirty.add(ed); ed.timer = setTimeout(() => noteSave(ed), 800); }
    }
    notePaint(w); noteStatus(w); noteReveal(w);
  });
  ta.addEventListener("keydown", e => {
    const mod = (e.metaKey || e.ctrlKey) && !e.altKey, k = e.key.toLowerCase();
    if (mod && k === "s") { e.preventDefault(); w.ed?.name ? noteSave(w.ed) : noteKeep(w); return; }
    if (mod && k === "d" && !e.shiftKey) { e.preventDefault(); noteDelLine(ta); return; }
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (w.ntEsc) { w.ntEsc = false; return; } // Esc, then Tab: leave the editor
      e.preventDefault(); noteIndent(ta, e.shiftKey); return;
    }
    w.ntEsc = e.key === "Escape";
    requestAnimationFrame(() => noteReveal(w)); // arrows, Page Up/Down, Home/End move the caret
  });
  for (const ev of ["keyup", "pointerup", "focus", "select"]) ta.addEventListener(ev, () => noteStatus(w));
  box.addEventListener("keydown", e => {
    const keys = $$("[data-nt-item]", box).map(x => x.dataset.ntItem), i = keys.indexOf(w.sel);
    const n = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: keys.length - 1 }[e.key];
    if (n != null) { e.preventDefault(); if (keys.length) { const k = keys[clampN(n, 0, keys.length - 1)]; if (k !== w.sel || !w.ed) noteShow(w, k); } return; }
    if (e.key === "Enter") { e.preventDefault(); ta.focus({ preventScroll: true }); }
    else if (e.key === "F2") { e.preventDefault(); noteRename(w); }
    else if (e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) { e.preventDefault(); noteDelete(w); }
  });
  notesPaint(w);
  notesLoad().then(() => {
    if (w.ed || w.ntSeq || wins.get(w.id) !== w) return;
    const names = (notesSt.list || []).map(n => n.name);
    const pick = (w.sel === NOTE_DRAFT && notesSt.draft) || names.includes(w.sel) ? w.sel : notesSt.draft ? NOTE_DRAFT : names[0];
    if (pick) noteShow(w, pick, frontWin() === w && S.bootDone);
  });
}

// a #note= link: open it as an unsaved note once the desktop is up (after the boot screen), then clear the fragment
async function noteFromHash(hash) {
  const p = new URLSearchParams(String(hash || "").replace(/^#/, "")), enc = p.get("note");
  if (!enc) return;
  let text = null;
  try { text = await noteDecode(enc); } catch {}
  while (!S.bootDone) await sleep(100);
  if (text == null) balloon({ title: "Couldn't open the note link", text: "The link is cut off or damaged. Ask for the whole link again.", icon: "i-notes", ms: 6000 });
  else {
    await notesFlush();
    notesSt.draft = { text, lang: NOTE_LANGS.some(l => l[0] === p.get("l")) ? p.get("l") : "text" };
    const w = open("notes", null);
    w.sel = NOTE_DRAFT;
    await noteShow(w, NOTE_DRAFT, true);
  }
  history.replaceState(null, "", location.pathname + location.search);
}
const noteHash = location.hash; // read now, before anything can change it

/* ---------- notes as a prompt library for Generate ----------
   Notes → Generate: Use as prompt (the selection, or the whole note), a note dragged from the list onto Generate,
   and Prompts… under Generate's prompt. Generate → Notes: Save to Notes… (a new note, or added to the end of one)
   and Cmd+Shift+S. A note drag carries its own type, so Generate's media inputs never mistake it for a file. */
const NOTE_DRAG = "application/x-runway-note";
const NOTE_DRAG_LINK = ":link"; // the unsaved note from a link, in a drag (NOTE_DRAFT holds a NUL)
const noteCache = new Map(); // name → { stamp, text }: previews and drags without reading every file each time
const clipText = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const notePreview = t => clipText(String(t || "").split("\n").map(l => l.trim()).find(Boolean) || "", 48);
// a note's current text: an open editor's (it may not be saved yet), else the file's
async function noteTextOf(key) {
  if (key === NOTE_DRAFT || key === NOTE_DRAG_LINK) return notesSt.draft?.text ?? "";
  for (const w of wins.values()) if (w.kind === "notes" && w.ed?.name === key) return w.ed.text;
  const info = (notesSt.list || []).find(n => n.name === key), stamp = info ? `${info.modified}|${info.size}` : null, hit = noteCache.get(key);
  if (hit && stamp && hit.stamp === stamp) return hit.text;
  const d = await noteGet(key);
  noteCache.set(key, { stamp, text: d.text });
  return d.text;
}
// the notes for a menu, newest first, with their text (null when a file can't be read)
async function notesForMenu(max = 30) {
  await notesLoad();
  if (notesSt.err) throw new Error(`Couldn't load the notes. ${notesSt.err}`);
  const list = [...(notesSt.list || [])].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)).slice(0, max);
  const texts = await Promise.all(list.map(n => noteTextOf(n.name).catch(() => null)));
  return list.map((n, i) => ({ ...n, text: texts[i] }));
}

// Generate's prompt box: promptText, else the first long text field
const genPromptTa = w => $('textarea.gprompt[data-f="promptText"]', w.body) || $("textarea.gprompt", w.body);
// put text in a prompt box at `at`, or over the selection, or over everything (replace). noteEdit keeps Cmd+Z working,
// and its input event updates the form, the character counter (which flags a prompt over the model's limit) and the layout.
function promptInsert(ta, text, { at, replace } = {}) {
  text = String(text || "").trim(); if (!text) return;
  const v = ta.value, s = replace ? 0 : at ?? ta.selectionStart, e = replace ? v.length : at ?? ta.selectionEnd;
  const pre = s > 0 && !/\s/.test(v[s - 1]) ? " " : "", post = e < v.length && !/\s/.test(v[e]) ? " " : "";
  ta.focus({ preventScroll: true });
  noteEdit(ta, s, e, pre + text + post);
  ta.scrollIntoView({ block: "nearest" });
}
// into Generate's prompt; a task without a prompt keeps the text until one with a prompt is picked (genLibBar)
function genTakeText(w, text, how = {}) {
  const ta = w.shell && genPromptTa(w);
  if (!ta) {
    w.promptWait = { text, ...how };
    if (S.CAT) genMsg(w, `${curTask(w)?.label || "This task"} has no prompt. The text goes in when you pick a task that has one.`, true);
    return;
  }
  w.promptWait = null; genMsg(w, null);
  promptInsert(ta, text, how);
}
// open Generate (or bring it up) next to another window, as Activity opens next to Generate
function genBeside(from) {
  if (wins.has("generate")) return open("generate");
  const gw = open("generate");
  if (!from || from.max || from.minimized || gw.max) return gw;
  const d = D(), gap = px(8), wd = gw.wd;
  if (from.x + from.wd + gap + wd <= d.w) gw.x = from.x + from.wd + gap;
  else if (from.x - gap - wd >= 0) gw.x = from.x - gap - wd;
  else if (from.wd + gap + wd <= d.w) { from.x = d.w - wd - gap - from.wd; from.snapped = false; place(from); gw.x = from.x + from.wd + gap; }
  else if (d.w - wd - gap >= minOf(from, d)[0]) { Object.assign(from, { x: 0, wd: d.w - wd - gap, snapped: false }); place(from); gw.x = from.wd + gap; } // narrow the other window
  else gw.x = d.w - wd; // no room: Generate at the right edge
  gw.y = from.y; fit(gw); place(gw); save();
  return gw;
}

/* Notes side */
function noteUseAsPrompt(w) {
  const ed = w.ed, ta = $(".nt-ta", w.body); if (!ed) return;
  const sel = ta && ta.selectionEnd > ta.selectionStart ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : "";
  const text = (sel.trim() ? sel : ed.text).trim();
  if (!text) { w.ntMsg = { text: "This note is empty. Write a prompt in it first.", warn: true }; noteStatus(w); return; }
  genTakeText(genBeside(w), text, { replace: true });
}

/* Generate side: dropping a note */
const isNoteDrag = e => [...(e.dataTransfer?.types || [])].includes(NOTE_DRAG);
const caretAt = (ta, x, y) => { const p = document.caretPositionFromPoint?.(x, y); return p && p.offsetNode === ta ? p.offset : null; };

/* Generate side: Prompts… and Save to Notes… under the prompt */
// called at the end of genFields: adds the two buttons to the prompt's footer, and puts in text that was waiting for a prompt
function genLibBar(w) {
  const ta = genPromptTa(w); if (!ta) return;
  let foot = ta.nextElementSibling?.classList.contains("gtfoot") ? ta.nextElementSibling : null;
  if (!foot) { foot = document.createElement("div"); foot.className = "gtfoot"; ta.after(foot); }
  foot.insertAdjacentHTML("afterbegin", `<span class="gplib">
      <button type="button" class="raised btn-s" data-plib="pick" title="Insert a note from Notes at the caret">Prompts…</button>
      <button type="button" class="raised btn-s" data-plib="save" title="Save the prompt as a new note, or add it to the end of one (Cmd+Shift+S saves a new note)">Save to Notes…</button></span>`);
  if (w.promptWait) { const p = w.promptWait; w.promptWait = null; queueMicrotask(() => { genMsg(w, null); promptInsert(ta, p.text, p); }); }
}
// a new note's name: the prompt's first few words, without characters a file name can't have, then " 2", " 3"… when taken
function promptNoteName(text) {
  const words = text.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, " ").split(/\s+/).filter(Boolean);
  let n = "";
  for (const wd of words.slice(0, 6)) { const next = n ? `${n} ${wd}` : wd; if (next.length > 40) break; n = next; }
  n = (n || (words[0] || "").slice(0, 40)).replace(/^[.\s]+|[.,;:!\s-]+$/g, "") || "Prompt";
  const taken = new Set((notesSt.list || []).map(x => x.name.toLowerCase()));
  for (let i = 1; ; i++) { const name = `${n}${i > 1 ? ` ${i}` : ""}.txt`; if (!taken.has(name.toLowerCase())) return name; }
}
const genPromptText = w => (genPromptTa(w)?.value || "").trim();
function genNoPrompt(w) {
  const ta = genPromptTa(w);
  genMsg(w, ta ? "Write a prompt first, then save it to Notes." : `${curTask(w)?.label || "This task"} has no prompt to save.`);
  ta?.focus();
}
// save the prompt as a new note, or (into) add it to the end of an existing one
async function promptSave(w, into) {
  const text = genPromptText(w); if (!text) { genNoPrompt(w); return; }
  try {
    await notesFlush();
    let info;
    if (into) {
      const old = await noteTextOf(into), neu = old.trim() ? `${old.replace(/\s+$/, "")}\n\n${text}\n` : `${text}\n`;
      info = await api("/api/notes", { name: into, text: neu });
      wins.forEach(nw => { if (nw.kind === "notes" && nw.ed?.name === into) { Object.assign(nw.ed, { text: neu, saved: neu, state: "saved" }); noteFill(nw); } });
    } else {
      await notesLoad();
      for (let tries = 0; !info; tries++) {
        const name = promptNoteName(text);
        try { info = await api("/api/notes", { name, text: `${text}\n`, create: true }); }
        catch (err) { if (tries > 3 || !/already/i.test(err.message)) throw err; await notesLoad(); } // made elsewhere meanwhile: next number
      }
    }
    noteCache.delete(info.name); noteListPut(info);
    genMsg(w, null);
    balloon({ title: `Saved to ${info.name}`, text: clipText(text, 80), icon: "i-notes", ms: 5000, onOpen: () => openNote(info.name) });
  } catch (err) { genMsg(w, `Couldn't save to Notes: ${err.message}`); }
}
async function promptsMenu(w, btn) {
  let list;
  try { list = await notesForMenu(); } catch (err) { genMsg(w, err.message); return; }
  if (!wins.has(w.id) || !btn.isConnected) return;
  const r = btn.getBoundingClientRect();
  showMenu(r.left, r.bottom, [
    ...list.map(n => ({ label: clipText(n.name, 40), sub: n.text == null ? "Couldn't read it" : notePreview(n.text) || "Empty", icon: "i-notes", disabled: !n.text?.trim(),
      act: () => { const ta = genPromptTa(w); if (ta) { genMsg(w, null); promptInsert(ta, n.text); } } })),
    !list.length && { label: "No notes yet", disabled: true },
    { sep: true },
    { label: "Open Notes", hint: "Alt+N", act: () => open("notes", null, btn) },
  ]);
}
async function promptSaveMenu(w, btn) {
  const text = genPromptText(w); if (!text) { genNoPrompt(w); return; }
  let list;
  try { list = await notesForMenu(); } catch (err) { genMsg(w, err.message); return; }
  if (!wins.has(w.id) || !btn.isConnected) return;
  const r = btn.getBoundingClientRect();
  showMenu(r.left, r.bottom, [
    { label: "New note", sub: promptNoteName(text), icon: "i-save", bold: true, hint: "Cmd+Shift+S", act: () => promptSave(w) },
    list.length && { sep: true },
    ...list.map(n => ({ label: `Add to ${clipText(n.name, 36)}`, sub: n.text == null ? "" : notePreview(n.text), icon: "i-notes", act: () => promptSave(w, n.name) })),
  ]);
}

/* ---------- options: accessibility and preferences, saved in this browser ---------- */
const OPT_KEY = "runway-os-options-v1";
const OPT_DEFAULT = { textPx: 0, textSize: "medium", font: "plex", contrast: false, motion: "system", theme: "dark", desk: "", boot: true, clock24: false, termScheme: "dos", balloons: true, sound: false, notify: false };
// color schemes, like Win95's Display Properties → Appearance; the tokens live in index.html (html[data-theme])
const THEMES = [["dark", "Dark"], ["classic", "Classic"], ["storm", "Storm"], ["eggplant", "Eggplant"], ["marine", "Marine"], ["pumpkin", "Pumpkin"]];
const DESKS = [["#0b2e2e", "Teal night"], ["#008080", "Classic teal"], ["#000000", "Black"], ["#10204a", "Navy"], ["#3a1f3d", "Plum"], ["#2b2b2b", "Graphite"]];
const TERMS = [["dos", "DOS gray"], ["green", "Green phosphor"], ["amber", "Amber"], ["blue", "Blue screen"]];
export const calm = () => S.opts.motion === "reduce" || (S.opts.motion === "system" && reduced.matches);

// text sizes that land on whole screen pixels for the pixel font (11 px design size)
function textSizes() {
  const dpr = Math.max(1, Math.round(devicePixelRatio || 1)), steps = dpr >= 2 ? [2, 3, 4] : [1, 2, 3];
  return { small: (11 * steps[0]) / dpr, medium: (11 * steps[1]) / dpr, large: (11 * steps[2]) / dpr, dpr };
}
// the Scale slider for the current font and screen. def is the size applyOptions uses when no size is saved, marked "Medium".
// The outline fonts start at 12 px; the pixel font keeps its sharp sizes, whole multiples of 11 screen pixels.
function tszRange() {
  const hi = textSizes().dpr >= 2;
  if (S.opts.font === "pixel") { const def = hi ? 16.5 : 11; return { min: 10, max: 24, def, marks: hi ? [[11, "Small"], [def, "Medium"], [22, "Large"]] : [[def, "Medium"], [22, "Large"]] }; }
  const def = hi ? 16 : 14;
  return { min: 12, max: 24, def, marks: [[13, "Small"], [def, "Medium"], [18, "Large"], [22, "Larger"]] };
}
function applyOptions() {
  const root = document.documentElement, ts = textSizes(), pixel = S.opts.font === "pixel";
  // on a 1x screen the "medium" pixel size is 22 px, which is too big: keep 11 px unless Large is picked
  let fs = +S.opts.textPx || 0;
  if (!fs) {
    fs = ts[S.opts.textSize] ?? ts.medium;
    if (ts.dpr < 2 && S.opts.textSize === "medium") fs = pixel ? 11 : 13;
    if (!pixel) fs = (ts.dpr >= 2 ? { small: 14, medium: 16, large: 19 } : { small: 12, medium: 14, large: 17 })[S.opts.textSize] || (ts.dpr >= 2 ? 16 : 14);
  }
  // one factor sizes the whole interface: text, bars, buttons, icons, spacing and window geometry
  const was = S.scale;
  S.scale = fs / 11;
  root.style.setProperty("--scale", String(S.scale));
  root.style.setProperty("--fs", fs + "px");
  root.style.setProperty("--fs2", (pixel ? fs * 2 : Math.round(fs * 1.7)) + "px");
  root.style.setProperty("--fsL", (pixel ? Math.max(22, fs) : Math.round(fs * 1.35)) + "px");
  if (S.opts.contrast) root.style.setProperty("--desk", "#000000");
  else if (S.opts.desk) root.style.setProperty("--desk", S.opts.desk);
  else root.style.removeProperty("--desk"); // the theme's own desktop color
  root.dataset.theme = THEMES.some(([k]) => k === S.opts.theme) ? S.opts.theme : "dark";
  root.classList.toggle("smooth", !pixel);
  root.classList.toggle("hyper", S.opts.font === "hyper");
  root.classList.toggle("plex", S.opts.font === "plex");
  root.classList.toggle("dot", S.opts.font === "dot");
  root.classList.toggle("contrast", !!S.opts.contrast);
  root.classList.toggle("calm", calm());
  requestAnimationFrame(() => layoutIcons()); // icon sizes follow Scale
  root.dataset.term = S.opts.termScheme;
  // scale open windows along with the interface, then keep them on screen
  if (was !== S.scale) wins.forEach(w => {
    const k = S.scale / was, sc = g => g && Object.assign(g, { x: Math.round(g.x * k), y: Math.round(g.y * k), wd: Math.round(g.wd * k), ht: Math.round(g.ht * k) });
    sc(w); sc(w.pre); if (w.minW) w.minW = Math.round(w.minW * k);
    fit(w); place(w);
    if (w.kind === "tree") renderWin(w); // the tree is laid out in pixels
  });
  tick();
}
function setOpt(k, v) {
  // the pixel font and the outline fonts have different default sizes, so a chosen size doesn't carry over between them
  if (k === "font" && (v === "pixel") !== (S.opts.font === "pixel")) S.opts.textPx = 0;
  S.opts[k] = v;
  if (!S.resetting) try { localStorage.setItem(OPT_KEY, JSON.stringify(S.opts)); } catch {}
  applyOptions();
  // re-render keeps each panel's scroll (data-keep); give focus back to the control that was used
  const a = document.activeElement, sel = a?.dataset?.opt ? `[data-opt="${a.dataset.opt}"]${a.value && a.type === "radio" ? `[value="${CSS.escape(a.value)}"]` : ""}${a.dataset.val ? `[data-val="${CSS.escape(a.dataset.val)}"]` : ""}` : null;
  const host = a?.closest?.(".window");
  wins.forEach(w => (w.kind === "options" || w.kind === "props") && renderWin(w));
  if (sel && host) $(sel, host)?.focus({ preventScroll: true });
}

// the job-finished chime is a sound made with Runway itself: task ce1c486d-9ec2-49c1-a413-98c42e47333b,
// eleven_text_to_sound_v2, prompt "a single soft chime", 2 s, 2 credits, saved as sounds/chime.mp3.
// A failed or cancelled job plays the low two-note tone instead, so the two never sound alike.
// A fresh Audio each time lets chimes overlap; if the file can't load or play (autoplay blocked
// before the first click or key press), the Web Audio tones play instead.
export function chime(ok = true) {
  if (!ok) { chimeTone(false); return null; }
  const a = new Audio("sounds/chime.mp3");
  a.volume = 0.6;
  a.play().catch(() => chimeTone(true));
  return a;
}
// a short two-note chime made with Web Audio, no sound files needed
function chimeTone(ok = true) {
  try {
    const ac = chime.ac ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = ok ? [880, 1318.5] : [440, 330];
    notes.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.12;
      o.type = "square"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.18);
    });
  } catch {}
}

function tszRead(w, preview) {
  const el = $(".tsz-read", w.body); if (!el) return;
  const applied = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 11;
  const fs = preview ?? applied, dpr = Math.max(1, Math.round(devicePixelRatio || 1));
  const sharp = Math.abs((fs * dpr) / 11 - Math.round((fs * dpr) / 11)) < 1e-6;
  const sl = $(".tsz", w.body), min = sl ? +sl.min : 10, max = sl ? +sl.max : 24, pct = Math.round((fs / 11) * 100);
  el.textContent = `${fs} px text · ${pct}% · ${S.opts.font !== "pixel" ? "smooth font, any size works" : sharp ? "sharp with the pixel font" : `slightly soft with the pixel font. Sharp sizes here: ${[1, 2, 3, 4].map(n => (11 * n) / dpr).filter(x => x >= min && x <= max).join(", ")} px`}${preview != null && preview !== applied ? " · release to apply" : ""}`;
  sl?.setAttribute("aria-valuetext", `${fs} px text, ${pct}%`);
  $$("[data-tsz]", w.body).forEach(b => b.setAttribute("aria-pressed", +b.dataset.tsz === fs));
}
function optionsRender(w) {
  const tab = w.tab && w.tab !== "general" ? w.tab : "access", T = [["access", "Accessibility"], ["look", "Appearance"], ["alerts", "Alerts"], ["spend", "Spending"]];
  const ts = textSizes(), pixel = S.opts.font === "pixel";
  const radio = (k, v, label, hint) => `<label class="opt-radio"><input type="radio" name="o-${k}" data-opt="${k}" value="${esc(v)}" ${String(S.opts[k]) === String(v) ? "checked" : ""}><span>${label}${hint ? ` <span class="muted">${hint}</span>` : ""}</span></label>`;
  const check = (k, label, hint) => `<label class="check opt-check"><input type="checkbox" data-opt="${k}" ${S.opts[k] ? "checked" : ""}><span>${label}${hint ? `<br><span class="muted">${hint}</span>` : ""}</span></label>`;
  const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 11;
  // marks sit under the slider's thumb positions; two marks too close to center both labels share the gap between them
  const R = tszRange(), at = v => (v - R.min) / (R.max - R.min), near = (a, b) => !!b && Math.abs(at(a[0]) - at(b[0])) < 0.15;
  let panel;
  if (tab === "access") panel = `
      <fieldset class="group"><legend>Scale</legend>
        <div class="tsize">
          <span class="tsz-a" aria-hidden="true">A</span>
          <input type="range" class="tsz" min="${R.min}" max="${R.max}" step="0.5" value="${cur}" list="tsz-ticks" aria-label="Scale, as text size in pixels">
          <span class="tsz-b" aria-hidden="true">A</span>
          <span></span>
          <div class="tsz-marks">${R.marks.map((m, i, a) => `<button class="linkish${near(m, a[i + 1]) ? " tsz-end" : near(m, a[i - 1]) ? " tsz-start" : ""}" data-tsz="${m[0]}" style="left:calc(5.5 * var(--u) + ${at(m[0])} * (100% - 11 * var(--u)))">${m[1]}</button>`).join("")}</div>
          <datalist id="tsz-ticks">${R.marks.map(([v]) => `<option value="${v}"></option>`).join("")}</datalist>
        </div>
        <div class="tsz-read muted"></div>
      </fieldset>
      <fieldset class="group"><legend>Font</legend>
        ${radio("font", "plex", "IBM Plex Sans", "clean and even at small sizes")}
        ${radio("font", "dot", "DotGothic16", "pixel look, drawn as outlines so it stays sharp at any size")}
        ${radio("font", "smooth", "Tahoma", "the Windows 98/2000 system font")}
        ${radio("font", "hyper", "Atkinson Hyperlegible", "designed for low-vision readability, the easiest to read")}
        ${radio("font", "pixel", "Pixel font", "MS Sans Serif, sharp only at the marked sizes")}
      </fieldset>
      <fieldset class="group"><legend>Display</legend>
        ${check("contrast", "High contrast", "Black background, white text, yellow highlights")}
        <div class="opt-sub">Animations</div>
        ${radio("motion", "system", "Follow macOS", reduced.matches ? "Reduce motion is on" : "Reduce motion is off")}
        ${radio("motion", "reduce", "Reduce", "No window animations, blinking or marquees")}
        ${radio("motion", "full", "Full")}
      </fieldset>`;
  else if (tab === "look") panel = `
      <fieldset class="group"><legend>Theme</legend>
        <div class="swatches">${THEMES.map(([k, n]) => `<button class="swatch${S.opts.theme === k ? " on" : ""}" data-opt="theme" data-val="${k}" aria-pressed="${S.opts.theme === k}"><span class="tprev" data-theme="${k}" aria-hidden="true"><span class="tp-win raised"><span class="tp-title"></span><span class="tp-btn raised"></span></span></span><span>${n}</span></button>`).join("")}</div>
      </fieldset>
      <fieldset class="group"><legend>Desktop color</legend>
        <div class="swatches"><button class="swatch${!S.opts.desk ? " on" : ""}" data-opt="desk" data-val="" aria-pressed="${!S.opts.desk}"><i class="tdesk"></i><span>Theme default</span></button>${DESKS.map(([c, n]) => `<button class="swatch${S.opts.desk === c ? " on" : ""}" data-opt="desk" data-val="${c}" title="${n}" aria-label="${n}" aria-pressed="${S.opts.desk === c}"><i style="background:${c}"></i><span>${n}</span></button>`).join("")}</div>
      </fieldset>
      <fieldset class="group"><legend>Startup</legend>
        ${check("boot", "Show boot screen when the page loads")}
      </fieldset>
      <fieldset class="group"><legend>Clock</legend>
        ${radio("clock24", "false", "12-hour", new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }))}
        ${radio("clock24", "true", "24-hour", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }))}
      </fieldset>
      <fieldset class="group"><legend>Terminal colors</legend>
        ${TERMS.map(([v, n]) => radio("termScheme", v, n)).join("")}
      </fieldset>`;
  else if (tab === "spend") panel = spendPanel();
  else panel = `
      <fieldset class="group"><legend>When a job finishes</legend>
        ${check("balloons", "Show a balloon above the clock")}
        ${check("sound", "Play a chime")} <button class="raised btn-s opt-test" data-chime>Play</button>
        ${check("notify", "macOS notification while this tab is in the background", "Your browser asks for permission the first time.")}
        ${S.opts.notify && "Notification" in window && Notification.permission === "denied" ? '<div class="gmsg">The browser blocks notifications for this page. Allow them in the browser\'s site settings.</div>' : ""}
      </fieldset>`;
  w.body.innerHTML = sheetHTML(T, tab, panel, '<button class="raised btn-s" data-opt-reset>Restore defaults</button><span class="grow"></span>');
  sheetKeys(w);
  tszRead(w);
  if (!w.optBound) {
    w.optBound = true;
    // the default size is saved as no size, so it keeps following the font and the screen; the re-render keeps keyboard focus on the slider or mark
    const tszSet = (v, sel) => {
      const had = document.activeElement?.matches?.(sel);
      setOpt("textPx", v === tszRange().def ? 0 : v);
      if (had) $(sel, w.body)?.focus({ preventScroll: true });
    };
    // drag: resize live without rebuilding the window; release: save
    // dragging only previews the value; the scale applies on release, so the slider doesn't move under the pointer
    w.body.addEventListener("input", e => { if (e.target.matches(".tsz")) tszRead(w, +e.target.value); });
    w.body.addEventListener("change", e => { if (e.target.matches(".tsz")) tszSet(+e.target.value, ".tsz"); });
    w.body.addEventListener("click", e => { const t = e.target.closest("[data-tsz]"); if (t) tszSet(+t.dataset.tsz, `[data-tsz="${t.dataset.tsz}"]`); });
    w.body.addEventListener("change", e => {
      const el = e.target.closest("[data-opt]"); if (!el) return;
      const k = el.dataset.opt;
      if (el.type === "checkbox") {
        if (k === "notify" && el.checked && "Notification" in window && Notification.permission === "default") Notification.requestPermission().then(() => renderWin(w));
        setOpt(k, el.checked);
      } else setOpt(k, el.value === "true" ? true : el.value === "false" ? false : el.value);
    });
    w.body.addEventListener("click", e => {
      const sw = e.target.closest("button[data-opt]"); if (sw) { setOpt(sw.dataset.opt, sw.dataset.val); return; }
      if (e.target.closest("[data-chime]")) chime();
      // keep the saved-options migration flags (fontV2, sizeV5…), or the next page load would run those migrations again on the new choices
      if (e.target.closest("[data-opt-reset]")) { S.opts = { ...OPT_DEFAULT, ...Object.fromEntries(Object.entries(S.opts).filter(([k]) => /V\d+$/.test(k))) }; setOpt("textSize", OPT_DEFAULT.textSize); }
    });
  }
}

/* ---------- usage: credits spent per day and model (whole org, from Runway) and per task (your jobs) ---------- */
// the eight colors are CSS variables (--uc1..--uc8 in index.html), so a theme switch recolors the chart live
const USAGE_COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map(i => `var(--uc${i})`);
const usageCache = {};
async function usageLoad(days, force) {
  const hit = usageCache[days];
  if (hit && !force && Date.now() - hit.at < 300000) return hit.data;
  const res = await fetch(`/api/usage?days=${days}`, { cache: "no-store" });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `The server answered ${res.status}.`);
  usageCache[days] = { at: Date.now(), data: out };
  return out;
}
// totals per model and per day, with the top models kept and the rest grouped as "other"
function usageSummary(u, top = 7) {
  const byModel = {}, days = [];
  const start = new Date(u.startDate + "T00:00:00Z"), end = new Date(u.beforeDate + "T00:00:00Z");
  const perDay = Object.fromEntries((u.results || []).map(r => [r.date, r.usedCredits || []]));
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10), items = perDay[k] || [];
    items.forEach(i => { byModel[i.model] = (byModel[i.model] || 0) + i.amount; });
    days.push({ date: k, items });
  }
  const ranked = Object.entries(byModel).sort((a, b) => b[1] - a[1]);
  const keep = ranked.slice(0, top).map(([m]) => m), total = ranked.reduce((s, [, v]) => s + v, 0);
  return { days, ranked, keep, total, color: m => USAGE_COLORS[keep.indexOf(m)] ?? USAGE_COLORS[7] };
}
const usageMD = date => date.slice(5).replace("-", "/"); // 2026-11-14 → 11/14, as on the chart's axis
const usageLong = date => new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
// the model filter: one model, or "other" for every model past the top seven
const usageIn = (sum, f, m) => !f || (f === "other" ? !sum.keep.includes(m) : m === f);
const usageName = f => (f === "other" ? "other models" : f);
// stacked bars drawn at the box's real pixel size (W × H), so labels stay at the text size; one focusable column per day
function usageChart(sum, { W, H, f, sel, at }) {
  const root = getComputedStyle(document.documentElement), fs = parseFloat(root.getPropertyValue("--fs")) || 11;
  const ctx = (usageChart.ctx ||= document.createElement("canvas").getContext("2d"));
  ctx.font = `${fs}px ${root.getPropertyValue("--ui")}`;
  const tw = s => Math.ceil(ctx.measureText(s).width) + 2;
  const n = sum.days.length;
  const totals = sum.days.map(d => d.items.reduce((s, i) => s + (usageIn(sum, f, i.model) ? i.amount : 0), 0)), max = Math.max(1, ...totals);
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
  const ticks = [0, nice / 2, nice];
  const padL = Math.max(...ticks.map(v => tw(fmt(v)))) + px(10), padR = px(4), padT = Math.ceil(fs * 0.6) + px(4), padB = Math.ceil(fs * 1.1) + px(8);
  const base = H - padB, bw = (W - padL - padR) / n, barW = Math.max(1, Math.min(bw * 0.7, px(56)));
  const Y = v => base - (v / nice) * (base - padT);
  const order = f === "other" ? ["other"] : f ? [f] : [...sum.keep, "other"];
  const fi = sum.days.findIndex(d => d.date === (at || sel)), focusAt = fi >= 0 ? fi : n - 1; // the one day in the tab order
  let cols = "";
  sum.days.forEach((d, i) => {
    const groups = {}, x0 = padL + i * bw;
    d.items.forEach(it => { if (!usageIn(sum, f, it.model)) return; const k = f && f !== "other" ? f : sum.keep.includes(it.model) ? it.model : "other"; groups[k] = (groups[k] || 0) + it.amount; });
    let y = base, bars = "";
    order.forEach(k => {
      const v = groups[k]; if (!v) return;
      const h = base - Y(v);
      bars += `<rect x="${(x0 + (bw - barW) / 2).toFixed(1)}" y="${(y - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" style="fill:${sum.color(k)}"><title>${d.date} · ${esc(k)}: ${fmt(v)} credits</title></rect>`;
      y -= h;
    });
    cols += `<g class="uday" role="button" tabindex="${i === focusAt ? 0 : -1}" data-date="${d.date}" aria-pressed="${d.date === sel}" aria-label="${usageLong(d.date)}: ${fmt(totals[i])} credits${f ? ` on ${esc(usageName(f))}` : ""}"><rect class="uhit" x="${(x0 + 0.5).toFixed(1)}" y="${padT - 0.5}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${base - padT + 1}"/>${bars}</g>`;
  });
  const grid = ticks.map(v => { const y = Math.round(Y(v)) + 0.5; return `<line class="ugrid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/><text class="ulab" x="${padL - px(6)}" y="${y}" dy="0.35em" text-anchor="end">${fmt(v)}</text>`; }).join("");
  // x labels: every k-th day counted back from the last, k wide enough for one label plus a gap; the last one is
  // right-aligned so it stays inside, and a label that would touch the one to its right is left out
  const gap = Math.max(px(8), fs * 0.6), need = (Math.max(...sum.days.map(d => tw(usageMD(d.date)))) + gap) / bw;
  const every = [1, 2, 3, 7, 14, 28].find(k => k >= need) || Math.ceil(need / 7) * 7, yx = H - Math.ceil(fs * 0.3) - px(2);
  let xl = "", next = Infinity;
  for (let i = n - 1; i >= 0; i -= every) {
    const t = usageMD(sum.days[i].date), w = tw(t), c = padL + (i + 0.5) * bw;
    const r = Math.min(W - 1, Math.max(w, c + w / 2)), l = r - w;
    if (r + gap > next) continue;
    next = l;
    xl = (i === n - 1 ? `<text class="ulab" x="${r.toFixed(1)}" y="${yx}" text-anchor="end">${t}</text>`
      : `<text class="ulab" x="${((l + r) / 2).toFixed(1)}" y="${yx}" text-anchor="middle">${t}</text>`) + xl;
  }
  const sumTot = totals.reduce((a, b) => a + b, 0), pk = totals.indexOf(Math.max(...totals)), top = sum.ranked[0];
  const label = f
    ? `Credits spent per day on ${usageName(f)}, last ${n} days: ${fmt(sumTot)} in total, peak ${fmt(totals[pk])} on ${usageMD(sum.days[pk].date)}. Filtered to ${usageName(f)}; the full numbers are in the By model table. Select a day for its breakdown by model.`
    : `Credits spent per day, last ${n} days: ${fmt(sumTot)} in total, peak ${fmt(totals[pk])} on ${usageMD(sum.days[pk].date)}, top model ${top[0]} (${Math.round((top[1] / sum.total) * 100)}%). The full numbers are in the By model table. Select a day for its breakdown by model.`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" role="group" aria-label="${esc(label)}"><g aria-hidden="true">${grid}</g><g>${cols}</g><g aria-hidden="true">${xl}</g></svg>`;
}
// redraw only the chart, at the box's current size (window resized, maximized, scaled)
function usageDraw(w) {
  const sum = w.usum, host = $(".uchart", w.body); if (!sum || !host) return;
  const W = host.clientWidth, H = host.clientHeight; if (!W || !H) return; // minimized: draw when it's shown again
  const a = document.activeElement, back = host.contains(a) ? a.dataset.date : null;
  w.usize = `${W}x${H}x${S.scale}`;
  host.innerHTML = usageChart(sum, { W, H, f: w.umodel, sel: w.uday, at: back });
  if (back) $(`[data-date="${back}"]`, host)?.focus();
}
// apply the model filter and the inspected day: pressed states, the "Showing" line, the day's breakdown, the chart
function usageView(w) {
  const sum = w.usum, f = w.umodel; if (!sum) return;
  $$("[data-um]", w.body).forEach(b => b.setAttribute("aria-pressed", b.dataset.um === f));
  const fl = $(".ufilter", w.body), ins = $(".uinspect", w.body);
  if (fl) fl.innerHTML = f ? `<span>Showing ${esc(usageName(f))} · ${fmt(sum.ranked.reduce((s, [m, v]) => s + (usageIn(sum, f, m) ? v : 0), 0))} credits</span><button class="raised btn-s" data-u="clear">Clear filter</button>` : "";
  const d = w.uday && sum.days.find(x => x.date === w.uday);
  if (ins) {
    const tot = d ? d.items.reduce((s, i) => s + i.amount, 0) : 0;
    ins.innerHTML = d ? `<div class="ubar"><span>${usageLong(d.date)} · ${fmt(tot)} credits</span><button class="raised btn-s" data-u="day">Close</button></div>
        <div class="utable">${[...d.items].sort((a, b) => b.amount - a.amount).map(i => `<div><span><i style="background:${sum.color(i.model)}"></i>${esc(i.model)}</span><b>${fmt(i.amount)}</b><small>${tot ? Math.round((i.amount / tot) * 100) : 0}%</small></div>`).join("") || '<div class="muted">No credits spent on this day.</div>'}</div>` : "";
  }
  usageDraw(w);
}
function usageCSV(u) {
  const rows = [["date", "model", "credits"]];
  (u.results || []).forEach(r => (r.usedCredits || []).forEach(i => rows.push([r.date, i.model, i.amount])));
  const blob = new Blob([rows.map(r => r.join(",")).join("\n") + "\n"], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `runway-usage_${u.startDate}_to_${u.beforeDate}.csv` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// your own jobs from runs.json, grouped by task, for the same range
function usageMine(days) {
  const since = Date.now() - days * 86400000, by = {};
  S.data.runs.filter(r => r.credits != null && createdMs(r) >= since).forEach(r => {
    const k = r.task || (r.type === "image" ? "Text to image" : r.parent ? "Image to video" : "Text to video");
    (by[k] ||= { credits: 0, jobs: 0 }); by[k].credits += r.credits; by[k].jobs++;
  });
  return Object.entries(by).sort((a, b) => b[1].credits - a[1].credits);
}

async function usageRender(w, force) {
  w.days ||= 30;
  if (!w.shell) {
    w.shell = true;
    w.body.innerHTML = `
        <div class="toolbar"><div class="seg-tabs" role="group" aria-label="Range">${[7, 30, 90].map(d => `<button class="raised" data-days="${d}">${d} days</button>`).join("")}</div>
          <span class="grow"></span><button class="raised btn-s" data-u="refresh">Refresh</button><button class="raised btn-s" data-u="csv"><svg class="ico" aria-hidden="true"><use href="#i-save"/></svg><span>Export CSV</span></button></div>
        <div class="ubody" data-keep="usage"></div>
        <div class="statusbar"><span class="sunken seg grow"></span></div>`;
    w.body.addEventListener("click", e => {
      const d = e.target.closest("[data-days]"); if (d) { w.days = +d.dataset.days; retitle(w); renderTasks(); usageRender(w); save(); return; }
      // view filters only: a model (legend or By model row) and a day (its bar); no refetch, the CSV stays complete
      const m = e.target.closest("[data-um]"); if (m) { w.umodel = w.umodel === m.dataset.um ? null : m.dataset.um; usageView(w); return; }
      const g = e.target.closest(".uday"); if (g) { w.uday = w.uday === g.dataset.date ? null : g.dataset.date; usageView(w); return; }
      const b = e.target.closest("[data-u]"); if (!b) return;
      if (b.dataset.u === "refresh") usageRender(w, true);
      if (b.dataset.u === "csv" && usageCache[w.days]) usageCSV(usageCache[w.days].data);
      if (b.dataset.u === "clear") { const was = w.umodel; w.umodel = null; usageView(w); $$("[data-um]", w.body).find(x => x.dataset.um === was)?.focus(); }
      if (b.dataset.u === "day") { const was = w.uday; w.uday = null; usageView(w); $(`.uday[data-date="${was}"]`, w.body)?.focus(); }
    });
    // the day columns: one tab stop, arrows and Home/End move between days, Enter or Space shows the day
    w.body.addEventListener("keydown", e => {
      const g = e.target.closest?.(".uday"); if (!g) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); w.uday = w.uday === g.dataset.date ? null : g.dataset.date; usageView(w); return; }
      const all = $$(".uday", w.body), i = all.indexOf(g), j = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: all.length - 1 }[e.key];
      if (j == null) return;
      e.preventDefault();
      const t = all[clampN(j, 0, all.length - 1)]; g.tabIndex = -1; t.tabIndex = 0; t.focus();
    });
  }
  $$("[data-days]", w.body).forEach(b => b.setAttribute("aria-pressed", +b.dataset.days === w.days));
  const box = $(".ubody", w.body), seg = $(".statusbar .seg", w.body), days = w.days;
  w.uro?.disconnect(); w.uro = null; // the chart below is about to be replaced
  if (!usageCache[days] || force) {
    if (box.querySelector(".ucols")) seg.textContent = `Loading ${days} days…`; // keep the current chart on screen until the new data arrives
    else { box.innerHTML = `<div class="empty-list">Asking Runway for ${days} days of usage…</div>`; seg.textContent = "Loading"; }
  }
  let u;
  try { u = await usageLoad(days, force); }
  catch (err) { if (w.days === days) { box.innerHTML = `<div class="empty-list">${esc(err.message)}</div>`; seg.textContent = "Couldn't load usage"; } return; }
  if (w.days !== days || !wins.has(w.id)) return;
  const sum = usageSummary(u), mine = usageMine(days), mineTotal = mine.reduce((s, [, v]) => s + v.credits, 0);
  // keep the model filter and the inspected day when the new range still has them
  w.usum = sum;
  if (w.umodel && !(w.umodel === "other" ? sum.ranked.length > sum.keep.length : sum.ranked.some(([m]) => m === w.umodel))) w.umodel = null;
  if (w.uday && !sum.days.some(d => d.date === w.uday)) w.uday = null;
  box.innerHTML = `
      <fieldset class="group"><legend>Whole org · last ${days} days · ${fmt(sum.total)} credits</legend>
        ${sum.total ? '<div class="ufilter ubar" aria-live="polite"></div><div class="uchart"></div>' : '<div class="empty-list">No credits spent in this range.</div>'}
        ${sum.total ? `<div class="ulegend">${[...sum.keep, ...(sum.ranked.length > sum.keep.length ? ["other"] : [])].map(m => `<button data-um="${esc(m)}" aria-pressed="false"><i style="background:${sum.color(m)}"></i>${esc(m)}</button>`).join("")}</div><div class="uinspect" aria-live="polite"></div>` : ""}
      </fieldset>
      <div class="ucols">
        <fieldset class="group"><legend>By model</legend>
          <div class="utable">${sum.ranked.map(([m, v]) => `<button data-um="${esc(m)}" aria-pressed="false"><span><i style="background:${sum.color(m)}"></i>${esc(m)}</span><b>${fmt(v)}</b><small>${sum.total ? Math.round((v / sum.total) * 100) : 0}%</small></button>`).join("") || '<div class="muted">Nothing yet.</div>'}</div>
        </fieldset>
        <fieldset class="group"><legend>Your jobs by task · ${fmt(mineTotal)} credits</legend>
          <div class="utable">${mine.map(([k, v]) => `<div><span>${esc(k)}</span><b>${fmt(v.credits)}</b><small>${v.jobs} job${v.jobs === 1 ? "" : "s"}</small></div>`).join("") || '<div class="muted">No finished jobs in this range.</div>'}</div>
          <p class="muted unote">From runs.json: jobs made from this dashboard or logged by Claude. The org total above includes everyone using this Runway account.</p>
        </fieldset>
      </div>`;
  usageView(w);
  // redraw only the chart, without refetching, once the window stops resizing; let go when it's replaced or closed
  const host = $(".uchart", box);
  if (host) {
    let t = 0;
    const ro = w.uro = new ResizeObserver(() => {
      clearTimeout(t);
      if (!host.isConnected || !wins.has(w.id)) { ro.disconnect(); if (w.uro === ro) w.uro = null; return; }
      t = setTimeout(() => { if (host.isConnected && `${host.clientWidth}x${host.clientHeight}x${S.scale}` !== w.usize) usageDraw(w); }, 120);
    });
    ro.observe(host);
  }
  seg.textContent = `${u.startDate} to ${new Date(new Date(u.beforeDate) - 86400000).toISOString().slice(0, 10)} (UTC) · fetched ${new Date(u.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/* ---------- Runway API key ---------- */
function keyRender(w) {
  const where = S.data.keySource === "file" ? "saved in .runway_key" : S.data.keySource === "env" ? "from the RUNWAYML_API_SECRET variable" : "";
  const st = !S.loaded ? { cls: "", text: "Checking…" }
    : !S.data.live ? { cls: "off", text: "No key. The dashboard can't sync jobs, check the balance or generate." }
    : S.data.error ? { cls: "warn", text: `Key ending ${S.data.keyHint || "…"} ${where}. Runway answers: ${S.data.error}` }
    : { cls: "on", text: `Connected. Key ending ${S.data.keyHint || "…"}, ${where}.` };
  if (!w.shell) {
    w.shell = true;
    w.body.innerHTML = `
        <form class="keyf" novalidate autocomplete="off">
          <div class="kstat"><svg class="kico"><use href="#i-key"/></svg><div><b class="live kst"></b><div class="muted kbal"></div></div></div>
          <fieldset class="group"><legend class="kleg"></legend>
            <div class="krow"><input class="field kin" type="password" placeholder="key_…" aria-label="Runway API key" spellcheck="false" autocapitalize="off" autocomplete="off">
              <button type="button" class="raised btn-s kshow" aria-pressed="false">${icoLabel("i-eye", "Show")}</button></div>
            <div class="krow end"><button type="submit" class="raised btn-go b-default ksave">${icoLabel("i-save", "Check and save")}</button></div>
          </fieldset>
          <div class="gmsg kmsg" role="alert" hidden></div>
          <p class="muted knote">Create a key at <a href="https://dev.runwayml.com/" target="_blank" rel="noopener">dev.runwayml.com</a> under API Keys. The dashboard checks it with Runway, then saves it to <code>.runway_key</code> in the Runway folder, readable only by your Mac account. It's never shown again here.</p>
          <div class="krow end"><button type="button" class="raised btn-s b-danger krm" hidden>${icoLabel("i-remove", "Remove saved key")}</button></div>
        </form>`;
    const form = $(".keyf", w.body), inp = $(".kin", form), show = $(".kshow", form), rm = $(".krm", form), showL = $("span", show), rmL = $("span", rm);
    show.addEventListener("click", () => { const on = inp.type === "password"; inp.type = on ? "text" : "password"; show.setAttribute("aria-pressed", on); showL.textContent = on ? "Hide" : "Show"; });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const key = inp.value.trim();
      if (!key) { keyMsg(w, "Paste a key first."); return; }
      const btn = $(".ksave", form); btn.disabled = true; $("span", btn).textContent = "Checking…"; keyMsg(w, null);
      const out = await keyPost({ key });
      btn.disabled = false; $("span", btn).textContent = "Check and save";
      if (out.error) { keyMsg(w, out.error); return; }
      inp.value = ""; inp.type = "password"; showL.textContent = "Show"; show.setAttribute("aria-pressed", "false");
      balloon({ title: "Key saved", text: out.balance != null ? `Runway accepted it. ${fmt(out.balance)} credits on this org.` : "Runway accepted it.", icon: "i-key", ms: 5000 });
      poll();
    });
    let armed = 0;
    rm.addEventListener("click", async () => {
      if (Date.now() - armed > 3000) { armed = Date.now(); rmL.textContent = "Click again to remove"; setTimeout(() => { rmL.textContent = "Remove saved key"; }, 3000); return; }
      const out = await keyPost({ remove: true });
      if (out.error) { keyMsg(w, out.error); return; }
      balloon({ title: "Key removed", text: ".runway_key was deleted.", icon: "i-key", ms: 4000 });
      poll();
    });
  }
  const kst = $(".kst", w.body);
  kst.className = `live kst ${st.cls}`; kst.textContent = st.text;
  $(".kbal", w.body).textContent = S.data.live && S.data.balance != null ? `${fmt(S.data.balance)} credits on this org` : "";
  $(".kleg", w.body).textContent = S.data.live ? "Replace key" : "Add key";
  $(".krm", w.body).hidden = S.data.keySource !== "file";
}
const keyPost = body => api("/api/key", body).catch(err => ({ error: err.message }));
function keyMsg(w, text) { const m = $(".kmsg", w.body); if (m) { m.hidden = !text; m.textContent = text || ""; } }
function compare(ids, src) {
  ids = [...new Set(ids)].filter(id => runOf(id));
  if (ids.length < 2) return null;
  if (ids.length > CMP_MAX) { balloon({ title: "Compare", text: `Showing the first ${CMP_MAX} of ${ids.length} files.`, icon: "i-compare", ms: 5000 }); ids = ids.slice(0, CMP_MAX); }
  return open("compare", ids.join(","), src);
}
function compareSel(w, src) {
  if (compare(selIds(w), src)) return;
  balloon({ title: "Compare", text: "Pick two or more first: Cmd+click or Shift+click them.", icon: "i-compare", ms: 5000 });
}
// job menu entries: the selection, the files of a multi-output job, the job and its source, the jobs made from the same source
function cmpMenu(r, src) {
  const w = src && winOf(src), ids = w && MULTI.has(w.kind) && isSel(w, r.taskId) ? selIds(w) : [];
  const base = cmpBase(r.taskId), job = runOf(base), files = job ? filesOf(job) : [];
  const parent = r.parent ? runOf(r.parent) : null;
  const sibs = r.parent ? S.data.runs.filter(x => x.parent && cmpBase(x.parent) === cmpBase(r.parent) && x.asset).sort((a, b) => createdMs(a) - createdMs(b)) : [];
  return [
    ids.length > 1 && { label: `Compare (${ids.length})`, icon: "i-compare", hint: "Alt+C", act: () => compare(ids, src) },
    files.length > 1 && { label: `Compare outputs (${files.length})`, icon: "i-compare", act: () => compare(files.map((_, i) => (i ? `${base}~${i + 1}` : base)), src) },
    parent?.asset && r.asset && { label: "Compare with source", icon: "i-compare", act: () => compare([parent.taskId, r.taskId], src) },
    sibs.length > 1 && { label: `Compare with siblings (${sibs.length})`, icon: "i-compare", act: () => compare(sibs.map(x => x.taskId), src) },
  ];
}

// the Compare window: arg is the item ids joined by commas ("taskId" or "taskId~n"); w.cmp holds its options
export const cmpIds = arg => [...new Set(String(arg || "").split(",").filter(Boolean))];
const cmpOpts = w => (w.cmp ||= { mode: "side", sync: true, actual: false, at: 0.5, swap: false });
function cmpItems(w) {
  const ids = cmpIds(w.arg);
  if (cmpOpts(w).swap && ids.length === 2) ids.reverse();
  return ids.map((id, i) => ({ id, r: runOf(id), letter: i < 26 ? String.fromCharCode(65 + i) : String(i + 1) }));
}
// "diff" when the known values don't all match, "same" when they do, "" with fewer than two
const diffCls = vals => { const k = vals.filter(v => v != null); return k.length < 2 ? "" : k.every(v => v === k[0]) ? "same" : "diff"; };
function cmpInfo(w, items) {
  const rs = items.map(x => x.r), live = rs.filter(Boolean);
  const cls = get => diffCls(rs.map(r => (r ? get(r) : null)));
  const pkeys = [...new Set(live.flatMap(r => Object.keys(r.params || {}).filter(k => k !== "promptText")))];
  const pval = (r, k) => { const v = r.params?.[k]; return v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v); };
  const words = s => new Set(String(s || "").toLowerCase().match(/[\p{L}\p{N}']+/gu) || []);
  const sets = rs.map(r => (r ? words(r.prompt) : null));
  const size = x => (x.r?.asset ? w.sizes[x.id] ?? null : null);
  const C = {
    status: cls(r => statusInfo(r).label), type: cls(r => r.type), model: cls(r => r.model), settings: cls(r => r.settings || ""),
    credits: cls(r => costOf(r)), parent: cls(r => (r.parent ? cmpBase(r.parent) : "")), prompt: cls(r => r.prompt || ""),
    size: diffCls(items.map(size)), params: Object.fromEntries(pkeys.map(k => [k, cls(r => pval(r, k))])),
  };
  const showStatus = live.some(r => r.status !== "succeeded"), showParent = live.some(r => r.parent), showSize = live.some(r => r.asset);
  return items.map((x, i) => {
    const r = x.r;
    if (!r) return `<p class="muted">This job is no longer in runs.json.</p>`;
    const files = filesOf(runOf(cmpBase(r.taskId)) || r).length, parent = r.parent ? runOf(r.parent) : null;
    const prompt = C.prompt !== "diff" ? esc(r.prompt) : String(r.prompt || "").split(/([\p{L}\p{N}']+)/u)
      .map((t, k) => (k % 2 && sets.some((s, j) => s && j !== i && !s.has(t.toLowerCase())) ? `<b>${esc(t)}</b>` : esc(t))).join("");
    const rows = [
      showStatus && ["Status", C.status, statusHTML(r, false)],
      ["Type", C.type, esc(cap(r.type))],
      ["Model", C.model, esc(r.model)],
      ["Settings", C.settings, esc(r.settings || "—")],
      pkeys.length && ["Parameters", "", pkeys.map(k => `<span class="${C.params[k]}">${esc(k)} ${esc(pval(r, k))}</span>`).join("<br>")],
      showSize && ["Size", C.size, esc(size(x) ?? "—")],
      ["Credits", C.credits, `${costHTML(r)}${files > 1 ? ` <span class="muted">for all ${files} files</span>` : ""}`],
      ["Task ID", "", `<code>${esc(r._of || r.taskId)}</code>${files > 1 ? ` <span class="muted">file ${r._n || 1} of ${files}</span>` : ""}`],
      ["Created", "", r.createdAt ? esc(absTime(tOf(r.createdAt))) : esc(r.date || "—")],
      showParent && ["Made from", C.parent, parent ? esc(nameOf(parent)) : r.parent ? `<code>${esc(cmpBase(r.parent).slice(0, 8))}</code>` : "—"],
    ].filter(Boolean);
    return `<dl class="cmp-dl">${rows.map(([k, c, v]) => `<dt>${k}</dt><dd class="${c}">${v}</dd>`).join("")}</dl>
        <div class="plabel">Prompt</div><div class="promptbox sunken cmp-prompt ${C.prompt}">${prompt || '<span class="muted">No prompt</span>'}</div>`;
  });
}
function cmpFrameHTML(x, o) {
  const r = x.r, id = esc(x.id);
  if (!r) return `<div class="cmp-frame sunken none">This job is no longer in runs.json.</div>`;
  if (!r.asset) return `<div class="cmp-frame sunken none"><span><svg class="ico big" aria-hidden="true"><use href="#${typeIcon(r.type)}"/></svg>${ACTIVE.has(r.status) ? "The file shows here when the job finishes." : "No file"}</span></div>`;
  const src = encodeURI(r.asset);
  if (r.type === "audio") return `<div class="cmp-frame sunken audio" data-id="${id}"><svg class="aud-ico" aria-hidden="true"><use href="#i-audio"/></svg><audio src="${src}" controls preload="metadata" data-size-of="${id}"></audio></div>`;
  if (r.type === "video") return `<div class="cmp-frame sunken checker" data-id="${id}" draggable="true"><video src="${src}" poster="${thumbOf(r)}" controls muted playsinline preload="auto"${o.sync ? "" : " loop"} data-size-of="${id}"></video></div>`;
  return `<div class="cmp-frame sunken checker${o.actual ? " actual" : ""}" data-id="${id}"${o.actual ? "" : ' draggable="true"'} title="${o.actual ? "Drag to look around: all the images follow" : ""}"><img src="${src}" alt="${esc(r.prompt)}" draggable="false" data-size-of="${id}"></div>`;
}
const cmpColHTML = (w, x, frame) => `
    <div class="cmp-col" data-col="${esc(x.id)}">
      <div class="cmp-head" data-id="${esc(x.id)}"${x.r?.asset ? ' draggable="true"' : ""} title="${esc(x.r?.prompt || "")}"><b class="cmp-letter">${x.letter}</b><span class="nm1">${esc(x.r ? nameOf(x.r) : x.id)}</span></div>
      ${frame ? cmpFrameHTML(x, cmpOpts(w)) : ""}
      <div class="cmp-info"></div>
    </div>`;
function cmpWipeHTML(w, [a, b]) {
  const o = cmpOpts(w), pct = Math.round(o.at * 100);
  return `<div class="cmp-wipe sunken checker${o.actual ? " actual" : ""}">
      <div class="cw-scroll"><div class="cw-canvas"><img class="cw-a" src="${encodeURI(a.r.asset)}" alt="${esc(a.r.prompt)}" draggable="false" data-size-of="${esc(a.id)}"><img class="cw-b" src="${encodeURI(b.r.asset)}" alt="${esc(b.r.prompt)}" draggable="false" data-size-of="${esc(b.id)}"></div></div>
      <span class="cw-tag a">A · ${esc(nameOf(a.r))}</span><span class="cw-tag b">B · ${esc(nameOf(b.r))}</span>
      <div class="cw-line" role="slider" tabindex="0" aria-label="Wipe divider, A on the left and B on the right" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" style="left:${o.at * 100}%"><span class="cw-grip raised"></span></div>
    </div>`;
}

function cmpRender(w) {
  const o = cmpOpts(w), items = cmpItems(w), live = items.filter(x => x.r), shown = items.filter(x => x.r?.asset);
  const imgs = shown.filter(x => x.r.type === "image"), media = shown.filter(x => x.r.type !== "image");
  const canWipe = items.length === 2 && imgs.length === 2, wipe = canWipe && o.mode === "wipe";
  const n = items.length, cols = n <= 4 ? Math.max(1, n) : n <= 6 ? 3 : 4;
  if (!w.shell) {
    w.shell = true; w.sizes = {};
    w.body.innerHTML = `<div class="toolbar cmp-bar"></div><div class="cmp-main" data-keep="cmp"></div>
        <div class="statusbar"><span class="sunken seg grow"></span><span class="sunken seg"></span><span class="sunken seg"></span></div>`;
    cmpBind(w);
  }
  morph($(".cmp-bar", w.body), `${canWipe ? `<div class="seg-tabs" role="group" aria-label="Layout"><button class="raised" data-cmp-mode="side" aria-pressed="${!wipe}">Side by side</button><button class="raised" data-cmp-mode="wipe" aria-pressed="${wipe}">Wipe</button></div>` : ""}${imgs.length ? `<label class="check"><input type="checkbox" data-cmp-opt="actual"${o.actual ? " checked" : ""}><span>Actual size</span></label>` : ""}${media.length > 1 ? `<label class="check"><input type="checkbox" data-cmp-opt="sync"${o.sync ? " checked" : ""}><span>Sync playback</span></label>` : ""}${media.length ? `<button class="raised btn-s" data-cmp-play title="Space">Play all</button>` : ""}${wipe ? `<button class="raised btn-s" data-cmp-swap title="Put ${esc(nameOf(items[1].r))} on the left">Swap sides</button>` : ""}`);
  $$("[data-cmp-opt]", w.body).forEach(c => { c.checked = !!o[c.dataset.cmpOpt]; });
  const main = $(".cmp-main", w.body), key = [wipe, o.actual, cols, ...items.map(x => `${x.id}:${x.r?.asset || ""}`)].join("|");
  if (w.rendered !== key) {
    w.rendered = key;
    w.cmpRO?.disconnect(); w.cmpRO = null; w.cmpPaint = null;
    main.innerHTML = !items.length ? loadingOr("Nothing to compare.")
      : wipe ? `${cmpWipeHTML(w, items)}<div class="cmp-grid infos" style="--cmp-cols:2">${items.map(x => cmpColHTML(w, x, false)).join("")}</div>`
      : `<div class="cmp-grid${n <= cols ? " one" : ""}" style="--cmp-cols:${cols}">${items.map(x => cmpColHTML(w, x, true)).join("")}</div>`;
    cmpMediaBind(w);
    if (wipe) cmpWipe(w);
  }
  const infos = cmpInfo(w, items);
  $$(".cmp-info", main).forEach((el, i) => morph(el, infos[i]));
  $$(".cmp-col", main).forEach(el => el.classList.toggle("sel", el.dataset.col === w.sel));
  cmpPlayLabel(w);
  // credits once per job: the files of a multi-output job share its charge
  const jobs = new Map(live.map(x => [cmpBase(x.id), runOf(cmpBase(x.id)) || x.r]));
  const total = [...jobs.values()].reduce((s, r) => s + (costOf(r) || 0), 0), est = [...jobs.values()].some(r => r.credits == null && r.estimatedCredits != null);
  const segs = $$(".statusbar .seg", w.body), gone = n - live.length;
  segs[0].textContent = `${n} item${n === 1 ? "" : "s"} from ${jobs.size} job${jobs.size === 1 ? "" : "s"}${gone ? ` · ${gone} no longer in runs.json` : ""}`;
  segs[1].textContent = `${est ? "~" : ""}${fmt(total)} credits in total`;
  segs[2].textContent = wipe ? "Drag the divider or press ← →" : "Double-click to open";
}

// sizes and durations once the files load (shown and compared in the Size row); sync and panning
function cmpMediaBind(w) {
  const main = $(".cmp-main", w.body);
  $$("[data-size-of]", main).forEach(m => {
    const id = m.dataset.sizeOf, set = v => { if (w.sizes[id] !== v) { w.sizes[id] = v; renderWin(w); } };
    if (m.tagName === "IMG") { const f = () => m.naturalWidth && set(`${m.naturalWidth}×${m.naturalHeight}`); m.complete ? f() : m.addEventListener("load", f, { once: true }); }
    else { const f = () => set(m.tagName === "VIDEO" ? `${m.videoWidth}×${m.videoHeight} · ${m.duration.toFixed(1)}s` : `${m.duration.toFixed(1)}s`); m.readyState >= 1 ? f() : m.addEventListener("loadedmetadata", f, { once: true }); }
  });
  cmpSync(w);
  // actual size side by side: drag to pan, and every image follows to the same spot
  const frames = $$(".cmp-frame.actual", main);
  let quiet = false;
  frames.forEach(f => {
    const img = $("img", f), center = () => { f.scrollLeft = (f.scrollWidth - f.clientWidth) / 2; f.scrollTop = (f.scrollHeight - f.clientHeight) / 2; };
    img.complete ? center() : img.addEventListener("load", center, { once: true });
    f.addEventListener("scroll", () => {
      if (quiet) return;
      const fx = f.scrollLeft / Math.max(1, f.scrollWidth - f.clientWidth), fy = f.scrollTop / Math.max(1, f.scrollHeight - f.clientHeight);
      quiet = true;
      frames.forEach(g => { if (g !== f) { g.scrollLeft = fx * (g.scrollWidth - g.clientWidth); g.scrollTop = fy * (g.scrollHeight - g.clientHeight); } });
      requestAnimationFrame(() => { quiet = false; });
    });
    cmpPan(f, f);
  });
}
// drag inside el to scroll sc
function cmpPan(el, sc, when = () => true) {
  el.addEventListener("pointerdown", e => {
    if (e.button !== 0 || !when(e)) return;
    const sx = e.clientX, sy = e.clientY, sl = sc.scrollLeft, st = sc.scrollTop;
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add("panning");
    const mv = ev => { sc.scrollLeft = sl - (ev.clientX - sx); sc.scrollTop = st - (ev.clientY - sy); };
    const up = () => { el.removeEventListener("pointermove", mv); el.classList.remove("panning"); };
    el.addEventListener("pointermove", mv);
    el.addEventListener("pointerup", up, { once: true }); el.addEventListener("pointercancel", up, { once: true });
  });
}

// two images, B over A and cut off left of the divider; in actual size both are drawn at the larger one's pixel size, so they stay aligned
function cmpWipe(w) {
  const box = $(".cmp-wipe", w.body), o = cmpOpts(w); if (!box) return;
  const sc = $(".cw-scroll", box), cv = $(".cw-canvas", box), [ia, ib] = $$(".cw-canvas img", box), line = $(".cw-line", box);
  const paint = () => {
    line.style.left = o.at * 100 + "%";
    const p = Math.round(o.at * 100), lr = line.getBoundingClientRect(), cr = cv.getBoundingClientRect();
    ib.style.clipPath = `inset(0 0 0 ${Math.max(0, lr.left + lr.width / 2 - cr.left)}px)`;
    line.setAttribute("aria-valuenow", p);
    line.setAttribute("aria-valuetext", `${p}% A, ${100 - p}% B`);
  };
  const layout = () => {
    const big = [ia, ib].sort((x, y) => y.naturalWidth * y.naturalHeight - x.naturalWidth * x.naturalHeight)[0];
    const on = o.actual && big.naturalWidth > 0;
    cv.style.width = on ? big.naturalWidth + "px" : ""; cv.style.height = on ? big.naturalHeight + "px" : "";
    if (on && !box.dataset.centered) { box.dataset.centered = "1"; sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2; sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2; }
    paint();
  };
  [ia, ib].forEach(i => (i.complete ? null : i.addEventListener("load", layout, { once: true })));
  layout();
  sc.addEventListener("scroll", paint);
  w.cmpRO = new ResizeObserver(paint); w.cmpRO.observe(box);
  w.cmpPaint = paint;
  // the divider follows the pointer from a press anywhere (in actual size, from the divider only; elsewhere the press pans)
  box.addEventListener("pointerdown", e => {
    if (e.button !== 0 || (o.actual && !e.target.closest(".cw-line"))) return;
    e.preventDefault(); line.focus({ preventScroll: true });
    box.setPointerCapture(e.pointerId);
    const at = ev => { const br = sc.getBoundingClientRect(); o.at = clampN((ev.clientX - br.left) / br.width, 0, 1); paint(); };
    if (!e.target.closest(".cw-line")) at(e);
    const up = () => { box.removeEventListener("pointermove", at); save(); };
    box.addEventListener("pointermove", at);
    box.addEventListener("pointerup", up, { once: true }); box.addEventListener("pointercancel", up, { once: true });
  });
  cmpPan(box, sc, e => o.actual && !e.target.closest(".cw-line"));
}
function cmpWipeMove(w, to) {
  const o = cmpOpts(w); if (!w.cmpPaint) return;
  o.at = clampN(to, 0, 1); w.cmpPaint(); save();
}
// which side of the divider a point is on: the item shown there
function cmpWipeItem(w, x) {
  const line = $(".cw-line", w.body), items = cmpItems(w); if (!line) return null;
  const lr = line.getBoundingClientRect();
  return items[x < lr.left + lr.width / 2 ? 0 : 1];
}

// Sync playback: play, pause, seek and speed on one file go to all; when every file has ended they start over together
function cmpSync(w) {
  const els = $$(".cmp-frame video, .cmp-frame audio", w.body), o = cmpOpts(w);
  if (!els.length) return;
  // changes made here fire the same events as the user's: ignore those for a moment
  const quiet = new Map(els.map(m => [m, {}]));
  const hush = (m, ev, fn) => { quiet.get(m)[ev] = performance.now() + 400; fn(); };
  const mine = (m, ev) => performance.now() < (quiet.get(m)[ev] || 0);
  let lead = els[0];
  const follow = (m, fn) => { if (!o.sync || els.length < 2) return; els.forEach(x => { if (x !== m) fn(x); }); };
  const seekTo = (x, t) => { const tt = Math.min(t, x.duration || t); if (Math.abs(x.currentTime - tt) > 0.04) hush(x, "seeking", () => { x.currentTime = tt; }); };
  els.forEach(m => {
    m.addEventListener("play", () => {
      cmpPlayLabel(w);
      if (mine(m, "play")) return;
      lead = m;
      follow(m, x => { seekTo(x, m.currentTime); if (x.paused && m.currentTime < (x.duration || Infinity) - 0.05) hush(x, "play", () => x.play().catch(() => {})); });
    });
    m.addEventListener("pause", () => {
      cmpPlayLabel(w);
      if (mine(m, "pause") || m.ended) return;
      follow(m, x => { if (!x.paused) hush(x, "pause", () => x.pause()); });
    });
    m.addEventListener("seeking", () => { if (!mine(m, "seeking")) { lead = m; follow(m, x => seekTo(x, m.currentTime)); } });
    m.addEventListener("ratechange", () => { if (!mine(m, "ratechange")) follow(m, x => { if (x.playbackRate !== m.playbackRate) hush(x, "ratechange", () => { x.playbackRate = m.playbackRate; }); }); });
    m.addEventListener("ended", () => {
      cmpPlayLabel(w);
      if (!o.sync || els.length < 2 || !els.every(x => x.ended)) return;
      els.forEach(x => { hush(x, "seeking", () => { x.currentTime = 0; }); hush(x, "play", () => x.play().catch(() => {})); });
    });
    // keep the others on the leader's clock (files of different lengths stop at their end)
    m.addEventListener("timeupdate", () => {
      if (m !== lead || m.paused || !o.sync) return;
      follow(m, x => { if (!x.paused && m.currentTime < (x.duration || 0) && Math.abs(x.currentTime - m.currentTime) > 0.15) hush(x, "seeking", () => { x.currentTime = m.currentTime; }); });
    });
  });
  w.cmpMedia = { els, setSync: on => { els.forEach(x => { x.loop = !on; }); if (on) els.forEach(x => x !== lead && seekTo(x, lead.currentTime)); } };
}
function cmpPlayAll(w) {
  const els = w.cmpMedia?.els.filter(x => x.isConnected) || []; if (!els.length) return;
  const playing = els.some(x => !x.paused);
  els.forEach(x => { if (playing) x.pause(); else x.play().catch(() => {}); });
}
function cmpPlayLabel(w) {
  const b = $("[data-cmp-play]", w.body); if (!b) return;
  const t = (w.cmpMedia?.els || []).some(x => x.isConnected && !x.paused) ? "Pause all" : "Play all";
  if (b.textContent !== t) b.textContent = t;
}

function cmpBind(w) {
  const b = w.body, o = cmpOpts(w);
  const colOf = (e, t = e.target) => {
    const c = t.closest("[data-col]"); if (c) return { id: c.dataset.col, el: $(".cmp-head", c) };
    const x = t.closest(".cmp-wipe") && cmpWipeItem(w, e.clientX); return x ? { id: x.id, el: t.closest(".cmp-wipe") } : null;
  };
  const pick = id => { w.sel = id; $$(".cmp-col", b).forEach(el => el.classList.toggle("sel", el.dataset.col === id)); save(); };
  b.addEventListener("click", e => {
    const m = e.target.closest("[data-cmp-mode]"); if (m) { o.mode = m.dataset.cmpMode; renderWin(w); save(); return; }
    if (e.target.closest("[data-cmp-swap]")) { o.swap = !o.swap; w.rendered = null; renderWin(w); save(); return; }
    if (e.target.closest("[data-cmp-play]")) { cmpPlayAll(w); return; }
    const c = e.target.closest("[data-col]"); if (c) pick(c.dataset.col);
  });
  b.addEventListener("change", e => {
    const c = e.target.closest("[data-cmp-opt]"); if (!c) return;
    o[c.dataset.cmpOpt] = c.checked; save();
    if (c.dataset.cmpOpt === "sync") w.cmpMedia?.setSync(c.checked); else renderWin(w);
  });
  b.addEventListener("dblclick", e => {
    if (e.target.closest(".cmp-bar, video, audio, .cmp-info")) return;
    const c = colOf(e), r = c && runOf(c.id); if (r) defaultOpen(r, c.el);
  });
  b.addEventListener("contextmenu", e => {
    if (e.shiftKey || e.target.closest(".cmp-bar, .promptbox")) return;
    const c = colOf(e), r = c && runOf(c.id); if (!r) return;
    e.preventDefault(); pick(c.id);
    runMenu(r, e.clientX, e.clientY, c.el);
  });
  // the keyboard while the window is in front
  b.addEventListener("keydown", e => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.target.closest("input, textarea, select, video, audio")) return;
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") && w.cmpPaint) {
      e.preventDefault();
      const d = (e.shiftKey ? 0.1 : 0.01) * (e.key === "ArrowLeft" ? -1 : 1);
      cmpWipeMove(w, e.key === "Home" ? 0 : e.key === "End" ? 1 : o.at + d);
    } else if (e.key === " " && !e.target.closest("button") && w.cmpMedia) { e.preventDefault(); cmpPlayAll(w); }
    else if (e.key === "Enter" && !e.target.closest("button") && runOf(w.sel)) { e.preventDefault(); defaultOpen(runOf(w.sel)); }
  });
}

/* ---------- context menus ---------- */
function showMenu(x, y, items) {
  S.menuItems = items.filter(Boolean);
  S.menuReturn = document.activeElement;
  menuEl.innerHTML = S.menuItems.map((it, i) => it.sep ? '<hr class="etch">'
    : `<button role="menuitem" data-i="${i}" class="${it.bold ? "bold" : ""}" ${it.disabled ? "disabled" : ""}>${it.icon ? `<svg class="mico" aria-hidden="true"><use href="#${it.icon}"/></svg>` : ""}<span>${esc(it.label)}</span>${it.sub ? `<small class="msub">${esc(it.sub)}</small>` : ""}${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ""}</button>`).join("");
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = clampN(x, 0, innerWidth - r.width) + "px";
  menuEl.style.top = clampN(y, 0, innerHeight - r.height) + "px";
  $("button:not(:disabled)", menuEl)?.focus();
}
export const hideMenu = () => { if (!menuEl.hidden) { menuEl.hidden = true; S.menuReturn?.focus?.(); } };
export const menuKeys = (root, e) => {
  const items = $$("button:not(:disabled)", root), i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
  if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
  if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
};

function runMenu(r, x, y, src) {
  showMenu(x, y, [
    { label: r.asset ? "Open" : "Properties", icon: r.asset ? typeIcon(r.type) : "i-doc", bold: true, hint: "Enter", act: () => defaultOpen(r, src) },
    r.asset && { label: "Properties", icon: "i-doc", hint: "Cmd+I", act: () => open("props", r.taskId, src) },
    r.parent && runOf(r.parent) && { label: "Go to source", act: () => open("props", r.parent, src) },
    ...cmpMenu(r, src),
    { sep: true },
    r.type === "image" && r.asset && { label: "Animate into video…", icon: "i-animate", act: () => genFrom(r, "animate", src) },
    (r.type === "image" || r.type === "video") && r.asset && { label: "Upscale…", icon: "i-upscale", act: () => genFrom(r, "upscale", src) },
    r.type === "video" && r.asset && { label: "Add sound…", icon: "i-sound", act: () => genFrom(r, "sound", src) },
    r.type === "video" && r.asset && { label: "Convert to HDR…", icon: "i-hdr", act: () => genFrom(r, "hdr", src) },
    { label: "Generate again…", icon: "i-again", act: () => genFrom(r, "again", src) },
    ACTIVE.has(r.status) && { label: "Cancel job", icon: "i-stop", act: () => cancelJob(r) },
    { sep: true },
    { label: "Copy prompt", icon: "i-copy", act: () => copyText(r.prompt, "Prompt copied") },
    { label: "Copy task ID", icon: "i-copy", act: () => copyText(r._of || r.taskId, "Task ID copied") },
    { sep: true },
    { label: "Show in Finder", icon: "i-finder", disabled: !r.asset, act: () => fileAction("reveal", r.asset) },
    { label: "Open in default app", icon: "i-open", disabled: !r.asset, act: () => fileAction("open", r.asset) },
  ]);
}
export function windowMenu(w, x, y) {
  showMenu(x, y, [
    { label: "Restore", disabled: !w.max && !w.snapped && !w.minimized, act: () => (w.minimized ? restore(w) : toggleMax(w)) },
    { label: "Move", disabled: w.max || w.minimized, act: () => kbStart(w, "move") },
    { label: "Size", disabled: w.max || w.minimized, act: () => kbStart(w, "size") },
    { label: "Minimize", hint: "Cmd+M", disabled: w.minimized, act: () => minimize(w) },
    { label: "Maximize", hint: "Alt+↑", disabled: w.max, act: () => { if (w.minimized) restore(w); if (!w.max) toggleMax(w); } },
    { sep: true },
    { label: "Close", bold: true, hint: document.fullscreenElement ? "Cmd+W" : "Alt+W", act: () => close(w) },
  ]);
}
// keyboard Move and Size, as in Win95: arrow keys move or size the window (Shift: 1 px), Enter or a click keeps it, Esc puts it back
const KB_HINT = "Enter to finish, Esc to cancel.";
function kbStart(w, mode) {
  kbEnd(true);
  if (w.max || w.minimized || wins.get(w.id) !== w) return;
  S.kb = { w, mode, start: { x: w.x, y: w.y, wd: w.wd, ht: w.ht, snapped: w.snapped, pre: w.pre } };
  focus(w);
  if (!w.el.contains(document.activeElement)) focusInto(w);
  w.el.classList.add("kbmode");
  balloon(mode === "move" ? { title: "Move window", text: `Arrow keys move it. ${KB_HINT}`, ms: 6000 } : { title: "Size window", text: `Arrow keys change its width and height. ${KB_HINT}`, ms: 6000 });
}
function kbEnd(keep) {
  if (!S.kb) return;
  const { w, start } = S.kb;
  S.kb = null;
  w.el.classList.remove("kbmode");
  if (!keep) Object.assign(w, start);
  if (wins.get(w.id) === w) { fit(w); place(w); }
  if (keep) save();
  const b = $("#balloon"); if (b && !b.hidden && b.textContent.includes(KB_HINT)) b.hidden = true; // the hint no longer applies
}
export const deskMenu = (x, y) => showMenu(x, y, [
  { label: "Arrange icons", act: () => arrangeIcons() },
  { sep: true },
  { label: "Cascade windows", act: cascadeAll },
  { label: "Tile windows", act: tileAll },
  { label: "Minimize all windows", act: () => wins.forEach(w => !w.minimized && minimize(w, false)) },
  { sep: true },
  { label: "Close all windows", act: resetLayout },
  { label: "Show folder in Finder", act: () => fileAction("reveal", "runs.json") },
]);

export const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
// the letter printed on the key, whatever the layout (Option on a Mac changes e.key, so go through the code)
const letterOf = ev => String(S.layoutMap?.get(ev.code) || (ev.code?.startsWith("Key") ? ev.code.slice(3) : ev.key) || "").toLowerCase();
const codesFor = letters => { const out = []; S.layoutMap?.forEach((k, code) => { if (letters.includes(k)) out.push(code); }); return out.length ? out : letters.map(l => "Key" + l.toUpperCase()); };
export async function toggleFullScreen() {
  try {
    if (document.fullscreenElement) { navigator.keyboard?.unlock?.(); await document.exitFullscreen(); return; }
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    await navigator.keyboard?.lock?.([...codesFor(["w", "n", "t", "m"]), "Backquote"]);
    balloon({ title: "Full screen", text: "Cmd+W now closes the window in Runway OS. Hold Esc to leave full screen.", ms: 3600 });
  } catch (err) { balloon({ title: "Couldn't go full screen", text: err.message, ms: 3000 }); }
}

/* ---------- spending guard: a daily credit limit for the whole org (Options → Spending) ----------
   The server works out data.spent.today from balance_history.json: every drop in the org balance since local midnight,
   so jobs from Claude, this app and other tools all count. Generate asks before a job that would go over the limit. */
const spendLimit = () => { const n = Math.round(+S.opts.dailyLimit); return S.opts.dailyLimit != null && S.opts.dailyLimit !== "" && n >= 1 ? n : null; };
// the server's spending fields from /api/state; repaint what shows them when they change
function spendUpdate(d) {
  const s = { today: typeof d.spentToday === "number" ? d.spentToday : null, source: d.spentSource || null, since: d.spentSince || null };
  const same = S.data.spent && S.data.spent.today === s.today && S.data.spent.source === s.source;
  S.data.spent = s;
  if (!same) spendRefresh();
}
function spendRefresh() {
  spendTray();
  $$(".spent-today").forEach(el => { el.textContent = spendText(); });
  wins.forEach(w => w.kind === "generate" && w.shell && S.CAT && curModel(w) && genRefresh(w));
}
function spendText() {
  const s = S.data.spent?.today, lim = spendLimit();
  if (s == null) return "Spent today: unknown until the server answers.";
  return `Spent today: ${fmt(s)} credits${lim ? ` of ${fmt(lim)} (${Math.round(s / lim * 100)}%)` : ""}.`;
}
// tray: the balance turns amber at 80% of the limit and red at 100%
function spendTray() {
  const bal = $("#tray-bal"); if (!bal) return;
  const s = S.data.spent?.today, lim = spendLimit(), r = lim && s != null ? s / lim : 0;
  bal.classList.toggle("spend-near", r >= 0.8 && r < 1);
  bal.classList.toggle("spend-over", r >= 1);
  bal.title = lim && s != null ? `Spent today: ${fmt(s)} of ${fmt(lim)} credits. Open Dashboard` : "Credits left. Open Dashboard";
}
// this job's price: the server's quote, else the same estimate the hint shows (from your last job with this model)
function spendQuote(w) {
  const key = JSON.stringify(genBody(w)), pr = w.priceFor === key ? w.price : null;
  if (pr?.credits != null) return { credits: pr.credits, exact: !!pr.exact };
  const m = curModel(w), t = curTask(w);
  const last = m && newestFirst().find(r => r.model === m.id && r.credits != null && r.costSource === "runway" && (!r.endpoint || r.endpoint === t.endpoint));
  if (!last) return { credits: null, exact: false };
  const d = +shownVal(m.fields.find(f => f.name === "duration") || {}, vals(w).duration), sec = secondsOf(last);
  return { credits: d && sec ? Math.round(last.credits / sec * d) : last.credits, exact: false };
}
// a quiet note after the price in Generate's footer, only when this job takes today's spending to 80% of the limit or more
function spendHint(w, hint, pr) {
  const lim = spendLimit(), s = S.data.spent?.today; if (!lim || s == null) return;
  const after = s + (pr?.credits ?? 0);
  if (after < lim * 0.8) return;
  hint.textContent += after > lim ? ` · over today's limit: ${fmt(after)} of ${fmt(lim)}` : ` · today ${fmt(after)} of ${fmt(lim)} limit`;
  hint.title = hint.textContent;
}
// before Generate sends a job: resolves true to go ahead
function spendCheck(w) {
  const lim = spendLimit(), s = S.data.spent?.today;
  if (!lim || s == null) return Promise.resolve(true);
  const q = spendQuote(w), after = s + (q.credits ?? 0);
  if (q.credits == null ? s < lim : after <= lim) return Promise.resolve(true);
  const lead = q.credits == null
    ? `Today's spending is already ${fmt(s)} of your ${fmt(lim)} credit limit, and this job's price is unknown.`
    : `This job would take today's spending to ${q.exact ? "" : "about "}${fmt(after)} of your ${fmt(lim)} credit limit.`;
  const job = q.credits == null ? "This job has no price quote, so it isn't counted here."
    : q.exact ? `This job: ${fmt(q.credits)} credits.` : `This job: about ${fmt(q.credits)} credits. That's an estimate, the final cost can differ.`;
  return spendDialog(lead, `Spent today: ${fmt(s)} credits, by the whole Runway org since midnight. ${job}`);
}
function spendDialog(lead, detail) {
  return new Promise(resolve => {
    $("#spendguard")?.remove();
    const back = document.activeElement, d = document.createElement("div");
    d.id = "spendguard"; d.className = "shutdown";
    d.innerHTML = `
        <div class="sd-win window front raised" role="alertdialog" aria-modal="true" aria-labelledby="sg-t" aria-describedby="sg-lead sg-detail">
          <div class="titlebar"><span class="t"><svg class="ico ticon" aria-hidden="true"><use href="#i-coin"/></svg><span class="tt" id="sg-t">Daily credit limit</span></span></div>
          <div class="sd-body">
            <svg class="sd-ico" aria-hidden="true"><use href="#i-coin"/></svg>
            <div class="sg-text"><p id="sg-lead">${esc(lead)}</p><p class="muted" id="sg-detail">${esc(detail)}</p></div>
          </div>
          <div class="sheet-foot"><span class="grow"></span><button class="raised btn-ok" data-sg="go">Generate anyway</button><button class="raised btn-ok b-default" data-sg="cancel">Cancel</button></div>
        </div>`;
    document.body.append(d);
    const done = ok => { removeEventListener("keydown", onKey, true); d.remove(); back?.focus?.(); resolve(ok); };
    // modal: it takes every key while open; Esc cancels, Tab stays on the two buttons, Enter presses the focused one
    const onKey = e => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); done(false); return; }
      if (e.key === "Tab") { const f = $$("button", d), i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
    };
    addEventListener("keydown", onKey, true);
    d.addEventListener("click", e => { const b = e.target.closest("[data-sg]"); if (b) done(b.dataset.sg === "go"); });
    $('[data-sg="cancel"]', d).focus();
  });
}
// terminal: one line for balance and cost
function spendTerm() {
  const s = S.data.spent?.today, lim = spendLimit();
  if (s == null) return `<b class="t-acc">today</b>: spending unknown`;
  return `<b class="t-acc">today, whole org</b>: <span class="t-red">${fmt(s)}</span> credits spent${lim ? ` of a ${fmt(lim)} daily limit (${Math.round(s / lim * 100)}%)` : ", no daily limit (set one in Options, Spending)"}`;
}
function spendPanel() {
  const lim = spendLimit(), src = S.data.spent?.source;
  return `
      <fieldset class="group"><legend>Daily credit limit</legend>
        <div class="opt-limit"><label for="o-limit">Limit</label><input type="number" class="field" id="o-limit" data-limit min="1" step="1" inputmode="numeric" value="${lim ?? ""}" placeholder="No limit" aria-describedby="o-limit-h"><span>credits a day</span></div>
        <p class="muted opt-limit-h" id="o-limit-h">Counts every credit the Runway org spends from midnight, local time, so jobs from Claude, this app and other tools all count. Top-ups don't lower it. Generate asks before a job that would go over the limit. Leave empty for no limit.</p>
        <p class="spent-today" aria-live="polite">${esc(spendText())}</p>
        ${src === "jobs" ? '<p class="muted opt-limit-h">No balance history for today yet, so this adds up today\'s jobs in runs.json instead.</p>' : ""}
      </fieldset>`;
}

/* ---------- Shut down: restart, optionally forgetting the window layout or every setting ---------- */
// set just before a reload, so nothing writes the forgotten state back
function restart(mode) {
  S.resetting = true;
  clearTimeout(S.saveT);
  try {
    if (mode === "clean" || mode === "all") { localStorage.removeItem(KEY); localStorage.removeItem("runway-os-icons-v1"); }
    if (mode === "all") localStorage.removeItem(OPT_KEY);
  } catch {}
  location.reload();
}
export function shutdownDialog() {
  if ($("#shutdown")) return;
  const back = document.activeElement;
  const d = document.createElement("div");
  d.id = "shutdown";
  d.className = "shutdown";
  d.innerHTML = `
      <div class="sd-win window front raised" role="dialog" aria-modal="true" aria-labelledby="sd-t">
        <div class="titlebar"><span class="t"><svg class="ico ticon" aria-hidden="true"><use href="#i-power"/></svg><span class="tt" id="sd-t">Shut down runway os</span></span></div>
        <div class="sd-body">
          <svg class="sd-ico" aria-hidden="true"><use href="#i-power"/></svg>
          <fieldset class="sd-opts"><legend>What do you want to do?</legend>
            <label class="opt-radio"><input type="radio" name="sd" value="restart" checked><span>Restart <span class="muted">Your windows and settings stay.</span></span></label>
            <label class="opt-radio"><input type="radio" name="sd" value="clean"><span>Restart with a clean desktop <span class="muted">Forgets which windows were open, where, and the Generate form.</span></span></label>
            <label class="opt-radio"><input type="radio" name="sd" value="all"><span>Restart and reset everything <span class="muted">Also resets Options: theme, scale, font and alerts.</span></span></label>
            <p class="muted sd-note">Your jobs, files and API key aren't touched.${(n => n ? ` ${n} job${n === 1 ? " is" : "s are"} still rendering or queued: ${n === 1 ? "it keeps" : "they keep"} going on Runway, and Activity shows ${n === 1 ? "it" : "them"} again after the restart.` : "")(S.data.runs.filter(r => ACTIVE.has(r.status)).length)}</p>
          </fieldset>
        </div>
        <div class="sheet-foot"><span class="grow"></span><button class="raised btn-ok b-default" data-sd="ok">OK</button><button class="raised btn-ok" data-sd="cancel">Cancel</button></div>
      </div>`;
  document.body.append(d);
  const done = ok => {
    removeEventListener("keydown", onKey, true);
    if (ok) { restart($('input[name="sd"]:checked', d).value); return; }
    d.remove(); back?.focus?.();
  };
  // the dialog is modal: it takes every key while open; Tab stays inside it
  const onKey = e => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); done(false); return; }
    if (e.key === "Enter" && !e.target.closest('[data-sd="cancel"]')) { e.preventDefault(); done(true); return; }
    if (e.key === "Tab") {
      const f = $$("input:checked, button", d), i = f.indexOf(document.activeElement);
      e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  };
  addEventListener("keydown", onKey, true);
  d.addEventListener("click", e => { const b = e.target.closest("[data-sd]"); if (b) done(b.dataset.sd === "ok"); });
  $('input[name="sd"]:checked', d).focus();
}

/* ---------- right-click: an in-app menu everywhere; Shift + right-click keeps the browser's own menu ---------- */
async function pasteInto(el) {
  try {
    const t = await navigator.clipboard.readText();
    el.focus(); el.setRangeText(t, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } catch { balloon({ title: "Couldn't paste", text: "The browser blocked reading the clipboard. Press Cmd+V instead.", ms: 4000 }); }
}
function textMenu(el, x, y) {
  const sel = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0), ro = el.readOnly || el.disabled;
  showMenu(x, y, [
    { label: "Cut", icon: "i-copy", hint: "Cmd+X", disabled: !sel || ro, act: () => { navigator.clipboard?.writeText(sel).catch(() => {}); el.focus(); el.setRangeText("", el.selectionStart, el.selectionEnd, "end"); el.dispatchEvent(new Event("input", { bubbles: true })); } },
    { label: "Copy", icon: "i-copy", hint: "Cmd+C", disabled: !sel, act: () => copyText(sel, "Copied") },
    { label: "Paste", hint: "Cmd+V", disabled: ro, act: () => pasteInto(el) },
    { sep: true },
    { label: "Select all", hint: "Cmd+A", disabled: !el.value, act: () => { el.focus(); el.select(); } },
  ]);
}
// first launch (no saved layout, so restoreLayout opens just the terminal): once the first state poll answers
// and there is no API key, open the key window on top as well. Later loads have a saved layout and skip this.
const firstLaunch = (() => { try { return !Array.isArray(JSON.parse(localStorage.getItem(KEY))); } catch { return true; } })();

/* ---------- boot screen: a BIOS self-test over the real startup; the log stays up until you start ---------- */
// each startup check with its time (ms since the page started loading), kept for the bootlog command
const bootLog = [];
async function bootScreen(modelsLoaded) {
  // the checks run and are logged even with the boot screen off; the screen only shows them
  const show = S.opts.boot, fast = calm(), deadline = Date.now() + 8000;
  let el = null, log = null, hint = null, phase = "loading", early = false;
  const setHint = t => { if (hint) hint.textContent = t; };
  const btns = () => (el ? $$(".boot-act button", el) : []);
  const start = async withKey => {
    if (S.bootDone) return;
    S.bootDone = true;
    removeEventListener("keydown", onKey, true); removeEventListener("pointerdown", onPointer, true);
    document.body.classList.remove("booting");
    el.classList.add("out");
    setTimeout(() => el.remove(), fast ? 0 : 200);
    if (withKey) open("key");
    const f = frontWin(); if (f) $("input:not([type=hidden]):not([type=range]), textarea", f.body)?.focus();
  };
  // while loading: Esc starts now, any other key or a click starts as soon as loading finishes.
  // when ready: Enter or Space presses the focused button, Tab moves between the buttons, Esc starts.
  const onKey = e => {
    e.stopPropagation(); // the desktop behind doesn't see keys while the boot screen is up
    if (e.metaKey || e.ctrlKey || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return; // browser shortcuts still work
    e.preventDefault();
    if (S.bootDone) return;
    if (e.key === "Escape") { start(false); return; }
    if (phase === "loading") {
      if (!early) { early = true; setHint("Starting when loading finishes… Press Esc to start now."); }
      return;
    }
    const list = btns(), i = list.indexOf(document.activeElement);
    if (e.key === "Enter" || e.key === " ") (list[i] || list[0])?.click();
    else if (e.key === "Tab" && list.length) list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus();
  };
  const onPointer = e => {
    e.stopPropagation();
    if (S.bootDone || phase !== "loading") return;
    e.preventDefault();
    if (!early) { early = true; setHint("Starting when loading finishes… Press Esc to start now."); }
  };
  if (show) {
    S.bootDone = false;
    el = document.createElement("div");
    el.className = "boot";
    // one centered column: logo, name, progress bar, the checks as they run, then the Start button
    el.innerHTML = `<div class="boot-col">
          <span class="boot-logo" aria-hidden="true">${logoSVG("#ffffff")}</span>
          <b class="boot-name">runway os</b>
          <div class="boot-bar" role="progressbar" aria-label="Starting runway os" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
          <ul class="boot-log" role="log" aria-live="polite"></ul>
          <div class="boot-sum" aria-live="polite"></div>
          <div class="boot-act"></div>
          <div class="boot-hint" aria-live="polite">Press any key to start when loading finishes, or Esc to start now.</div>
        </div>`;
    document.body.append(el); document.body.classList.add("booting");
    log = $(".boot-log", el); hint = $(".boot-hint", el);
    addEventListener("keydown", onKey, true); addEventListener("pointerdown", onPointer, true);
  }
  // a line prints when its check starts; its result is added, and the line logged, when the check finishes
  const STEPS = 5;
  let doneSteps = 0;
  const begin = text => {
    const d = log && document.createElement("li");
    if (d) { d.innerHTML = `<span></span><span class="res wait">…</span>`; d.firstChild.textContent = text; log.append(d); }
    return { d, text };
  };
  const end = (row, res, bad = false) => {
    bootLog.push({ ms: Math.round(performance.now()), text: row.text, res, bad });
    doneSteps++;
    if (el) { const pct = Math.min(100, Math.round((doneSteps / STEPS) * 100)); $(".boot-bar i", el).style.width = pct + "%"; $(".boot-bar", el).setAttribute("aria-valuenow", pct); }
    if (!row.d) return;
    const r = row.d.lastChild; r.textContent = res || "OK"; r.className = "res" + (bad ? " bad" : "");
  };
  const summary = text => { bootLog.push({ ms: Math.round(performance.now()), text, res: "", bad: false }); if (el) $(".boot-sum", el).textContent = text; };
  const wait = p => upTo(p, Math.max(0, deadline - Date.now()));

  let row = begin("Server");
  end(row, location.protocol === "file:" ? "opened as a file" : location.host, location.protocol === "file:");
  row = begin("Loading model list…");
  if (!(await wait(modelsLoaded)) || !S.CAT) end(row, "failed. Generate can't list models", true);
  else { const t = S.CAT.tasks || []; end(row, `${new Set(t.flatMap(x => x.models.map(m => m.id))).size} models, ${t.length} tasks`); }
  row = begin("Connecting to Runway API…");
  // the first /api/state answer, or the first failed poll (poll keeps retrying every 3 s)
  while (!S.loaded && S.conn.cls !== "off" && Date.now() < deadline) await upTo(ready, 50);
  if (!S.loaded) end(row, S.conn.cls === "off" ? "server not reachable" : "no answer after 8 s", true);
  else if (!S.data.live) end(row, "no key", true);
  else if (S.data.error) end(row, S.data.error, true);
  else end(row, "OK");
  const live = S.loaded && S.data.live && !S.data.error, n = S.data.runs.length;
  const when = S.data.balanceAt ? `, last known ${absTime(tOf(S.data.balanceAt))}` : ", last known";
  end(begin("Credits"), !S.loaded || S.data.balance == null ? "unknown" : fmt(S.data.balance) + (live ? "" : when), !S.loaded || S.data.balance == null);
  end(begin("Jobs"), S.loaded ? `${fmt(n)} found` : "unknown", !S.loaded);
  summary(!S.loaded ? (S.conn.cls === "off" ? `Server not reachable. Run python3 server.py${location.protocol === "file:" ? " and open the address it prints" : "; runway os keeps trying"}.` : "The server hasn't answered yet; runway os keeps trying.")
    : !S.data.live ? "Ready without a Runway key."
    : S.data.error ? "Ready, but the Runway API reported an error."
    : `Ready. ${S.data.balance == null ? "Credits unavailable" : fmt(S.data.balance) + " credits"}, ${fmt(n)} job${n === 1 ? "" : "s"}.`);
  phase = "ready";
  if (!show || S.bootDone) return;
  if (early) { start(false); return; }
  const act = $(".boot-act", el), keyBtn = S.loaded && !live;
  act.innerHTML = `<button class="raised btn-s default" data-start>Start runway os</button>${keyBtn ? '<button class="raised btn-s" data-start="key">Start and add API key</button>' : ""}`;
  act.addEventListener("click", e => { const b = e.target.closest("[data-start]"); if (b) start(b.dataset.start === "key"); });
  $("button", act).focus();
  setHint(keyBtn ? "Press Enter to start, or Tab to choose the other button." : "Press Enter to start");
}
// the server answers 304 when nothing changed, so an idle poll costs almost nothing
function schedulePoll() {
  clearTimeout(S.pollT);
  const ms = document.hidden ? 30000 : S.data.runs.some(r => ACTIVE.has(r.status)) ? 2000 : 5000;
  S.pollT = setTimeout(() => poll().finally(schedulePoll), ms);
}
async function poll() {
  try {
    const res = await fetch("/api/state", { cache: "no-store", headers: S.stateTag && S.loaded ? { "If-None-Match": S.stateTag } : {} });
    if (res.status === 304) {
      if (S.conn.cls === "off" && S.lastConn) { S.conn = S.lastConn; wins.forEach(w => w.kind === "overview" && renderWin(w)); }
      return;
    }
    S.stateTag = res.headers.get("ETag");
    const d = await res.json();
    const c = d.error ? { cls: "warn", text: "Runway API: " + d.error } : d.live ? { cls: "on", text: "Connected" } : { cls: "warn", text: "No API key" };
    const runs = d.runs || [], rs = JSON.stringify(runs) + JSON.stringify(d.inputs || []), ss = rs + d.balance + d.balanceAt + (d.history || []).length;
    const first = !S.loaded, runsChanged = rs !== S.runsSig, anyChanged = ss !== S.stateSig;
    const connChanged = c.text !== S.conn.text || c.cls !== S.conn.cls;
    const keySig = [d.live, d.keySource, d.keyHint, d.error].join("|"), keyChanged = keySig !== S.data.keySig;
    S.data = { runs, balance: d.balance, balanceAt: d.balanceAt, history: d.history || [], live: !!d.live, keySource: d.keySource, keyHint: d.keyHint, error: d.error, keySig, inputs: d.inputs || [] };
    spendUpdate(d);
    if (S.sessionStart == null && d.balance != null) S.sessionStart = { balance: d.balance, at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    S.runsSig = rs; S.stateSig = ss; S.conn = c; S.lastConn = c; S.loaded = true; S.markReady();
    if (!first) runs.forEach(r => { const was = S.prevStatus.get(r.taskId); if (was && ACTIVE.has(was) && !ACTIVE.has(r.status)) announce(r); });
    S.prevStatus = new Map(runs.map(r => [r.taskId, r.status]));
    wins.forEach(w => {
      if (w.kind === "overview" || w.kind === "key") { if (first || anyChanged || connChanged) renderWin(w); return; }
      if (!first && !runsChanged) return;
      const sig = SIG[w.kind]?.(w);
      if (sig !== undefined && sig === w.sig && !first) return; // this window's data didn't change
      w.sig = sig; renderWin(w);
    });
    if (!first && keyChanged && !runsChanged) wins.forEach(w => (w.kind === "key" || w.kind === "generate") && renderWin(w));
    if (first || runsChanged) renderTasks();
    if (first || anyChanged) renderTray();
  } catch {
    const c = { cls: "off", text: location.protocol === "file:" ? "Run python3 server.py" : "Server offline" };
    if (c.text !== S.conn.text) { S.conn = c; wins.forEach(w => w.kind === "overview" && renderWin(w)); }
  }
}

// clock + relative times
const clock = $("#clock");
function tick() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], S.opts.clock24 ? { hour: "2-digit", minute: "2-digit", hour12: false } : { hour: "numeric", minute: "2-digit", hour12: true });
  clock.title = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  $$("time[data-t]").forEach(t => { t.textContent = t.dataset.kind === "elapsed" ? dur(Date.now() - +t.dataset.t) : ago(+t.dataset.t); });
}

// the model list and the first state load in parallel
const modelsLoaded = fetch("/api/models").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(c => { S.CAT = c; }).catch(() => { S.catFailed = true; })
  .finally(() => wins.forEach(w => w.kind === "generate" && renderWin(w)));


// start: every module's listeners and saved state, in the order the single-file app had them
windowsInit();
uiInit();
taskbarInit();
iconsInit();
addEventListener("dragstart", e => {
  const src = e.target.closest?.("[draggable][data-id]"); if (!src) return;
  const r = runOf(src.dataset.id); if (!r?.asset) { e.preventDefault(); return; }
  e.dataTransfer.setData(DRAG_TYPE, r.taskId);
  e.dataTransfer.setData("text/plain", r.asset);
  e.dataTransfer.effectAllowed = "copy";
  const img = src.querySelector("img"); if (img?.complete) e.dataTransfer.setDragImage(img, 16, 16);
});
RENDER.keys = keysRender;
RENDER.overview = overviewRender;
RENDER.jobs = jobsRender;
RENDER.generate = w => genRender(w);
RENDER.key = w => keyRender(w);
RENDER.terminal = w => termRender(w);
RENDER.options = w => optionsRender(w);
RENDER.usage = w => usageRender(w);
RENDER.activity = w => activityRender(w);
RENDER.images = w => gallery(w, "image");
RENDER.audio = w => gallery(w, "audio");
RENDER.videos = w => gallery(w, "video");
RENDER.tree = w => treeRender(w);
RENDER.notes = w => notesRender(w);
RENDER.viewer = viewerRender;
RENDER.props = propsRender;
setInterval(() => $$(".act [data-eta]").forEach(e => { e.textContent = etaText(+e.dataset.eta); }), 5000);
try { S.notePref = { ...S.notePref, ...JSON.parse(localStorage.getItem(NOTE_PREF)) }; } catch {}
addEventListener("pagehide", () => notesSt.dirty.forEach(ed => {
  if (ed.name && ed.text !== ed.saved) fetch("/api/notes", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ed.name, text: ed.text }) }).catch(() => {});
}));
// terminal links to notes (ls notes, tree)
desk.addEventListener("click", e => { const a = e.target.closest("[data-note-open]"); if (a) openNote(a.dataset.noteOpen, a); });
setTimeout(() => { notesLoad(); noteFromHash(noteHash); }, 0);
addEventListener("hashchange", () => noteFromHash(location.hash));
addEventListener("dragstart", e => {
  const it = e.target.closest?.("[data-nt-item]");
  if (it) {
    const key = it.dataset.ntItem;
    e.dataTransfer.setData(NOTE_DRAG, key === NOTE_DRAFT ? NOTE_DRAG_LINK : key);
    e.dataTransfer.effectAllowed = "copy";
    if (key !== NOTE_DRAFT) noteTextOf(key).catch(() => {}); // warm the cache for the drop
    return;
  }
  if (e.target.matches?.(".nt-ta")) e.dataTransfer.effectAllowed = "copy"; // text dragged out of a note is copied, never cut from it
});
desk.addEventListener("dragover", e => {
  if (!isNoteDrag(e)) return;
  const w = winOf(e.target); if (!w || w.kind !== "generate" || !w.shell) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "copy"; w.el.classList.add("drop");
  const ta = e.target.closest("textarea.gprompt"), at = ta && caretAt(ta, e.clientX, e.clientY);
  if (at != null) { ta.focus({ preventScroll: true }); ta.setSelectionRange(at, at); } // the caret shows where the note goes
});
desk.addEventListener("drop", async e => {
  if (!isNoteDrag(e)) return;
  const w = winOf(e.target); if (!w || w.kind !== "generate") return;
  e.preventDefault(); w.el.classList.remove("drop");
  const key = e.dataTransfer.getData(NOTE_DRAG), name = key === NOTE_DRAG_LINK ? "The note from the link" : key;
  const strip = e.target.closest("[data-strip]");
  if (strip) {
    const f = curModel(w)?.fields.find(x => x.name === strip.dataset.strip);
    genMsg(w, `${f?.label || "This input"} takes ${f ? f.accept.join(" or ") : "media"} files, not notes. Drop ${key === NOTE_DRAG_LINK ? "the note" : key} on the prompt instead.`);
    return;
  }
  const ta = e.target.closest("textarea.gprompt"), at = ta ? caretAt(ta, e.clientX, e.clientY) : null;
  let text;
  try { text = await noteTextOf(key); } catch (err) { genMsg(w, `Couldn't read ${name}: ${err.message}`); return; }
  if (!text.trim()) { genMsg(w, `${name} is empty.`, true); return; }
  focus(w); save();
  if (ta) { genMsg(w, null); promptInsert(ta, text, at != null ? { at } : {}); } else genTakeText(w, text);
});
desk.addEventListener("click", e => {
  const b = e.target.closest("[data-plib]"), w = b && winOf(b); if (!w) return;
  (b.dataset.plib === "pick" ? promptsMenu : promptSaveMenu)(w, b);
});
// Cmd+Shift+S (Ctrl+Shift+S off the Mac) in Generate: save the prompt as a new note. letterOf: the S key on any layout (AZERTY too)
addEventListener("keydown", ev => {
  if (!ev.shiftKey || ev.altKey || !(MAC ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey) || letterOf(ev) !== "s") return;
  const f = frontWin(); if (!f || f.kind !== "generate" || !f.shell || !menuEl.hidden || $("#notedlg")) return;
  ev.preventDefault(); promptSave(f);
});
S.opts = { ...OPT_DEFAULT };
try {
  const saved = JSON.parse(localStorage.getItem(OPT_KEY)) || {};
  if (!saved.theme && saved.desk === "#0b2e2e") delete saved.desk; // the old default desktop color now comes from the theme
  if (!saved.fontV2) { delete saved.font; delete saved.textPx; saved.fontV2 = true; } // readable smooth font became the default
  if (!saved.fontV3) { delete saved.font; saved.fontV3 = true; } // IBM Plex Sans became the default
  if (!saved.sizeV4) { delete saved.textPx; delete saved.textSize; saved.sizeV4 = true; } // bigger default text for the smooth fonts
  if (!saved.sizeV5) { if (saved.font !== "pixel" && +saved.textPx < 13) delete saved.textPx; saved.sizeV5 = true; } // sizes under 13 px came from the pixel-font marks and are too small for the outline fonts
  S.opts = { ...OPT_DEFAULT, ...saved };
} catch {}
reduced.addEventListener?.("change", applyOptions);
RENDER.compare = cmpRender;

// Alt+C compares the selection, Cmd+A selects everything in the list; Shift+arrows extend the selection (capture: before the plain arrow keys)
addEventListener("keydown", ev => {
  if (S.kb || !menuEl.hidden || !startMenu.hidden) return;
  const f = frontWin(), t = ev.target instanceof Element ? ev.target : document.body;
  if (!f || !MULTI.has(f.kind) || t.closest("input, textarea, select, [contenteditable], .dicon")) return;
  const cmd = MAC ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey, L = letterOf(ev);
  if (ev.altKey && !cmd && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && L === "c") { ev.preventDefault(); ev.stopPropagation(); compareSel(f); return; }
  if (cmd && !ev.altKey && !ev.shiftKey && L === "a") { ev.preventDefault(); ev.stopPropagation(); selectAll(f); return; }
  if (!ev.shiftKey || ev.altKey || ev.metaKey || ev.ctrlKey) return;
  const grid = f.kind !== "jobs";
  const d = { ArrowDown: grid ? 2 : 1, ArrowUp: grid ? -2 : -1, ArrowRight: grid ? 1 : 0, ArrowLeft: grid ? -1 : 0, Home: -1e6, End: 1e6 }[ev.key];
  if (!d) return;
  ev.preventDefault(); ev.stopPropagation();
  extendSel(f, d);
}, true);
desk.addEventListener("click", e => {
  const s = e.target.closest("[data-compare-sel]"); if (s) { compareSel(winOf(s), s); return; }
  const c = e.target.closest("[data-compare]"); if (c) compare(c.dataset.compare.split(","), c);
});
menuEl.addEventListener("click", e => {
  const b = e.target.closest("button[data-i]"); if (!b) return;
  const it = S.menuItems[+b.dataset.i]; hideMenu(); it.act();
});
menuEl.addEventListener("contextmenu", e => e.preventDefault());
menuEl.addEventListener("keydown", e => menuKeys(menuEl, e));
// capture phase: runs before the terminal, list and gallery keys, and swallows the keys it uses
addEventListener("keydown", e => {
  if (!S.kb || ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
  const { w, mode } = S.kb, dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (wins.get(w.id) !== w || w.minimized || w.max || (!dir && e.key !== "Enter" && e.key !== "Escape")) { kbEnd(true); return; } // any other key keeps the change and does its usual job
  e.preventDefault(); e.stopPropagation();
  if (!dir) { kbEnd(e.key === "Enter"); return; }
  const d = D(), [mw, mh] = minOf(w, d), st = e.shiftKey ? 1 : px(8);
  if (w.snapped) { // leaving a snapped layout: moving gets the size from before the snap back, as with the mouse
    if (mode === "move" && w.pre) Object.assign(w, { wd: w.pre.wd, ht: w.pre.ht });
    w.snapped = false; w.pre = null;
  }
  if (mode === "move") { w.x += dir[0] * st; w.y += dir[1] * st; }
  else { w.wd = clampN(w.wd + dir[0] * st, mw, d.w - w.x); w.ht = clampN(w.ht + dir[1] * st, mh, d.h - w.y); }
  fit(w); place(w);
}, true);
addEventListener("pointerdown", () => kbEnd(true), true);
navigator.keyboard?.getLayoutMap?.().then(m => { S.layoutMap = m; }).catch(() => {});
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) navigator.keyboard?.unlock?.(); });
addEventListener("paste", ev => {
  const f = frontWin(); if (!f || f.kind !== "generate" || !f.el.contains(document.activeElement) && document.activeElement !== document.body) return;
  const files = [...(ev.clipboardData?.files || [])];
  const typing = ev.target instanceof Element && ev.target.closest("input, textarea");
  if (files.length) { ev.preventDefault(); files.forEach(file => genUpload(f, file)); return; }
  if (typing) return;
  const text = (ev.clipboardData?.getData("text") || "").trim(), r = text && runOf(text);
  if (r) { ev.preventDefault(); genDropRun(f, text); }
  else if (text) genMsg(f, "To use a job as an input, select it in Jobs, a gallery or the Job tree and press Cmd+C first.", true);
});
// Options → Spending: the limit field saves on change (Enter or leaving the field)
document.addEventListener("change", e => {
  const el = e.target.closest?.("[data-limit]"); if (!el) return;
  const v = el.value.trim(), n = Math.round(+v), had = document.activeElement === el;
  setOpt("dailyLimit", v === "" || !(n >= 1) ? null : n);
  if (had) $("[data-limit]")?.focus({ preventScroll: true });
  spendRefresh();
});
addEventListener("contextmenu", e => {
  if (e.defaultPrevented || e.shiftKey) return; // handled by a more specific menu, or Shift asks for the browser's own
  e.preventDefault();
  const t = e.target instanceof Element ? e.target : document.body;
  if (t.closest(".boot, #shutdown, .menu")) return;
  const field = t.closest("input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea");
  if (field) { textMenu(field, e.clientX, e.clientY); return; }
  const term = t.closest(".term"), w = winOf(t);
  if (term && w) {
    const sel = String(getSelection()), inp = $(".t-in", term);
    showMenu(e.clientX, e.clientY, [
      { label: "Copy", icon: "i-copy", hint: "Cmd+C", disabled: !sel, act: () => copyText(sel, "Copied") },
      { label: "Paste", hint: "Cmd+V", act: () => pasteInto(inp) },
      { sep: true },
      { label: "Clear screen", hint: "Ctrl+L", act: () => { w.term.lines = []; termPaint(w); inp.focus(); } },
    ]);
    return;
  }
  if (w) { windowMenu(w, e.clientX, e.clientY); return; }
  if (t.closest("#desktop")) deskMenu(e.clientX, e.clientY);
});
desk.addEventListener("click", e => {
  const c = e.target.closest("[data-copy]");
  if (c) {
    const t = $(":scope > span", c) || c, label = t.textContent; // icon buttons keep their icon
    navigator.clipboard?.writeText(c.dataset.copy).then(() => { t.textContent = c.dataset.done || "Copied"; setTimeout(() => { t.textContent = label; }, 900); }).catch(() => {});
    return;
  }
  const fa = e.target.closest("[data-file]"); if (fa) { fileAction(fa.dataset.file, fa.dataset.name); return; }
  const f = e.target.closest("[data-filter]");
  if (f) { const w = winOf(f); w.filter = f.dataset.filter; renderWin(w); renderTasks(); save(); return; }
  const so = e.target.closest("[data-sort]");
  if (so) { const w = winOf(so); w.sort = w.sort.key === so.dataset.sort ? { key: so.dataset.sort, dir: -w.sort.dir } : { key: so.dataset.sort, dir: so.dataset.sort === "name" || so.dataset.sort === "type" || so.dataset.sort === "model" ? 1 : -1 }; RENDER.jobs(w); save(); return; }
  const tb = e.target.closest("[data-tab]"); if (tb) { const w = winOf(tb); w.tab = tb.dataset.tab; renderWin(w); save(); return; }
  const cl = e.target.closest("[data-close]"); if (cl) { close(winOf(cl)); return; }
  const g = e.target.closest("[data-gen]"); if (g) { const r = runOf(g.dataset.id); if (r) genFrom(r, g.dataset.gen, g); return; }
  const cx = e.target.closest("[data-cancel]"); if (cx) { const r = runOf(cx.dataset.cancel); if (r) cancelJob(r); return; }
  const s = e.target.closest("[data-step]"); if (s) { step(winOf(s), +s.dataset.step); return; }
  const o = e.target.closest("[data-open]"); if (o) { open(o.dataset.open, o.dataset.id || null, o); return; }
  const it = e.target.closest(".row[data-id], .tile[data-id], .tnode[data-id]");
  if (it) {
    const w = winOf(it); if (multiClick(w, it.dataset.id, e)) return;
    select(w, it.dataset.id);
    if (S.lastPointer === "touch" && runOf(it.dataset.id)) defaultOpen(runOf(it.dataset.id), it);
  }
});
desk.addEventListener("dblclick", e => {
  const it = e.target.closest(".row[data-id], .tile[data-id], .tnode[data-id]");
  if (it && runOf(it.dataset.id)) defaultOpen(runOf(it.dataset.id), it);
});
desk.addEventListener("contextmenu", e => {
  const it = e.target.closest(".row[data-id], .tile[data-id], .tnode[data-id]"), st = e.target.closest(".stage");
  const r = it ? runOf(it.dataset.id) : st ? runOf(winOf(st)?.arg) : null;
  if (!r) return;
  e.preventDefault();
  if (it) menuSelect(winOf(it), it.dataset.id);
  runMenu(r, e.clientX, e.clientY, it || st);
});

/* ---------- keyboard ---------- */
addEventListener("keydown", ev => {
  // key events can target window/document; treat those as coming from <body>
  const e = { key: ev.key, code: ev.code, altKey: ev.altKey, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, preventDefault: () => ev.preventDefault(), target: ev.target instanceof Element ? ev.target : document.body };
  if (e.key === "Escape" && e.ctrlKey) { e.preventDefault(); hideMenu(); setStart(startMenu.hidden); return; }
  if (e.key === "Escape") {
    if (!menuEl.hidden) { hideMenu(); return; }
    if (!startMenu.hidden) { setStart(false); startBtn.focus(); return; }
    const f = frontWin();
    if (f && (f.kind === "viewer" || f.kind === "props" || f.kind === "compare") && !e.target.closest("input")) close(f);
    return;
  }
  if (!menuEl.hidden || !startMenu.hidden) return;
  const f = frontWin();
  const cmd = MAC ? ev.metaKey && !e.ctrlKey : e.ctrlKey && !ev.metaKey, L = letterOf(ev);
  if ((e.altKey || cmd) && e.code === "Backquote") { // switch windows
    e.preventDefault();
    const list = [...wins.values()].sort((a, b) => b.z - a.z); if (list.length < 2) return;
    const next = e.shiftKey ? list[list.length - 1] : list.find(w => w !== f && !w.minimized) || list[1];
    next.minimized ? restore(next) : (focus(next), save(), focusInto(next));
    return;
  }
  if (e.code === "F11" || (MAC && ev.metaKey && e.ctrlKey && letterOf(ev) === "f")) { e.preventDefault(); toggleFullScreen(); return; }
  if (cmd && !e.altKey) {
    const typingNow = e.target.closest("input, textarea, select, [contenteditable]");
    const r = f && runOf(f.kind === "viewer" || f.kind === "props" ? f.arg : f.sel);
    if (L === "w" && f) { e.preventDefault(); close(f); return; } // arrives only in full screen with the keyboard locked
    if (L === "m" && f && !e.shiftKey) { e.preventDefault(); minimize(f); return; }
    if (e.key === ",") { e.preventDefault(); open("options"); return; }
    if (e.key === "?" || (e.code === "Slash" && e.shiftKey)) { e.preventDefault(); open("keys"); return; }
    if (L === "i" && r && !typingNow) { e.preventDefault(); open("props", r.taskId); return; }
    if ((L === "o" || e.code === "ArrowDown") && r && !typingNow && f.kind !== "viewer") { e.preventDefault(); defaultOpen(r); return; }
    if (L === "f" && !e.shiftKey && typingNow?.tagName !== "TEXTAREA") {
      const box = f && $('input[type="search"]', f.body);
      e.preventDefault();
      if (box) { box.focus(); box.select(); } else { const j = open("jobs"); setTimeout(() => $('input[type="search"]', j.body)?.focus(), 0); }
      return;
    }
  }
  if (e.altKey && (L === "w" || e.code === "F4") && f) { e.preventDefault(); close(f); return; }
  const typing = e.target.closest("input, textarea, select, [contenteditable]");
  if (!typing && (e.code === "F1" || (e.key === "?" && !e.altKey && !ev.metaKey && !e.ctrlKey))) { e.preventDefault(); open("keys"); return; }
  if (e.altKey && !typing && !ev.metaKey && !e.ctrlKey) {
    if (f && e.code === "ArrowDown") { e.preventDefault(); minimize(f); return; }
    if (f && e.code === "ArrowUp") { e.preventDefault(); if (f.max || f.snapped) toggleMax(f); else { f.max = true; place(f); save(); } return; }
    if (f && (e.code === "ArrowLeft" || e.code === "ArrowRight")) { e.preventDefault(); snapHalf(f, e.code === "ArrowLeft" ? "left" : "right"); return; }
    const want = (e.shiftKey ? "Shift+" : "") + (e.code === "Slash" ? "/" : /^[a-z]$/.test(L) ? L.toUpperCase() : "");
    const app = Object.keys(APP_KEYS).find(k => APP_KEYS[k] === want && KINDS[k]);
    if (app) { e.preventDefault(); open(app); return; }
  }
  if (((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") && !typing && f) {
    const r = runOf(f.kind === "viewer" || f.kind === "props" ? f.arg : f.sel);
    const el = (f.sel && $$("[data-id]", f.body).find(x => x.dataset.id === f.sel && x.offsetParent)) || $(".titlebar", f.el), b = el.getBoundingClientRect();
    e.preventDefault();
    r ? runMenu(r, b.left + 8, b.bottom - 4, el) : windowMenu(f, b.left + 8, b.bottom - 4);
    return;
  }
  if ((ev.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && L === "c" && !typing && f && !String(getSelection())) {
    const r = runOf(f.kind === "viewer" || f.kind === "props" ? f.arg : f.sel);
    if (r) { e.preventDefault(); copyJob(r); return; }
  }
  if (e.altKey && e.code === "Space" && f) { e.preventDefault(); const r = $(".titlebar", f.el).getBoundingClientRect(); windowMenu(f, r.left + 4, r.bottom); return; }
  if (e.target.closest("input, textarea")) return;
  if (!f) return;
  const sel = runOf(f.sel);
  if ((f.kind === "jobs" || f.kind === "images" || f.kind === "videos" || f.kind === "audio") && !e.target.closest(".dicon")) {
    const grid = f.kind !== "jobs";
    if (e.key === "ArrowDown") { e.preventDefault(); moveSel(f, grid ? 2 : 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(f, grid ? -2 : -1); }
    else if (grid && e.key === "ArrowRight") { e.preventDefault(); moveSel(f, 1); }
    else if (grid && e.key === "ArrowLeft") { e.preventDefault(); moveSel(f, -1); }
    else if (e.key === "Home") { e.preventDefault(); moveSel(f, -1e6); }
    else if (e.key === "End") { e.preventDefault(); moveSel(f, 1e6); }
    else if (e.key === "Enter" && sel && !e.target.closest("button")) { e.preventDefault(); e.altKey ? open("props", sel.taskId) : defaultOpen(sel); }
    return;
  }
  if (f.kind === "tree" && !e.target.closest(".dicon")) {
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); treeMove(f, e.key); }
    else if (e.key === "Enter" && sel && !e.target.closest("button")) { e.preventDefault(); e.altKey ? open("props", sel.taskId) : defaultOpen(sel); }
    return;
  }
  if (f.kind === "viewer") {
    const v = $("video, audio", f.el), r = runOf(f.arg);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); step(f, e.key === "ArrowLeft" ? -1 : 1); }
    else if (e.key === "Enter" && e.altKey && r) { e.preventDefault(); open("props", r.taskId); }
    else if (v && e.target !== v && e.key === " ") { e.preventDefault(); v.paused ? v.play() : v.pause(); }
    else if (v && (e.key === "m" || e.key === "M")) v.muted = !v.muted;
    else if (v && (e.key === "," || e.key === ".")) { v.pause(); v.currentTime = clampN(v.currentTime + (e.key === "." ? 1 : -1) / 24, 0, v.duration || 0); }
  }
});
if (firstLaunch) ready.then(() => { if (!S.data.live) $(".kin", open("key").body)?.focus({ preventScroll: true }); });
// jobs keep rendering on Runway across a refresh or restart (the server tracks them in runs.json):
// if any are still queued or rendering, bring Activity back so they stay in view, without taking focus
ready.then(() => {
  if (wins.has("activity") || !S.data.runs.some(r => ACTIVE.has(r.status))) return;
  const prev = frontWin(), aw = open("activity");
  if (prev && prev !== aw) { focus(prev); focusInto(prev); }
});
SIG.options = () => "";
SIG.terminal = () => "";
SIG.usage = () => "";
SIG.notes = () => "";
SIG.images = w => JSON.stringify(assetsOf("image").map(r => [r.taskId, r.asset, r.prompt]));
SIG.videos = w => JSON.stringify(assetsOf("video").map(r => [r.taskId, r.asset, r.prompt]));
SIG.audio = w => JSON.stringify(assetsOf("audio").map(r => [r.taskId, r.asset, r.prompt]));
SIG.props = w => { const r = runOf(w.arg); return r ? [runSig(r), runSig(runOf(r.parent)), ...childrenOf(r.taskId).map(runSig)].join("|") : "-"; };
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll().finally(schedulePoll); });
poll();
applyOptions();
document.getElementById("i-logo").innerHTML = logoSVG("#ffffff").replace(/^<svg[^>]*>|<\/svg>$/g, "");
$("#favicon").href = "data:image/svg+xml," + encodeURIComponent(FAV.idle);
bootScreen(modelsLoaded);
restoreLayout();
renderTasks();
layoutIcons();
document.fonts?.ready.then(layoutIcons);
tick();
setInterval(tick, 5000);
schedulePoll();
window.__rwosReady = true;
