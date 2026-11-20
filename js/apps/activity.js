import { S, wins } from "../core/state.js";
import { $, $$, cap, esc, fmt, icoLabel } from "../core/dom.js";
import { morph } from "../core/morph.js";
import { ACTIVE, createdMs, etaText, miniThumb, progressHTML, relHTML, runOf, statusInfo, typeIcon, typicalMs } from "../core/status.js";
import { GEN_BTN, emptyAct } from "../core/ui.js";
import { D, px } from "../wm/geometry.js";
import { KINDS, RENDER } from "../wm/kinds.js";
import { save } from "../wm/persist.js";
import { defaultOpen, fit, focus, open, place } from "../wm/windows.js";
import { cancelJob } from "./generate.js";
import { poll } from "../live.js";

/* ---------- Activity: jobs in progress and recently finished, like a download manager ---------- */
export const fresh = {}; // rows the server just returned from /api/generate, shown until a poll brings them from runs.json
export const sentRun = (w, id) => runOf(id) || fresh[id];
// every queued or rendering job, then finished ones from the last 24 h that weren't cleared, newest first
export function activityList(w) {
  const since = Math.max(Date.now() - 86400000, w.act?.clearedAt || 0), hide = new Set(w.act?.hide || []);
  const ids = new Set(S.data.runs.map(r => r.taskId));
  const rows = [...S.data.runs, ...Object.values(fresh).filter(r => !ids.has(r.taskId))];
  return rows.filter(r => !hide.has(r.taskId) && (ACTIVE.has(r.status) || createdMs(r) >= since))
    .sort((a, b) => (ACTIVE.has(b.status) - ACTIVE.has(a.status)) || createdMs(b) - createdMs(a)).slice(0, 20);
}
export function genSentItem(w, r) {
  const s = statusInfo(r), id = esc(r.taskId), name = `${r.task || cap(r.type)} · ${r.model}`;
  let st = `<span class="st ${s.cls}"><i class="dot"></i>${esc(s.label)}</span>`, acts = "";
  if (ACTIVE.has(r.status)) {
    st += progressHTML(r, s);
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
export function activityRender(w) {
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
export function activityShow(gw, row) {
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

export function init() {
  RENDER.activity = w => activityRender(w);
  setInterval(() => $$(".act [data-eta]").forEach(e => { e.textContent = etaText(+e.dataset.eta); }), 5000);
}
