import { S, ready, wins } from "./core/state.js";
import { $, $$, clampN, desk, esc, fmt, menuEl, startBtn, startMenu } from "./core/dom.js";
import { FAV, logoSVG } from "./core/graphics.js";
import { ACTIVE, runOf, typeIcon } from "./core/status.js";
import { absTime, ago, dur, tOf, upTo } from "./core/time.js";
import { announce, balloon, copyJob, copyText, fileAction, init as uiInit } from "./core/ui.js";
import { D, px } from "./wm/geometry.js";
import { APP_KEYS, KINDS, RENDER, SIG } from "./wm/kinds.js";
import { KEY, resetLayout, restoreLayout, save } from "./wm/persist.js";
import { menuSelect, moveSel, multiClick, select } from "./wm/selection.js";
import { renderTasks, renderTray, setStart, init as taskbarInit } from "./wm/taskbar.js";
import { cascadeAll, close, defaultOpen, fit, focus, focusInto, frontWin, minOf, minimize, open, place, renderWin, restore, snapHalf, tileAll, toggleMax, winOf, init as windowsInit } from "./wm/windows.js";
import { arrangeIcons, layoutIcons, init as iconsInit } from "./desktop/icons.js";
import { init as activityInit } from "./apps/activity.js";
import { cmpMenu, init as compareInit } from "./apps/compare.js";
import { init as galleryInit } from "./apps/gallery.js";
import { cancelJob, genFrom, init as generateInit } from "./apps/generate.js";
import { init as jobsInit } from "./apps/jobs.js";
import { init as keyInit } from "./apps/key.js";
import { init as keysInit } from "./apps/keys.js";
import { init as notesInit } from "./apps/notes.js";
import { applyOptions, calm, init as optionsInit } from "./apps/options.js";
import { init as overviewInit } from "./apps/overview.js";
import { init as promptlibInit } from "./apps/promptlib.js";
import { init as propsInit } from "./apps/props.js";
import { spendUpdate, init as spendInit } from "./apps/spend.js";
import { termPaint, init as terminalInit } from "./apps/terminal.js";
import { treeMove, init as treeInit } from "./apps/tree.js";
import { init as usageInit } from "./apps/usage.js";
import { step, init as viewerInit } from "./apps/viewer.js";
import { init as dndInit } from "./dnd.js";

/* ---------- context menus ---------- */
export function showMenu(x, y, items) {
  S.menuItems = items.filter(Boolean);
  S.menuReturn = document.activeElement;
  menuEl.innerHTML = S.menuItems.map((it, i) => it.sep ? '<hr class="etch">'
    : `<button role="menuitem" data-i="${i}" class="${it.bold ? "bold" : ""}" ${it.disabled ? "disabled" : ""}>${it.icon ? `<svg class="mico" aria-hidden="true"><use href="#${it.icon}"/></svg>` : ""}<span>${esc(it.label)}</span>${it.sub ? `<small class="msub">${esc(it.sub)}</small>` : ""}${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ""}</button>`).join("");
  menuEl.hidden = false;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = clampN(x, 0, innerWidth - r.width) + "px";
  menuEl.style.top = clampN(y, 0, innerHeight - r.height) + "px";
  $("button:not(:disabled)", menuEl)?.focus();
}
export const hideMenu = () => { if (!menuEl.hidden) { menuEl.hidden = true; S.menuReturn?.focus?.(); } };
export const menuKeys = (root, e) => {
  const items = $$("button:not(:disabled)", root), i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
  if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
  if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
};

