import { $, $$ } from "./dom.js";

/* ---------- modal dialogs (Shut down, the daily credit limit, Notes' rename/delete/save) ----------
   modal({ id, html, focus, onPress, noMenu, fallback }) shows `html` in an overlay (div#id.shutdown) and resolves with the
   data-m value of the button that closed it, or "cancel" for Esc. While open it takes every key: Tab and Shift+Tab
   stay inside, Esc cancels, Enter presses the focused button, or the default one (.b-default) when focus is elsewhere.
   focus: the element to focus first (default: the default button).
   onPress(value, close): called for every button but Cancel instead of closing; it calls close(value) itself
   (Notes keeps the dialog open to show an error; Shut down reloads). noMenu: no browser menu on right-click
   (the in-app menu would open under the dialog; Shift+right-click still gets it). Focus goes back where it was,
   or to `fallback` (a selector) when that element is gone or hidden, like the Start menu item Shut down was opened from. */
const TABBABLE = "input:not([type=radio]), input:checked, button:not(:disabled)";
export function modal({ id, html, focus, onPress, noMenu, fallback }) {
  return new Promise(resolve => {
    const back = document.activeElement, d = document.createElement("div");
    d.id = id; d.className = "shutdown";
    d.innerHTML = html;
    document.body.append(d);
    const close = v => {
      removeEventListener("keydown", onKey, true); d.remove();
      const to = back?.isConnected && back.checkVisibility?.() !== false ? back : (fallback && $(fallback)) || back;
      to?.focus?.({ preventScroll: true });
      resolve(v);
    };
    const press = v => (v !== "cancel" && onPress ? onPress(v, close) : close(v));
    const onKey = e => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); close("cancel"); return; }
      if (e.key === "Enter") {
        const b = e.target.closest?.("[data-m]") || $(".b-default", d);
        if (b && !b.disabled) { e.preventDefault(); press(b.dataset.m); } else e.preventDefault();
        return;
      }
      if (e.key === "Tab") {
        const f = $$(TABBABLE, d), i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    };
    addEventListener("keydown", onKey, true);
    d.addEventListener("click", e => { const b = e.target.closest("[data-m]"); if (b) press(b.dataset.m); });
    if (noMenu) d.addEventListener("contextmenu", e => { if (!e.shiftKey) e.preventDefault(); });
    (typeof focus === "function" ? focus(d) : $(".b-default", d))?.focus();
  });
}
