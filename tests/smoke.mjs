// Runway OS smoke test driver: talks to a headless Chrome over the DevTools Protocol (Node's built-in
// WebSocket and fetch, no packages). Started by tests/smoke.sh, which owns the servers and Chrome.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const argv = process.argv.slice(2), arg = k => argv[argv.indexOf("--" + k) + 1];
const CDP_PORT = arg("cdp"), OUT = arg("out"), APP = readFileSync(arg("app"), "utf8");
const T0 = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- what to test, read from the app's source (--app) so new windows and shortcuts are covered automatically ---------- */
function parseKinds(src) {
  const start = src.indexOf("const KINDS = {");
  if (start < 0) throw new Error("couldn't find `const KINDS = {` in " + arg("app"));
  let i = src.indexOf("{", start), depth = 0, end = i;
  for (; end < src.length; end++) { if (src[end] === "{") depth++; else if (src[end] === "}" && --depth === 0) break; }
  const body = src.slice(i + 1, end), kinds = [];
  // top-level keys sit at depth 0 of the object body
  depth = 0; let entryStart = 0, name = null;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === "{" || c === "(" || c === "[") { if (depth === 0 && c === "{") { const m = body.slice(entryStart, j).match(/(\w+)\s*:\s*$/); name = m && m[1]; entryStart = j; } depth++; }
    else if (c === "}" || c === ")" || c === "]") { depth--; if (depth === 0 && c === "}" && name) { kinds.push({ kind: name, needsArg: /\bw\.arg\b|\barg: true\b/.test(body.slice(entryStart, j)) }); name = null; entryStart = j + 1; } }
    else if (depth === 0 && c === ",") entryStart = j + 1;
  }
  return kinds;
}
const KINDS = parseKinds(APP);
const APP_KEYS = (() => { const m = APP.match(/const APP_KEYS = (\{[^}]*\})/); return m ? Function(`return ${m[1]}`)() : {}; })();
if (KINDS.length < 5) throw new Error("parsed only " + KINDS.length + " window kinds from " + arg("app"));

const OPT_BASE = { fontV2: true, fontV3: true, sizeV4: true, sizeV5: true, motion: "system", sound: false, notify: false, balloons: true };
const CONFIGS = [
  // window animations run in the first sweep; the others use reduced motion to keep the run short
  ...["dark", "classic", "storm", "eggplant", "marine", "pumpkin"].map((t, i) => ({ name: t, opts: { theme: t, motion: i ? "reduce" : "system" } })),
  { name: "contrast", opts: { theme: "dark", contrast: true, motion: "reduce" } },
  { name: "large", opts: { theme: "classic", textPx: 24, motion: "reduce" }, large: true },
];
// requests the app makes knowingly and handles: no key → /api/usage says so; fresh folder → no model list
const EXPECTED = [
  { path: /^\/api\/usage/, status: [400] },
  { path: /^\/favicon\.ico$/, status: [404] }, // asked by Chrome for the plain page the test sets storage from
  { path: /^\/api\/models/, status: [503], pass: "fresh" },
];
// never let the page spend credits, change the key, or open Finder: these are blocked and fail the test
const FORBIDDEN = /\/api\/(generate|key|cancel|reveal|open|notes\/reveal)(\?|$)/;

/* ---------- CDP plumbing ---------- */
let ws, seq = 0;
const pending = new Map(), listeners = [];
async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = list.find(t => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(p.method + ": " + msg.error.message)) : p.res(msg.result); }
    else if (msg.method) [...listeners].forEach(l => l(msg.method, msg.params));
  };
}
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej, method }); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error("in-page: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function until(expr, ms = 5000, what = expr) {
  const end = Date.now() + ms;
  for (;;) { const v = await js(expr); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting for " + what); await sleep(40); }
}

/* ---------- failures, tagged with where we were ---------- */
let where = "startup", pass = "";
const failures = [], warnings = [], ctx = () => `[${pass} · ${where}]`;
const fail = msg => failures.push(`${ctx()} ${msg}`);
let origin = "";
listeners.push((m, p) => {
  if (m === "Runtime.exceptionThrown") {
    const d = p.exceptionDetails, e = d.exception;
    fail(`uncaught: ${(e?.description || e?.value || d.text || "").split("\n").slice(0, 3).join(" | ")}${d.url ? ` (${d.url.replace(origin, "")}:${d.lineNumber + 1})` : ""}`);
  } else if (m === "Runtime.consoleAPICalled" && p.type === "error") {
    fail("console.error: " + p.args.map(a => a.value ?? a.description ?? a.type).join(" ").slice(0, 300));
  } else if (m === "Log.entryAdded" && p.entry.level === "error" && p.entry.source !== "network") {
    fail(`${p.entry.source} error: ${p.entry.text.slice(0, 300)}`);
  } else if (m === "Network.responseReceived") {
    const u = new URL(p.response.url);
    if (u.origin !== origin || p.response.status < 400) return;
    const ok = EXPECTED.some(x => x.path.test(u.pathname) && x.status.includes(p.response.status) && (!x.pass || x.pass === pass));
    if (!ok) fail(`HTTP ${p.response.status} ${p.response.url.replace(origin, "")}`);
  } else if (m === "Network.loadingFailed") {
    if (p.canceled || p.errorText === "net::ERR_ABORTED" || p.blockedReason) return; // media loads cut short when a window closes
    const r = reqs.get(p.requestId);
    if (!r || !r.startsWith(origin) || FORBIDDEN.test(r)) return;
    // a reset or dropped connection is a failure too: the server has a deep listen backlog and drains early-error bodies
    fail(`request failed: ${r.replace(origin, "")} (${p.errorText})`);
  } else if (m === "Network.requestWillBeSent") {
    reqs.set(p.requestId, p.request.url); reqMethod.set(p.requestId, p.request.method);
  } else if (m === "Fetch.requestPaused") {
    fail(`page tried a forbidden request: ${p.request.method} ${p.request.url.replace(origin, "")} (blocked)`);
    send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {});
  }
});
const reqs = new Map(), reqMethod = new Map();

