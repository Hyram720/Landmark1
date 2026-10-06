#!/usr/bin/env python3
"""Turn analyze_footage.py results into a render-ready long-form edit plan (default 62s).

Built for TikTok's Creator Rewards Program, which only pays on videos longer
than one minute. Holding attention that long takes structure, so the draft uses
a countdown:

  0-3s     cold open: a flash of the best moment in slow-mo, plus the hook
  then     moments in countdown order (#N ... #2), each played at real speed,
           followed by a slow-mo replay with flash + shake + boom on the impact
  last     #1, the best moment, saved for the end (the cold open promised it)

A "top" caption labels each moment (#5, #4, ...), which re-hooks the viewer
about every 10 seconds. Clips are extended or trimmed so the total lands just
over the target.

Every timestamp is a signal-based guess: view frames and adjust before rendering.

Usage:
  draft_plan.py analysis.json [--duration 62] [--moments 5] [--out plan.json]
"""
import argparse
import json
import os
import sys

# seconds before/after the impact for the real-speed play, and the default grade
STYLE = {
    "basketball": (4.0, 2.0, "punchy"),
    "college_basketball": (4.0, 2.5, "punchy"),
    "football": (6.0, 2.5, "teal_orange"),
    "college_football": (6.0, 3.0, "teal_orange"),
    "boxing": (3.0, 2.0, "gritty"),
    "generic": (4.0, 2.0, "punchy"),
}
REPLAY_PRE, REPLAY_POST, REPLAY_SPEED = 0.3, 0.9, 0.4   # replay = 3.0s, impact lands at 0.75s
COLD_OPEN_PRE, COLD_OPEN_POST, COLD_OPEN_SPEED = 0.4, 0.6, 0.5


def impact_time(c):
    hits = [t for t in c.get("impacts_in_clip", []) if abs(t - c["peak"]) <= 1.5]
    return min(hits, key=lambda t: abs(t - c["peak"])) if hits else c["peak"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("analysis")
    ap.add_argument("--duration", type=float, default=62.0, help="target length in seconds (default 62)")
    ap.add_argument("--moments", type=int, default=5, help="how many moments to count down (default 5)")
    ap.add_argument("--output-video", default="tiktok_60s.mp4")
    ap.add_argument("--out", help="write the plan here (default: stdout)")
    args = ap.parse_args()

    with open(args.analysis) as f:
        analysis = json.load(f)
    sport = analysis.get("sport", "generic")
    pre, post, grade = STYLE.get(sport, STYLE["generic"])
    durations = {f["file"]: f["duration"] for f in analysis["files"]}
    cands = analysis["candidates"][: args.moments]
    if not cands:
        sys.exit("error: no candidates in the analysis. Lower the threshold or add footage")
    base = os.path.dirname(os.path.abspath(args.analysis))

    def rel(path):
        return os.path.relpath(os.path.abspath(path), base)

    best = cands[0]
    order = list(reversed(cands))           # countdown: weakest first, #1 last
    n = len(order)

    # first pass: how much time do the parts take at default lengths?
    opener = (COLD_OPEN_PRE + COLD_OPEN_POST) / COLD_OPEN_SPEED
    replay = (REPLAY_PRE + REPLAY_POST) / REPLAY_SPEED
    base_total = opener + n * (pre + post + replay)
    # spread any shortfall/excess across the real-speed lead-ins (more build-up reads as storytelling)
    adjust = (args.duration - base_total) / n
    lead = max(1.5, pre + adjust)

    segments, captions, t = [], [], 0.0
    bi = impact_time(best)
    segments.append({
        "input": rel(best["file"]),
        "start": round(max(0.0, bi - COLD_OPEN_PRE), 2), "end": round(bi + COLD_OPEN_POST, 2),
        "speed": COLD_OPEN_SPEED, "zoom": 1.3,
        "effects": [{"type": "flash", "at": round(COLD_OPEN_PRE / COLD_OPEN_SPEED, 2)},
                    {"type": "rgb_split", "at": round(COLD_OPEN_PRE / COLD_OPEN_SPEED, 2)}],
        "_note": "cold open: tease of #1",
    })
    t += opener

    for rank_from_top, c in zip(range(n, 0, -1), order):
        imp = impact_time(c)
        dur_file = durations.get(c["file"], imp + post)
        start = max(0.0, imp - lead)
        end = min(dur_file, imp + post)
        real_len = end - start
        captions.append({"start": round(t + 0.1, 2), "end": round(t + min(2.6, real_len), 2),
                         "text": f"#{rank_from_top}", "style": "top"})
        segments.append({
            "input": rel(c["file"]), "start": round(start, 2), "end": round(end, 2),
            "effects": [{"type": "whoosh", "at": 0}] if rank_from_top != n else [],
            "_note": f"#{rank_from_top} real speed; impact ~{imp:.2f}s in source",
        })
        t += real_len
        r_start = max(0.0, imp - REPLAY_PRE)
        hit_at = round((imp - r_start) / REPLAY_SPEED, 2)
        segments.append({
            "input": rel(c["file"]), "start": round(r_start, 2), "end": round(imp + REPLAY_POST, 2),
            "speed": REPLAY_SPEED, "zoom": 1.4 if rank_from_top > 1 else 1.6,
            "freeze": 0.6 if rank_from_top == 1 else 0,
            "effects": [{"type": "flash", "at": hit_at}, {"type": "shake", "at": hit_at},
                        {"type": "boom", "at": hit_at}] + ([{"type": "bw", "at": hit_at}] if rank_from_top == 1 else []),
            "_note": f"#{rank_from_top} replay",
        })
        t += (imp + REPLAY_POST - r_start) / REPLAY_SPEED + (0.6 if rank_from_top == 1 else 0)
        captions.append({"start": round(t - 2.2, 2), "end": round(t - 0.2, 2),
                         "text": "TODO payoff caption", "style": "impact" if rank_from_top == 1 else "pop"})

    plan = {
        "_draft": (f"Auto-drafted {sport} countdown, ~{t:.1f}s. Confirm every timestamp by viewing frames, "
                   "replace TODO text, and keep the total over 60s for Creator Rewards."),
        "output": args.output_video,
        "target_duration": args.duration,
        "grade": grade,
        "reframe": "blur",
        "segments": segments,
        "hook": {"text": f"TODO: hook (e.g. 'TOP {n} PLAYS. #1 IS INSANE')", "style": "stamp", "duration": 2.5},
        "captions": captions,
        "cover_at": round(t - 2.0, 2),
    }
    text = json.dumps(plan, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)
        print(f"wrote {args.out}: {len(segments)} segments, ~{t:.1f}s", file=sys.stderr)
    else:
        print(text)
    if t <= 60:
        print(f"warning: draft is {t:.1f}s, not over 60s. Add footage or moments (--moments)", file=sys.stderr)


if __name__ == "__main__":
    main()
