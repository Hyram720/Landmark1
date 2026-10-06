#!/usr/bin/env python3
"""Find highlight candidates in sports footage for short-form vertical edits.

Point it at one or more video files or folders (folders are searched
recursively) and it ranks the moments most likely to be highlights.

Signals (all via ffmpeg, no extra Python packages):
  * crowd level  - sustained roars / commentator spikes land on the big play
  * impacts      - sharp audio transients: punches landing, hits, rim/backboard slams
  * motion       - bursts of on-screen movement (fast breaks, flurries, open-field runs)
  * scene cuts   - broadcast replays and camera switches cluster around key moments

--sport tunes clip length, where the payoff sits in the clip, and how the
signals are weighted (boxing leans on impacts, football on sustained crowd,
college_football / college_basketball on sudden crowd surges, because bands
and student sections keep college crowds loud all game).

Output is JSON on stdout (or --out). Candidates are guesses: always confirm by
viewing frames before cutting.

Usage:
  analyze_footage.py VIDEO_OR_DIR [...] [--sport basketball|football|boxing|college_football|
                     college_basketball|generic]  (aliases: cfb, cbb, ncaaf, ncaab)
                     [--top 8] [--clip-len SECONDS] [--out analysis.json] [--timeline]
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm", ".mts", ".m2ts", ".ts", ".wmv"}
SAMPLE_RATE = 8000
HOP = 0.05     # seconds per audio frame (transient resolution)
WINDOW = 0.5   # seconds per scoring bucket
MOTION_FPS = 4

# clip_len: target seconds; peak_pos: where the payoff sits (0-1); smooth: buckets of +/- smoothing
# for crowd level; weights: crowd / impacts / motion
SPORTS = {
    "basketball": {"clip_len": 7.0, "peak_pos": 0.7, "smooth": 3,
                   "weights": {"crowd": 0.5, "impacts": 0.25, "motion": 0.25},
                   "look_for": "dunks, blocks, ankle-breakers, deep threes, buzzer beaters, and-ones, bench eruptions"},
    "football": {"clip_len": 10.0, "peak_pos": 0.72, "smooth": 4,
                 "weights": {"crowd": 0.6, "impacts": 0.15, "motion": 0.25},
                 "look_for": "long TDs, one-handed catches, jukes, big hits, pick-sixes, sacks, trick plays"},
    "boxing": {"clip_len": 6.0, "peak_pos": 0.6, "smooth": 2,
               "weights": {"crowd": 0.35, "impacts": 0.4, "motion": 0.25},
               "look_for": "knockdowns, KOs, clean counters, flurries/combos, slick defense (slips, rolls), staredowns"},
    # College crowds never sit still: bands, student-section chants, and fight songs keep the level
    # high all game. These profiles lean on "surge" (a sudden jump over the previous 3s) instead.
    "college_football": {"clip_len": 10.0, "peak_pos": 0.72, "smooth": 4,
                         "weights": {"crowd": 0.15, "surge": 0.45, "impacts": 0.15, "motion": 0.25},
                         "look_for": "long TDs, pick-sixes, one-handed catches, kick/punt returns, blocked kicks, "
                                     "goal-line stands, upsets, student-section/band eruptions, field storming"},
    "college_basketball": {"clip_len": 7.0, "peak_pos": 0.7, "smooth": 3,
                           "weights": {"crowd": 0.15, "surge": 0.4, "impacts": 0.2, "motion": 0.25},
                           "look_for": "buzzer beaters, March Madness upsets, posters, chase-down blocks, "
                                       "deep threes, student-section reactions, court storming, bench mobs"},
    "generic": {"clip_len": 8.0, "peak_pos": 0.7, "smooth": 3,
                "weights": {"crowd": 0.6, "impacts": 0.15, "motion": 0.25},
                "look_for": "the loudest, fastest, most surprising moments"},
}

ALIASES = {"cfb": "college_football", "ncaaf": "college_football",
           "cbb": "college_basketball", "ncaab": "college_basketball", "march_madness": "college_basketball"}


def collect_videos(paths):
    found = []
    for p in paths:
        if os.path.isdir(p):
            for root, _, files in os.walk(p):
                for f in sorted(files):
                    if os.path.splitext(f)[1].lower() in VIDEO_EXTS:
                        found.append(os.path.join(root, f))
        elif os.path.isfile(p):
            found.append(p)
        else:
            print(f"warning: not found: {p}", file=sys.stderr)
    return found


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        check=True, capture_output=True, text=True,
    ).stdout
    data = json.loads(out)
    video = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    if video is None:
        return None
    num, den = (video.get("avg_frame_rate") or "0/1").split("/")
    fps = float(num) / float(den) if float(den) else 0.0
    rotation = 0
    for sd in video.get("side_data_list", []):
        if "rotation" in sd:
            rotation = int(sd["rotation"])
    w, h = int(video["width"]), int(video["height"])
    if abs(rotation) in (90, 270):
        w, h = h, w
    return {
        "duration": float(data["format"].get("duration", 0)),
        "width": w,
        "height": h,
        "fps": round(fps, 3),
        "has_audio": audio is not None,
        "orientation": "vertical" if h > w else "horizontal" if w > h else "square",
    }


def audio_frames(path):
    """RMS level (dBFS) every HOP seconds, computed by ffmpeg's astats."""
    n = int(SAMPLE_RATE * HOP)
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vn", "-af",
         f"aformat=channel_layouts=mono,aresample={SAMPLE_RATE},asetnsamples=n={n}:p=0,"
         "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
         "-f", "null", "-"],
        capture_output=True, text=True,
    )
    levels = []
    for m in re.finditer(r"RMS_level=(-?[0-9.]+|-?inf|nan)", proc.stdout):
        v = m.group(1)
        levels.append(-96.0 if "inf" in v or v == "nan" else max(-96.0, float(v)))
    return levels


