#!/usr/bin/env python3
"""Render a TikTok-ready vertical sports edit from a JSON edit plan.

Pipeline (ffmpeg only):
  1. cut each segment: speed (slow-mo / speed-up), reframe to 9:16 (blurred
     background or smart crop), color grade, freeze frame, and effects
     (flash, shake, zoom ramp, black & white, RGB split, vignette, boom, whoosh)
  2. join the segments
  3. burn in hook text + styled captions (inside TikTok's UI safe zone), brand
     watermark, optional music bed, loudness normalization, H.264/AAC export

See references/edit-plan-schema.md for every field. Minimal plan:
  {"input": "game.mp4", "output": "tiktok.mp4",
   "segments": [{"start": 41.0, "end": 47.5}],
   "hook": {"text": "HE DID NOT JUST DO THAT"}}

Usage:
  render_edit.py plan.json [--dry-run] [--keep-temp]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

PLUGIN_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BRAND_LOGO = os.path.join(PLUGIN_ROOT, "assets", "watermark.png")
BRAND_TEXT = "SUN CUSTOM DESIGNS"
FONTS_DIR = os.path.join(PLUGIN_ROOT, "assets", "fonts")   # bundled Anton (OFL) for "font": "Anton"

DEFAULTS = {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "reframe": "blur",       # blur | crop | fit
    "crop_center": 0.5,      # 0 = left edge, 1 = right edge (crop mode focus)
    "grade": "punchy",       # see GRADES
    "font": "DejaVu Sans",
    "loudness": -14,         # integrated LUFS target
    "crf": 18,
    "video_bitrate": "12M",  # cap; TikTok re-encodes, so feed it a clean high-quality master
}

GRADES = {
    "none": "",
    "punchy": "eq=contrast=1.1:saturation=1.3:gamma=0.98,unsharp=5:5:0.5",
    "teal_orange": "colorbalance=rs=-0.06:bs=0.08:rh=0.08:gh=0.02:bh=-0.08,eq=contrast=1.1:saturation=1.2",
    "cinematic": "curves=preset=medium_contrast,eq=saturation=0.9,vignette=angle=PI/5",
    "gritty": "eq=contrast=1.3:saturation=0.7:gamma=0.95,noise=alls=10:allf=t,vignette=angle=PI/4",
    "cold": "colorbalance=bs=0.1:bm=0.05:rh=-0.03,eq=contrast=1.15:saturation=0.85",
    "mono": "hue=s=0,eq=contrast=1.25",
}

# TikTok UI overlays (top tabs, right-side buttons, bottom caption) — keep text out of these at 1080x1920.
SAFE_TOP = 260
SAFE_BOTTOM = 480
SAFE_SIDE = 140

VIDEO_FX = {"flash", "shake", "zoom_ramp", "bw", "rgb_split", "vignette"}
AUDIO_FX = {"boom", "whoosh"}


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


def reframe_filter(cfg, seg, read_dur):
    """[0:v] -> [v]: trim to the segment, then fit it into the vertical frame."""
    W, H = cfg["width"], cfg["height"]
    mode = seg.get("reframe", cfg["reframe"])
    zoom = max(1.0, float(seg.get("zoom", 1.0)))
    head = f"[0:v]trim=duration={read_dur:.3f},setpts=PTS-STARTPTS,"
    if mode == "crop":
        c = min(max(float(seg.get("crop_center", cfg["crop_center"])), 0.0), 1.0)
        zw, zh = int(W * zoom) // 2 * 2, int(H * zoom) // 2 * 2
        return (f"{head}scale={zw}:{zh}:force_original_aspect_ratio=increase,"
                f"crop={W}:{H}:(iw-{W})*{c}:(ih-{H})/2,setsar=1[v]")
    if mode == "fit":
        return (f"{head}scale={W}:{H}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v]")
    # blur: full-width sharp video centered over a blurred, darkened fill of itself
    fw = int(W * zoom) // 2 * 2
    return (f"{head}split=2[bgsrc][fgsrc];"
            f"[bgsrc]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
            f"gblur=sigma=40,eq=brightness=-0.12:saturation=1.2[bg];"
            f"[fgsrc]scale={fw}:-2,crop='min(iw,{W})':'min(ih,{H})'[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]")


def norm_effects(seg, out_dur):
    fx = []
    for e in seg.get("effects", []):
        e = {"type": e} if isinstance(e, str) else dict(e)
        if e["type"] not in VIDEO_FX | AUDIO_FX:
            sys.exit(f"error: unknown effect '{e['type']}' (choose from {sorted(VIDEO_FX | AUDIO_FX)})")
        e["at"] = float(e.get("at", 0.0))
        e.setdefault("duration", None)
        e["strength"] = float(e.get("strength", 1.0))
        fx.append(e)
    return fx


def effect_filters(cfg, fx, out_dur):
    """Video effect filters, applied on the segment's output timeline (t=0 at segment start)."""
    W, H, fps = cfg["width"], cfg["height"], cfg["fps"]
    chain = []
    for e in fx:
        a, s, d = e["at"], e["strength"], e["duration"]
        if e["type"] == "zoom_ramp":
            d = d or max(0.3, out_dur - a)
            z1 = float(e.get("to", 1.0 + 0.35 * s))
            p = f"min(max((it-{a})/{d},0),1)"
            # ease-out cubic so the push feels like a camera operator, not a linear crawl
            chain.append(f"zoompan=z='1+({z1}-1)*(1-pow(1-{p},3))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                         f":d=1:s={W}x{H}:fps={fps}")
    for e in fx:
        a, s, d = e["at"], e["strength"], e["duration"]
        if e["type"] == "shake":
            decay = 6.0 / max(s, 0.2)
            amp = f"if(gte(t,{a}),exp(-(t-{a})*{decay}),0)"
            sw, sh = int(W * 1.08) // 2 * 2, int(H * 1.08) // 2 * 2
            chain.append(f"scale={sw}:{sh},crop={W}:{H}:"
                         f"x='(iw-ow)/2+(iw-ow)/2*sin(t*57)*{amp}':y='(ih-oh)/2+(ih-oh)/2*cos(t*43)*{amp}'")
        elif e["type"] == "flash":
            d = d or 0.18
            chain.append(f"eq=brightness='if(between(t,{a},{a + d}),{0.75 * s}*(1-(t-{a})/{d}),0)':eval=frame")
        elif e["type"] == "bw":
            d = d or 9999
            chain.append(f"hue=s=0:enable='between(t,{a},{a + d})'")
        elif e["type"] == "rgb_split":
            d = d or 0.25
            px = int(14 * s)
            chain.append(f"rgbashift=rh=-{px}:bh={px}:enable='between(t,{a},{a + d})'")
        elif e["type"] == "vignette":
            d = d or 9999
            chain.append(f"vignette=angle=PI/4:enable='between(t,{a},{a + d})'")
    return chain


def audio_fx_inputs(fx):
    """lavfi inputs + delays for synthetic hit sounds."""
    sounds = []
    for e in fx:
        if e["type"] == "boom":
            # sub-bass drop: pitch falls from ~130Hz to 40Hz with a fast decay (the "808 hit")
            expr = "0.9*sin(2*PI*(40+90*exp(-t*14))*t)*exp(-t*3)"
            sounds.append((["-f", "lavfi", "-i", f"aevalsrc='{expr}|{expr}':s=48000:d=1.5"],
                           f"volume={0.9 * e['strength']}", e["at"]))
        elif e["type"] == "whoosh":
            sounds.append((["-f", "lavfi", "-i", "anoisesrc=d=0.45:c=pink:a=0.6:r=48000"],
                           f"highpass=f=400,lowpass=f=5000,afade=t=in:d=0.25,afade=t=out:st=0.25:d=0.2,"
                           f"aformat=channel_layouts=stereo,volume={0.7 * e['strength']}",
                           max(0.0, e["at"] - 0.25)))
    return sounds


def ass_time(t):
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def ass_text(text):
    return text.replace("{", "(").replace("}", ")").replace("\n", "\\N")


def build_ass(plan, cfg, total):
    W, H = cfg["width"], cfg["height"]
    font = cfg["font"]
    hook = plan.get("hook") or {}
    hook_size = int(hook.get("font_size", 92))
    cap = int(plan.get("caption_font_size", 78))
    fmt = ("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
           "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
           "Alignment, MarginL, MarginR, MarginV, Encoding")
    # colours are &HAABBGGRR
    styles = {
        "hook_box": f"{font},{hook_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&HC0000000,-1,0,0,0,100,100,0,0,3,18,0,8,{SAFE_SIDE},{SAFE_SIDE},{SAFE_TOP + 60},1",
        "hook_outline": f"{font},{hook_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,8,4,8,{SAFE_SIDE},{SAFE_SIDE},{SAFE_TOP + 60},1",
        "hook_stamp": f"{font},{hook_size},&H00000000,&H00000000,&H0000E5FF,&H0000E5FF,-1,0,0,0,100,100,0,0,3,20,0,8,{SAFE_SIDE},{SAFE_SIDE},{SAFE_TOP + 60},1",
        "cap": f"{font},{cap},&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,3,2,{SAFE_SIDE},{SAFE_SIDE},{SAFE_BOTTOM + 180},1",
        "pop": f"{font},{int(cap * 1.25)},&H0000E5FF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,8,3,5,{SAFE_SIDE},{SAFE_SIDE},0,1",
        "impact": f"{font},{int(cap * 1.7)},&H002A2AFF,&H002A2AFF,&H00FFFFFF,&H80000000,-1,0,0,0,100,100,0,0,1,9,0,5,{SAFE_SIDE},{SAFE_SIDE},0,1",
        "stamp": f"{font},{int(cap * 1.05)},&H00000000,&H00000000,&H0000E5FF,&H0000E5FF,-1,0,0,0,100,100,0,0,3,16,0,5,{SAFE_SIDE},{SAFE_SIDE},0,1",
        "top": f"{font},{int(cap * 0.7)},&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,-1,0,0,0,100,100,2,0,3,10,0,8,{SAFE_SIDE},{SAFE_SIDE},{SAFE_TOP + 40},1",
    }
    # per-style entrance animation
    anim = {
        "cap": "",
        "pop": r"{\fscx70\fscy70\t(0,100,\fscx100\fscy100)}",
        "impact": r"{\frz-6\fscx170\fscy170\t(0,90,\fscx100\fscy100)}",
        "stamp": r"{\frz4\fscx130\fscy130\t(0,80,\fscx100\fscy100)}",
        "top": "",
    }
    pos = {"pop": H * 0.40, "impact": H * 0.40, "stamp": H * 0.33}
    lines = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0", "",
             "[V4+ Styles]", fmt]
    lines += [f"Style: {name},{spec}" for name, spec in styles.items()]
    lines += ["", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]

    if hook.get("text"):
        dur = float(hook.get("duration", min(2.5, total)))
        style = "hook_" + hook.get("style", "box")
        if style not in styles:
            sys.exit(f"error: unknown hook style '{hook.get('style')}' (box, outline, stamp)")
        fx = r"{\fscx80\fscy80\t(0,120,\fscx100\fscy100)}"
        lines.append(f"Dialogue: 2,{ass_time(0)},{ass_time(dur)},{style},,0,0,0,,{fx}{ass_text(hook['text'])}")

    for c in plan.get("captions", []):
        style = c.get("style") or ("pop" if c.get("emphasis") else "cap")
        if style not in anim:
            sys.exit(f"error: unknown caption style '{style}' (cap, pop, impact, stamp, top)")
        start, end = float(c["start"]), float(c["end"])
        place = rf"{{\pos({W // 2},{int(pos[style])})}}" if style in pos else ""
        if c.get("words"):
            # kinetic: each word slams in on its own beat
            words = c["text"].split()
            step = (end - start) / max(len(words), 1)
            for i, w in enumerate(words):
                ws = start + i * step
                lines.append(f"Dialogue: 1,{ass_time(ws)},{ass_time(ws + step)},{style},,0,0,0,,"
                             f"{place}{anim[style] or anim['pop']}{ass_text(w)}")
        else:
            lines.append(f"Dialogue: 1,{ass_time(start)},{ass_time(end)},{style},,0,0,0,,"
                         f"{place}{anim[style]}{ass_text(c['text'])}")

    wm = watermark_config(plan)
    if wm and wm.get("text") and not wm.get("image"):
        # text watermark: small, semi-transparent, with a thin outline
        alpha = format(int(255 * (1 - wm["opacity"])), "02X")
        x, y, an = wm_position(wm["position"], W, H, text=True)
        lines.append(
            f"Dialogue: 0,{ass_time(0)},{ass_time(total + 1)},cap,,0,0,0,,"
            rf"{{\an{an}\pos({x},{y})\fs{wm['size']}\bord2\shad0\1a&H{alpha}&\3a&H{alpha}&\4a&HFF&\fsp4}}"
            f"{ass_text(wm['text'])}"
        )
    return "\n".join(lines) + "\n"


