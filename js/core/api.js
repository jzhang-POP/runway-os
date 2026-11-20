/* ---------- server calls ---------- */
export const OFFLINE = "The dashboard server is offline. Start it with python3 server.py.";
// POST JSON (or a raw body with init) to the dashboard server; throws an Error with a readable message
export async function api(path, body, init) {
  let res;
  try { res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...init }); }
  catch (e) { if (e.name === "AbortError") throw e; throw new Error(OFFLINE); }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `The server answered ${res.status}.`);
  return out;
}
