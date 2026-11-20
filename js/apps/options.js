import { S, wins } from "../core/state.js";
import { $, $$, esc, reduced } from "../core/dom.js";
import { RENDER } from "../wm/kinds.js";
import { sheetHTML, sheetKeys } from "../wm/sheet.js";
import { fit, place, renderWin } from "../wm/windows.js";
import { layoutIcons } from "../desktop/icons.js";
import { spendPanel } from "./spend.js";
import { tick } from "../live.js";

/* ---------- options: accessibility and preferences, saved in this browser ---------- */
export const OPT_KEY = "runway-os-options-v1";
export const OPT_DEFAULT = { textPx: 0, textSize: "medium", font: "plex", contrast: false, motion: "system", theme: "dark", desk: "", boot: true, clock24: false, termScheme: "dos", balloons: true, sound: false, notify: false };
// color schemes, like Win95's Display Properties → Appearance; the tokens live in index.html (html[data-theme])
export const THEMES = [["dark", "Dark"], ["classic", "Classic"], ["storm", "Storm"], ["eggplant", "Eggplant"], ["marine", "Marine"], ["pumpkin", "Pumpkin"]];
export const DESKS = [["#0b2e2e", "Teal night"], ["#008080", "Classic teal"], ["#000000", "Black"], ["#10204a", "Navy"], ["#3a1f3d", "Plum"], ["#2b2b2b", "Graphite"]];
export const TERMS = [["dos", "DOS gray"], ["green", "Green phosphor"], ["amber", "Amber"], ["blue", "Blue screen"]];
export const calm = () => S.opts.motion === "reduce" || (S.opts.motion === "system" && reduced.matches);

// text sizes that land on whole screen pixels for the pixel font (11 px design size)
export function textSizes() {
  const dpr = Math.max(1, Math.round(devicePixelRatio || 1)), steps = dpr >= 2 ? [2, 3, 4] : [1, 2, 3];
  return { small: (11 * steps[0]) / dpr, medium: (11 * steps[1]) / dpr, large: (11 * steps[2]) / dpr, dpr };
}
// the Scale slider for the current font and screen. def is the size applyOptions uses when no size is saved, marked "Medium".
// The outline fonts start at 12 px; the pixel font keeps its sharp sizes, whole multiples of 11 screen pixels.
export function tszRange() {
  const hi = textSizes().dpr >= 2;
  if (S.opts.font === "pixel") { const def = hi ? 16.5 : 11; return { min: 10, max: 24, def, marks: hi ? [[11, "Small"], [def, "Medium"], [22, "Large"]] : [[def, "Medium"], [22, "Large"]] }; }
  const def = hi ? 16 : 14;
  return { min: 12, max: 24, def, marks: [[13, "Small"], [def, "Medium"], [18, "Large"], [22, "Larger"]] };
}
export function applyOptions() {
  const root = document.documentElement, ts = textSizes(), pixel = S.opts.font === "pixel";
  // on a 1x screen the "medium" pixel size is 22 px, which is too big: keep 11 px unless Large is picked
  let fs = +S.opts.textPx || 0;
  if (!fs) {
    fs = ts[S.opts.textSize] ?? ts.medium;
    if (ts.dpr < 2 && S.opts.textSize === "medium") fs = pixel ? 11 : 13;
    if (!pixel) fs = (ts.dpr >= 2 ? { small: 14, medium: 16, large: 19 } : { small: 12, medium: 14, large: 17 })[S.opts.textSize] || (ts.dpr >= 2 ? 16 : 14);
  }
  // one factor sizes the whole interface: text, bars, buttons, icons, spacing and window geometry
  const was = S.scale;
  S.scale = fs / 11;
  root.style.setProperty("--scale", String(S.scale));
  root.style.setProperty("--fs", fs + "px");
  root.style.setProperty("--fs2", (pixel ? fs * 2 : Math.round(fs * 1.7)) + "px");
  root.style.setProperty("--fsL", (pixel ? Math.max(22, fs) : Math.round(fs * 1.35)) + "px");
  if (S.opts.contrast) root.style.setProperty("--desk", "#000000");
  else if (S.opts.desk) root.style.setProperty("--desk", S.opts.desk);
  else root.style.removeProperty("--desk"); // the theme's own desktop color
  root.dataset.theme = THEMES.some(([k]) => k === S.opts.theme) ? S.opts.theme : "dark";
  root.classList.toggle("smooth", !pixel);
  root.classList.toggle("hyper", S.opts.font === "hyper");
  root.classList.toggle("plex", S.opts.font === "plex");
  root.classList.toggle("dot", S.opts.font === "dot");
  root.classList.toggle("contrast", !!S.opts.contrast);
  root.classList.toggle("calm", calm());
  requestAnimationFrame(() => layoutIcons()); // icon sizes follow Scale
  root.dataset.term = S.opts.termScheme;
  // scale open windows along with the interface, then keep them on screen
  if (was !== S.scale) wins.forEach(w => {
    const k = S.scale / was, sc = g => g && Object.assign(g, { x: Math.round(g.x * k), y: Math.round(g.y * k), wd: Math.round(g.wd * k), ht: Math.round(g.ht * k) });
    sc(w); sc(w.pre); if (w.minW) w.minW = Math.round(w.minW * k);
    fit(w); place(w);
    if (w.kind === "tree") renderWin(w); // the tree is laid out in pixels
  });
  tick();
}
export function setOpt(k, v) {
  // the pixel font and the outline fonts have different default sizes, so a chosen size doesn't carry over between them
  if (k === "font" && (v === "pixel") !== (S.opts.font === "pixel")) S.opts.textPx = 0;
  S.opts[k] = v;
  if (!S.resetting) try { localStorage.setItem(OPT_KEY, JSON.stringify(S.opts)); } catch {}
  applyOptions();
  // re-render keeps each panel's scroll (data-keep); give focus back to the control that was used
  const a = document.activeElement, sel = a?.dataset?.opt ? `[data-opt="${a.dataset.opt}"]${a.value && a.type === "radio" ? `[value="${CSS.escape(a.value)}"]` : ""}${a.dataset.val ? `[data-val="${CSS.escape(a.dataset.val)}"]` : ""}` : null;
  const host = a?.closest?.(".window");
  wins.forEach(w => (w.kind === "options" || w.kind === "props") && renderWin(w));
  if (sel && host) $(sel, host)?.focus({ preventScroll: true });
}

