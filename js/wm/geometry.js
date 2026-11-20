import { S } from "../core/state.js";
import { desk } from "../core/dom.js";

export const D = () => ({ w: desk.clientWidth, h: desk.clientHeight });

/* ---------- window kinds ---------- */
// every size below is at scale 1 (11 px text) and grows with the Scale option
export const px = n => Math.round(n * S.scale);
export const box = (d, w, h) => ({ wd: Math.min(px(w), d.w - 24), ht: Math.min(px(h), d.h - 24) });
export const centered = (d, w, h, dx = 0, third = false) => { const b = box(d, w, h); return { ...b, x: Math.max(0, Math.round((d.w - b.wd) / 2) + px(dx)), y: Math.max(0, Math.round((d.h - b.ht) / (third ? 3 : 2))) }; };
export const cascade = (cw, ch) => d => {
  const n = S.seqTop % 8, b = box(d, cw, ch);
  // stay clear of the desktop icons when there's room
  return { ...b, x: Math.max(Math.min(px(104), d.w - b.wd), Math.round((d.w - b.wd) / 2) + px(n * 26 - 80)), y: Math.max(0, Math.round((d.h - b.ht) / 2) + px(n * 26 - 80)) };
};
