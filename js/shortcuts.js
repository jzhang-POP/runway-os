import { S, wins } from "./core/state.js";
import { $, $$, clampN, menuEl, startBtn, startMenu } from "./core/dom.js";
import { runOf } from "./core/status.js";
import { balloon, copyJob } from "./core/ui.js";
import { D, px } from "./wm/geometry.js";
import { APP_KEYS, KINDS } from "./wm/kinds.js";
import { save } from "./wm/persist.js";
import { moveSel } from "./wm/selection.js";
import { setStart } from "./wm/taskbar.js";
import { close, defaultOpen, fit, focus, focusInto, frontWin, minOf, minimize, open, place, restore, snapHalf, toggleMax } from "./wm/windows.js";
import { treeMove } from "./apps/tree.js";
import { step } from "./apps/viewer.js";
import { hideMenu, runMenu, windowMenu } from "./menus.js";

// keyboard Move and Size, as in Win95: arrow keys move or size the window (Shift: 1 px), Enter or a click keeps it, Esc puts it back
export const KB_HINT = "Enter to finish, Esc to cancel.";
export function kbStart(w, mode) {
  kbEnd(true);
  if (w.max || w.minimized || wins.get(w.id) !== w) return;
  S.kb = { w, mode, start: { x: w.x, y: w.y, wd: w.wd, ht: w.ht, snapped: w.snapped, pre: w.pre } };
  focus(w);
  if (!w.el.contains(document.activeElement)) focusInto(w);
  w.el.classList.add("kbmode");
  balloon(mode === "move" ? { title: "Move window", text: `Arrow keys move it. ${KB_HINT}`, ms: 6000 } : { title: "Size window", text: `Arrow keys change its width and height. ${KB_HINT}`, ms: 6000 });
}
export function kbEnd(keep) {
  if (!S.kb) return;
  const { w, start } = S.kb;
  S.kb = null;
  w.el.classList.remove("kbmode");
  if (!keep) Object.assign(w, start);
  if (wins.get(w.id) === w) { fit(w); place(w); }
  if (keep) save();
  const b = $("#balloon"); if (b && !b.hidden && b.textContent.includes(KB_HINT)) b.hidden = true; // the hint no longer applies
}

export const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
// the letter printed on the key, whatever the layout (Option on a Mac changes e.key, so go through the code)
export const letterOf = ev => String(S.layoutMap?.get(ev.code) || (ev.code?.startsWith("Key") ? ev.code.slice(3) : ev.key) || "").toLowerCase();
export const codesFor = letters => { const out = []; S.layoutMap?.forEach((k, code) => { if (letters.includes(k)) out.push(code); }); return out.length ? out : letters.map(l => "Key" + l.toUpperCase()); };
export async function toggleFullScreen() {
  try {
    if (document.fullscreenElement) { navigator.keyboard?.unlock?.(); await document.exitFullscreen(); return; }
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    await navigator.keyboard?.lock?.([...codesFor(["w", "n", "t", "m"]), "Backquote"]);
    balloon({ title: "Full screen", text: "Cmd+W now closes the window in Runway OS. Hold Esc to leave full screen.", ms: 3600 });
  } catch (err) { balloon({ title: "Couldn't go full screen", text: err.message, ms: 3000 }); }
}

