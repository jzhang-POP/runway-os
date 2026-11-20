#!/usr/bin/env python3
"""Runway Dashboard live server.

Serves index.html plus /api/state and keeps runs.json up to date:
  * runs.json is the job log (Claude adds a row each time it submits a job).
  * With a Runway API key, a background loop also:
      - refreshes the org credit balance every BALANCE_EVERY seconds and keeps a
        history of it in balance_history.json
      - syncs every job with its Runway task: status, progress, createdAt, real
        credit cost (estimated while running), failure reason; downloads the
        output next to this file when it succeeds.
  * POST /api/reveal or /api/open {"file": name} shows a saved file in Finder or
    opens it in its default app.
  * GET /api/models lists every task and model in Runway's OpenAPI spec (cached in runway_openapi.json) as form fields;
    POST /api/upload saves a file from the browser into inputs/; POST /api/generate submits
    a job to Runway and logs it in runs.json; POST /api/cancel {"taskId"} cancels one.
  * POST /api/key {"key"} checks a key with Runway and saves it to .runway_key; {"remove": true} deletes it.
    Without a key, the page still updates live whenever runs.json changes.
  * GET /api/notes lists the plain-text notes in notes/, GET /api/notes/<name> reads one;
    POST /api/notes {name, text, create?} saves one (atomically), /api/notes/rename {name, to},
    /api/notes/delete {name}, /api/notes/reveal {name?} shows it (or the folder) in Finder.

API key: env RUNWAYML_API_SECRET, or a file named .runway_key in this folder.
Run:  python3 server.py   then open http://localhost:8765
"""
import bisect, hashlib, json, os, queue, shutil, subprocess, threading, time, urllib.parse, urllib.request, urllib.error, uuid, mimetypes
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(ROOT, "runs.json")
PORT = int(os.environ.get("LEDGER_PORT", "8765"))
API = "https://api.dev.runwayml.com/v1"
POLL_EVERY, BALANCE_EVERY = 8, 20
ACTIVE = {"pending", "running", "throttled"}
lock = threading.Lock()
wake = threading.Event()  # set to sync right away instead of waiting POLL_EVERY
state = {"lastBalanceCheck": None, "error": None, "balanceAt": None}


KEY_FILE = os.path.join(ROOT, ".runway_key")


def file_sig(path):
    """(mtime_ns, size) of a file, or None when it's missing: cheap to compare, changes on every rewrite."""
    try:
        st = os.stat(path)
        return st.st_mtime_ns, st.st_size
    except OSError:
        return None


key_cache = {"sig": None, "key": None}


def key_file():
    """The key saved in .runway_key, or None; read again only when the file changes."""
    sig = file_sig(KEY_FILE)
    if sig != key_cache["sig"]:
        key = None
        if sig:
            try:
                with open(KEY_FILE) as f:
                    key = f.read().strip() or None
            except OSError:
                pass
        key_cache.update(sig=sig, key=key)
    return key_cache["key"]


def key_source():
    """Where the key comes from: the .runway_key file (set from the dashboard) wins over the env variable."""
    if key_file():
        return "file"
    return "env" if os.environ.get("RUNWAYML_API_SECRET") else None


def api_key():
    return key_file() or os.environ.get("RUNWAYML_API_SECRET") or None


def set_key(body):
    """Check a key with Runway, then save it to .runway_key (owner-only). Never returns the key."""
    if body.get("remove"):
        if os.path.exists(KEY_FILE):
            os.remove(KEY_FILE)
        state["error"], state["lastBalanceCheck"] = None, None
        return {"ok": True}
    key = str(body.get("key") or "").strip()
    if not key or any(c.isspace() for c in key) or not 16 <= len(key) <= 400:
        raise ValueError("That doesn't look like a Runway API key. Paste the whole key, without spaces.")
    try:
        org = call("/organization", key)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise ValueError("Runway rejected this key. Check that it's active at dev.runwayml.com.")
        raise ValueError(api_error(e))
    tmp = KEY_FILE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, KEY_FILE)
    state["error"], state["lastBalanceCheck"] = None, None
    wake.set()
    return {"ok": True, "balance": org.get("creditBalance")}


def load():
    if not os.path.exists(RUNS):  # fresh checkout: start an empty job log
        return {"runs": []}
    with open(RUNS) as f:
        return json.load(f)


def save(data):
    tmp = RUNS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, RUNS)


