import { S, wins } from "../core/state.js";
import { $, $$, clampN, desk, esc, fmt, icoLabel } from "../core/dom.js";
import { OFFLINE, api } from "../core/api.js";
import { morph } from "../core/morph.js";
import { relHTML } from "../core/status.js";
import { sleep } from "../core/time.js";
import { balloon, emptyAct, itemId } from "../core/ui.js";
import { KINDS, RENDER, SIG } from "../wm/kinds.js";
import { save } from "../wm/persist.js";
import { renderTasks } from "../wm/taskbar.js";
import { frontWin, open, retitle } from "../wm/windows.js";
import { noteUseAsPrompt } from "./promptlib.js";

/* ---------- notes: plain-text files in notes/, a NoPaste-style editor, and links that carry a whole note ----------
   A link is the text, deflate-raw compressed and base64url encoded into the fragment (#note=…&l=…), as in Blender's
   NoPaste: the fragment never reaches a server, and the link alone is the note. */
export const NOTE_LANGS = [["text", "Plain text", "txt"], ["python", "Python", "py"], ["javascript", "JavaScript", "js"], ["json", "JSON", "json"], ["markdown", "Markdown", "md"], ["shell", "Shell", "sh"], ["html", "HTML", "html"], ["css", "CSS", "css"]];
export const NOTE_DRAFT = "\u0000link"; // w.sel while the unsaved note from a link is open
export const NOTE_PREF = "runway-os-notes-v1";
export const NOTE_LINK_WARN = 8000;
export const notesSt = { list: null, err: "", at: 0, draft: null, dirty: new Set() };
export const langOfName = n => (NOTE_LANGS.find(l => l[2] === (/\.([^.]+)$/.exec(n || "")?.[1] || "").toLowerCase()) || NOTE_LANGS[0])[0];
export const extOf = lang => (NOTE_LANGS.find(l => l[0] === lang) || NOTE_LANGS[0])[2];
// a typed name keeps its own known extension, else gets the current language's
export const noteFileName = (v, lang) => (NOTE_LANGS.some(l => new RegExp(`\\.${l[2]}$`, "i").test(v.trim())) ? v.trim() : `${v.trim()}.${extOf(lang)}`);
export const noteTitle = w => w.ed?.name || (w.ed ? "From link" : "");
export const noteSize = n => (n < 1024 ? `${fmt(n)} bytes` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
export const noteTermLink = name => `<a class="t-file" data-note-open="${esc(name)}">${esc(name)}</a>`;
// terminal: a name in notes/ (cd notes first, or write notes/<name>)
export function noteTermFind(w, arg) {
  const a = String(arg || "").trim(), m = /^\/?notes\/(.+)$/i.exec(a);
  if (!m && w.term?.cwd !== "notes") return null;
  const q = (m ? m[1] : a).toLowerCase(), list = (notesSt.list || []).map(n => n.name);
  return q ? list.find(n => n.toLowerCase() === q) || list.find(n => n.toLowerCase().startsWith(q)) || null : null;
}

/* syntax highlighting: one regex per language, its alternatives tried left to right; every rule is [token class, regex] */
export const NRX = {
  dq: /"(?:\\.|[^"\\\n])*"?/, sq: /'(?:\\.|[^'\\\n])*'?/, bt: /`(?:\\[\s\S]|[^`\\])*`?/,
  num: /(?<![\w.])(?:0[xX][\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/,
  block: /\/\*[\s\S]*?(?:\*\/|(?![\s\S]))/, line: /\/\/.*/, hash: /#.*/,
};
export const KW = words => new RegExp(`\\b(?:${words.split(" ").join("|")})\\b`);
export const NOTE_RULES = {
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
export const noteRx = {};
// HTML for the <pre> under the textarea; a token never spans a line break, so the result splits into lines on "\n"
export function noteHL(text, lang) {
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
export async function noteEncode(text, lang) {
  const z = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  let bin = "";
  for (let i = 0; i < z.length; i += 0x8000) bin += String.fromCharCode(...z.subarray(i, i + 0x8000));
  return `${location.origin}/#note=${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}&l=${lang}`;
}
export async function noteDecode(data) {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/")), bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  if (text.length > 2e6) throw new Error("too long");
  return text;
}

/* server calls */
export async function noteFetch(path) {
  let res;
  try { res = await fetch(path, { cache: "no-store" }); } catch { throw new Error(OFFLINE); }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `The server answered ${res.status}.`);
  return out;
}
export const noteGet = name => noteFetch(`/api/notes/${encodeURIComponent(name)}`);
export const notesEach = fn => wins.forEach(w => { if (w.kind === "notes" && w.shell) fn(w); });
export async function notesLoad() {
  notesSt.at = Date.now();
  try { notesSt.list = (await noteFetch("/api/notes")).notes || []; notesSt.err = ""; }
  catch (e) { notesSt.err = e.message; }
  notesEach(notesPaint);
}
export const noteListStale = () => { if (Date.now() - notesSt.at > 3000) notesLoad(); };
export function noteListPut(info, was) {
  const list = (notesSt.list || []).filter(n => n.name !== info.name && n.name !== was);
  list.push(info);
  notesSt.list = list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  notesEach(notesPaint);
}

/* saving: ~800 ms after typing stops, on Ctrl/Cmd+S, before switching notes, and when the page goes away */
export async function noteSave(ed) {
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
export const notesFlush = () => Promise.all([...notesSt.dirty].map(noteSave));

// show a note (a name in notes/, or NOTE_DRAFT) in the editor; a newer call wins over one still loading
export async function noteShow(w, key, focusEd) {
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
export function openNote(name, src) {
  const w = open("notes", null, src);
  noteShow(w, name, true);
  return w;
}
// put the current note in the textarea (only when switching notes, never while typing)
export function noteFill(w) {
  const ta = $(".nt-ta", w.body), sc = $(".nt-scroll", w.body);
  if (!ta || !w.ed) return;
  ta.value = w.ed.text;
  ta.setSelectionRange(0, 0);
  sc.scrollTop = 0; sc.scrollLeft = 0;
  notePaint(w); notesPaint(w);
}
// the highlighted copy and the line numbers, under the textarea. Only the lines that changed are replaced: the
// unchanged lines before and after the edit keep their elements (line numbers are a CSS counter, so they follow).
const hlLines = new WeakMap(); // .nt-hl -> the line HTML it shows
export const nlCount = (text, end = text.length) => { let n = 0, i = -1; while ((i = text.indexOf("\n", i + 1)) !== -1 && i < end) n++; return n; };
const lineHTML = l => `<div class="nl"><span class="nn"></span>${l}</div>`;
export function notePaint(w) {
  const ta = $(".nt-ta", w.body), hl = $(".nt-hl", w.body), sc = $(".nt-scroll", w.body);
  if (!ta || !w.ed) return;
  const lines = noteHL(ta.value, w.ed.lang).split("\n"), old = hlLines.get(hl);
  hlLines.set(hl, lines);
  if (!old || hl.children.length !== old.length) hl.innerHTML = lines.map(lineHTML).join("");
  else {
    const n = Math.min(old.length, lines.length);
    let a = 0, b = 0;
    while (a < n && old[a] === lines[a]) a++;
    while (b < n - a && old[old.length - 1 - b] === lines[lines.length - 1 - b]) b++;
    for (let i = old.length - b - 1; i >= a; i--) hl.children[i].remove();
    const html = lines.slice(a, lines.length - b).map(lineHTML).join("");
    if (html) { const next = hl.children[a]; next ? next.insertAdjacentHTML("beforebegin", html) : hl.insertAdjacentHTML("beforeend", html); }
  }
  const d = String(Math.max(2, String(lines.length).length));
  if (sc.style.getPropertyValue("--nt-d") !== d) sc.style.setProperty("--nt-d", d);
  ta.scrollTop = 0; ta.scrollLeft = 0; // the textarea is as big as its text: it never scrolls itself, .nt-scroll does
}
// keep the caret in view: the textarea never scrolls (it's as big as its text), so .nt-scroll has to follow the caret.
// The caret's spot is measured in the highlighted copy of its line, which wraps exactly like the textarea.
export function noteReveal(w) {
  const ta = $(".nt-ta", w.body), sc = $(".nt-scroll", w.body), hl = $(".nt-hl", w.body);
  if (!ta || document.activeElement !== ta) return;
  const v = ta.value, s = ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd;
  const a = v.lastIndexOf("\n", s - 1) + 1, el = hl.children[nlCount(v, a)]; if (!el) return;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
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
export function noteStatus(w) {
  const segs = $$(".statusbar .seg", w.body); if (segs.length < 3) return;
  const ed = w.ed, [msg, pos, st] = segs, m = w.ntMsg;
  const lines = ed ? nlCount(ed.text) + 1 : 0;
  msg.textContent = m ? m.text : ed ? `${fmt(lines)} line${lines === 1 ? "" : "s"}, ${fmt(ed.text.length)} character${ed.text.length === 1 ? "" : "s"}`
    : notesSt.list ? `${notesSt.list.length} note${notesSt.list.length === 1 ? "" : "s"}` : "";
  msg.title = msg.textContent;
  msg.classList.toggle("why", !!m?.warn);
  const ta = $(".nt-ta", w.body);
  if (ed && ta) {
    const s = ta.selectionStart;
    pos.textContent = `Ln ${fmt(nlCount(ed.text, s) + 1)}, Col ${fmt(s - (s ? ed.text.lastIndexOf("\n", s - 1) : -1))}`;
  }
  st.textContent = ed ? { draft: "Not saved", unsaved: "Unsaved", saving: "Saving…", saved: "Saved", error: "Not saved" }[ed.state] : "";
  pos.hidden = st.hidden = !ed;
}
// everything but the textarea: the list, the toolbar, the status bar and the title
export function notesPaint(w) {
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
export function noteWrap(w) {
  const ta = $(".nt-ta", w.body); if (!ta) return;
  $(".nt-scroll", w.body).classList.toggle("wrap", !!S.notePref.wrap);
  ta.wrap = S.notePref.wrap ? "soft" : "off";
}

/* editing: replace a range through execCommand so Cmd+Z undoes it (setRangeText as a fallback) */
export function noteEdit(ta, start, end, text) {
  ta.setSelectionRange(start, end);
  if (!document.execCommand(text ? "insertText" : "delete", false, text)) {
    ta.setRangeText(text, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
// Ctrl/Cmd+D: delete the lines the selection touches
export function noteDelLine(ta) {
  const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, a = v.lastIndexOf("\n", s - 1) + 1;
  let b = v.indexOf("\n", e > s && v[e - 1] === "\n" ? e - 1 : e);
  if (b < 0 && a > 0) { const p = v.lastIndexOf("\n", a - 2) + 1; noteEdit(ta, a - 1, v.length, ""); ta.setSelectionRange(p, p); return; }
  noteEdit(ta, a, b < 0 ? v.length : b + 1, "");
  ta.setSelectionRange(a, a);
}
// Tab: two spaces at the caret, or indent the selected lines; Shift+Tab: outdent
export function noteIndent(ta, out) {
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
export function noteDialog({ title, msg, value, ok, danger, act }) {
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
export async function noteNew(w) {
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
export function noteRenamed(w, ed, info, was) {
  ed.name = info.name; ed.lang = langOfName(info.name);
  if (w.sel === was) { w.sel = info.name; save(); }
  noteListPut(info, was); notePaint(w); notesPaint(w);
}
export async function noteRename(w) {
  const ed = w.ed; if (!ed?.name) return;
  await notesFlush();
  await noteDialog({ title: "Rename note", msg: "New name:", value: ed.name, ok: "Rename", act: async v => {
    const was = ed.name, info = await api("/api/notes/rename", { name: was, to: noteFileName(v, ed.lang) });
    noteRenamed(w, ed, info, was);
  } });
}
export async function noteLang(w, lang) {
  const ed = w.ed; if (!ed || lang === ed.lang) return;
  if (!ed.name) { ed.lang = notesSt.draft.lang = lang; notePaint(w); notesPaint(w); return; }
  await notesFlush();
  const was = ed.name;
  try { noteRenamed(w, ed, await api("/api/notes/rename", { name: was, to: was.replace(/\.[^.]*$/, "") + "." + extOf(lang) }), was); w.ntMsg = { text: `Renamed to ${ed.name}` }; }
  catch (e) { w.ntMsg = { text: e.message, warn: true }; }
  notesPaint(w);
}
export async function noteDelete(w) {
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
export async function noteKeep(w) {
  const ed = w.ed; if (!ed || ed.name) return;
  await noteDialog({ title: "Save as note", msg: "Name:", value: `From link.${extOf(ed.lang)}`, ok: "Save", act: async v => {
    const info = await api("/api/notes", { name: noteFileName(v, ed.lang), text: ed.text, create: true });
    notesSt.draft = null;
    Object.assign(ed, { name: info.name, saved: ed.text, lang: langOfName(info.name), state: "saved" });
    w.sel = info.name; w.ntMsg = { text: `Saved as ${info.name}` }; save();
    noteListPut(info); notePaint(w);
  } });
}
export async function noteCopyLink(w) {
  const ed = w.ed; if (!ed) return;
  try {
    const url = await noteEncode(ed.text, ed.lang);
    await navigator.clipboard.writeText(url);
    const n = url.length;
    w.ntMsg = n > NOTE_LINK_WARN ? { text: `Link copied, ${fmt(n)} characters. Some apps cut links longer than ${fmt(NOTE_LINK_WARN)} characters.`, warn: true } : { text: `Link copied, ${fmt(n)} characters.` };
  } catch (e) { w.ntMsg = { text: e.name === "NotAllowedError" ? "The browser blocked clipboard access." : `Couldn't make the link: ${e.message}`, warn: true }; }
  noteStatus(w);
}

export function notesRender(w) {
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
    // one frame's worth of typing is painted once, just before the frame is drawn
    if (!w.ntRaf) w.ntRaf = requestAnimationFrame(() => { w.ntRaf = 0; notePaint(w); noteStatus(w); noteReveal(w); });
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
export async function noteFromHash(hash) {
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
export const noteHash = location.hash; // read now, before anything can change it

export function init() {
  RENDER.notes = w => notesRender(w);
  try { S.notePref = { ...S.notePref, ...JSON.parse(localStorage.getItem(NOTE_PREF)) }; } catch {}
  addEventListener("pagehide", () => notesSt.dirty.forEach(ed => {
    if (ed.name && ed.text !== ed.saved) fetch("/api/notes", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ed.name, text: ed.text }) }).catch(() => {});
  }));
  // terminal links to notes (ls notes, tree)
  desk.addEventListener("click", e => { const a = e.target.closest("[data-note-open]"); if (a) openNote(a.dataset.noteOpen, a); });
  setTimeout(() => { notesLoad(); noteFromHash(noteHash); }, 0);
  addEventListener("hashchange", () => noteFromHash(location.hash));
  SIG.notes = () => "";
}
