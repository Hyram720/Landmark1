#!/usr/bin/env python3
"""CeeDee Lamb: the 2025 season in 64 seconds, an original motion-graphics highlight video.

No NFL footage: every frame is generated from stats (facts aren't copyrightable), and the beat
is synthesized here, so the video is original for TikTok Creator Rewards. No team logos.

Stats: 2025 game log via FFToday (totals match: 75 rec, 117 tgt, 1,077 yds, 3 TD in 13 games):
  https://www.fftoday.com/stats/players/17141/CeeDee_Lamb?LeagueID=1
2023 season (135 rec, 1,749 yds, 12 TD; led NFL in receptions): same source + RotoWire.

Usage: python3 build.py [--out ceedee_2025_in_64s.mp4]
"""
import argparse
import array
import math
import os
import random
import subprocess
import tempfile
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.abspath(os.path.join(HERE, "..", "..", "..", "plugins", "tiktok-sports-editor"))
FONTS = os.path.join(PLUGIN, "assets", "fonts")
LOGO = os.path.join(PLUGIN, "assets", "watermark.png")

W, H, FPS = 1080, 1920, 30
BPM = 100
BEAT = 60 / BPM            # 0.6s; every scene change lands on a beat
TOTAL = 107 * BEAT         # 64.2s

# 2025 regular season game log (week, opponent, home?, result, rec, yds)
GAMES = [
    (1, "PHI", False, "L 20-24", 7, 110), (2, "NYG", True, "W 40-37", 9, 112),
    (7, "WAS", True, "W 44-22", 5, 110), (8, "DEN", False, "L 24-44", 7, 74),
    (9, "ARI", True, "L 17-27", 7, 85), (11, "LV", False, "W 33-16", 5, 66),
    (12, "PHI", True, "W 24-21", 4, 75), (13, "KC", True, "W 31-28", 7, 112),
    (14, "DET", False, "L 30-44", 6, 121), (15, "MIN", True, "L 26-34", 6, 111),
    (16, "LAC", True, "L 17-34", 6, 51), (17, "WAS", False, "W 30-23", 5, 46),
    (18, "NYG", False, "L 17-34", 1, 4),
]
TEAM = {"PHI": "PHILADELPHIA", "NYG": "NEW YORK", "WAS": "WASHINGTON", "DEN": "DENVER",
        "ARI": "ARIZONA", "LV": "LAS VEGAS", "KC": "KANSAS CITY", "DET": "DETROIT",
        "MIN": "MINNESOTA", "LAC": "LOS ANGELES", }
assert sum(g[5] for g in GAMES) == 1077 and sum(g[4] for g in GAMES) == 75

# colours (&HBBGGRR)
GOLD, ORANGE, WHITE, SILVER, NAVY = "&H001AC2FF", "&H00007AFF", "&H00FFFFFF", "&H00DAD1C9", "&H003A1F0B"


def t(s):
    s = max(0.0, s)
    return f"{int(s // 3600)}:{int(s % 3600 // 60):02d}:{s % 60:05.2f}"


EVENTS = []


def ev(start, end, text, style="Big", layer=1):
    EVENTS.append(f"Dialogue: {layer},{t(start)},{t(end)},{style},,0,0,0,,{text}")


def slam(x, y, extra=""):
    return (rf"{{\an5\pos({x},{y})\fscx165\fscy165\alpha&HFF&"
            rf"\t(0,110,\fscx100\fscy100\alpha&H00&){extra}}}")


def rise(x, y, extra=""):
    return rf"{{\an5\move({x},{y + 70},{x},{y},0,220)\fad(150,0){extra}}}"


def count_up(start, dur, end_time, target, x, y, style="Huge", fmt="{:,}", decimals=0):
    frames = max(2, int(dur * FPS))
    for k in range(frames + 1):
        p = k / frames
        v = target * (1 - (1 - p) ** 3)
        s0 = start + k / FPS
        s1 = end_time if k == frames else start + (k + 1) / FPS
        txt = fmt.format(round(v, decimals) if decimals else int(round(v)))
        ev(s0, s1, rf"{{\an5\pos({x},{y})}}{txt}", style)


