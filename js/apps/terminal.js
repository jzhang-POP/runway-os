import { S, ready, wins } from "../core/state.js";
import { $, clampN, esc, fmt } from "../core/dom.js";
import { R_BITS, spark } from "../core/graphics.js";
import { ACTIVE, assetsOf, counts, createdMs, newestFirst, runOf, statusInfo } from "../core/status.js";
import { upTo } from "../core/time.js";
import { fileAction } from "../core/ui.js";
import { KINDS, RENDER, SIG } from "../wm/kinds.js";
import { save } from "../wm/persist.js";
import { renderTasks } from "../wm/taskbar.js";
import { close, defaultOpen, frontWin, open, retitle } from "../wm/windows.js";
import { genFields, genRefresh, vals } from "./generate.js";
import { noteGet, noteListStale, noteTermFind, noteTermLink, notesSt, openNote } from "./notes.js";
import { restart, shutdownDialog } from "./shutdown.js";
import { spendTerm } from "./spend.js";
import { usageLoad, usageMine, usageSummary } from "./usage.js";
import { bootLog } from "../boot.js";

/* ---------- terminal: a DOS-style prompt that speaks both dir and ls ---------- */
export const bootAt = Date.now();
export const DIRS = { images: "image", videos: "video", audio: "audio", jobs: null, inputs: "input", notes: null };
export const TERM_HELP = [
  ["neofetch", "system info, with the logo"],
  ["ls, ll, dir [folder]", "list a folder (ls -l or ll for details)"],
  ["cd <folder>", "move to images, videos, audio, jobs, inputs or notes (cd .. to go up)"],
  ["tree [folder]", "show folders and files as a tree"],
  ["pwd", "show the current folder"],
  ["open, start <name>", "open a file or job in its window"],
  ["cat, type <name>", "show a job's details, or a note's text"],
  ["ps", "jobs rendering or queued"],
  ["balance", "credits left and spent today"],
  ["cost [days]", "credits spent per model (org) and per task (yours), default 30 days"],
  ["gen [prompt]", "open Generate, with the prompt filled in"],
  ["finder", "show the Runway folder in Finder"],
  ["history", "commands you typed"],
  ["bootlog, dmesg", "the startup checks, with their times"],
  ["clear, cls", "clear the screen"],
  ["reboot [--clean|--all]", "restart; --clean forgets the window layout, --all also resets Options"],
  ["shutdown", "open the Shut down dialog"],
  ["exit", "close the terminal"],
];

