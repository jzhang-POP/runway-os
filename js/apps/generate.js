import { S, wins } from "../core/state.js";
import { $, $$, esc, fmt } from "../core/dom.js";
import { api } from "../core/api.js";
import { fileItem, filesOf, newestFirst, runOf, thumbInner, thumbOf } from "../core/status.js";
import { balloon } from "../core/ui.js";
import { px } from "../wm/geometry.js";
import { RENDER } from "../wm/kinds.js";
import { save } from "../wm/persist.js";
import { focus, frontWin, open } from "../wm/windows.js";
import { activityShow } from "./activity.js";
import { genLibBar } from "./promptlib.js";
import { spendCheck, spendHint } from "./spend.js";
import { DRAG_TYPE } from "../dnd.js";
import { poll } from "../live.js";

/* ---------- generate: every Runway task and model, as forms built from Runway's API spec ---------- */
export const aspectCache = new Map();
export const COMMON = [[1, 1], [16, 9], [9, 16], [4, 3], [3, 4], [3, 2], [2, 3], [5, 4], [4, 5], [21, 9], [9, 21], [7, 4], [4, 7], [12, 5], [5, 12], [7, 3], [3, 7], [2, 1], [1, 2]];
export const dims = ratio => String(ratio).split(":").map(Number);
export const isWH = v => /^\d{3,5}:\d{3,5}$/.test(String(v));
export function aspectName(a, b) {
  const r = a / b;
  let best = "", bd = Infinity;
  COMMON.forEach(([x, y]) => { const d = Math.abs(Math.log(r / (x / y))); if (d < bd) { bd = d; best = `${x}:${y}`; } });
  return bd < 0.03 ? best : r >= 1 ? `${r.toFixed(2)}:1` : `1:${(1 / r).toFixed(2)}`;
}
export const optLabel = (f, v) => {
  if (f.name === "ratio" && isWH(v)) { const [a, b] = dims(v); return `${a}×${b} · ${aspectName(a, b)}`; }
  if (f.name === "duration" && v !== "auto") return `${v} seconds`;
  if (f.name === "scaleFactor") return `${v}×`;
  return String(v).replace(/_/g, " ");
};
export const closestRatio = (list, aspect) => list.filter(isWH).reduce((best, x) => { const [a, b] = dims(x), d = Math.abs(Math.log(a / b / aspect)); return d < best.d - 1e-9 ? { x, d } : best; }, { x: null, d: Infinity }).x;
export const secondsOf = r => r.duration ?? (+(String(r.settings || "").match(/(\d+)\s*s\b/)?.[1] || 0) || null);
export const refKey = ref => (ref.run ? "r:" + ref.run : "i:" + ref.input);

export const cats = () => [...new Set((S.CAT?.tasks || []).map(t => t.category))];
export const tasksOf = cat => (S.CAT?.tasks || []).filter(t => t.category === cat);
export const curTask = w => { const ts = tasksOf(w.gen.cat); return ts.find(t => t.endpoint === w.gen.ep[w.gen.cat]) || ts[0]; };
export const curModel = w => { const t = curTask(w); if (!t) return null; const ms = t.models; return ms.find(m => m.id === w.gen.model[t.endpoint]) || ms[0]; };
// Additional parameters: free JSON for API fields the form doesn't cover
export const xtext = w => (w.gen.extra ||= {})[mkey(w)] || "";
export function genExtra(w) {
  const t = xtext(w).trim(); if (!t) return { obj: {} };
  try { const o = JSON.parse(t); return o && typeof o === "object" && !Array.isArray(o) ? { obj: o } : { err: "must be a JSON object, like {\"seed\": 42}" }; }
  catch (e) { return { err: "isn't valid JSON (" + e.message.replace(/^JSON\.parse: /, "").slice(0, 80) + ")" }; }
}
export const mkey = w => { const t = curTask(w), m = curModel(w); return t && m ? `${t.endpoint}|${m.id}` : ""; };
export const vals = w => (w.gen.vals[mkey(w)] ||= {});
export const picks = w => (w.gen.media[mkey(w)] ||= {});

