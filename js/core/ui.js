import { S } from "./state.js";
import { $, cap, esc, fmt } from "./dom.js";
import { api } from "./api.js";
import { nameOf, typeIcon } from "./status.js";
import { setTitle } from "../wm/taskbar.js";
import { open } from "../wm/windows.js";
import { chime } from "../apps/options.js";

export const loadingOr = msg => `<div class="empty-list">${S.loaded ? msg : "Loading…"}</div>`;
// a button under an empty list's message
export const emptyAct = html => `<div class="empty-act">${html}</div>`;
export const GEN_BTN = '<button class="raised btn-s b-default" data-open="generate"><svg class="ico" aria-hidden="true"><use href="#i-wand"/></svg><span>Open Generate</span></button>';
// id of a row or tile, stable for the window's life, so the list can point aria-activedescendant at it
export const itemId = (w, id) => `it${w.oid ||= ++S.uid}-${String(id).replace(/[^\w-]/g, "_")}`;

/* ---------- clipboard, files, balloons ---------- */
// a copied job is its task ID as text; Cmd+V in Generate turns it back into an input
export function copyJob(r) {
  const id = r._of ? `${r._of}~${r._n}` : r.taskId;
  navigator.clipboard?.writeText(id).then(
    () => balloon({ title: `Copied ${r.asset || nameOf(r)}`, text: "In Generate, press Cmd+V to use it as an input.", ms: 3200 }),
    () => balloon({ title: "Couldn't copy", text: "The browser blocked the clipboard.", ms: 2600 }));
}
export function copyText(text, done = "Copied") {
  navigator.clipboard?.writeText(text).then(() => balloon({ title: done, text: text.length > 80 ? text.slice(0, 80) + "…" : text, ms: 2200 }))
    .catch(() => balloon({ title: "Couldn't copy", text: "The browser blocked clipboard access.", ms: 3000 }));
}
export async function fileAction(action, name) {
  try { await api(`/api/${action}`, { file: name }); }
  catch {
    balloon({ title: "Couldn't open the file", text: `${name} isn't in the Runway folder, or the server is offline.`, ms: 4000 });
  }
}
// the balloon stays at least 5 s; hovering it or focusing inside it pauses the countdown, leaving resumes what was left
export const balloonEl = $("#balloon"), srStatus = $("#sr-status");
export function balloonRun() { clearTimeout(S.balloonT); S.balloonAt = Date.now(); S.balloonT = setTimeout(() => { S.balloonT = 0; balloonEl.hidden = true; }, S.balloonLeft); }
export function balloonPause() { if (!S.balloonT) return; clearTimeout(S.balloonT); S.balloonT = 0; S.balloonLeft = Math.max(0, S.balloonLeft - (Date.now() - S.balloonAt)); }
export const balloonResume = () => { if (!balloonEl.hidden && !S.balloonT) balloonRun(); };
export function balloon({ title, text, icon = "i-doc", ms = 8000, onOpen }) {
  const b = balloonEl;
  b.innerHTML = `<svg class="ico"><use href="#${icon}"/></svg><div class="bt"><b id="balloon-t">${esc(title)}</b><span id="balloon-x">${esc(text)}</span>${onOpen ? '<button class="raised btn-s bopen" aria-describedby="balloon-t balloon-x">Open</button>' : ""}</div><button class="raised bx" aria-label="Dismiss"><i class="g-close"></i></button>`;
  b.hidden = false;
  b.classList.toggle("clickable", !!onOpen);
  b.onclick = e => { b.hidden = true; if (!e.target.closest(".bx") && onOpen) onOpen(); };
  // screen readers get it from the always-present live region: empty it, then fill it a frame later so a repeat is announced again
  const n = ++S.srSeq;
  srStatus.textContent = "";
  requestAnimationFrame(() => requestAnimationFrame(() => { if (n === S.srSeq) srStatus.textContent = `${title}. ${text}`; }));
  clearTimeout(S.balloonT); S.balloonT = 0;
  S.balloonLeft = Math.max(5000, ms);
  if (!b.matches(":hover") && !b.contains(document.activeElement)) balloonRun();
}
export function announce(r) {
  const ok = r.status === "succeeded";
  if (S.opts.sound) chime(ok);
  if (S.opts.notify && document.hidden && "Notification" in window && Notification.permission === "granted") {
    try { const n = new Notification(ok ? `${cap(r.type)} finished` : `Job ${r.status}`, { body: ok ? `${r.asset || r.taskId}${r.credits != null ? ` · ${fmt(r.credits)} credits` : ""}` : (r.failure || r.taskId), tag: r.taskId });
      n.onclick = () => { window.focus(); open(ok && r.asset ? "viewer" : "props", r.taskId); n.close(); }; } catch {}
  }
  if (document.hidden) { S.unseen++; setTitle(); }
  if (!S.opts.balloons) return;
  balloon({
    title: ok ? `${cap(r.type)} finished` : `Job ${r.status}`,
    text: ok ? `${r.asset || r.taskId}${r.credits != null ? ` · ${fmt(r.credits)} credits` : ""}` : (r.failure || r.taskId),
    icon: ok ? typeIcon(r.type) : "i-doc", ms: 9000,
    onOpen: () => open(ok && r.asset ? "viewer" : "props", r.taskId, $("#tray-run")),
  });
}

export function init() {
  balloonEl.addEventListener("pointerenter", balloonPause);
  balloonEl.addEventListener("pointerleave", () => { if (!balloonEl.contains(document.activeElement)) balloonResume(); });
  balloonEl.addEventListener("focusin", balloonPause);
  balloonEl.addEventListener("focusout", e => { if (!balloonEl.contains(e.relatedTarget) && !balloonEl.matches(":hover")) balloonResume(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { S.unseen = 0; setTitle(); } });
}
