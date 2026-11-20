/* ---------- seven-segment balance readout ---------- */
export const SEG = {
  a: "4,1 16,1 13.5,3.8 6.5,3.8", d: "6.5,32.2 13.5,32.2 16,35 4,35",
  b: "17.2,2.2 17.2,16.4 15.8,17.6 14.4,16.2 14.4,4.8", c: "17.2,19.6 17.2,33.8 14.4,31.2 14.4,19.8 15.8,18.4",
  e: "2.8,19.6 4.2,18.4 5.6,19.8 5.6,31.2 2.8,33.8", f: "2.8,2.2 5.6,4.8 5.6,16.2 4.2,17.6 2.8,16.4",
  g: "5.8,16.6 14.2,16.6 15.6,18 14.2,19.4 5.8,19.4 4.4,18",
};
export const DIG = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g" };
export function ledHTML(n) {
  const s = n == null ? "-------" : String(Math.round(n));
  return [...s].map((ch, i) => {
    const on = DIG[ch] || "", left = s.length - i - 1;
    return `<svg class="dig" viewBox="0 0 20 36" aria-hidden="true">${Object.entries(SEG).map(([k, p]) => `<polygon points="${p}" class="${on.includes(k) ? "on" : "off"}"/>`).join("")}</svg>`
      + (left > 0 && left % 3 === 0 ? '<i class="gap"></i>' : "");
  }).join("");
}

// org balance over the last 24 h as a stepped line; returns svg + credits spent
export function spark(hist, W = 160, H = 34, grid = false) {
  const now = Date.now() / 1000, t0 = now - 86400;
  const pts = (hist || []).map(([t, b]) => [Math.max(t, t0), b]);
  let spent = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1]) spent += pts[i - 1][1] - pts[i][1];
  if (pts.length < 2) return { svg: "", spent: null };
  pts.push([now, pts[pts.length - 1][1]]);
  const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
  const X = t => ((t - t0) / 86400) * W, Y = b => (hi === lo ? H / 2 : 3 + (1 - (b - lo) / (hi - lo)) * (H - 6));
  let d = `M${X(pts[0][0]).toFixed(1)},${Y(pts[0][1]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += `H${X(pts[i][0]).toFixed(1)}V${Y(pts[i][1]).toFixed(1)}`;
  const end = pts[pts.length - 1];
  const lines = grid ? Array.from({ length: 23 }, (_, i) => `<line class="gl" x1="${((i + 1) * W / 24).toFixed(1)}" y1="0" x2="${((i + 1) * W / 24).toFixed(1)}" y2="${H}"/>`).join("") + [1, 2, 3].map(i => `<line class="gl" x1="0" y1="${i * H / 4}" x2="${W}" y2="${i * H / 4}"/>`).join("") : "";
  return { spent, svg: `<svg class="spark${grid ? " big" : ""}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${lines}<path d="${d}"/><circle cx="${X(end[0]) - 2}" cy="${Y(end[1])}" r="2.5"/></svg>` };
}

/* ---------- tab title + favicon: live status, readable from another tab ---------- */
// the runway os logo: a bold pixel "R" on a beveled Win95-blue tile (16x16 grid)
export const R_BITS = ["1111111.", "11111111", "11....11", "11....11", "11....11", "11111111", "1111111.", "11.11...", "11..11..", "11...11.", "11....11"];
export function logoSVG(fg) {
  const px = (dx, dy, fill) => R_BITS.flatMap((row, y) => [...row].map((c, x) => (c === "1" ? `<rect x="${4 + x + dx}" y="${3 + y + dy}" width="1" height="1" fill="${fill}"/>` : ""))).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f6fc4"/><stop offset="1" stop-color="#000a5c"/></linearGradient></defs>`
    + `<rect width="16" height="16" fill="#08090b"/><rect width="15" height="15" fill="#c9cbd3"/><rect x="1" y="1" width="14" height="14" fill="url(#g)"/>${px(1, 1, "#000000")}${px(0, 0, fg)}</svg>`;
}
export const FAV = { idle: logoSVG("#ffffff"), busy: logoSVG("#ffc94a") };