// the job-finished chime is a sound made with Runway itself: task ce1c486d-9ec2-49c1-a413-98c42e47333b,
// eleven_text_to_sound_v2, prompt "a single soft chime", 2 s, 2 credits, saved as sounds/chime.mp3.
// A failed or cancelled job plays the low two-note tone instead, so the two never sound alike.
// A fresh Audio each time lets chimes overlap; if the file can't load or play (autoplay blocked
// before the first click or key press), the Web Audio tones play instead.
export function chime(ok = true) {
  if (!ok) { chimeTone(false); return null; }
  const a = new Audio("sounds/chime.mp3");
  a.volume = 0.6;
  a.play().catch(() => chimeTone(true));
  return a;
}
// a short two-note chime made with Web Audio, no sound files needed
export function chimeTone(ok = true) {
  try {
    const ac = chime.ac ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = ok ? [880, 1318.5] : [440, 330];
    notes.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.12;
      o.type = "square"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.18);
    });
  } catch {}
}

export function tszRead(w, preview) {
  const el = $(".tsz-read", w.body); if (!el) return;
  const applied = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 11;
  const fs = preview ?? applied, dpr = Math.max(1, Math.round(devicePixelRatio || 1));
  const sharp = Math.abs((fs * dpr) / 11 - Math.round((fs * dpr) / 11)) < 1e-6;
  const sl = $(".tsz", w.body), min = sl ? +sl.min : 10, max = sl ? +sl.max : 24, pct = Math.round((fs / 11) * 100);
  el.textContent = `${fs} px text · ${pct}% · ${S.opts.font !== "pixel" ? "smooth font, any size works" : sharp ? "sharp with the pixel font" : `slightly soft with the pixel font. Sharp sizes here: ${[1, 2, 3, 4].map(n => (11 * n) / dpr).filter(x => x >= min && x <= max).join(", ")} px`}${preview != null && preview !== applied ? " · release to apply" : ""}`;
  sl?.setAttribute("aria-valuetext", `${fs} px text, ${pct}%`);
  $$("[data-tsz]", w.body).forEach(b => b.setAttribute("aria-pressed", +b.dataset.tsz === fs));
}
export function optionsRender(w) {
  const tab = w.tab && w.tab !== "general" ? w.tab : "access", T = [["access", "Accessibility"], ["look", "Appearance"], ["alerts", "Alerts"], ["spend", "Spending"]];
  const ts = textSizes(), pixel = S.opts.font === "pixel";
  const radio = (k, v, label, hint) => `<label class="opt-radio"><input type="radio" name="o-${k}" data-opt="${k}" value="${esc(v)}" ${String(S.opts[k]) === String(v) ? "checked" : ""}><span>${label}${hint ? ` <span class="muted">${hint}</span>` : ""}</span></label>`;
  const check = (k, label, hint) => `<label class="check opt-check"><input type="checkbox" data-opt="${k}" ${S.opts[k] ? "checked" : ""}><span>${label}${hint ? `<br><span class="muted">${hint}</span>` : ""}</span></label>`;
  const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 11;
  // marks sit under the slider's thumb positions; two marks too close to center both labels share the gap between them
  const R = tszRange(), at = v => (v - R.min) / (R.max - R.min), near = (a, b) => !!b && Math.abs(at(a[0]) - at(b[0])) < 0.15;
  let panel;
  if (tab === "access") panel = `
      <fieldset class="group"><legend>Scale</legend>
        <div class="tsize">
          <span class="tsz-a" aria-hidden="true">A</span>
          <input type="range" class="tsz" min="${R.min}" max="${R.max}" step="0.5" value="${cur}" list="tsz-ticks" aria-label="Scale, as text size in pixels">
          <span class="tsz-b" aria-hidden="true">A</span>
          <span></span>
          <div class="tsz-marks">${R.marks.map((m, i, a) => `<button class="linkish${near(m, a[i + 1]) ? " tsz-end" : near(m, a[i - 1]) ? " tsz-start" : ""}" data-tsz="${m[0]}" style="left:calc(5.5 * var(--u) + ${at(m[0])} * (100% - 11 * var(--u)))">${m[1]}</button>`).join("")}</div>
          <datalist id="tsz-ticks">${R.marks.map(([v]) => `<option value="${v}"></option>`).join("")}</datalist>
        </div>
        <div class="tsz-read muted"></div>
      </fieldset>
      <fieldset class="group"><legend>Font</legend>
        ${radio("font", "plex", "IBM Plex Sans", "clean and even at small sizes")}
        ${radio("font", "dot", "DotGothic16", "pixel look, drawn as outlines so it stays sharp at any size")}
        ${radio("font", "smooth", "Tahoma", "the Windows 98/2000 system font")}
        ${radio("font", "hyper", "Atkinson Hyperlegible", "designed for low-vision readability, the easiest to read")}
        ${radio("font", "pixel", "Pixel font", "MS Sans Serif, sharp only at the marked sizes")}
      </fieldset>
      <fieldset class="group"><legend>Display</legend>
        ${check("contrast", "High contrast", "Black background, white text, yellow highlights")}
        <div class="opt-sub">Animations</div>
        ${radio("motion", "system", "Follow macOS", reduced.matches ? "Reduce motion is on" : "Reduce motion is off")}
        ${radio("motion", "reduce", "Reduce", "No window animations, blinking or marquees")}
        ${radio("motion", "full", "Full")}
      </fieldset>`;
  else if (tab === "look") panel = `
      <fieldset class="group"><legend>Theme</legend>
        <div class="swatches">${THEMES.map(([k, n]) => `<button class="swatch${S.opts.theme === k ? " on" : ""}" data-opt="theme" data-val="${k}" aria-pressed="${S.opts.theme === k}"><span class="tprev" data-theme="${k}" aria-hidden="true"><span class="tp-win raised"><span class="tp-title"></span><span class="tp-btn raised"></span></span></span><span>${n}</span></button>`).join("")}</div>
      </fieldset>
      <fieldset class="group"><legend>Desktop color</legend>
        <div class="swatches"><button class="swatch${!S.opts.desk ? " on" : ""}" data-opt="desk" data-val="" aria-pressed="${!S.opts.desk}"><i class="tdesk"></i><span>Theme default</span></button>${DESKS.map(([c, n]) => `<button class="swatch${S.opts.desk === c ? " on" : ""}" data-opt="desk" data-val="${c}" title="${n}" aria-label="${n}" aria-pressed="${S.opts.desk === c}"><i style="background:${c}"></i><span>${n}</span></button>`).join("")}</div>
      </fieldset>
      <fieldset class="group"><legend>Startup</legend>
        ${check("boot", "Show boot screen when the page loads")}
      </fieldset>
      <fieldset class="group"><legend>Clock</legend>
        ${radio("clock24", "false", "12-hour", new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }))}
        ${radio("clock24", "true", "24-hour", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }))}
      </fieldset>
      <fieldset class="group"><legend>Terminal colors</legend>
        ${TERMS.map(([v, n]) => radio("termScheme", v, n)).join("")}
      </fieldset>`;
  else if (tab === "spend") panel = spendPanel();
  else panel = `
      <fieldset class="group"><legend>When a job finishes</legend>
        ${check("balloons", "Show a balloon above the clock")}
        ${check("sound", "Play a chime")} <button class="raised btn-s opt-test" data-chime>Play</button>
        ${check("notify", "macOS notification while this tab is in the background", "Your browser asks for permission the first time.")}
        ${S.opts.notify && "Notification" in window && Notification.permission === "denied" ? '<div class="gmsg">The browser blocks notifications for this page. Allow them in the browser\'s site settings.</div>' : ""}
      </fieldset>`;
  w.body.innerHTML = sheetHTML(T, tab, panel, '<button class="raised btn-s" data-opt-reset>Restore defaults</button><span class="grow"></span>');
  sheetKeys(w);
  tszRead(w);
  if (!w.optBound) {
    w.optBound = true;
    // the default size is saved as no size, so it keeps following the font and the screen; the re-render keeps keyboard focus on the slider or mark
    const tszSet = (v, sel) => {
      const had = document.activeElement?.matches?.(sel);
      setOpt("textPx", v === tszRange().def ? 0 : v);
      if (had) $(sel, w.body)?.focus({ preventScroll: true });
    };
    // drag: resize live without rebuilding the window; release: save
    // dragging only previews the value; the scale applies on release, so the slider doesn't move under the pointer
    w.body.addEventListener("input", e => { if (e.target.matches(".tsz")) tszRead(w, +e.target.value); });
    w.body.addEventListener("change", e => { if (e.target.matches(".tsz")) tszSet(+e.target.value, ".tsz"); });
    w.body.addEventListener("click", e => { const t = e.target.closest("[data-tsz]"); if (t) tszSet(+t.dataset.tsz, `[data-tsz="${t.dataset.tsz}"]`); });
    w.body.addEventListener("change", e => {
      const el = e.target.closest("[data-opt]"); if (!el) return;
      const k = el.dataset.opt;
      if (el.type === "checkbox") {
        if (k === "notify" && el.checked && "Notification" in window && Notification.permission === "default") Notification.requestPermission().then(() => renderWin(w));
        setOpt(k, el.checked);
      } else setOpt(k, el.value === "true" ? true : el.value === "false" ? false : el.value);
    });
    w.body.addEventListener("click", e => {
      const sw = e.target.closest("button[data-opt]"); if (sw) { setOpt(sw.dataset.opt, sw.dataset.val); return; }
      if (e.target.closest("[data-chime]")) chime();
      // keep the saved-options migration flags (fontV2, sizeV5…), or the next page load would run those migrations again on the new choices
      if (e.target.closest("[data-opt-reset]")) { S.opts = { ...OPT_DEFAULT, ...Object.fromEntries(Object.entries(S.opts).filter(([k]) => /V\d+$/.test(k))) }; setOpt("textSize", OPT_DEFAULT.textSize); }
    });
  }
}

export function init() {
  RENDER.options = w => optionsRender(w);
  S.opts = { ...OPT_DEFAULT };
  try {
    const saved = JSON.parse(localStorage.getItem(OPT_KEY)) || {};
    if (!saved.theme && saved.desk === "#0b2e2e") delete saved.desk; // the old default desktop color now comes from the theme
    if (!saved.fontV2) { delete saved.font; delete saved.textPx; saved.fontV2 = true; } // readable smooth font became the default
    if (!saved.fontV3) { delete saved.font; saved.fontV3 = true; } // IBM Plex Sans became the default
    if (!saved.sizeV4) { delete saved.textPx; delete saved.textSize; saved.sizeV4 = true; } // bigger default text for the smooth fonts
    if (!saved.sizeV5) { if (saved.font !== "pixel" && +saved.textPx < 13) delete saved.textPx; saved.sizeV5 = true; } // sizes under 13 px came from the pixel-font marks and are too small for the outline fonts
    S.opts = { ...OPT_DEFAULT, ...saved };
  } catch {}
  reduced.addEventListener?.("change", applyOptions);
}
