import { S, wins } from "../core/state.js";
import { $, $$, clampN, desk, esc, startBtn } from "../core/dom.js";
import { D, px } from "./geometry.js";
import { KINDS, RENDER } from "./kinds.js";
import { save } from "./persist.js";
import { renderTasks, taskBtn } from "./taskbar.js";
import { layoutIcons } from "../desktop/icons.js";
import { calm } from "../apps/options.js";
import { windowMenu } from "../menus.js";

export const SNAP = 6;
export const minOf = (w, d) => [Math.min(Math.max(px(KINDS[w.kind].min[0]), w.minW || 0), d.w), Math.min(px(KINDS[w.kind].min[1]), d.h)];

/* ---------- window lifecycle ---------- */
export function make(kind, arg, g = {}) {
  const id = arg ? `${kind}:${arg}` : kind, tid = "tt-" + ++S.uid;
  const el = document.createElement("section");
  el.className = "window raised";
  el.dataset.id = id;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-labelledby", tid);
  el.tabIndex = -1; // focus can rest on the window itself when it has no control to take it
  el.innerHTML = `
      <div class="titlebar"><span class="t"><svg class="ico ticon" title="Double-click to close"><use href="#i-film"/></svg><span class="tt" id="${tid}"></span></span>
        <span class="ctl"><button class="raised" data-act="min" aria-label="Minimize" title="Minimize"><i class="g-min"></i></button><button class="raised" data-act="max" aria-label="Maximize" title="Maximize"><i class="g-max"></i></button><span class="ctl-gap"></span><button class="raised" data-act="close" aria-label="Close" title="Close (Alt+W)"><i class="g-close"></i></button></span></div>
      <div class="wbody"></div>
      ${["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(d => `<div class="rz ${d}" data-dir="${d}"></div>`).join("")}`;
  const num = (v, f) => (Number.isFinite(v) ? v : f);
  const w = {
    id, kind, arg: arg || null, el, body: $(".wbody", el), prev: null, rendered: null, shell: false,
    x: num(g.x, 40), y: num(g.y, 40), wd: num(g.wd, 480), ht: num(g.ht, 320),
    max: !!g.max, minimized: !!g.minimized, snapped: !!g.snapped, pre: g.pre || null,
    filter: g.filter || "all", q: g.q || "", sort: g.sort || { key: "created", dir: -1 }, size: num(g.size, 132), sel: g.sel || null, tab: g.tab || "general", days: [7, 30, 90].includes(g.days) ? g.days : undefined, act: g.act, solo: !!g.solo, cmp: g.cmp || null,
    gen: { cat: "Video", ep: {}, model: {}, vals: {}, media: {}, adv: false, pending: null, ...(g.gen || {}) },
  };
  w.seq = num(g.seq, ++S.seqTop); S.seqTop = Math.max(S.seqTop, w.seq);
  w.z = ++S.zTop;
  wins.set(id, w);
  desk.append(el);
  bind(w);
  // remember the control used last, to give it focus again when the window comes back to the front;
  // Tab moving focus into a window behind others brings that window to the front
  el.addEventListener("focusin", e => {
    if (w.body.contains(e.target)) w.lastFocus = e.target;
    if (S.tabbing && !w.minimized && w !== frontWin()) { focus(w); save(); }
  });
  // a title bar press keeps focus where it is (for dragging): bring it in when it's in another window (not on touch, to keep the keyboard down)
  $(".titlebar", el).addEventListener("pointerdown", e => { if (e.pointerType !== "touch" && !e.target.closest(".ctl") && !el.contains(document.activeElement)) focusInto(w); });
  fit(w); place(w); renderWin(w);
  return w;
}

export function open(kind, arg, src) {
  const id = arg ? `${kind}:${arg}` : kind, have = wins.get(id);
  if (have) { have.minimized ? restore(have) : (focus(have), save(), focusInto(have)); return have; }
  const d = D(), w = make(kind, arg, { ...KINDS[kind].geo(d), max: d.w < 600 });
  focus(w); save();
  flyIn(w, src?.getBoundingClientRect());
  return w;
}
export const defaultOpen = (r, src) => open(r.asset ? "viewer" : "props", r.taskId, src);

