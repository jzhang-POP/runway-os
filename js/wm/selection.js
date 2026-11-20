import { $, $$, clampN, icoLabel } from "../core/dom.js";
import { runOf } from "../core/status.js";
import { save } from "./persist.js";
import { MAC } from "../shortcuts.js";

/* ---------- selection in lists and galleries ---------- */
// keep: leave a multi-selection (Cmd+click, Shift+click) as it is and only move the focused item
export function select(w, id, scroll, keep) {
  w.sel = id;
  if (!keep) { w.multi = null; w.anchor = id; }
  $$("[data-id].row, [data-id].tile, [data-id].tnode", w.body).forEach(el => { const on = isSel(w, el.dataset.id); el.classList.toggle("sel", on); el.setAttribute("aria-selected", on); if (el.dataset.id === id && scroll) el.scrollIntoView({ block: "nearest" }); });
  activeSync(w);
  const seg = $(".statusbar .seg", w.body);
  if (seg) seg.textContent = seg.textContent.replace(/ · .* selected$/, "") + selNote(w);
  cmpBtnSync(w);
  save();
}
// the focusable list (.table grid or .gridwrap listbox) names the selected row or tile as its active descendant
export function activeSync(w) {
  const box = $(".table, .gridwrap, .tree-wrap", w.body); if (!box) return;
  const el = w.sel && $$("[data-id].row, [data-id].tile, [data-id].tnode", w.body).find(x => x.dataset.id === w.sel);
  el ? box.setAttribute("aria-activedescendant", el.id) : box.removeAttribute("aria-activedescendant");
}
// delta: ±1 next/previous item, ±2 one grid row up/down, ±1e6 first/last
export function moveSel(w, delta) {
  const items = $$("[data-id].row, [data-id].tile", w.body);
  if (!items.length) return;
  const i = items.findIndex(el => el.dataset.id === w.sel);
  let n;
  if (Math.abs(delta) >= 1e6) n = delta < 0 ? 0 : items.length - 1;
  else if (Math.abs(delta) === 2) {
    const cols = Math.max(1, Math.round($(".grid", w.body).clientWidth / (items[0].offsetWidth + 14)));
    n = i < 0 ? 0 : i + Math.sign(delta) * cols;
  } else n = i < 0 ? 0 : i + delta;
  select(w, items[clampN(n, 0, items.length - 1)].dataset.id, true);
}

/* ---------- multi-select (Jobs, Images, Videos, Audio) and the Compare window ---------- */
// w.sel stays the focused item (Enter, Cmd+I, the job menu); w.multi, when set, is the whole selection and w.anchor where Shift ranges start
export const MULTI = new Set(["jobs", "images", "videos", "audio"]);
export const CMP_MAX = 12;
export const CMP_BTN = `<button type="button" class="raised btn-s" data-compare-sel disabled title="Pick two or more with Cmd+click or Shift+click, then see them side by side (Alt+C)">${icoLabel("i-compare", "Compare")}</button>`;
export const cmpBase = id => String(id ?? "").split("~")[0];
export const isSel = (w, id) => (w.multi ? w.multi.has(id) : id != null && id === w.sel);
export const listIds = w => $$("[data-id].row, [data-id].tile", w.body).map(el => el.dataset.id);
// the selected items in list order (only the ones the list shows)
export function selIds(w) {
  if (!w.multi) return w.sel && runOf(w.sel) ? [w.sel] : [];
  return listIds(w).filter(id => w.multi.has(id));
}
export function selNote(w) {
  const n = MULTI.has(w.kind) ? selIds(w).length : 0;
  if (n > 1) return ` · ${n} selected`;
  const r = runOf(w.sel);
  return r ? ` · ${r.asset || r.taskId} selected` : "";
}
export function cmpBtnSync(w) {
  const b = $("[data-compare-sel]", w.body); if (!b) return;
  const n = selIds(w).length, t = n > 1 ? `Compare (${n})` : "Compare", s = $("span", b);
  b.disabled = n < 2;
  if (s.textContent !== t) s.textContent = t;
}
// Cmd+click adds or removes one item, Shift+click selects the range from the anchor (with Cmd, adds it); true when handled
export function multiClick(w, id, e) {
  const add = MAC ? e.metaKey : e.ctrlKey;
  if (!w || !MULTI.has(w.kind) || (!add && !e.shiftKey)) return false;
  if (e.shiftKey) {
    const ids = listIds(w), b = ids.indexOf(id);
    let a = ids.indexOf(w.anchor ?? w.sel);
    if (a < 0) { a = b; w.anchor = id; }
    const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
    w.multi = new Set(add ? [...selIds(w), ...range] : range);
    select(w, id, false, true);
  } else {
    const m = new Set(selIds(w));
    m.has(id) ? m.delete(id) : m.add(id);
    w.multi = m; w.anchor = id;
    select(w, m.has(id) ? id : [...m].pop() ?? null, false, true);
  }
  getSelection()?.removeAllRanges();
  return true;
}
// right-click on an item of a multi-selection keeps the selection (the menu then offers Compare)
export function menuSelect(w, id) {
  if (w && MULTI.has(w.kind) && isSel(w, id) && selIds(w).length > 1) select(w, id, false, true);
  else select(w, id);
}
export function selectAll(w) {
  const ids = listIds(w); if (!ids.length) return;
  w.multi = new Set(ids);
  select(w, w.multi.has(w.sel) ? w.sel : ids[0], false, true);
}
// Shift+arrow keys: move like the arrow keys, then select from the anchor to there
export function extendSel(w, delta) {
  const anchor = w.anchor ?? w.sel;
  moveSel(w, delta);
  const ids = listIds(w), a = ids.indexOf(anchor), b = ids.indexOf(w.sel);
  if (a < 0 || b < 0) return;
  w.multi = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)); w.anchor = anchor;
  select(w, w.sel, false, true);
}
