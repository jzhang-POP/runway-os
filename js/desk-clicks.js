import { S } from "./core/state.js";
import { $, desk } from "./core/dom.js";
import { runOf } from "./core/status.js";
import { fileAction } from "./core/ui.js";
import { RENDER } from "./wm/kinds.js";
import { save } from "./wm/persist.js";
import { menuSelect, multiClick, select } from "./wm/selection.js";
import { renderTasks } from "./wm/taskbar.js";
import { close, defaultOpen, open, renderWin, winOf } from "./wm/windows.js";
import { cancelJob, genFrom } from "./apps/generate.js";
import { step } from "./apps/viewer.js";
import { runMenu } from "./menus.js";

export function init() {
  desk.addEventListener("click", e => {
    const c = e.target.closest("[data-copy]");
    if (c) {
      const t = $(":scope > span", c) || c, label = t.textContent; // icon buttons keep their icon
      navigator.clipboard?.writeText(c.dataset.copy).then(() => { t.textContent = c.dataset.done || "Copied"; setTimeout(() => { t.textContent = label; }, 900); }).catch(() => {});
      return;
    }
    const fa = e.target.closest("[data-file]"); if (fa) { fileAction(fa.dataset.file, fa.dataset.name); return; }
    const f = e.target.closest("[data-filter]");
    if (f) { const w = winOf(f); w.filter = f.dataset.filter; renderWin(w); renderTasks(); save(); return; }
    const so = e.target.closest("[data-sort]");
    if (so) { const w = winOf(so); w.sort = w.sort.key === so.dataset.sort ? { key: so.dataset.sort, dir: -w.sort.dir } : { key: so.dataset.sort, dir: so.dataset.sort === "name" || so.dataset.sort === "type" || so.dataset.sort === "model" ? 1 : -1 }; RENDER.jobs(w); save(); return; }
    const tb = e.target.closest("[data-tab]"); if (tb) { const w = winOf(tb); w.tab = tb.dataset.tab; renderWin(w); save(); return; }
    const cl = e.target.closest("[data-close]"); if (cl) { close(winOf(cl)); return; }
    const g = e.target.closest("[data-gen]"); if (g) { const r = runOf(g.dataset.id); if (r) genFrom(r, g.dataset.gen, g); return; }
    const cx = e.target.closest("[data-cancel]"); if (cx) { const r = runOf(cx.dataset.cancel); if (r) cancelJob(r); return; }
    const s = e.target.closest("[data-step]"); if (s) { step(winOf(s), +s.dataset.step); return; }
    const o = e.target.closest("[data-open]"); if (o) { open(o.dataset.open, o.dataset.id || null, o); return; }
    const it = e.target.closest(".row[data-id], .tile[data-id], .tnode[data-id]");
    if (it) {
      const w = winOf(it); if (multiClick(w, it.dataset.id, e)) return;
      select(w, it.dataset.id);
      if (S.lastPointer === "touch" && runOf(it.dataset.id)) defaultOpen(runOf(it.dataset.id), it);
    }
  });
  desk.addEventListener("dblclick", e => {
    const it = e.target.closest(".row[data-id], .tile[data-id], .tnode[data-id]");
    if (it && runOf(it.dataset.id)) defaultOpen(runOf(it.dataset.id), it);
  });
  desk.addEventListener("contextmenu", e => {
    const it = e.target.closest(".row[data-id], .tile[data-id], .tnode[data-id]"), st = e.target.closest(".stage");
    const r = it ? runOf(it.dataset.id) : st ? runOf(winOf(st)?.arg) : null;
    if (!r) return;
    e.preventDefault();
    if (it) menuSelect(winOf(it), it.dataset.id);
    runMenu(r, e.clientX, e.clientY, it || st);
  });
}
