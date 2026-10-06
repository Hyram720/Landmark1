#!/usr/bin/env python3
"""Analysis toolkit for the pro-sports-hype-editor skill (stdlib + ffmpeg only).

Subcommands:
  probe  FILE...                         stream/format summary
  style  REF [--out style.json]          cuts, pacing, tempo/beats, loudness, color
  frames REF --at-cuts style.json --outdir DIR   stills just before/after each cut
  beats  AUDIO_OR_VIDEO [--out beats.json]       tempo + beat grid
  plays  SRC [--out plays.json] [--top N]        ranked candidate highlight windows
  verify OUT [--edl edl.json] [--ref style.json] technical QA of a render
"""
import argparse
import array
import json
import math
import os
import re
import statistics
import subprocess
import sys

SR = 11025          # analysis sample rate
HOP = 256           # ~23 ms onset resolution


def run(cmd, check=True):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if check and p.returncode != 0:
        sys.exit(f"command failed: {' '.join(cmd)}\n{p.stderr[-2000:]}")
    return p


def probe(path):
    p = run(["ffprobe", "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", path])
    d = json.loads(p.stdout)
    out = {"file": path, "duration": float(d["format"].get("duration", 0)),
           "bitrate": int(d["format"].get("bit_rate", 0) or 0)}
    for s in d["streams"]:
        if s["codec_type"] == "video" and "video" not in out:
            num, den = (s.get("avg_frame_rate") or "0/1").split("/")
            rot = 0
            for sd in s.get("side_data_list", []):
                rot = int(sd.get("rotation", rot) or 0)
            rot = int(s.get("tags", {}).get("rotate", rot))
            w, h = s["width"], s["height"]
            if abs(rot) in (90, 270):
                w, h = h, w
            out["video"] = {"codec": s["codec_name"], "width": w, "height": h,
                            "fps": round(float(num) / float(den), 3) if float(den) else 0,
                            "rotation": rot, "pix_fmt": s.get("pix_fmt"),
                            "field_order": s.get("field_order", "unknown")}
        elif s["codec_type"] == "audio" and "audio" not in out:
            out["audio"] = {"codec": s["codec_name"], "sample_rate": int(s["sample_rate"]),
                            "channels": s["channels"]}
    return out


# ---------------------------------------------------------------- audio