export function termEntries(dir) {
  if (!dir) return Object.keys(DIRS).map(d => ({ name: d + "/", dir: d }));
  if (dir === "jobs") return newestFirst().map(r => ({ name: r.taskId.slice(0, 8), run: r }));
  if (dir === "inputs") return (S.data.inputs || []).map(i => ({ name: i.file, input: i }));
  if (dir === "notes") { noteListStale(); return (notesSt.list || []).map(n => ({ name: n.name, note: n })); }
  return assetsOf(DIRS[dir]).map(r => ({ name: r.asset, run: r }));
}
export function termFind(w, arg) {
  const a = String(arg || "").replace(/^\.\//, "").replace(/^\/?(images|videos|audio|jobs|inputs|notes)\//i, "").toLowerCase(); if (!a) return null;
  return S.data.runs.find(r => (r.asset || "").toLowerCase() === a || r.taskId.toLowerCase().startsWith(a))
    || termEntries(w.term.cwd).map(e => e.run).filter(Boolean).find(r => (r.asset || "").toLowerCase().startsWith(a)) || null;
}

export function neofetch() {
  const c = counts(), up = Math.round((Date.now() - bootAt) / 60000), sp = spark(S.data.history);
  const info = [
    `<b class="t-acc">you</b>@<b class="t-acc">runway-os</b>`,
    "-------------",
    `<b class="t-acc">OS</b>: runway os (Win95 edition)`,
    `<b class="t-acc">Host</b>: ${esc(location.host)}`,
    `<b class="t-acc">Uptime</b>: ${up < 60 ? `${up} min` : `${Math.floor(up / 60)} h ${up % 60} min`}`,
    `<b class="t-acc">API</b>: ${S.data.live ? `Runway 2024-11-06, key ending ${esc(S.data.keyHint || "…")}` : "no key"}`,
    `<b class="t-acc">Credits</b>: <span class="t-red">${S.data.balance == null ? "?" : fmt(S.data.balance)}</span>`,
    `<b class="t-acc">Org, 24 h</b>: ${sp.spent != null ? `${fmt(sp.spent)} credits spent` : "collecting"}`,
    `<b class="t-acc">Jobs</b>: ${S.data.runs.length} (${fmt(c.credits)} credits)`,
    `<b class="t-acc">Files</b>: ${c.files.image} images, ${c.files.video} videos, ${c.files.audio} audio`,
    `<b class="t-acc">Rendering</b>: ${c.active || "idle"}`,
    "",
    ["#08090b", "#ff2b1c", "#5fdc7a", "#ffc94a", "#1f6fc4", "#c678dd", "#56b6c2", "#e4e4e8"].map(c => `<span class="t-sw" style="background:${c}"></span>`).join(""),
  ];
  const px = R_BITS.flatMap((row, y) => [...row].map((c, x) => (c === "1" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ""))).join("");
  const art = `<svg class="t-logo" viewBox="-1 -1 10 13" shape-rendering="crispEdges" aria-hidden="true">${px}</svg>`;
  return `<span class="t-neo">${art}<span>${info.join("\n")}</span></span>`;
}

export const fileLink = r => `<a class="t-file" data-open="${r.asset ? "viewer" : "props"}" data-id="${esc(r.taskId)}">${esc(r.asset || r.taskId.slice(0, 8))}</a>`;
export const dirLink = d => `<a class="t-dir" data-cd="${d}">${d}/</a>`;
// tree: folders with their entries; under jobs/, each job nests what it was made from
export function termTree(dir) {
  const MAX = 20, out = [dir ? dirLink(dir) : "R:\\"];
  let files = 0;
  const jobNode = (r, seen) => {
    const html = `${fileLink({ ...r, asset: null })}  <span class="t-dim">${esc(r.prompt.slice(0, 40))}</span>`;
    if (seen.has(r.taskId) || seen.size > 6) return { html };
    const s2 = new Set(seen).add(r.taskId), srcs = r.inputs || (r.parent ? [{ run: r.parent }] : []), kids = [], keys = new Set();
    srcs.forEach(i => {
      const k = i.run ? "r:" + i.run : "i:" + i.input; if (keys.has(k)) return; keys.add(k);
      const src = i.run && runOf(i.run);
      if (src) kids.push(jobNode(src, s2));
      else if (i.input) kids.push({ html: `<span>inputs/${esc(i.input)}</span>` });
    });
    return { html, kids };
  };
  const folder = d => {
    const list = termEntries(d); files += list.length;
    const kids = list.slice(0, MAX).map(e => e.input ? { html: `<span>${esc(e.name)}</span>` } : e.note ? { html: noteTermLink(e.name) } : d === "jobs" ? jobNode(e.run, new Set()) : { html: fileLink(e.run) });
    if (list.length > MAX) kids.push({ html: `<span class="t-dim">… and ${list.length - MAX} more</span>` });
    return { html: dirLink(d), kids };
  };
  const walk = (kids, pre) => (kids || []).forEach((k, i) => {
    const last = i === kids.length - 1;
    out.push(pre + (last ? "└── " : "├── ") + k.html);
    walk(k.kids, pre + (last ? "    " : "│   "));
  });
  const dirs = dir ? [dir] : Object.keys(DIRS);
  walk(dir ? folder(dir).kids : dirs.map(folder), "");
  out.push("", `<span class="t-dim">${dirs.length} folder${dirs.length === 1 ? "" : "s"}, ${files} file${files === 1 ? "" : "s"}</span>`);
  return out.join("\n");
}

export function termRun(w, raw) {
  const t = w.term, out = [], say = (h, cls = "") => out.push(cls ? `<span class="${cls}">${h}</span>` : h);
  const line = raw.trim();
  t.lines.push(`<span class="t-prompt">${esc(termPrompt(t))}</span>${esc(raw)}`);
  if (!line) return termPaint(w);
  t.hist.push(line); t.hi = t.hist.length;
  const [cmd0, ...args] = line.match(/"[^"]*"|\S+/g).map(x => x.replace(/^"|"$/g, ""));
  const cmd = cmd0.toLowerCase(), arg = args.join(" ");
  switch (cmd) {
    case "help": case "?":
      say(TERM_HELP.map(([c, d]) => `  <b class="t-acc">${esc(c.padEnd(22))}</b>${esc(d)}`).join("\n")); break;
    case "neofetch": case "ver": case "about": say(neofetch()); break;
    case "ls": case "ll": case "dir": {
      const long = args.includes("-l") || cmd === "dir" || cmd === "ll", target = args.find(a => !a.startsWith("-"));
      const dir = target ? target.replace(/\/$/, "").replace(/^\//, "").toLowerCase() : t.cwd;
      if (dir && dir !== ".." && !(dir in DIRS)) { say(`ls: ${esc(target)}: no such folder`, "t-err"); break; }
      const list = termEntries(dir === ".." ? null : dir);
      if (!list.length) { say("(empty)", "t-dim"); break; }
      say(list.map(e => {
        if (e.dir) return `<a class="t-dir" data-cd="${e.dir}">${e.name}</a>`;
        if (e.input) return `<span>${esc(e.name)}</span>`;
        if (e.note) return (long ? `${new Date(e.note.modified).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).padEnd(16)} ${String(fmt(e.note.size)).padStart(9)} B  ` : "") + noteTermLink(e.name);
        const r = e.run;
        if (!long) return dir === "jobs" ? `${fileLink({ ...r, asset: null })}  ${esc(r.prompt.slice(0, 50))}` : fileLink(r);
        const when = new Date(createdMs(r)).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        return `${when.padEnd(16)} ${String(r.credits ?? "-").padStart(5)} cr  ${esc((r.model || "").padEnd(18))} ${dir === "jobs" ? fileLink({ ...r, asset: null }) + "  " + esc(statusInfo(r).label) : fileLink(r)}`;
      }).join("\n"));
      if (long) say(`${list.length} item${list.length === 1 ? "" : "s"}`, "t-dim");
      break;
    }
    case "cd": case "chdir": {
      const d = (arg || "/").replace(/\/$/, "").replace(/^\//, "").toLowerCase();
      if (!d || d === ".." || d === "~" || d === "\\") t.cwd = null;
      else if (d === ".") break;
      else if (d in DIRS && !t.cwd) t.cwd = d;
      else say(`cd: ${esc(arg)}: no such folder${t.cwd ? " (cd .. first)" : ""}`, "t-err");
      break;
    }
    case "pwd": say(t.cwd ? `/${t.cwd}` : "/"); break;
    case "tree": {
      const d = arg ? arg.replace(/\/$/, "").replace(/^\//, "").toLowerCase() : t.cwd;
      if (d && !(d in DIRS)) { say(`tree: ${esc(arg)}: no such folder`, "t-err"); break; }
      say(termTree(d || null)); break;
    }
    case "open": case "start": {
      if (!arg) { say("usage: open <file, job ID or app: usage, generate, options, system, key>", "t-err"); break; }
      const app = { usage: "usage", generate: "generate", options: "options", system: "overview", jobs: "jobs", key: "key" }[arg.toLowerCase()];
      if (app && !(arg in DIRS && app === "jobs")) { open(app, null, w.el); say(`opened ${esc(arg)}`, "t-dim"); break; }
      if (arg.replace(/\/$/, "") in DIRS) { open(arg.replace(/\/$/, "") === "inputs" ? "jobs" : arg.replace(/\/$/, ""), null); say(`opened ${esc(arg)}`, "t-dim"); break; }
      const nm = noteTermFind(w, arg); if (nm) { openNote(nm, w.el); say(`opened ${esc(nm)}`, "t-dim"); break; }
      const r = termFind(w, arg); if (!r) { say(`open: ${esc(arg)}: not found`, "t-err"); break; }
      defaultOpen(r, w.el); say(`opened ${esc(r.asset || r.taskId)}`, "t-dim"); break;
    }
    case "cat": case "type": case "info": {
      const nm = noteTermFind(w, arg);
      if (nm) {
        noteGet(nm).then(d => { t.lines.push(esc(d.text) || '<span class="t-dim">(empty)</span>'); termPaint(w); })
          .catch(err => { t.lines.push(`<span class="t-err">${cmd}: ${esc(err.message)}</span>`); termPaint(w); });
        break;
      }
      const r = termFind(w, arg); if (!r) { say(`${cmd}: ${esc(arg || "?")}: not found`, "t-err"); break; }
      say([["task", r.taskId], ["file", r.asset || "not saved yet"], ["type", r.type], ["model", r.model], ["settings", r.settings], ["status", statusInfo(r).label], ["credits", r.credits ?? (r.estimatedCredits != null ? "~" + r.estimatedCredits : "-")], ["created", r.createdAt || r.date], ["prompt", r.prompt]]
        .map(([k, v]) => `<b class="t-acc">${k.padEnd(9)}</b>${esc(v)}`).join("\n"));
      break;
    }
    case "ps": case "top": {
      const act = S.data.runs.filter(r => ACTIVE.has(r.status));
      if (!act.length) { say("nothing rendering", "t-dim"); break; }
      say(act.map(r => { const p = r.progress != null ? Math.round(r.progress * 100) : null; return `${fileLink({ ...r, asset: null })}  ${esc(r.model.padEnd(18))} ${p != null ? "[" + "#".repeat(Math.round(p / 5)).padEnd(20, ".") + `] ${p}%` : statusInfo(r).label}`; }).join("\n"));
      break;
    }
    case "cost": case "usage": {
      say(spendTerm());
      const days = Math.max(1, Math.min(90, parseInt(args[0], 10) || 30));
      say(`asking Runway for ${days} days of usage…`, "t-dim"); t.lines.push(...out.splice(0)); termPaint(w);
      usageLoad(days).then(u => {
        const sum = usageSummary(u, 99), mine = usageMine(days);
        t.lines.push(`<b class="t-acc">org, last ${days} days</b>: <span class="t-red">${fmt(sum.total)}</span> credits`,
          ...sum.ranked.slice(0, 15).map(([m, v]) => `  ${esc(m.padEnd(30))}${String(fmt(v)).padStart(10)}  ${sum.total ? String(Math.round(v / sum.total * 100)).padStart(3) : "  0"}%`),
          sum.ranked.length > 15 ? `  <span class="t-dim">… and ${sum.ranked.length - 15} more models</span>` : "",
          `<b class="t-acc">your jobs</b>: ${fmt(mine.reduce((s, [, v]) => s + v.credits, 0))} credits`,
          ...mine.map(([k, v]) => `  ${esc(k.padEnd(30))}${String(fmt(v.credits)).padStart(10)}  ${v.jobs} job${v.jobs === 1 ? "" : "s"}`),
          `<span class="t-dim">open the Usage window for the chart: open usage</span>`);
        termPaint(w);
      }).catch(err => { t.lines.push(`<span class="t-err">cost: ${esc(err.message)}</span>`); termPaint(w); });
      break;
    }
    case "balance": case "credits": say(S.data.balance == null ? "balance unknown" : `<span class="t-red">${fmt(S.data.balance)}</span> credits left`); say(spendTerm()); break;
    case "gen": case "generate": {
      const gw = open("generate", null, w.el);
      if (arg && S.CAT && gw.shell) { vals(gw).promptText = arg; genFields(gw); genRefresh(gw); save(); }
      say("opened Generate", "t-dim"); break;
    }
    case "finder": case "explorer": fileAction("reveal", "runs.json"); say("showing the Runway folder in Finder", "t-dim"); break;
    case "history": say(t.hist.map((h, i) => `${String(i + 1).padStart(4)}  ${esc(h)}`).join("\n")); break;
    case "bootlog": case "dmesg": {
      if (!bootLog.length) { say("no startup checks logged yet", "t-dim"); break; }
      const at = new Date(performance.timeOrigin).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });
      say(`page loaded ${esc(at)}, times in seconds since then`, "t-dim");
      say(bootLog.map(l => `<span class="t-dim">[${(l.ms / 1000).toFixed(3).padStart(8)}]</span> ${esc(l.text)}${l.res ? " " : ""}${l.bad ? `<span class="t-err">${esc(l.res)}</span>` : esc(l.res)}`).join("\n"));
      break;
    }
    case "clear": case "cls": t.lines = []; break;
    case "echo": say(esc(arg)); break;
    case "date": case "time": say(esc(new Date().toString())); break;
    case "whoami": say("you"); break;
    case "exit": close(w); return;
    case "reboot": case "restart": {
      const mode = args.includes("--all") ? "all" : args.includes("--clean") ? "clean" : "restart";
      say(mode === "all" ? "restarting, resetting the layout and every option…" : mode === "clean" ? "restarting with a clean desktop…" : "restarting…", "t-dim");
      t.lines.push(...out.splice(0)); termPaint(w);
      setTimeout(() => restart(mode), 400);
      return;
    }
    case "shutdown": shutdownDialog(); say("opened Shut down", "t-dim"); break;
    case "sudo": say("nice try.", "t-err"); break;
    default: say(`'${esc(cmd0)}' is not a command. Type help.`, "t-err");
  }
  t.lines.push(...out);
  termPaint(w);
}
export const termPrompt = t => `R:\\${t.cwd ? t.cwd.toUpperCase() : ""}> `;
export function termPaint(w) {
  const t = w.term, out = $(".t-out", w.body);
  if (t.lines.length > 600) t.lines.splice(0, t.lines.length - 600);
  out.innerHTML = t.lines.join("\n") + (t.lines.length ? "\n" : "");
  $(".t-prompt.t-cur", w.body).textContent = termPrompt(t);
  const scr = $(".term", w.body); scr.scrollTop = scr.scrollHeight;
  const title = KINDS.terminal.title(w);
  if ($(".tt", w.el).textContent !== title) { retitle(w); renderTasks(); }
}

export const termWelcome = t => t.lines.push(neofetch(), "", `<span class="t-dim">Type help for commands.</span>`);
// opened before the first poll: keep the prompt hidden until the data is in (8 s at most), so neofetch shows real numbers
export async function termWait(w) {
  const t = w.term, line = $(".t-line", w.body);
  line.hidden = true;
  const ok = await upTo(ready, 8000);
  if (wins.get(w.id) !== w) return;
  if (!ok) t.lines.push(`<span class="t-err">Runway API not reachable — balance unavailable</span>`, "");
  termWelcome(t); line.hidden = false; termPaint(w);
  if (frontWin() === w && S.bootDone) $(".t-in", w.body).focus();
}

export function termRender(w) {
  if (w.shell) return;
  w.shell = true;
  w.term ||= { cwd: null, lines: [], hist: [], hi: 0 };
  w.body.innerHTML = `<div class="term" data-keep="term"><pre class="t-out"></pre><label class="t-line"><span class="t-prompt t-cur"></span><input class="t-in" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Command"></label></div>`;
  const inp = $(".t-in", w.body), t = w.term;
  if (!t.lines.length) {
    if (S.loaded) termWelcome(t);
    else termWait(w);
  }
  termPaint(w);
  w.body.addEventListener("click", e => {
    const cd = e.target.closest("[data-cd]"); if (cd) { termRun(w, "cd " + cd.dataset.cd); inp.focus(); return; }
    if (!e.target.closest("a") && !getSelection().toString()) inp.focus();
  });
  inp.addEventListener("keydown", e => {
    if (e.key !== "Tab" && !["Shift", "Control", "Alt", "Meta"].includes(e.key)) t.tab = null; // any other key ends Tab cycling
    if (e.key === "Enter") { const v = inp.value; inp.value = ""; termRun(w, v); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      t.hi = clampN(t.hi + (e.key === "ArrowUp" ? -1 : 1), 0, t.hist.length);
      inp.value = t.hist[t.hi] || "";
    } else if (e.key === "Tab") {
      e.preventDefault();
      // several matches: Tab / Shift+Tab cycle through them, zsh style; the list prints once, on the first cycling Tab
      const c = t.tab;
      if (c) {
        if (!c.listed) { c.listed = true; t.lines.push(`<span class="t-prompt">${esc(termPrompt(t))}</span>${esc(inp.value)}`, c.hits.map(esc).join("  ")); termPaint(w); }
        c.i = c.i < 0 ? (e.shiftKey ? c.hits.length - 1 : 0) : (c.i + (e.shiftKey ? -1 : 1) + c.hits.length) % c.hits.length;
        inp.value = c.head + c.hits[c.i];
        return;
      }
      // complete the last word: a folder at the top level, or a file inside "folder/"
      const m = inp.value.match(/^(.*?)(\S*)$/), word = m[2], slash = word.lastIndexOf("/");
      const dirOnly = /^\s*(cd|chdir)\s/i.test(m[1]);
      let pre = "", stem = word, pool;
      if (slash >= 0) {
        const d = word.slice(0, slash).replace(/^\//, "").toLowerCase();
        pre = word.slice(0, slash + 1); stem = word.slice(slash + 1);
        pool = d in DIRS && !dirOnly ? termEntries(d).map(x => x.run?.asset || x.name) : [];
      } else if (!m[1].trim()) pool = TERM_HELP.flatMap(([c]) => c.split(/,\s*|\s+/)).filter(c => /^[a-z?]+$/.test(c));
      else pool = !t.cwd || dirOnly ? Object.keys(DIRS).map(d => d + "/") : termEntries(t.cwd).map(x => x.run?.asset || x.name);
      const hits = [...new Set(pool.filter(n => n && n.toLowerCase().startsWith(stem.toLowerCase())))];
      if (!hits.length) return;
      let common = hits[0];
      hits.forEach(h => { while (!h.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1); });
      if (hits.length === 1) { inp.value = m[1] + pre + hits[0] + (hits[0].endsWith("/") ? "" : " "); return; }
      t.tab = { head: m[1] + pre, hits, i: -1, word: stem, listed: false };
      // first Tab fills in the shared prefix; with nothing to add, it starts cycling right away
      if (common.length > stem.length) inp.value = m[1] + pre + common;
      else inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: e.shiftKey }));
    } else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); t.lines = []; termPaint(w); }
  });
  setTimeout(() => inp.focus(), 0);
}

export function init() {
  RENDER.terminal = w => termRender(w);
  SIG.terminal = () => "";
}
