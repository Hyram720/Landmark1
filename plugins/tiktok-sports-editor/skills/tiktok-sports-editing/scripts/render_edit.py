#!/usr/bin/env python3
"""Render a TikTok-ready vertical sports edit from a JSON edit plan.

Pipeline (ffmpeg only):
  1. cut each segment, apply speed (slow-mo / speed-up) and punch-in zoom,
     reframe to 9:16 (blurred background, smart crop, or letterbox)
  2. join the segments
  3. burn in the hook text + captions (kept inside TikTok's UI safe zone),
     optionally mix a music bed, normalize loudness, export H.264/AAC

See references/edit-plan-schema.md for every field. Minimal plan:
  {"input": "game.mp4", "output": "tiktok.mp4",
   "segments": [{"start": 41.0, "end": 47.5}],
   "hook": {"text": "HE DID NOT JUST DO THAT"}}

Usage:
  render_edit.py plan.json [--dry-run]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

DEFAULTS = {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "reframe": "blur",       # blur | crop | fit
    "crop_center": 0.5,      # 0 = left edge, 1 = right edge (crop mode focus)
    "font": "DejaVu Sans",
    "loudness": -14,         # integrated LUFS target; TikTok plays back around here
    "crf": 18,
    "video_bitrate": "12M",  # cap; TikTok re-encodes, so feed it a clean high-quality master
}

# TikTok UI overlays (caption, buttons, nav) — keep text out of these bands at 1080x1920.
SAFE_TOP = 260
SAFE_BOTTOM = 480
SAFE_SIDE = 140


def run(cmd, dry, cwd=None):
    print("+ " + " ".join(cmd), file=sys.stderr)
    if not dry:
        subprocess.run(cmd, check=True, cwd=cwd)


def has_audio(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    ).stdout.strip()
    return bool(out)


def atempo_chain(speed):
    """atempo only accepts 0.5..2.0 per instance, so chain them."""
    parts = []
    s = speed
    while s < 0.5:
        parts.append("atempo=0.5")
        s /= 0.5
    while s > 2.0:
        parts.append("atempo=2.0")
        s /= 2.0
    parts.append(f"atempo={s:.4f}")
    return ",".join(parts)


def reframe_filter(cfg, zoom):
    W, H = cfg["width"], cfg["height"]
    mode = cfg["reframe"]
    if mode == "crop":
        c = min(max(float(cfg["crop_center"]), 0.0), 1.0)
        zw, zh = int(W * zoom) // 2 * 2, int(H * zoom) // 2 * 2
        return (f"[0:v]scale={zw}:{zh}:force_original_aspect_ratio=increase,"
                f"crop={W}:{H}:(iw-{W})*{c}:(ih-{H})/2,setsar=1[v]")
    if mode == "fit":
        return (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v]")
    # blur: full-width sharp video centered over a blurred, darkened fill of itself
    fw = int(W * zoom) // 2 * 2
    return (f"[0:v]split=2[bgsrc][fgsrc];"
            f"[bgsrc]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
            f"gblur=sigma=40,eq=brightness=-0.12:saturation=1.2[bg];"
            f"[fgsrc]scale={fw}:-2,crop='min(iw,{W})':'min(ih,{H})'[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]")


def ass_time(t):
    t = max(0.0, t)
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def ass_text(text):
    return text.replace("{", "(").replace("}", ")").replace("\n", "\\N")


def build_ass(plan, cfg, total):
    W, H = cfg["width"], cfg["height"]
    font = cfg["font"]
    hook = plan.get("hook") or {}
    hook_size = int(hook.get("font_size", 92))
    cap_size = int(plan.get("caption_font_size", 78))
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        # Hook: white text on a solid box at the top of the safe zone
        f"Style: Hook,{font},{hook_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&HC0000000,"
        f"-1,0,0,0,100,100,0,0,3,18,0,8,{SAFE_SIDE},{SAFE_SIDE},{SAFE_TOP + 60},1",
        # Captions: bold white with thick black outline, lower-middle (above TikTok's caption area)
        f"Style: Cap,{font},{cap_size},&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,"
        f"-1,0,0,0,100,100,0,0,1,7,3,2,{SAFE_SIDE},{SAFE_SIDE},{SAFE_BOTTOM + 180},1",
        # Emphasis captions: yellow for the big moment
        f"Style: Pop,{font},{int(cap_size * 1.25)},&H0000E5FF,&H0000FFFF,&H00000000,&H80000000,"
        f"-1,0,0,0,100,100,0,0,1,8,3,5,{SAFE_SIDE},{SAFE_SIDE},0,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    if hook.get("text"):
        dur = float(hook.get("duration", min(2.5, total)))
        # quick pop-in: scale from 80% to 100% over 120ms
        fx = r"{\fscx80\fscy80\t(0,120,\fscx100\fscy100)}"
        lines.append(f"Dialogue: 1,{ass_time(0)},{ass_time(dur)},Hook,,0,0,0,,{fx}{ass_text(hook['text'])}")
    for cap in plan.get("captions", []):
        style = "Pop" if cap.get("emphasis") else "Cap"
        fx = r"{\fscx70\fscy70\t(0,100,\fscx100\fscy100)}" if cap.get("emphasis") else ""
        lines.append(
            f"Dialogue: 0,{ass_time(float(cap['start']))},{ass_time(float(cap['end']))},{style},,0,0,0,,"
            f"{fx}{ass_text(cap['text'])}"
        )
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("plan")
    ap.add_argument("--dry-run", action="store_true", help="print ffmpeg commands without running them")
    ap.add_argument("--keep-temp", action="store_true")
    args = ap.parse_args()

    with open(args.plan) as f:
        plan = json.load(f)
    cfg = {**DEFAULTS, **{k: plan[k] for k in DEFAULTS if k in plan}}
    plan_dir = os.path.dirname(os.path.abspath(args.plan))
    src = os.path.abspath(os.path.join(plan_dir, plan["input"]))
    out = os.path.abspath(os.path.join(plan_dir, plan.get("output", "tiktok_edit.mp4")))
    if not os.path.exists(src):
        sys.exit(f"error: input not found: {src}")
    if not plan.get("segments"):
        sys.exit("error: plan needs at least one segment")

    src_audio = has_audio(src)
    tmp = tempfile.mkdtemp(prefix="tt_edit_")
    W, H, fps = cfg["width"], cfg["height"], cfg["fps"]
    try:
        parts, total = [], 0.0
        for i, seg in enumerate(plan["segments"]):
            start, end = float(seg["start"]), float(seg["end"])
            speed = float(seg.get("speed", 1.0))
            zoom = max(1.0, float(seg.get("zoom", 1.0)))
            if end <= start or speed <= 0:
                sys.exit(f"error: segment {i} has invalid start/end/speed")
            dur = end - start
            total += dur / speed
            part = os.path.join(tmp, f"part{i:03d}.mp4")
            vf = reframe_filter(cfg, zoom)
            vf += f";[v]setpts=(PTS-STARTPTS)/{speed},fps={fps},format=yuv420p[vout]"
            cmd = ["ffmpeg", "-y", "-v", "error", "-ss", f"{start}", "-t", f"{dur}", "-i", src]
            if src_audio and not seg.get("mute"):
                af = f"[0:a]asetpts=PTS-STARTPTS,{atempo_chain(speed)},aresample=48000,aformat=channel_layouts=stereo[aout]"
            else:
                cmd += ["-f", "lavfi", "-t", f"{dur / speed}", "-i", "anullsrc=r=48000:cl=stereo"]
                af = "[1:a]anull[aout]"
            cmd += ["-filter_complex", f"{vf};{af}", "-map", "[vout]", "-map", "[aout]",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "14",
                    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest", part]
            run(cmd, args.dry_run)
            parts.append(part)

        listfile = os.path.join(tmp, "parts.txt")
        with open(listfile, "w") as f:
            f.writelines(f"file '{p}'\n" for p in parts)
        joined = os.path.join(tmp, "joined.mp4")
        run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listfile, "-c", "copy", joined],
            args.dry_run)

        with open(os.path.join(tmp, "overlay.ass"), "w") as f:
            f.write(build_ass(plan, cfg, total))

        music = plan.get("music")
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", joined]
        orig_vol = float(music.get("original_volume", 1.0)) if music else 1.0
        if music:
            mpath = os.path.abspath(os.path.join(plan_dir, music["path"]))
            cmd += ["-stream_loop", "-1", "-ss", f"{float(music.get('start', 0))}", "-i", mpath]
            mvol = float(music.get("volume", 0.3))
            af = (f"[0:a]volume={orig_vol}[a0];[1:a]volume={mvol},aresample=48000[a1];"
                  f"[a0][a1]amix=inputs=2:duration=first:normalize=0,")
        else:
            af = f"[0:a]volume={orig_vol},"
        fade_out = max(0.0, total - 0.3)
        af += f"loudnorm=I={cfg['loudness']}:TP=-1.0:LRA=11,afade=t=out:st={fade_out:.2f}:d=0.3[aout]"
        cmd += ["-filter_complex", f"[0:v]ass=overlay.ass[vout];{af}",
                "-map", "[vout]", "-map", "[aout]",
                "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", str(cfg["crf"]),
                "-maxrate", cfg["video_bitrate"], "-bufsize", "24M", "-pix_fmt", "yuv420p",
                "-r", str(fps), "-g", str(fps * 2),
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
                "-movflags", "+faststart", "-t", f"{total:.3f}", out]
        run(cmd, args.dry_run, cwd=tmp)

        cover_at = plan.get("cover_at")
        if cover_at is not None:
            cover = os.path.splitext(out)[0] + "_cover.jpg"
            run(["ffmpeg", "-y", "-v", "error", "-ss", f"{float(cover_at)}", "-i", out, "-frames:v", "1",
                 "-q:v", "2", cover], args.dry_run)

        print(json.dumps({"output": out, "duration_seconds": round(total, 2),
                          "resolution": f"{W}x{H}", "fps": fps}, indent=2))
    finally:
        if args.keep_temp:
            print(f"temp files kept in {tmp}", file=sys.stderr)
        else:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