def load_pcm(path):
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1",
                        "-ar", str(SR), "-f", "s16le", "-"], capture_output=True)
    a = array.array("h")
    a.frombytes(p.stdout[: len(p.stdout) // 2 * 2])
    return a


def onset_envelope(pcm):
    """Two-band (low = kick/808, high = snare/hats) log-compressed energy flux, lightly smoothed."""
    lows, highs = [], []
    lp = 0.0
    a = 0.06                      # one-pole low-pass ~ 110 Hz at 11025 Hz
    for i in range(0, len(pcm) - HOP, HOP):
        el = eh = 0.0
        prev = pcm[i - 1] if i else 0
        for j in range(i, i + HOP):
            x = pcm[j]
            lp += a * (x - lp)
            el += lp * lp
            d = x - prev
            eh += d * d
            prev = x
        lows.append(math.log1p(el / HOP / 1e3))
        highs.append(math.log1p(eh / HOP / 1e3))
    env = []
    for k in range(len(lows)):
        if k == 0:
            env.append(0.0)
            continue
        env.append(1.5 * max(0.0, lows[k] - lows[k - 1]) + max(0.0, highs[k] - highs[k - 1]))
    env = [(env[max(0, k - 1)] * 0.25 + env[k] * 0.5 + env[min(len(env) - 1, k + 1)] * 0.25)
           for k in range(len(env))]
    if env:
        m = statistics.mean(env)
        env = [max(0.0, v - m) for v in env]
    return env


def _grid_score(env, period, phase):
    s, n, t = 0.0, 0, phase
    L = len(env)
    while t < L - 1:
        j = int(round(t))
        s += env[j]
        n += 1
        t += period
    return s / max(1, n)


def tempo_and_beats(env, bpm_lo=70, bpm_hi=180):
    """Pulse-train matching: for each tempo, best-phase mean onset strength on the beat grid
    (+ half weight on the 8th-note off-grid), times a broad prior centred on 125 BPM."""
    fps = SR / HOP
    if len(env) < fps * 4:
        return None
    best = (-1.0, None, 0.0)
    for bpm2 in range(bpm_lo * 2, bpm_hi * 2 + 1):
        bpm = bpm2 / 2
        period = fps * 60.0 / bpm
        steps = max(8, int(period))
        bp, bs = 0.0, -1.0
        for k in range(steps):
            ph = period * k / steps
            sc = _grid_score(env, period, ph)
            if sc > bs:
                bs, bp = sc, ph
        off = _grid_score(env, period, bp + period / 2)
        score = (bs + 0.25 * off) * math.exp(-0.5 * (math.log2(bpm / 125.0) / 0.7) ** 2)
        if score > best[0]:
            best = (score, bpm, bp)
    _, bpm, phase = best
    period = fps * 60.0 / bpm
    beats, t = [], phase
    while t < len(env):
        beats.append(round(t / fps, 3))
        t += period
    return {"bpm": bpm, "beat_period": round(60.0 / bpm, 4), "beats": beats}


def loudness_curve(pcm, win=0.5):
    n = int(SR * win)
    out = []
    for i in range(0, len(pcm) - n + 1, n):
        seg = pcm[i:i + n]
        rms = math.sqrt(sum(v * v for v in seg) / n) / 32768.0
        out.append(round(20 * math.log10(rms + 1e-9), 1))
    return out


def sections_from_loudness(curve, win=0.5):
    """Very rough intro/build/drop/outro split from a smoothed loudness curve."""
    if len(curve) < 8:
        return []
    k = 4
    sm = [statistics.mean(curve[max(0, i - k):i + k + 1]) for i in range(len(curve))]
    lo, hi = min(sm), max(sm)
    thr = lo + 0.6 * (hi - lo)
    drop = next((i for i, v in enumerate(sm) if v >= thr), None)
    jumps = sorted(((sm[i + 2] - sm[i], i + 1) for i in range(len(sm) - 2)), reverse=True)
    return {"drop_estimate": round((jumps[0][1] if jumps else drop or 0) * win, 2),
            "first_loud": round((drop or 0) * win, 2),
            "loud_threshold_db": round(thr, 1)}


# ---------------------------------------------------------------- video

META_RE = re.compile(r"pts_time:([\d.]+)")


def scene_cuts(path, thr=0.3):
    p = run(["ffmpeg", "-v", "error", "-i", path, "-an", "-vf",
             f"scale=320:-2,select='gt(scene,{thr})',metadata=print:file=-",
             "-f", "null", "-"])
    cuts, last = [], -1.0
    for line in p.stdout.splitlines():
        m = META_RE.search(line)
        if m:
            t = float(m.group(1))
            if t - last > 0.08:
                cuts.append(round(t, 3))
                last = t
    return cuts


def per_frame_stats(path, vf, keys):
    p = run(["ffmpeg", "-v", "error", "-i", path, "-an", "-vf",
             vf + ",metadata=print:file=-", "-f", "null", "-"])
    rows, cur = [], None
    for line in p.stdout.splitlines():
        m = META_RE.search(line)
        if m:
            cur = {"t": float(m.group(1))}
            rows.append(cur)
            continue
        if cur is not None and "=" in line:
            k, _, v = line.strip().partition("=")
            k = k.replace("lavfi.signalstats.", "")
            if k in keys:
                try:
                    cur[k] = float(v)
                except ValueError:
                    pass
    return rows


def color_stats(path):
    rows = per_frame_stats(path, "fps=2,scale=320:-2,signalstats",
                           {"YAVG", "YLOW", "YHIGH", "SATAVG", "HUEAVG"})
    if not rows:
        return {}
    def avg(k):
        vals = [r[k] for r in rows if k in r]
        return round(statistics.mean(vals), 1) if vals else None
    return {"luma_avg": avg("YAVG"), "luma_p10": avg("YLOW"), "luma_p90": avg("YHIGH"),
            "sat_avg": avg("SATAVG"), "hue_avg": avg("HUEAVG"),
            "note": "8-bit scale; contrast ~ luma_p90-luma_p10; sat ~ 0-128"}


def motion_series(path, fps=4):
    rows = per_frame_stats(path, f"fps={fps},scale=160:-2,format=gray,tblend=all_mode=difference,signalstats",
                           {"YAVG"})
    return [(r["t"], r.get("YAVG", 0.0)) for r in rows]


def align_share(cuts, beats, tol=0.06):
    if not cuts or not beats:
        return None
    hit = sum(1 for c in cuts if min(abs(c - b) for b in beats) <= tol)
    return round(hit / len(cuts), 3)


def halfbeat_grid(beats):
    out = []
    for a, b in zip(beats, beats[1:]):
        out += [a, round((a + b) / 2, 4)]
    return out + beats[-1:]


def tempo_from_cuts(cuts, bpm_lo=70, bpm_hi=180, tol=0.05):
    """Beat-synced edits cut on a grid: find tempos whose best-phase grid explains the cuts,
    corrected for chance hits (faster grids catch more cuts by luck)."""
    if len(cuts) < 6:
        return []
    res = []
    for bpm2 in range(bpm_lo * 2, bpm_hi * 2 + 1):
        p = 60.0 / (bpm2 / 2)
        best = 0
        for c0 in cuts:
            ph = c0 % p
            n = sum(1 for c in cuts if min((c - ph) % p, p - (c - ph) % p) <= tol)
            best = max(best, n)
        chance = min(1.0, 2 * tol / p)
        res.append(((best / len(cuts) - chance) / (1 - chance + 1e-9), bpm2 / 2))
    res.sort(reverse=True)
    out = []
    for sc, bpm in res:
        if all(abs(bpm - o["bpm"]) > 2 for o in out):
            out.append({"bpm": bpm, "fit": round(sc, 3)})
        if len(out) == 5:
            break
    return out


# ---------------------------------------------------------------- commands

def cmd_probe(a):
    print(json.dumps([probe(f) for f in a.files], indent=2))


def cmd_beats(a):
    env = onset_envelope(load_pcm(a.file))
    tb = tempo_and_beats(env, *a.bpm_range) or {}
    if a.out:
        json.dump(tb, open(a.out, "w"), indent=2)
    print(json.dumps({k: v for k, v in tb.items() if k != "beats"} |
                     {"n_beats": len(tb.get("beats", [])), "first_beats": tb.get("beats", [])[:8]}, indent=2))


def cmd_style(a):
    info = probe(a.file)
    dur = info["duration"]
    cuts = scene_cuts(a.file, a.threshold)
    bounds = [0.0] + cuts + [dur]
    shots = [round(bounds[i + 1] - bounds[i], 3) for i in range(len(bounds) - 1)]
    # pacing curve: cuts per second in 2 s windows
    pace = []
    t = 0.0
    while t < dur:
        pace.append({"t": round(t, 1), "cuts": sum(1 for c in cuts if t <= c < t + 2)})
        t += 2.0
    style = {"probe": info, "n_cuts": len(cuts), "cuts": cuts,
             "shot_len": {"mean": round(statistics.mean(shots), 3),
                          "median": round(statistics.median(shots), 3),
                          "min": min(shots), "max": max(shots)} if shots else {},
             "pacing_2s": pace, "color": color_stats(a.file)}
    if "audio" in info:
        pcm = load_pcm(a.file)
        tb = tempo_and_beats(onset_envelope(pcm), *a.bpm_range)
        curve = loudness_curve(pcm)
        style["audio"] = {"loudness_db_0.5s": curve, "sections": sections_from_loudness(curve)}
        if tb:
            style["tempo"] = tb
            style["cut_beat_alignment"] = align_share(cuts, tb["beats"])
            style["cut_halfbeat_alignment"] = align_share(cuts, halfbeat_grid(tb["beats"]))
            per = tb["beat_period"]
            style["shot_len_in_beats_median"] = round(statistics.median(shots) / per, 2) if shots else None
    style["cut_tempo_candidates"] = tempo_from_cuts(cuts)
    if a.out:
        json.dump(style, open(a.out, "w"), indent=2)
    summary = {k: style[k] for k in ("n_cuts", "shot_len", "color") if k in style}
    summary["duration"] = dur
    if "tempo" in style:
        summary["bpm"] = style["tempo"]["bpm"]
        summary["cut_beat_alignment"] = style.get("cut_beat_alignment")
        summary["cut_halfbeat_alignment"] = style.get("cut_halfbeat_alignment")
        summary["shot_len_in_beats_median"] = style.get("shot_len_in_beats_median")
    summary["cut_tempo_candidates"] = style["cut_tempo_candidates"][:3]
    if "audio" in style:
        summary["sections"] = style["audio"]["sections"]
    print(json.dumps(summary, indent=2))


def cmd_frames(a):
    style = json.load(open(a.at_cuts))
    os.makedirs(a.outdir, exist_ok=True)
    for i, c in enumerate(style["cuts"][: a.max]):
        for tag, t in (("a", max(0, c - 0.12)), ("b", c + 0.05)):
            run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", a.file,
                 "-frames:v", "1", "-vf", "scale=480:-2",
                 os.path.join(a.outdir, f"cut{i:03d}{tag}_{t:07.2f}.jpg")])
    print(f"wrote stills for {min(len(style['cuts']), a.max)} cuts to {a.outdir}")


