import { S, wins } from "../core/state.js";
import { $, desk, menuEl } from "../core/dom.js";
import { api } from "../core/api.js";
import { balloon } from "../core/ui.js";
import { D, px } from "../wm/geometry.js";
import { save } from "../wm/persist.js";
import { fit, focus, frontWin, minOf, open, place, winOf } from "../wm/windows.js";
import { curModel, curTask, genMsg } from "./generate.js";
import { NOTE_DRAFT, noteEdit, noteFill, noteGet, noteListPut, noteStatus, notesFlush, notesLoad, notesSt, openNote } from "./notes.js";
import { MAC, letterOf, showMenu } from "../main.js";

/* ---------- notes as a prompt library for Generate ----------
   Notes → Generate: Use as prompt (the selection, or the whole note), a note dragged from the list onto Generate,
   and Prompts… under Generate's prompt. Generate → Notes: Save to Notes… (a new note, or added to the end of one)
   and Cmd+Shift+S. A note drag carries its own type, so Generate's media inputs never mistake it for a file. */
export const NOTE_DRAG = "application/x-runway-note";
export const NOTE_DRAG_LINK = ":link"; // the unsaved note from a link, in a drag (NOTE_DRAFT holds a NUL)
export const noteCache = new Map(); // name → { stamp, text }: previews and drags without reading every file each time
export const clipText = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
export const notePreview = t => clipText(String(t || "").split("\n").map(l => l.trim()).find(Boolean) || "", 48);
// a note's current text: an open editor's (it may not be saved yet), else the file's
export async function noteTextOf(key) {
  if (key === NOTE_DRAFT || key === NOTE_DRAG_LINK) return notesSt.draft?.text ?? "";
  for (const w of wins.values()) if (w.kind === "notes" && w.ed?.name === key) return w.ed.text;
  const info = (notesSt.list || []).find(n => n.name === key), stamp = info ? `${info.modified}|${info.size}` : null, hit = noteCache.get(key);
  if (hit && stamp && hit.stamp === stamp) return hit.text;
  const d = await noteGet(key);
  noteCache.set(key, { stamp, text: d.text });
  return d.text;
}
// the notes for a menu, newest first, with their text (null when a file can't be read)
export async function notesForMenu(max = 30) {
  await notesLoad();
  if (notesSt.err) throw new Error(`Couldn't load the notes. ${notesSt.err}`);
  const list = [...(notesSt.list || [])].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)).slice(0, max);
  const texts = await Promise.all(list.map(n => noteTextOf(n.name).catch(() => null)));
  return list.map((n, i) => ({ ...n, text: texts[i] }));
}

// Generate's prompt box: promptText, else the first long text field
export const genPromptTa = w => $('textarea.gprompt[data-f="promptText"]', w.body) || $("textarea.gprompt", w.body);
// put text in a prompt box at `at`, or over the selection, or over everything (replace). noteEdit keeps Cmd+Z working,
// and its input event updates the form, the character counter (which flags a prompt over the model's limit) and the layout.
export function promptInsert(ta, text, { at, replace } = {}) {
  text = String(text || "").trim(); if (!text) return;
  const v = ta.value, s = replace ? 0 : at ?? ta.selectionStart, e = replace ? v.length : at ?? ta.selectionEnd;
  const pre = s > 0 && !/\s/.test(v[s - 1]) ? " " : "", post = e < v.length && !/\s/.test(v[e]) ? " " : "";
  ta.focus({ preventScroll: true });
  noteEdit(ta, s, e, pre + text + post);
  ta.scrollIntoView({ block: "nearest" });
}
// into Generate's prompt; a task without a prompt keeps the text until one with a prompt is picked (genLibBar)
export function genTakeText(w, text, how = {}) {
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
export function genBeside(from) {
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
export function noteUseAsPrompt(w) {
  const ed = w.ed, ta = $(".nt-ta", w.body); if (!ed) return;
  const sel = ta && ta.selectionEnd > ta.selectionStart ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : "";
  const text = (sel.trim() ? sel : ed.text).trim();
  if (!text) { w.ntMsg = { text: "This note is empty. Write a prompt in it first.", warn: true }; noteStatus(w); return; }
  genTakeText(genBeside(w), text, { replace: true });
}

/* Generate side: dropping a note */
export const isNoteDrag = e => [...(e.dataTransfer?.types || [])].includes(NOTE_DRAG);
export const caretAt = (ta, x, y) => { const p = document.caretPositionFromPoint?.(x, y); return p && p.offsetNode === ta ? p.offset : null; };

/* Generate side: Prompts… and Save to Notes… under the prompt */
// called at the end of genFields: adds the two buttons to the prompt's footer, and puts in text that was waiting for a prompt
export function genLibBar(w) {
  const ta = genPromptTa(w); if (!ta) return;
  let foot = ta.nextElementSibling?.classList.contains("gtfoot") ? ta.nextElementSibling : null;
  if (!foot) { foot = document.createElement("div"); foot.className = "gtfoot"; ta.after(foot); }
  foot.insertAdjacentHTML("afterbegin", `<span class="gplib">
      <button type="button" class="raised btn-s" data-plib="pick" title="Insert a note from Notes at the caret">Prompts…</button>
      <button type="button" class="raised btn-s" data-plib="save" title="Save the prompt as a new note, or add it to the end of one (Cmd+Shift+S saves a new note)">Save to Notes…</button></span>`);
  if (w.promptWait) { const p = w.promptWait; w.promptWait = null; queueMicrotask(() => { genMsg(w, null); promptInsert(ta, p.text, p); }); }
}
// a new note's name: the prompt's first few words, without characters a file name can't have, then " 2", " 3"… when taken
export function promptNoteName(text) {
  const words = text.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, " ").split(/\s+/).filter(Boolean);
  let n = "";
  for (const wd of words.slice(0, 6)) { const next = n ? `${n} ${wd}` : wd; if (next.length > 40) break; n = next; }
  n = (n || (words[0] || "").slice(0, 40)).replace(/^[.\s]+|[.,;:!\s-]+$/g, "") || "Prompt";
  const taken = new Set((notesSt.list || []).map(x => x.name.toLowerCase()));
  for (let i = 1; ; i++) { const name = `${n}${i > 1 ? ` ${i}` : ""}.txt`; if (!taken.has(name.toLowerCase())) return name; }
}
export const genPromptText = w => (genPromptTa(w)?.value || "").trim();
export function genNoPrompt(w) {
  const ta = genPromptTa(w);
  genMsg(w, ta ? "Write a prompt first, then save it to Notes." : `${curTask(w)?.label || "This task"} has no prompt to save.`);
  ta?.focus();
}
// save the prompt as a new note, or (into) add it to the end of an existing one
export async function promptSave(w, into) {
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
export async function promptsMenu(w, btn) {
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
export async function promptSaveMenu(w, btn) {
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

export function init() {
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
}