export function init() {
  // capture phase: runs before the terminal, list and gallery keys, and swallows the keys it uses
  addEventListener("keydown", e => {
    if (!S.kb || ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    const { w, mode } = S.kb, dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
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
  navigator.keyboard?.getLayoutMap?.().then(m => { S.layoutMap = m; }).catch(() => {});
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) navigator.keyboard?.unlock?.(); });

  /* ---------- keyboard ---------- */
  addEventListener("keydown", ev => {
    // key events can target window/document; treat those as coming from <body>
    const e = { key: ev.key, code: ev.code, altKey: ev.altKey, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, preventDefault: () => ev.preventDefault(), target: ev.target instanceof Element ? ev.target : document.body };
    if (e.key === "Escape" && e.ctrlKey) { e.preventDefault(); hideMenu(); setStart(startMenu.hidden); return; }
    if (e.key === "Escape") {
      if (!menuEl.hidden) { hideMenu(); return; }
      if (!startMenu.hidden) { setStart(false); startBtn.focus(); return; }
      const f = frontWin();
      if (f && (f.kind === "viewer" || f.kind === "props" || f.kind === "compare") && !e.target.closest("input")) close(f);
      return;
    }
    if (!menuEl.hidden || !startMenu.hidden) return;
    const f = frontWin();
    const cmd = MAC ? ev.metaKey && !e.ctrlKey : e.ctrlKey && !ev.metaKey, L = letterOf(ev);
    if ((e.altKey || cmd) && e.code === "Backquote") { // switch windows
      e.preventDefault();
      const list = [...wins.values()].sort((a, b) => b.z - a.z); if (list.length < 2) return;
      const next = e.shiftKey ? list[list.length - 1] : list.find(w => w !== f && !w.minimized) || list[1];
      next.minimized ? restore(next) : (focus(next), save(), focusInto(next));
      return;
    }
    if (e.code === "F11" || (MAC && ev.metaKey && e.ctrlKey && letterOf(ev) === "f")) { e.preventDefault(); toggleFullScreen(); return; }
    if (cmd && !e.altKey) {
      const typingNow = e.target.closest("input, textarea, select, [contenteditable]");
      const r = f && runOf(f.kind === "viewer" || f.kind === "props" ? f.arg : f.sel);
      if (L === "w" && f) { e.preventDefault(); close(f); return; } // arrives only in full screen with the keyboard locked
      if (L === "m" && f && !e.shiftKey) { e.preventDefault(); minimize(f); return; }
      if (e.key === ",") { e.preventDefault(); open("options"); return; }
      if (e.key === "?" || (e.code === "Slash" && e.shiftKey)) { e.preventDefault(); open("keys"); return; }
      if (L === "i" && r && !typingNow) { e.preventDefault(); open("props", r.taskId); return; }
      if ((L === "o" || e.code === "ArrowDown") && r && !typingNow && f.kind !== "viewer") { e.preventDefault(); defaultOpen(r); return; }
      if (L === "f" && !e.shiftKey && typingNow?.tagName !== "TEXTAREA") {
        const box = f && $('input[type="search"]', f.body);
        e.preventDefault();
        if (box) { box.focus(); box.select(); } else { const j = open("jobs"); setTimeout(() => $('input[type="search"]', j.body)?.focus(), 0); }
        return;
      }
    }
    if (e.altKey && (L === "w" || e.code === "F4") && f) { e.preventDefault(); close(f); return; }
    const typing = e.target.closest("input, textarea, select, [contenteditable]");
    if (!typing && (e.code === "F1" || (e.key === "?" && !e.altKey && !ev.metaKey && !e.ctrlKey))) { e.preventDefault(); open("keys"); return; }
    if (e.altKey && !typing && !ev.metaKey && !e.ctrlKey) {
      if (f && e.code === "ArrowDown") { e.preventDefault(); minimize(f); return; }
      if (f && e.code === "ArrowUp") { e.preventDefault(); if (f.max || f.snapped) toggleMax(f); else { f.max = true; place(f); save(); } return; }
      if (f && (e.code === "ArrowLeft" || e.code === "ArrowRight")) { e.preventDefault(); snapHalf(f, e.code === "ArrowLeft" ? "left" : "right"); return; }
      const want = (e.shiftKey ? "Shift+" : "") + (e.code === "Slash" ? "/" : /^[a-z]$/.test(L) ? L.toUpperCase() : "");
      const app = Object.keys(APP_KEYS).find(k => APP_KEYS[k] === want && KINDS[k]);
      if (app) { e.preventDefault(); open(app); return; }
    }
    if (((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") && !typing && f) {
      const r = runOf(f.kind === "viewer" || f.kind === "props" ? f.arg : f.sel);
      const el = (f.sel && $$("[data-id]", f.body).find(x => x.dataset.id === f.sel && x.offsetParent)) || $(".titlebar", f.el), b = el.getBoundingClientRect();
      e.preventDefault();
      r ? runMenu(r, b.left + 8, b.bottom - 4, el) : windowMenu(f, b.left + 8, b.bottom - 4);
      return;
    }
    if ((ev.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && L === "c" && !typing && f && !String(getSelection())) {
      const r = runOf(f.kind === "viewer" || f.kind === "props" ? f.arg : f.sel);
      if (r) { e.preventDefault(); copyJob(r); return; }
    }
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
    if (f.kind === "tree" && !e.target.closest(".dicon")) {
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); treeMove(f, e.key); }
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
}
