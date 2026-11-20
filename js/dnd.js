import { runOf } from "./core/status.js";

// drag and drop of saved files between windows (Jobs rows, gallery tiles, the viewer) into Generate's inputs
export const DRAG_TYPE = "application/x-runway-run";

export function init() {
  addEventListener("dragstart", e => {
    const src = e.target.closest?.("[draggable][data-id]"); if (!src) return;
    const r = runOf(src.dataset.id); if (!r?.asset) { e.preventDefault(); return; }
    e.dataTransfer.setData(DRAG_TYPE, r.taskId);
    e.dataTransfer.setData("text/plain", r.asset);
    e.dataTransfer.effectAllowed = "copy";
    const img = src.querySelector("img"); if (img?.complete) e.dataTransfer.setDragImage(img, 16, 16);
  });
}
