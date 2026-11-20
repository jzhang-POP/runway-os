/* ---------- live data: polling /api/state, the clock and relative times ---------- */

import { S, wins } from "./core/state.js";
import { $, $$ } from "./core/dom.js";
import { ACTIVE } from "./core/status.js";
import { ago, dur } from "./core/time.js";
import { announce } from "./core/ui.js";
import { SIG } from "./wm/kinds.js";
import { renderTasks, renderTray } from "./wm/taskbar.js";
import { renderWin } from "./wm/windows.js";
import { spendUpdate } from "./apps/spend.js";
import { activityTick } from "./apps/activity.js";

// the server answers 304 when nothing changed, so an idle poll costs almost nothing
export function schedulePoll() {
  clearTimeout(S.pollT);
  const ms = document.hidden ? 30000 : S.data.runs.some(r => ACTIVE.has(r.status)) ? 2000 : 5000;
  S.pollT = setTimeout(() => poll().finally(schedulePoll), ms);
}
export async function poll() {
  try {
    const res = await fetch("/api/state", { cache: "no-store", headers: S.stateTag && S.loaded ? { "If-None-Match": S.stateTag } : {} });
    if (res.status === 304) {
      if (S.conn.cls === "off" && S.lastConn) { S.conn = S.lastConn; wins.forEach(w => w.kind === "overview" && renderWin(w)); }
      return;
    }
    S.stateTag = res.headers.get("ETag");
    const d = await res.json();
    const c = d.error ? { cls: "warn", text: "Runway API: " + d.error } : d.live ? { cls: "on", text: "Connected" } : { cls: "warn", text: "No API key" };
    // runsTag: the server's hash of the job log and inputs (an older server without it: compare them as text)
    const runs = d.runs || [], rs = d.runsTag || JSON.stringify(runs) + JSON.stringify(d.inputs || []), ss = rs + d.balance + d.balanceAt + (d.history || []).length;
    const first = !S.loaded, runsChanged = rs !== S.runsSig, anyChanged = ss !== S.stateSig;
    const connChanged = c.text !== S.conn.text || c.cls !== S.conn.cls;
    const keySig = [d.live, d.keySource, d.keyHint, d.error].join("|"), keyChanged = keySig !== S.data.keySig;
    S.data = { runs, balance: d.balance, balanceAt: d.balanceAt, history: d.history || [], live: !!d.live, keySource: d.keySource, keyHint: d.keyHint, error: d.error, keySig, inputs: d.inputs || [] };
    spendUpdate(d);
    if (S.sessionStart == null && d.balance != null) S.sessionStart = { balance: d.balance, at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    S.runsSig = rs; S.stateSig = ss; S.conn = c; S.lastConn = c; S.loaded = true; S.markReady();
    if (!first) runs.forEach(r => { const was = S.prevStatus.get(r.taskId); if (was && ACTIVE.has(was) && !ACTIVE.has(r.status)) announce(r); });
    S.prevStatus = new Map(runs.map(r => [r.taskId, r.status]));
    wins.forEach(w => {
      if (w.kind === "overview" || w.kind === "key") { if (first || anyChanged || connChanged) renderWin(w); return; }
      if (!first && !runsChanged) return;
      const sig = SIG[w.kind]?.(w);
      if (sig !== undefined && sig === w.sig && !first) return; // this window's data didn't change
      w.sig = sig; renderWin(w);
    });
    if (!first && keyChanged && !runsChanged) wins.forEach(w => (w.kind === "key" || w.kind === "generate") && renderWin(w));
    if (first || runsChanged) renderTasks();
    if (first || anyChanged) renderTray();
  } catch {
    const c = { cls: "off", text: location.protocol === "file:" ? "Run python3 server.py" : "Server offline" };
    if (c.text !== S.conn.text) { S.conn = c; wins.forEach(w => w.kind === "overview" && renderWin(w)); }
  }
}

// clock, relative times and time left: one 5 s timer (main.js), idle while the page is hidden, caught up when it shows
export const clock = $("#clock");
export function tick() {
  if (document.hidden) return;
  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], S.opts.clock24 ? { hour: "2-digit", minute: "2-digit", hour12: false } : { hour: "numeric", minute: "2-digit", hour12: true });
  clock.title = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  $$("time[data-t]").forEach(t => { t.textContent = t.dataset.kind === "elapsed" ? dur(Date.now() - +t.dataset.t) : ago(+t.dataset.t); });
  activityTick();
}

export function init() {
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { tick(); poll().finally(schedulePoll); } });
}
