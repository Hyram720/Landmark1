#!/usr/bin/env python3
"""Find highlight candidates in sports footage for short-form vertical edits.

Signals used (all via ffmpeg, no extra Python packages):
  * audio energy  - crowd roars / commentator spikes usually land right on the big play
  * scene cuts    - broadcast replays and camera switches cluster around key moments

Output is JSON on stdout (or --out): video metadata, scene cuts, and ranked
clip candidates whose payoff (loudest moment) sits ~70% of the way into the
clip, so the viewer gets a short build-up and then the moment.

Usage:
  analyze_footage.py game.mp4 [--clip-len 8] [--top 5] [--out analysis.json]
"""
import argparse
import array
import json
import math
import re
import subprocess
import sys

SAMPLE_RATE = 8000
WINDOW = 0.5  # seconds per audio energy bucket


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        check=True, capture_output=True, text=True,
    ).stdout
    data = json.loads(out)
    video = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    if video is None:
        sys.exit(f"error: no video stream in {path}")
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


def audio_energy(path):
    """Return RMS loudness (dBFS) per WINDOW-second bucket."""
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
         "-f", "s16le", "-"],
        check=True, capture_output=True,
    )
    samples = array.array("h")
    samples.frombytes(proc.stdout[: len(proc.stdout) // 2 * 2])
    step = int(SAMPLE_RATE * WINDOW)
    levels = []
    for i in range(0, len(samples), step):
        chunk = samples[i : i + step]
        if not chunk:
            break
        rms = math.sqrt(sum(s * s for s in chunk) / len(chunk))
        levels.append(20 * math.log10(rms / 32768) if rms > 0 else -96.0)
    return levels


def scene_cuts(path, threshold):
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", path, "-an",
         "-vf", f"scale=320:-2,select='gt(scene,{threshold})',showinfo", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    return [round(float(t), 2) for t in re.findall(r"pts_time:([0-9.]+)", proc.stderr)]


def zscores(values):
    if not values:
        return []
    mean = sum(values) / len(values)
    sd = math.sqrt(sum((v - mean) ** 2 for v in values) / len(values)) or 1.0
    return [(v - mean) / sd for v in values]


def find_candidates(levels, cuts, duration, clip_len, top):
    z = zscores(levels)
    # Smooth over ~1.5s so a sustained roar beats a single clap.
    k = 3
    smooth = [sum(z[max(0, i - k) : i + k + 1]) / len(z[max(0, i - k) : i + k + 1]) for i in range(len(z))]
    order = sorted(range(len(smooth)), key=lambda i: smooth[i], reverse=True)

    picks = []
    for i in order:
        if len(picks) >= top or smooth[i] < 0.5:
            break
        peak_t = i * WINDOW + WINDOW / 2
        if any(abs(peak_t - p["peak"]) < clip_len for p in picks):
            continue
        start = max(0.0, peak_t - clip_len * 0.7)
        end = min(duration, start + clip_len)
        start = max(0.0, end - clip_len)
        nearby_cuts = [c for c in cuts if start <= c <= end]
        score = smooth[i] + 0.15 * min(len(nearby_cuts), 4)
        picks.append({
            "start": round(start, 2),
            "end": round(end, 2),
            "peak": round(peak_t, 2),
            "audio_z": round(smooth[i], 2),
            "scene_cuts_in_clip": nearby_cuts,
            "score": round(score, 2),
        })
    picks.sort(key=lambda p: p["score"], reverse=True)
    for rank, p in enumerate(picks, 1):
        p["rank"] = rank
    return picks


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--clip-len", type=float, default=8.0, help="target seconds per candidate clip (default 8)")
    ap.add_argument("--top", type=int, default=5, help="max candidates to return (default 5)")
    ap.add_argument("--scene-threshold", type=float, default=0.35)
    ap.add_argument("--out", help="write JSON here instead of stdout")
    args = ap.parse_args()

    meta = probe(args.video)
    levels = audio_energy(args.video) if meta["has_audio"] else []
    cuts = scene_cuts(args.video, args.scene_threshold)
    if levels:
        candidates = find_candidates(levels, cuts, meta["duration"], args.clip_len, args.top)
    else:
        # No audio: fall back to the densest clusters of scene cuts.
        candidates = []
        for c in cuts:
            start = max(0.0, c - args.clip_len * 0.5)
            end = min(meta["duration"], start + args.clip_len)
            n = len([x for x in cuts if start <= x <= end])
            candidates.append({"start": round(start, 2), "end": round(end, 2), "peak": c, "score": n})
        candidates.sort(key=lambda p: p["score"], reverse=True)
        dedup = []
        for c in candidates:
            if all(abs(c["peak"] - d["peak"]) >= args.clip_len for d in dedup):
                dedup.append(c)
        candidates = dedup[: args.top]
        for rank, p in enumerate(candidates, 1):
            p["rank"] = rank

    result = {
        "input": args.video,
        "metadata": meta,
        "scene_cuts": cuts,
        "loudness_db_per_half_second": [round(v, 1) for v in levels],
        "candidates": candidates,
        "notes": "Candidates are signal-based guesses. Always confirm the actual play by viewing frames "
                 "(ffmpeg -ss <t> -frames:v 1) before committing to an edit.",
    }
    text = json.dumps(result, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)
        print(f"wrote {args.out}: {len(candidates)} candidates", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
