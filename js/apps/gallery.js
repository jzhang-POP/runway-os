import { $, esc } from "../core/dom.js";
import { morph } from "../core/morph.js";
import { assetsOf, plural, runOf, thumbInner, thumbOf } from "../core/status.js";
import { GEN_BTN, emptyAct, itemId, loadingOr } from "../core/ui.js";
import { RENDER, SIG } from "../wm/kinds.js";
import { save } from "../wm/persist.js";
import { CMP_BTN, activeSync, cmpBtnSync, isSel, selNote } from "../wm/selection.js";

export function gallery(w, type) {
  if (!w.shell) {
    w.shell = true;
    w.body.innerHTML = `
        <div class="toolbar"><label class="sizer">Size <input type="range" min="84" max="260" step="4" value="${w.size}" aria-label="Thumbnail size" aria-valuetext="${w.size} px thumbnails"></label>${CMP_BTN}</div>
        <div class="gridwrap sunken" data-keep="grid" tabindex="0" role="listbox" aria-multiselectable="true" aria-label="${plural(type)}"><div class="grid"></div></div>
        <div class="statusbar"><span class="sunken seg grow"></span><span class="sunken seg">${type === "video" ? "Hover to preview · " : ""}Double-click or Enter to open</span></div>`;
    $("input", w.body).addEventListener("input", e => { w.size = +e.target.value; e.target.setAttribute("aria-valuetext", `${w.size} px thumbnails`); $(".grid", w.body).style.setProperty("--tile", w.size + "px"); save(); });
  }
  const items = assetsOf(type), grid = $(".grid", w.body), wrap = $(".gridwrap", w.body);
  grid.style.setProperty("--tile", w.size + "px");
  morph(grid, items.length ? items.map(r => `
      <div class="tile${isSel(w, r.taskId) ? " sel" : ""}" role="option" id="${itemId(w, r.taskId)}" data-id="${esc(r.taskId)}" aria-selected="${isSel(w, r.taskId)}" aria-label="${esc(r.asset)}" title="${esc(r.prompt)}" draggable="true">
        <span class="thumb sunken">${thumbInner(thumbOf(r), type)}${type === "video" ? '<span class="play"></span>' : ""}</span>
        <span class="cap">${esc(r.asset)}</span>
      </div>`).join("") : loadingOr(`No ${type === "audio" ? "audio" : type + "s"} yet. Finished ${type === "audio" ? "audio files are" : type + "s are"} saved here automatically.${emptyAct(GEN_BTN)}`));
  // a listbox holds only options: while empty the box is a plain group around the message and its button, and no tab stop
  wrap.setAttribute("role", items.length ? "listbox" : "group");
  items.length ? wrap.setAttribute("tabindex", "0") : wrap.removeAttribute("tabindex");
  activeSync(w);
  $(".statusbar .seg", w.body).textContent = `${items.length} object${items.length === 1 ? "" : "s"}${selNote(w)}`;
  cmpBtnSync(w);
  if (type === "video" && !w.hoverBound) {
    w.hoverBound = true;
    grid.addEventListener("pointerover", e => {
      const t = e.target.closest(".tile"); if (!t || t.contains(e.relatedTarget) || $("video", t)) return;
      const r = runOf(t.dataset.id); if (!r) return;
      const v = Object.assign(document.createElement("video"), { src: encodeURI(r.asset), muted: true, loop: true, playsInline: true, autoplay: true });
      v.setAttribute("data-live", "");
      $(".thumb", t).append(v);
    });
    grid.addEventListener("pointerout", e => { const t = e.target.closest(".tile"); if (t && !t.contains(e.relatedTarget)) $("video", t)?.remove(); });
  }
}

export function init() {
  RENDER.images = w => gallery(w, "image");
  RENDER.audio = w => gallery(w, "audio");
  RENDER.videos = w => gallery(w, "video");
  SIG.images = w => JSON.stringify(assetsOf("image").map(r => [r.taskId, r.asset, r.prompt]));
  SIG.videos = w => JSON.stringify(assetsOf("video").map(r => [r.taskId, r.asset, r.prompt]));
  SIG.audio = w => JSON.stringify(assetsOf("audio").map(r => [r.taskId, r.asset, r.prompt]));
}
