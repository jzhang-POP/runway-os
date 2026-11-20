#!/usr/bin/env bash
# Smoke test for Runway OS: boots the app in headless Chrome against throwaway copies of the server,
# opens every window in every theme, and fails on page errors, failed requests, empty or oversized windows,
# or broken keyboard shortcuts. Never submits jobs and never touches your runs.json, notes or API key.
#
#   tests/smoke.sh                 run it (about 30-60 s)
#   SMOKE_DATA_DIR=/path tests/smoke.sh   read runs.json, notes and media from another folder (read-only)
#   SMOKE_KEEP=1 tests/smoke.sh    keep the temp folders and print where they are
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
OUT="$HERE/out"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

[ -x "$CHROME" ] || { echo "smoke: Chrome not found at $CHROME (set CHROME=...)" >&2; exit 2; }
command -v node >/dev/null || { echo "smoke: node is required" >&2; exit 2; }
command -v python3 >/dev/null || { echo "smoke: python3 is required" >&2; exit 2; }

# Where the real data lives: this checkout if it has a runs.json, else the main git worktree (agent worktrees have none).
DATA="${SMOKE_DATA_DIR:-}"
if [ -z "$DATA" ]; then
  if [ -f "$REPO/runs.json" ]; then DATA="$REPO"
  else DATA="$(git -C "$REPO" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"; fi
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/runway-smoke.XXXXXX")"
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
  if [ -n "${SMOKE_KEEP:-}" ]; then echo "smoke: kept $TMP"; else rm -rf "$TMP"; fi
}
trap cleanup EXIT INT TERM

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'; }

# A copy of the app as it is in the working tree (tracked and new files, not tests/ or ignored data).
copy_app() {
  local dst="$1"; mkdir -p "$dst"
  (cd "$REPO" && git ls-files -co --exclude-standard -z -- . ':!tests' | rsync -a --from0 --files-from=- ./ "$dst/")
}

start_server() { # dir port log
  # no API key (env unset, no .runway_key in the copy) and a dead proxy: the server can't reach the internet,
  # so nothing is ever sent to Runway and the model list comes from the cached spec only
  (cd "$1" && exec env -u RUNWAYML_API_SECRET LEDGER_PORT="$2" https_proxy=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 \
     HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 python3 server.py >"$3" 2>&1) &
  PIDS+=($!)
}

wait_http() { # url
  for _ in $(seq 1 100); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 0.1; done
  echo "smoke: server at $1 didn't start" >&2; return 1
}

# Pass 1, "fresh": an empty folder, as after a git clone: no runs.json, no model-list cache, no key.
FRESH="$TMP/fresh"; copy_app "$FRESH"
# Pass 2, "data": your job log, notes and media, read-only (runs.json and notes copied, media symlinked).
DATAD="$TMP/data"; copy_app "$DATAD"
if [ -n "$DATA" ] && [ -f "$DATA/runs.json" ]; then
  cp "$DATA/runs.json" "$DATAD/runs.json"
  [ -f "$DATA/balance_history.json" ] && cp "$DATA/balance_history.json" "$DATAD/"
  [ -d "$DATA/notes" ] && cp -R "$DATA/notes" "$DATAD/notes"
  # symlink every media file the job log names, plus thumbs and inputs (files, not folders, so nothing is written back)
  python3 - "$DATA" "$DATAD" <<'PY'
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
runs = json.load(open(os.path.join(src, "runs.json"))).get("runs", [])
names = {a for r in runs for a in [r.get("asset")] + (r.get("assets") or []) if a}
for n in names:
    p = os.path.join(src, os.path.basename(n))
    if os.path.isfile(p) and not os.path.exists(os.path.join(dst, os.path.basename(n))):
        os.symlink(p, os.path.join(dst, os.path.basename(n)))
for d in ("thumbs", "inputs"):
    if os.path.isdir(os.path.join(src, d)):
        os.makedirs(os.path.join(dst, d), exist_ok=True)
        for n in os.listdir(os.path.join(src, d)):
            if not n.startswith(".") and os.path.isfile(os.path.join(src, d, n)):
                os.symlink(os.path.join(src, d, n), os.path.join(dst, d, n))
PY
else
  echo "smoke: no runs.json found (set SMOKE_DATA_DIR); the data pass runs with an empty job log"
fi
# the model list: the cached OpenAPI spec, marked fresh so the server doesn't try to download it
for f in "$REPO/runway_openapi.json" "$DATA/runway_openapi.json"; do
  if [ -f "$f" ]; then cp "$f" "$DATAD/runway_openapi.json"; touch "$DATAD/runway_openapi.json"; break; fi
