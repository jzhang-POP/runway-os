import { wins } from "../core/state.js";
import { $, esc, icoLabel } from "../core/dom.js";
import { assetsOf, costHTML, runOf, thumbOf } from "../core/status.js";
import { loadingOr } from "../core/ui.js";
import { RENDER } from "../wm/kinds.js";
import { save } from "../wm/persist.js";
import { renderTasks } from "../wm/taskbar.js";
import { close, focus, renderWin } from "../wm/windows.js";
import { bindZoom } from "./tree.js";

export function viewerRender(w) {
  const r = runOf(w.arg);
  if (!r || !r.asset) { w.rendered = null; w.body.innerHTML = loadingOr(r ? "This file isn't saved yet. It opens here when the job finishes." : "This job is no longer in runs.json."); return; }
  const list = assetsOf(r.type), i = list.findIndex(x => x.taskId === r.taskId);
  const nav = `<button class="raised btn-s" data-step="-1" ${i <= 0 ? "disabled" : ""} title="Newer (←)">◀</button><span class="sunken seg">${i + 1} / ${list.length}</span><button class="raised btn-s" data-step="1" ${i >= list.length - 1 ? "disabled" : ""} title="Older (→)">▶</button>`;
  if (w.rendered === r.asset) { $(".nav", w.body).innerHTML = nav; return; }
  w.rendered = r.asset;
  const src = encodeURI(r.asset), audio = r.type === "audio", video = r.type === "video" || audio;
  w.body.innerHTML = `
        <div class="stage sunken${audio ? " audio" : ""}" data-keep="stage" data-id="${esc(r.taskId)}" draggable="true" title="${video ? "" : "Click to toggle actual size"}">${audio
      ? `<svg class="aud-ico" aria-hidden="true"><use href="#i-audio"/></svg><div class="aud-txt">${esc(r.prompt)}</div><audio src="${src}" controls autoplay></audio>`
      : video ? `<video src="${src}" poster="${thumbOf(r)}" controls autoplay muted loop playsinline></video>`
      : `<img src="${src}" alt="${esc(r.prompt)}" draggable="false">`}</div>
        <div class="footbar">
          <span class="nav">${nav}</span>
          <span class="sunken seg grow info" title="${esc(r.prompt)}">${esc(r.model)} · ${esc(r.settings)} · ${costHTML(r)} cr</span>
          ${video ? "" : `<button class="raised btn-s zoombtn" title="Toggle actual size">${icoLabel("i-zoom", "Fit")}</button>`}
          <button class="raised btn-s" data-open="props" data-id="${esc(r.taskId)}" title="Alt+Enter">${icoLabel("i-doc", "Properties")}</button>
          <button class="raised btn-s" data-file="reveal" data-name="${esc(r.asset)}">${icoLabel("i-finder", "Show in Finder")}</button>
        </div>`;
  const media = $(audio ? "audio" : video ? "video" : "img", w.body), info = $(".info", w.body);
  const addDims = (wd, ht, extra = "") => { info.innerHTML += ` · ${wd}×${ht}${extra}`; };
  if (audio) media.addEventListener("loadedmetadata", () => { info.innerHTML += ` · ${media.duration.toFixed(1)}s`; }, { once: true });
  else if (video) media.addEventListener("loadedmetadata", () => addDims(media.videoWidth, media.videoHeight, ` · ${media.duration.toFixed(1)}s`), { once: true });
  else { media.complete && media.naturalWidth ? addDims(media.naturalWidth, media.naturalHeight) : media.addEventListener("load", () => addDims(media.naturalWidth, media.naturalHeight), { once: true }); bindZoom(w); }
}

// move a viewer to the next or previous file of the same type
export function step(w, delta) {
  const r = runOf(w.arg); if (!r) return;
  const list = assetsOf(r.type), next = list[list.findIndex(x => x.taskId === r.taskId) + delta];
  if (!next) return;
  const id = `viewer:${next.taskId}`;
  if (wins.has(id)) { close(w); focus(wins.get(id)); return; }
  wins.delete(w.id);
  Object.assign(w, { id, arg: next.taskId, rendered: null });
  w.el.dataset.id = id; wins.set(id, w);
  renderWin(w); renderTasks(); save();
}

export function init() {
  RENDER.viewer = viewerRender;
}