/* ---------- input ---------- */
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
async function key({ code, key: k, mods = [], vk = 0 }) {
  const modifiers = mods.reduce((s, m) => s | MOD[m], 0);
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}
async function mouse(x, y, button = "left") {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : button, clickCount: type === "mouseMoved" ? 0 : 1 });
}
async function clickSel(sel) {
  const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: "nearest" }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!r) throw new Error("no element " + sel);
  await mouse(r.x, r.y);
}

/* ---------- page helpers ---------- */
const settle = () => js(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
const animsDone = () => until(`document.getAnimations().every(a => a.playState !== "running") && !document.querySelector(".flycap") && ![...document.querySelectorAll(".window")].some(w => w.style.visibility === "hidden")`, 3000, "animations to finish");
const winSel = id => `.window[data-id=${JSON.stringify(id)}]`;

async function navigate(url) {
  const loaded = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timed out loading " + url)), 15000);
    const l = m => { if (m === "Page.loadEventFired") { clearTimeout(t); listeners.splice(listeners.indexOf(l), 1); res(); } };
    listeners.push(l);
  });
  await send("Page.navigate", { url });
  await loaded;
}
// set the saved options and window layout from a plain same-origin file (so the app never runs with the old ones), then load the app
async function load(url, opts, layout = "[]") {
  where = "load";
  await navigate(new URL("/README.md", url).href);
  await js(`(() => { localStorage.clear(); ${opts ? `localStorage.setItem("runway-os-options-v1", ${JSON.stringify(JSON.stringify(opts))});` : ""} ${layout != null ? `localStorage.setItem("runway-os-layout-v3", ${JSON.stringify(layout)});` : ""} })()`);
  await navigate(url);
  await until(`window.__rwosReady === true`, 10000, "the app's startup to finish (window.__rwosReady)");
}
async function boot() {
  where = "boot screen";
  await until(`!!document.querySelector(".boot .boot-act [data-start]")`, 12000, `the boot screen's "Start runway os" button`);
  const text = await js(`document.querySelector(".boot .boot-act [data-start]").textContent`);
  if (!/start runway os/i.test(text)) fail(`boot button reads "${text}"`);
  await clickSel(".boot .boot-act [data-start]:not([data-start=key])");
  await until(`!document.body.classList.contains("booting") && !document.querySelector(".boot")`, 5000, "the boot screen to close");
  await animsDone();
}
async function desktopSize() { return js(`(() => { const r = document.getElementById("desktop").getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top, vw: innerWidth, vh: innerHeight }; })()`); }

// opens a window by the app's own click path: its Start menu item when it has one, else a [data-open] button
async function openKind(kind, arg) {
  const viaStart = !arg && await js(`!!document.querySelector('#startmenu [data-launch=${JSON.stringify(kind)}]')`);
  let clicked = false;
  if (viaStart) {
    if (await js(`document.getElementById("startmenu").hidden`)) await clickSel("#start");
    const item = `#startmenu [data-launch=${JSON.stringify(kind)}]`;
    const onScreen = await js(`(() => { const e = document.querySelector(${JSON.stringify(item)}); e.scrollIntoView({ block: "nearest" }); const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth; })()`);
    if (onScreen) { await clickSel(item); clicked = true; }
    else { fail("its Start menu item is off screen, so it can't be clicked"); await key({ code: "Escape", key: "Escape", vk: 27 }); }
  }
  if (!clicked) {
    await js(`(() => { const b = document.createElement("button"); b.dataset.open = ${JSON.stringify(kind)}; ${arg ? `b.dataset.id = ${JSON.stringify(arg)};` : ""} b.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0"; document.getElementById("desktop").append(b); b.click(); b.remove(); })()`);
  }
  const id = arg ? `${kind}:${arg}` : kind;
  await until(`!!document.querySelector(${JSON.stringify(winSel(id))})`, 3000, `window ${id} to open`);
  await animsDone();
  return id;
}

// a window is OK when its body shows something and (at default scale) it fits on the desktop
async function checkWindow(id, large) {
  const sel = JSON.stringify(winSel(id));
  const filled = `(() => { const b = document.querySelector(${sel} + " .wbody"); if (!b) return false;
    return b.innerText.trim().length > 0 || !!b.querySelector("img, video, audio, canvas, svg, input, textarea, select, button"); })()`;
  try { await until(filled, 2500); } catch { fail("window body is empty"); }
  const g = await js(`(() => { const w = document.querySelector(${sel}), d = document.getElementById("desktop").getBoundingClientRect(), r = w.getBoundingClientRect();
    return { l: r.left - d.left, t: r.top - d.top, r: r.right - d.left, b: r.bottom - d.top, dw: d.width, dh: d.height, vw: innerWidth, vh: innerHeight }; })()`);
  if (!large && (g.r - g.l > g.vw + 1 || g.b - g.t > g.vh + 1)) fail(`window is ${Math.round(g.r - g.l)}x${Math.round(g.b - g.t)}, bigger than the ${g.vw}x${g.vh} viewport`);
  if (!large && (g.l < -1 || g.t < -1 || g.r > g.dw + 1 || g.b > g.dh + 1)) fail(`window runs off the desktop: ${Math.round(g.l)},${Math.round(g.t)} → ${Math.round(g.r)},${Math.round(g.b)} on ${g.dw}x${g.dh}`);
}

async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, name + ".png"), Buffer.from(data, "base64"));
}

