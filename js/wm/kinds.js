import { nameOf, plural, runOf, typeIcon } from "../core/status.js";
import { cascade, centered, px } from "./geometry.js";
import { cmpIds } from "../apps/compare.js";
import { noteTitle } from "../apps/notes.js";

export const KINDS = {
  overview: {
    icon: () => "i-logo", title: () => "System Properties", min: [420, 340],
    geo: d => centered(d, 460, 360, 0, true),
  },
  jobs: {
    icon: () => "i-folder", title: w => `Jobs — ${w.filter === "all" ? "All items" : plural(w.filter)}`, min: [420, 240],
    geo: d => { const wd = Math.min(px(960), d.w - px(120)), y = Math.min(px(284), Math.round(d.h / 3)); return { wd, ht: d.h - y - 2, x: Math.max(px(104), Math.round((d.w - wd) / 2)), y }; },
  },
  terminal: {
    icon: () => "i-term", title: w => `Terminal — ${w.term?.cwd ? "R:\\" + w.term.cwd.toUpperCase() : "R:\\"}`, min: [380, 240],
    geo: d => { const g = centered(d, 680, 440, 40); return { ...g, y: Math.max(0, g.y - px(20)) }; },
  },
  options: {
    icon: () => "i-gear", title: () => "Options", min: [380, 360],
    geo: d => centered(d, 420, 470, 30, true),
  },
  usage: {
    icon: () => "i-chart", title: w => `Usage — last ${w.days || 30} days`, min: [420, 360],
    geo: d => centered(d, 760, 620, 20),
  },
  activity: {
    icon: () => "i-hourglass", title: () => "Activity", min: [340, 240],
    geo: d => { const wd = Math.min(px(420), d.w), ht = Math.min(px(520), d.h); return { wd, ht, x: d.w - wd - px(12), y: px(12) }; },
  },
  images: { icon: () => "i-picture", title: () => "Images", min: [300, 240], geo: cascade(720, 480) },
  videos: { icon: () => "i-video", title: () => "Videos", min: [300, 240], geo: cascade(720, 480) },
  audio: { icon: () => "i-audio", title: () => "Audio", min: [300, 240], geo: cascade(620, 440) },
  viewer: { icon: w => typeIcon(runOf(w.arg)?.type), title: w => runOf(w.arg)?.asset || "Viewer", min: [300, 260], geo: cascade(660, 680) },
  generate: {
    icon: () => "i-wand", title: () => "Generate", min: [360, 420],
    geo: d => centered(d, 560, 660, 60),
  },
  key: {
    icon: () => "i-key", title: () => "Runway API key", min: [340, 330],
    geo: d => centered(d, 460, 420, 0, true),
  },
  keys: { icon: () => "i-keys", title: () => "Keyboard shortcuts", min: [360, 300], geo: d => centered(d, 520, 600, 0, true) },
  tree: { icon: () => "i-tree", title: () => "Job tree", min: [360, 300], geo: cascade(900, 620) },
  props: { icon: () => "i-doc", title: w => `Properties — ${runOf(w.arg) ? nameOf(runOf(w.arg)) : w.arg.slice(0, 8)}`, min: [340, 320], geo: cascade(460, 600) },
  compare: { icon: () => "i-compare", title: w => { const n = cmpIds(w.arg).length; return `Compare — ${n} item${n === 1 ? "" : "s"}`; }, min: [420, 320], geo: d => centered(d, 1040, 700, 0) },
  notes: { icon: () => "i-notes", title: w => (noteTitle(w) ? `Notes — ${noteTitle(w)}` : "Notes"), min: [420, 300], geo: cascade(780, 540) },
};

// every shortcut the app handles, shown in the Keyboard shortcuts window and as hints in the menus
export const APP_KEYS = { generate: "G", terminal: "T", jobs: "J", tree: "Shift+J", usage: "U", activity: "A", images: "I", videos: "V", audio: "M", options: "O", notes: "N", keys: "/" };
export const RENDER = {};
export const SIG = {};
