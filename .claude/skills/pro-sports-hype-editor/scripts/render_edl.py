#!/usr/bin/env python3
"""Render a hype edit from an EDL (edit decision list) JSON with ffmpeg.

  render_edl.py edl.json --out final.mp4 [--workdir DIR] [--preview]

EDL schema (times in seconds; shot times are on the OUTPUT timeline):
{
  "width": 1080, "height": 1920, "fps": 30,
  "music": "beat.wav", "music_start": 0.0, "music_db": 0,
  "beats_json": "beat.json",              # optional, used for the QA plan
  "grade": "teal_orange" | "moody" | "punchy" | "clean" | "<raw ffmpeg filter chain>",
  "enhance": "auto" | "none" | "<raw filter chain>",
  "grain": true, "vignette": true, "letterbox": false,   # grain: true(=3) or 1-10
  "max_mbps": 16,                                        # bitrate cap (default 16, 40 for 4K)
  "fadeout": 0.6, "loudness": -14,
  "shots": [
    {"src": "game.mp4", "in": 12.30, "dur": 0.857, "speed": 1.0, "smooth": false,
     "crop_x": 0.5,                        # 0..1 horizontal framing when cropping to aspect
     "fx": ["flash", "punch@0.10", "shake@0.10", "rgb@0.0", "flash_out", "freeze:0.8"],
     "game_audio_db": -12,                 # omit/null = mute source audio
     "text": {"text": "#23", "at": 0.1, "dur": 1.0, "y": 0.78, "size": 0.085}}
  ],
  "text": [{"text": "JORDAN SMITH", "start": 0.4, "end": 2.2, "y": 0.5, "size": 0.1}],
  "sfx":  [{"file": "sfx/impact.wav", "t": 6.86, "db": -2}]
}
`in` + `dur*speed` must fit inside the source. Freeze frames extend a shot by the
freeze length. Writes OUT and OUT.plan.json (for analyze.py verify --edl).

BEAT MODE (recommended): set top-level "bpm" (and optional "beat_offset", the time of
beat 0 in the output) and give shots "beats": N instead of "dur". Shot boundaries are
then rounded to frames from the absolute beat grid, so cuts never drift off the music.
In beat mode `freeze:N` means N beats (so the next cut still lands on a beat); fx times
(`punch@t` etc.) and `text.at/dur` are always seconds from the shot's start.
Impact anchoring: give "impact" (source time of contact/release/catch) instead of "in"
and optionally "impact_beat" (beats after the shot start where the impact should land,
default 0 = right on the cut). `in` is derived as impact - impact_beat*period*speed.
"""
import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys

GRADES = {
    "teal_orange": "curves=master='0/0 0.10/0.04 0.5/0.5 0.90/0.96 1/1',"
                   "colorbalance=rs=-0.06:gs=-0.01:bs=0.08:rh=0.07:gh=0.01:bh=-0.06,eq=contrast=1.08:saturation=1.18",
    "moody": "curves=master='0/0 0.15/0.05 0.5/0.47 0.9/0.93 1/1',eq=contrast=1.15:saturation=0.78:gamma=0.97,"
             "colorbalance=bs=0.05:bm=0.02",
    "punchy": "curves=master='0/0 0.08/0.03 0.5/0.52 0.92/0.97 1/1',eq=contrast=1.12:saturation=1.32",
    "clean": "eq=contrast=1.05:saturation=1.08",
}
ENHANCE_AUTO = "hqdn3d=2:1.5:3:2.5,unsharp=5:5:0.7:3:3:0.3"
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/bebas/BebasNeue-Regular.ttf",
    "/usr/share/fonts/truetype/anton/Anton-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def sh(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit(f"ffmpeg failed:\n{' '.join(cmd)}\n{p.stderr[-3000:]}")
    return p


def has_audio(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
                        "stream=index", "-of", "csv=p=0", path], capture_output=True, text=True)
    return bool(p.stdout.strip())


def atempo_chain(speed):
    parts, s = [], speed
    while s < 0.5:
        parts.append("atempo=0.5"); s /= 0.5
    while s > 2.0:
        parts.append("atempo=2.0"); s /= 2.0
    parts.append(f"atempo={s:.5f}")
    return ",".join(parts)


def font():
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            return f
    sys.exit("no usable font found")