async function checkStartMenu() {
  where = "Start menu";
  await clickSel("#start");
  await until(`!document.getElementById("startmenu").hidden`, 2000, "the Start menu to open");
  const m = await js(`(() => { const s = document.getElementById("startmenu"), r = s.getBoundingClientRect(); return { n: s.querySelectorAll("button").length, r: r.right, b: r.bottom, t: r.top, vw: innerWidth, vh: innerHeight }; })()`);
  if (m.n < 3) fail(`Start menu has ${m.n} items`);
  if (m.r > m.vw + 1 || m.b > m.vh + 1 || m.t < -1) fail(`Start menu runs off screen: top ${Math.round(m.t)}, bottom ${Math.round(m.b)}, right ${Math.round(m.r)} in a ${m.vw}x${m.vh} viewport`);
  await key({ code: "Escape", key: "Escape", vk: 27 });
  await until(`document.getElementById("startmenu").hidden`, 2000, "Esc to close the Start menu");
}
async function checkContextMenu(x, y, label) {
  where = `right-click menu (${label})`;
  await mouse(x, y, "right");
  await until(`!document.getElementById("ctxmenu").hidden`, 2000, "the right-click menu to open");
  const m = await js(`(() => { const s = document.getElementById("ctxmenu"), r = s.getBoundingClientRect(); return { n: s.querySelectorAll("button").length, r: r.right, b: r.bottom, l: r.left, t: r.top, vw: innerWidth, vh: innerHeight }; })()`);
  if (m.n < 1) fail("right-click menu is empty");
  if (m.r > m.vw + 1 || m.b > m.vh + 1 || m.l < -1 || m.t < -1) fail("right-click menu runs off screen");
  await key({ code: "Escape", key: "Escape", vk: 27 });
  await until(`document.getElementById("ctxmenu").hidden`, 2000, "Esc to close the right-click menu");
}

/* ---------- keyboard ---------- */
async function checkKeyboard(jobId) {
  where = "keyboard";
  // the app reads letters through the layout map (AZERTY here): find the physical key that types each letter
  const map = await js(`navigator.keyboard?.getLayoutMap ? navigator.keyboard.getLayoutMap().then(m => Object.fromEntries(m)).catch(() => null) : null`);
  const codeOf = l => { if (map) for (const [c, v] of Object.entries(map)) if (v === l) return c; return "Key" + l.toUpperCase(); };
  const VK = l => l.toUpperCase().charCodeAt(0);
  const closeAll = () => js(`(() => { document.querySelectorAll(".window [data-act=close]").forEach(b => b.click()); document.activeElement?.blur?.(); })()`);
  const front = () => js(`document.querySelector(".window.front")?.dataset.id || null`);
  const results = [];
  const expect = async (label, want, fn) => {
    where = `keyboard ${label}`;
    await fn();
    try { await until(`document.querySelector(".window.front")?.dataset.id === ${JSON.stringify(want)}`, 2000); results.push(label); }
    catch { fail(`${label} should bring up "${want}", front window is ${JSON.stringify(await front())}`); }
    await animsDone();
  };
  for (const [kind, combo] of Object.entries(APP_KEYS)) {
    if (!KINDS.some(k => k.kind === kind)) continue;
    await closeAll(); await animsDone();
    const shift = combo.startsWith("Shift+"), ch = combo.replace("Shift+", "");
    const mods = ["alt", ...(shift ? ["shift"] : [])];
    const ev = ch === "/" ? { code: "Slash", key: "/", vk: 191 } : { code: codeOf(ch.toLowerCase()), key: ch.toLowerCase(), vk: VK(ch) };
    await expect(`Alt+${combo}`, kind, () => key({ ...ev, mods }));
  }
  // Alt+W closes the front window
  where = "keyboard Alt+W";
  const before = await js(`document.querySelectorAll(".window").length`), was = await front();
  await js(`document.activeElement?.blur?.()`);
  await key({ code: codeOf("w"), key: "w", vk: 87, mods: ["alt"] });
  await animsDone();
  if (was && await js(`!!document.querySelector(${JSON.stringify(winSel(was))})`)) fail(`Alt+W didn't close "${was}" (${before} windows open)`);
  else results.push("Alt+W");
  // F1 → keyboard shortcuts
  await closeAll(); await animsDone();
  await expect("F1", "keys", () => key({ code: "F1", key: "F1", vk: 112 }));
  // Cmd+, → Options
  await closeAll(); await animsDone();
  await expect("Cmd+,", "options", () => key({ code: "Comma", key: ",", vk: 188, mods: ["meta"] }));
  // Cmd+I on a selected job → its Properties
  if (jobId) {
    await closeAll(); await animsDone();
    await openKind("jobs");
    where = "keyboard Cmd+I";
    await clickSel(`${winSel("jobs")} .row[data-id=${JSON.stringify(jobId)}]`);
    await expect("Cmd+I", `props:${jobId}`, () => key({ code: codeOf("i"), key: "i", vk: 73, mods: ["meta"] }));
  }
  // Ctrl+Esc → Start menu
  where = "keyboard Ctrl+Esc";
  await closeAll();
  await key({ code: "Escape", key: "Escape", vk: 27, mods: ["ctrl"] });
  try { await until(`!document.getElementById("startmenu").hidden`, 2000); results.push("Ctrl+Esc"); await key({ code: "Escape", key: "Escape", vk: 27 }); }
  catch { fail("Ctrl+Esc should open the Start menu"); }
  return { results, layout: map ? `${map.KeyQ || "?"}${map.KeyW || "?"}${map.KeyE || "?"}${map.KeyR || "?"}${map.KeyT || "?"}${map.KeyY || "?"}` : "no layout map (QWERTY codes)" };
}

