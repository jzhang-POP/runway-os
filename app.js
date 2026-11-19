// Runway Dashboard: a small Win95-style window manager over the live job log (/api/state).
(() => {
  "use strict";

  /* ---------- helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = n => Number(n || 0).toLocaleString("en-US");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : "");
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const ACTIVE = new Set(["pending", "running", "throttled"]);
  const QUEUED = new Set(["pending", "throttled"]);
  const KEY = "runway-os-layout-v3";
  const SNAP = 6;

  const tOf = s => (s ? Date.parse(s) : NaN);
  const ago = ms => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return "just now";
    const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    return `${Math.round(h / 24)} d ago`;
  };
  const dur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`; };
  const absTime = ms => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  /* ---------- state ---------- */
  const desk = $("#desktop"), tasksEl = $("#tasks"), startBtn = $("#start"), startMenu = $("#startmenu"), menuEl = $("#ctxmenu");
  let data = { runs: [], balance: null, balanceAt: null, history: [] }, loaded = false, runsSig = "", stateSig = "";
  let conn = { cls: "", text: "Connecting…" }, sessionStart = null, prevStatus = new Map(), unseen = 0;
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const upTo = (p, ms) => Promise.race([p.then(() => true), sleep(ms).then(() => false)]); // false on timeout
  // resolves on the first successful /api/state poll
  let markReady;
  const ready = new Promise(res => { markReady = res; });
  const wins = new Map();
  let zTop = 10, seqTop = 0, uid = 0;

  const D = () => ({ w: desk.clientWidth, h: desk.clientHeight });
  const runOf = id => data.runs.find(r => r.taskId === id);
  const newestFirst = () => [...data.runs].sort((a, b) => createdMs(b) - createdMs(a));
  const assetsOf = type => newestFirst().filter(r => r.type === type && r.asset);
  const childrenOf = id => data.runs.filter(r => r.parent === id);
  const createdMs = r => tOf(r.createdAt) || tOf(r.date) || 0;
  const thumbOf = r => (!r || !r.asset || r.type === "audio" ? null : r.type === "video" ? `thumbs/${encodeURIComponent(r.asset)}.jpg` : encodeURI(r.asset));
  const typeIcon = t => (t === "video" ? "i-video" : t === "audio" ? "i-audio" : "i-picture");
  const plural = t => (t === "audio" ? "Audio" : cap(t) + "s");
  const nameOf = r => r.asset || r.prompt.slice(0, 48);
  const costOf = r => r.credits ?? r.estimatedCredits ?? null;

  function statusInfo(r) {
    const p = r.progress != null ? Math.round(r.progress * 100) : null;
    if (r.status === "running") return { cls: "running", label: p != null ? `Rendering ${p}%` : "Rendering", p };
    if (r.status === "throttled") return { cls: "queued", label: "Queued (rate limit)" };
    if (r.status === "pending") return { cls: "queued", label: "Queued" };
    if (r.status === "succeeded") return { cls: "done", label: "Done" };
    if (r.status === "failed") return { cls: "failed", label: "Failed" };
    if (r.status === "cancelled") return { cls: "failed", label: "Cancelled" };
    return { cls: "queued", label: cap(r.status || "unknown") };
  }
  // median finished duration for the same model, used to estimate time left
  function typicalMs(model) {
    const d = data.runs.filter(r => r.model === model && r.finishedAt && r.createdAt).map(r => tOf(r.finishedAt) - tOf(r.createdAt)).filter(x => x > 0).sort((a, b) => a - b);
    return d.length ? d[Math.floor(d.length / 2)] : null;
  }
  const relHTML = (iso, kind = "ago") => {
    const t = tOf(iso);
    if (!t) return "—";
    return `<time datetime="${esc(iso)}" data-t="${t}" data-kind="${kind}" title="${esc(absTime(t))}">${kind === "ago" ? ago(t) : dur(Date.now() - t)}</time>`;
  };
  const costHTML = r => r.credits != null ? fmt(r.credits)
    : r.estimatedCredits != null ? `<span class="est" title="Runway's estimate while the job runs">~${fmt(r.estimatedCredits)}</span>` : "—";
  function statusHTML(r, withBar = true) {
    const s = statusInfo(r);
    let extra = "";
    if (withBar && s.cls === "running") {
      const typ = typicalMs(r.model), el = Date.now() - createdMs(r);
      extra = `<span class="mprog sunken"><i style="width:${s.p ?? 8}%" class="${s.p == null ? "ind" : ""}"></i></span>`
        + `<small class="muted">${relHTML(r.createdAt, "elapsed")}${typ ? (typ > el ? ` · ~${dur(typ - el)} left` : " · longer than usual") : ""}</small>`;
    }
    return `<span class="st ${s.cls}"><i class="dot"></i>${esc(s.label)}</span>${extra}`;
  }
  // thumbnail contents: the picture when there is one, the type icon underneath as a fallback
  const thumbInner = (src, type) => `${src ? `<img src="${src}" alt="" loading="lazy" onerror="this.hidden=true">` : ""}<span class="empty"><svg class="ico big"><use href="#${typeIcon(type)}"/></svg></span>`;
  const miniThumb = r => `<span class="mini sunken">${thumbOf(r) ? `<img src="${thumbOf(r)}" alt="" loading="lazy" onerror="this.hidden=true">` : `<svg class="ico"><use href="#${typeIcon(r.type)}"/></svg>`}</span>`;

  /* ---------- server calls ---------- */
  const OFFLINE = "The dashboard server is offline. Start it with python3 server.py.";
  // POST JSON (or a raw body with init) to the dashboard server; throws an Error with a readable message
  async function api(path, body, init) {
    let res;
    try { res = await fetch(path, init || { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch { throw new Error(OFFLINE); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `The server answered ${res.status}.`);
    return out;
  }

  /* ---------- seven-segment balance readout ---------- */
  const SEG = {
    a: "4,1 16,1 13.5,3.8 6.5,3.8", d: "6.5,32.2 13.5,32.2 16,35 4,35",
    b: "17.2,2.2 17.2,16.4 15.8,17.6 14.4,16.2 14.4,4.8", c: "17.2,19.6 17.2,33.8 14.4,31.2 14.4,19.8 15.8,18.4",
    e: "2.8,19.6 4.2,18.4 5.6,19.8 5.6,31.2 2.8,33.8", f: "2.8,2.2 5.6,4.8 5.6,16.2 4.2,17.6 2.8,16.4",
    g: "5.8,16.6 14.2,16.6 15.6,18 14.2,19.4 5.8,19.4 4.4,18",
  };
  const DIG = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g" };
  function ledHTML(n) {
    const s = n == null ? "-------" : String(Math.round(n));
    return [...s].map((ch, i) => {
      const on = DIG[ch] || "", left = s.length - i - 1;
      return `<svg class="dig" viewBox="0 0 20 36" aria-hidden="true">${Object.entries(SEG).map(([k, p]) => `<polygon points="${p}" class="${on.includes(k) ? "on" : "off"}"/>`).join("")}</svg>`
        + (left > 0 && left % 3 === 0 ? '<i class="gap"></i>' : "");
    }).join("");
  }

  // org balance over the last 24 h as a stepped line; returns svg + credits spent
  function spark(hist, W = 160, H = 34, grid = false) {
    const now = Date.now() / 1000, t0 = now - 86400;
    const pts = (hist || []).map(([t, b]) => [Math.max(t, t0), b]);
    let spent = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1]) spent += pts[i - 1][1] - pts[i][1];
    if (pts.length < 2) return { svg: "", spent: null };
    pts.push([now, pts[pts.length - 1][1]]);
    const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
    const X = t => ((t - t0) / 86400) * W, Y = b => (hi === lo ? H / 2 : 3 + (1 - (b - lo) / (hi - lo)) * (H - 6));
    let d = `M${X(pts[0][0]).toFixed(1)},${Y(pts[0][1]).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += `H${X(pts[i][0]).toFixed(1)}V${Y(pts[i][1]).toFixed(1)}`;
    const end = pts[pts.length - 1];
    const lines = grid ? Array.from({ length: 23 }, (_, i) => `<line class="gl" x1="${((i + 1) * W / 24).toFixed(1)}" y1="0" x2="${((i + 1) * W / 24).toFixed(1)}" y2="${H}"/>`).join("") + [1, 2, 3].map(i => `<line class="gl" x1="0" y1="${i * H / 4}" x2="${W}" y2="${i * H / 4}"/>`).join("") : "";
    return { spent, svg: `<svg class="spark${grid ? " big" : ""}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${lines}<path d="${d}"/><circle cx="${X(end[0]) - 2}" cy="${Y(end[1])}" r="2.5"/></svg>` };
  }

  /* ---------- window kinds ---------- */
  // every size below is at scale 1 (11 px text) and grows with the Scale option
  let scale = 1;
  const px = n => Math.round(n * scale);
  const box = (d, w, h) => ({ wd: Math.min(px(w), d.w - 24), ht: Math.min(px(h), d.h - 24) });
  const centered = (d, w, h, dx = 0, third = false) => { const b = box(d, w, h); return { ...b, x: Math.max(0, Math.round((d.w - b.wd) / 2) + px(dx)), y: Math.max(0, Math.round((d.h - b.ht) / (third ? 3 : 2))) }; };
  const cascade = (cw, ch) => d => {
    const n = seqTop % 8, b = box(d, cw, ch);
    // stay clear of the desktop icons when there's room
    return { ...b, x: Math.max(Math.min(px(104), d.w - b.wd), Math.round((d.w - b.wd) / 2) + px(n * 26 - 80)), y: Math.max(0, Math.round((d.h - b.ht) / 2) + px(n * 26 - 80)) };
  };
  const minOf = (w, d) => [Math.min(Math.max(px(KINDS[w.kind].min[0]), w.minW || 0), d.w), Math.min(px(KINDS[w.kind].min[1]), d.h)];
  const KINDS = {
    overview: {
      icon: () => "i-logo", title: () => "System Properties", min: [420, 340],
      geo: d => centered(d, 460, 360, 0, true),
    },
    jobs: {
      icon: () => "i-folder", title: w => `Jobs — ${w.filter === "all" ? "All Items" : plural(w.filter)}`, min: [420, 240],
      geo: d => { const wd = Math.min(px(960), d.w - px(120)), y = Math.min(px(284), Math.round(d.h / 3)); return { wd, ht: d.h - y - 2, x: Math.max(px(104), Math.round((d.w - wd) / 2)), y }; },
    },
    terminal: {
      icon: () => "i-term", title: w => `Terminal — ${w.term?.cwd ? "R:\\" + w.term.cwd.toUpperCase() : "R:\\"}`, min: [380, 240],
      geo: d => { const g = centered(d, 680, 440, 40); return { ...g, y: Math.max(0, g.y - px(20)) }; },
    },
    options: {
      icon: () => "i-gear", title: () => "Options", min: [380, 360],
      geo: d => centered(d, 420, 470, 30, true),
    },
    usage: {
      icon: () => "i-chart", title: w => `Usage — last ${w.days || 30} days`, min: [420, 360],
      geo: d => centered(d, 760, 620, 20),
    },
    images: { icon: () => "i-picture", title: () => "Images", min: [300, 240], geo: cascade(720, 480) },
    videos: { icon: () => "i-video", title: () => "Videos", min: [300, 240], geo: cascade(720, 480) },
    audio: { icon: () => "i-audio", title: () => "Audio", min: [300, 240], geo: cascade(620, 440) },
    viewer: { icon: w => typeIcon(runOf(w.arg)?.type), title: w => runOf(w.arg)?.asset || "Viewer", min: [300, 260], geo: cascade(660, 680) },
    generate: {
      icon: () => "i-wand", title: () => "Generate", min: [360, 420],
      geo: d => centered(d, 560, 660, 60),
    },
    key: {
      icon: () => "i-key", title: () => "Runway API Key", min: [340, 330],
      geo: d => centered(d, 460, 420, 0, true),
    },
    props: { icon: () => "i-doc", title: w => `Properties — ${runOf(w.arg) ? nameOf(runOf(w.arg)) : w.arg.slice(0, 8)}`, min: [340, 320], geo: cascade(460, 600) },
  };

  /* ---------- window lifecycle ---------- */
  function make(kind, arg, g = {}) {
    const id = arg ? `${kind}:${arg}` : kind, tid = "tt-" + ++uid;
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
      filter: g.filter || "all", q: g.q || "", sort: g.sort || { key: "created", dir: -1 }, size: num(g.size, 132), sel: g.sel || null, tab: g.tab || "general", days: [7, 30, 90].includes(g.days) ? g.days : undefined,
      gen: { cat: "Video", ep: {}, model: {}, vals: {}, media: {}, adv: false, pending: null, ...(g.gen || {}) },
    };
    w.seq = num(g.seq, ++seqTop); seqTop = Math.max(seqTop, w.seq);
    w.z = ++zTop;
    wins.set(id, w);
    desk.append(el);
    bind(w);
    // remember the control used last, to give it focus again when the window comes back to the front;
    // Tab moving focus into a window behind others brings that window to the front
    el.addEventListener("focusin", e => {
      if (w.body.contains(e.target)) w.lastFocus = e.target;
      if (tabbing && !w.minimized && w !== frontWin()) { focus(w); save(); }
    });
    // a title bar press keeps focus where it is (for dragging): bring it in when it's in another window (not on touch, to keep the keyboard down)
    $(".titlebar", el).addEventListener("pointerdown", e => { if (e.pointerType !== "touch" && !e.target.closest(".ctl") && !el.contains(document.activeElement)) focusInto(w); });
    fit(w); place(w); renderWin(w);
    return w;
  }

  function open(kind, arg, src) {
    const id = arg ? `${kind}:${arg}` : kind, have = wins.get(id);
    if (have) { have.minimized ? restore(have) : (focus(have), save(), focusInto(have)); return have; }
    const d = D(), w = make(kind, arg, { ...KINDS[kind].geo(d), max: d.w < 600 });
    focus(w); save();
    flyIn(w, src?.getBoundingClientRect());
    return w;
  }
  const defaultOpen = (r, src) => open(r.asset ? "viewer" : "props", r.taskId, src);

  function close(w) { w.el.remove(); wins.delete(w.id); refreshFront(); save(); refocus(() => startBtn); }
  function minimize(w, animate = true) {
    const from = $(".titlebar", w.el).getBoundingClientRect();
    w.minimized = true; place(w); refreshFront(); save(); refocus(() => taskBtn(w));
    if (animate) fly(from, taskBtn(w)?.getBoundingClientRect(), w);
  }
  function restore(w) { w.minimized = false; place(w); focus(w); save(); flyIn(w, taskBtn(w)?.getBoundingClientRect()); }
  function toggleMax(w) {
    if (w.snapped && !w.max) { unsnap(w); place(w); save(); return; }
    w.max = !w.max; place(w); focus(w); save();
  }
  function unsnap(w) {
    if (w.pre) Object.assign(w, { wd: w.pre.wd, ht: w.pre.ht, x: w.pre.x, y: w.pre.y });
    w.snapped = false; w.pre = null; fit(w);
  }

  const frontWin = () => [...wins.values()].filter(w => !w.minimized).sort((a, b) => b.z - a.z)[0] || null;
  function focus(w) {
    if (w.z !== zTop) { w.z = ++zTop; w.el.style.zIndex = w.z; }
    refreshFront();
  }
  function refreshFront() {
    const f = frontWin();
    wins.forEach(w => w.el.classList.toggle("front", w === f));
    renderTasks();
  }
  // keyboard focus follows the front window: the control used last, else the window's main control, else its first one, else the window itself
  const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, audio[controls], video[controls], [tabindex]:not([tabindex="-1"])';
  function focusInto(w) {
    if (!w || w.minimized || wins.get(w.id) !== w) return;
    const b = w.body, last = w.lastFocus?.isConnected && b.contains(w.lastFocus) ? w.lastFocus : null;
    for (const el of [last, $(".t-in", b), $("textarea", b), $(".table", b), $(".gridwrap", b), ...$$(FOCUSABLE, b), w.el]) {
      if (!el) continue;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return; // hidden or disabled controls refuse focus: try the next one
    }
  }
  // after a close or minimize, once the caller is done (it may raise another window): focus the front window, else none()
  const refocus = none => queueMicrotask(() => { const f = frontWin(); f ? focusInto(f) : none()?.focus(); });
  let tabbing = false; // true while a Tab keypress moves focus
  addEventListener("keydown", e => { tabbing = e.key === "Tab"; }, true);
  addEventListener("keyup", () => { tabbing = false; }, true);

  /* ---------- geometry ---------- */
  function fit(w) {
    const d = D(), [mw, mh] = minOf(w, d);
    w.wd = Math.round(clampN(w.wd, mw, d.w));
    w.ht = Math.round(clampN(w.ht, mh, d.h));
    w.x = Math.round(clampN(w.x, 0, d.w - w.wd));
    w.y = Math.round(clampN(w.y, 0, d.h - w.ht));
  }
  // Properties: measure the one-line button row and keep the window at least that wide
  function fitActions(w) {
    const a = $(".pwrap .actions", w.body), p = a?.parentElement;
    if (!a || !p.clientWidth) return;
    const kids = [...a.children], gap = parseFloat(getComputedStyle(a).columnGap) || 0, ps = getComputedStyle(p);
    const row = kids.reduce((s, b) => s + b.getBoundingClientRect().width, 0) + gap * Math.max(0, kids.length - 1);
    w.minW = Math.ceil(row + parseFloat(ps.paddingLeft) + parseFloat(ps.paddingRight) + w.el.offsetWidth - p.clientWidth);
    if (!w.max && w.wd < w.minW) { fit(w); place(w); }
  }
  function place(w) {
    const d = D(), s = w.el.style, g = w.max ? { x: 0, y: 0, wd: d.w, ht: d.h } : w;
    s.left = g.x + "px"; s.top = g.y + "px"; s.width = g.wd + "px"; s.height = g.ht + "px"; s.zIndex = w.z;
    w.el.classList.toggle("max", w.max);
    w.el.hidden = w.minimized;
    const mb = $('[data-act="max"]', w.el), label = w.max ? "Restore" : "Maximize";
    if (mb.title !== label) { mb.title = label; mb.setAttribute("aria-label", label); }
  }

  const preview = $("#snap");
  function snapZone(px, py, d) {
    if (py <= SNAP) return { x: 0, y: 0, wd: d.w, ht: d.h, max: true };
    if (px <= SNAP) return { x: 0, y: 0, wd: Math.round(d.w / 2), ht: d.h };
    if (px >= d.w - SNAP) return { x: d.w - Math.round(d.w / 2), y: 0, wd: Math.round(d.w / 2), ht: d.h };
    return null;
  }

  // move (mode "move") or resize (mode = edge letters), with pointer capture and a drag threshold
  function gesture(w, e, mode) {
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

  function bind(w) {
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
  function fly(a, b, w) {
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
  function flyIn(w, from) {
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
  function retitle(w) {
    const K = KINDS[w.kind];
    $(".tt", w.el).textContent = K.title(w);
    $(".t use", w.el).setAttribute("href", "#" + K.icon(w));
  }
  function renderWin(w) {
    retitle(w);
    const keep = $$("[data-keep]", w.body).map(e => [e.dataset.keep, e.scrollTop, e.scrollLeft]);
    RENDER[w.kind](w);
    keep.forEach(([k, top, left]) => { const e = $(`[data-keep="${k}"]`, w.body); if (e) { e.scrollTop = top; e.scrollLeft = left; } });
  }
  // Win95 property sheet: tabs, a raised panel, and a footer ending in OK
  const sheetHTML = (tabs, cur, panel, foot = "") => `
    <div class="sheet">
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === cur}">${l}</button>`).join("")}</div>
      <div class="tabpanel raised" role="tabpanel" data-keep="panel-${cur}">${panel}</div>
      <div class="sheet-foot">${foot}<button class="raised btn-ok" data-close>OK</button></div>
    </div>`;
  const loadingOr = msg => `<div class="empty-list">${loaded ? msg : "Loading…"}</div>`;
  // a button under an empty list's message
  const emptyAct = html => `<div class="empty-act">${html}</div>`;
  const GEN_BTN = '<button class="raised btn-s" data-open="generate">Open Generate</button>';
  // id of a row or tile, stable for the window's life, so the list can point aria-activedescendant at it
  const itemId = (w, id) => `it${w.oid ||= ++uid}-${String(id).replace(/[^\w-]/g, "_")}`;

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
    return data.runs
      .filter(r => (w.filter === "all" || r.type === w.filter) && (!q || [r.prompt, r.model, r.taskId, r.asset, r.settings].some(v => String(v || "").toLowerCase().includes(q))))
      .sort((a, b) => { const x = col.get(a), y = col.get(b); return (x < y ? -1 : x > y ? 1 : 0) * w.sort.dir || createdMs(b) - createdMs(a); });
  }

  const RENDER = {
    // "System Properties": a Win95 property sheet with General, Usage and Connection tabs
    overview(w) {
      const runs = data.runs, running = runs.filter(r => r.status === "running"), queued = runs.filter(r => QUEUED.has(r.status));
      const v = { balance: data.balance };
      const fl = w.prev && w.prev.balance !== v.balance ? " flash" : "";
      const delta = sessionStart != null && data.balance != null ? sessionStart.balance - data.balance : 0;
      const ps = running.map(r => r.progress).filter(p => p != null);
      const det = running.length && ps.length === running.length ? Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 100) : null;
      const checked = data.balanceAt ? new Date(data.balanceAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
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
                <span class="muted">${delta > 0 ? `<span class="down">▼ ${fmt(delta)}</span> since you opened this at ${esc(sessionStart.at)}` : checked ? `Checked at ${esc(checked)}` : "Waiting for Runway"}</span></dd>
              <dt>Activity:</dt><dd>${running.length ? `Rendering ${running.length} job${running.length > 1 ? "s" : ""}${det != null ? ` · ${det}%` : "…"}` : queued.length ? `${queued.length} job${queued.length > 1 ? "s" : ""} queued…` : "Idle. No jobs rendering."}
                <div class="prog sunken${running.length + queued.length && det == null ? " busy" : ""}"><i style="${det != null ? `width:${det}%;opacity:1` : ""}"></i></div></dd>
            </dl>
          </div>`;
      } else if (tab === "usage") {
        const sp = spark(data.history, 480, 120, true);
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
        const where = data.keySource === "file" ? "saved in .runway_key" : data.keySource === "env" ? "from RUNWAYML_API_SECRET" : "none";
        panel = `
          <fieldset class="group"><legend>Runway API</legend>
            <dl class="sp-facts tight">
              <dt>Status:</dt><dd><span class="live ${conn.cls}">${esc(conn.text)}</span></dd>
              <dt>API key:</dt><dd>${data.live ? `Ending in ${esc(data.keyHint || "…")} <span class="muted">(${where})</span>` : "Not set"}</dd>
              <dt>Balance:</dt><dd>${checked ? `Checked at ${esc(checked)}` : "Not checked yet"}</dd>
              <dt>Sync:</dt><dd>Jobs every 8 s, balance every 20 s</dd>
              <dt>Server:</dt><dd>${esc(location.host)}</dd>
            </dl>
            <div class="actions"><button class="raised btn-s" data-open="key">Change key…</button></div>
          </fieldset>`;
      }
      w.body.innerHTML = sheetHTML(T, tab, panel);
      w.prev = v;
    },

    jobs(w) {
      if (!w.shell) {
        w.shell = true;
        w.body.innerHTML = `
          <div class="toolbar">
            <div class="seg-tabs" role="group" aria-label="Filter by type"></div>
            <input class="field" type="search" placeholder="Search prompts, models, IDs" aria-label="Search jobs" value="${esc(w.q)}">
          </div>
          <div class="table sunken" tabindex="0" role="grid" aria-label="Jobs" data-keep="list">
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
      const list = jobsFor(w), types = ["all", ...new Set(data.runs.map(r => r.type))];
      $(".seg-tabs", w.body).innerHTML = types.map(t => `<button class="raised" data-filter="${esc(t)}" aria-pressed="${t === w.filter}">${t === "all" ? "All" : esc(plural(t))}</button>`).join("");
      $$(".th [data-sort]", w.body).forEach(b => { b.parentElement.setAttribute("aria-sort", b.dataset.sort === w.sort.key ? (w.sort.dir > 0 ? "ascending" : "descending") : "none"); });
      $(".rows", w.body).innerHTML = list.length ? list.map(r => `
        <div class="row${r.taskId === w.sel ? " sel" : ""}" role="row" id="${itemId(w, r.taskId)}" data-id="${esc(r.taskId)}" aria-selected="${r.taskId === w.sel}">
          <div class="c c-name" role="gridcell">${miniThumb(r)}<span class="nm"><b title="${esc(r.prompt)}">${esc(r.prompt)}</b><small>${esc(r.asset || r.settings)}</small></span></div>
          <div class="c c-type" role="gridcell">${esc(cap(r.type))}</div>
          <div class="c c-model" role="gridcell" title="${esc(r.model)}">${esc(r.model)}</div>
          <div class="c c-status" role="gridcell">${statusHTML(r)}</div>
          <div class="c c-cost num" role="gridcell">${costHTML(r)}</div>
          <div class="c c-created" role="gridcell">${relHTML(r.createdAt || r.date)}</div>
        </div>`).join("")
        : `<div role="row"><div role="gridcell">${loadingOr(w.q ? `No jobs match “${esc(w.q)}”.${emptyAct('<button class="raised btn-s" data-clearq>Clear search</button>')}`
          : `No jobs yet. Jobs show up here as soon as they're submitted.${emptyAct(GEN_BTN)}`)}</div></div>`;
      activeSync(w);
      const segs = $$(".statusbar .seg", w.body), selRun = runOf(w.sel);
      segs[0].textContent = `${list.length} object${list.length === 1 ? "" : "s"}${selRun ? ` · ${selRun.asset || selRun.taskId} selected` : ""}`;
      segs[1].textContent = `${fmt(list.reduce((s, r) => s + (r.credits || 0), 0))} credits`;
      segs[2].textContent = "Double-click or Enter to open";
    },

    generate: w => genRender(w),
    key: w => keyRender(w),
    terminal: w => termRender(w),
    options: w => optionsRender(w),
    usage: w => usageRender(w),
    images: w => gallery(w, "image"),
    audio: w => gallery(w, "audio"),
    videos: w => gallery(w, "video"),

    viewer(w) {
      const r = runOf(w.arg);
      if (!r || !r.asset) { w.rendered = null; w.body.innerHTML = loadingOr(r ? "This file isn't saved yet. It opens here when the job finishes." : "This job is no longer in runs.json."); return; }
      const list = assetsOf(r.type), i = list.findIndex(x => x.taskId === r.taskId);
      const nav = `<button class="raised btn-s" data-step="-1" ${i <= 0 ? "disabled" : ""} title="Newer (←)">◀</button><span class="sunken seg">${i + 1} / ${list.length}</span><button class="raised btn-s" data-step="1" ${i >= list.length - 1 ? "disabled" : ""} title="Older (→)">▶</button>`;
      if (w.rendered === r.asset) { $(".nav", w.body).innerHTML = nav; return; }
      w.rendered = r.asset;
      const src = encodeURI(r.asset), audio = r.type === "audio", video = r.type === "video" || audio;
      w.body.innerHTML = `
        <div class="stage sunken${audio ? " audio" : ""}" data-keep="stage" title="${video ? "" : "Click to toggle actual size"}">${audio
          ? `<svg class="aud-ico" aria-hidden="true"><use href="#i-audio"/></svg><div class="aud-txt">${esc(r.prompt)}</div><audio src="${src}" controls autoplay></audio>`
          : video ? `<video src="${src}" poster="${thumbOf(r)}" controls autoplay muted loop playsinline></video>`
          : `<img src="${src}" alt="${esc(r.prompt)}" draggable="false">`}</div>
        <div class="footbar">
          <span class="nav">${nav}</span>
          <span class="sunken seg grow info" title="${esc(r.prompt)}">${esc(r.model)} · ${esc(r.settings)} · ${costHTML(r)} cr</span>
          ${video ? "" : '<button class="raised btn-s zoombtn" title="Toggle actual size">Fit</button>'}
          <button class="raised btn-s" data-open="props" data-id="${esc(r.taskId)}" title="Alt+Enter">Properties</button>
          <button class="raised btn-s" data-file="reveal" data-name="${esc(r.asset)}">Show in Finder</button>
        </div>`;
      const media = $(audio ? "audio" : video ? "video" : "img", w.body), info = $(".info", w.body);
      const addDims = (wd, ht, extra = "") => { info.innerHTML += ` · ${wd}×${ht}${extra}`; };
      if (audio) media.addEventListener("loadedmetadata", () => { info.innerHTML += ` · ${media.duration.toFixed(1)}s`; }, { once: true });
      else if (video) media.addEventListener("loadedmetadata", () => addDims(media.videoWidth, media.videoHeight, ` · ${media.duration.toFixed(1)}s`), { once: true });
      else { media.complete && media.naturalWidth ? addDims(media.naturalWidth, media.naturalHeight) : media.addEventListener("load", () => addDims(media.naturalWidth, media.naturalHeight), { once: true }); bindZoom(w); }
    },

    props(w) {
      const r = runOf(w.arg);
      if (!r) { w.body.innerHTML = loadingOr("This job is no longer in runs.json."); return; }
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
        ["Task ID", `<code>${esc(r.taskId)}</code>`], ["File", r.asset ? esc(r.asset) : "Not saved yet"],
        ...(parent ? [["Made from", chip(parent)]] : []),
        ...(kids.length ? [["Used in", `<span class="chips">${kids.map(chip).join("")}</span>`]] : []),
      ];
      w.body.innerHTML = `
        <div class="pwrap" data-keep="p">
          <div class="ptop">${r.asset ? `<button class="thumb sunken" data-open="viewer" data-id="${esc(r.taskId)}" title="Open">${thumbInner(thumbOf(r), r.type)}</button>` : `<span class="thumb sunken">${thumbInner(null, r.type)}</span>`}
            <div><b>${esc(nameOf(r))}</b><div class="muted">${esc(cap(r.type))} · ${esc(r.model)}</div></div></div>
          <hr class="etch">
          <dl class="ptbl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
          <hr class="etch">
          <div class="plabel">Prompt</div>
          <div class="promptbox sunken">${esc(r.prompt)}</div>
          <div class="actions">
            ${r.asset ? `<button class="raised btn-s" data-open="viewer" data-id="${esc(r.taskId)}">Open</button><button class="raised btn-s" data-file="reveal" data-name="${esc(r.asset)}">Show in Finder</button>` : ""}
            ${r.type === "image" && r.asset ? `<button class="raised btn-s" data-gen="animate" data-id="${esc(r.taskId)}">Animate…</button>` : ""}
            ${(r.type === "image" || r.type === "video") && r.asset ? `<button class="raised btn-s" data-gen="upscale" data-id="${esc(r.taskId)}">Upscale…</button>` : ""}
            <button class="raised btn-s" data-gen="again" data-id="${esc(r.taskId)}">Generate again…</button>
            ${ACTIVE.has(r.status) ? `<button class="raised btn-s" data-cancel="${esc(r.taskId)}">Cancel job</button>` : ""}
            <button class="raised btn-s" data-copy="${esc(r.prompt)}" data-done="Prompt copied">Copy prompt</button>
            <button class="raised btn-s" data-copy="${esc(r.taskId)}" data-done="ID copied">Copy task ID</button>
            ${r.failure ? `<button class="raised btn-s" data-copy="${esc(r.failure)}" data-done="Error copied">Copy error</button>` : ""}
          </div>
        </div>`;
      fitActions(w);
    },
  };

  function gallery(w, type) {
    if (!w.shell) {
      w.shell = true;
      w.body.innerHTML = `
        <div class="toolbar"><label class="sizer">Size <input type="range" min="84" max="260" step="4" value="${w.size}" aria-label="Thumbnail size" aria-valuetext="${w.size} px thumbnails"></label></div>
        <div class="gridwrap sunken" data-keep="grid" tabindex="0" role="listbox" aria-label="${plural(type)}"><div class="grid"></div></div>
        <div class="statusbar"><span class="sunken seg grow"></span><span class="sunken seg">${type === "video" ? "Hover to preview · " : ""}Double-click or Enter to open</span></div>`;
      $("input", w.body).addEventListener("input", e => { w.size = +e.target.value; e.target.setAttribute("aria-valuetext", `${w.size} px thumbnails`); $(".grid", w.body).style.setProperty("--tile", w.size + "px"); save(); });
    }
    const items = assetsOf(type), grid = $(".grid", w.body), wrap = $(".gridwrap", w.body);
    grid.style.setProperty("--tile", w.size + "px");
    grid.innerHTML = items.length ? items.map(r => `
      <div class="tile${r.taskId === w.sel ? " sel" : ""}" role="option" id="${itemId(w, r.taskId)}" data-id="${esc(r.taskId)}" aria-selected="${r.taskId === w.sel}" aria-label="${esc(r.asset)}" title="${esc(r.prompt)}">
        <span class="thumb sunken">${thumbInner(thumbOf(r), type)}${type === "video" ? '<span class="play"></span>' : ""}</span>
        <span class="cap">${esc(r.asset)}</span>
      </div>`).join("") : loadingOr(`No ${type === "audio" ? "audio" : type + "s"} yet. Finished ${type === "audio" ? "audio files are" : type + "s are"} saved here automatically.${emptyAct(GEN_BTN)}`);
    // a listbox holds only options: while empty the box is a plain group around the message and its button, and no tab stop
    wrap.setAttribute("role", items.length ? "listbox" : "group");
    items.length ? wrap.setAttribute("tabindex", "0") : wrap.removeAttribute("tabindex");
    activeSync(w);
    const selRun = runOf(w.sel);
    $(".statusbar .seg", w.body).textContent = `${items.length} object${items.length === 1 ? "" : "s"}${selRun && selRun.type === type ? ` · ${selRun.asset} selected` : ""}`;
    if (type === "video") $$(".tile", grid).forEach(t => {
      t.addEventListener("pointerenter", () => {
        const r = runOf(t.dataset.id); if (!r || $("video", t)) return;
        const v = Object.assign(document.createElement("video"), { src: encodeURI(r.asset), muted: true, loop: true, playsInline: true, autoplay: true });
        $(".thumb", t).append(v);
      });
      t.addEventListener("pointerleave", () => $("video", t)?.remove());
    });
  }

  // image viewer: click toggles fit / actual size, drag pans at actual size
  function bindZoom(w) {
    const stage = $(".stage", w.body), img = $("img", stage), btn = $(".zoombtn", w.body);
    const set = (actual, cx, cy) => {
      const r = img.getBoundingClientRect(), fx = r.width ? (cx - r.left) / r.width : .5, fy = r.height ? (cy - r.top) / r.height : .5;
      stage.classList.toggle("actual", actual);
      btn.textContent = actual ? "100%" : "Fit";
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
  let CAT = null, catFailed = false;
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

  const cats = () => [...new Set((CAT?.tasks || []).map(t => t.category))];
  const tasksOf = cat => (CAT?.tasks || []).filter(t => t.category === cat);
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
    newestFirst().forEach(r => {
      const t = r.asset && (/\.(png|jpe?g|webp|gif|svg)$/i.test(r.asset) ? "image" : /\.(mp4|mov|webm|m4v)$/i.test(r.asset) ? "video" : /\.(mp3|wav|flac|ogg|m4a|aac|opus)$/i.test(r.asset) ? "audio" : r.type);
      if (r.asset && accept.includes(t)) out.push({ ref: { run: r.taskId }, name: r.asset, type: t, thumb: thumbOf(r), title: r.prompt });
    });
    (data.inputs || []).forEach(i => {
      if (accept.includes(i.type)) out.push({ ref: { input: i.file }, name: i.file, type: i.type, title: `${i.file} (uploaded)`,
        thumb: i.type === "image" ? `inputs/${encodeURIComponent(i.file)}` : i.type === "video" ? `thumbs/${encodeURIComponent(i.file)}.jpg` : null });
    });
    return out;
  }

  const shownVal = (f, v) => (v !== undefined ? v : f.default ?? (f.kind === "select" && f.required ? f.options[0] : f.kind === "bool" ? !!f.default : ""));
  // why Generate can't run yet, or null
  function genBlock(w) {
    const m = curModel(w); if (!m) return "Loading models…";
    if (loaded && !data.live) return "Add your Runway API key to generate";
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
    if (!CAT) { w.shell = false; w.body.innerHTML = `<div class="empty-list">${catFailed ? "Couldn't load Runway's model list. Check the connection, then reopen this window." : "Loading models…"}</div>`; return; }
    if (!w.shell) {
      w.shell = true;
      const id = "g" + uid;
      w.body.innerHTML = `
        <form class="gen" novalidate autocomplete="off">
          <div class="toolbar"><div class="seg-tabs" role="toolbar" aria-label="Category"></div></div>
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
            <button type="submit" class="raised btn-go" title="Ctrl+Enter" aria-describedby="${id}h" aria-keyshortcuts="Control+Enter"><svg class="ico"><use href="#i-wand"/></svg><span>Generate</span></button>
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
      w.el.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); w.el.classList.add("drop"); } });
      w.el.addEventListener("dragleave", e => { if (!w.el.contains(e.relatedTarget)) w.el.classList.remove("drop"); });
      w.el.addEventListener("drop", e => { e.preventDefault(); w.el.classList.remove("drop"); const file = e.dataTransfer.files[0]; if (file) genUpload(w, file, null); });
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
    const v = shownVal(f, vals(w)[f.name]), id = `gf-${uid}-${f.name}`, tip = f.desc ? ` title="${esc(f.desc)}"` : "";
    const lab = `<label for="${id}"${tip}>${esc(f.label)}</label>`;
    if (f.kind === "select") {
      const opts = (f.required || f.default != null ? [] : [`<option value="">Default</option>`])
        .concat(f.options.map(o => `<option value="${esc(o)}" ${String(o) === String(v) ? "selected" : ""}>${esc(optLabel(f, o))}</option>`)).join("");
      const sel = `<span class="combo"><select class="field" id="${id}" data-f="${esc(f.name)}">${opts}</select></span>`;
      return lab + (f.name === "ratio" && f.options.some(isWH) ? `<span class="gsize">${sel}<span class="rpv sunken" title="Frame shape"><i></i></span></span>` : sel);
    }
    if (f.kind === "bool") return `<span></span><label class="check"${tip}><input type="checkbox" data-f="${esc(f.name)}" ${v ? "checked" : ""}><span>${esc(f.label)}</span></label>`;
    if (f.kind === "range") return lab + `<span class="rangef"><input type="range" id="${id}" data-f="${esc(f.name)}" min="${f.min}" max="${f.max}" step="${f.step}" value="${esc(v === "" ? f.default ?? f.min : v)}"><output data-for="${esc(f.name)}">${v === "" ? "default" : esc(v)}</output></span>`;
    if (f.kind === "number") return lab + `<input class="field num" type="number" id="${id}" data-f="${esc(f.name)}" ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""} step="${f.int ? 1 : "any"}" value="${esc(v)}" placeholder="${f.required ? "" : "Default"}">`;
    return lab + `<input class="field" type="text" id="${id}" data-f="${esc(f.name)}" value="${esc(v)}" ${f.maxLength ? `maxlength="${f.maxLength}"` : ""} placeholder="${f.required ? "" : "Optional"}">`;
  }
  function genFields(w) {
    const m = curModel(w), box = $(".gfields", w.body);
    if (!m) { box.innerHTML = ""; return; }
    const F = m.fields.filter(f => f.kind !== "const");
    const texts = F.filter(f => f.kind === "longtext" && !f.advanced), media = F.filter(f => f.kind === "media");
    const main = F.filter(f => !f.advanced && f.kind !== "longtext" && f.kind !== "media"), adv = F.filter(f => f.advanced && f.kind !== "media");
    box.innerHTML = texts.map(f => `
        <fieldset class="group"><legend${f.desc ? ` title="${esc(f.desc)}"` : ""}>${esc(f.label)}${f.required ? "" : ' <span class="muted">(optional)</span>'}</legend>
          <textarea class="field gprompt" rows="${f.name === "promptText" ? 5 : 2}" data-f="${esc(f.name)}" aria-label="${esc(f.label)}" spellcheck="true"></textarea>
          ${f.maxLength ? `<div class="gcount muted" data-for="${esc(f.name)}"></div>` : ""}
        </fieldset>`).join("")
      + media.map(f => `
        <fieldset class="group"><legend${f.desc ? ` title="${esc(f.desc)}"` : ""}>${esc(f.label)} <span class="muted">${f.array ? `(up to ${f.max}${f.required ? "" : ", optional"})` : f.required ? "" : "(optional)"} · ${esc(f.accept.join(" or "))}</span></legend>
          <div class="strip" role="listbox" aria-label="${esc(f.label)}" data-strip="${esc(f.name)}" ${f.array ? 'aria-multiselectable="true"' : ""}></div>
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
      const item = (key, thumb, cap, title, sel) => `<button type="button" class="sframe" role="option" data-field="${esc(f.name)}" data-mref="${esc(key)}" aria-selected="${sel}" title="${esc(title)}"><span class="thumb sunken">${thumb}</span><span class="cap">${esc(cap)}</span></button>`;
      strip.innerHTML = [
        !f.required && !f.array && item("none", '<span class="empty">None</span>', "None", "Don't use one", !on.size),
        ...lib.map(x => item(JSON.stringify(x.ref), thumbInner(x.thumb, x.type), x.name, x.title, on.has(refKey(x.ref)))),
        item("file", '<span class="empty plus">+</span>', "Choose file…", `Choose a ${f.accept.join(" or ")} file from your Mac, or drop one on this window`, false),
      ].filter(Boolean).join("");
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
    const why = genBlock(w), pr = w.price, btn = $(".btn-go", f);
    if (!fromPrice) genPrice(w);
    let text = why;
    if (!why) {
      if (pr && pr.credits != null) text = `${pr.exact ? "" : "≈ "}${fmt(pr.credits)} credits · ${pr.breakdown || ""}${pr.note ? ` · ${pr.note}` : ""}`;
      else text = (pr?.note ? `Price unknown: ${pr.note}. ` : "") + genCost(w);
    }
    hint.textContent = text; hint.title = text; hint.classList.toggle("why", !!why);
    if (!w.busy) $("span", btn).textContent = !why && pr?.credits != null ? `Generate · ${pr.exact ? "" : "≈"}${fmt(pr.credits)} cr` : "Generate";
    // blocked: aria-disabled keeps it focusable with the reason (.ghint) as its description; genSubmit refuses and shows the reason.
    // Only sending uses real disabled.
    btn.disabled = !!w.busy;
    why ? btn.setAttribute("aria-disabled", "true") : btn.removeAttribute("aria-disabled");
    $(".gkey", f).hidden = !loaded || data.live;
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
  function genPrice(w) {
    clearTimeout(w.priceT);
    w.priceT = setTimeout(async () => {
      if (!wins.has(w.id) || !curModel(w)) return;
      const body = genBody(w), key = JSON.stringify(body);
      if (key === w.priceKey) return;
      w.priceKey = key;
      try { w.price = await api("/api/price", body); } catch { w.price = null; }
      if (w.priceKey === key) genRefresh(w, true);
    }, 250);
  }

  async function genSubmit(w) {
    const why = genBlock(w); if (why) { genMsg(w, why + "."); return; }
    if (w.busy) return;
    const t = curTask(w), m = curModel(w), btn = $(".btn-go", w.body), label = $("span", btn);
    const { values, media, extra: ex } = genBody(w);
    w.busy = true; btn.disabled = true; label.textContent = Object.keys(media).length ? "Uploading…" : "Sending…"; genMsg(w, null);
    try {
      const out = await api("/api/generate", { endpoint: t.endpoint, model: m.id, values, media, extra: ex });
      balloon({ title: "Job sent to Runway", text: `${t.label} · ${m.id} · queued`, icon: "i-wand", ms: 6000, onOpen: () => open("props", out.taskId, $("#tray-run")) });
      poll();
    } catch (err) {
      genMsg(w, err.message);
    } finally {
      w.busy = false; genRefresh(w);
    }
  }

  // open Generate prefilled from a job. mode: again | animate | upscale | sound | hdr
  function genFrom(r, mode, src) {
    const w = open("generate", null, src), g = w.gen;
    const target = { animate: "image_to_video", upscale: r.type === "video" ? "video_upscale" : "image_upscale", sound: "video_to_audio", hdr: "video_to_hdr" }[mode]
      || r.endpoint || (r.type === "image" ? "text_to_image" : r.type === "audio" ? "text_to_speech" : r.parent ? "image_to_video" : "text_to_video");
    g.pending = { target, mode, run: r.taskId };
    save();
    if (CAT && w.shell) genApplyPending(w);
  }
  function genApplyPending(w) {
    const g = w.gen, pd = g.pending; if (!pd || !CAT) return;
    g.pending = null;
    const r = runOf(pd.run), t = CAT.tasks.find(x => x.endpoint === pd.target); if (!t) return;
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
  const DIRS = { images: "image", videos: "video", audio: "audio", jobs: null, inputs: "input" };
  const TERM_HELP = [
    ["neofetch", "system info, with the logo"],
    ["ls, ll, dir [folder]", "list a folder (ls -l or ll for details)"],
    ["cd <folder>", "move to images, videos, audio, jobs or inputs (cd .. to go up)"],
    ["tree [folder]", "show folders and files as a tree"],
    ["pwd", "show the current folder"],
    ["open, start <name>", "open a file or job in its window"],
    ["cat, type <name>", "show a job's details"],
    ["ps", "jobs rendering or queued"],
    ["balance", "credits left"],
    ["cost [days]", "credits spent per model (org) and per task (yours), default 30 days"],
    ["gen [prompt]", "open Generate, with the prompt filled in"],
    ["finder", "show the Runway folder in Finder"],
    ["history", "commands you typed"],
    ["bootlog, dmesg", "the startup checks, with their times"],
    ["clear, cls", "clear the screen"],
    ["exit", "close the terminal"],
  ];

  function termEntries(dir) {
    if (!dir) return Object.keys(DIRS).map(d => ({ name: d + "/", dir: d }));
    if (dir === "jobs") return newestFirst().map(r => ({ name: r.taskId.slice(0, 8), run: r }));
    if (dir === "inputs") return (data.inputs || []).map(i => ({ name: i.file, input: i }));
    return assetsOf(DIRS[dir]).map(r => ({ name: r.asset, run: r }));
  }
  function termFind(w, arg) {
    const a = String(arg || "").replace(/^\.\//, "").replace(/^\/?(images|videos|audio|jobs|inputs)\//i, "").toLowerCase(); if (!a) return null;
    return data.runs.find(r => (r.asset || "").toLowerCase() === a || r.taskId.toLowerCase().startsWith(a))
      || termEntries(w.term.cwd).map(e => e.run).filter(Boolean).find(r => (r.asset || "").toLowerCase().startsWith(a)) || null;
  }

  function neofetch() {
    const runs = data.runs, active = runs.filter(r => ACTIVE.has(r.status)).length;
    const up = Math.round((Date.now() - bootAt) / 60000), sp = spark(data.history);
    const count = t => runs.filter(r => r.type === t && r.asset).length;
    const info = [
      `<b class="t-acc">you</b>@<b class="t-acc">runway-os</b>`,
      "-------------",
      `<b class="t-acc">OS</b>: runway os (Win95 edition)`,
      `<b class="t-acc">Host</b>: ${esc(location.host)}`,
      `<b class="t-acc">Uptime</b>: ${up < 60 ? `${up} min` : `${Math.floor(up / 60)} h ${up % 60} min`}`,
      `<b class="t-acc">API</b>: ${data.live ? `Runway 2024-11-06, key ending ${esc(data.keyHint || "…")}` : "no key"}`,
      `<b class="t-acc">Credits</b>: <span class="t-red">${data.balance == null ? "?" : fmt(data.balance)}</span>`,
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
      const kids = list.slice(0, MAX).map(e => e.input ? { html: `<span>${esc(e.name)}</span>` } : d === "jobs" ? jobNode(e.run, new Set()) : { html: fileLink(e.run) });
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
        const r = termFind(w, arg); if (!r) { say(`open: ${esc(arg)}: not found`, "t-err"); break; }
        defaultOpen(r, w.el); say(`opened ${esc(r.asset || r.taskId)}`, "t-dim"); break;
      }
      case "cat": case "type": case "info": {
        const r = termFind(w, arg); if (!r) { say(`${cmd}: ${esc(arg || "?")}: not found`, "t-err"); break; }
        say([["task", r.taskId], ["file", r.asset || "not saved yet"], ["type", r.type], ["model", r.model], ["settings", r.settings], ["status", statusInfo(r).label], ["credits", r.credits ?? (r.estimatedCredits != null ? "~" + r.estimatedCredits : "-")], ["created", r.createdAt || r.date], ["prompt", r.prompt]]
          .map(([k, v]) => `<b class="t-acc">${k.padEnd(9)}</b>${esc(v)}`).join("\n"));
        break;
      }
      case "ps": case "top": {
        const act = data.runs.filter(r => ACTIVE.has(r.status));
        if (!act.length) { say("nothing rendering", "t-dim"); break; }
        say(act.map(r => { const p = r.progress != null ? Math.round(r.progress * 100) : null; return `${fileLink({ ...r, asset: null })}  ${esc(r.model.padEnd(18))} ${p != null ? "[" + "#".repeat(Math.round(p / 5)).padEnd(20, ".") + `] ${p}%` : statusInfo(r).label}`; }).join("\n"));
        break;
      }
      case "cost": case "usage": {
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
      case "balance": case "credits": say(data.balance == null ? "balance unknown" : `<span class="t-red">${fmt(data.balance)}</span> credits left`); break;
      case "gen": case "generate": {
        const gw = open("generate", null, w.el);
        if (arg && CAT && gw.shell) { vals(gw).promptText = arg; genFields(gw); genRefresh(gw); save(); }
        say("opened Generate", "t-dim"); break;
      }
      case "finder": case "explorer": fileAction("reveal", "runs.json"); say("showing the Runway folder in Finder", "t-dim"); break;
      case "history": say(t.hist.map((h, i) => `${String(i + 1).padStart(4)}  ${esc(h)}`).join("\n")); break;
      case "bootlog": case "dmesg": {
        if (!bootLog.length) { say("no startup checks logged yet", "t-dim"); break; }
        const at = new Date(performance.timeOrigin).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });
        say(`page loaded ${esc(at)}, times in seconds since then`, "t-dim");
        say(bootLog.map(l => `<span class="t-dim">[${(l.ms / 1000).toFixed(3).padStart(8)}]</span> ${esc(l.text)}${l.bad ? `<span class="t-err">${esc(l.res)}</span>` : esc(l.res)}`).join("\n"));
        break;
      }
      case "clear": case "cls": t.lines = []; break;
      case "echo": say(esc(arg)); break;
      case "date": case "time": say(esc(new Date().toString())); break;
      case "whoami": say("you"); break;
      case "exit": close(w); return;
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
    if (frontWin() === w && bootDone) $(".t-in", w.body).focus();
  }

  function termRender(w) {
    if (w.shell) return;
    w.shell = true;
    w.term ||= { cwd: null, lines: [], hist: [], hi: 0 };
    w.body.innerHTML = `<div class="term" data-keep="term"><pre class="t-out"></pre><label class="t-line"><span class="t-prompt t-cur"></span><input class="t-in" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Command"></label></div>`;
    const inp = $(".t-in", w.body), t = w.term;
    if (!t.lines.length) {
      if (loaded) termWelcome(t);
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

  /* ---------- options: accessibility and preferences, saved in this browser ---------- */
  const OPT_KEY = "runway-os-options-v1";
  const OPT_DEFAULT = { textPx: 0, textSize: "medium", font: "plex", contrast: false, motion: "system", theme: "dark", desk: "", boot: true, clock24: false, termScheme: "dos", balloons: true, sound: false, notify: false };
  let opts = { ...OPT_DEFAULT };
  try {
    const saved = JSON.parse(localStorage.getItem(OPT_KEY)) || {};
    if (!saved.theme && saved.desk === "#0b2e2e") delete saved.desk; // the old default desktop color now comes from the theme
    if (!saved.fontV2) { delete saved.font; delete saved.textPx; saved.fontV2 = true; } // readable smooth font became the default
    if (!saved.fontV3) { delete saved.font; saved.fontV3 = true; } // IBM Plex Sans became the default
    if (!saved.sizeV4) { delete saved.textPx; delete saved.textSize; saved.sizeV4 = true; } // bigger default text for the smooth fonts
    if (!saved.sizeV5) { if (saved.font !== "pixel" && +saved.textPx < 13) delete saved.textPx; saved.sizeV5 = true; } // sizes under 13 px came from the pixel-font marks and are too small for the outline fonts
    opts = { ...OPT_DEFAULT, ...saved };
  } catch {}
  // color schemes, like Win95's Display Properties → Appearance; the tokens live in index.html (html[data-theme])
  const THEMES = [["dark", "Dark"], ["classic", "Classic"], ["storm", "Storm"], ["eggplant", "Eggplant"], ["marine", "Marine"], ["pumpkin", "Pumpkin"]];
  const DESKS = [["#0b2e2e", "Teal night"], ["#008080", "Classic teal"], ["#000000", "Black"], ["#10204a", "Navy"], ["#3a1f3d", "Plum"], ["#2b2b2b", "Graphite"]];
  const TERMS = [["dos", "DOS gray"], ["green", "Green phosphor"], ["amber", "Amber"], ["blue", "Blue screen"]];
  const calm = () => opts.motion === "reduce" || (opts.motion === "system" && reduced.matches);

  // text sizes that land on whole screen pixels for the pixel font (11 px design size)
  function textSizes() {
    const dpr = Math.max(1, Math.round(devicePixelRatio || 1)), steps = dpr >= 2 ? [2, 3, 4] : [1, 2, 3];
    return { small: (11 * steps[0]) / dpr, medium: (11 * steps[1]) / dpr, large: (11 * steps[2]) / dpr, dpr };
  }
  // the Scale slider for the current font and screen. def is the size applyOptions uses when no size is saved, marked "Medium".
  // The outline fonts start at 12 px; the pixel font keeps its sharp sizes, whole multiples of 11 screen pixels.
  function tszRange() {
    const hi = textSizes().dpr >= 2;
    if (opts.font === "pixel") { const def = hi ? 16.5 : 11; return { min: 10, max: 24, def, marks: hi ? [[11, "Small"], [def, "Medium"], [22, "Large"]] : [[def, "Medium"], [22, "Large"]] }; }
    const def = hi ? 16 : 14;
    return { min: 12, max: 24, def, marks: [[13, "Small"], [def, "Medium"], [18, "Large"], [22, "Larger"]] };
  }
  function applyOptions() {
    const root = document.documentElement, ts = textSizes(), pixel = opts.font === "pixel";
    // on a 1x screen the "medium" pixel size is 22 px, which is too big: keep 11 px unless Large is picked
    let fs = +opts.textPx || 0;
    if (!fs) {
      fs = ts[opts.textSize] ?? ts.medium;
      if (ts.dpr < 2 && opts.textSize === "medium") fs = pixel ? 11 : 13;
      if (!pixel) fs = (ts.dpr >= 2 ? { small: 14, medium: 16, large: 19 } : { small: 12, medium: 14, large: 17 })[opts.textSize] || (ts.dpr >= 2 ? 16 : 14);
    }
    // one factor sizes the whole interface: text, bars, buttons, icons, spacing and window geometry
    const was = scale;
    scale = fs / 11;
    root.style.setProperty("--scale", String(scale));
    root.style.setProperty("--fs", fs + "px");
    root.style.setProperty("--fs2", (pixel ? fs * 2 : Math.round(fs * 1.7)) + "px");
    root.style.setProperty("--fsL", (pixel ? Math.max(22, fs) : Math.round(fs * 1.35)) + "px");
    if (opts.contrast) root.style.setProperty("--desk", "#000000");
    else if (opts.desk) root.style.setProperty("--desk", opts.desk);
    else root.style.removeProperty("--desk"); // the theme's own desktop color
    root.dataset.theme = THEMES.some(([k]) => k === opts.theme) ? opts.theme : "dark";
    root.classList.toggle("smooth", !pixel);
    root.classList.toggle("hyper", opts.font === "hyper");
    root.classList.toggle("plex", opts.font === "plex");
    root.classList.toggle("dot", opts.font === "dot");
    root.classList.toggle("contrast", !!opts.contrast);
    root.classList.toggle("calm", calm());
    root.dataset.term = opts.termScheme;
    // scale open windows along with the interface, then keep them on screen
    if (was !== scale) wins.forEach(w => {
      const k = scale / was, sc = g => g && Object.assign(g, { x: Math.round(g.x * k), y: Math.round(g.y * k), wd: Math.round(g.wd * k), ht: Math.round(g.ht * k) });
      sc(w); sc(w.pre); if (w.minW) w.minW = Math.round(w.minW * k);
      fit(w); place(w);
    });
    tick();
  }
  function setOpt(k, v) {
    // the pixel font and the outline fonts have different default sizes, so a chosen size doesn't carry over between them
    if (k === "font" && (v === "pixel") !== (opts.font === "pixel")) opts.textPx = 0;
    opts[k] = v;
    try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch {}
    applyOptions();
    // re-render keeps each panel's scroll (data-keep); give focus back to the control that was used
    const a = document.activeElement, sel = a?.dataset?.opt ? `[data-opt="${a.dataset.opt}"]${a.value && a.type === "radio" ? `[value="${CSS.escape(a.value)}"]` : ""}${a.dataset.val ? `[data-val="${CSS.escape(a.dataset.val)}"]` : ""}` : null;
    const host = a?.closest?.(".window");
    wins.forEach(w => (w.kind === "options" || w.kind === "props") && renderWin(w));
    if (sel && host) $(sel, host)?.focus({ preventScroll: true });
  }
  reduced.addEventListener?.("change", applyOptions);

  // the job-finished chime is a sound made with Runway itself: task ce1c486d-9ec2-49c1-a413-98c42e47333b,
  // eleven_text_to_sound_v2, prompt "a single soft chime", 2 s, 2 credits, saved as sounds/chime.mp3.
  // A failed or cancelled job plays the low two-note tone instead, so the two never sound alike.
  // A fresh Audio each time lets chimes overlap; if the file can't load or play (autoplay blocked
  // before the first click or key press), the Web Audio tones play instead.
  function chime(ok = true) {
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
    el.textContent = `${fs} px text · ${pct}% · ${opts.font !== "pixel" ? "smooth font, any size works" : sharp ? "sharp with the pixel font" : `slightly soft with the pixel font. Sharp sizes here: ${[1, 2, 3, 4].map(n => (11 * n) / dpr).filter(x => x >= min && x <= max).join(", ")} px`}${preview != null && preview !== applied ? " · release to apply" : ""}`;
    sl?.setAttribute("aria-valuetext", `${fs} px text, ${pct}%`);
    $$("[data-tsz]", w.body).forEach(b => b.setAttribute("aria-pressed", +b.dataset.tsz === fs));
  }
  function optionsRender(w) {
    const tab = w.tab && w.tab !== "general" ? w.tab : "access", T = [["access", "Accessibility"], ["look", "Appearance"], ["alerts", "Alerts"]];
    const ts = textSizes(), pixel = opts.font === "pixel";
    const radio = (k, v, label, hint) => `<label class="opt-radio"><input type="radio" name="o-${k}" data-opt="${k}" value="${esc(v)}" ${String(opts[k]) === String(v) ? "checked" : ""}><span>${label}${hint ? ` <span class="muted">${hint}</span>` : ""}</span></label>`;
    const check = (k, label, hint) => `<label class="check opt-check"><input type="checkbox" data-opt="${k}" ${opts[k] ? "checked" : ""}><span>${label}${hint ? `<br><span class="muted">${hint}</span>` : ""}</span></label>`;
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
        <div class="swatches">${THEMES.map(([k, n]) => `<button class="swatch${opts.theme === k ? " on" : ""}" data-opt="theme" data-val="${k}" aria-pressed="${opts.theme === k}"><span class="tprev" data-theme="${k}" aria-hidden="true"><span class="tp-win raised"><span class="tp-title"></span><span class="tp-btn raised"></span></span></span><span>${n}</span></button>`).join("")}</div>
      </fieldset>
      <fieldset class="group"><legend>Desktop color</legend>
        <div class="swatches"><button class="swatch${!opts.desk ? " on" : ""}" data-opt="desk" data-val="" aria-pressed="${!opts.desk}"><i class="tdesk"></i><span>Theme default</span></button>${DESKS.map(([c, n]) => `<button class="swatch${opts.desk === c ? " on" : ""}" data-opt="desk" data-val="${c}" title="${n}" aria-label="${n}" aria-pressed="${opts.desk === c}"><i style="background:${c}"></i><span>${n}</span></button>`).join("")}</div>
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
    else panel = `
      <fieldset class="group"><legend>When a job finishes</legend>
        ${check("balloons", "Show a balloon above the clock")}
        ${check("sound", "Play a chime")} <button class="raised btn-s opt-test" data-chime>Play</button>
        ${check("notify", "macOS notification while this tab is in the background", "Your browser asks for permission the first time.")}
        ${opts.notify && "Notification" in window && Notification.permission === "denied" ? '<div class="gmsg">The browser blocks notifications for this page. Allow them in the browser\'s site settings.</div>' : ""}
      </fieldset>`;
    w.body.innerHTML = sheetHTML(T, tab, panel, '<button class="raised btn-s" data-opt-reset>Restore defaults</button><span class="grow"></span>');
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
        if (e.target.closest("[data-opt-reset]")) { opts = { ...OPT_DEFAULT, ...Object.fromEntries(Object.entries(opts).filter(([k]) => /V\d+$/.test(k))) }; setOpt("textSize", OPT_DEFAULT.textSize); }
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
    w.usize = `${W}x${H}x${scale}`;
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
    data.runs.filter(r => r.credits != null && createdMs(r) >= since).forEach(r => {
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
          <span class="grow"></span><button class="raised btn-s" data-u="refresh">Refresh</button><button class="raised btn-s" data-u="csv">Export CSV</button></div>
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
    if (!usageCache[days] || force) { box.innerHTML = `<div class="empty-list">Asking Runway for ${days} days of usage…</div>`; seg.textContent = "Loading"; }
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
        t = setTimeout(() => { if (host.isConnected && `${host.clientWidth}x${host.clientHeight}x${scale}` !== w.usize) usageDraw(w); }, 120);
      });
      ro.observe(host);
    }
    seg.textContent = `${u.startDate} to ${new Date(new Date(u.beforeDate) - 86400000).toISOString().slice(0, 10)} (UTC) · fetched ${new Date(u.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  /* ---------- Runway API key ---------- */
  function keyRender(w) {
    const where = data.keySource === "file" ? "saved in .runway_key" : data.keySource === "env" ? "from the RUNWAYML_API_SECRET variable" : "";
    const st = !loaded ? { cls: "", text: "Checking…" }
      : !data.live ? { cls: "off", text: "No key. The dashboard can't sync jobs, check the balance or generate." }
      : data.error ? { cls: "warn", text: `Key ending ${data.keyHint || "…"} ${where}. Runway answers: ${data.error}` }
      : { cls: "on", text: `Connected. Key ending ${data.keyHint || "…"}, ${where}.` };
    if (!w.shell) {
      w.shell = true;
      w.body.innerHTML = `
        <form class="keyf" novalidate autocomplete="off">
          <div class="kstat"><svg class="kico"><use href="#i-key"/></svg><div><b class="live kst"></b><div class="muted kbal"></div></div></div>
          <fieldset class="group"><legend class="kleg"></legend>
            <div class="krow"><input class="field kin" type="password" placeholder="key_…" aria-label="Runway API key" spellcheck="false" autocapitalize="off" autocomplete="off">
              <button type="button" class="raised btn-s kshow" aria-pressed="false">Show</button></div>
            <div class="krow end"><button type="submit" class="raised btn-go ksave"><span>Check and save</span></button></div>
          </fieldset>
          <div class="gmsg kmsg" role="alert" hidden></div>
          <p class="muted knote">Create a key at <a href="https://dev.runwayml.com/" target="_blank" rel="noopener">dev.runwayml.com</a> under API Keys. The dashboard checks it with Runway, then saves it to <code>.runway_key</code> in the Runway folder, readable only by your Mac account. It's never shown again here.</p>
          <div class="krow end"><button type="button" class="raised btn-s krm" hidden>Remove saved key</button></div>
        </form>`;
      const form = $(".keyf", w.body), inp = $(".kin", form), show = $(".kshow", form), rm = $(".krm", form);
      show.addEventListener("click", () => { const on = inp.type === "password"; inp.type = on ? "text" : "password"; show.setAttribute("aria-pressed", on); show.textContent = on ? "Hide" : "Show"; });
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const key = inp.value.trim();
        if (!key) { keyMsg(w, "Paste a key first."); return; }
        const btn = $(".ksave", form); btn.disabled = true; $("span", btn).textContent = "Checking…"; keyMsg(w, null);
        const out = await keyPost({ key });
        btn.disabled = false; $("span", btn).textContent = "Check and save";
        if (out.error) { keyMsg(w, out.error); return; }
        inp.value = ""; inp.type = "password"; show.textContent = "Show"; show.setAttribute("aria-pressed", "false");
        balloon({ title: "Key saved", text: out.balance != null ? `Runway accepted it. ${fmt(out.balance)} credits on this org.` : "Runway accepted it.", icon: "i-key", ms: 5000 });
        poll();
      });
      let armed = 0;
      rm.addEventListener("click", async () => {
        if (Date.now() - armed > 3000) { armed = Date.now(); rm.textContent = "Click again to remove"; setTimeout(() => { rm.textContent = "Remove saved key"; }, 3000); return; }
        const out = await keyPost({ remove: true });
        if (out.error) { keyMsg(w, out.error); return; }
        balloon({ title: "Key removed", text: ".runway_key was deleted.", icon: "i-key", ms: 4000 });
        poll();
      });
    }
    const kst = $(".kst", w.body);
    kst.className = `live kst ${st.cls}`; kst.textContent = st.text;
    $(".kbal", w.body).textContent = data.live && data.balance != null ? `${fmt(data.balance)} credits on this org` : "";
    $(".kleg", w.body).textContent = data.live ? "Replace key" : "Add key";
    $(".krm", w.body).hidden = data.keySource !== "file";
  }
  const keyPost = body => api("/api/key", body).catch(err => ({ error: err.message }));
  function keyMsg(w, text) { const m = $(".kmsg", w.body); if (m) { m.hidden = !text; m.textContent = text || ""; } }

  /* ---------- selection in lists and galleries ---------- */
  function select(w, id, scroll) {
    w.sel = id;
    $$("[data-id].row, [data-id].tile", w.body).forEach(el => { const on = el.dataset.id === id; el.classList.toggle("sel", on); el.setAttribute("aria-selected", on); if (on && scroll) el.scrollIntoView({ block: "nearest" }); });
    activeSync(w);
    const r = runOf(id), seg = $(".statusbar .seg", w.body);
    if (seg && r) seg.textContent = seg.textContent.replace(/ · .* selected$/, "") + ` · ${r.asset || r.taskId} selected`;
    save();
  }
  // the focusable list (.table grid or .gridwrap listbox) names the selected row or tile as its active descendant
  function activeSync(w) {
    const box = $(".table, .gridwrap", w.body); if (!box) return;
    const el = w.sel && $$("[data-id].row, [data-id].tile", w.body).find(x => x.dataset.id === w.sel);
    el ? box.setAttribute("aria-activedescendant", el.id) : box.removeAttribute("aria-activedescendant");
  }
  // delta: ±1 next/previous item, ±2 one grid row up/down, ±1e6 first/last
  function moveSel(w, delta) {
    const items = $$("[data-id].row, [data-id].tile", w.body);
    if (!items.length) return;
    const i = items.findIndex(el => el.dataset.id === w.sel);
    let n;
    if (Math.abs(delta) >= 1e6) n = delta < 0 ? 0 : items.length - 1;
    else if (Math.abs(delta) === 2) {
      const cols = Math.max(1, Math.round($(".grid", w.body).clientWidth / (items[0].offsetWidth + 14)));
      n = i < 0 ? 0 : i + Math.sign(delta) * cols;
    } else n = i < 0 ? 0 : i + delta;
    select(w, items[clampN(n, 0, items.length - 1)].dataset.id, true);
  }

  /* ---------- context menus ---------- */
  let menuItems = [], menuReturn = null;
  function showMenu(x, y, items) {
    menuItems = items.filter(Boolean);
    menuReturn = document.activeElement;
    menuEl.innerHTML = menuItems.map((it, i) => it.sep ? '<hr class="etch">'
      : `<button role="menuitem" data-i="${i}" class="${it.bold ? "bold" : ""}" ${it.disabled ? "disabled" : ""}><span>${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ""}</button>`).join("");
    menuEl.hidden = false;
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = clampN(x, 0, innerWidth - r.width) + "px";
    menuEl.style.top = clampN(y, 0, innerHeight - r.height) + "px";
    $("button:not(:disabled)", menuEl)?.focus();
  }
  const hideMenu = () => { if (!menuEl.hidden) { menuEl.hidden = true; menuReturn?.focus?.(); } };
  menuEl.addEventListener("click", e => {
    const b = e.target.closest("button[data-i]"); if (!b) return;
    const it = menuItems[+b.dataset.i]; hideMenu(); it.act();
  });
  menuEl.addEventListener("contextmenu", e => e.preventDefault());
  const menuKeys = (root, e) => {
    const items = $$("button:not(:disabled)", root), i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
    if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
  };
  menuEl.addEventListener("keydown", e => menuKeys(menuEl, e));

  function runMenu(r, x, y, src) {
    showMenu(x, y, [
      { label: r.asset ? "Open" : "Properties", bold: true, hint: "Enter", act: () => defaultOpen(r, src) },
      r.asset && { label: "Properties", hint: "Alt+Enter", act: () => open("props", r.taskId, src) },
      r.parent && runOf(r.parent) && { label: "Go to source", act: () => open("props", r.parent, src) },
      { sep: true },
      r.type === "image" && r.asset && { label: "Animate into video…", act: () => genFrom(r, "animate", src) },
      (r.type === "image" || r.type === "video") && r.asset && { label: "Upscale…", act: () => genFrom(r, "upscale", src) },
      r.type === "video" && r.asset && { label: "Add sound…", act: () => genFrom(r, "sound", src) },
      r.type === "video" && r.asset && { label: "Convert to HDR…", act: () => genFrom(r, "hdr", src) },
      { label: "Generate again…", act: () => genFrom(r, "again", src) },
      ACTIVE.has(r.status) && { label: "Cancel job", act: () => cancelJob(r) },
      { sep: true },
      { label: "Copy prompt", act: () => copyText(r.prompt, "Prompt copied") },
      { label: "Copy task ID", act: () => copyText(r.taskId, "Task ID copied") },
      { sep: true },
      { label: "Show in Finder", disabled: !r.asset, act: () => fileAction("reveal", r.asset) },
      { label: "Open in default app", disabled: !r.asset, act: () => fileAction("open", r.asset) },
    ]);
  }
  function windowMenu(w, x, y) {
    showMenu(x, y, [
      { label: "Restore", disabled: !w.max && !w.snapped && !w.minimized, act: () => (w.minimized ? restore(w) : toggleMax(w)) },
      { label: "Move", disabled: w.max || w.minimized, act: () => kbStart(w, "move") },
      { label: "Size", disabled: w.max || w.minimized, act: () => kbStart(w, "size") },
      { label: "Minimize", disabled: w.minimized, act: () => minimize(w) },
      { label: "Maximize", disabled: w.max, act: () => { if (w.minimized) restore(w); if (!w.max) toggleMax(w); } },
      { sep: true },
      { label: "Close", bold: true, hint: "Alt+W", act: () => close(w) },
    ]);
  }
  // keyboard Move and Size, as in Win95: arrow keys move or size the window (Shift: 1 px), Enter or a click keeps it, Esc puts it back
  let kb = null;
  const KB_HINT = "Enter to finish, Esc to cancel.";
  function kbStart(w, mode) {
    kbEnd(true);
    if (w.max || w.minimized || wins.get(w.id) !== w) return;
    kb = { w, mode, start: { x: w.x, y: w.y, wd: w.wd, ht: w.ht, snapped: w.snapped, pre: w.pre } };
    focus(w);
    if (!w.el.contains(document.activeElement)) focusInto(w);
    w.el.classList.add("kbmode");
    balloon(mode === "move" ? { title: "Move window", text: `Arrow keys move it. ${KB_HINT}`, ms: 6000 } : { title: "Size window", text: `Arrow keys change its width and height. ${KB_HINT}`, ms: 6000 });
  }
  function kbEnd(keep) {
    if (!kb) return;
    const { w, start } = kb;
    kb = null;
    w.el.classList.remove("kbmode");
    if (!keep) Object.assign(w, start);
    if (wins.get(w.id) === w) { fit(w); place(w); }
    if (keep) save();
    const b = $("#balloon"); if (b && !b.hidden && b.textContent.includes(KB_HINT)) b.hidden = true; // the hint no longer applies
  }
  // capture phase: runs before the terminal, list and gallery keys, and swallows the keys it uses
  addEventListener("keydown", e => {
    if (!kb || ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    const { w, mode } = kb, dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
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
  const deskMenu = (x, y) => showMenu(x, y, [
    { label: "Cascade windows", act: cascadeAll },
    { label: "Tile windows", act: tileAll },
    { label: "Minimize all windows", act: () => wins.forEach(w => !w.minimized && minimize(w, false)) },
    { sep: true },
    { label: "Close all windows", act: resetLayout },
    { label: "Show folder in Finder", act: () => fileAction("reveal", "runs.json") },
  ]);

  function cascadeAll() {
    const d = D(), list = [...wins.values()].sort((a, b) => a.z - b.z);
    list.forEach((w, i) => {
      Object.assign(w, { minimized: false, max: false, snapped: false, pre: null, x: px(104 + i * 26), y: px(12 + i * 26), wd: Math.min(w.wd, Math.round(d.w * .62)), ht: Math.min(w.ht, Math.round(d.h * .7)) });
      fit(w); place(w);
    });
    refreshFront(); save();
  }
  function tileAll() {
    const d = D(), list = [...wins.values()].sort((a, b) => a.seq - b.seq);
    if (!list.length) return;
    const cols = Math.ceil(Math.sqrt(list.length)), rows = Math.ceil(list.length / cols), cw = Math.floor(d.w / cols), rh = Math.floor(d.h / rows);
    list.forEach((w, i) => {
      Object.assign(w, { minimized: false, max: false, snapped: false, pre: null, x: (i % cols) * cw, y: Math.floor(i / cols) * rh, wd: cw, ht: rh });
      fit(w); place(w);
    });
    refreshFront(); save();
  }
  function resetLayout() {
    [...wins.values()].forEach(w => { w.el.remove(); wins.delete(w.id); });
    refreshFront(); save(); startBtn.focus();
  }

  /* ---------- clipboard, files, balloons ---------- */
  function copyText(text, done = "Copied") {
    navigator.clipboard?.writeText(text).then(() => balloon({ title: done, text: text.length > 80 ? text.slice(0, 80) + "…" : text, ms: 2200 }))
      .catch(() => balloon({ title: "Couldn't copy", text: "The browser blocked clipboard access.", ms: 3000 }));
  }
  async function fileAction(action, name) {
    try { await api(`/api/${action}`, { file: name }); }
    catch {
      balloon({ title: "Couldn't open the file", text: `${name} isn't in the Runway folder, or the server is offline.`, ms: 4000 });
    }
  }
  // the balloon stays at least 5 s; hovering it or focusing inside it pauses the countdown, leaving resumes what was left
  let balloonT = 0, balloonLeft = 0, balloonAt = 0, srSeq = 0;
  const balloonEl = $("#balloon"), srStatus = $("#sr-status");
  function balloonRun() { clearTimeout(balloonT); balloonAt = Date.now(); balloonT = setTimeout(() => { balloonT = 0; balloonEl.hidden = true; }, balloonLeft); }
  function balloonPause() { if (!balloonT) return; clearTimeout(balloonT); balloonT = 0; balloonLeft = Math.max(0, balloonLeft - (Date.now() - balloonAt)); }
  const balloonResume = () => { if (!balloonEl.hidden && !balloonT) balloonRun(); };
  balloonEl.addEventListener("pointerenter", balloonPause);
  balloonEl.addEventListener("pointerleave", () => { if (!balloonEl.contains(document.activeElement)) balloonResume(); });
  balloonEl.addEventListener("focusin", balloonPause);
  balloonEl.addEventListener("focusout", e => { if (!balloonEl.contains(e.relatedTarget) && !balloonEl.matches(":hover")) balloonResume(); });
  function balloon({ title, text, icon = "i-doc", ms = 8000, onOpen }) {
    const b = balloonEl;
    b.innerHTML = `<svg class="ico"><use href="#${icon}"/></svg><div class="bt"><b id="balloon-t">${esc(title)}</b><span id="balloon-x">${esc(text)}</span>${onOpen ? '<button class="raised btn-s bopen" aria-describedby="balloon-t balloon-x">Open</button>' : ""}</div><button class="raised bx" aria-label="Dismiss"><i class="g-close"></i></button>`;
    b.hidden = false;
    b.classList.toggle("clickable", !!onOpen);
    b.onclick = e => { b.hidden = true; if (!e.target.closest(".bx") && onOpen) onOpen(); };
    // screen readers get it from the always-present live region: empty it, then fill it a frame later so a repeat is announced again
    const n = ++srSeq;
    srStatus.textContent = "";
    requestAnimationFrame(() => requestAnimationFrame(() => { if (n === srSeq) srStatus.textContent = `${title}. ${text}`; }));
    clearTimeout(balloonT); balloonT = 0;
    balloonLeft = Math.max(5000, ms);
    if (!b.matches(":hover") && !b.contains(document.activeElement)) balloonRun();
  }
  function announce(r) {
    const ok = r.status === "succeeded";
    if (opts.sound) chime(ok);
    if (opts.notify && document.hidden && "Notification" in window && Notification.permission === "granted") {
      try { const n = new Notification(ok ? `${cap(r.type)} finished` : `Job ${r.status}`, { body: ok ? `${r.asset || r.taskId}${r.credits != null ? ` · ${fmt(r.credits)} credits` : ""}` : (r.failure || r.taskId), tag: r.taskId });
        n.onclick = () => { window.focus(); open(ok && r.asset ? "viewer" : "props", r.taskId); n.close(); }; } catch {}
    }
    if (document.hidden) { unseen++; setTitle(); }
    if (!opts.balloons) return;
    balloon({
      title: ok ? `${cap(r.type)} finished` : `Job ${r.status}`,
      text: ok ? `${r.asset || r.taskId}${r.credits != null ? ` · ${fmt(r.credits)} credits` : ""}` : (r.failure || r.taskId),
      icon: ok ? typeIcon(r.type) : "i-doc", ms: 9000,
      onOpen: () => open(ok && r.asset ? "viewer" : "props", r.taskId, $("#tray-run")),
    });
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { unseen = 0; setTitle(); } });

  /* ---------- tab title + favicon: live status, readable from another tab ---------- */
  // the runway os logo: a bold pixel "R" on a beveled Win95-blue tile (16x16 grid)
  const R_BITS = ["1111111.", "11111111", "11....11", "11....11", "11....11", "11111111", "1111111.", "11.11...", "11..11..", "11...11.", "11....11"];
  function logoSVG(fg) {
    const px = (dx, dy, fill) => R_BITS.flatMap((row, y) => [...row].map((c, x) => (c === "1" ? `<rect x="${4 + x + dx}" y="${3 + y + dy}" width="1" height="1" fill="${fill}"/>` : ""))).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f6fc4"/><stop offset="1" stop-color="#000a5c"/></linearGradient></defs>`
      + `<rect width="16" height="16" fill="#08090b"/><rect width="15" height="15" fill="#c9cbd3"/><rect x="1" y="1" width="14" height="14" fill="url(#g)"/>${px(1, 1, "#000000")}${px(0, 0, fg)}</svg>`;
  }
  const FAV = { idle: logoSVG("#ffffff"), busy: logoSVG("#ffc94a") };
  let favState = "";
  function setTitle() {
    const active = data.runs.filter(r => ACTIVE.has(r.status)).length;
    document.title = "[POP] Runway OS";
    const want = active ? "busy" : "idle";
    if (want !== favState) { favState = want; $("#favicon").href = "data:image/svg+xml," + encodeURIComponent(FAV[want]); }
  }

  /* ---------- taskbar, tray, start menu ---------- */
  const taskBtn = w => $(`[data-task="${CSS.escape(w.id)}"]`, tasksEl);
  function renderTasks() {
    const f = frontWin();
    tasksEl.innerHTML = [...wins.values()].sort((a, b) => a.seq - b.seq).map(w => {
      const K = KINDS[w.kind], title = K.title(w);
      return `<button class="task raised" data-task="${esc(w.id)}" aria-pressed="${w === f}" title="${esc(title)}"><svg class="ico"><use href="#${K.icon(w)}"/></svg><span>${esc(title)}</span></button>`;
    }).join("");
  }
  tasksEl.addEventListener("pointerdown", e => { if (e.target.closest("[data-task]")) e.preventDefault(); });
  tasksEl.addEventListener("click", e => {
    const b = e.target.closest("[data-task]"); if (!b) return;
    const w = wins.get(b.dataset.task); if (!w) return;
    if (w.minimized) restore(w);
    else if (w === frontWin()) minimize(w);
    else { focus(w); save(); focusInto(w); }
  });
  $(".taskbar").addEventListener("contextmenu", e => {
    e.preventDefault();
    const b = e.target.closest("[data-task]");
    b && wins.get(b.dataset.task) ? windowMenu(wins.get(b.dataset.task), e.clientX, e.clientY - 4) : deskMenu(e.clientX, e.clientY - 4);
  });

  function renderTray() {
    setTitle();
    const active = data.runs.filter(r => ACTIVE.has(r.status)).length, run = $("#tray-run"), bal = $("#tray-bal");
    run.hidden = !active;
    $("span", run).textContent = active;
    run.title = `${active} job${active === 1 ? "" : "s"} rendering or queued. Open Jobs`;
    $("span", bal).textContent = data.balance == null ? "—" : fmt(data.balance);
  }
  $("#tray-run").addEventListener("click", e => open("jobs", null, e.currentTarget));
  $("#tray-bal").addEventListener("click", e => open("overview", null, e.currentTarget));

  function setStart(on) {
    startMenu.hidden = !on;
    startBtn.setAttribute("aria-expanded", on);
    if (on) $("button", startMenu).focus();
  }
  startBtn.addEventListener("click", () => setStart(startMenu.hidden));
  startMenu.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    setStart(false);
    if (b.dataset.launch) open(b.dataset.launch, null, startBtn);
    if (b.dataset.cmd === "folder") fileAction("reveal", "runs.json");
    if (b.dataset.cmd === "cascade") cascadeAll();
    if (b.dataset.cmd === "tile") tileAll();
  });
  startMenu.addEventListener("keydown", e => menuKeys(startMenu, e));
  document.addEventListener("pointerdown", e => {
    if (!startMenu.hidden && !e.target.closest("#startmenu, #start")) setStart(false);
    if (!menuEl.hidden && !e.target.closest("#ctxmenu")) hideMenu();
  });

  /* ---------- desktop icons: click selects, double-click / Enter / tap opens ---------- */
  let lastPointer = "mouse";
  addEventListener("pointerdown", e => { lastPointer = e.pointerType; }, true);
  const icons = $("#icons");
  icons.addEventListener("click", e => { const b = e.target.closest("[data-launch]"); if (b && (e.detail === 0 || lastPointer === "touch")) open(b.dataset.launch, null, b); });
  icons.addEventListener("dblclick", e => { const b = e.target.closest("[data-launch]"); if (b) open(b.dataset.launch, null, b); });
  icons.addEventListener("keydown", e => {
    const items = $$(".dicon", icons), i = items.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key) && i >= 0) { e.preventDefault(); items[clampN(i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1), 0, items.length - 1)].focus(); }
  });
  desk.addEventListener("pointerdown", e => { if (e.target === desk) document.activeElement?.blur(); });
  desk.addEventListener("contextmenu", e => { if (e.target === desk || e.target.closest(".icons")) { e.preventDefault(); deskMenu(e.clientX, e.clientY); } });

  /* ---------- clicks inside windows ---------- */
  const winOf = el => wins.get(el.closest(".window")?.dataset.id);
  desk.addEventListener("click", e => {
    const c = e.target.closest("[data-copy]");
    if (c) {
      const label = c.textContent;
      navigator.clipboard?.writeText(c.dataset.copy).then(() => { c.textContent = c.dataset.done || "Copied"; setTimeout(() => { c.textContent = label; }, 900); }).catch(() => {});
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
    const it = e.target.closest(".row[data-id], .tile[data-id]");
    if (it) {
      const w = winOf(it); select(w, it.dataset.id);
      if (lastPointer === "touch") defaultOpen(runOf(it.dataset.id), it);
    }
  });
  desk.addEventListener("dblclick", e => {
    const it = e.target.closest(".row[data-id], .tile[data-id]");
    if (it && runOf(it.dataset.id)) defaultOpen(runOf(it.dataset.id), it);
  });
  desk.addEventListener("contextmenu", e => {
    const it = e.target.closest(".row[data-id], .tile[data-id]"), st = e.target.closest(".stage");
    const r = it ? runOf(it.dataset.id) : st ? runOf(winOf(st)?.arg) : null;
    if (!r) return;
    e.preventDefault();
    if (it) select(winOf(it), it.dataset.id);
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
      if (f && (f.kind === "viewer" || f.kind === "props") && !e.target.closest("input")) close(f);
      return;
    }
    if (!menuEl.hidden || !startMenu.hidden) return;
    const f = frontWin();
    if (e.altKey && e.code === "Backquote") { // switch windows
      e.preventDefault();
      const list = [...wins.values()].sort((a, b) => b.z - a.z); if (list.length < 2) return;
      const next = e.shiftKey ? list[list.length - 1] : list.find(w => w !== f && !w.minimized) || list[1];
      next.minimized ? restore(next) : (focus(next), save(), focusInto(next));
      return;
    }
    if (e.altKey && e.code === "KeyW" && f) { e.preventDefault(); close(f); return; }
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
    if (f.kind === "viewer") {
      const v = $("video, audio", f.el), r = runOf(f.arg);
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); step(f, e.key === "ArrowLeft" ? -1 : 1); }
      else if (e.key === "Enter" && e.altKey && r) { e.preventDefault(); open("props", r.taskId); }
      else if (v && e.target !== v && e.key === " ") { e.preventDefault(); v.paused ? v.play() : v.pause(); }
      else if (v && (e.key === "m" || e.key === "M")) v.muted = !v.muted;
      else if (v && (e.key === "," || e.key === ".")) { v.pause(); v.currentTime = clampN(v.currentTime + (e.key === "." ? 1 : -1) / 24, 0, v.duration || 0); }
    }
  });

  /* ---------- persistence ---------- */
  let saveT;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const list = [...wins.values()].map(w => ({ kind: w.kind, arg: w.arg, x: w.x, y: w.y, wd: w.wd, ht: w.ht, max: w.max, minimized: w.minimized, snapped: w.snapped, pre: w.pre, z: w.z, seq: w.seq, filter: w.filter, q: w.q, sort: w.sort, size: w.size, sel: w.sel, tab: w.tab, days: w.days, gen: w.kind === "generate" ? w.gen : undefined }));
      try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
    }, 150);
  }
  function restoreLayout() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch {}
    if (!Array.isArray(saved)) { open("terminal"); return; } // first launch: just the terminal
    saved.filter(s => KINDS[s.kind] && (s.kind === "viewer" || s.kind === "props" ? s.arg : true)).sort((a, b) => a.z - b.z).forEach(s => make(s.kind, s.arg, s));
    refreshFront();
  }
  addEventListener("resize", () => wins.forEach(w => { fit(w); place(w); }));

  /* ---------- boot screen: a BIOS self-test over the real startup; the log stays up until you start ---------- */
  let bootDone = true;
  // each startup check with its time (ms since the page started loading), kept for the bootlog command
  const bootLog = [];
  async function bootScreen(modelsLoaded) {
    // the checks run and are logged even with the boot screen off; the screen only shows them
    const show = opts.boot, fast = calm(), deadline = Date.now() + 8000;
    let el = null, log = null, hint = null, phase = "loading", early = false;
    const setHint = t => { if (hint) hint.textContent = t; };
    const btns = () => (el ? $$(".boot-act button", el) : []);
    const start = async withKey => {
      if (bootDone) return;
      bootDone = true;
      if (!fast) { // a short splash, then the desktop
        $$(".boot-log, .boot-act, .boot-hint", el).forEach(x => { x.hidden = true; });
        $(".boot-splash", el).hidden = false;
        await sleep(400);
      }
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
      if (bootDone) return;
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
      if (bootDone || phase !== "loading") return;
      e.preventDefault();
      if (!early) { early = true; setHint("Starting when loading finishes… Press Esc to start now."); }
    };
    if (show) {
      bootDone = false;
      el = document.createElement("div");
      el.className = "boot";
      el.innerHTML = `<div class="boot-log" role="log" aria-live="polite"></div>
        <div class="boot-act"></div>
        <div class="boot-hint" aria-live="polite">Press any key to start when loading finishes, or Esc to start now.</div>
        <div class="boot-splash" hidden><span class="boot-logo">${logoSVG("#ffffff")}</span><b>runway os</b><div class="prog sunken busy"><i></i></div></div>`;
      document.body.append(el); document.body.classList.add("booting");
      log = $(".boot-log", el); hint = $(".boot-hint", el);
      addEventListener("keydown", onKey, true); addEventListener("pointerdown", onPointer, true);
    }
    // a line prints when its check starts; its result is added, and the line logged, when the check finishes
    const begin = text => {
      const d = log && document.createElement("div");
      if (d) { d.textContent = text; log.append(d); }
      return { d, text };
    };
    const end = (row, res, bad = false) => {
      bootLog.push({ ms: Math.round(performance.now()), text: row.text, res, bad });
      if (!row.d || !res) return;
      const s = document.createElement("span"); s.textContent = res; if (bad) s.className = "bad"; row.d.append(s);
    };
    const say = (text, cls) => { const row = begin(text); if (row.d && cls) row.d.className = cls; end(row, ""); };
    const wait = p => upTo(p, Math.max(0, deadline - Date.now()));

    say(location.protocol === "file:" ? "runway os, opened as a file" : `runway os on ${location.host}`);
    let row = begin("Loading model list… ");
    if (!(await wait(modelsLoaded)) || !CAT) end(row, "failed. Generate can't list models", true);
    else { const t = CAT.tasks || []; end(row, `${new Set(t.flatMap(x => x.models.map(m => m.id))).size} models, ${t.length} tasks`); }
    row = begin("Connecting to Runway API… ");
    // the first /api/state answer, or the first failed poll (poll keeps retrying every 3 s)
    while (!loaded && conn.cls !== "off" && Date.now() < deadline) await upTo(ready, 50);
    if (!loaded) end(row, conn.cls === "off" ? "server not reachable" : "no answer after 8 s", true);
    else if (!data.live) end(row, "no key", true);
    else if (data.error) end(row, data.error, true);
    else end(row, "OK");
    const live = loaded && data.live && !data.error, n = data.runs.length;
    if (loaded) {
      const when = data.balanceAt ? `, last known ${absTime(tOf(data.balanceAt))}` : ", last known";
      say(`Credits: ${data.balance == null ? "unavailable" : fmt(data.balance) + (live ? "" : when)}`);
      say(`Jobs: ${n} found`);
    }
    say(!loaded ? (conn.cls === "off" ? `Server not reachable. Run python3 server.py${location.protocol === "file:" ? " and open the address it prints" : "; runway os keeps trying"}.` : "The server hasn't answered yet; runway os keeps trying.")
      : !data.live ? "Ready without a Runway key."
      : data.error ? "Ready, but the Runway API reported an error."
      : `Ready. ${data.balance == null ? "Credits unavailable" : fmt(data.balance) + " credits"}, ${fmt(n)} job${n === 1 ? "" : "s"}.`, "sum");
    phase = "ready";
    if (!show || bootDone) return;
    if (early) { start(false); return; }
    const act = $(".boot-act", el), keyBtn = loaded && !live;
    act.innerHTML = `<button class="raised btn-s" data-start>Start runway os</button>${keyBtn ? '<button class="raised btn-s" data-start="key">Start and add API key</button>' : ""}`;
    act.addEventListener("click", e => { const b = e.target.closest("[data-start]"); if (b) start(b.dataset.start === "key"); });
    $("button", act).focus();
    setHint(keyBtn ? "Press Enter to start, or Tab to choose the other button." : "Press Enter to start.");
  }

  /* ---------- live data ---------- */
  // what each window shows from the job log; poll skips windows whose signature didn't change
  const runSig = r => r && JSON.stringify(r);
  const SIG = {
    options: () => "",
    terminal: () => "",
    usage: () => "",
    images: w => JSON.stringify(assetsOf("image").map(r => [r.taskId, r.asset, r.prompt])),
    videos: w => JSON.stringify(assetsOf("video").map(r => [r.taskId, r.asset, r.prompt])),
    audio: w => JSON.stringify(assetsOf("audio").map(r => [r.taskId, r.asset, r.prompt])),
    props: w => { const r = runOf(w.arg); return r ? [runSig(r), runSig(runOf(r.parent)), ...childrenOf(r.taskId).map(runSig)].join("|") : "-"; },
  };
  async function poll() {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const d = await res.json();
      const c = d.error ? { cls: "warn", text: "Runway API: " + d.error } : d.live ? { cls: "on", text: "Connected" } : { cls: "warn", text: "No API key" };
      const runs = d.runs || [], rs = JSON.stringify(runs) + JSON.stringify(d.inputs || []), ss = rs + d.balance + d.balanceAt + (d.history || []).length;
      const first = !loaded, runsChanged = rs !== runsSig, anyChanged = ss !== stateSig;
      const connChanged = c.text !== conn.text || c.cls !== conn.cls;
      const keySig = [d.live, d.keySource, d.keyHint, d.error].join("|"), keyChanged = keySig !== data.keySig;
      data = { runs, balance: d.balance, balanceAt: d.balanceAt, history: d.history || [], live: !!d.live, keySource: d.keySource, keyHint: d.keyHint, error: d.error, keySig, inputs: d.inputs || [] };
      if (sessionStart == null && d.balance != null) sessionStart = { balance: d.balance, at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
      runsSig = rs; stateSig = ss; conn = c; loaded = true; markReady();
      if (!first) runs.forEach(r => { const was = prevStatus.get(r.taskId); if (was && ACTIVE.has(was) && !ACTIVE.has(r.status)) announce(r); });
      prevStatus = new Map(runs.map(r => [r.taskId, r.status]));
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
      if (c.text !== conn.text) { conn = c; wins.forEach(w => w.kind === "overview" && renderWin(w)); }
    }
  }

  // clock + relative times
  const clock = $("#clock");
  function tick() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString([], opts.clock24 ? { hour: "2-digit", minute: "2-digit", hour12: false } : { hour: "numeric", minute: "2-digit", hour12: true });
    clock.title = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    $$("time[data-t]").forEach(t => { t.textContent = t.dataset.kind === "elapsed" ? dur(Date.now() - +t.dataset.t) : ago(+t.dataset.t); });
  }

  // the model list and the first state load in parallel
  const modelsLoaded = fetch("/api/models").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(c => { CAT = c; }).catch(() => { catFailed = true; })
    .finally(() => wins.forEach(w => w.kind === "generate" && renderWin(w)));
  poll();
  applyOptions();
  document.getElementById("i-logo").innerHTML = logoSVG("#ffffff").replace(/^<svg[^>]*>|<\/svg>$/g, "");
  $("#favicon").href = "data:image/svg+xml," + encodeURIComponent(FAV.idle);
  bootScreen(modelsLoaded);
  restoreLayout();
  renderTasks();
  tick(); setInterval(tick, 5000);
  setInterval(poll, 3000);
})();
