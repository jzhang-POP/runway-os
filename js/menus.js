import { S, wins } from "./core/state.js";
import { $, $$, clampN, esc, menuEl } from "./core/dom.js";
import { cancellable, runOf, typeIcon } from "./core/status.js";
import { balloon, copyText, fileAction } from "./core/ui.js";
import { resetLayout } from "./wm/persist.js";
import { cascadeAll, close, defaultOpen, minimize, open, restore, tileAll, toggleMax, winOf } from "./wm/windows.js";
import { arrangeIcons } from "./desktop/icons.js";
import { cmpMenu } from "./apps/compare.js";
import { cancelJob, genFrom } from "./apps/generate.js";
import { termPaint } from "./apps/terminal.js";
import { kbStart } from "./shortcuts.js";

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
    cancellable(r) && { label: "Cancel job", icon: "i-stop", act: () => cancelJob(r) },
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

/* ---------- right-click: an in-app menu everywhere; Shift + right-click keeps the browser's own menu ---------- */
export async function pasteInto(el) {
  try {
    const t = await navigator.clipboard.readText();
    el.focus(); el.setRangeText(t, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } catch { balloon({ title: "Couldn't paste", text: "The browser blocked reading the clipboard. Press Cmd+V instead.", ms: 4000 }); }
}
export function textMenu(el, x, y) {
  const sel = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0), ro = el.readOnly || el.disabled;
  showMenu(x, y, [
    { label: "Cut", icon: "i-copy", hint: "Cmd+X", disabled: !sel || ro, act: () => { navigator.clipboard?.writeText(sel).catch(() => {}); el.focus(); el.setRangeText("", el.selectionStart, el.selectionEnd, "end"); el.dispatchEvent(new Event("input", { bubbles: true })); } },
    { label: "Copy", icon: "i-copy", hint: "Cmd+C", disabled: !sel, act: () => copyText(sel, "Copied") },
    { label: "Paste", hint: "Cmd+V", disabled: ro, act: () => pasteInto(el) },
    { sep: true },
    { label: "Select all", hint: "Cmd+A", disabled: !el.value, act: () => { el.focus(); el.select(); } },
  ]);
}

export function init() {
  menuEl.addEventListener("click", e => {
    const b = e.target.closest("button[data-i]"); if (!b) return;
    const it = S.menuItems[+b.dataset.i]; hideMenu(); it.act();
  });
  menuEl.addEventListener("contextmenu", e => e.preventDefault());
  menuEl.addEventListener("keydown", e => menuKeys(menuEl, e));
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
}