def drawtext(textfile, start, end, y, size, H, W):
    text = open(textfile).read()
    longest = max((len(l) for l in text.splitlines()), default=1)
    # auto-fit: bold caps average ~0.68 em per glyph; keep the line (incl. the 1.35x slam) inside 90% width
    fs = int(min(H * size, 0.90 * W / (0.68 * max(1, longest) * 1.12)))
    # slam-in: starts 35% larger and snaps down over ~0.12 s; fades in fast
    return (f"drawtext=fontfile='{font()}':textfile='{textfile}':fontcolor=white:"
            f"borderw={max(2, fs // 16)}:bordercolor=black@0.85:shadowx=0:shadowy={max(2, fs // 20)}:"
            f"shadowcolor=black@0.6:fontsize='{fs}*(1+0.12*max(0,1-(t-{start:.3f})/0.12))':"
            f"x=(w-text_w)/2:y={y:.3f}*h-text_h/2:alpha='min(1,max(0,(t-{start:.3f})/0.06))':"
            f"enable='between(t,{start:.3f},{end:.3f})'")


def measure(path):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af",
                        "loudnorm=print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    j = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", p.stderr).group(0))
    return {"I": float(j["input_i"]), "TP": float(j["input_tp"])}


def master_audio(src, dst, target, tp_ceiling=-2.0):
    """Gain to target loudness, then a brick-wall limiter well under 0 dBTP (leaves room for
    AAC inter-sample overs). Re-measures and corrects the gain up to 3 times."""
    m = measure(src)
    gain = target - m["I"]
    lim = 10 ** (tp_ceiling / 20)
    for _ in range(3):
        sh(["ffmpeg", "-v", "error", "-y", "-i", src, "-af",
            f"volume={gain:.2f}dB,alimiter=limit={lim:.4f}:attack=2:release=60:level=disabled,"
            f"alimiter=limit={lim:.4f}:attack=0.5:release=20:level=disabled",
            "-c:a", "pcm_s24le", "-ar", "48000", dst])
        r = measure(dst)
        if abs(r["I"] - target) <= 0.5 and r["TP"] <= tp_ceiling + 0.6:
            break
        gain += target - r["I"]
        if r["TP"] > tp_ceiling + 0.6:
            lim *= 10 ** ((tp_ceiling - r["TP"]) / 20)
    return r


def parse_fx(fx):
    out = []
    for f in fx or []:
        name, _, arg = f.partition("@")
        if ":" in name:
            name, _, arg = name.partition(":")
        out.append((name, float(arg) if arg else 0.0))
    return out


