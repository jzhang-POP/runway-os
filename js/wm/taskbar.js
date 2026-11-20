import { S, wins } from "../core/state.js";
import { $, $$, esc, fmt, menuEl, startBtn, startMenu, tasksEl } from "../core/dom.js";
import { FAV } from "../core/graphics.js";
import { counts } from "../core/status.js";
import { fileAction } from "../core/ui.js";
import { APP_KEYS, KINDS } from "./kinds.js";
import { save } from "./persist.js";
import { cascadeAll, focus, focusInto, frontWin, minimize, open, restore, tileAll } from "./windows.js";
import { shutdownDialog } from "../apps/shutdown.js";
import { deskMenu, hideMenu, menuKeys, windowMenu } from "../menus.js";
import { toggleFullScreen } from "../shortcuts.js";

export function setTitle() {
  const active = counts().active;
  document.title = "[POP] Runway OS";
  const want = active ? "busy" : "idle";
  if (want !== S.favState) { S.favState = want; $("#favicon").href = "data:image/svg+xml," + encodeURIComponent(FAV[want]); }
}

/* ---------- taskbar, tray, start menu ---------- */
export const taskBtn = w => $(`[data-task="${CSS.escape(w.id)}"]`, tasksEl);
export function renderTasks() {
  const f = frontWin();
  tasksEl.innerHTML = [...wins.values()].sort((a, b) => a.seq - b.seq).map(w => {
    const K = KINDS[w.kind], title = K.title(w);
    return `<button class="task raised" data-task="${esc(w.id)}" aria-pressed="${w === f}" title="${esc(title)}"><svg class="ico"><use href="#${K.icon(w)}"/></svg><span>${esc(title)}</span></button>`;
  }).join("");
}

export function renderTray() {
  setTitle();
  const active = counts().active, run = $("#tray-run"), bal = $("#tray-bal");
  run.hidden = !active;
  $("span", run).textContent = active;
  run.title = `${active} job${active === 1 ? "" : "s"} rendering or queued. Open Jobs`;
  $("span", bal).textContent = S.data.balance == null ? "—" : fmt(S.data.balance);
}

export function setStart(on) {
  startMenu.hidden = !on;
  startBtn.setAttribute("aria-expanded", on);
  if (on) $("button", startMenu).focus();
}

export function init() {
  tasksEl.addEventListener("pointerdown", e => { if (e.target.closest("[data-task]")) e.preventDefault(); });
  tasksEl.addEventListener("click", e => {
    const b = e.target.closest("[data-task]"); if (!b) return;
    const w = wins.get(b.dataset.task); if (!w) return;
    if (w.minimized) restore(w);
    else if (w === frontWin()) minimize(w);
    else { focus(w); save(); focusInto(w); }
  });
  $(".taskbar").addEventListener("contextmenu", e => {
    e.preventDefault();
    const b = e.target.closest("[data-task]");
    b && wins.get(b.dataset.task) ? windowMenu(wins.get(b.dataset.task), e.clientX, e.clientY - 4) : deskMenu(e.clientX, e.clientY - 4);
  });
  $("#tray-run").addEventListener("click", e => open("activity", null, e.currentTarget));
  $("#tray-bal").addEventListener("click", e => open("overview", null, e.currentTarget));
  startBtn.addEventListener("click", () => setStart(startMenu.hidden));
  startMenu.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    setStart(false);
    if (b.dataset.launch) open(b.dataset.launch, null, startBtn);
    if (b.dataset.cmd === "folder") fileAction("reveal", "runs.json");
    if (b.dataset.cmd === "cascade") cascadeAll();
    if (b.dataset.cmd === "tile") tileAll();
    if (b.dataset.cmd === "fullscreen") toggleFullScreen();
    if (b.dataset.cmd === "shutdown") shutdownDialog();
  });
  startMenu.addEventListener("keydown", e => menuKeys(startMenu, e));
  $$("[data-launch]", startMenu).forEach(b => { const k = APP_KEYS[b.dataset.launch]; if (k && !$("kbd", b)) b.insertAdjacentHTML("beforeend", `<kbd>Alt+${k}</kbd>`); });
  document.addEventListener("pointerdown", e => {
    if (!startMenu.hidden && !e.target.closest("#startmenu, #start")) setStart(false);
    if (!menuEl.hidden && !e.target.closest("#ctxmenu")) hideMenu();
  });
}