// everything that can feed a media field: finished jobs plus files uploaded into inputs/
export function library(accept) {
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

export const shownVal = (f, v) => (v !== undefined ? v : f.default ?? (f.kind === "select" && f.required ? f.options[0] : f.kind === "bool" ? !!f.default : ""));
// why Generate can't run yet, or null
export function genBlock(w) {
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
export function genCost(w) {
  const m = curModel(w), t = curTask(w); if (!m) return "";
  const last = newestFirst().find(r => r.model === m.id && r.credits != null && r.costSource === "runway" && (!r.endpoint || r.endpoint === t.endpoint));
  if (!last) return `No ${m.id} jobs yet. Its cost shows in Jobs once Runway starts it`;
  const d = +shownVal(m.fields.find(f => f.name === "duration") || {}, vals(w).duration), s = secondsOf(last);
  if (d && s) { const per = last.credits / s; return `≈ ${fmt(Math.round(per * d))} credits at ${fmt(+per.toFixed(1))}/s, from your last ${m.id} job`; }
  return `≈ ${fmt(last.credits)} credits, like your last ${m.id} job`;
}

export function genRender(w) {
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
export function genSwitch(w, first) {
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

export function genFieldHTML(w, f) {
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
export function genHint(f) {
  let s = String(f.desc || "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  s = (s.match(/^.*?[.!?](?=\s+[A-Z0-9"'(`]|$)/)?.[0] || s).replace(/`/g, "");
  if (s.length > 140) s = s.slice(0, 139).replace(/[\s,;:]+\S*$/, "") + "…";
  const bare = x => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^(the|a|an) /, "");
  return bare(s) === bare(f.label || "") ? "" : s; // nothing the label doesn't already say
}
export const helpId = f => `gf-${S.uid}-${f.name}-h`;
export const helpAttr = f => (genHint(f) ? ` aria-describedby="${helpId(f)}"` : "");
export const helpHTML = f => { const h = genHint(f); return h ? `<div class="ghelp" id="${helpId(f)}">${esc(h)}</div>` : ""; };
export function genFields(w) {
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
export const genCount = (c, f, v) => { const n = String(v || "").trim().length; c.textContent = `${fmt(n)} / ${fmt(f.maxLength)}`; c.classList.toggle("bad", n > f.maxLength); };
export function genRatioPreview(w) {
  const pv = $(".rpv i", w.body), sel = $('select[data-f="ratio"]', w.body); if (!pv || !sel) return;
  const v = sel.value; if (!isWH(v)) { pv.style.width = pv.style.height = "0"; return; }
  const [a, b] = dims(v), k = px(34) / Math.max(a, b);
  Object.assign(pv.style, { width: Math.max(4, Math.round(a * k)) + "px", height: Math.max(4, Math.round(b * k)) + "px" });
}

export function genStrips(w, force) {
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
export function genMatchAspect(w, ref) {
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
export function genDropRun(w, id, fieldName) {
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
export async function genUpload(w, file, fieldName) {
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
export function genAddExtra(w, name) {
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

export function genRefresh(w, fromPrice) {
  const f = w.body, hint = $(".ghint", f); if (!hint) return;
  const why = genBlock(w), btn = $(".btn-go", f);
  const body = !why && curModel(w) ? genBody(w) : null, key = body ? priceKey(body) : "";
  if (!fromPrice && key) genPrice(w, key, body);
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
export function genMsg(w, text, neutral) {
  const m = $(".gmsg", w.body); if (!m) return;
  m.hidden = !text; m.textContent = text || ""; m.classList.toggle("info", !!neutral);
}

// the request Generate would send, also used to price it
export function genBody(w) {
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
// exact price from the server's pricing table, asked for 400 ms after the last change. Pricing only ever looks at the
// length of a text (per-character models), so the cache key holds long texts as their length.
export const priceKey = body => JSON.stringify(body, (k, v) => (typeof v === "string" && v.length > 40 ? `\u0000${v.length} chars` : v));
export const priceCache = new Map();
export function genPrice(w, key, body) {
  clearTimeout(w.priceT);
  if (!key || key === w.priceFor || key === w.priceKey) return;
  if (priceCache.has(key)) { w.price = priceCache.get(key); w.priceFor = key; w.priceKey = key; genRefresh(w, true); return; }
  w.priceT = setTimeout(async () => {
    if (!wins.has(w.id) || !curModel(w)) return;
    w.priceKey = key;
    w.priceCtl?.abort(); const ctl = w.priceCtl = new AbortController();
    let out = null;
    try { out = await api("/api/price", body, { signal: ctl.signal }); } catch (e) { if (e.name === "AbortError") return; }
    if (out) { priceCache.set(key, out); if (priceCache.size > 200) priceCache.delete(priceCache.keys().next().value); }
    if (w.priceKey !== key) return;
    w.price = out; w.priceFor = key; genRefresh(w, true);
  }, 400);
}

export async function genSubmit(w) {
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

// open Generate prefilled from a job. mode: again | animate | upscale | sound | hdr
export function genFrom(r, mode, src) {
  const w = open("generate", null, src), g = w.gen;
  const target = { animate: "image_to_video", upscale: r.type === "video" ? "video_upscale" : "image_upscale", sound: "video_to_audio", hdr: "video_to_hdr" }[mode]
    || r.endpoint || (r.type === "image" ? "text_to_image" : r.type === "audio" ? "text_to_speech" : r.parent ? "image_to_video" : "text_to_video");
  g.pending = { target, mode, run: r.taskId };
  save();
  if (S.CAT && w.shell) genApplyPending(w);
}
export function genApplyPending(w) {
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

export async function cancelJob(r) {
  try {
    await api("/api/cancel", { taskId: r.taskId });
    balloon({ title: "Cancelling job", text: `${r.model} · ${r.taskId.slice(0, 8)}. It shows as Cancelled once Runway confirms.`, ms: 4000 });
    poll();
  } catch (err) {
    balloon({ title: "Couldn't cancel the job", text: err.message, ms: 6000 });
  }
}

export function init() {
  RENDER.generate = w => genRender(w);
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
}