def cmd_plays(a):
    info = probe(a.file)
    dur = info["duration"]
    mot = motion_series(a.file)
    cuts = scene_cuts(a.file, 0.35)
    aud = []
    if "audio" in info:
        aud = loudness_curve(load_pcm(a.file), 0.25)
    def norm(xs):
        if not xs:
            return xs
        lo, hi = min(xs), max(xs)
        return [(x - lo) / (hi - lo + 1e-9) for x in xs]
    mt = [t for t, _ in mot]
    mv = norm([v for _, v in mot])
    av = norm(aud)
    win = a.window
    cands = []
    t = 0.0
    while t + win <= dur + 1e-6:
        ms = [v for tt, v in zip(mt, mv) if t <= tt < t + win]
        as_ = av[int(t / 0.25): int((t + win) / 0.25)]
        if ms:
            motion = statistics.mean(ms)
            peak_m = max(ms)
            audio_peak = max(as_) if as_ else 0.0
            score = 0.45 * motion + 0.25 * peak_m + 0.30 * audio_peak
            # impact guess: max audio spike, else max motion
            if as_ and audio_peak > 0.6:
                impact = t + 0.25 * as_.index(audio_peak)
            else:
                impact = mt[mv.index(peak_m)] if peak_m in mv else t + win / 2
            ncut = sum(1 for c in cuts if t < c < t + win)
            score -= 0.08 * ncut   # windows spanning edits are usually replays/broadcast cuts
            cands.append({"start": round(t, 2), "end": round(t + win, 2), "score": round(score, 3),
                          "motion": round(motion, 3), "audio_peak": round(audio_peak, 3),
                          "impact_guess": round(impact, 2), "cuts_inside": ncut})
        t += a.step
    cands.sort(key=lambda c: -c["score"])
    picked = []
    for c in cands:
        if all(c["end"] <= p["start"] or c["start"] >= p["end"] for p in picked):
            picked.append(c)
        if len(picked) >= a.top:
            break
    picked.sort(key=lambda c: c["start"])
    out = {"source": a.file, "duration": dur, "scene_cuts": cuts, "candidates": picked}
    if a.out:
        json.dump(out, open(a.out, "w"), indent=2)
    print(json.dumps(picked, indent=2))


