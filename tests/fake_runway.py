"""Runs a copy of server.py with Runway replaced by a fake, for tests/smoke.sh. Nothing here reaches the internet.

    python3 tests/fake_runway.py <app copy dir>     (LEDGER_PORT and RUNWAYML_API_SECRET come from the environment)

The server thinks it has a key, so the page is "live" (Generate prices jobs, the spend guard runs), but:
  * every Runway call is answered here: /organization gives a balance, /tasks/<id> says the task succeeded;
    any other call (submit, cancel, upload, usage) raises, and urllib's urlopen is replaced too;
  * a succeeded task's file "downloads" slowly: download() waits until <dir>/.release-download exists, then writes
    a small PNG. The test sees the job between "succeeded on Runway" and "file saved".
  * fake.log in the copy lists every Runway call the server tried.
"""
import os, sys, threading, time, zlib, struct

APP = os.path.abspath(sys.argv[1])
sys.path.insert(0, APP)
import server  # noqa: E402  (the copy's server.py)

LOG = os.path.join(APP, "fake.log")
RELEASE = os.path.join(APP, ".release-download")
log_lock = threading.Lock()


def note(line):
    with log_lock, open(LOG, "a") as f:
        f.write(line + "\n")


def png(w=64, h=48):
    raw = b"".join(b"\x00" + b"".join(bytes([x * 4 % 256, y * 5 % 256, 128]) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def fake_call(path, key, body=None, method=None):
    note(f"{method or ('POST' if body is not None else 'GET')} {path}")
    if path == "/organization" and not method and body is None:
        return {"creditBalance": 5000}
    if path.startswith("/tasks/") and not method and body is None:
        return {"id": path[7:], "status": "SUCCEEDED", "output": ["https://fake.invalid/out.png"]}
    raise RuntimeError(f"smoke: the fake Runway refuses {method or ''} {path}")


def fake_download(url, run, i=0):
    note(f"DOWNLOAD {run['taskId']}")
    end = time.time() + 120
    while not os.path.exists(RELEASE) and time.time() < end:
        time.sleep(0.05)
    name = f"{run.get('date', 'job')}_image_{run['taskId'][:8]}.png"
    with open(os.path.join(APP, name), "wb") as f:
        f.write(png())
    return name


def no_net(*a, **kw):
    raise RuntimeError("smoke: no network in the fake server")


server.call = fake_call
server.download = fake_download
server.urllib.request.urlopen = no_net
server.POLL_EVERY = 0.5

if __name__ == "__main__":
    assert os.environ.get("RUNWAYML_API_SECRET", "").startswith("smoke-fake"), "set RUNWAYML_API_SECRET=smoke-fake-..."
    threading.Thread(target=server.worker, daemon=True).start()
    threading.Thread(target=server.loop, daemon=True).start()
    server.Server(("127.0.0.1", server.PORT), server.Handler).serve_forever()
