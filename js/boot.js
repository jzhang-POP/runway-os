import { S, ready, wins } from "./core/state.js";
import { $, $$, fmt } from "./core/dom.js";
import { logoSVG } from "./core/graphics.js";
import { ACTIVE } from "./core/status.js";
import { absTime, tOf, upTo } from "./core/time.js";
import { KEY } from "./wm/persist.js";
import { focus, focusInto, frontWin, open } from "./wm/windows.js";
import { calm } from "./apps/options.js";

// first launch (no saved layout, so restoreLayout opens just the terminal): once the first state poll answers
// and there is no API key, open the key window on top as well. Later loads have a saved layout and skip this.
export const firstLaunch = (() => { try { return !Array.isArray(JSON.parse(localStorage.getItem(KEY))); } catch { return true; } })();

/* ---------- boot screen: a BIOS self-test over the real startup; the log stays up until you start ---------- */
// each startup check with its time (ms since the page started loading), kept for the bootlog command
export const bootLog = [];
export async function bootScreen(modelsLoaded) {
  // the checks run and are logged even with the boot screen off; the screen only shows them
  const show = S.opts.boot, fast = calm(), deadline = Date.now() + 8000;
  let el = null, log = null, hint = null, phase = "loading", early = false;
  const setHint = t => { if (hint) hint.textContent = t; };
  const btns = () => (el ? $$(".boot-act button", el) : []);
  const start = async withKey => {
    if (S.bootDone) return;
    S.bootDone = true;
    removeEventListener("keydown", onKey, true); removeEventListener("pointerdown", onPointer, true);
    document.body.classList.remove("booting");
    el.classList.add("out");
    setTimeout(() => el.remove(), fast ? 0 : 200);
    if (withKey) open("key");
    const f = frontWin(); if (f) $("input:not([type=hidden]):not([type=range]), textarea", f.body)?.focus();
  };
  // while loading: Esc starts now, any other key or a click starts as soon as loading finishes.
  // when ready: Enter or Space presses the focused button, Tab moves between the buttons, Esc starts.
  const onKey = e => {
    e.stopPropagation(); // the desktop behind doesn't see keys while the boot screen is up
    if (e.metaKey || e.ctrlKey || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return; // browser shortcuts still work
    e.preventDefault();
    if (S.bootDone) return;
    if (e.key === "Escape") { start(false); return; }
    if (phase === "loading") {
      if (!early) { early = true; setHint("Starting when loading finishes… Press Esc to start now."); }
      return;
    }
    const list = btns(), i = list.indexOf(document.activeElement);
    if (e.key === "Enter" || e.key === " ") (list[i] || list[0])?.click();
    else if (e.key === "Tab" && list.length) list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus();
  };
  const onPointer = e => {
    e.stopPropagation();
    if (S.bootDone || phase !== "loading") return;
    e.preventDefault();
    if (!early) { early = true; setHint("Starting when loading finishes… Press Esc to start now."); }
  };
  if (show) {
    S.bootDone = false;
    el = document.createElement("div");
    el.className = "boot";
    // one centered column: logo, name, progress bar, the checks as they run, then the Start button
    el.innerHTML = `<div class="boot-col">
          <span class="boot-logo" aria-hidden="true">${logoSVG("#ffffff")}</span>
          <b class="boot-name">runway os</b>
          <div class="boot-bar" role="progressbar" aria-label="Starting runway os" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
          <ul class="boot-log" role="log" aria-live="polite"></ul>
          <div class="boot-sum" aria-live="polite"></div>
          <div class="boot-act"></div>
          <div class="boot-hint" aria-live="polite">Press any key to start when loading finishes, or Esc to start now.</div>
        </div>`;
    document.body.append(el); document.body.classList.add("booting");
    log = $(".boot-log", el); hint = $(".boot-hint", el);
    addEventListener("keydown", onKey, true); addEventListener("pointerdown", onPointer, true);
  }
  // a line prints when its check starts; its result is added, and the line logged, when the check finishes
  const STEPS = 5;
  let doneSteps = 0;
  const begin = text => {
    const d = log && document.createElement("li");
    if (d) { d.innerHTML = `<span></span><span class="res wait">…</span>`; d.firstChild.textContent = text; log.append(d); }
    return { d, text };
  };
  const end = (row, res, bad = false) => {
    bootLog.push({ ms: Math.round(performance.now()), text: row.text, res, bad });
    doneSteps++;
    if (el) { const pct = Math.min(100, Math.round((doneSteps / STEPS) * 100)); $(".boot-bar i", el).style.width = pct + "%"; $(".boot-bar", el).setAttribute("aria-valuenow", pct); }
    if (!row.d) return;
    const r = row.d.lastChild; r.textContent = res || "OK"; r.className = "res" + (bad ? " bad" : "");
  };
  const summary = text => { bootLog.push({ ms: Math.round(performance.now()), text, res: "", bad: false }); if (el) $(".boot-sum", el).textContent = text; };
  const wait = p => upTo(p, Math.max(0, deadline - Date.now()));

  let row = begin("Server");
  end(row, location.protocol === "file:" ? "opened as a file" : location.host, location.protocol === "file:");
  row = begin("Loading model list…");
  if (!(await wait(modelsLoaded)) || !S.CAT) end(row, "failed. Generate can't list models", true);
  else { const t = S.CAT.tasks || []; end(row, `${new Set(t.flatMap(x => x.models.map(m => m.id))).size} models, ${t.length} tasks`); }
  row = begin("Connecting to Runway API…");
  // the first /api/state answer, or the first failed poll (poll keeps retrying every 3 s)
  while (!S.loaded && S.conn.cls !== "off" && Date.now() < deadline) await upTo(ready, 50);
  if (!S.loaded) end(row, S.conn.cls === "off" ? "server not reachable" : "no answer after 8 s", true);
  else if (!S.data.live) end(row, "no key", true);
  else if (S.data.error) end(row, S.data.error, true);
  else end(row, "OK");
  const live = S.loaded && S.data.live && !S.data.error, n = S.data.runs.length;
  const when = S.data.balanceAt ? `, last known ${absTime(tOf(S.data.balanceAt))}` : ", last known";
  end(begin("Credits"), !S.loaded || S.data.balance == null ? "unknown" : fmt(S.data.balance) + (live ? "" : when), !S.loaded || S.data.balance == null);
  end(begin("Jobs"), S.loaded ? `${fmt(n)} found` : "unknown", !S.loaded);
  summary(!S.loaded ? (S.conn.cls === "off" ? `Server not reachable. Run python3 server.py${location.protocol === "file:" ? " and open the address it prints" : "; runway os keeps trying"}.` : "The server hasn't answered yet; runway os keeps trying.")
    : !S.data.live ? "Ready without a Runway key."
    : S.data.error ? "Ready, but the Runway API reported an error."
    : `Ready. ${S.data.balance == null ? "Credits unavailable" : fmt(S.data.balance) + " credits"}, ${fmt(n)} job${n === 1 ? "" : "s"}.`);
  phase = "ready";
  if (!show || S.bootDone) return;
  if (early) { start(false); return; }
  const act = $(".boot-act", el), keyBtn = S.loaded && !live;
  act.innerHTML = `<button class="raised btn-s default" data-start>Start runway os</button>${keyBtn ? '<button class="raised btn-s" data-start="key">Start and add API key</button>' : ""}`;
  act.addEventListener("click", e => { const b = e.target.closest("[data-start]"); if (b) start(b.dataset.start === "key"); });
  $("button", act).focus();
  setHint(keyBtn ? "Press Enter to start, or Tab to choose the other button." : "Press Enter to start");
}

export function init() {
  if (firstLaunch) ready.then(() => { if (!S.data.live) $(".kin", open("key").body)?.focus({ preventScroll: true }); });
  // jobs keep rendering on Runway across a refresh or restart (the server tracks them in runs.json):
  // if any are still queued or rendering, bring Activity back so they stay in view, without taking focus
  ready.then(() => {
    if (wins.has("activity") || !S.data.runs.some(r => ACTIVE.has(r.status))) return;
    const prev = frontWin(), aw = open("activity");
    if (prev && prev !== aw) { focus(prev); focusInto(prev); }
  });
}
