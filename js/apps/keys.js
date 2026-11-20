import { esc } from "../core/dom.js";
import { APP_KEYS, KINDS, RENDER } from "../wm/kinds.js";

export const SHORTCUTS = [
  ["Windows", [
    ["Cmd+W or Alt+W", "Close the window (Cmd+W only in full screen)"],
    ["Cmd+M or Alt+↓", "Minimize"],
    ["Alt+↑", "Maximize or restore"],
    ["Alt+← / Alt+→", "Snap to the left or right half"],
    ["Cmd+` or Alt+`", "Switch to the next window"],
    ["Ctrl+Cmd+F or F11", "Full screen, where Cmd+W reaches Runway OS"],
    ["Alt+Space", "Window menu (Move, Size…)"],
    ["Ctrl+Esc", "Start menu"],
    ["Esc", "Close a menu, a viewer, Compare or Properties"],
    ["Cmd+,", "Options"],
    ["Cmd+?", "This list"],
  ]],
  ["Open apps (when you're not typing in a field)", Object.entries(APP_KEYS).filter(([k]) => KINDS[k]).map(([k, key]) => ["Alt+" + key, ({ generate: "Generate", terminal: "Terminal", jobs: "Jobs", tree: "Job tree", usage: "Usage", activity: "Activity", images: "Images", videos: "Videos", audio: "Audio", options: "Options", notes: "Notes", keys: "This list (also F1 or ?)" })[k]])],
  ["Jobs and files", [
    ["↑ ↓ ← →, Home, End", "Move the selection"],
    ["Enter, Cmd+O or Cmd+↓", "Open"],
    ["Cmd+I or Alt+Enter", "Properties (Get Info)"],
    ["Cmd+F", "Search jobs"],
    ["Cmd+C", "Copy the selected job (its task ID)"],
    ["Cmd+V in Generate", "Use the copied job, or a copied image file, as an input"],
    ["Shift+F10 or right-click", "Job menu"],
    ["Cmd+click, Shift+click", "Select several jobs or files"],
    ["Shift+↑ ↓ ← →", "Extend the selection"],
    ["Cmd+A", "Select all"],
    ["Alt+C", "Compare the selected files"],
  ]],
  ["Text fields", [
    ["Cmd+X, Cmd+C, Cmd+V", "Cut, copy, paste"],
    ["Cmd+A", "Select all"],
    ["Cmd+Z, Shift+Cmd+Z", "Undo, redo"],
    ["Cmd+Enter in Generate", "Generate"],
    ["Cmd+Shift+S in Generate", "Save the prompt to Notes"],
  ]],
  ["Viewer", [
    ["← →", "Previous or next file"],
    ["Space", "Play or pause"],
    ["M", "Mute"],
    [", .", "Step one frame"],
  ]],
  ["Compare", [
    ["← →", "Move the wipe divider (Shift: 10%)"],
    ["Space", "Play or pause all"],
    ["Enter", "Open the selected file"],
  ]],
];
export function keysRender(w) {
  if (w.shell) return;
  w.shell = true;
  w.body.innerHTML = `
        <div class="pwrap keys" data-keep="keys">
          ${SHORTCUTS.filter(([, rows]) => rows.length).map(([title, rows]) => `<fieldset class="group"><legend>${esc(title)}</legend>
            <dl class="ptbl keytbl">${rows.map(([k, v]) => `<dt>${k.split(/( or |, | \/ )/).map(part => /^( or |, | \/ )$/.test(part) ? `<span class="muted">${part}</span>` : `<kbd>${esc(part)}</kbd>`).join("")}</dt><dd>${esc(v)}</dd>`).join("")}</dl></fieldset>`).join("")}
          <p class="muted">Chrome keeps Cmd+W, Cmd+T, Cmd+N and Cmd+Q for itself, except in full screen, where Runway OS gets Cmd+W. The Alt shortcuts work everywhere.</p>
        </div>`;
}

export function init() {
  RENDER.keys = keysRender;
}
