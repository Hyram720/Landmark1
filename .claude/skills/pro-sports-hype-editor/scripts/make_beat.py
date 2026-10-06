#!/usr/bin/env python3
"""Synthesize an ORIGINAL trap/hype instrumental and SFX (stdlib only, no samples).

  make_beat.py --bpm 140 --bars 16 --drop-bar 5 --out beat.wav
      writes beat.wav (+ beat.json with beat/bar/drop timestamps)
  make_beat.py --sfx --outdir sfx/
      writes whoosh.wav, impact.wav, riser.wav, hit.wav, rewind.wav

Structure: bars [0, drop-1) = intro (pluck chords, sparse hats, kick on 1),
bar drop-1 = build (snare roll + riser, kick drops out), bars >= drop = full
drop (trap kick, clap, rolling hats, 808), final bar ends on one big hit.
"""
import argparse
import json
import math
import os
import random
import struct
import wave

SR = 44100
rnd = random.Random(7)


def env_exp(n, tau):
    return [math.exp(-i / (tau * SR)) for i in range(n)]


def kick(len_s=0.45):
    n = int(SR * len_s); out = []; ph = 0.0
    for i in range(n):
        t = i / SR
        f = 45 + 115 * math.exp(-t * 28)
        ph += 2 * math.pi * f / SR
        a = math.exp(-t * 7.5)
        click = math.exp(-t * 400) * 0.6
        out.append(math.tanh(2.2 * math.sin(ph) * a) * 0.95 + click * (rnd.random() * 2 - 1) * 0.2)
    return out


def clap(len_s=0.32):
    n = int(SR * len_s); out = []; lp = 0.0
    for i in range(n):
        t = i / SR
        bursts = sum(math.exp(-max(0, t - d) * 90) * (t >= d) for d in (0, 0.011, 0.022))
        tail = math.exp(-t * 16) * 0.55
        x = rnd.random() * 2 - 1
        hp = x - lp; lp = lp + 0.25 * (x - lp)
        out.append(hp * (bursts * 0.5 + tail) + 0.25 * math.sin(2 * math.pi * 190 * t) * math.exp(-t * 30))
    return out


def hat(len_s=0.05, bright=1.0):
    n = int(SR * len_s); out = []; prev = 0.0
    for i in range(n):
        x = rnd.random() * 2 - 1
        hp = x - prev; prev = x
        out.append(hp * math.exp(-i / SR * (90 / bright)) * 0.35)
    return out


def sub808(freq, len_s):
    n = int(SR * len_s); out = []; ph = 0.0
    for i in range(n):
        t = i / SR
        f = freq * (1 + 0.6 * math.exp(-t * 40))          # small pitch drop = 808 punch
        ph += 2 * math.pi * f / SR
        a = min(1, t * 400) * math.exp(-t * 1.6) * min(1, (len_s - t) * 30)
        out.append(math.tanh(1.8 * math.sin(ph)) * a * 0.7)
    return out


def pluck(freqs, len_s=0.5):
    n = int(SR * len_s); out = [0.0] * n
    for f in freqs:
        for h, g in ((1, 1.0), (2, 0.45), (3, 0.25), (4, 0.12), (5, 0.07)):
            w = 2 * math.pi * f * h / SR
            dec = 5 + 3 * h
            for i in range(n):
                out[i] += g * math.sin(w * i) * math.exp(-i / SR * dec)
    m = max(abs(v) for v in out) or 1
    return [v / m * 0.28 for v in out]


def noise_riser(len_s):
    n = int(SR * len_s); out = []; lp = 0.0; ph = 0.0
    for i in range(n):
        p = i / n
        x = rnd.random() * 2 - 1
        k = 0.02 + 0.6 * p * p                               # opening low-pass
        lp += k * (x - lp)
        ph += 2 * math.pi * (200 + 1800 * p * p) / SR
        out.append((lp * 0.8 + 0.15 * math.sin(ph)) * (p ** 1.6) * 0.6)
    return out


def impact(len_s=1.8):
    n = int(SR * len_s); out = []; ph = 0.0; lp = 0.0
    for i in range(n):
        t = i / SR
        ph += 2 * math.pi * (38 + 60 * math.exp(-t * 6)) / SR
        x = rnd.random() * 2 - 1; lp += 0.08 * (x - lp)
        out.append(math.tanh(2.5 * math.sin(ph)) * math.exp(-t * 2.2) * 0.9 + lp * math.exp(-t * 5) * 0.8)
    return out


def whoosh(len_s=0.45):
    n = int(SR * len_s); out = []; lp = 0.0
    for i in range(n):
        p = i / n
        a = math.sin(math.pi * p) ** 2
        x = rnd.random() * 2 - 1
        lp += (0.03 + 0.5 * a) * (x - lp)
        out.append(lp * a * 0.9)
    return out


def rewind(len_s=0.6):
    n = int(SR * len_s); out = []; ph = 0.0
    for i in range(n):
        p = i / n
        ph += 2 * math.pi * (1200 * (1 - p) + 80) / SR
        out.append(math.sin(ph + 3 * math.sin(ph * 0.13)) * (1 - p) * 0.4)
    return out


def write_wav(path, left, right=None):
    right = right or left
    peak = max(max(abs(v) for v in left), max(abs(v) for v in right), 1e-9)
    g = 0.89 / peak if peak > 0.89 else 1.0
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        fr = bytearray()
        for l, r in zip(left, right):
            fr += struct.pack("<hh", int(max(-1, min(1, l * g)) * 32767), int(max(-1, min(1, r * g)) * 32767))
        w.writeframes(bytes(fr))


