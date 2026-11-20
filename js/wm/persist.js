import { S, wins } from "../core/state.js";
import { startBtn } from "../core/dom.js";
import { KINDS } from "./kinds.js";
import { make, open, refreshFront } from "./windows.js";

export const KEY = "runway-os-layout-v3";
export function resetLayout() {
  [...wins.values()].forEach(w => { w.el.remove(); wins.delete(w.id); });
  refreshFront(); save(); startBtn.focus();
}

/* ---------- persistence ---------- */
export function save() {
  clearTimeout(S.saveT);
  if (S.resetting) return;
  S.saveT = setTimeout(() => {
    const list = [...wins.values()].map(w => ({ kind: w.kind, arg: w.arg, x: w.x, y: w.y, wd: w.wd, ht: w.ht, max: w.max, minimized: w.minimized, snapped: w.snapped, pre: w.pre, z: w.z, seq: w.seq, filter: w.filter, q: w.q, sort: w.sort, size: w.size, sel: w.sel, tab: w.tab, days: w.days, act: w.kind === "activity" ? w.act : undefined, solo: w.kind === "tree" ? !!w.solo : undefined, gen: w.kind === "generate" ? w.gen : undefined, cmp: w.kind === "compare" ? w.cmp : undefined }));
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  }, 150);
}
export function restoreLayout() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!Array.isArray(saved)) { open("terminal"); return; } // first launch: just the terminal
  saved.filter(s => KINDS[s.kind] && (s.kind === "viewer" || s.kind === "props" || s.kind === "compare" ? s.arg : true)).sort((a, b) => a.z - b.z).forEach(s => make(s.kind, s.arg, s));
  refreshFront();
}