export function close(w) { w.el.remove(); wins.delete(w.id); refreshFront(); save(); refocus(() => startBtn); }
export function minimize(w, animate = true) {
  const from = $(".titlebar", w.el).getBoundingClientRect();
  w.minimized = true; place(w); refreshFront(); save(); refocus(() => taskBtn(w));
  if (animate) fly(from, taskBtn(w)?.getBoundingClientRect(), w);
}
export function restore(w) { w.minimized = false; place(w); focus(w); save(); flyIn(w, taskBtn(w)?.getBoundingClientRect()); }
export function toggleMax(w) {
  if (w.snapped && !w.max) { unsnap(w); place(w); save(); return; }
  w.max = !w.max; place(w); focus(w); save();
}
export function unsnap(w) {
  if (w.pre) Object.assign(w, { wd: w.pre.wd, ht: w.pre.ht, x: w.pre.x, y: w.pre.y });
  w.snapped = false; w.pre = null; fit(w);
}

export const frontWin = () => [...wins.values()].filter(w => !w.minimized).sort((a, b) => b.z - a.z)[0] || null;
export function focus(w) {
  if (w.z !== S.zTop) { w.z = ++S.zTop; w.el.style.zIndex = w.z; }
  refreshFront();
}
export function refreshFront() {
  const f = frontWin();
  wins.forEach(w => w.el.classList.toggle("front", w === f));
  renderTasks();
}
// keyboard focus follows the front window: the control used last, else the window's main control, else its first one, else the window itself
export const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, audio[controls], video[controls], [tabindex]:not([tabindex="-1"])';
export function focusInto(w) {
  if (!w || w.minimized || wins.get(w.id) !== w) return;
  const b = w.body, last = w.lastFocus?.isConnected && b.contains(w.lastFocus) ? w.lastFocus : null;
  for (const el of [last, $(".t-in", b), $("textarea", b), $(".table", b), $(".gridwrap", b), $(".tree-wrap:not(.empty)", b), ...$$(FOCUSABLE, b), w.el]) {
    if (!el) continue;
    el.focus({ preventScroll: true });
    if (document.activeElement === el) return; // hidden or disabled controls refuse focus: try the next one
  }
}
// after a close or minimize, once the caller is done (it may raise another window): focus the front window, else none()
export const refocus = none => queueMicrotask(() => { const f = frontWin(); f ? focusInto(f) : none()?.focus(); });

/* ---------- geometry ---------- */
export function fit(w) {
  const d = D(), [mw, mh] = minOf(w, d);
  w.wd = Math.round(clampN(w.wd, mw, d.w));
  w.ht = Math.round(clampN(w.ht, mh, d.h));
  w.x = Math.round(clampN(w.x, 0, d.w - w.wd));
  w.y = Math.round(clampN(w.y, 0, d.h - w.ht));
}
// Properties: measure the one-line button row and keep the window at least that wide
export function fitActions(w) {
  const rows = $$(".pwrap .actions", w.body), p = rows[0]?.parentElement;
  if (!p || !p.clientWidth) return;
  const ps = getComputedStyle(p), width = a => { const kids = [...a.children], gap = parseFloat(getComputedStyle(a).columnGap) || 0; return kids.reduce((s, b) => s + b.getBoundingClientRect().width, 0) + gap * Math.max(0, kids.length - 1); };
  w.minW = Math.ceil(Math.max(...rows.map(width)) + parseFloat(ps.paddingLeft) + parseFloat(ps.paddingRight) + w.el.offsetWidth - p.clientWidth);
  rows.forEach(a => a.classList.toggle("wrap", w.minW > D().w)); // at large Scale sizes the icon buttons wrap instead of running off screen
  if (!w.max && w.wd < w.minW) { fit(w); place(w); }
}
export function place(w) {
  const d = D(), s = w.el.style, g = w.max ? { x: 0, y: 0, wd: d.w, ht: d.h } : w;
  s.left = g.x + "px"; s.top = g.y + "px"; s.width = g.wd + "px"; s.height = g.ht + "px"; s.zIndex = w.z;
  w.el.classList.toggle("max", w.max);
  w.el.hidden = w.minimized;
  const mb = $('[data-act="max"]', w.el), label = w.max ? "Restore" : "Maximize";
  if (mb.title !== label) { mb.title = label; mb.setAttribute("aria-label", label); }
}

export const preview = $("#snap");
export function snapZone(cx, cy, d) {
  if (cy <= SNAP) return { x: 0, y: 0, wd: d.w, ht: d.h, max: true };
  if (cx <= SNAP) return { x: 0, y: 0, wd: Math.round(d.w / 2), ht: d.h };
  if (cx >= d.w - SNAP) return { x: d.w - Math.round(d.w / 2), y: 0, wd: Math.round(d.w / 2), ht: d.h };
  return null;
}