/* ---------- one sweep: every window in one theme ---------- */
async function sweep(cfg, jobs) {
  const t = Date.now(), n0 = failures.length;
  await load(base, { ...OPT_BASE, ...cfg.opts, boot: true });
  await boot();
  where = "theme";
  const th = await js(`[document.documentElement.dataset.theme, document.documentElement.classList.contains("contrast")]`);
  if (th[0] !== (cfg.opts.theme || "dark") || th[1] !== !!cfg.opts.contrast) fail(`theme didn't apply: ${th}`);
  let opened = 0;
  // Compare takes several jobs at once (its arg is the ids joined by commas): open it once with all the sample jobs
  const multi = new Set(["compare"]);
  const targets = [...KINDS.filter(k => !k.needsArg).map(k => [k.kind]), ...jobs.flatMap(j => KINDS.filter(k => k.needsArg && !multi.has(k.kind) && (k.kind !== "viewer" || j.asset)).map(k => [k.kind, j.taskId])),
    ...(jobs.length > 1 ? KINDS.filter(k => multi.has(k.kind)).map(k => [k.kind, jobs.map(j => j.taskId).join(",")]) : [])];
  for (const [kind, a] of targets) {
    where = a ? `${kind}:${a.slice(0, 8)}` : kind;
    try { const id = await openKind(kind, a); await checkWindow(id, cfg.large); opened++; }
    catch (e) { fail(e.message); }
  }
  await settle();
  // the screenshot: every window side by side (Start → Tile windows), so each theme shows all of them
  where = "Start → Tile windows";
  await clickSel("#start"); await clickSel(`#startmenu [data-cmd="tile"]`); await animsDone(); await settle();
  where = "screenshot"; await shot(`${pass}-${cfg.name}`);
  await checkStartMenu();
  const d = await desktopSize();
  // desktop menu: right-click where no window is (minimize everything first)
  await js(`document.querySelectorAll(".window [data-act=min]").forEach(b => b.click())`); await animsDone();
  await checkContextMenu(d.left + d.w - 20, d.top + d.h - 20, "desktop");
  if (cfg.name === CONFIGS[0].name && jobs.length) { // a job's menu, from a row in Jobs
    await js(`document.querySelectorAll(".window").forEach(w => w.querySelector("[data-act=close]").click())`);
    await openKind("jobs");
    const r = await js(`(() => { const e = document.querySelector('${winSel("jobs")} .row[data-id]'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + 40, y: b.top + b.height / 2 }; })()`);
    if (r) await checkContextMenu(r.x, r.y, "job row"); else fail("Jobs shows no rows although runs.json has jobs");
  }
  return { name: cfg.name, opened, of: targets.length, errors: failures.length - n0, ms: Date.now() - t };
}

/* ---------- feature checks: one scenario each, written against what the user sees (text, roles, focus) ---------- */
const DATA_DIR = argv.includes("--data-dir") ? arg("data-dir") : null;
const FAKE = argv.includes("--fake") ? arg("fake") : null, FAKE_DIR = FAKE ? arg("fake-dir") : null;
const measures = []; // printed, not failing: numbers other work is meant to improve
const measure = (name, value, note = "") => measures.push({ name, value, note });
const warn = msg => warnings.push(`${ctx()} ${msg}`);
const ESC = { code: "Escape", key: "Escape", vk: 27 }, ENTER = { code: "Enter", key: "Enter", vk: 13 };
const ARROW = d => ({ code: "Arrow" + d, key: "Arrow" + d, vk: { Left: 37, Up: 38, Right: 39, Down: 40 }[d] });
const reqLog = []; // every request from the page during the feature checks: [url, resourceType]
listeners.push((m, p) => { if (m === "Network.requestWillBeSent") reqLog.push([p.request.url, p.type]); });
const reqsSince = (i, re, type) => reqLog.slice(i).filter(([u, t]) => re.test(new URL(u).pathname) && (!type || t === type)).length;

