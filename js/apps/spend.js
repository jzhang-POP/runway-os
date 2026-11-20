import { S, wins } from "../core/state.js";
import { $, $$, esc, fmt } from "../core/dom.js";
import { newestFirst } from "../core/status.js";
import { curModel, curTask, genBody, genRefresh, secondsOf, shownVal, vals } from "./generate.js";
import { setOpt } from "./options.js";

/* ---------- spending guard: a daily credit limit for the whole org (Options → Spending) ----------
   The server works out data.spent.today from balance_history.json: every drop in the org balance since local midnight,
   so jobs from Claude, this app and other tools all count. Generate asks before a job that would go over the limit. */
export const spendLimit = () => { const n = Math.round(+S.opts.dailyLimit); return S.opts.dailyLimit != null && S.opts.dailyLimit !== "" && n >= 1 ? n : null; };
// the server's spending fields from /api/state; repaint what shows them when they change
export function spendUpdate(d) {
  const s = { today: typeof d.spentToday === "number" ? d.spentToday : null, source: d.spentSource || null, since: d.spentSince || null };
  const same = S.data.spent && S.data.spent.today === s.today && S.data.spent.source === s.source;
  S.data.spent = s;
  if (!same) spendRefresh();
}
export function spendRefresh() {
  spendTray();
  $$(".spent-today").forEach(el => { el.textContent = spendText(); });
  wins.forEach(w => w.kind === "generate" && w.shell && S.CAT && curModel(w) && genRefresh(w));
}
export function spendText() {
  const s = S.data.spent?.today, lim = spendLimit();
  if (s == null) return "Spent today: unknown until the server answers.";
  return `Spent today: ${fmt(s)} credits${lim ? ` of ${fmt(lim)} (${Math.round(s / lim * 100)}%)` : ""}.`;
}
// tray: the balance turns amber at 80% of the limit and red at 100%
export function spendTray() {
  const bal = $("#tray-bal"); if (!bal) return;
  const s = S.data.spent?.today, lim = spendLimit(), r = lim && s != null ? s / lim : 0;
  bal.classList.toggle("spend-near", r >= 0.8 && r < 1);
  bal.classList.toggle("spend-over", r >= 1);
  bal.title = lim && s != null ? `Spent today: ${fmt(s)} of ${fmt(lim)} credits. Open Dashboard` : "Credits left. Open Dashboard";
}
// this job's price: the server's quote, else the same estimate the hint shows (from your last job with this model)
export function spendQuote(w) {
  const key = JSON.stringify(genBody(w)), pr = w.priceFor === key ? w.price : null;
  if (pr?.credits != null) return { credits: pr.credits, exact: !!pr.exact };
  const m = curModel(w), t = curTask(w);
  const last = m && newestFirst().find(r => r.model === m.id && r.credits != null && r.costSource === "runway" && (!r.endpoint || r.endpoint === t.endpoint));
  if (!last) return { credits: null, exact: false };
  const d = +shownVal(m.fields.find(f => f.name === "duration") || {}, vals(w).duration), sec = secondsOf(last);
  return { credits: d && sec ? Math.round(last.credits / sec * d) : last.credits, exact: false };
}
// a quiet note after the price in Generate's footer, only when this job takes today's spending to 80% of the limit or more
export function spendHint(w, hint, pr) {
  const lim = spendLimit(), s = S.data.spent?.today; if (!lim || s == null) return;
  const after = s + (pr?.credits ?? 0);
  if (after < lim * 0.8) return;
  hint.textContent += after > lim ? ` · over today's limit: ${fmt(after)} of ${fmt(lim)}` : ` · today ${fmt(after)} of ${fmt(lim)} limit`;
  hint.title = hint.textContent;
}
// before Generate sends a job: resolves true to go ahead
export function spendCheck(w) {
  const lim = spendLimit(), s = S.data.spent?.today;
  if (!lim || s == null) return Promise.resolve(true);
  const q = spendQuote(w), after = s + (q.credits ?? 0);
  if (q.credits == null ? s < lim : after <= lim) return Promise.resolve(true);
  const lead = q.credits == null
    ? `Today's spending is already ${fmt(s)} of your ${fmt(lim)} credit limit, and this job's price is unknown.`
    : `This job would take today's spending to ${q.exact ? "" : "about "}${fmt(after)} of your ${fmt(lim)} credit limit.`;
  const job = q.credits == null ? "This job has no price quote, so it isn't counted here."
    : q.exact ? `This job: ${fmt(q.credits)} credits.` : `This job: about ${fmt(q.credits)} credits. That's an estimate, the final cost can differ.`;
  return spendDialog(lead, `Spent today: ${fmt(s)} credits, by the whole Runway org since midnight. ${job}`);
}
export function spendDialog(lead, detail) {
  return new Promise(resolve => {
    $("#spendguard")?.remove();
    const back = document.activeElement, d = document.createElement("div");
    d.id = "spendguard"; d.className = "shutdown";
    d.innerHTML = `
        <div class="sd-win window front raised" role="alertdialog" aria-modal="true" aria-labelledby="sg-t" aria-describedby="sg-lead sg-detail">
          <div class="titlebar"><span class="t"><svg class="ico ticon" aria-hidden="true"><use href="#i-coin"/></svg><span class="tt" id="sg-t">Daily credit limit</span></span></div>
          <div class="sd-body">
            <svg class="sd-ico" aria-hidden="true"><use href="#i-coin"/></svg>
            <div class="sg-text"><p id="sg-lead">${esc(lead)}</p><p class="muted" id="sg-detail">${esc(detail)}</p></div>
          </div>
          <div class="sheet-foot"><span class="grow"></span><button class="raised btn-ok" data-sg="go">Generate anyway</button><button class="raised btn-ok b-default" data-sg="cancel">Cancel</button></div>
        </div>`;
    document.body.append(d);
    const done = ok => { removeEventListener("keydown", onKey, true); d.remove(); back?.focus?.(); resolve(ok); };
    // modal: it takes every key while open; Esc cancels, Tab stays on the two buttons, Enter presses the focused one
    const onKey = e => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); done(false); return; }
      if (e.key === "Tab") { const f = $$("button", d), i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
    };
    addEventListener("keydown", onKey, true);
    d.addEventListener("click", e => { const b = e.target.closest("[data-sg]"); if (b) done(b.dataset.sg === "go"); });
    $('[data-sg="cancel"]', d).focus();
  });
}
// terminal: one line for balance and cost
export function spendTerm() {
  const s = S.data.spent?.today, lim = spendLimit();
  if (s == null) return `<b class="t-acc">today</b>: spending unknown`;
  return `<b class="t-acc">today, whole org</b>: <span class="t-red">${fmt(s)}</span> credits spent${lim ? ` of a ${fmt(lim)} daily limit (${Math.round(s / lim * 100)}%)` : ", no daily limit (set one in Options, Spending)"}`;
}
export function spendPanel() {
  const lim = spendLimit(), src = S.data.spent?.source;
  return `
      <fieldset class="group"><legend>Daily credit limit</legend>
        <div class="opt-limit"><label for="o-limit">Limit</label><input type="number" class="field" id="o-limit" data-limit min="1" step="1" inputmode="numeric" value="${lim ?? ""}" placeholder="No limit" aria-describedby="o-limit-h"><span>credits a day</span></div>
        <p class="muted opt-limit-h" id="o-limit-h">Counts every credit the Runway org spends from midnight, local time, so jobs from Claude, this app and other tools all count. Top-ups don't lower it. Generate asks before a job that would go over the limit. Leave empty for no limit.</p>
        <p class="spent-today" aria-live="polite">${esc(spendText())}</p>
        ${src === "jobs" ? '<p class="muted opt-limit-h">No balance history for today yet, so this adds up today\'s jobs in runs.json instead.</p>' : ""}
      </fieldset>`;
}

export function init() {
  // Options → Spending: the limit field saves on change (Enter or leaving the field)
  document.addEventListener("change", e => {
    const el = e.target.closest?.("[data-limit]"); if (!el) return;
    const v = el.value.trim(), n = Math.round(+v), had = document.activeElement === el;
    setOpt("dailyLimit", v === "" || !(n >= 1) ? null : n);
    if (had) $("[data-limit]")?.focus({ preventScroll: true });
    spendRefresh();
  });
}
