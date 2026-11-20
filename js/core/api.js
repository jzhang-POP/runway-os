/* ---------- server calls ---------- */
export const OFFLINE = "The dashboard server is offline. Start it with python3 server.py.";
// every call throws an Error with a readable message: OFFLINE when the server can't be reached,
// else the server's own `error`, else its status code; an AbortError is passed through as is
async function call(path, init) {
  let res;
  try { res = await fetch(path, init); }
  catch (e) { if (e.name === "AbortError") throw e; throw new Error(OFFLINE); }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `The server answered ${res.status}.`);
  return out;
}
// GET JSON, never from the browser cache
export const getJSON = path => call(path, { cache: "no-store" });
// POST JSON (or a raw body, with init) to the dashboard server
export const postJSON = (path, body, init) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...init });
