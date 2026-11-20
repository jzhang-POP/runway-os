import { S } from "../core/state.js";
import { $, $$, cap, esc, fmt, icoLabel } from "../core/dom.js";
import { morph } from "../core/morph.js";
import { costHTML, costOf, createdMs, filesOf, kindOfName, runOf, statusInfo, thumbInner, thumbOf, typeIcon } from "../core/status.js";
import { emptyAct, itemId, loadingOr } from "../core/ui.js";
import { px } from "../wm/geometry.js";
import { RENDER } from "../wm/kinds.js";
import { save } from "../wm/persist.js";
import { activeSync, select } from "../wm/selection.js";
import { renderWin } from "../wm/windows.js";

/* job tree: each job under the jobs and uploaded files it was made from (r.inputs, else r.parent), drawn as a skill tree.
   A job can have several inputs, so a branch is a small graph: it's laid out in layers (longest path from its sources),
   with the order in each layer chosen to cross few lines and each job placed over the middle of what was made from it. */
export const baseId = id => String(id ?? "").split("~")[0];
export const OPS = {
  image_to_video: ["Animate", "i-animate"], image_upscale: ["Upscale", "i-upscale"], video_upscale: ["Upscale", "i-upscale"],
  video_to_audio: ["Sound", "i-sound"], video_to_hdr: ["HDR", "i-hdr"], image_to_vector: ["Vectorize", "i-wand"],
  video_to_video: ["Restyle", "i-wand"], character_performance: ["Perform", "i-wand"], speech_to_speech: ["Voice", "i-wand"],
  voice_isolation: ["Isolate", "i-wand"], voice_dubbing: ["Dub", "i-wand"],
};
// what was done to the main input to get this job; old rows have no endpoint, and a video made from a job was an image_to_video
export const opOf = r => OPS[r.endpoint] || (!r.endpoint && r.type === "video" ? OPS.image_to_video : [r.task || "Derived", "i-wand"]);
// an input field in plain words, for the lines of inputs other than the main one
export const FIELD_WORDS = {
  promptImage: "Start frame", promptImages: "Start frame", firstFrame: "Start frame", lastFrame: "End frame", imageUri: "Image",
  referenceImage: "Reference", referenceImages: "Reference", referenceImageUri: "Reference", styleImages: "Style",
  videoUri: "Video", promptVideo: "Video", referenceVideo: "Reference video", referenceVideos: "Reference video",
  audioUri: "Audio", referenceAudio: "Reference audio", referenceAudios: "Reference audio", characterImage: "Character", maskUri: "Mask",
};
export const fieldWords = f => FIELD_WORDS[f] || cap(String(f || "input").replace(/([A-Z])/g, " $1").toLowerCase().replace(/ uri$/, "").trim());
export const SIDE_FIELD = /^(reference|style|mask|lastFrame)/; // never the main input: the line says the field instead of the operation
// a job's inputs; rows made before inputs were logged have only a parent, which was the main input
export const srcsOf = r => (Array.isArray(r.inputs) && r.inputs.length ? r.inputs : r.parent ? [{ field: "", run: r.parent }] : []);
// sizes at scale 1: node width, node height, gaps between columns and levels, canvas padding, branch minimum width,
// a line passing a level (its column), first line below a level, space between stacked lines and between stacked line labels
export const TR = { nw: 96, nh: 110, hg: 18, vg: 52, pad: 18, min: 220, dw: 12, t0: 14, step: 8, lab: 22 };
// the graph and its layout depend only on links and dates (and the UI scale): built once per change, not on every poll
export function treeGraph() {
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
export function treeLayout(g, nodes) {
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
export function treeNodeHTML(w, n, style = "", lvl = 1) {
  const r = n.run, key = r ? r.taskId : n.key, sel = key === w.sel ? " sel" : "";
  const head = cls => `<div class="tnode ${cls}${sel}" role="treeitem" aria-level="${lvl}" id="${itemId(w, key)}" data-id="${esc(key)}" aria-selected="${!!sel}" style="${style}"`;
  if (n.kind === "upload") {
    const t = kindOfName(n.id) || "image", have = (S.data.inputs || []).some(i => i.file === n.id);
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
export function treeBranchHTML(w, b, by, total) {
  const kind = key => (by.get(key) ? statusInfo(by.get(key)).cls : "queued"), rank = ["failed", "queued", "running", "done"];
  const typeOfNode = key => (key.startsWith("in:") ? (kindOfName(key.slice(3)) || "image") : by.get(key)?.type);
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
      <section class="tbranch" data-key="${esc(b.head)}" aria-label="${esc(name)}">
        <div class="tb-head"><b title="${esc(name)}">${esc(name)}</b><span class="tb-sum">${b.jobs.length} job${b.jobs.length === 1 ? "" : "s"} · <b>${fmt(total)}</b> credits</span></div>
        <div class="tb-canvas" style="width:${b.W}px;height:${b.H}px">
          <svg class="tb-lines" width="${b.W}" height="${b.H}" viewBox="0 0 ${b.W} ${b.H}" shape-rendering="crispEdges" aria-hidden="true">${lines}${knots}</svg>
          ${tags}${b.nodes.map(n => treeNodeHTML(w, n.kind === "run" ? { run: by.get(n.key) } : n, `left:${n.left}px;top:${n.top}px;width:${nw}px`, n.lv + 1)).join("")}
        </div>
      </section>`;
}
export function treeRender(w) {
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
export function treeMove(w, key) {
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
export function bindZoom(w) {
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

export function init() {
  RENDER.tree = w => treeRender(w);
}
