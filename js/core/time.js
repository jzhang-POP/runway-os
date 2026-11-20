export const tOf = s => (s ? Date.parse(s) : NaN);
export const ago = ms => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};
export const dur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`; };
export const absTime = ms => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
export const sleep = ms => new Promise(res => setTimeout(res, ms));
export const upTo = (p, ms) => Promise.race([p.then(() => true), sleep(ms).then(() => false)]); // false on timeout