def call(path, key, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        "Authorization": f"Bearer {key}", "X-Runway-Version": "2024-11-06",
        **({"Content-Type": "application/json"} if data else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def api_error(e):
    """Runway's own message from an HTTPError, for showing in the dashboard."""
    try:
        b = json.loads(e.read() or b"{}")
        msg = b.get("error") or b.get("message") or ""
        issues = b.get("issues") or []
        if issues and isinstance(issues, list):
            msg += " " + "; ".join(str(i.get("message", i)) if isinstance(i, dict) else str(i) for i in issues[:3])
        return msg.strip() or f"Runway API {e.code}"
    except Exception:
        return f"Runway API {e.code}"


# ---------- Generate: every model in Runway's OpenAPI spec, as forms ----------
SPEC_URL = "https://docs.dev.runwayml.com/openapi.json"
SPEC_FILE = os.path.join(ROOT, "runway_openapi.json")
INPUTS = os.path.join(ROOT, "inputs")
# (category, endpoint, task name, output type). Real-time avatars and recipes are left out: they aren't one-shot jobs.
TASKS = [
    ("Video", "text_to_video", "Text to video", "video"),
    ("Video", "image_to_video", "Image to video", "video"),
    ("Video", "video_to_video", "Video to video", "video"),
    ("Video", "character_performance", "Character performance", "video"),
    ("Image", "text_to_image", "Text to image", "image"),
    ("Image", "image_to_vector", "Image to vector", "image"),
    ("Audio", "text_to_speech", "Text to speech", "audio"),
    ("Audio", "sound_effect", "Sound effect", "audio"),
    ("Audio", "text_to_music", "Music", "audio"),
    ("Audio", "video_to_audio", "Sound for a video", "audio"),
    ("Audio", "speech_to_speech", "Voice changer", "audio"),
    ("Audio", "voice_isolation", "Voice isolation", "audio"),
    ("Audio", "voice_dubbing", "Dubbing", "audio"),
    ("Upscale & HDR", "image_upscale", "Image upscale", "image"),
    ("Upscale & HDR", "video_upscale", "Video upscale", "video"),
    ("Upscale & HDR", "video_to_hdr", "Video to HDR", "video"),
]
EXT_TYPE = {**{e: "image" for e in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg")},
            **{e: "video" for e in (".mp4", ".mov", ".webm", ".m4v")},
            **{e: "audio" for e in (".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".opus")}}
CT_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg",
          "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "audio/mpeg": ".mp3", "audio/wav": ".wav",
          "audio/x-wav": ".wav", "audio/flac": ".flac", "audio/ogg": ".ogg", "application/zip": ".zip"}
LONG_TEXT = {"promptText", "negativePrompt", "previousText", "nextText"}
MAIN = {"promptText", "ratio", "duration", "resolution", "quality", "promptImage", "promptVideo", "videoUri", "imageUri",
        "audioUri", "voice", "media", "character", "reference", "targetLang", "scaleFactor", "targetFramerate", "audio",
        "instrumental", "targetAspectRatio", "outputCount", "numVariants", "loop"}
catalog_cache = {"at": 0, "data": None}
upload_cache = {}


def type_of(name):
    return EXT_TYPE.get(os.path.splitext(name or "")[1].lower())


def human(name):
    s = "".join(" " + c.lower() if c.isupper() else c for c in name).replace("_", " ").strip()
    s = s.replace(" uri", "").replace("prompt text", "prompt").replace("prompt image", "start frame").replace("prompt video", "input video")
    return s[:1].upper() + s[1:]


def load_spec():
    if not os.path.exists(SPEC_FILE) or time.time() - os.path.getmtime(SPEC_FILE) > 86400:
        try:
            req = urllib.request.Request(SPEC_URL, headers={"User-Agent": "runway-dashboard"})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
            json.loads(raw)
            with open(SPEC_FILE + ".tmp", "wb") as f:
                f.write(raw)
            os.replace(SPEC_FILE + ".tmp", SPEC_FILE)
        except Exception:
            pass  # keep the cached copy
    if not os.path.exists(SPEC_FILE):
        return None
    with open(SPEC_FILE) as f:
        return json.load(f)


class Normalizer:
    """Turns one request schema property into a form field the dashboard can render, or None."""

    def __init__(self, spec):
        self.C = spec.get("components", {}).get("schemas", {})

    def R(self, p):
        while isinstance(p, dict) and "$ref" in p:
            p = self.C[p["$ref"].split("/")[-1]]
        return p or {}

    def is_uri(self, p):
        p = self.R(p)
        if p.get("type") == "string" and (p.get("format") == "uri" or p.get("minLength") == 13):
            return True
        alts = p.get("anyOf") or p.get("oneOf")
        return bool(alts) and all(self.is_uri(a) for a in alts)

    @staticmethod
    def kind_from(name):
        n = name.lower()
        for k in ("audio", "video", "image"):
            if k in n:
                return k
        return "image"

    def obj_media(self, name, o):
        o = self.R(o)
        props, req = o.get("properties", {}), set(o.get("required", []))
        key = next((k for k, v in props.items() if self.is_uri(v)), None)
        if not key:
            return None
        consts, tag = {}, False
        for k, v in props.items():
            v = self.R(v)
            if k == key:
                continue
            if "const" in v:
                consts[k] = v["const"]
            elif k == "tag":
                tag = k in req or True
            elif k in req:
                return None
        t = consts.get("type")
        kind = t if t in ("image", "video", "audio") else self.kind_from(key if key != "uri" else name)
        return {"kind": "media", "accept": [kind], "wrap": {kind: {"consts": consts, "key": key, "tag": tag}}}

    def obj_select(self, o):
        o = self.R(o)
        props, req = o.get("properties", {}), o.get("required", [])
        consts, pick = {}, None
        for k, v in props.items():
            v = self.R(v)
            if "const" in v:
                consts[k] = v["const"]
            elif "enum" in v and k in req and not pick:
                pick = (k, v["enum"])
            elif k in req:
                return None
        return {"kind": "select", "options": pick[1], "wrapKey": pick[0], "consts": consts} if pick else None

    def summary(self, p, depth=0):
        """A short, human type hint for a schema, e.g. 'array (max 2) of string' or 'one of: a, b'."""
        p = self.R(p)
        if "const" in p:
            return json.dumps(p["const"])
        if "enum" in p:
            e = p["enum"]
            return "one of: " + ", ".join(map(str, e[:8])) + (f" … ({len(e)})" if len(e) > 8 else "")
        alts = p.get("anyOf") or p.get("oneOf")
        if alts:
            if self.is_uri(p):
                return "URL, data URI or runway:// URI"
            return " | ".join(self.summary(a, depth + 1) for a in alts[:3]) + (" | …" if len(alts) > 3 else "")
        t = p.get("type")
        if t == "array":
            cap = f" (max {p['maxItems']})" if "maxItems" in p else ""
            return f"array{cap} of {self.summary(p.get('items', {}), depth + 1) if depth < 2 else '…'}"
        if t == "object" or "properties" in p:
            if depth >= 2:
                return "object"
            req = set(p.get("required", []))
            return "{" + ", ".join(f"{k}{'' if k in req else '?'}: {self.summary(v, depth + 1)}" for k, v in list(p.get("properties", {}).items())[:6]) + "}"
        if t in ("integer", "number"):
            rng = [f"min {p['minimum']}" if "minimum" in p else "", f"max {p['maximum']}" if "maximum" in p and p["maximum"] < 1e12 else ""]
            return t + (f" ({', '.join(x for x in rng if x)})" if any(rng) else "")
        if t == "string":
            return "text" + (f" (max {p['maxLength']})" if "maxLength" in p else "")
        return t or "value"

    def field(self, name, p, required):
        p = self.R(p)
        f = {"name": name, "label": human(name), "required": required, "desc": (p.get("description") or "")[:400]}
        if self.is_uri(p):
            return {**f, "kind": "media", "accept": [self.kind_from(name)], "max": 1}
        alts = p.get("anyOf") or p.get("oneOf")
        if alts:
            alts = [self.R(a) for a in alts]
            if any(self.is_uri(a) for a in alts):  # e.g. promptImage: a URI, or keyframe objects
                return {**f, "kind": "media", "accept": [self.kind_from(name)], "max": 1}
            consts = [a["const"] for a in alts if "const" in a]
            nums = [a for a in alts if a.get("type") in ("integer", "number")]
            if nums and len(consts) + len(nums) == len(alts):  # e.g. duration: 4-15 or "auto"
                g = self.field(name, nums[0], required)
                if g and g["kind"] == "select":
                    g["options"] = consts + g["options"]
                return g
            enums = [a for a in alts if "enum" in a]
            if enums:  # e.g. ratio: a list of sizes, or a free-form string
                return {**f, "kind": "select", "options": enums[0]["enum"], "default": p.get("default")}
            objs = [a for a in alts if "properties" in a]
            if objs and len(objs) == len(alts):
                media = [self.obj_media(name, o) for o in objs]
                media = [m for m in media if m]
                if media:
                    wrap, accept = {}, []
                    for m in media:
                        for k, v in m["wrap"].items():
                            if k not in wrap:
                                wrap[k], accept = v, accept + [k]
                    return {**f, "kind": "media", "accept": accept, "wrap": wrap, "max": 1}
                for o in objs:
                    sel = self.obj_select(o)
                    if sel:
                        return {**f, **sel}
            return None
        if "const" in p:
            return {**f, "kind": "const", "value": p["const"]}
        if "enum" in p:
            return {**f, "kind": "select", "options": p["enum"], "default": p.get("default")}
        t = p.get("type")
        if t == "boolean":
            return {**f, "kind": "bool", "default": p.get("default")}
        if t in ("integer", "number"):
            lo, hi = p.get("minimum"), p.get("maximum")
            if hi is not None and hi > 1e9:
                hi = None
            if t == "integer" and lo is not None and hi is not None and hi - lo <= 30 and name != "seed":
                return {**f, "kind": "select", "options": list(range(int(lo), int(hi) + 1)), "default": p.get("default")}
            if lo is not None and hi is not None and hi - lo <= 100 and name not in ("seed", "duration"):
                step = 1 if t == "integer" else (0.05 if hi - lo <= 2 else 0.1)
                return {**f, "kind": "range", "min": lo, "max": hi, "step": step, "default": p.get("default")}
            return {**f, "kind": "number", "int": t == "integer", "min": lo, "max": hi, "default": p.get("default")}
        if t == "string":
            if p.get("format") == "uuid":
                return None
            return {**f, "kind": "longtext" if name in LONG_TEXT else "text", "minLength": p.get("minLength"), "maxLength": p.get("maxLength")}
        if t == "array":
            it = self.R(p.get("items", {}))
            m = self.field(name, it, True) if self.is_uri(it) else (self.obj_media(name, it) if "properties" in it else None)
            if m and m["kind"] == "media":
                return {**f, **{k: v for k, v in m.items() if k not in f}, "kind": "media", "array": True,
                        "max": p.get("maxItems") or 10, "min": p.get("minItems") or (1 if required else 0)}
            return None
        if "properties" in p:
            m = self.obj_media(name, p)
            if m:
                return {**f, **m, "max": 1}
            sel = self.obj_select(p)
            if sel:
                return {**f, **sel}
        return None


# in the spec but rejected by Runway's API ("Unknown task type"), so not offered
HIDDEN_MODELS = {"gemini_3.8_flash_tts", "gemini_3.8_flash_lite_tts"}
# Runway prices these per job from the actual output, so the quote is a floor, not a promise
DYNAMIC_PRICE = ("magnific_",)


def build_catalog():
    if catalog_cache["data"] and time.time() - catalog_cache["at"] < 86400:
        return catalog_cache["data"]
    spec = load_spec()
    if not spec:
        return None
    N, tasks = Normalizer(spec), []
    for cat, ep, label, out in TASKS:
        try:
            body = N.R(spec["paths"][f"/v1/{ep}"]["post"]["requestBody"]["content"]["application/json"]["schema"])
        except KeyError:
            continue
        models = []
        for a in body.get("oneOf") or body.get("anyOf") or [body]:
            a = N.R(a)
            props, req = a.get("properties", {}), set(a.get("required", []))
            mid = N.R(props.get("model", {})).get("const")
            if not mid or mid in HIDDEN_MODELS:
                continue
            fields, missing, extra = [], [], []
            for k, v in props.items():
                if k == "model":
                    continue
                f = N.field(k, v, k in req)
                if f is None or (f["kind"] == "const" and k not in req):
                    if f is None:  # no form control for it: offered under Additional parameters as JSON
                        extra.append({"name": k, "required": k in req, "hint": N.summary(v)[:240],
                                      "desc": (N.R(v).get("description") or "")[:400]})
                        if k in req:
                            missing.append(k)
                    continue
                f["advanced"] = not (k in req or k in MAIN)
                fields.append(f)
            models.append({"id": mid, "fields": fields, "extra": extra, "needs": missing,
                           "keys": sorted(k for k in props if k != "model")})
        tasks.append({"category": cat, "endpoint": ep, "label": label, "output": out, "models": models})
    catalog_cache.update(at=time.time(), data={"tasks": tasks})
    return catalog_cache["data"]


def find_model(endpoint, model):
    cat = build_catalog() or {"tasks": []}
    task = next((t for t in cat["tasks"] if t["endpoint"] == endpoint), None)
    m = task and next((x for x in task["models"] if x["id"] == model), None)
    return task, m


def local_media(ref):
    """Resolve {"run": taskId} or {"input": filename} to (path, type, run or None)."""
    if ref.get("run"):
        base, _, n = str(ref["run"]).partition("~")  # "taskId~2" is a job's second file (outputCount > 1)
        with lock:
            r = next((x for x in load().get("runs", []) if x.get("taskId") == base), None)
        files = (r.get("assets") or ([r["asset"]] if r.get("asset") else [])) if r else []
        i = int(n) - 1 if n.isdigit() else 0
        name = files[i] if 0 <= i < len(files) else None
        if not name or not os.path.isfile(os.path.join(ROOT, name)):
            raise ValueError("One of the inputs isn't saved in the Runway folder anymore. Pick another.")
        return os.path.join(ROOT, name), type_of(name) or r.get("type"), r
    name = os.path.basename(str(ref.get("input") or ""))
    path = os.path.join(INPUTS, name)
    if not name or name.startswith(".") or not os.path.isfile(path):
        raise ValueError("One of the uploaded inputs is missing from the inputs folder. Choose it again.")
    return path, type_of(name), None


def runway_upload(path, key):
    """Upload a local file with Runway's uploads API and return its runway:// URI (cached for 12 h)."""
    st = os.stat(path)
    ck = (path, st.st_mtime, st.st_size)
    hit = upload_cache.get(ck)
    if hit and time.time() - hit[1] < 12 * 3600:
        return hit[0]
    name = os.path.basename(path)
    name = name if len(name) >= 3 else "in_" + name
    meta = call("/uploads", key, {"filename": name[-255:], "type": "ephemeral"})
    b = "----rd" + uuid.uuid4().hex
    parts = [f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in meta["fields"].items()]
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        raw = f.read()
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode()
                 + raw + f"\r\n--{b}--\r\n".encode())
    req = urllib.request.Request(meta["uploadUrl"], data=b"".join(parts), method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    urllib.request.urlopen(req, timeout=900).read()
    upload_cache[ck] = (meta["runwayUri"], time.time())
    return meta["runwayUri"]


def pick_option(f, v):
    for o in f["options"]:
        if o == v or str(o) == str(v):
            return o
    raise ValueError(f"{f['label']}: {v} isn't one of the options.")


def submit(body, key):
    """Validate a Generate request against the spec, upload its inputs, send it to Runway and log it in runs.json."""
    task, m = find_model(str(body.get("endpoint")), str(body.get("model")))
    if not m:
        raise ValueError("Pick a task and a model from the lists.")
    values, media, extra = body.get("values") or {}, body.get("media") or {}, body.get("extra") or {}
    if not isinstance(extra, dict):
        raise ValueError("Additional parameters must be a JSON object, like {\"seed\": 42}.")
    bad = [k for k in extra if k not in m["keys"]]
    if bad:
        raise ValueError(f"{m['id']} doesn't take {', '.join(bad)}. It takes: {', '.join(m['keys'])}.")
    missing = [k for k in m.get("needs", []) if k not in extra]
    if missing:
        raise ValueError(f"{m['id']} needs {', '.join(missing)}. Add them under Additional parameters.")
    req, params, inputs, parent, first_input = {"model": m["id"]}, {}, [], None, None
    for f in m["fields"]:
        n = f["name"]
        if n in extra:  # set by hand under Additional parameters
            continue
        if f["kind"] == "const":
            req[n] = f["value"]
            continue
        if f["kind"] == "media":
            refs = media.get(n) or []
            if not isinstance(refs, list):
                refs = [refs]
            if not refs:
                if f["required"]:
                    raise ValueError(f"Pick the {f['label'].lower()} first.")
                continue
            if len(refs) > f.get("max", 1) or len(refs) < f.get("min", 0):
                raise ValueError(f"{f['label']}: pick {f.get('min', 1)} to {f.get('max', 1)} files.")
            out = []
            for i, ref in enumerate(refs):
                path, kind, run = local_media(ref)
                if kind not in f["accept"]:
                    raise ValueError(f"{f['label']} takes {' or '.join(f['accept'])}, not {kind or 'this file type'}.")
                uri = runway_upload(path, key)
                w = (f.get("wrap") or {}).get(kind)
                if w:
                    o = dict(w["consts"])
                    o[w["key"]] = uri
                    if w.get("tag"):
                        o["tag"] = f"ref{i + 1}"
                    uri = o
                out.append(uri)
                inputs.append({"field": n, **({"run": run["taskId"]} if run else {"input": os.path.basename(path)})})
                parent = parent or (run and run["taskId"])
                first_input = first_input or os.path.basename(path)
            req[n] = out if f.get("array") else out[0]
            continue
        v = values.get(n)
        if v is None or v == "":
            if f["required"]:
                raise ValueError(f"Fill in {f['label'].lower()} first.")
            continue
        k = f["kind"]
        if k == "select":
            v = pick_option(f, v)
            req[n] = {**f["consts"], f["wrapKey"]: v} if f.get("wrapKey") else v
        elif k == "bool":
            req[n] = bool(v)
        elif k in ("number", "range"):
            try:
                v = float(v)
            except (TypeError, ValueError):
                raise ValueError(f"{f['label']} must be a number.")
            if f.get("int") or (k == "range" and f.get("step") == 1):
                v = int(round(v))
            if (f.get("min") is not None and v < f["min"]) or (f.get("max") is not None and v > f["max"]):
                raise ValueError(f"{f['label']} must be between {f.get('min')} and {f.get('max')}.")
            req[n] = v
        else:
            v = str(v).strip()
            if f.get("maxLength") and len(v) > f["maxLength"]:
                raise ValueError(f"{f['label']} is {len(v)} characters. Runway accepts up to {f['maxLength']}.")
            if f.get("minLength") and len(v) < f["minLength"]:
                raise ValueError(f"{f['label']} needs at least {f['minLength']} characters.")
            req[n] = v
        params[n] = v
    if extra:
        req.update(extra)
        params["extra"] = extra
    try:
        task_resp = call(f"/{task['endpoint']}", key, req)
    except urllib.error.HTTPError as e:
        raise ValueError(api_error(e))
    now = datetime.now().astimezone()
    bits = [str(params[k]) for k in ("ratio", "resolution", "quality", "targetLang", "targetAspectRatio") if k in params]
    if "duration" in params:
        bits.append(f"{params['duration']}s" if params["duration"] != "auto" else "auto length")
    if "scaleFactor" in params:
        bits.append(f"×{params['scaleFactor']}")
    if "voice" in params:
        bits.append(f"voice {params['voice']}")
    prompt = str(params.get("promptText") or "").strip() or (f"{task['label']} of {first_input}" if first_input else task["label"])
    row = {"date": now.strftime("%Y-%m-%d"), "taskId": task_resp["id"], "type": task["output"], "model": m["id"],
           "endpoint": task["endpoint"], "task": task["label"], "settings": " · ".join(bits) or task["label"], "prompt": prompt,
           "params": params, "inputs": inputs, "status": "pending", "credits": None, "asset": None,
           "createdAt": now.isoformat(timespec="seconds"), "origin": "dashboard"}
    if isinstance(params.get("duration"), (int, float)):
        row["duration"] = params["duration"]
    q = quote(body)
    if q.get("credits") is not None:
        row["quotedCredits"], row["quoteExact"] = q["credits"], bool(q.get("exact"))
    if parent:
        row["parent"] = parent
    with lock:
        data = load()
        data.setdefault("runs", []).append(row)
        save(data)
    wake.set()
    return row


usage_cache = {}
probe_cache = {}


def probe(path):
    """Width, height, seconds and fps of a local media file (ffprobe), cached by path and mtime."""
    st = os.stat(path)
    ck = (path, st.st_mtime)
    if ck in probe_cache:
        return probe_cache[ck]
    out = {}
    if shutil.which("ffprobe"):
        r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
                           capture_output=True, text=True, check=False)
        try:
            j = json.loads(r.stdout or "{}")
            v = next((x for x in j.get("streams", []) if x.get("codec_type") == "video"), {})
            out = {"w": v.get("width"), "h": v.get("height"), "seconds": float(j.get("format", {}).get("duration") or 0) or None}
            if v.get("r_frame_rate") and "/" in v["r_frame_rate"]:
                a, b = v["r_frame_rate"].split("/")
                out["fps"] = round(int(a) / int(b), 3) if int(b) else None
        except Exception:
            out = {}
    probe_cache[ck] = out
    return out


def quote(body):
    """Exact price before submitting, from pricing.py and the real sizes and lengths of the chosen inputs."""
    try:
        from pricing import estimate
    except Exception as e:
        return {"credits": None, "exact": False, "note": f"pricing table unavailable ({type(e).__name__})"}
    task, m = find_model(str(body.get("endpoint")), str(body.get("model")))
    if not m:
        return {"credits": None, "exact": False, "note": "unknown model"}
    # form values arrive as text (e.g. scaleFactor "2"): convert them the way submit() does
    params = dict(body.get("values") or {})
    for f in m["fields"]:
        v = params.get(f["name"])
        if v is None or v == "":
            continue
        try:
            if f["kind"] == "select" and not f.get("wrapKey"):
                params[f["name"]] = pick_option(f, v)
            elif f["kind"] in ("number", "range"):
                params[f["name"]] = int(float(v)) if (f.get("int") or f.get("step") == 1) else float(v)
        except (ValueError, TypeError):
            pass
    params.update(body.get("extra") or {})
    inputs = {}
    for f in m["fields"]:
        if f["kind"] != "media":
            continue
        refs = (body.get("media") or {}).get(f["name"]) or []
        refs = refs if isinstance(refs, list) else [refs]
        info = []
        for ref in refs:
            try:
                path, kind, _ = local_media(ref)
                info.append((kind, probe(path)))
            except Exception:
                pass
        if not info:
            continue
        n, kinds = f["name"], [k for k, _ in info]
        if n in ("references", "referenceImages"):
            inputs["referenceImages"] = inputs.get("referenceImages", 0) + kinds.count("image")
        elif n == "referenceVideos":
            inputs["referenceVideos"] = len(info)
            inputs["referenceVideoSeconds"] = [p.get("seconds") or 0 for _, p in info]
        elif n == "referenceAudio" or n == "referenceAudios":
            inputs["referenceAudio"] = len(info)
        elif n == "promptImage":
            inputs["promptImages"] = len(info)
        elif n == "imageUri":
            inputs["inputImageWidth"], inputs["inputImageHeight"] = info[0][1].get("w"), info[0][1].get("h")
        elif kinds[0] == "video":
            p = info[0][1]
            inputs.update(inputVideoSeconds=p.get("seconds"), inputVideoWidth=p.get("w"), inputVideoHeight=p.get("h"), inputVideoFps=p.get("fps"))
        elif kinds[0] == "audio":
            inputs["inputAudioSeconds"] = info[0][1].get("seconds")
    inputs = {k: v for k, v in inputs.items() if v not in (None, [])}
    try:
        q = estimate(task["endpoint"], m["id"], params, inputs)
        if m["id"].startswith(DYNAMIC_PRICE) and q.get("credits") is not None:
            q["exact"] = False
            q["note"] = "Magnific prices vary per job. Runway reports the real cost when it finishes."
        return q
    except Exception as e:
        return {"credits": None, "exact": False, "note": f"couldn't price this ({type(e).__name__}: {e})"}


def org_usage(days, key):
    """Credits the whole org spent per model per day (Runway's /organization/usage), cached 5 minutes."""
    days = max(1, min(90, int(days)))
    hit = usage_cache.get(days)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    from datetime import date, timedelta
    before = date.today() + timedelta(days=1)  # beforeDate is exclusive, so include today
    start = before - timedelta(days=days)
    try:
        r = call("/organization/usage", key, {"startDate": start.isoformat(), "beforeDate": before.isoformat()})
    except urllib.error.HTTPError as e:
        raise ValueError(api_error(e))
    out = {"startDate": start.isoformat(), "beforeDate": before.isoformat(), "days": days,
           "results": r.get("results", []), "models": r.get("models", []),
           "fetchedAt": datetime.now().astimezone().isoformat(timespec="seconds")}
    usage_cache[days] = (time.time(), out)
    return out


def save_upload(handler, length):
    """Stream a file from the browser into inputs/ and return its name and type."""
    handler.upload_left = length  # bytes not read yet, for draining the request on an error
    raw = urllib.parse.unquote(handler.headers.get("X-Filename") or "upload")
    base = os.path.basename(raw).lstrip(".") or "upload"
    stem, ext = os.path.splitext(base)
    if not type_of(base):
        raise ValueError("Only images, videos and audio files can be used as inputs.")
    os.makedirs(INPUTS, exist_ok=True)
    name, i = base, 1
    while os.path.exists(os.path.join(INPUTS, name)):
        i += 1
        name = f"{stem} ({i}){ext}"
    tmp = os.path.join(INPUTS, "." + name + ".part")
    left = length
    with open(tmp, "wb") as f:
        while left > 0:
            chunk = handler.rfile.read(min(1 << 20, left))
            if not chunk:
                break
            f.write(chunk)
            left -= len(chunk)
            handler.upload_left = left
    if left:
        os.remove(tmp)
        raise ValueError("The upload was cut off. Try again.")
    os.replace(tmp, os.path.join(INPUTS, name))
    return {"file": name, "type": type_of(name)}


def list_inputs():
    if not os.path.isdir(INPUTS):
        return []
    out = [(os.path.getmtime(os.path.join(INPUTS, n)), n) for n in os.listdir(INPUTS) if not n.startswith(".") and type_of(n)]
    return [{"file": n, "type": type_of(n)} for _, n in sorted(out, reverse=True)]


def download(url, run, i=0):
    """Save one output next to this file; the extension comes from the URL, else the content type."""
    with urllib.request.urlopen(url, timeout=600) as r:
        ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
        if not ext or len(ext) > 6:
            ext = CT_EXT.get((r.headers.get("Content-Type") or "").split(";")[0].strip(), "")
        ext = ext or {"video": ".mp4", "audio": ".mp3"}.get(run.get("type"), ".png")
        name = f"{run.get('date', 'job')}_{run.get('type', 'asset')}_{run['taskId'][:8]}{f'_{i + 1}' if i else ''}{ext}"
        tmp = os.path.join(ROOT, "." + name + ".part")  # renamed into place once complete
        try:
            with open(tmp, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
        except BaseException:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise
    os.replace(tmp, os.path.join(ROOT, name))
    return name


TERMINAL = {"succeeded", "failed", "cancelled"}
HISTORY = os.path.join(ROOT, "balance_history.json")


def credits_of(v):
    if isinstance(v, dict):
        v = v.get("credits")
    return v if isinstance(v, (int, float)) else None


def task_updates(run, t):
    """Fields to copy from a Runway task onto its row in runs.json."""
    u, st = {}, (t.get("status") or "").lower()
    if st:
        u["status"] = st
        if st in TERMINAL and run.get("status") in ACTIVE:
            u["finishedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
    if t.get("createdAt"):
        u["createdAt"] = t["createdAt"]
    u["progress"] = t.get("progress") if st == "running" else None
    est, cost = credits_of(t.get("estimatedCost")), credits_of(t.get("cost"))
    if est is not None:
        u["estimatedCredits"] = est
    if cost is not None:
        u["credits"], u["costSource"] = cost, "runway"
    if t.get("failure"):
        u["failure"] = t["failure"]
    if t.get("failureCode"):
        u["failureCode"] = t["failureCode"]
    if st in TERMINAL:
        u["synced"] = True
    if st == "succeeded" and t.get("output") and not run.get("asset"):
        # the files are downloaded by the worker thread, which marks the job succeeded once they're saved,
        # so the row never says succeeded without its file and a big download doesn't hold up the sync
        final = {k: u.pop(k) for k in ("status", "finishedAt", "synced") if k in u}
        enqueue_download(run, list(t["output"]), final)
    return u


# ---------- worker thread: downloads and thumbnails, off the sync loop ----------
work = queue.Queue()
work_lock = threading.Lock()
downloading = set()  # task IDs queued or being downloaded
work_state = {"postersQueued": False, "downloadError": None}


def enqueue_download(run, urls, final):
    with work_lock:
        if run["taskId"] in downloading:
            return
        downloading.add(run["taskId"])
    work.put(("download", dict(run), urls, final))


def enqueue_posters():
    with work_lock:
        if work_state["postersQueued"]:
            return
        work_state["postersQueued"] = True
    work.put(("posters",))


def finish_download(run, urls, final):
    """Save a succeeded job's files, then mark its row succeeded with them and make their thumbnails."""
    names = [download(url, run, i) for i, url in enumerate(urls)]
    u = {**final, "asset": names[0], "type": type_of(names[0]) or run.get("type")}
    if len(names) > 1:
        u["assets"] = names
    u.setdefault("finishedAt", datetime.now().astimezone().isoformat(timespec="seconds"))
    with lock:
        data = load()
        for r in data.get("runs", []):
            if r.get("taskId") == run["taskId"]:
                r.update(u)
        save(data)
    for n in names:
        make_thumb(n, os.path.join(ROOT, n))


def worker():
    while True:
        item = work.get()
        try:
            if item[0] == "download":
                try:
                    finish_download(*item[1:])
                    work_state["downloadError"] = None
                except Exception as e:  # tried again on the next sync
                    work_state["downloadError"] = f"Couldn't download a finished job's file ({type(e).__name__})"
                finally:
                    with work_lock:
                        downloading.discard(item[1]["taskId"])
            elif item[0] == "posters":
                with work_lock:
                    work_state["postersQueued"] = False
                make_posters()
        except Exception:
            pass
        finally:
            work.task_done()


history_cache = {"sig": None, "hist": []}


def load_history():
    """balance_history.json as [[unix time, balance], ...], parsed again only when the file changes. Don't mutate it."""
    sig = file_sig(HISTORY)
    if sig != history_cache["sig"]:
        try:
            with open(HISTORY) as f:
                hist = json.load(f)
        except Exception:
            hist = []
        history_cache.update(sig=sig, hist=hist if isinstance(hist, list) else [])
    return history_cache["hist"]


def record_balance(balance):
    hist = load_history()
    if not hist or hist[-1][1] != balance:
        hist = (hist + [[int(time.time()), balance]])[-20000:]
        tmp = HISTORY + ".tmp"
        with open(tmp, "w") as f:
            json.dump(hist, f)
        os.replace(tmp, HISTORY)


def spent_today(runs, hist=None):
    """Credits the whole org spent since local midnight, for the daily limit in Options.
    From balance_history.json: start at the last balance at or before midnight and add up every drop
    after it (a rise is a top-up, not spending), so jobs from Claude, this app and other tools all count.
    The credits of today's jobs in runs.json are the fallback when there is no history, and the floor
    when the history only starts after midnight."""
    midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    m = midnight.timestamp()
    jobs = 0
    for r in runs:
        try:
            t = datetime.fromisoformat((r.get("createdAt") or "").replace("Z", "+00:00"))
        except ValueError:
            continue
        if t.tzinfo and t.timestamp() >= m and isinstance(r.get("credits"), (int, float)):
            jobs += r["credits"]
    hist = load_history() if hist is None else hist
    pts = [h for h in hist if h[0] <= m][-1:] + [h for h in hist if h[0] > m]
    out = {"spentToday": jobs, "spentSource": "jobs", "spentSince": midnight.isoformat(timespec="seconds")}
    if pts:
        drops = sum(max(0, a[1] - b[1]) for a, b in zip(pts, pts[1:]))
        if pts[0][0] <= m or drops >= jobs:
            out.update(spentToday=drops, spentSource="balance")
    return out


def tick(key):
    with lock:
        data = load()
    now, balance = time.time(), None
    if not state["lastBalanceCheck"] or now - state["lastBalanceCheck"] >= BALANCE_EVERY:
        org = call("/organization", key)
        state["lastBalanceCheck"] = now
        balance = org.get("creditBalance")
        if balance is not None:
            record_balance(balance)
    updates = {}
    for run in data.get("runs", []):
        tid = run.get("taskId")
        if not tid or (run.get("synced") and run.get("status") not in ACTIVE):
            continue
        try:
            updates[tid] = task_updates(run, call(f"/tasks/{tid}", key))
        except urllib.error.HTTPError as e:
            if e.code == 404:  # Runway no longer keeps this task (cancelled tasks are deleted)
                updates[tid] = {"synced": True, "progress": None}
                if run.get("status") in ACTIVE:
                    updates[tid].update(status="cancelled", finishedAt=datetime.now().astimezone().isoformat(timespec="seconds"))
            else:
                raise
    if balance is not None:  # the time of the last check is served from memory; runs.json gets it when it's written
        state["balanceAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
    with lock:
        # merge into the freshest file so rows added meanwhile are kept; write it only when something changed
        fresh, changed = load(), False
        for r in fresh.get("runs", []):
            u = updates.get(r.get("taskId"))
            if u and any(r.get(k) != v for k, v in u.items()):
                r.update(u)
                changed = True
        if balance is not None and fresh.get("balance") != balance:
            fresh["balance"] = balance
            changed = True
        if changed:
            if state["balanceAt"]:
                fresh["balanceAt"] = state["balanceAt"]
            save(fresh)


THUMBS = os.path.join(ROOT, "thumbs")
THUMB_W = 320
thumb_lock = threading.Lock()
thumb_failed = set()  # (source, mtime) that couldn't be made into a thumbnail, so they aren't retried every pass


def make_thumb(name, src):
    """Write thumbs/<name>.jpg, about THUMB_W px wide: a still frame of a video (ffmpeg) or a smaller copy of an image
    (sips on macOS, else ffmpeg). Written to a temp file and renamed, so a half-written thumbnail is never served.
    Returns True when the thumbnail exists afterwards."""
    out = os.path.join(THUMBS, name + ".jpg")
    kind = type_of(name)
    if os.path.exists(out):
        return True
    if kind not in ("image", "video") or not os.path.isfile(src):
        return False
    with thumb_lock:
        if os.path.exists(out):
            return True
        ck = (src, os.path.getmtime(src))
        if ck in thumb_failed:
            return False
        os.makedirs(THUMBS, exist_ok=True)
        tmp = os.path.join(THUMBS, "." + name + "." + uuid.uuid4().hex[:8] + ".tmp.jpg")
        scale = f"scale='min({THUMB_W},iw)':-2"
        try:
            if kind == "video" or not shutil.which("sips"):
                if not shutil.which("ffmpeg"):
                    return False
                seek = ["-ss", "0.3"] if kind == "video" else []
                subprocess.run(["ffmpeg", "-v", "error", "-y", *seek, "-i", src, "-frames:v", "1", "-vf", scale, "-q:v", "4", tmp],
                               check=False, timeout=120, stdin=subprocess.DEVNULL)
            else:
                cmd = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "80"]
                r = subprocess.run(["sips", "-g", "pixelWidth", src], capture_output=True, text=True, check=False, timeout=60)
                try:
                    w = float(r.stdout.strip().rsplit(" ", 1)[-1])
                except ValueError:
                    w = 0
                cmd += ["--resampleWidth", str(THUMB_W)] if w > THUMB_W or not w else []
                subprocess.run(cmd + [src, "--out", tmp], capture_output=True, check=False, timeout=120)
            if os.path.isfile(tmp) and os.path.getsize(tmp) > 0:
                os.replace(tmp, out)
                return True
            thumb_failed.add(ck)
            return False
        except (OSError, subprocess.SubprocessError):
            thumb_failed.add(ck)
            return False
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)


def thumb_sources():
    """(name, path) of every image and video the job log and inputs/ hold."""
    with lock:
        runs = load().get("runs", [])
    out = [(a, os.path.join(ROOT, a)) for r in runs for a in ([r.get("asset")] + (r.get("assets") or []))
           if a and type_of(a) in ("image", "video")]
    out += [(i["file"], os.path.join(INPUTS, i["file"])) for i in list_inputs() if i["type"] in ("image", "video")]
    return out


state_cache = {"key": None, "body": None, "tag": None}


def state_body():
    """The /api/state reply and its ETag, built again only when something it's made from changes: runs.json,
    balance_history.json, the inputs folder, the key, the sync error, the last balance check, the day (for the
    daily spend) or which history points fall in the last 24 h."""
    hist = load_history()
    first = bisect.bisect_left(hist, time.time() - 86400, key=lambda h: h[0])  # first point inside the window
    k = api_key()
    try:
        inputs_sig = os.stat(INPUTS).st_mtime_ns
    except OSError:
        inputs_sig = None
    # stat everything before reading it: a file changed in between is then read fresh on the next request
    ck = (file_sig(RUNS), history_cache["sig"], first, inputs_sig, key_cache["sig"], bool(os.environ.get("RUNWAYML_API_SECRET")),
          state["error"], state["balanceAt"], datetime.now().astimezone().date())
    if ck == state_cache["key"]:
        return state_cache["body"], state_cache["tag"]
    with lock:
        data = load()
    data["live"] = bool(k)
    data["keySource"] = key_source()
    data["keyHint"] = k[-4:] if k and len(k) >= 12 else None
    data["inputs"] = list_inputs()
    data["error"] = state["error"]
    if state["balanceAt"] and (data.get("balanceAt") or "") < state["balanceAt"]:
        data["balanceAt"] = state["balanceAt"]
    data["history"] = hist[max(0, first - 1):]  # with the last point before the window, for a flat start
    data.update(spent_today(data.get("runs", []), hist))
    body = json.dumps(data).encode()
    tag = '"' + hashlib.sha1(body).hexdigest()[:20] + '"'
    state_cache.update(key=ck, body=body, tag=tag)
    return body, tag


def make_posters():
    """A thumbnail in thumbs/ for each image and video asset and input that has none yet."""
    for name, src in thumb_sources():
        make_thumb(name, src)


def loop():
    seen = None
    while True:
        try:  # look for missing thumbnails only when the job log or the inputs folder changed
            sig = (file_sig(RUNS), os.stat(INPUTS).st_mtime_ns if os.path.isdir(INPUTS) else None)
            if sig != seen:
                seen = sig
                enqueue_posters()
        except OSError:
            pass
        key = api_key()
        if key:
            try:
                tick(key)
                state["error"] = work_state["downloadError"]
            except urllib.error.HTTPError as e:
                state["error"] = f"Runway API {e.code}"
            except Exception as e:  # network blips etc.
                state["error"] = type(e).__name__
        wake.wait(POLL_EVERY)
        wake.clear()


# ---------- notes: plain-text files in notes/ next to this file (the Notes window) ----------
NOTES = os.path.join(ROOT, "notes")
NOTE_EXTS = (".txt", ".md", ".py", ".js", ".json", ".sh", ".html", ".css")
NOTE_MAX = 2 * 1024 * 1024  # bytes of UTF-8 text per note
notes_lock = threading.Lock()


def note_name(raw):
    """A safe file name inside notes/: no folders, no leading dot, one of NOTE_EXTS (.txt is added when missing)."""
    name = " ".join(str(raw or "").split())  # no tabs or newlines, single spaces
    if not name:
        raise ValueError("Type a name for the note.")
    if len(name) > 100:
        raise ValueError("Names can be up to 100 characters.")
    if name.startswith(".") or any(c in name for c in '/\\:*?"<>|') or any(ord(c) < 32 for c in name):
        raise ValueError('Names can\'t start with a dot or contain / \\ : * ? " < > |')
    if os.path.splitext(name)[1].lower() not in NOTE_EXTS:
        name += ".txt"
    if not os.path.splitext(name)[0].strip(" ."):
        raise ValueError("Type a name for the note.")
    return name


def note_info(name):
    st = os.stat(os.path.join(NOTES, name))
    return {"name": name, "size": st.st_size,
            "modified": datetime.fromtimestamp(st.st_mtime).astimezone().isoformat(timespec="seconds")}


def list_notes():
    if not os.path.isdir(NOTES):
        return []
    out = []
    for n in os.listdir(NOTES):
        if n.startswith(".") or os.path.splitext(n)[1].lower() not in NOTE_EXTS or not os.path.isfile(os.path.join(NOTES, n)):
            continue
        out.append(note_info(n))
    return sorted(out, key=lambda x: x["name"].lower())


def note_path(raw, must_exist=True):
    name = note_name(raw)
    path = os.path.join(NOTES, name)
    if must_exist and not os.path.isfile(path):
        raise FileNotFoundError(f"{name} isn't in the notes folder anymore.")
    return name, path


def note_write(path, text):
    data = str(text).encode("utf-8")
    if len(data) > NOTE_MAX:
        raise ValueError("Notes can be up to 2 MB.")
    os.makedirs(NOTES, exist_ok=True)
    tmp = os.path.join(NOTES, "." + os.path.basename(path) + "." + uuid.uuid4().hex[:8] + ".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)  # atomic: a reader sees the old text or the new one, never half


def notes_post(action, body):
    """POST /api/notes (save), /api/notes/rename, /api/notes/delete, /api/notes/reveal."""
    with notes_lock:
        if action == "notes":  # save {name, text, create?}: create refuses to overwrite an existing note
            name, path = note_path(body.get("name"), must_exist=False)
            if body.get("create") and os.path.exists(path):
                raise FileExistsError(f"There's already a note named {name}.")
            note_write(path, body.get("text", ""))
            return note_info(name)
        if action == "rename":
            name, path = note_path(body.get("name"))
            to, dest = note_path(body.get("to"), must_exist=False)
            if to != name:
                if os.path.exists(dest) and to.lower() != name.lower():
                    raise FileExistsError(f"There's already a note named {to}.")
                os.replace(path, dest)
            return note_info(to)
        if action == "delete":
            name, path = note_path(body.get("name"))
            os.remove(path)
            return {"ok": True}
        if action == "reveal":  # the note in Finder, or the folder itself
            os.makedirs(NOTES, exist_ok=True)
            if body.get("name"):
                name, path = note_path(body.get("name"))
                subprocess.run(["open", "-R", path], check=False)
            else:
                subprocess.run(["open", NOTES], check=False)
            return {"ok": True}
    raise LookupError


class Server(ThreadingHTTPServer):
    # the default listen backlog is 5: a page asking for dozens of thumbnails at once got connections refused or reset
    request_queue_size = 128
    daemon_threads = True


DRAIN_MAX = 64 * 1024 * 1024  # request bodies up to this size are read and dropped before an early error reply


class Handler(SimpleHTTPRequestHandler):
    # keep-alive: every reply below carries Content-Length (or is a 204/304 with no body), so the browser can reuse
    # connections instead of opening one per thumbnail; an idle connection is closed after `timeout` seconds
    protocol_version = "HTTP/1.1"
    timeout = 120

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def send_response(self, code, message=None):
        self._code, self._cache_set = code, False
        super().send_response(code, message)

    def send_header(self, keyword, value):
        if keyword.lower() == "cache-control":
            self._cache_set = True
        super().send_header(keyword, value)

    def end_headers(self):
        # static files: the page's own code revalidates every load (so an edit shows up on reload), while thumbnails
        # and media, whose names never get reused for other content, are cached for a day
        if not getattr(self, "_cache_set", True) and getattr(self, "_code", 0) in (200, 206, 304):
            path = urllib.parse.unquote(self.path.split("?")[0]).lower()
            media = path.startswith(("/thumbs/", "/inputs/")) or (path.count("/") == 1 and type_of(path))
            if media:
                self.send_header("Cache-Control", "max-age=86400")
                if self._code != 304:
                    self.send_header("Accept-Ranges", "bytes")
            elif path.endswith(("/", ".js", ".mjs", ".css", ".html", ".svg")):
                self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def body_length(self):
        try:
            return max(0, int(self.headers.get("Content-Length", 0) or 0))
        except ValueError:
            return 0

    def drain(self, length):
        """Read and drop an unread request body before answering early: closing a socket with unread data
        makes the kernel reset the connection, and the browser then sees a reset instead of our reply."""
        if length > DRAIN_MAX:
            self.close_connection = True
            return
        while length > 0:
            chunk = self.rfile.read(min(1 << 16, length))
            if not chunk:
                break
            length -= len(chunk)

    def do_GET(self):
        route = self.path.split("?")[0]
        if route == "/api/notes" or route.startswith("/api/notes/"):
            try:
                if route == "/api/notes":
                    self.send_json(200, {"notes": list_notes()})
                else:
                    name, path = note_path(urllib.parse.unquote(route[len("/api/notes/"):]))
                    with open(path, "rb") as f:
                        text = f.read().decode("utf-8", errors="replace")
                    self.send_json(200, {**note_info(name), "text": text})
            except ValueError as e:
                self.send_json(400, {"error": str(e)})
            except FileNotFoundError as e:
                self.send_json(404, {"error": str(e)})
            except OSError as e:
                self.send_json(500, {"error": f"Couldn't read the notes folder ({type(e).__name__})."})
            return
        if self.path.startswith("/api/usage"):
            key = api_key()
            if not key:
                self.send_json(400, {"error": "No Runway API key. Add it from Start → Runway API key…"})
                return
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                self.send_json(200, org_usage(q.get("days", ["30"])[0], key))
            except ValueError as e:
                self.send_json(502, {"error": str(e)})
            except Exception as e:
                self.send_json(502, {"error": f"Couldn't reach Runway ({type(e).__name__})."})
            return
        if self.path.startswith("/api/models"):
            cat = build_catalog()
            self.send_json(200 if cat else 503, cat or {"error": "Couldn't download Runway's model list. Check the connection."})
            return
        if self.path.startswith("/api/state"):
            body, tag = state_body()
            if self.headers.get("If-None-Match") == tag:  # nothing changed since the page's last poll
                self.send_response(304)
                self.send_header("ETag", tag)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("ETag", tag)
            self.end_headers()
            self.wfile.write(body)
            return
        if any(seg.startswith(".") for seg in urllib.parse.unquote(self.path.split("?")[0]).split("/")):
            self.send_error(404)  # never serve .runway_key
            return
        if route.startswith("/thumbs/") and route.endswith(".jpg") and self.thumb_fallback(route):
            return
        if self.headers.get("Range") and self.send_range():
            return
        super().do_GET()


    def send_range(self):
        """Answer a single-range request (bytes=a-b, a- or -n) for a media file with 206 Partial Content, or 416 when
        it starts past the end, so a video can seek into a part it hasn't loaded yet. Returns False to serve the whole
        file instead: not a media file, several ranges, an unreadable header, or an If-Range that doesn't match."""
        path = self.translate_path(self.path)
        if not type_of(path) or not os.path.isfile(path):
            return False
        spec = self.headers.get("Range", "").strip()
        if not spec.startswith("bytes=") or "," in spec:
            return False
        first, _, last = spec[len("bytes="):].strip().partition("-")
        try:
            size = os.path.getsize(path)
            mtime = os.path.getmtime(path)
            if first == "":
                start, end = max(0, size - int(last)), size - 1
            else:
                start, end = int(first), min(int(last), size - 1) if last else size - 1
        except (ValueError, OSError):
            return False
        last_modified = self.date_time_string(int(mtime))
        if self.headers.get("If-Range") and self.headers["If-Range"] != last_modified:
            return False
        if start >= size or start > end or start < 0:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        length = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Last-Modified", last_modified)
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                while length > 0:
                    chunk = f.read(min(1 << 16, length))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    length -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the player moved on (a seek, a closed window)
        if length:
            self.close_connection = True
        return True

    def thumb_fallback(self, route):
        """A thumbnail that isn't made yet (a job that just finished, an upload): make it now; if that fails for an
        image, redirect to the full image. Returns True when it answered the request itself."""
        name = urllib.parse.unquote(route[len("/thumbs/"):-len(".jpg")])
        if "/" in name or os.path.exists(os.path.join(THUMBS, name + ".jpg")):
            return False
        src = next((p for p in (os.path.join(ROOT, name), os.path.join(INPUTS, name)) if os.path.isfile(p)), None)
        if not src or make_thumb(name, src) or type_of(name) != "image":
            return False
        self.send_response(302)
        self.send_header("Location", ("/inputs/" if src.startswith(INPUTS + os.sep) else "/") + urllib.parse.quote(name))
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        return True

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def same_origin(self):
        """Only this page may POST: blocks other websites (CSRF) and DNS-rebinding hosts from spending credits."""
        ok = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
        origin = self.headers.get("Origin")
        return (self.headers.get("Host") in ok
                and (self.headers.get("Content-Type") or "").split(";")[0] in ("application/json", "application/octet-stream")
                and (origin is None or origin.split("://", 1)[-1] in ok))

    def do_POST(self):
        route = self.path.split("?")[0]
        length = self.body_length()
        if route in ("/api/notes", "/api/notes/rename", "/api/notes/delete", "/api/notes/reveal"):
            if not self.same_origin():
                self.drain(length)
                self.send_error(403)
                return
            if length > NOTE_MAX * 2 + 4096:
                self.drain(length)
                self.send_json(413, {"error": "Notes can be up to 2 MB."})
                return
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
                self.send_json(200, notes_post(route.rsplit("/", 1)[-1], body if isinstance(body, dict) else {}))
            except FileExistsError as e:
                self.send_json(409, {"error": str(e)})
            except FileNotFoundError as e:
                self.send_json(404, {"error": str(e)})
            except ValueError as e:  # bad name, too big, or not JSON
                self.send_json(400, {"error": str(e) if not isinstance(e, json.JSONDecodeError) else "Couldn't read the request."})
            except OSError as e:
                self.send_json(500, {"error": f"Couldn't write to the notes folder ({type(e).__name__})."})
            return
        action = self.path.split("?")[0].rsplit("/", 1)[-1]
        if not self.path.startswith("/api/") or action not in ("reveal", "open", "generate", "cancel", "key", "upload", "price"):
            self.drain(length)
            self.send_error(404)
            return
        if not self.same_origin():
            self.drain(length)
            self.send_error(403)
            return
        if action == "upload":
            try:
                if length > 2 * 1024 ** 3:
                    raise ValueError("Files over 2 GB can't be used as inputs.")
                self.send_json(200, save_upload(self, length))
            except ValueError as e:
                self.drain(getattr(self, "upload_left", length))
                self.send_json(400, {"error": str(e)})
            return
        if length > 12 * 1024 * 1024:
            self.drain(length)
            self.send_json(413, {"error": "The request is too big. Start frames must be under 5 MB."})
            return
        if action == "price":
            try:
                self.send_json(200, quote(json.loads(self.rfile.read(length) or b"{}")))
            except Exception as e:
                self.send_json(400, {"error": f"Couldn't read the request ({type(e).__name__})."})
            return
        if action == "key":
            try:
                self.send_json(200, set_key(json.loads(self.rfile.read(length) or b"{}")))
            except ValueError as e:
                self.send_json(400, {"error": str(e)})
            except Exception as e:
                self.send_json(502, {"error": f"Couldn't reach Runway to check the key ({type(e).__name__})."})
            return
        if action in ("generate", "cancel"):
            key = api_key()
            if not key:
                self.drain(length)
                self.send_json(400, {"error": "No Runway API key. Put it in .runway_key next to server.py."})
                return
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
                if action == "generate":
                    self.send_json(200, submit(body, key))
                else:
                    tid = str(body.get("taskId", ""))
                    with lock:
                        run = next((r for r in load().get("runs", []) if r.get("taskId") == tid), None)
                    if not run or run.get("status") not in ACTIVE:
                        self.send_json(400, {"error": "Only queued or rendering jobs can be cancelled."})
                        return
                    call(f"/tasks/{tid}", key, method="DELETE")
                    with lock:  # mark it right away; Runway may delete the task, so a later sync can't tell
                        d = load()
                        for r in d.get("runs", []):
                            if r.get("taskId") == tid and r.get("status") in ACTIVE:
                                r.update(status="cancelled", synced=True, progress=None,
                                         finishedAt=datetime.now().astimezone().isoformat(timespec="seconds"))
                        save(d)
                    wake.set()
                    self.send_json(200, {"ok": True})
            except urllib.error.HTTPError as e:
                self.send_json(502, {"error": api_error(e)})
            except ValueError as e:
                self.send_json(400, {"error": str(e)})
            except Exception as e:
                self.send_json(502, {"error": f"Couldn't reach Runway ({type(e).__name__}). Check the connection and try again."})
            return
        # /api/reveal and /api/open: show a saved file in Finder or open it in its default app
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            name = os.path.basename(str(body.get("file", "")))
            path = os.path.join(ROOT, name)
            if not name or name.startswith(".") or not os.path.isfile(path):
                self.send_error(404, "File not found in the Runway folder")
                return
            subprocess.run(["open", "-R", path] if action == "reveal" else ["open", path], check=False)
            self.send_response(204)
            self.end_headers()
        except Exception as e:
            self.send_error(400, type(e).__name__)


if __name__ == "__main__":
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=loop, daemon=True).start()
    print(f"Runway Dashboard on http://localhost:{PORT}  (API key: {'found' if api_key() else 'not set — balance/status update only from runs.json'})")
    Server(("127.0.0.1", PORT), Handler).serve_forever()