export function runMenu(r, x, y, src) {
  showMenu(x, y, [
    { label: r.asset ? "Open" : "Properties", icon: r.asset ? typeIcon(r.type) : "i-doc", bold: true, hint: "Enter", act: () => defaultOpen(r, src) },
    r.asset && { label: "Properties", icon: "i-doc", hint: "Cmd+I", act: () => open("props", r.taskId, src) },
    r.parent && runOf(r.parent) && { label: "Go to source", act: () => open("props", r.parent, src) },
    ...cmpMenu(r, src),
    { sep: true },
    r.type === "image" && r.asset && { label: "Animate into video…", icon: "i-animate", act: () => genFrom(r, "animate", src) },
    (r.type === "image" || r.type === "video") && r.asset && { label: "Upscale…", icon: "i-upscale", act: () => genFrom(r, "upscale", src) },
    r.type === "video" && r.asset && { label: "Add sound…", icon: "i-sound", act: () => genFrom(r, "sound", src) },
    r.type === "video" && r.asset && { label: "Convert to HDR…", icon: "i-hdr", act: () => genFrom(r, "hdr", src) },
    { label: "Generate again…", icon: "i-again", act: () => genFrom(r, "again", src) },
    ACTIVE.has(r.status) && { label: "Cancel job", icon: "i-stop", act: () => cancelJob(r) },
    { sep: true },
    { label: "Copy prompt", icon: "i-copy", act: () => copyText(r.prompt, "Prompt copied") },
    { label: "Copy task ID", icon: "i-copy", act: () => copyText(r._of || r.taskId, "Task ID copied") },
    { sep: true },
    { label: "Show in Finder", icon: "i-finder", disabled: !r.asset, act: () => fileAction("reveal", r.asset) },
    { label: "Open in default app", icon: "i-open", disabled: !r.asset, act: () => fileAction("open", r.asset) },
  ]);
}
export function windowMenu(w, x, y) {
  showMenu(x, y, [
    { label: "Restore", disabled: !w.max && !w.snapped && !w.minimized, act: () => (w.minimized ? restore(w) : toggleMax(w)) },
    { label: "Move", disabled: w.max || w.minimized, act: () => kbStart(w, "move") },
    { label: "Size", disabled: w.max || w.minimized, act: () => kbStart(w, "size") },
    { label: "Minimize", hint: "Cmd+M", disabled: w.minimized, act: () => minimize(w) },
    { label: "Maximize", hint: "Alt+↑", disabled: w.max, act: () => { if (w.minimized) restore(w); if (!w.max) toggleMax(w); } },
    { sep: true },
    { label: "Close", bold: true, hint: document.fullscreenElement ? "Cmd+W" : "Alt+W", act: () => close(w) },
  ]);
}
// keyboard Move and Size, as in Win95: arrow keys move or size the window (Shift: 1 px), Enter or a click keeps it, Esc puts it back
const KB_HINT = "Enter to finish, Esc to cancel.";
function kbStart(w, mode) {
  kbEnd(true);
  if (w.max || w.minimized || wins.get(w.id) !== w) return;
  S.kb = { w, mode, start: { x: w.x, y: w.y, wd: w.wd, ht: w.ht, snapped: w.snapped, pre: w.pre } };
  focus(w);
  if (!w.el.contains(document.activeElement)) focusInto(w);
  w.el.classList.add("kbmode");
  balloon(mode === "move" ? { title: "Move window", text: `Arrow keys move it. ${KB_HINT}`, ms: 6000 } : { title: "Size window", text: `Arrow keys change its width and height. ${KB_HINT}`, ms: 6000 });
}
function kbEnd(keep) {
  if (!S.kb) return;
  const { w, start } = S.kb;
  S.kb = null;
  w.el.classList.remove("kbmode");
  if (!keep) Object.assign(w, start);
  if (wins.get(w.id) === w) { fit(w); place(w); }
  if (keep) save();
  const b = $("#balloon"); if (b && !b.hidden && b.textContent.includes(KB_HINT)) b.hidden = true; // the hint no longer applies
}
export const deskMenu = (x, y) => showMenu(x, y, [
  { label: "Arrange icons", act: () => arrangeIcons() },
  { sep: true },
  { label: "Cascade windows", act: cascadeAll },
  { label: "Tile windows", act: tileAll },
  { label: "Minimize all windows", act: () => wins.forEach(w => !w.minimized && minimize(w, false)) },
  { sep: true },
  { label: "Close all windows", act: resetLayout },
  { label: "Show folder in Finder", act: () => fileAction("reveal", "runs.json") },
]);

