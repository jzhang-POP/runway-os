"""Credit-price estimator for Runway API jobs (stdlib only).

    estimate(endpoint, model, params, inputs=None) -> {"credits", "exact", "breakdown", "note"?}

`params` are the request fields without media. `inputs` describes media inputs:
    referenceImages, referenceAudio, referenceVideos   counts
    referenceVideoSeconds                              number, or list of per-clip seconds
    promptImages                                       keyframes in promptImage (image_to_video: default 1)
    inputVideoSeconds, inputVideoWidth/Height/Fps      source video (promptVideo / videoUri / act_two reference)
    inputImageWidth/Height                             source image (image_upscale)
    inputAudioSeconds                                  input audio (voice isolation, dubbing, speech to speech)
    outputSeconds                                      known output length (auto durations, draft enhance, seed_audio)
    outputImages                                       images returned by a layers decomposition

Rates live in pricing.json (source: https://docs.dev.runwayml.com/guides/pricing/, fetched 2026-11-19).
Run `python3 pricing.py` for the self-test.
"""
import json
import math
import os
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_HERE, "pricing.json")) as _f:
    PRICING = json.load(_f)
MODELS = PRICING["models"]


class _NoPrice(Exception):
    def __init__(self, reason, upper=None):
        super().__init__(reason)
        self.reason = reason
        self.upper = upper


def _num(x):
    """Render a number compactly: 24, 9.4, 0.25."""
    if isinstance(x, float) and x.is_integer():
        x = int(x)
    if isinstance(x, float):
        return f"{x:.4f}".rstrip("0").rstrip(".")
    return str(x)


def _ceil(x):
    # Same guard as the pricing page's calculator: Math.ceil(Number(x.toFixed(6))).
    return math.ceil(round(x, 6))