done

P1="$(free_port)"; start_server "$FRESH" "$P1" "$TMP/fresh.log"
P2="$(free_port)"; start_server "$DATAD" "$P2" "$TMP/data.log"
wait_http "http://127.0.0.1:$P1/"; wait_http "http://127.0.0.1:$P2/"

# Server checks, before the browser: a burst of parallel GETs (the page asks for dozens of thumbnails at once),
# the /api/state ETag, and an early error reply to a POST with a body (it must answer, not reset the connection).
server_checks() { # base-url
  local B="$1" bad=0 tag code n
  # 200 GETs, 64 in flight at once from one curl: /api/state, the page files, and every media file and thumbnail it names
  python3 - "$B" >"$TMP/burst.cfg" <<'PY'
import json, sys, urllib.parse, urllib.request
b = sys.argv[1]
d = json.load(urllib.request.urlopen(b + "api/state"))
paths = ["api/state", "", "index.html", "app.js"]
for r in d.get("runs", []):
    for a in [r.get("asset")] + (r.get("assets") or []):
        if a and r.get("type") in ("image", "video"):
            paths.append(("thumbs/%s.jpg" if r["type"] == "video" else "%s") % urllib.parse.quote(a))
for i in range(200):
    print(f'url = "{b}{paths[i % len(paths)]}"\noutput = "/dev/null"')
PY
  n="$(curl -sS --parallel --parallel-immediate --parallel-max 64 --max-time 60 -w '%{http_code}\n' -K "$TMP/burst.cfg" 2>"$TMP/burst.err" | grep -c '^200$' || true)"
  if [ "$n" != 200 ]; then echo "smoke: burst of 200 parallel GETs on $B: $((200 - n)) failed" >&2; sort -u "$TMP/burst.err" | head -5 >&2; bad=1; fi
  tag="$(curl -sS -D - -o /dev/null "${B}api/state" | tr -d '\r' | sed -n 's/^[Ee][Tt][Aa][Gg]: //p')"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -H "If-None-Match: $tag" "${B}api/state")"
  if [ -z "$tag" ] || [ "$code" != 304 ]; then echo "smoke: /api/state with If-None-Match $tag gave $code, not 304" >&2; bad=1; fi
  head -c 5000000 /dev/zero >"$TMP/post.bin"
  for _ in 1 2 3 4 5; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Expect:' -H 'Content-Type: application/json' \
      --data-binary @"$TMP/post.bin" "${B}api/nonexistent" 2>>"$TMP/post.err" || true)"
    if [ "$code" != 404 ]; then echo "smoke: POST with a 5 MB body to /api/nonexistent gave '$code', not 404: $(tail -1 "$TMP/post.err")" >&2; bad=1; break; fi
  done
  return $bad
}
server_checks "http://127.0.0.1:$P1/" && server_checks "http://127.0.0.1:$P2/" || exit 1
echo "smoke: server checks passed (parallel GET burst, ETag 304, POST error without reset)"

mkdir -p "$OUT"; rm -f "$OUT"/*.png
PROFILE="$TMP/chrome"; mkdir -p "$PROFILE"
"$CHROME" --headless=new --user-data-dir="$PROFILE" --remote-debugging-port=0 --window-size=1440,900 \
  --no-first-run --no-default-browser-check --disable-extensions --disable-background-networking \
  --disable-component-update --disable-sync --mute-audio --autoplay-policy=user-gesture-required \
  --disable-features=Translate,MediaRouter about:blank >"$TMP/chrome.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 100); do [ -s "$PROFILE/DevToolsActivePort" ] && break; sleep 0.1; done
[ -s "$PROFILE/DevToolsActivePort" ] || { echo "smoke: Chrome didn't start; see $TMP/chrome.log" >&2; cat "$TMP/chrome.log" >&2; exit 2; }
CDP="$(head -1 "$PROFILE/DevToolsActivePort")"

set +e
node "$HERE/smoke.mjs" --cdp "$CDP" --app "$REPO/app.js" --out "$OUT" \
  --fresh "http://localhost:$P1/" --data "http://localhost:$P2/"
code=$?
set -e
if [ $code -ne 0 ]; then
  for l in fresh data; do
    if grep -q "Traceback" "$TMP/$l.log" 2>/dev/null; then echo "--- server log ($l) ---" >&2; cat "$TMP/$l.log" >&2; fi
  done
fi
exit $code
