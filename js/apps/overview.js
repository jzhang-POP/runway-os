import { S } from "../core/state.js";
import { esc, fmt, icoLabel } from "../core/dom.js";
import { ledHTML, logoSVG, spark } from "../core/graphics.js";
import { morph } from "../core/morph.js";
import { counts } from "../core/status.js";
import { RENDER } from "../wm/kinds.js";
import { sheetHTML, sheetKeys } from "../wm/sheet.js";

// "System Properties": a Win95 property sheet with General, Usage and Connection tabs
export function overviewRender(w) {
  const c = counts(), running = c.running, queued = c.queued, bal = S.data.balance;
  const delta = S.sessionStart != null && bal != null ? S.sessionStart.balance - bal : 0;
  // the average progress, when every rendering job reports one
  const det = running && c.withProgress === running ? Math.round((c.progress / c.withProgress) * 100) : null;
  const checked = S.data.balanceAt ? new Date(S.data.balanceAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
  const tab = w.tab || "general", T = [["general", "General"], ["usage", "Usage"], ["connection", "Connection"]];
  let panel = "";
  if (tab === "general") {
    panel = `
          <div class="sp-gen">
            <div class="sp-logo">${logoSVG("#ffffff")}</div>
            <dl class="sp-facts">
              <dt>System:</dt><dd>runway os<br><span class="muted">Runway API 2024-11-06</span></dd>
              <dt>Credits left:</dt><dd><div class="led sunken" role="img" aria-label="${bal == null ? "Balance unknown" : fmt(bal) + " credits left"}">${ledHTML(bal)}</div>
                <span class="muted">${delta > 0 ? `<span class="down">▼ ${fmt(delta)}</span> since you opened this at ${esc(S.sessionStart.at)}` : checked ? `Checked at ${esc(checked)}` : "Waiting for Runway"}</span></dd>
              <dt>Activity:</dt><dd>${running ? `Rendering ${running} job${running > 1 ? "s" : ""}${det != null ? ` · ${det}%` : "…"}` : queued ? `${queued} job${queued > 1 ? "s" : ""} queued…` : "Idle. No jobs rendering."}
                <div class="prog sunken${running + queued && det == null ? " busy" : ""}"><i style="${det != null ? `width:${det}%;opacity:1` : ""}"></i></div></dd>
            </dl>
          </div>`;
  } else if (tab === "usage") {
    const sp = spark(S.data.history, 480, 120, true);
    const row = (label, val, open) => `<button class="sp-row" data-open="${open}"><span>${label}</span><b>${val}</b></button>`;
    panel = `
          <fieldset class="group"><legend>Your jobs</legend>
            <div class="sp-rows">
              ${row("Jobs logged", fmt(S.data.runs.length), "jobs")}
              ${row("Credits spent", fmt(c.credits), "jobs")}
              ${row("Rendering or queued", fmt(running + queued), "jobs")}
              ${row("Images", fmt(c.files.image), "images")}
              ${row("Videos", fmt(c.files.video), "videos")}
              ${row("Audio files", fmt(c.files.audio), "audio")}
            </div>
          </fieldset>
          <fieldset class="group sp-chart"><legend>Org balance · last 24 h</legend>
            ${sp.svg || '<div class="spark-empty big">Collecting balance history. The chart fills in as the server checks every 20 s.</div>'}
            <div class="muted">${sp.spent != null ? `Your org spent ${fmt(sp.spent)} credits in the last 24 h.` : ""}</div>
          </fieldset>`;
  } else {
    const where = S.data.keySource === "file" ? "saved in .runway_key" : S.data.keySource === "env" ? "from RUNWAYML_API_SECRET" : "none";
    panel = `
          <fieldset class="group"><legend>Runway API</legend>
            <dl class="sp-facts tight">
              <dt>Status:</dt><dd><span class="live ${S.conn.cls}">${esc(S.conn.text)}</span></dd>
              <dt>API key:</dt><dd>${S.data.live ? `Ending in ${esc(S.data.keyHint || "…")} <span class="muted">(${where})</span>` : "Not set"}</dd>
              <dt>Balance:</dt><dd>${checked ? `Checked at ${esc(checked)}` : "Not checked yet"}</dd>
              <dt>Sync:</dt><dd>Jobs every 8 s, balance every 20 s</dd>
              <dt>Server:</dt><dd>${esc(location.host)}</dd>
            </dl>
            <div class="actions"><button class="raised btn-s" data-open="key">${icoLabel("i-key", "Change key…")}</button></div>
          </fieldset>`;
  }
  morph(w.body, sheetHTML(T, tab, panel));
  sheetKeys(w);
}

export function init() {
  RENDER.overview = overviewRender;
}
