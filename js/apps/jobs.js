import { S } from "../core/state.js";
import { $, $$, cap, esc, fmt } from "../core/dom.js";
import { morph } from "../core/morph.js";
import { costHTML, costOf, createdMs, fileItem, filesOf, miniThumb, plural, relHTML, statusHTML } from "../core/status.js";
import { GEN_BTN, emptyAct, itemId, loadingOr } from "../core/ui.js";
import { RENDER } from "../wm/kinds.js";
import { save } from "../wm/persist.js";
import { CMP_BTN, activeSync, cmpBtnSync, isSel, selNote } from "../wm/selection.js";

/* jobs table */
export const COLS = [
  { key: "name", label: "Name", get: r => r.prompt.toLowerCase() },
  { key: "type", label: "Type", get: r => r.type },
  { key: "model", label: "Model", get: r => r.model },
  { key: "status", label: "Status", get: r => ["running", "throttled", "pending", "failed", "cancelled", "succeeded"].indexOf(r.status) },
  { key: "cost", label: "Credits", num: true, get: r => costOf(r) ?? -1 },
  { key: "created", label: "Created", get: r => createdMs(r) },
];
export function jobsFor(w) {
  const q = w.q.trim().toLowerCase(), col = COLS.find(c => c.key === w.sort.key) || COLS[5];
  return S.data.runs
    .filter(r => (w.filter === "all" || r.type === w.filter) && (!q || [r.prompt, r.model, r.taskId, r.asset, r.settings].some(v => String(v || "").toLowerCase().includes(q))))
    .sort((a, b) => { const x = col.get(a), y = col.get(b); return (x < y ? -1 : x > y ? 1 : 0) * w.sort.dir || createdMs(b) - createdMs(a); });
}
export function jobsRender(w) {
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
    // typing: filter once the keys pause for a moment, not on every key
    $(".field", w.body).addEventListener("input", e => {
      w.q = e.target.value; clearTimeout(w.qT);
      w.qT = setTimeout(() => { RENDER.jobs(w); save(); }, 120);
    });
    // empty list: "Clear search" empties the search box and puts the cursor back in it
    $(".rows", w.body).addEventListener("click", e => {
      if (!e.target.closest("[data-clearq]")) return;
      const f = $(".field", w.body); clearTimeout(w.qT); f.value = w.q = ""; RENDER.jobs(w); save(); f.focus();
    });
  }
  const list = jobsFor(w), types = ["all", ...new Set(S.data.runs.map(r => r.type))];
  morph($(".seg-tabs", w.body), types.map(t => `<button class="raised" data-filter="${esc(t)}" aria-pressed="${t === w.filter}">${t === "all" ? "All" : esc(plural(t))}</button>`).join(""));
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

export function init() {
  RENDER.jobs = jobsRender;
}