async function mouseMods(x, y, button = "left", modifiers = 0, clickCount = 1) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", modifiers });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount, modifiers });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount, modifiers });
}
async function typeSlow(text, gap) { for (const c of text) { await send("Input.insertText", { text: c }); if (gap) await sleep(gap); } }
// the centre of the first visible element matching sel (inside scope) whose text is `text` (or matches it, for a RegExp)
function findExpr(sel, text, scope = "document") {
  const t = text instanceof RegExp ? `(s => ${text}.test(s))` : `(s => s === ${JSON.stringify(text)})`;
  return `(() => { const root = ${scope}; if (!root) return null; const e = [...root.querySelectorAll(${JSON.stringify(sel)})].find(e => e.getClientRects().length && ${t}(e.textContent.replace(/\\s+/g, " ").trim()));
    if (!e) return null; e.scrollIntoView({ block: "nearest" }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`;
}
const inWin = id => `document.querySelector(${JSON.stringify(winSel(id))})`;
async function clickText(sel, text, scope, button = "left") {
  const r = await js(findExpr(sel, text, scope));
  if (!r) throw new Error(`no visible ${sel} reading "${text}"`);
  await mouseMods(r.x, r.y, button);
}
async function centerOf(expr) {
  const r = await js(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: "nearest" }); const b = e.getBoundingClientRect(); return { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2 }; })()`);
  if (!r) throw new Error("not on screen: " + expr);
  return r;
}
const menuOpen = () => js(`!document.getElementById("ctxmenu").hidden`);
// a menu item's label, without its shortcut (kbd) or note (small)
const menuLabels = () => js(`[...document.querySelectorAll("#ctxmenu [role=menuitem]")].map(b => [...b.childNodes].filter(n => !/^(KBD|SMALL)$/.test(n.nodeName)).map(n => n.textContent).join("").replace(/\\s+/g, " ").trim())`);
const modal = `document.querySelector('[aria-modal="true"]:is([role=dialog],[role=alertdialog])')`;
const frontId = () => js(`document.querySelector(".window.front")?.dataset.id || null`);
const winIds = () => js(`[...document.querySelectorAll(".window")].map(w => w.dataset.id).sort()`);
async function startApp(url, opts = {}, layout = "[]") {
  await load(url, { ...OPT_BASE, theme: "dark", motion: "reduce", boot: false, ...opts }, layout);
  await until(`!document.body.classList.contains("booting")`, 5000, "startup without the boot screen");
  await animsDone();
  where = curCheck;
}
const checks = [];
let curCheck = "";
async function check(name, fn) {
  const t = Date.now(), n0 = failures.length;
  where = curCheck = name;
  try { await fn(); } catch (e) { fail(e.message); }
  // never leave a menu or dialog open for the next check
  await js(`document.querySelectorAll('[aria-modal="true"]').forEach(d => d.closest(".shutdown")?.remove())`).catch(() => {});
  checks.push({ name, errors: failures.length - n0, ms: Date.now() - t });
}
function appendRun(dir, run) {
  const p = join(dir, "runs.json"), d = JSON.parse(readFileSync(p, "utf8"));
  d.runs.push(run);
  writeFileSync(p + ".smoke.tmp", JSON.stringify(d, null, 2));
  renameSync(p + ".smoke.tmp", p);
}
const pollNow = () => js(`document.dispatchEvent(new Event("visibilitychange"))`); // the app polls /api/state right away when the tab shows

async function featureChecks(runs) {
  pass = "data"; base = arg("data"); origin = new URL(base).origin;
  const images = runs.filter(r => r.type === "image" && r.asset);

  await check("live update", async () => {
    if (!DATA_DIR || !images.length) { warn("skipped: no image jobs in the data"); return; }
    await startApp(base);
    for (const k of ["jobs", "images", "tree"]) await openKind(k);
    const SEL = { jobs: "[role=row][data-id]", images: "[role=option][data-id]", tree: "[role=treeitem][data-id]" };
    const before = await js(`(() => { window.__smokeTag = []; const n = {};
      for (const [w, sel] of Object.entries(${JSON.stringify(SEL)})) { const els = [...document.querySelectorAll('.window[data-id="' + w + '"] ' + sel)]; els.forEach(e => { e.__smoke = e.dataset.id; __smokeTag.push(e); }); n[w] = els.length; }
      const imgs = [...document.querySelectorAll(".window img")]; imgs.forEach(i => { i.__smoke = i.getAttribute("src"); __smokeTag.push(i); }); n.img = imgs.length; return n; })()`);
    const src = images[0], id = randomUUID(), now = new Date();
    const r0 = reqLog.length;
    appendRun(DATA_DIR, { taskId: id, date: now.toISOString().slice(0, 10), createdAt: now.toISOString(), finishedAt: now.toISOString(), type: "image", model: src.model,
      endpoint: src.endpoint, prompt: "smoke test: live update", settings: src.settings, status: "succeeded", parent: src.taskId, synced: true, asset: src.asset, credits: src.credits ?? 0 });
    await pollNow();
    for (const [w, sel] of Object.entries(SEL))
      try { await until(`!!document.querySelector('.window[data-id="${w}"] ${sel.replace("[data-id]", `[data-id="${id}"]`)}')`, 12000); }
      catch { fail(`the new job ${id.slice(0, 8)} didn't show up in ${w} after runs.json changed`); }
    await sleep(400);
    const after = await js(`(() => { const t = __smokeTag, rows = t.filter(e => e.tagName !== "IMG"), imgs = t.filter(e => e.tagName === "IMG");
      return { rows: rows.length, rowsKept: rows.filter(e => e.isConnected && e.dataset.id === e.__smoke).length, imgs: imgs.length, imgsKept: imgs.filter(e => e.isConnected && e.getAttribute("src") === e.__smoke).length }; })()`);
    const imgReqs = reqsSince(r0, /./, "Image");
    measure("live update: rows/tiles/tree nodes kept", `${after.rowsKept}/${after.rows}`, `(jobs ${before.jobs}, images ${before.images}, tree ${before.tree}; same node, same item)`);
    measure("live update: <img> kept", `${after.imgsKept}/${after.imgs}`);
    measure("live update: image requests", imgReqs, "(one new job that reuses an existing file)");
    // the keyed morph keeps every existing row and picture when one job is added above them
    if (after.rows && after.rowsKept < 0.9 * after.rows) fail(`one new job replaced ${after.rows - after.rowsKept} of ${after.rows} existing rows/tiles/tree nodes (morph should keep 90% or more)`);
    if (after.imgs && after.imgsKept < 0.9 * after.imgs) fail(`one new job reloaded ${after.imgs - after.imgsKept} of ${after.imgs} existing thumbnails (morph should keep 90% or more)`);
  });

  await check("budget", async () => {
    await startApp(base);
    for (const { kind } of KINDS.filter(k => !k.needsArg)) await openKind(kind);
    await sleep(300);
    const b = await js(`({ rects: document.querySelectorAll("svg rect").length, nodes: document.getElementsByTagName("*").length, lt: (window.__smokeLong || []).filter(d => d > 200) })`);
    measure("SVG rects, all windows open", b.rects, `(${b.nodes} elements in all)`);
    measure("long tasks > 200 ms, load + opening every window", b.lt.length, b.lt.length ? `(longest ${Math.round(Math.max(...b.lt))} ms)` : "");
    if (b.rects > 2000) warn(`${b.rects} SVG rects with every window open (budget 2000)`);
    if (b.lt.length) warn(`${b.lt.length} long task${b.lt.length === 1 ? "" : "s"} over 200 ms, longest ${Math.round(Math.max(...b.lt))} ms`);
  });

  await check("right-click menus", async () => {
    await startApp(base);
    await openKind("jobs");
    const want = async (what, labels, absent = []) => {
      await until(`!document.getElementById("ctxmenu").hidden`, 2000, `the right-click menu on ${what}`);
      const got = await menuLabels();
      for (const l of labels) if (!got.includes(l)) fail(`the menu on ${what} has no "${l}" (it has: ${got.join(", ")})`);
      for (const l of absent) if (got.includes(l)) fail(`the menu on ${what} offers "${l}"`);
      await key(ESC); await until(`document.getElementById("ctxmenu").hidden`, 2000, "Esc to close the menu");
    };
    let p = await centerOf(`${inWin("jobs")}.querySelector('input[type=search]')`);
    await mouseMods(p.x, p.y, "right"); await want("the Jobs search field", ["Cut", "Copy", "Paste"]);
    await openKind("terminal");
    p = await centerOf(`${inWin("terminal")}.querySelector(".wbody")`);
    await mouseMods(p.x, p.y, "right"); await want("the Terminal", ["Clear screen"]);
    if (images.length) {
      await openKind("images");
      p = await centerOf(`${inWin("images")}.querySelector("[role=option]")`);
      await mouseMods(p.x, p.y, "right"); await want("an image tile", ["Animate into video…", "Properties"], ["Cancel job"]);
    }
  });

  await check("notes", async () => {
    if (!DATA_DIR) return;
    const dir = join(DATA_DIR, "notes"), files = () => (existsSync(dir) ? readdirSync(dir) : []);
    const had = new Set(files());
    await startApp(base);
    await openKind("notes");
    const W = inWin("notes");
    await until(findExpr("button", "New", W), 4000, `the Notes "New" button`);
    await clickText("button", "New", W);
    let name;
    for (const end = Date.now() + 4000; !name && Date.now() < end; await sleep(50)) name = files().find(f => !had.has(f));
    if (!name) throw new Error("New didn't create a file in notes/");
    await until(`document.activeElement?.tagName === "TEXTAREA" && !!document.activeElement.closest(${JSON.stringify(winSel("notes"))})`, 3000, "the cursor in the new note");
    const text = Array.from({ length: 200 }, (_, i) => "abcdefghij klmnopqrst"[i % 21]).join("");
    await send("Input.insertText", { text: text.slice(0, 100) }); await send("Input.insertText", { text: text.slice(100) });
    try { await until(`${W}.querySelector(".statusbar").textContent.includes("Saved")`, 4000); } catch { fail(`the status bar never said "Saved" after typing`); }
    if (readFileSync(join(dir, name), "utf8") !== text) fail(`notes/${name} doesn't hold the 200 typed characters`);
    // rename through its dialog, by Enter
    const to = `smoke-${randomUUID().slice(0, 8)}.txt`;
    await clickText("button", "Rename…", W);
    await until(`!!${modal}?.querySelector("input")`, 2000, "the Rename dialog");
    await js(`${modal}.querySelector("input").select()`);
    await send("Input.insertText", { text: to });
    await key(ENTER);
    await until(`!${modal}`, 3000, "Enter to close the Rename dialog");
    if (!existsSync(join(dir, to)) || existsSync(join(dir, name))) fail(`Rename didn't move notes/${name} to notes/${to}`);
    // delete: Esc keeps the file, Enter deletes it
    await clickText("button", "Delete", W);
    await until(`!!${modal}`, 2000, "the Delete dialog");
    await key(ESC);
    await until(`!${modal}`, 2000, "Esc to close the Delete dialog");
    if (!existsSync(join(dir, to))) fail("Esc in the Delete dialog deleted the note");
    await clickText("button", "Delete", W);
    await until(`!!${modal}`, 2000, "the Delete dialog");
    await key(ENTER);
    await until(`!${modal}`, 3000, "Enter to close the Delete dialog");
    for (const end = Date.now() + 2000; existsSync(join(dir, to)) && Date.now() < end;) await sleep(50);
    if (existsSync(join(dir, to))) fail("Enter in the Delete dialog didn't delete the note");
    if (await js(`${W}.innerText.includes(${JSON.stringify(to)})`)) fail("the deleted note is still in the Notes list");
  });

  await check("Shut down dialog", async () => {
    await startApp(base);
    await clickSel("#start");
    await until(`!document.getElementById("startmenu").hidden`, 2000, "the Start menu");
    await clickText("#startmenu [role=menuitem]", "Shut down…");
    await until(`!!${modal}`, 2000, "the Shut down dialog");
    await key(ESC);
    await until(`!${modal}`, 2000, "Esc to close the Shut down dialog");
    const f = await js(`document.activeElement?.id === "start" ? null : (document.activeElement?.outerHTML || "nothing").slice(0, 80)`);
    if (f) fail(`after Esc, focus should be back on the Start button, it's on ${f}`);
  });

  await check("persistence", async () => {
    await startApp(base);
    for (const k of ["jobs", "images", "notes", "terminal"]) await openKind(k);
    if (images[0]) await openKind("props", images[0].taskId);
    await sleep(400); // the layout is saved shortly after a change
    const was = await winIds();
    await navigate(base);
    await until(`window.__rwosReady === true && !document.body.classList.contains("booting")`, 10000, "the app to start again after reload");
    await animsDone();
    const now = await winIds();
    if (JSON.stringify(now) !== JSON.stringify(was)) fail(`after a reload the open windows are [${now}], before they were [${was}]`);
  });

  await check("viewer and list keys", async () => {
    if (images.length < 2) { warn("skipped: fewer than two images"); return; }
    await startApp(base);
    const id = await openKind("viewer", images[0].taskId);
    await key(ESC);
    await until(`!document.querySelector(${JSON.stringify(winSel(id))})`, 2000, "Esc to close the viewer");
    await openKind("viewer", images[0].taskId);
    const older = await js(`!${inWin(id)}.querySelector('button[title^="Older"]')?.disabled`);
    await key(ARROW(older ? "Right" : "Left"));
    try { await until(`(document.querySelector(".window.front")?.dataset.id || "").startsWith("viewer:") && document.querySelector(".window.front").dataset.id !== ${JSON.stringify(id)}`, 2000); }
    catch { fail(`${older ? "→" : "←"} in the viewer didn't step to another file (front window: ${await frontId()})`); }
    // Jobs: arrow keys move the selection
    await openKind("jobs");
    const sel = () => js(`${inWin("jobs")}.querySelector('[role=row][aria-selected="true"]')?.dataset.id || null`);
    const rows = await js(`[...${inWin("jobs")}.querySelectorAll("[role=row][data-id]")].map(r => r.dataset.id)`);
    const p = await centerOf(`${inWin("jobs")}.querySelector("[role=row][data-id]")`);
    await mouseMods(p.x, p.y);
    if (await sel() !== rows[0]) fail("clicking the first row in Jobs didn't select it");
    await key(ARROW("Down"));
    if (await sel() !== rows[1]) fail(`↓ in Jobs should select the second row, selected: ${await sel()}`);
    await key(ARROW("Up"));
    if (await sel() !== rows[0]) fail(`↑ in Jobs should select the first row again, selected: ${await sel()}`);
  });

  await check("compare", async () => {
    if (images.length < 2) { warn("skipped: fewer than two images"); return; }
    await startApp(base);
    await openKind("images");
    const tiles = `${inWin("images")}.querySelectorAll("[role=option]")`;
    const a = await centerOf(`${tiles}[0]`), b = await centerOf(`${tiles}[1]`);
    await mouseMods(a.x, a.y);
    await mouseMods(b.x, b.y, "left", MOD.meta);
    const n = await js(`${inWin("images")}.querySelectorAll('[role=option][aria-selected="true"]').length`);
    if (n !== 2) fail(`Cmd+click should select two images, ${n} selected`);
    await key({ code: "KeyC", key: "c", vk: 67, mods: ["alt"] });
    try { await until(`(document.querySelector(".window.front")?.dataset.id || "").startsWith("compare:")`, 3000); }
    catch { await clickText("button", /^Compare/, inWin("images")); await until(`(document.querySelector(".window.front")?.dataset.id || "").startsWith("compare:")`, 3000, "Compare to open"); fail("Alt+C didn't open Compare (the button did)"); }
    await animsDone();
    const cw = `document.querySelector(".window.front")`;
    await clickText("button", "Wipe", cw);
    await until(`!!${cw}.querySelector("[role=slider]")`, 3000, "the wipe divider");
    await sleep(200);
    const val = () => js(`+${cw}.querySelector("[role=slider]").getAttribute("aria-valuenow")`);
    const v0 = await val();
    await js(`${cw}.querySelector("[role=slider]").focus()`);
    await key(ARROW(v0 > 50 ? "Left" : "Right")); await key(ARROW(v0 > 50 ? "Left" : "Right"));
    const v1 = await val();
    if (v1 === v0) fail(`arrow keys didn't move the wipe divider (stays at ${v0})`);
    const box = await js(`(() => { const b = ${cw}.querySelector("[role=slider]").parentElement.getBoundingClientRect(); return { l: b.left, w: b.width, y: b.top + b.height / 2 }; })()`);
    const x0 = box.l + box.w * v1 / 100, x1 = box.l + box.w * 0.2;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: box.y, button: "none" });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y: box.y, button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 5; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + (x1 - x0) * i / 5, y: box.y, button: "left", buttons: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y: box.y, button: "left", buttons: 0, clickCount: 1 });
    const v2 = await val();
    if (Math.abs(v2 - 20) > 3) fail(`dragging the wipe divider to 20% left it at ${v2}%`);
  });

  if (!FAKE) return;
  /* against the fake Runway: a "live" server, so Generate prices jobs and the spend guard runs */
  pass = "fake"; base = FAKE; origin = new URL(base).origin;
  const fakeRuns = (await (await fetch(new URL("/api/state", base))).json()).runs;
  const dl = fakeRuns[0];

  await check("Generate: price requests and the spend guard", async () => {
    await startApp(base, { dailyLimit: 1 });
    await openKind("generate");
    const G = inWin("generate");
    await until(`!!${G}.querySelector("textarea")`, 8000, "Generate's form");
    await clickText("button", "Video", G);
    await js(`(() => { const s = [...${G}.querySelectorAll("select")].find(s => s.labels?.[0]?.textContent.trim() === "Task"); const o = [...s.options].find(o => /^Text to video/.test(o.textContent)); s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await until(`${G}.querySelector("textarea")?.getAttribute("aria-label") === "Prompt" || !!${G}.querySelector("textarea")`, 2000);
    const ta = await centerOf(`${G}.querySelector("textarea")`);
    await mouseMods(ta.x, ta.y);
    await sleep(600); // let the price for the empty form settle
    const r0 = reqLog.length;
    await typeSlow("a red fox runs across fresh snow", 30);
    await sleep(800);
    const n = reqsSince(r0, /^\/api\/price$/);
    measure("/api/price requests, 30 chars typed 30 ms apart", n);
    if (n > 5) warn(`${n} /api/price requests while typing 30 characters (aim: 2 or fewer)`);
    await until(`/Generate · /.test(${G}.querySelector("button[type=submit]")?.textContent || "")`, 4000, "the price on the Generate button");
    // dailyLimit 1: Generate asks first, Esc and Cancel both stop it, and nothing is sent
    const g0 = reqLog.length;
    for (const how of ["Esc", "Cancel"]) {
      await clickText("button", /^Generate · /, G);
      await until(`!!${modal}`, 3000, `the daily-limit dialog (${how})`);
      const t = await js(`${modal}.textContent`);
      if (!/limit/i.test(t)) fail(`the dialog doesn't mention the limit: ${t.slice(0, 120)}`);
      if (how === "Esc") await key(ESC); else await clickText("button", "Cancel", modal);
      await until(`!${modal}`, 2000, `${how} to close the daily-limit dialog`);
    }
    await sleep(200);
    if (reqsSince(g0, /^\/api\/generate/)) fail("a job was sent to /api/generate although the limit dialog was cancelled");
  });

  await check("job whose file is downloading", async () => {
    if (!dl) throw new Error("the fake server has no job");
    await startApp(base, {}, JSON.stringify([]));
    await openKind("jobs");
    const row = `${inWin("jobs")}.querySelector('[role=row][data-id="${dl.taskId}"]')`;
    try { await until(`${row}?.textContent.includes("Saving file…")`, 8000); }
    catch { throw new Error(`Jobs should say "Saving file…" for a job that succeeded on Runway while its file downloads; it says "${await js(`${row}?.querySelector("[role=gridcell]:nth-child(4)")?.textContent`)}"`); }
    const p = await centerOf(row);
    await mouseMods(p.x, p.y, "right");
    await until(`!document.getElementById("ctxmenu").hidden`, 2000, "the job's menu");
    if ((await menuLabels()).includes("Cancel job")) fail(`the job menu offers "Cancel job" while the file downloads`);
    await key(ESC);
    await openKind("props", dl.taskId);
    const P = inWin(`props:${dl.taskId}`);
    await until(`${P}.textContent.includes("Saving file…")`, 3000, `"Saving file…" in Properties`);
    if (await js(findExpr("button", "Cancel job", P))) fail(`Properties offers "Cancel job" while the file downloads`);
    await openKind("activity");
    const A = inWin("activity");
    await until(`${A}.textContent.includes("Saving file…")`, 3000, `"Saving file…" in Activity`);
    if (await js(findExpr("button", "Cancel", A))) fail(`Activity offers "Cancel" while the file downloads`);
    // the server refuses a cancel too (asked directly, not from the page)
    const res = await fetch(new URL("/api/cancel", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: dl.taskId }) });
    if (res.status !== 400) fail(`POST /api/cancel for a downloading job gave ${res.status}, not 400`);
    const flog = existsSync(join(FAKE_DIR, "fake.log")) ? readFileSync(join(FAKE_DIR, "fake.log"), "utf8") : "";
    if (/^DELETE /m.test(flog)) fail("the server tried to cancel the task on Runway");
    if (!/^DOWNLOAD /m.test(flog)) fail("the fake download never started");
    // let the download finish: the job turns Done, its file shows in Images, Cancel stays gone
    writeFileSync(join(FAKE_DIR, ".release-download"), "");
    await openKind("images");
    await pollNow();
    try { await until(`${row}?.textContent.includes("Done") && !!${inWin("images")}.querySelector('[role=option][data-id="${dl.taskId}"]')`, 10000); }
    catch { fail(`after the download the job should be Done and in Images; Jobs says "${await js(`${row}?.textContent.replace(/\\s+/g, " ").trim().slice(0, 120)`)}"`); }
  });
}