def _parse_utc(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _secs(v, per_clip_cap=None):
    """Sum seconds from a number or a list of clip lengths, capping each clip."""
    if v is None:
        return 0.0
    clips = v if isinstance(v, (list, tuple)) else [v]
    tot = 0.0
    for c in clips:
        c = float(c)
        tot += min(c, per_clip_cap) if per_clip_cap else c
    return tot


class _Ctx:
    def __init__(self, endpoint, model, params, inputs, now):
        self.endpoint, self.model = endpoint, model
        self.p = dict(params or {})
        self.i = dict(inputs or {})
        self.now = now
        self.m = MODELS[model]
        self.exact = True
        self.notes = []
        self.defaults = PRICING["spec_defaults"].get(model, {}).get(endpoint, {})

    def param(self, name, default=None):
        if name in self.p and self.p[name] is not None:
            return self.p[name]
        if name in self.defaults:
            return self.defaults[name]
        return default

    def inexact(self, why):
        self.exact = False
        if why not in self.notes:
            self.notes.append(why)

    def note(self, s):
        if s not in self.notes:
            self.notes.append(s)


# ----------------------------------------------------------------------------- shared pieces

def _tier(c):
    t = c.m.get("tier", {})
    src = t.get("source")
    if src == "fixed":
        return t["value"]
    if src == "quality":
        return None
    if src in ("resolution", "ratio_or_resolution") and c.p.get("resolution") is not None:
        r = c.p["resolution"]
        aliases = t.get("aliases") or {k: k for k in c.m["rates"]}
        if r in aliases:
            return aliases[r]
        raise _NoPrice(f"resolution {r!r} has no price tier for {c.model}")
    if src == "resolution":
        d = c.param("resolution")
        if d is not None:
            return (t.get("aliases") or {}).get(d, d)
        if t.get("default"):
            return t["default"]
        raise _NoPrice(t.get("default_note") or "resolution required")
    if src in ("ratio", "ratio_or_resolution"):
        ratio = c.param("ratio")
        default = t.get("default")
        if ratio is None and default is not None:
            if default in c.m["rates"]:
                return default
            ratio = default
        if ratio is None:
            raise _NoPrice(t.get("default_note") or "ratio required to pick a price tier")
        mp = t.get("map", {})
        if ratio in mp:
            return mp[ratio]
        raise _NoPrice(f"ratio {ratio!r} is not in the {c.model} ratio→tier map")
    raise _NoPrice(f"no tier rule for {c.model}")


def _duration(c, allow_auto_note=True):
    d = c.m.get("duration", {})
    if d.get("from_input"):
        v = c.i.get(d["from_input"])
        if v is None:
            raise _NoPrice(f"output length follows the input video; pass inputs.{d['from_input']}")
        v = float(v)
        if not v.is_integer():
            c.inexact("fractional input duration; rounding of seconds is not stated")
        return v
    val = c.param(d.get("param") or "duration", d.get("default"))
    if val == "auto":
        if c.i.get("outputSeconds") is not None:
            c.inexact("duration 'auto': using inputs.outputSeconds; the up-front charge is the variant maximum, settled after generation")
            return float(c.i["outputSeconds"])
        raise _NoPrice(d.get("auto_billing") or "duration 'auto' is settled after generation")
    if val is None:
        raise _NoPrice("duration is required: the spec gives no default for " + c.model)
    if "duration" not in c.p and d.get("default") is not None:
        c.note(f"duration defaulted to {d['default']} s ({d.get('default_source', 'spec')})")
    return float(val)


def _audio_rate(c, rate):
    if not isinstance(rate, dict):
        return rate, ""
    a = c.m.get("audio", {})
    on = c.param("audio", a.get("default", True))
    if "audio" not in c.p:
        c.note(f"audio defaulted to {str(on).lower()}")
    return (rate["audio"], " with audio") if on else (rate["no_audio"], " without audio")


def _format_surcharge(c, secs):
    fmt = c.p.get("outputFormat")
    if not fmt or fmt in ("mp4", "mov") or not c.m.get("output_format_surcharge"):
        return 0, ""
    s = PRICING["output_format_surcharges"]
    if fmt in s["per_second"]:
        r = s["per_second"][fmt]
        return r * secs, f" + {r} cr/s {fmt}"
    if fmt in s["hdr_10bit"]["formats"]:
        r = s["hdr_10bit"]["per_second"]
        w, h = c.i.get("inputVideoWidth"), c.i.get("inputVideoHeight")
        if c.model == "aleph2" and (w is None or h is None):
            c.inexact("aleph2 HDR/10-bit surcharge is 40/s above 4 MP; source size not given, assumed ≤4 MP")
        elif w and h and w * h > 4_000_000:
            r = s["hdr_10bit"]["per_second_over_4MP"]
        return r * secs, f" + {r} cr/s {fmt}"
    return 0, ""


def _apply_min(c, credits, parts):
    mn = c.m.get("minimum")
    if mn is not None and credits < mn:
        parts.append(f"→ {mn} cr minimum")
        return mn
    return credits


def _round_result(c, x, parts, rule_known):
    """Return an int when x is whole; otherwise ceil if the page says so, else ceil and mark inexact."""
    if abs(x - round(x)) < 1e-9:
        return int(round(x))
    if rule_known:
        parts.append(f"rounded up from {_num(round(x, 4))}")
        return _ceil(x)
    c.inexact(f"raw total {_num(round(x, 4))} is fractional and the page does not state rounding; rounded up")
    return _ceil(x)


# ----------------------------------------------------------------------------- formulas

def _auto_guard(c, tier):
    """duration 'auto' without a known output length: report the up-front reservation as an upper bound."""
    d = c.m.get("duration", {})
    if c.param("duration") != "auto" or c.i.get("outputSeconds") is not None:
        return None
    upper = None
    if d.get("auto_max_s"):
        rate, _ = _audio_rate(c, c.m["rates"][tier])
        upper = max(rate * d["auto_max_s"], c.m.get("minimum", 0))
        if "input_video_rates" in c.m:
            iv = min(_secs(c.i.get("inputVideoSeconds")) + _secs(c.i.get("referenceVideoSeconds")), c.m["input_video"]["combined_cap_s"])
            upper += c.m["input_video_rates"][tier] * iv
    raise _NoPrice(d.get("auto_billing") or "duration 'auto' is settled after generation", upper)


def _f_video(c):
    m = c.m
    tier = _tier(c)
    # Seedance 2.5 draft / enhance / v2v modes override the tier and duration
    if c.model == "seedance2_5":
        mode = c.param("mode", "reference") if c.endpoint == "video_to_video" else "reference"
        if c.p.get("draftTaskId"):
            tier = "1080p"
            if c.i.get("outputSeconds") is None:
                raise _NoPrice("enhancing a draft bills 1080p for the preview's duration; pass inputs.outputSeconds")
            secs = float(c.i["outputSeconds"])
        else:
            if c.p.get("draft"):
                tier = "480p"
            elif mode in ("extend", "edit"):
                h, w = c.i.get("inputVideoHeight"), c.i.get("inputVideoWidth")
                if h is None or w is None:
                    raise _NoPrice(f"{mode} mode renders 1080p if the input is larger than 720p, else 720p; pass inputs.inputVideoWidth/Height")
                tier = "1080p" if min(h, w) > 720 else "720p"
            secs = _auto_guard(c, tier) or _duration(c)
    elif c.endpoint == "video_to_video" and m.get("video_to_video_bills_input_seconds"):
        if c.i.get("inputVideoSeconds") is None:
            raise _NoPrice("Kling O3 video-to-video bills per second of the input video; pass inputs.inputVideoSeconds")
        secs = float(c.i["inputVideoSeconds"])
    else:
        secs = _auto_guard(c, tier) or _duration(c)

    rate = m["rates"][tier]
    rate, alabel = _audio_rate(c, rate)
    tlabel = "" if tier in ("default", "any") else f" at {tier}"
    total = rate * secs
    parts = [f"{_num(rate)} cr/s × {_num(secs)} s{tlabel}{alabel}"]

    # per-reference charges
    pr = m.get("per_reference", {})
    if pr:
        n_img = int(c.i.get("referenceImages", 0) or 0)
        n_aud = int(c.i.get("referenceAudio", 0) or 0)
        n_kf = int(c.i.get("promptImages", 1 if c.endpoint == "image_to_video" else 0) or 0)
        extra = 0
        if "image" in pr and n_img:
            extra += pr["image"] * n_img
            parts.append(f"+ {_num(pr['image'])} × {n_img} ref image")
        if "audio" in pr and n_aud:
            extra += pr["audio"] * n_aud
            parts.append(f"+ {_num(pr['audio'])} × {n_aud} ref audio")
        if n_kf and ("keyframe" in pr or "start_frame" in pr):
            per = pr.get("keyframe", pr.get("start_frame"))
            count = n_kf if "keyframe" in pr else 1
            if "keyframe" not in pr and n_kf > 1:
                c.inexact("page only prices the start frame; extra keyframes not charged")
            extra += per * count
            parts.append(f"+ {_num(per)} × {count} start frame/keyframe")
        total += extra

    # hailuo3 reference video
    if "reference_video" in m:
        rv = _secs(c.i.get("referenceVideoSeconds")) + (_secs(c.i.get("inputVideoSeconds")) if c.endpoint == "video_to_video" else 0)
        if c.endpoint == "video_to_video" and c.i.get("inputVideoSeconds") is None:
            raise _NoPrice("hailuo3 video_to_video: the source video is billed as reference video; pass inputs.inputVideoSeconds")
        if rv:
            rv = min(rv, m["reference_video"]["cap_s"])
            total += rate * rv
            parts.append(f"+ {_num(rate)} cr/s × {_num(rv)} s reference video (cap {m['reference_video']['cap_s']} s)")
            if c.endpoint == "video_to_video":
                c.note("promptVideo treated as reference video")
        elif c.i.get("referenceVideos"):
            raise _NoPrice("reference video is billed per second; pass inputs.referenceVideoSeconds")

    # seedance2_5 input + reference video
    if "input_video_rates" in m:
        iv = _secs(c.i.get("inputVideoSeconds")) + _secs(c.i.get("referenceVideoSeconds"))
        if c.endpoint == "video_to_video" and c.i.get("inputVideoSeconds") is None:
            raise _NoPrice("seedance2_5 bills input video per second; pass inputs.inputVideoSeconds")
        if c.i.get("referenceVideos") and c.i.get("referenceVideoSeconds") is None:
            raise _NoPrice("reference video is billed per second; pass inputs.referenceVideoSeconds")
        if iv:
            iv = min(iv, m["input_video"]["combined_cap_s"])
            ir = m["input_video_rates"][tier]
            total += ir * iv
            parts.append(f"+ {ir} cr/s × {_num(iv)} s input/reference video")

    if m.get("reference_surcharges", {}).get("unknown") and (c.i.get("referenceVideos") or c.i.get("referenceVideoSeconds") or c.i.get("referenceImages")):
        c.note(m["reference_surcharges"]["note"])

    fs, flabel = _format_surcharge(c, secs)
    if fs:
        total += fs
        parts.append(flabel.strip())

    total = _apply_min(c, total, parts)
    rule = m.get("rounding")
    credits = _round_result(c, total, parts, rule_known=isinstance(rule, str))
    return credits, " ".join(parts)


def _f_kling4(c):
    m = c.m
    tier = _tier(c)
    iv_cfg = m["input_video"]
    src = _secs(c.i.get("inputVideoSeconds"), iv_cfg["per_clip_cap_s"])
    ref = _secs(c.i.get("referenceVideoSeconds"), iv_cfg["per_clip_cap_s"])
    if c.endpoint == "video_to_video" and c.i.get("inputVideoSeconds") is None:
        raise _NoPrice("video_to_video bills the source video per second; pass inputs.inputVideoSeconds")
    if c.i.get("referenceVideos") and c.i.get("referenceVideoSeconds") is None:
        raise _NoPrice("reference video is billed per second; pass inputs.referenceVideoSeconds")
    inp = min(src + ref, iv_cfg["combined_cap_s"])
    if c.endpoint == "video_to_video" and c.param("duration") is None:
        secs = min(src, float(c.i["inputVideoSeconds"]))
        c.note("video edit: output duration = source video length")
    else:
        secs = _duration(c)
    r = m["rates"][tier]
    if inp > 0:
        billed_in = max(inp, secs)
        raw = r["with_input_video"] * secs + r["with_input_video"] * billed_in
        parts = [f"{_num(r['with_input_video'])} cr/s × {_num(secs)} s + {_num(r['with_input_video'])} cr/s × {_num(billed_in)} s (max of input video and output) at {tier}"]
    else:
        raw = r["no_input_video"] * secs
        parts = [f"{_num(r['no_input_video'])} cr/s × {_num(secs)} s at {tier}"]
    raw = max(raw, m.get("minimum", 0)) if m.get("minimum") else raw
    if m.get("minimum") and raw == m["minimum"]:
        parts.append(f"→ {m['minimum']} cr minimum")
    list_credits = _ceil(raw)
    if abs(list_credits - raw) > 1e-9:
        parts.append(f"= {_num(round(raw, 4))} → {list_credits}")
    credits = list_credits
    disc = m.get("discount")
    if disc:
        if c.now < _parse_utc(disc["applies_before_utc"]):
            credits = _ceil(list_credits * (100 - disc["percent"]) / 100)
            parts.append(f"− {disc['percent']}% promo → {credits}")
            c.note(f"promotion: {disc['text']}")
        else:
            c.note("promotion ended; list price")
    return credits, " ".join(parts)


def _f_gemini_omni_flash(c):
    r = c.m["rates"]
    refs = int(c.i.get("referenceImages", 0) or 0)
    if c.endpoint == "video_to_video":
        if c.i.get("inputVideoSeconds") is None:
            raise _NoPrice("video_to_video bills per second of input video; pass inputs.inputVideoSeconds")
        s = min(float(c.i["inputVideoSeconds"]), c.m["input_video"]["cap_s"])
        total = r["video_to_video_per_input_second"] * s + refs
        bd = f"{r['video_to_video_per_input_second']} cr/s × {_num(s)} s input video (cap 10 s)" + (f" + {refs} ref image" if refs else "")
    else:
        secs = _duration(c)
        total = r[c.endpoint] * secs
        bd = f"{r[c.endpoint]} cr/s × {_num(secs)} s"
        if c.endpoint == "image_to_video":
            total += 1
            bd += " + 1 first-frame image"
    return _round_result(c, total, [], rule_known=False), bd


def _f_gemini_omni(c):
    m = c.m
    v12 = c.model == "gemini_omni_flash_1.2"
    mode = c.param("mode", "reference") if c.endpoint == "video_to_video" else "reference"
    if c.endpoint == "video_to_video" and mode in ("extend", "edit") and v12:
        res = c.p.get("resolution") or "720p"
        tier = {"4k": "4K"}.get(res, res)
        if "resolution" not in c.p:
            c.note("resolution defaulted to 720p")
    else:
        try:
            tier = _tier(c)
        except _NoPrice:
            if m["tier"].get("default") in m["rates"] and c.param("ratio") is None:
                tier = m["tier"]["default"]
            else:
                raise
    rate = m["rates"][tier]
    in_s = 0.0
    if c.endpoint == "video_to_video":
        if c.i.get("inputVideoSeconds") is None:
            raise _NoPrice("video_to_video bills the input video per second; pass inputs.inputVideoSeconds")
        in_s = float(c.i["inputVideoSeconds"])
    in_s += _secs(c.i.get("referenceVideoSeconds"))
    if c.i.get("referenceVideos") and c.i.get("referenceVideoSeconds") is None:
        raise _NoPrice("reference video is billed per second; pass inputs.referenceVideoSeconds")
    if mode == "edit" and v12:
        out_s = float(c.i["inputVideoSeconds"])
        out_lbl = "input-video duration (edit)"
    else:
        if c.param("duration") == "auto" and c.i.get("outputSeconds") is None:
            upper = None
            if v12:
                upper = 15 * rate + in_s * m["per_input_video_second"]
            raise _NoPrice("duration 'auto' reserves 15 s of output and settles to the generated length", upper)
        out_s = _duration(c)
        out_lbl = "added footage (extend)" if mode == "extend" else "output"
    total = rate * out_s
    parts = [f"{_num(rate)} cr/s × {_num(out_s)} s {out_lbl} at {tier}"]
    n_img = int(c.i.get("referenceImages", 0) or 0)
    n_kf = int(c.i.get("promptImages", 1 if c.endpoint == "image_to_video" else 0) or 0)
    if n_img + n_kf:
        total += n_img + n_kf
        parts.append(f"+ {n_img + n_kf} ref image/keyframe")
        if not v12 and n_kf > 1:
            c.note("1.1 page wording prices the start frame; a last frame is assumed to count as a reference image")
    if in_s:
        total += in_s * m["per_input_video_second"]
        parts.append(f"+ 1 cr/s × {_num(in_s)} s input video")
    if not v12 and c.endpoint == "video_to_video" and mode != "reference":
        c.inexact("mode-specific billing for gemini_omni_flash_1.1 is not described on the pricing page")
    total = _apply_min(c, total, parts)
    return _round_result(c, total, parts, rule_known=v12), " ".join(parts)


def _f_image(c):
    m = c.m
    tsrc = m.get("tier", {}).get("source")
    if tsrc == "quality":
        q = c.p.get("quality")
        if q is None:
            if c.model == "ideogram_4_5":
                q = "medium" if (c.i.get("referenceImages") and not c.p.get("preciseEdit")) else "high"
            else:
                q = "medium"
            c.note(f"quality defaulted to {q}")
        rate = m["rates"][q]
        label = f"{q} quality"
    else:
        tier = _tier(c)
        rate = m["rates"][tier]
        label = "" if tier == "any" else f"at {tier}"
        if isinstance(rate, dict):  # grok_imagine_image_2: quality sub-key
            q = c.p.get("quality") or "medium"
            q = "low" if q == "low" else "medium"
            rate = rate[q]
            label += f", {q}"
    oc = m.get("output_count") or {}
    n = int(c.p.get(oc["param"], oc.get("default", 1)) or 1) if oc else 1
    total = rate * n
    parts = [f"{_num(rate)} cr/image × {n} {label}".rstrip()]
    pr = m.get("per_reference", {})
    if pr.get("per") == "request":
        refs = int(c.i.get("referenceImages", 0) or 0)
        if refs:
            total += pr["image"] * refs
            parts.append(f"+ {refs} ref image × {pr['image']}")
    return _round_result(c, total, parts, rule_known=False), " ".join(parts)


def _f_ideogram_vector(c):
    r = c.m["rates"]
    if c.endpoint == "image_to_vector":
        return r["image_to_vector"], "11 cr per conversion"
    q = c.p.get("quality") or "medium"
    if "quality" not in c.p:
        c.note("quality defaulted to medium")
    key = "high_with_references" if (q == "high" and c.i.get("referenceImages")) else q
    return r["text_to_image"][key], f"{r['text_to_image'][key]} cr per SVG ({key.replace('_', ' ')})"


def _f_gpt_image_2(c):
    tier = _tier(c)
    q = c.p.get("quality") or "high"
    n = int(c.p.get("outputCount") or 1)
    rate = c.m["rates"][tier][q]
    return rate * n, f"{rate} cr/image × {n} at {tier}, {q}"


def _f_gpt_aspect(c):
    m = c.m
    q = c.p.get("quality") or "high"
    if q in m["quality"].get("unsupported", []):
        raise _NoPrice(f"quality {q!r} is not supported by {c.model}")
    n = int(c.p.get("outputCount") or 1)
    fmt = (c.p.get("outputFormat") or "png") if "output_format" in m else "png"
    refs = int(c.i.get("referenceImages", 0) or 0)
    ratio = c.param("ratio")
    if ratio is None:
        raise _NoPrice("ratio is required")
    if fmt == "gif":
        fc = int(c.p.get("frameCount") or m["output_format"]["gif"]["frame_default"])
        row = next(r for r in m["output_format"]["gif"]["table"] if r["frames"][0] <= fc <= r["frames"][1])
        return row[q] * n, f"{row[q]} cr per GIF ({fc} frames, {q}) × {n}"
    svg = m["output_format"]["svg"]["authoring_surcharge_per_output"] if fmt == "svg" else 0
    if fmt in ("gif", "svg") and refs:
        raise _NoPrice("GIF and SVG do not accept reference images")
    if ratio == "auto":
        dep = m["auto_ratio"]["deposit"]
        per = dep[q] if isinstance(dep, dict) else m["rates"]["4K"][q]["1:1"]
        c.inexact("ratio 'auto' is charged a deposit up front and settled at the square price of the tier rendered")
        total = (per + refs + svg) * n
        return total, f"({per} deposit + {refs} ref{' + 50 SVG' if svg else ''}) × {n}, {q}"
    if ratio not in m["ratio_map"]:
        raise _NoPrice(f"ratio {ratio!r} not in the {c.model} price tables")
    ta = m["ratio_map"][ratio]
    per = m["rates"][ta["tier"]][q][ta["aspect"]]
    per = max(per, m.get("minimum_per_image", 0))
    total = (per + refs + svg) * n
    bd = f"({per} cr {ta['tier']} {ta['aspect']} {q}" + (f" + {refs} ref" if refs else "") + (" + 50 SVG authoring" if svg else "") + f") × {n}"
    return total, bd


def _f_layers(c):
    m = c.m
    res = c.p.get("resolution") or m["resolution"]["default"]
    if res not in m["rates"]:
        raise _NoPrice(f"resolution {res!r} has no price tier for {c.model}")
    rate = m["rates"][res]
    sur = m.get("source_image_surcharge", 0)
    n = c.i.get("outputImages")
    if n is None:
        if "max_images" in m["reservation"]:
            upper = m["reservation"][res]
        else:
            mx = int(c.p.get(m["reservation"]["max_images_param"]) or m["reservation"]["max_images_default"])
            upper = _ceil(mx * rate + sur)
        raise _NoPrice(f"billed per returned image (base + layers); reserves {upper} cr up front, settles to images returned. Pass inputs.outputImages", upper)
    total = n * rate + sur
    parts = [f"{rate} cr × {n} images at {res}" + (f" + {sur} source image" if sur else "")]
    return _round_result(c, total, parts, rule_known=True), " ".join(parts)


def _f_seedream55(c):
    m = c.m
    ratio = c.param("ratio")
    if ratio is None:
        raise _NoPrice("ratio required")
    if ratio in m["auto_map"]:
        tier = m["auto_map"][ratio]
    else:
        w, h = map(int, ratio.split(":"))
        a = w * h
        ref = {"1K": 1024 ** 2, "1.5K": 1536 ** 2, "2K": 2048 ** 2}
        tier = min(ref, key=lambda t: abs(math.log(a / ref[t])))
        c.note("tier from pixel area (model not in cached spec)")
    n = int(c.p.get("outputCount") or 1)
    refs = int(c.i.get("referenceImages", 0) or 0)
    total = n * (m["rates"][tier] + 0.8 * refs)
    parts = [f"{n} × ({m['rates'][tier]} at {tier} + 0.8 × {refs} ref)"]
    return _round_result(c, total, parts, rule_known=True), " ".join(parts)


def _f_image_upscale(c):
    sf = c.p.get("scaleFactor")
    w, h = c.i.get("inputImageWidth"), c.i.get("inputImageHeight")
    if sf is None or w is None or h is None:
        raise _NoPrice("25 cr, or 150 when the output exceeds 4096px: pass scaleFactor and inputs.inputImageWidth/Height", 150)
    out = max(w, h) * sf
    if out > 4096:
        return 150, f"150 cr (output long side {out}px > 4096px)"
    return 25, f"25 cr (output long side {out}px ≤ 4096px)"


def _f_per_frame_usd(c):
    res = c.p.get("resolution") or c.m["resolution"]["default"]
    if "resolution" not in c.p:
        c.note("resolution defaulted to 2k")
    secs, fps = c.i.get("inputVideoSeconds"), c.i.get("inputVideoFps")
    if secs is None or fps is None:
        raise _NoPrice("billed per output frame; pass inputs.inputVideoSeconds and inputs.inputVideoFps")
    usd = c.m["rates"][res] * fps * secs
    credits = max(_ceil(usd / 0.01), c.m["minimum"])
    if c.p.get("fpsBoost"):
        c.inexact(c.m["fps_boost"])
    return credits, f"ceil(${c.m['rates'][res]}/frame × {_num(fps)} fps × {_num(secs)} s / $0.01) at {res}"


def _f_per_input_second(c):
    key = "inputAudioSeconds" if c.endpoint in ("speech_to_speech", "voice_isolation", "voice_dubbing") else "inputVideoSeconds"
    s = c.i.get(key)
    if s is None:
        raise _NoPrice(f"billed by input length; pass inputs.{key}")
    raw = c.m["rate"] * float(s)
    return _round_result(c, raw, [], rule_known=False), f"{c.m['unit']} × {_num(s)} s"


def _f_ruby(c):
    s = c.i.get("inputVideoSeconds")
    if s is None:
        raise _NoPrice("billed per second of output (= source length); pass inputs.inputVideoSeconds")
    w, h = c.i.get("inputVideoWidth"), c.i.get("inputVideoHeight")
    if w is None or h is None:
        c.inexact("source size not given; assumed ≤4 MP (40/s above)")
        rate = 20
    else:
        rate = 40 if w * h > 4_000_000 else 20
    return _round_result(c, rate * float(s), [], rule_known=False), f"{rate} cr/s × {_num(s)} s"


def _f_per_output_second(c):
    s = c.i.get("outputSeconds")
    if s is None:
        raise _NoPrice("billed per second of generated audio, which is not known in advance (5-credit minimum); pass inputs.outputSeconds")
    raw = max(c.m["rate"] * float(s), c.m["minimum"])
    return _round_result(c, raw, [], rule_known=False), f"{c.m['rate']} cr/s × {_num(s)} s (min {c.m['minimum']})"


def _f_per_character(c):
    text = c.p.get(c.m["text_param"])
    if text is None:
        raise _NoPrice("priced per character of promptText; pass params.promptText")
    n = len(text)
    if "rate_schedule" in c.m:
        sched = c.m["rate_schedule"]
        per_k = sched[-1]["per_1000_chars"]
        for s in sched:
            if "until" in s and c.now < _parse_utc(s["until"]):
                per_k = s["per_1000_chars"]
                break
        raw = per_k * n / 1000
        bd = f"{per_k} cr/1000 chars × {n} chars"
    else:
        raw = c.m["rate_per_char"] * n
        bd = f"1 cr/50 chars × {n} chars"
    if c.m.get("minimum") and raw < c.m["minimum"]:
        raw = c.m["minimum"]
        bd += f" → {c.m['minimum']} cr minimum"
    return _round_result(c, raw, [], rule_known=False), bd


def _f_sound_effect(c):
    d = c.p.get("duration")
    if d is None:
        return 2, "2 cr (no duration given)"
    return _round_result(c, float(d), [], rule_known=False), f"1 cr/s × {_num(d)} s"


_FORMULAS = {
    "video_per_second": _f_video, "kling4": _f_kling4, "gemini_omni_flash": _f_gemini_omni_flash,
    "gemini_omni": _f_gemini_omni, "image": _f_image, "ideogram_vector": _f_ideogram_vector,
    "gpt_image_2": _f_gpt_image_2, "gpt_image_aspect": _f_gpt_aspect, "layers": _f_layers,
    "seedream55": _f_seedream55, "image_upscale": _f_image_upscale, "per_frame_usd": _f_per_frame_usd,
    "per_input_second": _f_per_input_second, "ruby": _f_ruby, "per_output_second": _f_per_output_second,
    "per_character": _f_per_character, "sound_effect": _f_sound_effect,
}


def estimate(endpoint: str, model: str, params: dict, inputs: dict | None = None, *, now: datetime | None = None) -> dict:
    """Estimate the credit charge of one Runway request. `now` (UTC) is only for testing date-bound rates."""
    now = now or datetime.now(timezone.utc)
    endpoint = endpoint.strip("/").removeprefix("v1/")
    m = MODELS.get(model)
    if m is None:
        return {"credits": None, "exact": False, "breakdown": "", "note": f"{model!r} is not in pricing.json"}
    if endpoint not in m["endpoints"]:
        return {"credits": None, "exact": False, "breakdown": "", "note": f"{model} is not offered on {endpoint}"}
    if m["formula"] == "unknown":
        return {"credits": None, "exact": False, "breakdown": "", "note": "price unknown: " + m["note"]}
    c = _Ctx(endpoint, model, params, inputs, now)
    try:
        credits, breakdown = _FORMULAS[m["formula"]](c)
    except _NoPrice as e:
        out = {"credits": None, "exact": False, "breakdown": "", "note": e.reason}
        if e.upper is not None:
            out["note"] += f" (up to {_num(e.upper)} cr)"
        return out
    if isinstance(credits, float) and credits.is_integer():
        credits = int(credits)
    out = {"credits": credits, "exact": c.exact, "breakdown": breakdown}
    if c.notes:
        out["note"] = "; ".join(c.notes)
    return out


# ----------------------------------------------------------------------------- self-test

def _selftest():
    promo = datetime(2026, 11, 19, 12, tzinfo=timezone.utc)
    after = datetime(2026, 12, 1, 0, 0, 1, tzinfo=timezone.utc)
    cases = [
        # real charges reported by Runway for this account (cost.credits)
        ("text_to_image", "gemini_2.5_flash", {"ratio": "1024:1024"}, None, 5),
        ("image_to_video", "seedance2_fast", {"ratio": "960:960", "duration": 4}, None, 96),
        ("text_to_image", "gen4_image", {"ratio": "1024:1024"}, None, 8),
        ("image_to_video", "gen4.5", {"ratio": "960:960", "duration": 2}, None, 24),
        # sanity cases from the pricing page
        ("text_to_video", "veo3.1", {"ratio": "1280:720", "duration": 8}, None, 320),
        ("text_to_video", "veo3.1", {"ratio": "1280:720", "duration": 8, "audio": False}, None, 160),
        ("image_to_video", "veo3.1_fast", {"ratio": "1280:720", "duration": 8, "audio": False}, None, 80),
        ("text_to_video", "kling3.0_pro", {"ratio": "1920:1080", "duration": 5}, None, 85),
        ("text_to_video", "kling3.0_pro", {"ratio": "1920:1080", "duration": 5, "audio": False}, None, 60),
        ("text_to_video", "kling3.0_4k", {"ratio": "3840:2160", "duration": 5, "audio": False}, None, 215),
        ("text_to_image", "ideogram_4_5", {"quality": "very_low"}, {"referenceImages": 1}, 1),
        ("text_to_image", "ideogram_4_5", {}, None, 25),
        ("text_to_image", "ideogram_4_5", {}, {"referenceImages": 2}, 8),
        ("text_to_image", "ideogram_4_5", {"quality": "low", "outputCount": 3}, None, 12),
        ("text_to_image", "ideogram_4_0", {}, None, 7),
        ("text_to_image", "gpt_image_2", {"ratio": "1920:1920"}, None, 20),
        ("text_to_image", "gpt_image_2", {"ratio": "2560:1440", "quality": "medium", "outputCount": 4}, None, 20),
        ("text_to_image", "gpt_image_2", {"ratio": "auto", "quality": "low", "outputCount": 3}, None, 6),
        ("text_to_image", "gpt_image_2_5_flare", {"ratio": "3840:2160", "quality": "max", "outputCount": 2}, {"referenceImages": 1}, 88),
        ("text_to_image", "gpt_image_2_6_sunburst", {"ratio": "1920:1920", "quality": "low"}, None, 5),
        ("text_to_image", "gpt_image_2_6_flare", {"ratio": "1920:1920", "outputFormat": "gif", "quality": "high"}, None, 8),
        ("text_to_image", "gpt_image_2_6_flare", {"ratio": "2048:880", "outputFormat": "svg", "quality": "high"}, None, 54),
        ("text_to_image", "grok_imagine_image_2", {"ratio": "1024:1024", "outputCount": 4}, {"referenceImages": 2}, 26),
        ("text_to_image", "grok_imagine_image_2", {"ratio": "auto_2k", "quality": "low"}, None, 6),
        ("text_to_image", "gen4_image", {"ratio": "1280:720"}, None, 5),
        ("text_to_image", "gemini_image3.1_flash", {"ratio": "4096:4096", "outputCount": 4}, None, 64),
        ("text_to_image", "seedream5_pro", {"ratio": "auto_2k", "outputCount": 2}, None, 18),
        ("text_to_image", "seedream5.5", {"ratio": "auto_2k", "outputCount": 4}, {"referenceImages": 2}, 23),
        ("text_to_image", "seedream5_pro_layers", {"resolution": "2k"}, {"outputImages": 9}, 45),
        ("text_to_image", "seedream5.5_layers", {"resolution": "2k"}, {"outputImages": 9}, 37),
        ("text_to_image", "bria_fibo_1_5", {"ratio": "2048:1152"}, None, 10),
        ("text_to_image", "ideogram_vector", {"quality": "high"}, {"referenceImages": 1}, 35),
        ("image_to_vector", "ideogram_vector", {}, None, 11),
        ("text_to_video", "seedance2_5", {"ratio": "3840:2160", "duration": 5}, None, 550),
        ("text_to_video", "seedance2_5", {"ratio": "3840:2160", "duration": 5}, {"referenceVideoSeconds": 5}, 835),
        ("text_to_video", "seedance2_5", {}, None, 150),
        ("text_to_video", "seedance2_5", {"ratio": "1920:1080", "duration": 4, "draft": True}, None, 80),
        ("image_to_video", "seedance2_fast", {"ratio": "640:640", "duration": 4}, None, 44),
        ("text_to_video", "kling_4", {"ratio": "1280:720", "duration": 5}, None, 64),
        ("text_to_video", "kling_4_flash", {"ratio": "1280:720", "duration": 5}, None, 47),
        ("video_to_video", "kling_4_flash", {"duration": 5}, {"inputVideoSeconds": 3}, 63),
        ("video_to_video", "kling_4_flash", {"duration": 5}, {"inputVideoSeconds": 10}, 95),
        ("text_to_video", "kling_4_flash", {"duration": 3}, None, 29),
        ("text_to_video", "gemini_omni_flash_1.2", {"ratio": "640:360", "duration": 3}, None, 6),
        ("image_to_video", "grok_imagine_1_5", {"resolution": "720p", "duration": 5}, None, 81),
        ("image_to_video", "hailuo3", {"resolution": "2K", "duration": 6}, {"referenceVideoSeconds": 20}, 317),
        ("video_to_video", "aleph2", {}, {"inputVideoSeconds": 1}, 56),
        ("text_to_video", "gen4.5", {"ratio": "1280:720", "duration": 5, "outputFormat": "prores"}, None, 85),
        ("video_upscale", "magnific_video_upscaler_creative", {"resolution": "4k"}, {"inputVideoSeconds": 10, "inputVideoFps": 30}, 360),
        ("video_to_hdr", "ruby", {}, {"inputVideoSeconds": 10, "inputVideoWidth": 3840, "inputVideoHeight": 2160}, 400),
        ("sound_effect", "eleven_text_to_sound_v2", {}, None, 2),
        ("text_to_speech", "eleven_v3", {"promptText": "x" * 100}, None, 2),
        ("text_to_speech", "eleven_v4", {"promptText": "x" * 1000}, None, 5),
        ("voice_isolation", "eleven_voice_isolation", {}, {"inputAudioSeconds": 60}, 10),
    ]
    failed = 0
    for ep, model, params, inputs, want in cases:
        got = estimate(ep, model, params, inputs, now=promo)
        ok = got["credits"] == want
        failed += not ok
        print(f"{'ok ' if ok else 'FAIL'} {ep:16} {model:26} {want:>4} got {got['credits']}  [{got['breakdown']}]"
              + ("" if got["exact"] else "  (inexact)") + (f"  note: {got['note']}" if got.get("note") else ""))
    # date-bound and unknown cases
    k4 = estimate("text_to_video", "kling_4", {"ratio": "1280:720", "duration": 5}, now=after)
    assert k4["credits"] == 79, k4
    auto = estimate("text_to_video", "seedance2", {"ratio": "1280:720", "duration": "auto"}, now=promo)
    assert auto["credits"] is None and not auto["exact"] and "up to 450" in auto["note"], auto
    vi = estimate("voice_isolation", "eleven_voice_isolation", {}, now=promo)
    assert vi["credits"] is None and not vi["exact"], vi
    mu = estimate("text_to_music", "eleven_music_v2_5", {"duration": 30}, now=promo)
    assert mu["credits"] is None and "unknown" in mu["note"], mu
    gx = estimate("text_to_image", "gpt_image_2_5_sunburst", {"ratio": "auto"}, now=promo)
    assert gx["credits"] == 19 and not gx["exact"], gx
    print("ok  kling_4 after promo -> 79; auto/unknown/missing-input cases return None")
    assert failed == 0, f"{failed} case(s) failed"
    print(f"all {len(cases) + 5} checks passed")


if __name__ == "__main__":
    _selftest()