def build_beat(bpm, bars, drop_bar, key_hz):
    beat = 60.0 / bpm; bar = 4 * beat; s16 = beat / 4
    total = bars * bar + 1.5
    N = int(total * SR)
    L = [0.0] * N; R = [0.0] * N

    def add(sample, t, g=1.0, pan=0.0):
        i0 = int(t * SR)
        gl = g * math.cos((pan + 1) * math.pi / 4) * 1.414
        gr = g * math.sin((pan + 1) * math.pi / 4) * 1.414
        for j, v in enumerate(sample):
            k = i0 + j
            if k >= N: break
            L[k] += v * gl; R[k] += v * gr

    K, C, H, HO = kick(), clap(), hat(), hat(0.18, 2.5)
    # i - VI - iv - V in the chosen minor key (dark, triumphant)
    r = key_hz
    prog = [(1.0, [1.0, 1.189, 1.498]), (0.794, [0.794, 1.0, 1.189]),
            (0.667, [0.667, 0.794, 1.0]), (0.749, [0.749, 0.944, 1.122])]
    plucks = [pluck([r * 4 * x for x in ch]) for _, ch in prog]
    kick_pat = [0, 6, 10]                       # 16th positions (trap bounce)
    for b in range(bars):
        t0 = b * bar
        root, _ = prog[b % 4]
        intro, build, last = b < drop_bar - 1, b == drop_bar - 1, b == bars - 1
        if last:
            add(K, t0, 1.0); add(impact(), t0, 0.8)
            add(plucks[0], t0, 0.9)
            continue
        # chords: on 1 and the "and" of 2 in every bar
        for pos in (0, 6, 10):
            add(plucks[b % 4], t0 + pos * s16, 0.8 if pos == 0 else 0.55, pan=-0.2)
        if intro:
            add(K, t0, 0.8)
            for i in range(0, 16, 4):
                add(H, t0 + i * s16, 0.6, pan=0.3)
        elif build:
            # snare roll accelerating 8ths -> 16ths -> 32nds
            t = t0
            while t < t0 + bar - 1e-6:
                p = (t - t0) / bar
                add(C, t, 0.35 + 0.5 * p)
                t += s16 * 2 if p < 0.5 else (s16 if p < 0.75 else s16 / 2)
            add(noise_riser(bar), t0, 0.9)
        else:
            for pos in kick_pat + ([14] if b % 2 else []):
                add(K, t0 + pos * s16, 1.0)
            add(C, t0 + 4 * s16, 0.9); add(C, t0 + 12 * s16, 0.9)
            for i in range(16):
                if b % 4 == 3 and i >= 12:            # hat roll (triplet 32nds) every 4th bar
                    for k in range(3):
                        add(H, t0 + i * s16 + k * s16 / 3, 0.45, pan=0.35)
                else:
                    add(H, t0 + i * s16, 0.55 if i % 2 == 0 else 0.35, pan=0.35)
            add(HO, t0 + 14 * s16, 0.3, pan=-0.3)
            add(sub808(r * root, beat * 1.5), t0, 0.95)
            add(sub808(r * root, beat * 0.9), t0 + 10 * s16, 0.8)
        if b == drop_bar:
            add(impact(), t0, 0.7)
    beats = [round(i * beat, 4) for i in range(bars * 4)]
    meta = {"bpm": bpm, "bars": bars, "drop_bar": drop_bar, "beat_period": round(beat, 5),
            "drop_time": round(drop_bar * bar, 4), "build_time": round((drop_bar - 1) * bar, 4),
            "end_hit_time": round((bars - 1) * bar, 4), "duration": round(total, 3),
            "bar_times": [round(i * bar, 4) for i in range(bars)], "beats": beats}
    return L, R, meta


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bpm", type=float, default=140)
    ap.add_argument("--bars", type=int, default=16)
    ap.add_argument("--drop-bar", type=int, default=5)
    ap.add_argument("--key-hz", type=float, default=55.0, help="root (55=A1, 49=G1, 41.2=E1)")
    ap.add_argument("--out", default="beat.wav")
    ap.add_argument("--sfx", action="store_true")
    ap.add_argument("--outdir", default=".")
    ap.add_argument("--riser-len", type=float, default=2.0)
    a = ap.parse_args()
    if a.sfx:
        os.makedirs(a.outdir, exist_ok=True)
        for name, s in (("whoosh", whoosh()), ("impact", impact()), ("riser", noise_riser(a.riser_len)),
                        ("hit", kick(0.6)), ("rewind", rewind())):
            write_wav(os.path.join(a.outdir, name + ".wav"), s)
        print(f"wrote SFX to {a.outdir}")
        return
    if not 2 <= a.drop_bar < a.bars:
        ap.error("--drop-bar must be >= 2 and < --bars")
    L, R, meta = build_beat(a.bpm, a.bars, a.drop_bar, a.key_hz)
    write_wav(a.out, L, R)
    json.dump(meta, open(os.path.splitext(a.out)[0] + ".json", "w"), indent=2)
    print(json.dumps({k: v for k, v in meta.items() if k not in ("beats", "bar_times")}, indent=2))


if __name__ == "__main__":
    main()