def cmd_verify(a):
    rep, problems = {}, []
    info = probe(a.file)
    rep["probe"] = info
    p = run(["ffmpeg", "-v", "error", "-i", a.file, "-f", "null", "-"], check=False)
    errs = [l for l in p.stderr.splitlines() if l.strip()]
    rep["decode_errors"] = len(errs)
    if errs:
        problems.append(f"{len(errs)} decode errors, e.g. {errs[0]}")
    p = run(["ffmpeg", "-hide_banner", "-i", a.file, "-vf",
             "blackdetect=d=0.25:pix_th=0.08,freezedetect=n=0.002:d=1.2",
             "-af", "silencedetect=n=-45dB:d=0.6,loudnorm=I=-14:TP=-1:print_format=json",
             "-f", "null", "-"], check=False)
    s = p.stderr
    rep["black"] = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", s)
    rep["freeze_starts"] = re.findall(r"freeze_start: ([\d.]+)", s)
    rep["silence_starts"] = re.findall(r"silence_start: ([\d.]+)", s)
    m = re.search(r"\{\s*\"input_i\".*?\}", s, re.S)
    if m:
        ln = json.loads(m.group(0))
        rep["loudness"] = {"integrated_lufs": float(ln["input_i"]), "true_peak_dbtp": float(ln["input_tp"]),
                           "lra": float(ln["input_lra"])}
        if abs(rep["loudness"]["integrated_lufs"] + 14) > 1.5:
            problems.append(f"integrated loudness {ln['input_i']} LUFS (target -14)")
        if rep["loudness"]["true_peak_dbtp"] > -0.5:
            problems.append(f"true peak {ln['input_tp']} dBTP (target <= -1)")
    if rep["black"]:
        problems.append(f"black segments: {rep['black']}")
    if rep["silence_starts"]:
        problems.append(f"silence gaps start at {rep['silence_starts']}")
    planned_freezes = []
    if a.edl:
        edl = json.load(open(a.edl))
        want = edl.get("duration_planned")
        W, H, F = edl.get("width"), edl.get("height"), edl.get("fps")
        v = info.get("video", {})
        if W and (v.get("width"), v.get("height")) != (W, H):
            problems.append(f"resolution {v.get('width')}x{v.get('height')} != planned {W}x{H}")
        if F and abs(v.get("fps", 0) - F) > 0.01:
            problems.append(f"fps {v.get('fps')} != planned {F}")
        if want and abs(info["duration"] - want) > 0.25:
            problems.append(f"duration {info['duration']:.2f}s != planned {want:.2f}s")
        planned_freezes = edl.get("freeze_times", [])
        if edl.get("beats") and edl.get("cut_times"):
            rep["cut_beat_alignment_planned"] = align_share(edl["cut_times"], edl["beats"])
    unplanned = [f for f in rep["freeze_starts"]
                 if not any(abs(float(f) - pf) < 1.5 for pf in planned_freezes)]
    if unplanned:
        problems.append(f"unplanned frozen video at {unplanned}")
    cuts = scene_cuts(a.file, 0.3)
    rep["n_cuts"] = len(cuts)
    if "audio" in info:
        tb = tempo_and_beats(onset_envelope(load_pcm(a.file)), *a.bpm_range)
        if tb:
            rep["bpm_detected"] = tb["bpm"]
            rep["cut_beat_alignment"] = align_share(cuts, tb["beats"])
            rep["cut_halfbeat_alignment"] = align_share(cuts, halfbeat_grid(tb["beats"]))
    if a.ref:
        ref = json.load(open(a.ref))
        rep["ref_cut_beat_alignment"] = ref.get("cut_beat_alignment")
        rep["ref_shot_len_median"] = ref.get("shot_len", {}).get("median")
        bounds = [0.0] + cuts + [info["duration"]]
        shots = [bounds[i + 1] - bounds[i] for i in range(len(bounds) - 1)]
        rep["shot_len_median"] = round(statistics.median(shots), 3)
    rep["problems"] = problems
    rep["status"] = "PASS" if not problems else "FAIL"
    print(json.dumps({k: v for k, v in rep.items() if k != "probe"}, indent=2))
    sys.exit(0 if not problems else 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("probe"); p.add_argument("files", nargs="+"); p.set_defaults(fn=cmd_probe)
    p = sub.add_parser("style"); p.add_argument("file"); p.add_argument("--out")
    p.add_argument("--threshold", type=float, default=0.3); p.set_defaults(fn=cmd_style)
    p = sub.add_parser("frames"); p.add_argument("file"); p.add_argument("--at-cuts", required=True)
    p.add_argument("--outdir", required=True); p.add_argument("--max", type=int, default=60)
    p.set_defaults(fn=cmd_frames)
    p = sub.add_parser("beats"); p.add_argument("file"); p.add_argument("--out"); p.set_defaults(fn=cmd_beats)
    p = sub.add_parser("plays"); p.add_argument("file"); p.add_argument("--out")
    p.add_argument("--top", type=int, default=20); p.add_argument("--window", type=float, default=4.0)
    p.add_argument("--step", type=float, default=0.5); p.set_defaults(fn=cmd_plays)
    p = sub.add_parser("verify"); p.add_argument("file"); p.add_argument("--edl"); p.add_argument("--ref")
    p.set_defaults(fn=cmd_verify)
    for name in ("style", "beats", "verify"):
        sub.choices[name].add_argument("--bpm-range", nargs=2, type=float, default=[70, 180],
                                       metavar=("LO", "HI"), help="restrict tempo search, e.g. 135 145")
    a = ap.parse_args()
    a.bpm_range = [int(x) for x in getattr(a, "bpm_range", [70, 180])]
    a.fn(a)


if __name__ == "__main__":
    main()