export const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
// the letter printed on the key, whatever the layout (Option on a Mac changes e.key, so go through the code)
export const letterOf = ev => String(S.layoutMap?.get(ev.code) || (ev.code?.startsWith("Key") ? ev.code.slice(3) : ev.key) || "").toLowerCase();
const codesFor = letters => { const out = []; S.layoutMap?.forEach((k, code) => { if (letters.includes(k)) out.push(code); }); return out.length ? out : letters.map(l => "Key" + l.toUpperCase()); };
export async function toggleFullScreen() {
  try {
    if (document.fullscreenElement) { navigator.keyboard?.unlock?.(); await document.exitFullscreen(); return; }
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    await navigator.keyboard?.lock?.([...codesFor(["w", "n", "t", "m"]), "Backquote"]);
    balloon({ title: "Full screen", text: "Cmd+W now closes the window in Runway OS. Hold Esc to leave full screen.", ms: 3600 });
  } catch (err) { balloon({ title: "Couldn't go full screen", text: err.message, ms: 3000 }); }
}

/* ---------- right-click: an in-app menu everywhere; Shift + right-click keeps the browser's own menu ---------- */
async function pasteInto(el) {
  try {
    const t = await navigator.clipboard.readText();
    el.focus(); el.setRangeText(t, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } catch { balloon({ title: "Couldn't paste", text: "The browser blocked reading the clipboard. Press Cmd+V instead.", ms: 4000 }); }
}
function textMenu(el, x, y) {
  const sel = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0), ro = el.readOnly || el.disabled;
  showMenu(x, y, [
    { label: "Cut", icon: "i-copy", hint: "Cmd+X", disabled: !sel || ro, act: () => { navigator.clipboard?.writeText(sel).catch(() => {}); el.focus(); el.setRangeText("", el.selectionStart, el.selectionEnd, "end"); el.dispatchEvent(new Event("input", { bubbles: true })); } },
    { label: "Copy", icon: "i-copy", hint: "Cmd+C", disabled: !sel, act: () => copyText(sel, "Copied") },
    { label: "Paste", hint: "Cmd+V", disabled: ro, act: () => pasteInto(el) },
    { sep: true },
    { label: "Select all", hint: "Cmd+A", disabled: !el.value, act: () => { el.focus(); el.select(); } },
  ]);
}
// first launch (no saved layout, so restoreLayout opens just the terminal): once the first state poll answers
// and there is no API key, open the key window on top as well. Later loads have a saved layout and skip this.
const firstLaunch = (() => { try { return !Array.isArray(JSON.parse(localStorage.getItem(KEY))); } catch { return true; } })();