def build_ass():
    b = lambda n: n * BEAT
    # S1 hook (0 - 6 beats)
    ev(0, b(6), r"{\an8\pos(540,330)\fscx80\fscy80\t(0,120,\fscx100\fscy100)}" + "CEEDEE LAMB'S 'DOWN' YEAR", "Hook", 2)
    count_up(0.15, 1.6, b(6), 1077, 540, 860)
    ev(0.15, b(6), rise(540, 1060) + "YARDS", "Label")
    ev(b(3.5), b(6), slam(540, 1200) + "IN ONLY 13 GAMES", "Stamp")

    # S2 stat slams (6 - 16 beats)
    stats = [("75", "CATCHES"), ("117", "TARGETS"), ("6", "GAMES WITH 100+ YARDS")]
    for i, (num, lab) in enumerate(stats):
        s = b(6.5 + i * 2.5)
        y = 560 + i * 330
        ev(s, b(16), slam(540, y) + num, "Big")
        ev(s + 0.1, b(16), rise(540, y + 150) + lab, "Label")
    ev(b(14), b(16), slam(540, 1560, r"\frz-4") + "RANKED:", "Stamp")

    # S3 the six 100-yard games, countdown (16 - 52 beats, 6 beats each)
    hundred = sorted([g for g in GAMES if g[5] >= 100], key=lambda g: (g[5], -g[0]))
    for i, (wk, opp, home, res, rec, yds) in enumerate(hundred):
        rank = 6 - i
        s, e = b(16 + i * 6), b(22 + i * 6)
        ev(s, e, r"{\an8\pos(540,300)}THE 100-YARD GAMES", "Small", 2)
        ev(s, e, slam(540, 520) + f"#{rank}", "Rank")
        count_up(s + 0.15, 0.6, e, yds, 540, 860)
        ev(s + 0.15, e, rise(540, 1050) + "YARDS", "Label")
        where = ("VS " if home else "AT ") + TEAM[opp]
        ev(s + 0.3, e, rise(540, 1190) + f"WEEK {wk} · {where}", "Small")
        ev(s + 0.45, e, rise(540, 1290) + f"{rec} CATCHES · {res}", "Small")
        # bar fills to yards/121 of 760px
        w = int(760 * yds / 121)
        ev(s + 0.2, e, rf"{{\an7\pos(160,1420)\p1\c{SILVER}\alpha&HB0&}}m 0 0 l 760 0 760 26 0 26{{\p0}}", "Bar", 0)
        ev(s + 0.2, e, rf"{{\an7\pos(160,1420)\p1\c{GOLD}\clip(160,1400,160,1460)"
                       rf"\t(0,600,\clip(160,1400,{160 + w},1460))}}m 0 0 l 760 0 760 26 0 26{{\p0}}", "Bar", 1)
        if rank == 1:
            ev(s + 0.15, e, slam(540, 1580, r"\frz-5") + "SEASON HIGH", "Stamp")

    # S4 season chart (52 - 72 beats): one bar per game, on the beat, with a running total
    s0 = b(52)
    ev(s0, b(72), r"{\an8\pos(540,300)}EVERY GAME OF 2025", "Small", 2)
    base, left, bw, gap, hmax = 1380, 105, 52, 15, 620
    running = 0
    crossed = False
    for i, (wk, opp, home, res, rec, yds) in enumerate(GAMES):
        s = s0 + b(1) + i * BEAT
        x = left + i * (bw + gap)
        hgt = max(8, int(hmax * yds / 121))
        col = GOLD if yds >= 100 else SILVER
        ev(s, b(72), rf"{{\an7\pos({x},{base - hgt})\p1\c{col}\clip({x},{base},{x + bw},{base})"
                     rf"\t(0,300,\clip({x},{base - hgt},{x + bw},{base}))}}m 0 0 l {bw} 0 {bw} {hgt} 0 {hgt}{{\p0}}",
           "Bar", 1)
        ev(s, b(72), rf"{{\an8\pos({x + bw // 2},{base + 18})}}{wk}", "Tiny")
        ev(s + 0.25, b(72), rf"{{\an2\pos({x + bw // 2},{base - hgt - 8})\fad(120,0)}}{yds}", "Tiny")
        running += yds
        nxt = s + BEAT if i < len(GAMES) - 1 else b(72)
        ev(s, nxt, rf"{{\an5\pos(540,520)}}{running:,}", "Big")
        if running >= 1000 and not crossed:
            crossed = True
            ev(s, s + b(4), slam(540, 1530, r"\frz-4") + f"1,000 YARDS · WEEK {wk}", "Stamp", 3)
    ev(s0, b(72), r"{\an5\pos(540,640)}TOTAL YARDS", "Label")
    ev(b(68), b(72), rise(540, 1560) + "GOLD = 100+ YARD GAME", "Small")

    # S5 pace (72 - 84 beats)
    count_up(b(72) + 0.1, 1.0, b(84), 82.8, 540, 700, fmt="{}", decimals=1)
    ev(b(72) + 0.1, b(84), rise(540, 900) + "YARDS PER GAME", "Label")
    ev(b(77), b(84), slam(540, 1150) + "= 1,408-YARD PACE", "Big2")
    ev(b(78), b(84), rise(540, 1320) + "OVER A FULL 17 GAMES", "Small")

    # S6 2023 flashback (84 - 96 beats)
    ev(b(84), b(96), slam(540, 420) + "REMEMBER 2023?", "Stamp")
    for i, (num, lab) in enumerate([("135", "CATCHES"), ("1,749", "YARDS"), ("12", "TOUCHDOWNS")]):
        s = b(86 + i * 2)
        y = 700 + i * 290
        ev(s, b(96), slam(540, y) + num, "Big")
        ev(s + 0.1, b(96), rise(540, y + 140) + lab, "Label")
    ev(b(93), b(96), slam(540, 1640, r"\frz-4") + "LED THE NFL IN CATCHES", "Stamp")

    # S7 the question (96 - 107 beats)
    ev(b(96), TOTAL, slam(540, 560) + "2026", "Huge")
    ev(b(97), TOTAL, rise(540, 800) + "OVER OR UNDER", "Label")
    ev(b(98), TOTAL, slam(540, 1000) + "1,500 YARDS?", "Big2")
    ev(b(100), TOTAL, slam(540, 1250, r"\frz-4") + "COMMENT YOUR PICK", "Stamp")

    font = "Anton"
    styles = [
        f"Style: Hook,{font},84,{NAVY},{NAVY},{GOLD},{GOLD},0,0,0,0,100,100,1,0,3,18,0,8,140,140,0,1",
        f"Style: Huge,{font},330,{WHITE},{WHITE},&H00000000,&H90000000,0,0,0,0,100,100,0,0,1,0,8,5,0,0,0,1",
        f"Style: Big,{font},230,{WHITE},{WHITE},&H00000000,&H90000000,0,0,0,0,100,100,0,0,1,0,7,5,0,0,0,1",
        f"Style: Big2,{font},150,{GOLD},{GOLD},&H00000000,&H90000000,0,0,0,0,100,100,0,0,1,0,6,5,0,0,0,1",
        f"Style: Rank,{font},200,{GOLD},{GOLD},&H00000000,&H90000000,0,0,0,0,100,100,0,0,1,0,6,5,0,0,0,1",
        f"Style: Label,{font},84,{GOLD},{GOLD},&H00000000,&H90000000,0,0,0,0,100,100,8,0,1,0,4,5,0,0,0,1",
        f"Style: Small,{font},58,{SILVER},{SILVER},&H00000000,&H90000000,0,0,0,0,100,100,4,0,1,0,3,5,0,0,0,1",
        f"Style: Tiny,{font},36,{SILVER},{SILVER},&H00000000,&H90000000,0,0,0,0,100,100,0,0,1,0,2,5,0,0,0,1",
        f"Style: Stamp,{font},78,{NAVY},{NAVY},{GOLD},{GOLD},0,0,0,0,100,100,2,0,3,16,0,5,0,0,0,1",
        f"Style: Bar,{font},20,{GOLD},{GOLD},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    ]
    head = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0",
            "ScaledBorderAndShadow: yes", "", "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
            "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding"]
    return "\n".join(head + styles + ["", "[Events]",
                                      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
                     + EVENTS) + "\n"


def build_beat(path):
    """Original 100 BPM trap-style beat: kick, clap, hats, 808 bass, plus sub booms on scene changes."""
    sr = 48000
    n = int(TOTAL * sr)
    buf = [0.0] * n
    rnd = random.Random(7)

    def add(start, samples):
        i0 = int(start * sr)
        for j, v in enumerate(samples):
            if i0 + j < n:
                buf[i0 + j] += v

    kick = [0.9 * math.sin(2 * math.pi * (45 + 110 * math.exp(-k / sr * 30)) * k / sr) * math.exp(-k / sr * 9)
            for k in range(int(0.35 * sr))]
    clap = [0.35 * (rnd.random() * 2 - 1) * math.exp(-k / sr * 28) for k in range(int(0.18 * sr))]
    hat_raw = [rnd.random() * 2 - 1 for _ in range(int(0.05 * sr) + 1)]
    hat = [0.12 * (hat_raw[k + 1] - hat_raw[k]) * math.exp(-k / sr * 90) for k in range(int(0.05 * sr))]
    boom = [0.8 * math.sin(2 * math.pi * (38 + 80 * math.exp(-k / sr * 12)) * k / sr) * math.exp(-k / sr * 2.6)
            for k in range(int(1.4 * sr))]
    roots = [55.0, 43.65, 65.41, 49.0]  # A1 F1 C2 G1, one per bar
    beats = int(TOTAL / BEAT)
    for bt in range(beats):
        s = bt * BEAT
        if bt % 4 in (0, 2) or (bt % 8 == 7):
            add(s, kick)
        if bt % 4 in (1, 3):
            add(s, clap)
        for h in range(2 if bt % 4 != 3 else 4):          # 8ths, with a 16th roll at the end of each bar
            add(s + h * BEAT / (2 if bt % 4 != 3 else 4), hat)
        if bt % 4 == 0:
            f = roots[(bt // 4) % 4]
            L = int(4 * BEAT * sr)
            add(s, [0.45 * math.tanh(1.8 * math.sin(2 * math.pi * f * k / sr)) *
                    min(1.0, k / 400) * math.exp(-k / sr * 0.6) for k in range(L)])
    for scene in [6, 16, 52, 72, 84, 96]:
        add(scene * BEAT, boom)
    peak = max(abs(v) for v in buf) or 1.0
    pcm = array.array("h", (int(32000 * v / peak) for v in buf))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "ceedee_2025_in_64s.mp4"))
    args = ap.parse_args()
    tmp = tempfile.mkdtemp(prefix="ceedee_")
    with open(os.path.join(tmp, "video.ass"), "w") as f:
        f.write(build_ass())
    build_beat(os.path.join(tmp, "beat.wav"))
    vf = (f"[0:v]noise=alls=5:allf=t,vignette=angle=PI/4,format=yuv420p,"
          f"ass=video.ass:fontsdir={FONTS}[v1];"
          f"[2:v]scale=280:-1,format=rgba,colorchannelmixer=aa=0.9[wm];[v1][wm]overlay=60:150:shortest=1[v]")
    cmd = ["ffmpeg", "-y", "-v", "error",
           "-f", "lavfi", "-i", f"gradients=s={W}x{H}:c0=0x0B1F3A:c1=0x1B4C8C:c2=0x050B16:nb_colors=3:"
                                f"speed=0.012:rate={FPS}:duration={TOTAL}",
           "-i", "beat.wav", "-loop", "1", "-i", LOGO,
           "-filter_complex", vf + ";[1:a]loudnorm=I=-14:TP=-1.0:LRA=11,volume=1.8dB,alimiter=limit=0.89,aformat=channel_layouts=stereo[a]",
           "-map", "[v]", "-map", "[a]", "-t", f"{TOTAL:.2f}",
           "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "18", "-maxrate", "9M", "-bufsize", "18M", "-pix_fmt", "yuv420p",
           "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
           os.path.abspath(args.out)]
    subprocess.run(cmd, check=True, cwd=tmp)
    cover = os.path.splitext(os.path.abspath(args.out))[0] + "_cover.jpg"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{51 * BEAT:.2f}", "-i", os.path.abspath(args.out),
                    "-frames:v", "1", "-q:v", "2", cover], check=True)
    print(f"wrote {args.out} ({TOTAL:.1f}s) and {cover}")


if __name__ == "__main__":
    main()
