// Runway OS: a small Win95-style window manager over the live job log (/api/state).
// Entry module: imports every part, runs their init() in the order the single-file app registered them, then starts up.

import { S, wins } from "./core/state.js";
import { $ } from "./core/dom.js";
import { FAV, logoSVG } from "./core/graphics.js";
import { init as uiInit } from "./core/ui.js";
import { restoreLayout } from "./wm/persist.js";
import { renderTasks, init as taskbarInit } from "./wm/taskbar.js";
import { renderWin, init as windowsInit } from "./wm/windows.js";
import { layoutIcons, init as iconsInit } from "./desktop/icons.js";
import { init as activityInit } from "./apps/activity.js";
import { init as compareInit } from "./apps/compare.js";
import { init as galleryInit } from "./apps/gallery.js";
import { init as generateInit } from "./apps/generate.js";
import { init as jobsInit } from "./apps/jobs.js";
import { init as keyInit } from "./apps/key.js";
import { init as keysInit } from "./apps/keys.js";
import { init as notesInit } from "./apps/notes.js";
import { applyOptions, init as optionsInit } from "./apps/options.js";
import { init as overviewInit } from "./apps/overview.js";
import { init as promptlibInit } from "./apps/promptlib.js";
import { init as propsInit } from "./apps/props.js";
import { init as spendInit } from "./apps/spend.js";
import { init as terminalInit } from "./apps/terminal.js";
import { init as treeInit } from "./apps/tree.js";
import { init as usageInit } from "./apps/usage.js";
import { init as viewerInit } from "./apps/viewer.js";
import { bootScreen, init as bootInit } from "./boot.js";
import { init as deskClicksInit } from "./desk-clicks.js";
import { init as dndInit } from "./dnd.js";
import { poll, schedulePoll, tick, init as liveInit } from "./live.js";
import { init as menusInit } from "./menus.js";
import { init as shortcutsInit } from "./shortcuts.js";

// the model list and the first state load in parallel
const modelsLoaded = fetch("/api/models").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(c => { S.CAT = c; }).catch(() => { S.catFailed = true; })
  .finally(() => wins.forEach(w => w.kind === "generate" && renderWin(w)));


// start: every module's listeners and saved state, in the order the single-file app had them
windowsInit();
dndInit();
keysInit();
overviewInit();
jobsInit();
generateInit();
keyInit();
terminalInit();
optionsInit();
usageInit();
activityInit();
galleryInit();
treeInit();
notesInit();
viewerInit();
propsInit();
promptlibInit();
compareInit();
menusInit();
shortcutsInit();
uiInit();
taskbarInit();
spendInit();
iconsInit();
deskClicksInit();
bootInit();
liveInit();
poll();
applyOptions();
document.getElementById("i-logo").innerHTML = logoSVG("#ffffff").replace(/^<svg[^>]*>|<\/svg>$/g, "");
$("#favicon").href = "data:image/svg+xml," + encodeURIComponent(FAV.idle);
bootScreen(modelsLoaded);
restoreLayout();
renderTasks();
layoutIcons();
document.fonts?.ready.then(layoutIcons);
tick();
setInterval(tick, 5000);
schedulePoll();
window.__rwosReady = true;
