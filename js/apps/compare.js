import { S } from "../core/state.js";
import { $, $$, cap, clampN, desk, esc, fmt, menuEl, startMenu } from "../core/dom.js";
import { morph } from "../core/morph.js";
import { ACTIVE, costHTML, costOf, createdMs, filesOf, nameOf, runOf, statusHTML, statusInfo, thumbOf, typeIcon } from "../core/status.js";
import { absTime, tOf } from "../core/time.js";
import { balloon, loadingOr } from "../core/ui.js";
import { RENDER } from "../wm/kinds.js";
import { save } from "../wm/persist.js";
import { CMP_MAX, MULTI, cmpBase, extendSel, isSel, selIds, selectAll } from "../wm/selection.js";
import { defaultOpen, frontWin, open, renderWin, winOf } from "../wm/windows.js";
import { runMenu } from "../menus.js";
import { MAC, letterOf } from "../shortcuts.js";

export function compare(ids, src) {
  ids = [...new Set(ids)].filter(id => runOf(id));
  if (ids.length < 2) return null;
  if (ids.length > CMP_MAX) { balloon({ title: "Compare", text: `Showing the first ${CMP_MAX} of ${ids.length} files.`, icon: "i-compare", ms: 5000 }); ids = ids.slice(0, CMP_MAX); }
  return open("compare", ids.join(","), src);
}
export function compareSel(w, src) {
  if (compare(selIds(w), src)) return;
  balloon({ title: "Compare", text: "Pick two or more first: Cmd+click or Shift+click them.", icon: "i-compare", ms: 5000 });
}
// job menu entries: the selection, the files of a multi-output job, the job and its source, the jobs made from the same source
export function cmpMenu(r, src) {
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
export const cmpOpts = w => (w.cmp ||= { mode: "side", sync: true, actual: false, at: 0.5, swap: false });
export function cmpItems(w) {
  const ids = cmpIds(w.arg);
  if (cmpOpts(w).swap && ids.length === 2) ids.reverse();
  return ids.map((id, i) => ({ id, r: runOf(id), letter: i < 26 ? String.fromCharCode(65 + i) : String(i + 1) }));
}
// "diff" when the known values don't all match, "same" when they do, "" with fewer than two
export const diffCls = vals => { const k = vals.filter(v => v != null); return k.length < 2 ? "" : k.every(v => v === k[0]) ? "same" : "diff"; };
export function cmpInfo(w, items) {
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
export function cmpFrameHTML(x, o) {
  const r = x.r, id = esc(x.id);
  if (!r) return `<div class="cmp-frame sunken none">This job is no longer in runs.json.</div>`;
  if (!r.asset) return `<div class="cmp-frame sunken none"><span><svg class="ico big" aria-hidden="true"><use href="#${typeIcon(r.type)}"/></svg>${ACTIVE.has(r.status) ? "The file shows here when the job finishes." : "No file"}</span></div>`;
  const src = encodeURI(r.asset);
  if (r.type === "audio") return `<div class="cmp-frame sunken audio" data-id="${id}"><svg class="aud-ico" aria-hidden="true"><use href="#i-audio"/></svg><audio src="${src}" controls preload="metadata" data-size-of="${id}"></audio></div>`;
  if (r.type === "video") return `<div class="cmp-frame sunken checker" data-id="${id}" draggable="true"><video src="${src}" poster="${thumbOf(r)}" controls muted playsinline preload="auto"${o.sync ? "" : " loop"} data-size-of="${id}"></video></div>`;
  return `<div class="cmp-frame sunken checker${o.actual ? " actual" : ""}" data-id="${id}"${o.actual ? "" : ' draggable="true"'} title="${o.actual ? "Drag to look around: all the images follow" : ""}"><img src="${src}" alt="${esc(r.prompt)}" draggable="false" data-size-of="${id}"></div>`;
}
export const cmpColHTML = (w, x, frame) => `
    <div class="cmp-col" data-col="${esc(x.id)}">
      <div class="cmp-head" data-id="${esc(x.id)}"${x.r?.asset ? ' draggable="true"' : ""} title="${esc(x.r?.prompt || "")}"><b class="cmp-letter">${x.letter}</b><span class="nm1">${esc(x.r ? nameOf(x.r) : x.id)}</span></div>
      ${frame ? cmpFrameHTML(x, cmpOpts(w)) : ""}
      <div class="cmp-info"></div>
    </div>`;
export function cmpWipeHTML(w, [a, b]) {
  const o = cmpOpts(w), pct = Math.round(o.at * 100);
  return `<div class="cmp-wipe sunken checker${o.actual ? " actual" : ""}">
      <div class="cw-scroll"><div class="cw-canvas"><img class="cw-a" src="${encodeURI(a.r.asset)}" alt="${esc(a.r.prompt)}" draggable="false" data-size-of="${esc(a.id)}"><img class="cw-b" src="${encodeURI(b.r.asset)}" alt="${esc(b.r.prompt)}" draggable="false" data-size-of="${esc(b.id)}"></div></div>
      <span class="cw-tag a">A · ${esc(nameOf(a.r))}</span><span class="cw-tag b">B · ${esc(nameOf(b.r))}</span>
      <div class="cw-line" role="slider" tabindex="0" aria-label="Wipe divider, A on the left and B on the right" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" style="left:${o.at * 100}%"><span class="cw-grip raised"></span></div>
    </div>`;
}

export function cmpRender(w) {
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
export function cmpMediaBind(w) {
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
export function cmpPan(el, sc, when = () => true) {
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
export function cmpWipe(w) {
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
export function cmpWipeMove(w, to) {
  const o = cmpOpts(w); if (!w.cmpPaint) return;
  o.at = clampN(to, 0, 1); w.cmpPaint(); save();
}
// which side of the divider a point is on: the item shown there
export function cmpWipeItem(w, x) {
  const line = $(".cw-line", w.body), items = cmpItems(w); if (!line) return null;
  const lr = line.getBoundingClientRect();
  return items[x < lr.left + lr.width / 2 ? 0 : 1];
}

// Sync playback: play, pause, seek and speed on one file go to all; when every file has ended they start over together
export function cmpSync(w) {
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
export function cmpPlayAll(w) {
  const els = w.cmpMedia?.els.filter(x => x.isConnected) || []; if (!els.length) return;
  const playing = els.some(x => !x.paused);
  els.forEach(x => { if (playing) x.pause(); else x.play().catch(() => {}); });
}
export function cmpPlayLabel(w) {
  const b = $("[data-cmp-play]", w.body); if (!b) return;
  const t = (w.cmpMedia?.els || []).some(x => x.isConnected && !x.paused) ? "Pause all" : "Play all";
  if (b.textContent !== t) b.textContent = t;
}

export function cmpBind(w) {
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

export function init() {
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
}
