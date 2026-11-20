import { S } from "./state.js";
import { cap, esc, fmt } from "./dom.js";
import { absTime, ago, dur, tOf } from "./time.js";

export const ACTIVE = new Set(["pending", "running", "throttled"]);
export const QUEUED = new Set(["pending", "throttled"]);
// a job can return several files (outputCount, numVariants): each extra file is its own item, id "taskId~2", "~3"…
export const filesOf = r => (r.assets?.length ? r.assets : r.asset ? [r.asset] : []);
export const fileItem = (r, i) => (i === 0 ? r : { ...r, taskId: `${r.taskId}~${i + 1}`, asset: filesOf(r)[i], _of: r.taskId, _n: i + 1 });
export const runOf = id => {
  const [base, n] = String(id ?? "").split("~"), r = S.data.runs.find(x => x.taskId === base);
  return r && n ? (filesOf(r)[n - 1] ? fileItem(r, n - 1) : undefined) : r;
};
export const newestFirst = () => [...S.data.runs].sort((a, b) => createdMs(b) - createdMs(a));
export const assetsOf = type => newestFirst().filter(r => r.type === type && r.asset).flatMap(r => filesOf(r).map((_, i) => fileItem(r, i)));
export const childrenOf = id => S.data.runs.filter(r => r.parent === id);
export const createdMs = r => tOf(r.createdAt) || tOf(r.date) || 0;
export const thumbOf = r => (!r || !r.asset || r.type === "audio" ? null : `thumbs/${encodeURIComponent(r.asset)}.jpg`); // the server redirects to the original if it can't make one
// image, video or audio from a file name's extension, as server.py's EXT_TYPE does; undefined for anything else
const EXT_TYPE = { image: "png jpg jpeg webp gif svg", video: "mp4 mov webm m4v", audio: "mp3 wav flac ogg m4a aac opus" };
const EXT_OF = new Map(Object.entries(EXT_TYPE).flatMap(([t, l]) => l.split(" ").map(e => [e, t])));
export const kindOfName = name => EXT_OF.get(/\.([^./]+)$/.exec(name || "")?.[1].toLowerCase());
export const typeIcon = t => (t === "video" ? "i-video" : t === "audio" ? "i-audio" : "i-picture");
export const plural = t => (t === "audio" ? "Audio" : cap(t) + "s");
export const nameOf = r => r.asset || r.prompt.slice(0, 48);
export const costOf = r => r.credits ?? r.estimatedCredits ?? null;

export function statusInfo(r) {
  const p = r.progress != null ? Math.round(r.progress * 100) : null;
  if (r.status === "running") return { cls: "running", label: p != null ? `Rendering ${p}%` : "Rendering", p };
  if (r.status === "throttled") return { cls: "queued", label: "Queued (rate limit)" };
  if (r.status === "pending") return { cls: "queued", label: "Queued" };
  if (r.status === "succeeded") return { cls: "done", label: "Done" };
  if (r.status === "failed") return { cls: "failed", label: "Failed" };
  if (r.status === "cancelled") return { cls: "failed", label: "Cancelled" };
  return { cls: "queued", label: cap(r.status || "unknown") };
}
// median finished duration for the same model, used to estimate time left
export function typicalMs(model) {
  const d = S.data.runs.filter(r => r.model === model && r.finishedAt && r.createdAt).map(r => tOf(r.finishedAt) - tOf(r.createdAt)).filter(x => x > 0).sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)] : null;
}
export const relHTML = (iso, kind = "ago") => {
  const t = tOf(iso);
  if (!t) return "—";
  return `<time datetime="${esc(iso)}" data-t="${t}" data-kind="${kind}" title="${esc(absTime(t))}">${kind === "ago" ? ago(t) : dur(Date.now() - t)}</time>`;
};
export const costHTML = r => r.credits != null ? fmt(r.credits)
  : r.estimatedCredits != null ? `<span class="est" title="Runway's estimate while the job runs">~${fmt(r.estimatedCredits)}</span>` : "—";
export const etaText = end => (end > Date.now() ? `~${dur(end - Date.now())} left` : "longer than usual");
// a queued or rendering job: the bar while it renders, then the time since it was sent and, while it renders,
// the time left from the model's typical duration (Activity refreshes [data-eta] every few seconds)
export function progressHTML(r, s = statusInfo(r)) {
  const run = s.cls === "running", typ = run ? typicalMs(r.model) : null, end = createdMs(r) + typ;
  return (run ? `<span class="mprog sunken" aria-hidden="true"><i style="width:${s.p ?? 8}%" class="${s.p == null ? "ind" : ""}"></i></span>` : "")
    + `<small class="muted">${relHTML(r.createdAt || r.date, "elapsed")}${typ ? ` · <span data-eta="${end}">${etaText(end)}</span>` : ""}</small>`;
}
export function statusHTML(r, withBar = true) {
  const s = statusInfo(r);
  return `<span class="st ${s.cls}"><i class="dot"></i>${esc(s.label)}</span>${withBar && s.cls === "running" ? progressHTML(r, s) : ""}`;
}
// thumbnail contents: the picture when there is one, the type icon underneath as a fallback
export const thumbInner = (src, type) => `${src ? `<img src="${src}" alt="" loading="lazy" onerror="this.hidden=true">` : ""}<span class="empty"><svg class="ico big"><use href="#${typeIcon(type)}"/></svg></span>`;
export const miniThumb = r => `<span class="mini sunken">${thumbOf(r) ? `<img src="${thumbOf(r)}" alt="" loading="lazy" onerror="this.hidden=true">` : `<svg class="ico"><use href="#${typeIcon(r.type)}"/></svg>`}</span>`;

// a job as a signature string: SIG functions compare these between polls and skip windows whose signature did not change

export const runSig = r => r && JSON.stringify(r);