/* ---------- boot screen: a BIOS self-test over the real startup; the log stays up until you start ---------- */
// each startup check with its time (ms since the page started loading), kept for the bootlog command
export const bootLog = [];
async function bootScreen(modelsLoaded) {
  // the checks run and are logged even with the boot screen off; the screen only shows them
  const show = S.opts.boot, fast = calm(), deadline = Date.now() + 8000;
  let el = null, log = null, hint = null, phase = "loading", early = false;
  const setHint = t => { if (hint) hint.textContent = t; };
  const btns = () => (el ? $$(".boot-act button", el) : []);
  const start = async withKey => {
    if (S.bootDone) return;
    S.bootDone = true;
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
    if (S.bootDone) return;
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
    if (S.bootDone || phase !== "loading") return;
    e.preventDefault();
    if (!early) { early = true; setHint("Starting when loading finishes… Press Esc to start now."); }
  };
  if (show) {
    S.bootDone = false;
    el = document.createElement("div");
    el.className = "boot";
    // one centered column: logo, name, progress bar, the checks as they run, then the Start button
    el.innerHTML = `<div class="boot-col">
          <span class="boot-logo" aria-hidden="true">${logoSVG("#ffffff")}</span>
          <b class="boot-name">runway os</b>
          <div class="boot-bar" role="progressbar" aria-label="Starting runway os" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
          <ul class="boot-log" role="log" aria-live="polite"></ul>
          <div class="boot-sum" aria-live="polite"></div>
          <div class="boot-act"></div>
          <div class="boot-hint" aria-live="polite">Press any key to start when loading finishes, or Esc to start now.</div>
        </div>`;
    document.body.append(el); document.body.classList.add("booting");
    log = $(".boot-log", el); hint = $(".boot-hint", el);
    addEventListener("keydown", onKey, true); addEventListener("pointerdown", onPointer, true);
  }
  // a line prints when its check starts; its result is added, and the line logged, when the check finishes
  const STEPS = 5;
  let doneSteps = 0;
  const begin = text => {
    const d = log && document.createElement("li");
    if (d) { d.innerHTML = `<span></span><span class="res wait">…</span>`; d.firstChild.textContent = text; log.append(d); }
    return { d, text };
  };
  const end = (row, res, bad = false) => {
    bootLog.push({ ms: Math.round(performance.now()), text: row.text, res, bad });
    doneSteps++;
    if (el) { const pct = Math.min(100, Math.round((doneSteps / STEPS) * 100)); $(".boot-bar i", el).style.width = pct + "%"; $(".boot-bar", el).setAttribute("aria-valuenow", pct); }
    if (!row.d) return;
    const r = row.d.lastChild; r.textContent = res || "OK"; r.className = "res" + (bad ? " bad" : "");
  };
  const summary = text => { bootLog.push({ ms: Math.round(performance.now()), text, res: "", bad: false }); if (el) $(".boot-sum", el).textContent = text; };
  const wait = p => upTo(p, Math.max(0, deadline - Date.now()));

  let row = begin("Server");
  end(row, location.protocol === "file:" ? "opened as a file" : location.host, location.protocol === "file:");
  row = begin("Loading model list…");
  if (!(await wait(modelsLoaded)) || !S.CAT) end(row, "failed. Generate can't list models", true);
  else { const t = S.CAT.tasks || []; end(row, `${new Set(t.flatMap(x => x.models.map(m => m.id))).size} models, ${t.length} tasks`); }
  row = begin("Connecting to Runway API…");
  // the first /api/state answer, or the first failed poll (poll keeps retrying every 3 s)
  while (!S.loaded && S.conn.cls !== "off" && Date.now() < deadline) await upTo(ready, 50);
  if (!S.loaded) end(row, S.conn.cls === "off" ? "server not reachable" : "no answer after 8 s", true);
  else if (!S.data.live) end(row, "no key", true);
  else if (S.data.error) end(row, S.data.error, true);
  else end(row, "OK");
  const live = S.loaded && S.data.live && !S.data.error, n = S.data.runs.length;
  const when = S.data.balanceAt ? `, last known ${absTime(tOf(S.data.balanceAt))}` : ", last known";
  end(begin("Credits"), !S.loaded || S.data.balance == null ? "unknown" : fmt(S.data.balance) + (live ? "" : when), !S.loaded || S.data.balance == null);
  end(begin("Jobs"), S.loaded ? `${fmt(n)} found` : "unknown", !S.loaded);
  summary(!S.loaded ? (S.conn.cls === "off" ? `Server not reachable. Run python3 server.py${location.protocol === "file:" ? " and open the address it prints" : "; runway os keeps trying"}.` : "The server hasn't answered yet; runway os keeps trying.")
    : !S.data.live ? "Ready without a Runway key."
    : S.data.error ? "Ready, but the Runway API reported an error."
    : `Ready. ${S.data.balance == null ? "Credits unavailable" : fmt(S.data.balance) + " credits"}, ${fmt(n)} job${n === 1 ? "" : "s"}.`);
  phase = "ready";
  if (!show || S.bootDone) return;
  if (early) { start(false); return; }
  const act = $(".boot-act", el), keyBtn = S.loaded && !live;
  act.innerHTML = `<button class="raised btn-s default" data-start>Start runway os</button>${keyBtn ? '<button class="raised btn-s" data-start="key">Start and add API key</button>' : ""}`;
  act.addEventListener("click", e => { const b = e.target.closest("[data-start]"); if (b) start(b.dataset.start === "key"); });
  $("button", act).focus();
  setHint(keyBtn ? "Press Enter to start, or Tab to choose the other button." : "Press Enter to start");
}
// the server answers 304 when nothing changed, so an idle poll costs almost nothing
function schedulePoll() {
  clearTimeout(S.pollT);
  const ms = document.hidden ? 30000 : S.data.runs.some(r => ACTIVE.has(r.status)) ? 2000 : 5000;
  S.pollT = setTimeout(() => poll().finally(schedulePoll), ms);
}
export async function poll() {
  try {
    const res = await fetch("/api/state", { cache: "no-store", headers: S.stateTag && S.loaded ? { "If-None-Match": S.stateTag } : {} });
    if (res.status === 304) {
      if (S.conn.cls === "off" && S.lastConn) { S.conn = S.lastConn; wins.forEach(w => w.kind === "overview" && renderWin(w)); }
      return;
    }
    S.stateTag = res.headers.get("ETag");
    const d = await res.json();
    const c = d.error ? { cls: "warn", text: "Runway API: " + d.error } : d.live ? { cls: "on", text: "Connected" } : { cls: "warn", text: "No API key" };
    const runs = d.runs || [], rs = JSON.stringify(runs) + JSON.stringify(d.inputs || []), ss = rs + d.balance + d.balanceAt + (d.history || []).length;
    const first = !S.loaded, runsChanged = rs !== S.runsSig, anyChanged = ss !== S.stateSig;
    const connChanged = c.text !== S.conn.text || c.cls !== S.conn.cls;
    const keySig = [d.live, d.keySource, d.keyHint, d.error].join("|"), keyChanged = keySig !== S.data.keySig;
    S.data = { runs, balance: d.balance, balanceAt: d.balanceAt, history: d.history || [], live: !!d.live, keySource: d.keySource, keyHint: d.keyHint, error: d.error, keySig, inputs: d.inputs || [] };
    spendUpdate(d);
    if (S.sessionStart == null && d.balance != null) S.sessionStart = { balance: d.balance, at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    S.runsSig = rs; S.stateSig = ss; S.conn = c; S.lastConn = c; S.loaded = true; S.markReady();
    if (!first) runs.forEach(r => { const was = S.prevStatus.get(r.taskId); if (was && ACTIVE.has(was) && !ACTIVE.has(r.status)) announce(r); });
    S.prevStatus = new Map(runs.map(r => [r.taskId, r.status]));
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
    if (c.text !== S.conn.text) { S.conn = c; wins.forEach(w => w.kind === "overview" && renderWin(w)); }
  }
}

// clock + relative times
const clock = $("#clock");
export function tick() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], S.opts.clock24 ? { hour: "2-digit", minute: "2-digit", hour12: false } : { hour: "numeric", minute: "2-digit", hour12: true });
  clock.title = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  $$("time[data-t]").forEach(t => { t.textContent = t.dataset.kind === "elapsed" ? dur(Date.now() - +t.dataset.t) : ago(+t.dataset.t); });
}