def motion_frames(path):
    """Mean absolute frame difference at MOTION_FPS on a tiny grayscale proxy."""
    w, h = 48, 27
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-an",
         "-vf", f"fps={MOTION_FPS},scale={w}:{h},format=gray", "-f", "rawvideo", "-"],
        capture_output=True,
    )
    raw = proc.stdout
    size = w * h
    frames = [raw[i : i + size] for i in range(0, len(raw) - size + 1, size)]
    diffs = [0.0]
    for a, b in zip(frames, frames[1:]):
        diffs.append(sum(abs(x - y) for x, y in zip(a, b)) / size)
    return diffs


def scene_cuts(path, threshold):
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", path, "-an",
         "-vf", f"scale=320:-2,select='gt(scene,{threshold})',showinfo", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    return [round(float(t), 2) for t in re.findall(r"pts_time:([0-9.]+)", proc.stderr)]


def bucket(values, per_bucket, n_buckets, how):
    out = []
    for b in range(n_buckets):
        chunk = values[int(b * per_bucket) : int((b + 1) * per_bucket)]
        if not chunk:
            out.append(out[-1] if out else 0.0)
        elif how == "max":
            out.append(max(chunk))
        else:
            out.append(sum(chunk) / len(chunk))
    return out


def zscores(values):
    if not values:
        return []
    mean = sum(values) / len(values)
    sd = math.sqrt(sum((v - mean) ** 2 for v in values) / len(values)) or 1.0
    return [(v - mean) / sd for v in values]


def smooth(values, k):
    return [sum(values[max(0, i - k) : i + k + 1]) / len(values[max(0, i - k) : i + k + 1])
            for i in range(len(values))]