def watermark_config(plan):
    """Brand watermark: bundled Sun Custom Designs logo if present, else its name as text.
    "watermark": false disables it; a dict overrides any field."""
    wm = plan.get("watermark", {})
    if wm is False:
        return None
    if isinstance(wm, str):
        wm = {"image": wm}
    cfg = {"position": "top_left", "opacity": 0.9, "width": 280, "size": 34}
    cfg.update(wm)
    if not cfg.get("image") and not cfg.get("text"):
        if os.path.exists(BRAND_LOGO):
            cfg["image"] = BRAND_LOGO
        else:
            cfg["text"] = BRAND_TEXT
    return cfg


def wm_position(position, W, H, text=False):
    """Corners chosen to clear TikTok's UI: top bar, right-side buttons, bottom caption."""
    m = 60
    spots = {
        "top_left": (m, 150, 7),
        "top_right": (W - m, 150, 9),
        "bottom_left": (m, H - SAFE_BOTTOM - 20, 1),
        "center_left": (m, int(H * 0.5), 4),
    }
    if position not in spots:
        sys.exit(f"error: unknown watermark position '{position}' ({', '.join(spots)})")
    return spots[position]


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
    default_input = plan.get("input")
    out = os.path.abspath(os.path.join(plan_dir, plan.get("output", "tiktok_edit.mp4")))
    if not plan.get("segments"):
        sys.exit("error: plan needs at least one segment")

    # each segment may pull from its own clip (multi-angle edits); "input" is the default
    sources = {}
    for i, seg in enumerate(plan["segments"]):
        name = seg.get("input", default_input)
        if not name:
            sys.exit(f"error: segment {i} has no input (set top-level \"input\" or segment \"input\")")
        path = os.path.abspath(os.path.join(plan_dir, name))
        if not os.path.exists(path):
            sys.exit(f"error: input not found: {path}")
        if path not in sources:
            sources[path] = has_audio(path)
    tmp = tempfile.mkdtemp(prefix="tt_edit_")
    W, H, fps = cfg["width"], cfg["height"], cfg["fps"]
    try:
        parts, total = [], 0.0
        for i, seg in enumerate(plan["segments"]):
            start, end = float(seg["start"]), float(seg["end"])
            speed = float(seg.get("speed", 1.0))
            freeze = max(0.0, float(seg.get("freeze", 0.0)))
            if end <= start or speed <= 0:
                sys.exit(f"error: segment {i} has invalid start/end/speed")
            dur = end - start
            out_dur = dur / speed + freeze
            total += out_dur
            grade = seg.get("grade", cfg["grade"])
            if grade not in GRADES:
                sys.exit(f"error: unknown grade '{grade}' (choose from {sorted(GRADES)})")
            fx = norm_effects(seg, out_dur)

            src = os.path.abspath(os.path.join(plan_dir, seg.get("input", default_input)))
            src_audio = sources[src]
            # read extra source so crowd audio keeps rolling under a freeze frame
            read_dur = dur + freeze * speed
            cmd = ["ffmpeg", "-y", "-v", "error", "-ss", f"{start}", "-t", f"{read_dur}", "-i", src]
            vchain = [f"setpts=(PTS-STARTPTS)/{speed}", f"fps={fps}"]
            if GRADES[grade]:
                vchain.append(GRADES[grade])
            if freeze:
                vchain.append(f"tpad=stop_mode=clone:stop_duration={freeze}")
            vchain += effect_filters(cfg, fx, out_dur)
            vchain.append(f"trim=duration={out_dur:.3f},format=yuv420p")
            vf = reframe_filter(cfg, seg, dur).replace("[v]", "[v0]") + ";[v0]" + ",".join(vchain) + "[vout]"

            n_in = 1
            if src_audio and not seg.get("mute"):
                base = f"[0:a]asetpts=PTS-STARTPTS,{atempo_chain(speed)},aresample=48000,aformat=channel_layouts=stereo"
            else:
                cmd += ["-f", "lavfi", "-t", f"{out_dur}", "-i", "anullsrc=r=48000:cl=stereo"]
                base = f"[{n_in}:a]anull"
                n_in += 1
            af = f"{base},apad,atrim=0:{out_dur:.3f}[a0]"
            mix = ["[a0]"]
            for j, (inp, filt, at) in enumerate(audio_fx_inputs(fx)):
                cmd += inp
                ms = int(at * 1000)
                af += f";[{n_in}:a]{filt},adelay={ms}|{ms}[s{j}]"
                mix.append(f"[s{j}]")
                n_in += 1
            if len(mix) > 1:
                af += f";{''.join(mix)}amix=inputs={len(mix)}:duration=first:normalize=0[aout]"
            else:
                af = af.replace("[a0]", "[aout]")

            part = os.path.join(tmp, f"part{i:03d}.mp4")
            cmd += ["-filter_complex", f"{vf};{af}", "-map", "[vout]", "-map", "[aout]",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "14",
                    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", part]
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

        cmd = ["ffmpeg", "-y", "-v", "error", "-i", joined]
        n_in = 1
        music = plan.get("music")
        orig_vol = float(music.get("original_volume", 1.0)) if music else 1.0
        if music:
            mpath = os.path.abspath(os.path.join(plan_dir, music["path"]))
            cmd += ["-stream_loop", "-1", "-ss", f"{float(music.get('start', 0))}", "-i", mpath]
            mvol = float(music.get("volume", 0.3))
            af = (f"[0:a]volume={orig_vol}[a0];[{n_in}:a]volume={mvol},aresample=48000[a1];"
                  f"[a0][a1]amix=inputs=2:duration=first:normalize=0,")
            n_in += 1
        else:
            af = f"[0:a]volume={orig_vol},"
        fade_out = max(0.0, total - 0.3)
        af += f"loudnorm=I={cfg['loudness']}:TP=-1.0:LRA=11,afade=t=out:st={fade_out:.2f}:d=0.3[aout]"

        vf = f"[0:v]ass=overlay.ass:fontsdir={FONTS_DIR}[vt]"
        wm = watermark_config(plan)
        if wm and wm.get("image"):
            logo = os.path.abspath(os.path.join(plan_dir, wm["image"]))
            if not os.path.exists(logo):
                sys.exit(f"error: watermark image not found: {logo}")
            cmd += ["-loop", "1", "-i", logo]
            x, y, an = wm_position(wm["position"], W, H)
            ox = f"{x}" if an in (7, 1, 4) else f"{x}-w"
            oy = {7: f"{y}", 9: f"{y}", 1: f"{y}-h", 4: f"{y}-h/2"}[an]
            vf += (f";[{n_in}:v]scale={int(wm['width'])}:-1,format=rgba,"
                   f"colorchannelmixer=aa={float(wm['opacity'])}[wm];"
                   f"[vt][wm]overlay={ox}:{oy}:shortest=1[vout]")
        else:
            vf = vf.replace("[vt]", "[vout]")

        cmd += ["-filter_complex", f"{vf};{af}",
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

        target = plan.get("target_duration")
        if target and total < float(target):
            print(f"warning: rendered {total:.1f}s, under the {float(target):.0f}s target", file=sys.stderr)
        print(json.dumps({"output": out, "duration_seconds": round(total, 2), "resolution": f"{W}x{H}",
                          "fps": fps, "watermark": (wm.get("image") or wm.get("text")) if wm else None,
                          # TikTok Creator Rewards only pays on videos longer than one minute
                          "creator_rewards_length_ok": total > 60.0},
                         indent=2))
    finally:
        if args.keep_temp:
            print(f"temp files kept in {tmp}", file=sys.stderr)
        else:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