// move (mode "move") or resize (mode = edge letters), with pointer capture and a drag threshold
export function gesture(w, e, mode) {
  if (e.button !== 0 || (w.max && mode !== "move")) return;
  e.preventDefault();
  const t = e.currentTarget, d = D(), dr = desk.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY, [mw, mh] = minOf(w, d);
  const threshold = e.pointerType === "touch" ? 8 : 4;
  let s = { x: w.x, y: w.y, wd: w.wd, ht: w.ht }, started = false, zone = null, raf = 0, last = null;
  t.setPointerCapture(e.pointerId);
  const apply = () => {
    raf = 0;
    const ev = last, dx = Math.round(ev.clientX - sx), dy = Math.round(ev.clientY - sy);
    if (mode === "move") {
      w.x = clampN(s.x + dx, 0, d.w - s.wd); w.y = clampN(s.y + dy, 0, d.h - s.ht);
      zone = snapZone(ev.clientX - dr.left, ev.clientY - dr.top, d);
      preview.hidden = !zone;
      if (zone) Object.assign(preview.style, { left: zone.x + "px", top: zone.y + "px", width: zone.wd + "px", height: zone.ht + "px" });
    } else {
      if (mode.includes("e")) w.wd = clampN(s.wd + dx, mw, d.w - s.x);
      if (mode.includes("s")) w.ht = clampN(s.ht + dy, mh, d.h - s.y);
      if (mode.includes("w")) { const nx = clampN(s.x + dx, 0, s.x + s.wd - mw); w.wd = s.wd + s.x - nx; w.x = nx; }
      if (mode.includes("n")) { const ny = clampN(s.y + dy, 0, s.y + s.ht - mh); w.ht = s.ht + s.y - ny; w.y = ny; }
      w.snapped = false; w.pre = null;
    }
    place(w);
  };
  const move = ev => {
    if (!started) {
      if (Math.abs(ev.clientX - sx) < threshold && Math.abs(ev.clientY - sy) < threshold) return;
      started = true; document.body.classList.add("dragging"); w.el.classList.add("busy");
      if (mode === "move" && (w.max || w.snapped)) {
        // pulling a maximized or snapped window off the edge restores its size under the cursor
        const ratio = clampN((sx - w.el.getBoundingClientRect().left) / w.el.offsetWidth, 0, 1);
        if (w.snapped) unsnap(w);
        w.max = false;
        s = { wd: w.wd, ht: w.ht, x: Math.round(sx - dr.left - w.wd * ratio), y: Math.round(sy - dr.top - 12) };
      }
    }
    last = ev;
    if (!raf) raf = requestAnimationFrame(apply);
  };
  const up = () => {
    t.removeEventListener("pointermove", move);
    if (raf) { cancelAnimationFrame(raf); apply(); }
    document.body.classList.remove("dragging"); w.el.classList.remove("busy"); preview.hidden = true;
    if (!started) return;
    if (zone) {
      if (zone.max) w.max = true;
      else { w.pre = { x: w.x, y: w.y, wd: s.wd, ht: s.ht }; Object.assign(w, { x: zone.x, y: zone.y, wd: zone.wd, ht: zone.ht, snapped: true }); }
      place(w);
    }
    save();
  };
  t.addEventListener("pointermove", move);
  t.addEventListener("pointerup", up, { once: true });
  t.addEventListener("pointercancel", up, { once: true });
}

export function bind(w) {
  const el = w.el, bar = $(".titlebar", el);
  el.addEventListener("pointerdown", () => focus(w), true);
  bar.addEventListener("pointerdown", e => { if (!e.target.closest(".ctl")) gesture(w, e, "move"); });
  bar.addEventListener("dblclick", e => {
    if (e.target.closest(".ctl")) return;
    e.target.closest(".ticon") ? close(w) : toggleMax(w);
  });
  bar.addEventListener("contextmenu", e => { if (!e.target.closest(".ctl")) { e.preventDefault(); windowMenu(w, e.clientX, e.clientY); } });
  $$(".rz", el).forEach(h => h.addEventListener("pointerdown", e => gesture(w, e, h.dataset.dir)));
  $(".ctl", el).addEventListener("click", e => {
    const b = e.target.closest("button[data-act]");
    if (b) ({ min: minimize, max: toggleMax, close })[b.dataset.act](w);
  });
  $(".ctl", el).addEventListener("dblclick", e => e.stopPropagation());
}

