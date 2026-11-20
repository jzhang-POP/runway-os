import { S } from "../core/state.js";
import { $, $$, clampN, desk } from "../core/dom.js";
import { px } from "../wm/geometry.js";
import { open } from "../wm/windows.js";
import { deskMenu } from "../main.js";

export const icons = $("#icons");
/* icon grid: icons fill columns top to bottom in order, unless moved; a moved icon keeps its slot (col,row), saved per launcher */
export const ICON_KEY = "runway-os-icons-v1";
export const iconGrid = () => {
  const list = $$(".dicon", icons), w = Math.max(...list.map(b => b.offsetWidth), 1), h = Math.max(...list.map(b => b.offsetHeight), 1), gap = px(10), pad = px(10);
  return { cw: w + gap, ch: h + gap, pad, cols: Math.max(1, Math.floor((desk.clientWidth - pad) / (w + gap))), rows: Math.max(1, Math.floor((desk.clientHeight - pad) / (h + gap))) };
};
export function layoutIcons() {
  const g = iconGrid(), list = $$(".dicon", icons), taken = new Set(), slot = {};
  // moved icons first (clamped to the visible grid), then the others in order into the free slots
  list.forEach(b => { const s = S.iconSlots[b.dataset.launch]; if (!s) return; let c = clampN(s.col, 0, g.cols - 1), r = clampN(s.row, 0, g.rows - 1);
    while (taken.has(c + "," + r)) { r++; if (r >= g.rows) { r = 0; c = (c + 1) % g.cols; } }
    taken.add(c + "," + r); slot[b.dataset.launch] = [c, r]; });
  let c = 0, r = 0;
  list.forEach(b => { if (slot[b.dataset.launch]) return;
    while (taken.has(c + "," + r)) { r++; if (r >= g.rows) { r = 0; c++; } }
    taken.add(c + "," + r); slot[b.dataset.launch] = [c, r]; });
  list.forEach(b => { const [cc, rr] = slot[b.dataset.launch]; b.style.transform = `translate(${g.pad + cc * g.cw}px, ${g.pad + rr * g.ch}px)`; b.dataset.slot = cc + "," + rr; });
  icons.classList.add("ready");
}
export const saveIcons = () => { try { localStorage.setItem(ICON_KEY, JSON.stringify(S.iconSlots)); } catch {} };
export const arrangeIcons = () => { S.iconSlots = {}; saveIcons(); layoutIcons(); };

export function init() {
  /* ---------- desktop icons: click selects, double-click / Enter / tap opens ---------- */
  addEventListener("pointerdown", e => { S.lastPointer = e.pointerType; }, true);
  try { S.iconSlots = JSON.parse(localStorage.getItem(ICON_KEY)) || {}; } catch {}
  // drag an icon: it follows the pointer after a few pixels, then snaps to the nearest free slot; a plain click stays a click
  icons.addEventListener("pointerdown", e => {
    const b = e.target.closest(".dicon"); if (!b || e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY, m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(b.style.transform) || [0, 0, 0], ox = +m[1], oy = +m[2];
    let moving = false;
    const move = ev => {
      if (!moving && Math.hypot(ev.clientX - sx, ev.clientY - sy) < (ev.pointerType === "touch" ? 8 : 4)) return;
      if (!moving) { moving = true; b.setPointerCapture(ev.pointerId); b.classList.add("dragging"); }
      b.style.transform = `translate(${ox + ev.clientX - sx}px, ${oy + ev.clientY - sy}px)`;
    };
    const up = ev => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      if (!moving) return;
      b.classList.remove("dragging"); S.iconDragged = true; setTimeout(() => { S.iconDragged = false; }, 0);
      const g = iconGrid();
      let col = clampN(Math.round((ox + ev.clientX - sx - g.pad) / g.cw), 0, g.cols - 1), row = clampN(Math.round((oy + ev.clientY - sy - g.pad) / g.ch), 0, g.rows - 1);
      // taken by another icon: the nearest free slot instead
      const used = new Set($$(".dicon", icons).filter(x => x !== b).map(x => x.dataset.slot));
      if (used.has(col + "," + row)) {
        let best = null;
        for (let c = 0; c < g.cols; c++) for (let r = 0; r < g.rows; r++) if (!used.has(c + "," + r)) { const d = Math.hypot(c - col, r - row); if (!best || d < best.d) best = { c, r, d }; }
        if (best) { col = best.c; row = best.r; }
      }
      // keep every icon where it is now, so the others don't reflow around the moved one
      $$(".dicon", icons).forEach(x => { const [c, r] = x.dataset.slot.split(",").map(Number); S.iconSlots[x.dataset.launch] = { col: c, row: r }; });
      S.iconSlots[b.dataset.launch] = { col, row };
      saveIcons(); layoutIcons(); b.focus();
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  });
  icons.addEventListener("click", e => { if (S.iconDragged) { e.stopPropagation(); return; } const b = e.target.closest("[data-launch]"); if (b && (e.detail === 0 || S.lastPointer === "touch")) open(b.dataset.launch, null, b); }, true);
  icons.addEventListener("dblclick", e => { const b = e.target.closest("[data-launch]"); if (b) open(b.dataset.launch, null, b); });
  icons.addEventListener("keydown", e => {
    const items = $$(".dicon", icons), i = items.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key) && i >= 0) { e.preventDefault(); items[clampN(i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1), 0, items.length - 1)].focus(); }
  });
  desk.addEventListener("pointerdown", e => { if (e.target === desk) document.activeElement?.blur(); });
  desk.addEventListener("contextmenu", e => { if (e.target === desk || e.target.closest(".icons")) { e.preventDefault(); deskMenu(e.clientX, e.clientY); } });
}