/* ---------- main ---------- */
let base = "";
const table = [];
async function main() {
  await connect();
  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: false });
  await send("Fetch.enable", { patterns: ["generate", "key", "cancel", "reveal", "open", "notes/reveal"].map(a => ({ urlPattern: `*/api/${a}*`, requestStage: "Request" })) });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  // long tasks on every page, for the budget check
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__smokeLong = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__smokeLong.push(e.duration))).observe({ type: "longtask", buffered: true }); } catch {}` });

  // pass 1: fresh folder, first launch (no saved layout, no key): the app opens Terminal and the key window
  pass = "fresh"; base = arg("fresh"); origin = new URL(base).origin;
  {
    const t = Date.now(), n0 = failures.length;
    await load(base, null, null);
    await boot();
    where = "first launch";
    try { await until(`!!document.querySelector('${winSel("terminal")}') && !!document.querySelector('${winSel("key")}')`, 4000); }
    catch { fail("first launch without a key should open Terminal and the API key window"); }
    await animsDone();
    await shot("fresh-first-launch");
    let opened = 0;
    for (const { kind } of KINDS.filter(k => !k.needsArg)) {
      where = kind;
      try { await checkWindow(await openKind(kind), false); opened++; } catch (e) { fail(e.message); }
    }
    await shot("fresh-all-windows");
    await checkStartMenu();
    table.push({ name: "fresh (no data)", opened, of: KINDS.filter(k => !k.needsArg).length, errors: failures.length - n0, ms: Date.now() - t });
  }

  // pass 2: your data, every theme
  pass = "data"; base = arg("data"); origin = new URL(base).origin;
  const state = await (await fetch(new URL("/api/state", base))).json();
  const runs = state.runs || [];
  const pick = [];
  for (const type of ["image", "video", "audio"]) { const r = runs.find(r => r.asset && r.type === type); if (r) pick.push(r); }
  const noAsset = runs.find(r => !r.asset); if (noAsset) pick.push(noAsset);
  for (const cfg of CONFIGS) { pass = "data"; table.push(await sweep(cfg, pick)); }
  pass = "data";
  {
    const t = Date.now(), n0 = failures.length;
    await load(base, { ...OPT_BASE, theme: "dark", boot: false });
    await until(`!document.body.classList.contains("booting")`, 5000);
    const kb = await checkKeyboard(runs[0]?.taskId);
    table.push({ name: `keyboard (${kb.layout})`, opened: kb.results.length, of: kb.results.length + failures.length - n0, errors: failures.length - n0, ms: Date.now() - t, unit: "keys" });
  }

  await featureChecks(runs);

  // report
  await sleep(300); // let any refetch of a dropped request finish
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nRunway OS smoke test — ${KINDS.length} window kinds (${KINDS.map(k => k.kind).join(", ")}); ${pick.length} sample jobs; screenshots in ${OUT}`);
  console.log(pad("sweep", 30) + pad("checked", 16) + pad("problems", 10) + "time");
  for (const r of table) console.log(pad(r.name, 30) + pad(`${r.opened}/${r.of} ${r.unit || "windows"}`, 16) + pad(r.errors, 10) + (r.ms / 1000).toFixed(1) + " s");
  if (checks.length) {
    console.log("\n" + pad("feature check", 46) + pad("problems", 10) + "time");
    for (const c of checks) console.log(pad(c.name, 46) + pad(c.errors, 10) + (c.ms / 1000).toFixed(1) + " s");
  }
  if (measures.length) {
    console.log("\nmeasured (reported, not failing):");
    for (const m of measures) console.log("  " + pad(m.name, 52) + pad(m.value, 8) + m.note);
  }
  console.log(`total ${((Date.now() - T0) / 1000).toFixed(1)} s`);
  if (warnings.length) { console.log(`\nwarnings (not failures):`); warnings.forEach(w => console.log("  " + w)); }
  if (failures.length) {
    console.log(`\nFAIL: ${failures.length} problem${failures.length === 1 ? "" : "s"}`);
    [...new Set(failures)].forEach(f => console.log("  " + f));
    process.exit(1);
  }
  console.log("\nPASS");
  process.exit(0);
}
main().catch(e => { console.error(`smoke: ${ctx()} ${e.stack || e}`); if (failures.length) console.error(failures.join("\n")); process.exit(1); });