/* ---------- caption flight (Win95 minimize/restore animation) ---------- */
export function fly(a, b, w) {
  if (calm() || !a || !b || !a.width || !b.width) return Promise.resolve();
  const o = document.createElement("div");
  o.className = "flycap";
  o.innerHTML = `<svg class="ico"><use href="#${KINDS[w.kind].icon(w)}"/></svg><span>${esc(KINDS[w.kind].title(w))}</span>`;
  document.body.append(o);
  const kf = [a, b].map(r => ({ left: r.left + "px", top: r.top + "px", width: r.width + "px", height: Math.min(r.height, px(22)) + "px" }));
  const anim = o.animate(kf, { duration: 220, easing: "linear", fill: "forwards" });
  return new Promise(res => {
    let done = false;
    const end = () => { if (done) return; done = true; o.remove(); res(); };
    anim.onfinish = end; anim.oncancel = end;
    setTimeout(end, 500); // never leave a stray caption if the timeline stalls
  });
}
// the window takes keyboard focus once it shows (a hidden one can't), unless focus went elsewhere during the flight
export function flyIn(w, from) {
  if (calm() || !from) { focusInto(w); return; }
  w.el.style.visibility = "hidden";
  const was = document.activeElement;
  fly(from, $(".titlebar", w.el).getBoundingClientRect(), w).then(() => {
    w.el.style.visibility = "";
    const a = document.activeElement;
    if (frontWin() === w && (a === was || a === document.body || w.el.contains(a))) focusInto(w);
  });
}

/* ---------- rendering ---------- */
export function retitle(w) {
  const K = KINDS[w.kind];
  $(".tt", w.el).textContent = K.title(w);
  $(".t use", w.el).setAttribute("href", "#" + K.icon(w));
}
export function renderWin(w) {
  retitle(w);
  const keep = $$("[data-keep]", w.body).map(e => [e.dataset.keep, e.scrollTop, e.scrollLeft]);
  RENDER[w.kind](w);
  keep.forEach(([k, top, left]) => { const e = $(`[data-keep="${k}"]`, w.body); if (e) { e.scrollTop = top; e.scrollLeft = left; } });
}

export function cascadeAll() {
  const d = D(), list = [...wins.values()].sort((a, b) => a.z - b.z);
  list.forEach((w, i) => {
    Object.assign(w, { minimized: false, max: false, snapped: false, pre: null, x: px(104 + i * 26), y: px(12 + i * 26), wd: Math.min(w.wd, Math.round(d.w * .62)), ht: Math.min(w.ht, Math.round(d.h * .7)) });
    fit(w); place(w);
  });
  refreshFront(); save();
}
export function tileAll() {
  const d = D(), list = [...wins.values()].sort((a, b) => a.seq - b.seq);
  if (!list.length) return;
  const cols = Math.ceil(Math.sqrt(list.length)), rows = Math.ceil(list.length / cols), cw = Math.floor(d.w / cols), rh = Math.floor(d.h / rows);
  list.forEach((w, i) => {
    Object.assign(w, { minimized: false, max: false, snapped: false, pre: null, x: (i % cols) * cw, y: Math.floor(i / cols) * rh, wd: cw, ht: rh });
    fit(w); place(w);
  });
  refreshFront(); save();
}
export function snapHalf(w, side) {
  const d = D();
  if (w.minimized) restore(w);
  if (!w.snapped) w.pre = { x: w.x, y: w.y, wd: w.wd, ht: w.ht };
  const half = Math.round(d.w / 2);
  Object.assign(w, { max: false, snapped: true, x: side === "left" ? 0 : d.w - half, y: 0, wd: half, ht: d.h });
  place(w); focus(w); save();
}

/* ---------- clicks inside windows ---------- */
export const winOf = el => wins.get(el.closest(".window")?.dataset.id);

export function init() {
  // true while a Tab keypress moves focus
  addEventListener("keydown", e => { S.tabbing = e.key === "Tab"; }, true);
  addEventListener("keyup", () => { S.tabbing = false; }, true);
  addEventListener("resize", () => { wins.forEach(w => { fit(w); place(w); }); layoutIcons(); });
}
