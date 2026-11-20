import { S } from "../core/state.js";
import { $, $$ } from "../core/dom.js";
import { ACTIVE } from "../core/status.js";
import { KEY } from "../wm/persist.js";
import { OPT_KEY } from "./options.js";

/* ---------- Shut down: restart, optionally forgetting the window layout or every setting ---------- */
// set just before a reload, so nothing writes the forgotten state back
export function restart(mode) {
  S.resetting = true;
  clearTimeout(S.saveT);
  try {
    if (mode === "clean" || mode === "all") { localStorage.removeItem(KEY); localStorage.removeItem("runway-os-icons-v1"); }
    if (mode === "all") localStorage.removeItem(OPT_KEY);
  } catch {}
  location.reload();
}
export function shutdownDialog() {
  if ($("#shutdown")) return;
  const back = document.activeElement;
  const d = document.createElement("div");
  d.id = "shutdown";
  d.className = "shutdown";
  d.innerHTML = `
      <div class="sd-win window front raised" role="dialog" aria-modal="true" aria-labelledby="sd-t">
        <div class="titlebar"><span class="t"><svg class="ico ticon" aria-hidden="true"><use href="#i-power"/></svg><span class="tt" id="sd-t">Shut down runway os</span></span></div>
        <div class="sd-body">
          <svg class="sd-ico" aria-hidden="true"><use href="#i-power"/></svg>
          <fieldset class="sd-opts"><legend>What do you want to do?</legend>
            <label class="opt-radio"><input type="radio" name="sd" value="restart" checked><span>Restart <span class="muted">Your windows and settings stay.</span></span></label>
            <label class="opt-radio"><input type="radio" name="sd" value="clean"><span>Restart with a clean desktop <span class="muted">Forgets which windows were open, where, and the Generate form.</span></span></label>
            <label class="opt-radio"><input type="radio" name="sd" value="all"><span>Restart and reset everything <span class="muted">Also resets Options: theme, scale, font and alerts.</span></span></label>
            <p class="muted sd-note">Your jobs, files and API key aren't touched.${(n => n ? ` ${n} job${n === 1 ? " is" : "s are"} still rendering or queued: ${n === 1 ? "it keeps" : "they keep"} going on Runway, and Activity shows ${n === 1 ? "it" : "them"} again after the restart.` : "")(S.data.runs.filter(r => ACTIVE.has(r.status)).length)}</p>
          </fieldset>
        </div>
        <div class="sheet-foot"><span class="grow"></span><button class="raised btn-ok b-default" data-sd="ok">OK</button><button class="raised btn-ok" data-sd="cancel">Cancel</button></div>
      </div>`;
  document.body.append(d);
  const done = ok => {
    removeEventListener("keydown", onKey, true);
    if (ok) { restart($('input[name="sd"]:checked', d).value); return; }
    d.remove(); back?.focus?.();
  };
  // the dialog is modal: it takes every key while open; Tab stays inside it
  const onKey = e => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); done(false); return; }
    if (e.key === "Enter" && !e.target.closest('[data-sd="cancel"]')) { e.preventDefault(); done(true); return; }
    if (e.key === "Tab") {
      const f = $$("input:checked, button", d), i = f.indexOf(document.activeElement);
      e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  };
  addEventListener("keydown", onKey, true);
  d.addEventListener("click", e => { const b = e.target.closest("[data-sd]"); if (b) done(b.dataset.sd === "ok"); });
  $('input[name="sd"]:checked', d).focus();
}
