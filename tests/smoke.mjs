// Runway OS smoke test driver: talks to a headless Chrome over the DevTools Protocol (Node's built-in
// WebSocket and fetch, no packages). Started by tests/smoke.sh, which owns the servers and Chrome.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2), arg = k => argv[argv.indexOf("--" + k) + 1];
const CDP_PORT = arg("cdp"), OUT = arg("out"), APP = readFileSync(arg("app"), "utf8");
const T0 = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- what to test, read from app.js so new windows and shortcuts are covered automatically ---------- */
function parseKinds(src) {
  const start = src.indexOf("const KINDS = {");
  if (start < 0) throw new Error("couldn't find `const KINDS = {` in app.js");
  let i = src.indexOf("{", start), depth = 0, end = i;
  for (; end < src.length; end++) { if (src[end] === "{") depth++; else if (src[end] === "}" && --depth === 0) break; }
  const body = src.slice(i + 1, end), kinds = [];
  // top-level keys sit at depth 0 of the object body
  depth = 0; let entryStart = 0, name = null;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === "{" || c === "(" || c === "[") { if (depth === 0 && c === "{") { const m = body.slice(entryStart, j).match(/(\w+)\s*:\s*$/); name = m && m[1]; entryStart = j; } depth++; }
    else if (c === "}" || c === ")" || c === "]") { depth--; if (depth === 0 && c === "}" && name) { kinds.push({ kind: name, needsArg: /\bw\.arg\b/.test(body.slice(entryStart, j)) }); name = null; entryStart = j + 1; } }
    else if (depth === 0 && c === ",") entryStart = j + 1;
  }
  return kinds;
}
const KINDS = parseKinds(APP);
const APP_KEYS = (() => { const m = APP.match(/const APP_KEYS = (\{[^}]*\})/); return m ? Function(`return ${m[1]}`)() : {}; })();
if (KINDS.length < 5) throw new Error("parsed only " + KINDS.length + " window kinds from app.js");

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
    if (/CONNECTION_RESET|EMPTY_RESPONSE|CONNECTION_CLOSED/.test(p.errorText) && /^GET$/.test(reqMethod.get(p.requestId) || "")) {
      // a dropped connection under load: fetch it again; only a second failure counts
      const tag = ctx();
      fetch(r).then(x => { if (!x.ok) failures.push(`${tag} request failed: ${r.replace(origin, "")} (${p.errorText}, then HTTP ${x.status})`); else warnings.push(`${tag} ${r.replace(origin, "")}: ${p.errorText} once, fine when fetched again`); })
        .catch(e => failures.push(`${tag} request failed: ${r.replace(origin, "")} (${p.errorText}, then ${e.message})`));
      return;
    }
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
  const targets = [...KINDS.filter(k => !k.needsArg).map(k => [k.kind]), ...jobs.flatMap(j => KINDS.filter(k => k.needsArg && (k.kind !== "viewer" || j.asset)).map(k => [k.kind, j.taskId]))];
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

  // report
  await sleep(300); // let any refetch of a dropped request finish
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nRunway OS smoke test — ${KINDS.length} window kinds (${KINDS.map(k => k.kind).join(", ")}); ${pick.length} sample jobs; screenshots in ${OUT}`);
  console.log(pad("sweep", 30) + pad("checked", 16) + pad("problems", 10) + "time");
  for (const r of table) console.log(pad(r.name, 30) + pad(`${r.opened}/${r.of} ${r.unit || "windows"}`, 16) + pad(r.errors, 10) + (r.ms / 1000).toFixed(1) + " s");
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
