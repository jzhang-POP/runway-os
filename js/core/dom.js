/* ---------- helpers ---------- */
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const fmt = n => Number(n || 0).toLocaleString("en-US");
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : "");
export const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// the page's fixed elements
export const desk = $("#desktop"), tasksEl = $("#tasks"), startBtn = $("#start"), startMenu = $("#startmenu"), menuEl = $("#ctxmenu");
// button content: a 16 px icon before the label (index.html, "button icons and tones"); label is trusted HTML
export const icoLabel = (icon, label) => `<svg class="ico" aria-hidden="true"><use href="#${icon}"/></svg><span>${label}</span>`;
