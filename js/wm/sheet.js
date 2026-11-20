import { S } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { save } from "./persist.js";
import { renderWin } from "./windows.js";

// Win95 property sheet: tabs, a raised panel, and a footer ending in OK
// ARIA tablist with a roving tabindex: only the selected tab is in the Tab order; sheetKeys adds the arrow keys
export const sheetHTML = (tabs, cur, panel, foot = "") => { const sid = "sh" + ++S.uid; return `
    <div class="sheet">
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" id="${sid}-${k}" aria-controls="${sid}-p" aria-selected="${k === cur}" tabindex="${k === cur ? 0 : -1}">${l}</button>`).join("")}</div>
      <div class="tabpanel raised" role="tabpanel" id="${sid}-p" aria-labelledby="${sid}-${cur}" data-keep="panel-${cur}">${panel}</div>
      <div class="sheet-foot">${foot}<button class="raised btn-ok" data-close>OK</button></div>
    </div>`; };
// switch a property sheet's tab like a click on it does, then put focus on the new tab
export function sheetTab(w, key) {
  w.tab = key; renderWin(w); save();
  $('[role="tab"][aria-selected="true"]', w.body)?.focus();
}
// keyboard for property sheets, bound once per window body: ←/→ and Home/End on a tab, Ctrl+Tab and Ctrl+Shift+Tab anywhere in the sheet.
// Every render replaces the tabs, so focus that was on a tab goes back to the selected one afterwards.
export function sheetKeys(w) {
  if (w.onTab && (!document.activeElement || document.activeElement === document.body)) $('[role="tab"][aria-selected="true"]', w.body)?.focus({ preventScroll: true });
  if (w.sheetBound) return;
  w.sheetBound = true;
  w.body.addEventListener("focusin", e => { w.onTab = e.target.matches('[role="tab"]'); });
  w.body.addEventListener("focusout", e => {
    if (e.relatedTarget) { if (!w.body.contains(e.relatedTarget)) w.onTab = false; return; }
    queueMicrotask(() => { if (e.target.isConnected) w.onTab = false; }); // a real blur, not a render removing the tab
  });
  w.body.addEventListener("keydown", e => {
    const sheet = e.target.closest(".sheet"); if (!sheet || e.altKey || e.metaKey) return;
    const tabs = $$('[role="tab"]', sheet), cur = tabs.findIndex(t => t.getAttribute("aria-selected") === "true"), n = tabs.length;
    let i = null;
    if (e.key === "Tab" && e.ctrlKey) i = cur + (e.shiftKey ? -1 : 1);
    else if (!e.ctrlKey && !e.shiftKey && e.target.matches('[role="tab"]')) {
      const at = tabs.indexOf(e.target);
      i = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: n - 1 }[e.key] ?? null;
    }
    if (i == null || !n) return;
    e.preventDefault();
    sheetTab(w, tabs[(i + n) % n].dataset.tab);
  });
}
