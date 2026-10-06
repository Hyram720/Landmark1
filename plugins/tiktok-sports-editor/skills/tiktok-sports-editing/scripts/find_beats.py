#!/usr/bin/env python3
"""Estimate tempo, beat grid, and drops in a music track so cuts land on the beat.

Pro sports edits cut on the beat and land the big play on the drop. This gives
you the timestamps to do that. Uses ffmpeg only.

Usage:
  find_beats.py music.mp3 [--out beats.json]

Output:
  bpm, beat_interval, beats (seconds), downbeats (every 4th beat),
  drops (biggest sustained energy jumps: put the payoff here)
"""
import argparse
import json
import math
import re
import subprocess
import sys

SR = 8000
HOP = 0.025


def levels(path):
    n = int(SR * HOP)
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vn", "-af",
         f"aformat=channel_layouts=mono,aresample={SR},asetnsamples=n={n}:p=0,"
         "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
         "-f", "null", "-"],
        capture_output=True, text=True,
    )
    out = []
    for m in re.finditer(r"RMS_level=(-?[0-9.]+|-?inf|nan)", proc.stdout):
        v = m.group(1)
        out.append(-96.0 if "inf" in v or v == "nan" else max(-96.0, float(v)))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("audio")
    ap.add_argument("--min-bpm", type=float, default=70)
    ap.add_argument("--max-bpm", type=float, default=180)
    ap.add_argument("--out")
    args = ap.parse_args()

    lv = levels(args.audio)
    if len(lv) < 40:
        sys.exit("error: audio too short or unreadable")
    onset = [0.0] + [max(0.0, b - a) for a, b in zip(lv, lv[1:])]
    mean = sum(onset) / len(onset)
    onset = [o - mean for o in onset]

    # tempo: autocorrelation of the onset envelope over the allowed BPM range
    best_lag, best_val = None, -1e18
    lo = int(round(60 / args.max_bpm / HOP))
    hi = int(round(60 / args.min_bpm / HOP))
    for lag in range(max(1, lo), hi + 1):
        v = sum(onset[i] * onset[i - lag] for i in range(lag, len(onset))) / (len(onset) - lag)
        if v > best_val:
            best_lag, best_val = lag, v
    interval = best_lag * HOP
    bpm = 60 / interval

    # phase: the grid offset that collects the most onset energy
    best_phase, best_sum = 0, -1e18
    for ph in range(best_lag):
        s = sum(onset[i] for i in range(ph, len(onset), best_lag))
        if s > best_sum:
            best_phase, best_sum = ph, s
    duration = len(lv) * HOP
    beats = [round(best_phase * HOP + k * interval, 3)
             for k in range(int((duration - best_phase * HOP) / interval) + 1)]

    # downbeat phase: of the 4 possible bar offsets, pick the one with the most onset energy
    def energy_at(t):
        i = int(t / HOP)
        return onset[i] if 0 <= i < len(onset) else 0.0
    bar_phase = max(range(4), key=lambda p: sum(energy_at(b) for b in beats[p::4]))
    downbeats = beats[bar_phase::4]

    # drops: largest rise in 2s average loudness vs the previous 2s
    w = int(2 / HOP)
    rises = []
    for i in range(w, len(lv) - w, int(0.5 / HOP)):
        before = sum(lv[i - w : i]) / w
        after = sum(lv[i : i + w]) / w
        rises.append((after - before, i * HOP))
    rises.sort(reverse=True)
    drops = []
    for rise, t in rises:
        if rise < 3:
            break
        if all(abs(t - d["time"]) > 4 for d in drops):
            nearest = min(downbeats or beats, key=lambda b: abs(b - t))
            drops.append({"time": round(nearest, 3), "rise_db": round(rise, 1)})
        if len(drops) >= 3:
            break

    result = {
        "file": args.audio,
        "duration": round(duration, 2),
        "bpm": round(bpm, 1),
        "beat_interval": round(interval, 3),
        "beats": beats,
        "downbeats": downbeats,
        "drops": drops,
        "tip": "Make segment output durations (end-start)/speed equal to whole beats, and line the payoff "
               "segment up with a drop. Set music.start so the drop lands at the payoff's output time.",
    }
    text = json.dumps(result, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)
        print(f"wrote {args.out}: {result['bpm']} BPM, {len(drops)} drops", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
