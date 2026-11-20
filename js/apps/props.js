import { cap, esc, fmt, icoLabel } from "../core/dom.js";
import { morph } from "../core/morph.js";
import { ACTIVE, cancellable, childrenOf, filesOf, miniThumb, nameOf, relHTML, runOf, runSig, statusHTML, thumbInner, thumbOf, typeIcon } from "../core/status.js";
import { absTime, dur, tOf } from "../core/time.js";
import { loadingOr } from "../core/ui.js";
import { RENDER, SIG } from "../wm/kinds.js";
import { fitActions } from "../wm/windows.js";

export function propsRender(w) {
  const r = runOf(w.arg);
  if (!r) { morph(w.body, loadingOr("This job is no longer in runs.json.")); return; }
  const parent = r.parent ? runOf(r.parent) : null, kids = childrenOf(r.taskId), took = r.finishedAt && r.createdAt ? tOf(r.finishedAt) - tOf(r.createdAt) : null;
  const chip = x => `<button class="chip raised" data-open="props" data-id="${esc(x.taskId)}" title="${esc(x.prompt)}">${miniThumb(x)}<span>${esc(nameOf(x))}</span></button>`;
  const rows = [
    ["Status", statusHTML(r)],
    ["Credits", r.credits != null ? `${fmt(r.credits)}${r.costSource === "runway" ? ' <span class="muted">reported by Runway</span>' : ""}` : r.estimatedCredits != null ? `~${fmt(r.estimatedCredits)} <span class="muted">estimate</span>` : "—"],
    ...(r.quotedCredits != null ? [["Quoted", `${r.quoteExact ? "" : "≈ "}${fmt(r.quotedCredits)}${r.credits != null ? (r.credits === r.quotedCredits ? ' <span class="muted">matches the charge</span>' : ` <span class="bad">charge differs by ${fmt(r.credits - r.quotedCredits)}</span>`) : ' <span class="muted">before submitting</span>'}`]] : []),
    ["Created", r.createdAt ? `${esc(absTime(tOf(r.createdAt)))} <span class="muted">(${relHTML(r.createdAt)})</span>` : esc(r.date)],
    ...(took ? [["Took", dur(took)]] : []),
    ["Model", esc(r.model)], ["Settings", esc(r.settings)],
    ...(r.failure ? [["Failure", `<span class="bad">${esc(r.failure)}</span>${r.failureCode ? ` <code>${esc(r.failureCode)}</code>` : ""}`]] : []),
    ["Task ID", `<code>${esc(r._of || r.taskId)}</code>`], ["File", r.asset ? esc(r.asset) + (filesOf(r).length > 1 ? ` <span class="muted">(file ${r._n || 1} of ${filesOf(r).length})</span>` : "") : "Not saved yet"],
    ...(parent ? [["Made from", parent.asset && r.asset ? `<span class="chips">${chip(parent)}<button class="raised btn-s" data-compare="${esc(parent.taskId + "," + r.taskId)}" title="This file and its source side by side">${icoLabel("i-compare", "Compare")}</button></span>` : chip(parent)]] : []),
    ...(kids.length ? [["Used in", `<span class="chips">${kids.map(chip).join("")}</span>`]] : []),
  ];
  morph(w.body, `
        <div class="pwrap" data-keep="p">
          <div class="ptop">${r.asset ? `<button class="thumb sunken" data-open="viewer" data-id="${esc(r.taskId)}" title="Open">${thumbInner(thumbOf(r), r.type)}</button>` : `<span class="thumb sunken">${thumbInner(null, r.type)}</span>`}
            <div><b>${esc(nameOf(r))}</b><div class="muted">${esc(cap(r.type))} · ${esc(r.model)}</div></div></div>
          <hr class="etch">
          <dl class="ptbl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
          <hr class="etch">
          <div class="plabel">Prompt</div>
          <div class="promptbox sunken">${esc(r.prompt)}</div>
          <div class="actions" role="group" aria-label="This file">
            ${r.asset ? `<button class="raised btn-s b-default" data-open="viewer" data-id="${esc(r.taskId)}">${icoLabel(typeIcon(r.type), "Open")}</button><button class="raised btn-s" data-file="reveal" data-name="${esc(r.asset)}">${icoLabel("i-finder", "Show in Finder")}</button>` : ""}
            ${cancellable(r) ? `<button class="raised btn-s b-danger" data-cancel="${esc(r.taskId)}">${icoLabel("i-stop", "Cancel job")}</button>` : ""}
            <button class="raised btn-s" data-copy="${esc(r.prompt)}" data-done="Prompt copied">${icoLabel("i-copy", "Copy prompt")}</button>
            <button class="raised btn-s" data-copy="${esc(r._of || r.taskId)}" data-done="ID copied">${icoLabel("i-copy", "Copy task ID")}</button>
            ${r.failure ? `<button class="raised btn-s" data-copy="${esc(r.failure)}" data-done="Error copied">${icoLabel("i-copy", "Copy error")}</button>` : ""}
          </div>
          <div class="actions" role="group" aria-label="Make from this">
            ${r.type === "image" && r.asset ? `<button class="raised btn-s" data-gen="animate" data-id="${esc(r.taskId)}">${icoLabel("i-animate", "Animate…")}</button>` : ""}
            ${(r.type === "image" || r.type === "video") && r.asset ? `<button class="raised btn-s" data-gen="upscale" data-id="${esc(r.taskId)}">${icoLabel("i-upscale", "Upscale…")}</button>` : ""}
            ${r.type === "video" && r.asset ? `<button class="raised btn-s" data-gen="sound" data-id="${esc(r.taskId)}">${icoLabel("i-sound", "Add sound…")}</button><button class="raised btn-s" data-gen="hdr" data-id="${esc(r.taskId)}">${icoLabel("i-hdr", "Convert to HDR…")}</button>` : ""}
            <button class="raised btn-s${r.asset || ACTIVE.has(r.status) ? "" : " b-default"}" data-gen="again" data-id="${esc(r.taskId)}">${icoLabel("i-again", "Generate again…")}</button>
          </div>
        </div>`);
  fitActions(w);
}

export function init() {
  RENDER.props = propsRender;
  SIG.props = w => { const r = runOf(w.arg); return r ? [runSig(r), runSig(runOf(r.parent)), ...childrenOf(r.taskId).map(runSig)].join("|") : "-"; };
}