def analyze(path, profile, clip_len, threshold):
    meta = probe(path)
    if meta is None:
        print(f"warning: no video stream, skipping {path}", file=sys.stderr)
        return None, []
    n = max(1, int(math.ceil(meta["duration"] / WINDOW)))

    signals = {}
    hop_levels = audio_frames(path) if meta["has_audio"] else []
    if hop_levels:
        per = WINDOW / HOP
        # crowd: average energy per bucket; impacts: biggest frame-to-frame jump in dB (onset strength)
        signals["crowd"] = bucket(hop_levels, per, n, "mean")
        jumps = [0.0] + [max(0.0, b - a) for a, b in zip(hop_levels, hop_levels[1:])]
        signals["impacts"] = bucket(jumps, per, n, "max")
        look = int(3 / WINDOW)
        signals["surge"] = [max(0.0, c - sum(signals["crowd"][max(0, i - look):i]) / max(1, min(i, look)))
                            if i else 0.0 for i, c in enumerate(signals["crowd"])]
        impact_threshold = sorted(jumps)[int(len(jumps) * 0.98)] if jumps else 99
        impact_times = [i * HOP for i, j in enumerate(jumps) if j >= max(impact_threshold, 6.0)]
    else:
        impact_times = []
    motion = motion_frames(path)
    if motion:
        signals["motion"] = bucket(motion, WINDOW * MOTION_FPS, n, "max")
    cuts = scene_cuts(path, threshold)

    weights = {k: v for k, v in profile["weights"].items() if k in signals}
    total_w = sum(weights.values()) or 1.0
    smoothing = {"crowd": profile["smooth"], "surge": 1, "impacts": 1, "motion": 2}
    norm = {k: smooth(zscores(signals[k]), smoothing[k]) for k in weights}
    score = [sum(weights[k] * norm[k][i] for k in weights) / total_w for i in range(n)]

    picks = []
    for i in sorted(range(n), key=lambda i: score[i], reverse=True):
        if score[i] < 0.4:
            break
        peak_t = i * WINDOW + WINDOW / 2
        if any(abs(peak_t - p["peak"]) < clip_len * 0.8 for p in picks):
            continue
        start = max(0.0, peak_t - clip_len * profile["peak_pos"])
        end = min(meta["duration"], start + clip_len)
        start = max(0.0, end - clip_len)
        in_clip_cuts = [c for c in cuts if start <= c <= end]
        picks.append({
            "file": path,
            "start": round(start, 2),
            "end": round(end, 2),
            "peak": round(peak_t, 2),
            "score": round(score[i] + 0.1 * min(len(in_clip_cuts), 4), 2),
            "signals_at_peak": {k: round(norm[k][i], 2) for k in norm},
            "impacts_in_clip": [round(t, 2) for t in impact_times if start <= t <= end],
            "scene_cuts_in_clip": in_clip_cuts,
        })
        if len(picks) >= 25:
            break

    meta["file"] = path
    meta["scene_cut_count"] = len(cuts)
    meta["_timeline"] = {k: [round(v, 2) for v in signals[k]] for k in signals}
    return meta, picks


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help="video files and/or folders")
    ap.add_argument("--sport", choices=sorted(SPORTS) + sorted(ALIASES), default="generic")
    ap.add_argument("--clip-len", type=float, help="override the sport's default clip length (seconds)")
    ap.add_argument("--top", type=int, default=8, help="max candidates across all files (default 8)")
    ap.add_argument("--scene-threshold", type=float, default=0.35)
    ap.add_argument("--timeline", action="store_true", help="include per-half-second signal values")
    ap.add_argument("--out", help="write JSON here instead of stdout")
    args = ap.parse_args()

    args.sport = ALIASES.get(args.sport, args.sport)
    profile = SPORTS[args.sport]
    clip_len = args.clip_len or profile["clip_len"]
    videos = collect_videos(args.paths)
    if not videos:
        sys.exit("error: no video files found")

    files, candidates = [], []
    for i, v in enumerate(videos, 1):
        print(f"[{i}/{len(videos)}] analyzing {v}", file=sys.stderr)
        meta, picks = analyze(v, profile, clip_len, args.scene_threshold)
        if meta is None:
            continue
        timeline = meta.pop("_timeline")
        if args.timeline:
            meta["timeline_half_seconds"] = timeline
        files.append(meta)
        candidates.extend(picks)

    candidates.sort(key=lambda p: p["score"], reverse=True)
    candidates = candidates[: args.top]
    for rank, p in enumerate(candidates, 1):
        p["rank"] = rank

    result = {
        "sport": args.sport,
        "look_for": profile["look_for"],
        "clip_len": clip_len,
        "files": files,
        "candidates": candidates,
        "notes": "Signal-based guesses. Confirm each by viewing frames around 'peak' "
                 "(ffmpeg -ss <t> -i <file> -frames:v 1 f.jpg). 'impacts_in_clip' marks sharp hits: "
                 "punches landing, collisions, rim slams; good spots for flash/shake/boom effects.",
    }
    text = json.dumps(result, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)
        print(f"wrote {args.out}: {len(candidates)} candidates from {len(files)} file(s)", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
