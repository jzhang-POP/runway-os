import { S, wins } from "../core/state.js";
import { $, $$, clampN, esc, fmt } from "../core/dom.js";
import { createdMs } from "../core/status.js";
import { px } from "../wm/geometry.js";
import { RENDER, SIG } from "../wm/kinds.js";
import { save } from "../wm/persist.js";
import { renderTasks } from "../wm/taskbar.js";
import { retitle } from "../wm/windows.js";

/* ---------- usage: credits spent per day and model (whole org, from Runway) and per task (your jobs) ---------- */
// the eight colors are CSS variables (--uc1..--uc8 in index.html), so a theme switch recolors the chart live
export const USAGE_COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map(i => `var(--uc${i})`);
export const usageCache = {};
export async function usageLoad(days, force) {
  const hit = usageCache[days];
  if (hit && !force && Date.now() - hit.at < 300000) return hit.data;
  const res = await fetch(`/api/usage?days=${days}`, { cache: "no-store" });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `The server answered ${res.status}.`);
  usageCache[days] = { at: Date.now(), data: out };
  return out;
}
// totals per model and per day, with the top models kept and the rest grouped as "other"
export function usageSummary(u, top = 7) {
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
export const usageMD = date => date.slice(5).replace("-", "/"); // 2026-11-14 → 11/14, as on the chart's axis
export const usageLong = date => new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
// the model filter: one model, or "other" for every model past the top seven
export const usageIn = (sum, f, m) => !f || (f === "other" ? !sum.keep.includes(m) : m === f);
export const usageName = f => (f === "other" ? "other models" : f);
// stacked bars drawn at the box's real pixel size (W × H), so labels stay at the text size; one focusable column per day
export function usageChart(sum, { W, H, f, sel, at }) {
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
export function usageDraw(w) {
  const sum = w.usum, host = $(".uchart", w.body); if (!sum || !host) return;
  const W = host.clientWidth, H = host.clientHeight; if (!W || !H) return; // minimized: draw when it's shown again
  const a = document.activeElement, back = host.contains(a) ? a.dataset.date : null;
  w.usize = `${W}x${H}x${S.scale}`;
  host.innerHTML = usageChart(sum, { W, H, f: w.umodel, sel: w.uday, at: back });
  if (back) $(`[data-date="${back}"]`, host)?.focus();
}
// apply the model filter and the inspected day: pressed states, the "Showing" line, the day's breakdown, the chart
export function usageView(w) {
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
export function usageCSV(u) {
  const rows = [["date", "model", "credits"]];
  (u.results || []).forEach(r => (r.usedCredits || []).forEach(i => rows.push([r.date, i.model, i.amount])));
  const blob = new Blob([rows.map(r => r.join(",")).join("\n") + "\n"], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `runway-usage_${u.startDate}_to_${u.beforeDate}.csv` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// your own jobs from runs.json, grouped by task, for the same range
export function usageMine(days) {
  const since = Date.now() - days * 86400000, by = {};
  S.data.runs.filter(r => r.credits != null && createdMs(r) >= since).forEach(r => {
    const k = r.task || (r.type === "image" ? "Text to image" : r.parent ? "Image to video" : "Text to video");
    (by[k] ||= { credits: 0, jobs: 0 }); by[k].credits += r.credits; by[k].jobs++;
  });
  return Object.entries(by).sort((a, b) => b[1].credits - a[1].credits);
}

export async function usageRender(w, force) {
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

export function init() {
  RENDER.usage = w => usageRender(w);
  SIG.usage = () => "";
}