// the model list and the first state load in parallel
const modelsLoaded = fetch("/api/models").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(c => { S.CAT = c; }).catch(() => { S.catFailed = true; })
  .finally(() => wins.forEach(w => w.kind === "generate" && renderWin(w)));


// start: every module's listeners and saved state, in the order the single-file app had them
windowsInit();
dndInit();
keysInit();
overviewInit();
jobsInit();
generateInit();
keyInit();
terminalInit();
optionsInit();
usageInit();
activityInit();
galleryInit();
treeInit();
notesInit();
viewerInit();
propsInit();
promptlibInit();
compareInit();
uiInit();
taskbarInit();
spendInit();
iconsInit();
menuEl.addEventListener("click", e => {
  const b = e.target.closest("button[data-i]"); if (!b) return;
  const it = S.menuItems[+b.dataset.i]; hideMenu(); it.act();
});
menuEl.addEventListener("contextmenu", e => e.preventDefault());
menuEl.addEventListener("keydown", e => menuKeys(menuEl, e));
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
addEventListener("contextmenu", e => {
  if (e.defaultPrevented || e.shiftKey) return; // handled by a more specific menu, or Shift asks for the browser's own
  e.preventDefault();
  const t = e.target instanceof Element ? e.target : document.body;
  if (t.closest(".boot, #shutdown, .menu")) return;
  const field = t.closest("input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea");
  if (field) { textMenu(field, e.clientX, e.clientY); return; }
  const term = t.closest(".term"), w = winOf(t);
  if (term && w) {
    const sel = String(getSelection()), inp = $(".t-in", term);
    showMenu(e.clientX, e.clientY, [
      { label: "Copy", icon: "i-copy", hint: "Cmd+C", disabled: !sel, act: () => copyText(sel, "Copied") },
      { label: "Paste", hint: "Cmd+V", act: () => pasteInto(inp) },
      { sep: true },
      { label: "Clear screen", hint: "Ctrl+L", act: () => { w.term.lines = []; termPaint(w); inp.focus(); } },
    ]);
    return;
  }
  if (w) { windowMenu(w, e.clientX, e.clientY); return; }
  if (t.closest("#desktop")) deskMenu(e.clientX, e.clientY);
});
desk.addEventListener("click", e => {
  const c = e.target.closest("[data-copy]");
  if (c) {
    const t = $(":scope > span", c) || c, label = t.textContent; // icon buttons keep their icon
    navigator.clipboard?.writeText(c.dataset.copy).then(() => { t.textContent = c.dataset.done || "Copied"; setTimeout(() => { t.textContent = label; }, 900); }).catch(() => {});
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
  const it = e.target.closest(".row[data-id], .tile[data-id], .tnode[data-id]");
  if (it) {
    const w = winOf(it); if (multiClick(w, it.dataset.id, e)) return;
    select(w, it.dataset.id);
    if (S.lastPointer === "touch" && runOf(it.dataset.id)) defaultOpen(runOf(it.dataset.id), it);
  }
});
desk.addEventListener("dblclick", e => {
  const it = e.target.closest(".row[data-id], .tile[data-id], .tnode[data-id]");
  if (it && runOf(it.dataset.id)) defaultOpen(runOf(it.dataset.id), it);
});
desk.addEventListener("contextmenu", e => {
  const it = e.target.closest(".row[data-id], .tile[data-id], .tnode[data-id]"), st = e.target.closest(".stage");
  const r = it ? runOf(it.dataset.id) : st ? runOf(winOf(st)?.arg) : null;
  if (!r) return;
  e.preventDefault();
  if (it) menuSelect(winOf(it), it.dataset.id);
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
if (firstLaunch) ready.then(() => { if (!S.data.live) $(".kin", open("key").body)?.focus({ preventScroll: true }); });
// jobs keep rendering on Runway across a refresh or restart (the server tracks them in runs.json):
// if any are still queued or rendering, bring Activity back so they stay in view, without taking focus
ready.then(() => {
  if (wins.has("activity") || !S.data.runs.some(r => ACTIVE.has(r.status))) return;
  const prev = frontWin(), aw = open("activity");
  if (prev && prev !== aw) { focus(prev); focusInto(prev); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll().finally(schedulePoll); });
poll();
applyOptions();
document.getElementById("i-logo").innerHTML = logoSVG("#ffffff").replace(/^<svg[^>]*>|<\/svg>$/g, "");
$("#favicon").href = "data:image/svg+xml," + encodeURIComponent(FAV.idle);
bootScreen(modelsLoaded);
restoreLayout();
renderTasks();
layoutIcons();
document.fonts?.ready.then(layoutIcons);
tick();
setInterval(tick, 5000);
schedulePoll();
window.__rwosReady = true;
