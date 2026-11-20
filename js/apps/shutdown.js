import { S } from "../core/state.js";
import { $ } from "../core/dom.js";
import { modal } from "../core/modal.js";
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
  modal({
    id: "shutdown", html: `
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
        <div class="sheet-foot"><span class="grow"></span><button class="raised btn-ok b-default" data-m="ok">OK</button><button class="raised btn-ok" data-m="cancel">Cancel</button></div>
      </div>`,
    focus: d => $('input[name="sd"]:checked', d),
    // OK reloads the page, so the dialog just stays until then
    onPress: () => restart($('#shutdown input[name="sd"]:checked').value),
  });
}