def render_shot(i, shot, E, wd):
    W, H, F = E["width"], E["height"], E["fps"]
    speed = float(shot.get("speed", 1.0))
    dur, freeze = shot["_dur"], shot["_freeze"]
    fx = parse_fx(shot.get("fx"))
    total = dur + freeze
    nframes = round(total * F)
    src_len = dur * speed + 0.5
    cx = float(shot.get("crop_x", 0.5))
    vf = [f"setpts=(PTS-STARTPTS)/{speed:.5f}"]
    vf.append(f"minterpolate=fps={F}:mi_mode=mci:mc_mode=aobmc:vsbmc=1" if shot.get("smooth") and speed < 1 else f"fps={F}")
    enh = E.get("enhance", "auto")
    if enh == "auto":
        vf.append(ENHANCE_AUTO)
    elif enh and enh != "none":
        vf.append(enh)
    vf.append(f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos")
    vf.append(f"crop={W}:{H}:(iw-{W})*{cx:.3f}:(ih-{H})/2")
    g = E.get("grade", "teal_orange")
    if g and g != "none":
        vf.append(GRADES.get(g, g))
    vf.append(f"trim=duration={dur:.4f},setpts=PTS-STARTPTS")
    if freeze:
        vf.append(f"tpad=stop_mode=clone:stop_duration={freeze + 0.5:.3f}")
    for name, at in fx:
        n0 = round(at * F)
        if name == "punch":
            vf.append(f"zoompan=z='if(gte(on,{n0}),max(1,1.24-0.04*(on-{n0})),1)':"
                      f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={F}")
        elif name == "push":                      # slow push-in across the shot (great on freezes)
            vf.append(f"zoompan=z='1+0.0025*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={F}")
        elif name == "shake":
            m = max(16, W // 40)
            en = f"between(t,{at:.3f},{at + 0.3:.3f})"
            vf.append(f"pad=iw+{2 * m}:ih+{2 * m}:{m}:{m}:color=black,"
                      f"crop={W}:{H}:x='{m}+{m}*sin(n*2.3)*{en}':y='{m}+{m}*cos(n*3.1)*{en}'")
        elif name == "rgb":
            vf.append(f"rgbashift=rh=-{W // 90}:bh={W // 90}:enable='between(t,{at:.3f},{at + 0.12:.3f})'")
        elif name == "flash":
            vf.append("fade=t=in:st=0:d=0.12:color=white")
        elif name == "flash_out":
            vf.append(f"fade=t=out:st={max(0, total - 0.08):.3f}:d=0.08:color=white")
        elif name == "dip":
            vf.append("fade=t=in:st=0:d=0.15:color=black")
    if shot.get("text"):
        t = shot["text"]
        tf = os.path.join(wd, f"shot{i:03d}.txt")
        open(tf, "w").write(t["text"])
        st = float(t.get("at", 0)); en = st + float(t.get("dur", total - st))
        vf.append(drawtext(tf, st, en, float(t.get("y", 0.8)), float(t.get("size", 0.085)), H, W))
    vf.append("tpad=stop_mode=clone:stop_duration=2,format=yuv420p")
    seg = os.path.join(wd, f"seg{i:03d}.mp4")
    aseg = os.path.join(wd, f"seg{i:03d}.wav")
    db = shot.get("game_audio_db")
    key = hashlib.sha1(json.dumps([vf, shot["src"], os.path.getmtime(shot["src"]), shot["in"], src_len,
                                   nframes, F, db, speed, E.get("_preset")], sort_keys=True).encode()).hexdigest()
    keyf = seg + ".key"
    if os.path.exists(seg) and os.path.exists(aseg) and os.path.exists(keyf) and open(keyf).read() == key:
        return seg, aseg, nframes / F, freeze          # unchanged since last render
    sh(["ffmpeg", "-v", "error", "-y", "-ss", f"{shot['in']:.4f}", "-t", f"{src_len:.4f}", "-i", shot["src"],
        "-an", "-vf", ",".join(vf), "-frames:v", str(nframes), "-r", str(F),
        "-c:v", "libx264", "-preset", E.get("_preset", "medium"), "-crf", "14", seg])
    # matching game-audio segment
    if db is not None and has_audio(shot["src"]):
        af = f"{atempo_chain(speed)},volume={db}dB,apad,atrim=duration={total:.4f}"
        sh(["ffmpeg", "-v", "error", "-y", "-ss", f"{shot['in']:.4f}", "-t", f"{src_len:.4f}", "-i", shot["src"],
            "-vn", "-af", af, "-ar", "48000", "-ac", "2", aseg])
    else:
        sh(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
            "-t", f"{total:.4f}", aseg])
    open(keyf, "w").write(key)
    return seg, aseg, nframes / F, freeze


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("edl")
    ap.add_argument("--out", required=True)
    ap.add_argument("--workdir")
    ap.add_argument("--preview", action="store_true", help="fast, lower quality render")
    a = ap.parse_args()
    E = json.load(open(a.edl))
    base = os.path.dirname(os.path.abspath(a.edl))
    def P(p):
        return p if os.path.isabs(p) else os.path.join(base, p)
    for s in E["shots"]:
        s["src"] = P(s["src"])
    wd = a.workdir or os.path.splitext(os.path.abspath(a.out))[0] + "_work"
    os.makedirs(wd, exist_ok=True)
    if a.preview:
        E["_preset"] = "veryfast"
    W, H, F = E["width"], E["height"], E["fps"]

    # resolve durations (seconds or frame-quantized beat grid) and source in-points
    bpm = E.get("bpm")
    period = 60.0 / bpm if bpm else None
    b, t_out = 0.0, 0.0
    for s in E["shots"]:
        frz = sum(a for n, a in parse_fx(s.get("fx")) if n == "freeze")
        if "beats" in s:
            if not period:
                sys.exit("shots use 'beats' but the EDL has no 'bpm'")
            off = float(E.get("beat_offset", 0))
            f0 = round((off + b * period) * F) if b else 0
            f1 = round((off + (b + s["beats"]) * period) * F)
            f2 = round((off + (b + s["beats"] + frz) * period) * F)
            s["_dur"], s["_freeze"] = (f1 - f0) / F, (f2 - f1) / F
            b += s["beats"] + frz
        else:
            s["_dur"], s["_freeze"] = float(s["dur"]), frz
        if "in" not in s:
            if "impact" not in s:
                sys.exit("each shot needs 'in' or 'impact'")
            lead = float(s.get("impact_beat", 0)) * (period or 0) * float(s.get("speed", 1.0))
            s["in"] = max(0.0, float(s["impact"]) - lead)

    segs, asegs, t, cut_times, freeze_times = [], [], 0.0, [], []
    for i, s in enumerate(E["shots"]):
        seg, aseg, d, fr = render_shot(i, s, E, wd)
        if i:
            cut_times.append(round(t, 4))
        if fr:
            freeze_times.append(round(t + d - fr, 3))
        segs.append(seg); asegs.append(aseg); t += d
        print(f"  shot {i + 1}/{len(E['shots'])}: {os.path.basename(s['src'])} @{s['in']:.2f}s -> {d:.3f}s", flush=True)
    total = t

    lst = os.path.join(wd, "v.txt")
    open(lst, "w").write("".join(f"file '{p}'\n" for p in segs))
    vcat = os.path.join(wd, "video.mp4")
    sh(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", vcat])
    alst = os.path.join(wd, "a.txt")
    open(alst, "w").write("".join(f"file '{p}'\n" for p in asegs))
    game = os.path.join(wd, "game.wav")
    sh(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", alst, "-c", "pcm_s16le", game])

    # ---- audio mix: music + game audio + sfx
    inputs, filt, mix = ["-i", game], [], ["[g]"]
    filt.append(f"[0:a]aresample=48000,atrim=duration={total:.4f}[g]")
    idx = 1
    if E.get("music"):
        inputs += ["-i", P(E["music"])]
        filt.append(f"[{idx}:a]aresample=48000,aformat=channel_layouts=stereo,"
                    f"atrim=start={E.get('music_start', 0):.4f}:duration={total:.4f},asetpts=PTS-STARTPTS,"
                    f"volume={E.get('music_db', 0)}dB[m]")
        mix.append("[m]"); idx += 1
    for k, fxs in enumerate(E.get("sfx", [])):
        inputs += ["-i", P(fxs["file"])]
        ms = int(float(fxs["t"]) * 1000)
        filt.append(f"[{idx}:a]aresample=48000,aformat=channel_layouts=stereo,"
                    f"adelay={ms}|{ms},volume={fxs.get('db', 0)}dB[s{k}]")
        mix.append(f"[s{k}]"); idx += 1
    fo = float(E.get("fadeout", 0.6))
    filt.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0:duration=first,"
                f"atrim=duration={total:.4f},afade=t=out:st={max(0, total - fo):.4f}:d={fo:.3f}[aout]")
    mixwav = os.path.join(wd, "mix.wav")
    sh(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filt), "-map", "[aout]",
        "-c:a", "pcm_f32le", "-ar", "48000", mixwav])
    master = master_audio(mixwav, os.path.join(wd, "master.wav"), float(E.get("loudness", -14)))
    print(f"  audio master: {master['I']:.1f} LUFS, true peak {master['TP']:.1f} dBTP")

    # ---- global video pass: grain, vignette, letterbox, titles, fade out
    vf = []
    grain = E.get("grain", True)
    if grain:
        # strength 1-10 (true = 3); heavy temporal grain explodes the bitrate, keep it subtle
        vf.append(f"noise=alls={3 if grain is True else int(grain)}:allf=t")
    if E.get("vignette", True):
        vf.append("vignette=PI/5")
    if E.get("letterbox"):
        vf.append("drawbox=x=0:y=0:w=iw:h=ih*0.11:color=black:t=fill,"
                  "drawbox=x=0:y=ih*0.89:w=iw:h=ih*0.11:color=black:t=fill")
    for k, tx in enumerate(E.get("text", [])):
        tf = os.path.join(wd, f"title{k:02d}.txt")
        open(tf, "w").write(tx["text"])
        vf.append(drawtext(tf, float(tx["start"]), float(tx["end"]), float(tx.get("y", 0.5)),
                           float(tx.get("size", 0.1)), H, W))
    vf.append(f"fade=t=out:st={max(0, total - fo):.4f}:d={fo:.3f},format=yuv420p")
    crf = "23" if a.preview else "18"
    # cap bitrate to what social/streaming platforms accept (they re-encode anyway)
    mbps = E.get("max_mbps", 40 if W * H > 1920 * 1080 * 1.5 else 16)
    preset = "veryfast" if a.preview else "slow"
    sh(["ffmpeg", "-v", "error", "-y", "-i", vcat, "-i", os.path.join(wd, "master.wav"),
        "-vf", ",".join(vf), "-map", "0:v", "-map", "1:a", "-r", str(F),
        "-c:v", "libx264", "-preset", preset, "-crf", crf, "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-maxrate", f"{mbps}M", "-bufsize", f"{2 * mbps}M", "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-movflags", "+faststart",
        "-t", f"{total:.4f}", a.out])

    plan = {"width": W, "height": H, "fps": F, "duration_planned": round(total, 3),
            "cut_times": cut_times, "freeze_times": freeze_times}
    if period:
        off = float(E.get("beat_offset", 0))
        plan["bpm"] = bpm
        plan["beats"] = [round(off + k * period, 4) for k in range(int((total - off) / period) + 1)]
    elif E.get("beats_json") and os.path.exists(P(E["beats_json"])):
        bj = json.load(open(P(E["beats_json"])))
        off = float(E.get("music_start", 0))
        plan["beats"] = [round(b - off, 4) for b in bj.get("beats", []) if b >= off]
        plan["bpm"] = bj.get("bpm")
    json.dump(plan, open(a.out + ".plan.json", "w"), indent=2)
    print(f"rendered {a.out}: {total:.2f}s, {len(segs)} shots; plan -> {a.out}.plan.json")


if __name__ == "__main__":
    main()
