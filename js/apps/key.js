import { S } from "../core/state.js";
import { $, fmt, icoLabel } from "../core/dom.js";
import { api } from "../core/api.js";
import { balloon } from "../core/ui.js";
import { RENDER } from "../wm/kinds.js";
import { poll } from "../main.js";

/* ---------- Runway API key ---------- */
export function keyRender(w) {
  const where = S.data.keySource === "file" ? "saved in .runway_key" : S.data.keySource === "env" ? "from the RUNWAYML_API_SECRET variable" : "";
  const st = !S.loaded ? { cls: "", text: "Checking…" }
    : !S.data.live ? { cls: "off", text: "No key. The dashboard can't sync jobs, check the balance or generate." }
    : S.data.error ? { cls: "warn", text: `Key ending ${S.data.keyHint || "…"} ${where}. Runway answers: ${S.data.error}` }
    : { cls: "on", text: `Connected. Key ending ${S.data.keyHint || "…"}, ${where}.` };
  if (!w.shell) {
    w.shell = true;
    w.body.innerHTML = `
        <form class="keyf" novalidate autocomplete="off">
          <div class="kstat"><svg class="kico"><use href="#i-key"/></svg><div><b class="live kst"></b><div class="muted kbal"></div></div></div>
          <fieldset class="group"><legend class="kleg"></legend>
            <div class="krow"><input class="field kin" type="password" placeholder="key_…" aria-label="Runway API key" spellcheck="false" autocapitalize="off" autocomplete="off">
              <button type="button" class="raised btn-s kshow" aria-pressed="false">${icoLabel("i-eye", "Show")}</button></div>
            <div class="krow end"><button type="submit" class="raised btn-go b-default ksave">${icoLabel("i-save", "Check and save")}</button></div>
          </fieldset>
          <div class="gmsg kmsg" role="alert" hidden></div>
          <p class="muted knote">Create a key at <a href="https://dev.runwayml.com/" target="_blank" rel="noopener">dev.runwayml.com</a> under API Keys. The dashboard checks it with Runway, then saves it to <code>.runway_key</code> in the Runway folder, readable only by your Mac account. It's never shown again here.</p>
          <div class="krow end"><button type="button" class="raised btn-s b-danger krm" hidden>${icoLabel("i-remove", "Remove saved key")}</button></div>
        </form>`;
    const form = $(".keyf", w.body), inp = $(".kin", form), show = $(".kshow", form), rm = $(".krm", form), showL = $("span", show), rmL = $("span", rm);
    show.addEventListener("click", () => { const on = inp.type === "password"; inp.type = on ? "text" : "password"; show.setAttribute("aria-pressed", on); showL.textContent = on ? "Hide" : "Show"; });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const key = inp.value.trim();
      if (!key) { keyMsg(w, "Paste a key first."); return; }
      const btn = $(".ksave", form); btn.disabled = true; $("span", btn).textContent = "Checking…"; keyMsg(w, null);
      const out = await keyPost({ key });
      btn.disabled = false; $("span", btn).textContent = "Check and save";
      if (out.error) { keyMsg(w, out.error); return; }
      inp.value = ""; inp.type = "password"; showL.textContent = "Show"; show.setAttribute("aria-pressed", "false");
      balloon({ title: "Key saved", text: out.balance != null ? `Runway accepted it. ${fmt(out.balance)} credits on this org.` : "Runway accepted it.", icon: "i-key", ms: 5000 });
      poll();
    });
    let armed = 0;
    rm.addEventListener("click", async () => {
      if (Date.now() - armed > 3000) { armed = Date.now(); rmL.textContent = "Click again to remove"; setTimeout(() => { rmL.textContent = "Remove saved key"; }, 3000); return; }
      const out = await keyPost({ remove: true });
      if (out.error) { keyMsg(w, out.error); return; }
      balloon({ title: "Key removed", text: ".runway_key was deleted.", icon: "i-key", ms: 4000 });
      poll();
    });
  }
  const kst = $(".kst", w.body);
  kst.className = `live kst ${st.cls}`; kst.textContent = st.text;
  $(".kbal", w.body).textContent = S.data.live && S.data.balance != null ? `${fmt(S.data.balance)} credits on this org` : "";
  $(".kleg", w.body).textContent = S.data.live ? "Replace key" : "Add key";
  $(".krm", w.body).hidden = S.data.keySource !== "file";
}
export const keyPost = body => api("/api/key", body).catch(err => ({ error: err.message }));
export function keyMsg(w, text) { const m = $(".kmsg", w.body); if (m) { m.hidden = !text; m.textContent = text || ""; } }

export function init() {
  RENDER.key = w => keyRender(w);
}
