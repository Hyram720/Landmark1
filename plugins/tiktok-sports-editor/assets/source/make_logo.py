#!/usr/bin/env python3
"""Build the Sun Custom Designs logo with ImageMagick (transparent PNG)."""
import math, subprocess, sys, os
FONT = sys.argv[1]; OUT = sys.argv[2]; W, H = 1500, 560
D = os.path.dirname(OUT) or "."
def im(*a): subprocess.run(["convert", *a], check=True)
cx, cy, R = 280, 280, 150
# rays: 16 alternating long/short tapered spikes
polys = []
for k in range(16):
    a = 2 * math.pi * k / 16 - math.pi / 2
    r0, r1 = R + 22, (R + 120 if k % 2 == 0 else R + 75)
    half = math.radians(7 if k % 2 == 0 else 6)
    p = [(cx + r0 * math.cos(a - half), cy + r0 * math.sin(a - half)),
         (cx + r1 * math.cos(a), cy + r1 * math.sin(a)),
         (cx + r0 * math.cos(a + half), cy + r0 * math.sin(a + half))]
    polys.append("polygon " + " ".join(f"{x:.1f},{y:.1f}" for x, y in p))
im("-size", f"{W}x{H}", "xc:none", "-fill", "#FF8A00", "-draw", " ".join(polys), f"{D}/rays.png")
# core: warm gradient disc with retro "sunset" stripe cut-outs in the lower half
im("-size", f"{2*R}x{2*R}", "gradient:#FFE04A-#FF5E00", f"{D}/grad.png")
stripes = " ".join(f"rectangle 0,{y} {2*R},{y+h}" for y, h in [(180, 12), (218, 16), (258, 22)])
im("-size", f"{2*R}x{2*R}", "xc:black", "-fill", "white", "-draw", f"circle {R},{R} {R},0",
   "-fill", "black", "-draw", stripes, f"{D}/coremask.png")
im(f"{D}/grad.png", f"{D}/coremask.png", "-alpha", "off", "-compose", "CopyOpacity", "-composite", f"{D}/core.png")
# wordmark: SUN in a gold gradient, CUSTOM DESIGNS letter-spaced in white
tx = 600
im("-size", f"{W}x{H}", "xc:none", "-font", FONT, "-pointsize", "330", "-fill", "white",
   "-annotate", f"+{tx}+330", "SUN", f"{D}/sunmask.png")
im("-size", f"{W}x{H}", "gradient:#FFD84A-#FF6A00", f"{D}/textgrad.png")
im(f"{D}/textgrad.png", "-alpha", "set", f"{D}/sunmask.png", "-compose", "DstIn", "-composite", f"{D}/suntext.png")
im("-size", f"{W}x{H}", "xc:none", "-font", FONT, "-pointsize", "92", "-kerning", "14", "-fill", "white",
   "-annotate", f"+{tx+6}+465", "CUSTOM DESIGNS", f"{D}/sub.png")
# assemble, then add a dark contour + soft shadow so it reads over bright and dark footage
im(f"{D}/rays.png", f"{D}/core.png", "-geometry", f"+{cx-R}+{cy-R}", "-compose", "over", "-composite",
   f"{D}/suntext.png", "-composite", f"{D}/sub.png", "-composite", f"{D}/art.png")
im(f"{D}/art.png", "-alpha", "extract", "-morphology", "Dilate", "Disk:5", "-blur", "0x2",
   "-background", "#141414", "-alpha", "shape", "-channel", "A", "-evaluate", "multiply", "0.75", "+channel", f"{D}/edge.png")
im(f"{D}/edge.png", f"{D}/art.png", "-compose", "over", "-composite", "-trim", "+repage",
   "-bordercolor", "none", "-border", "16", OUT)
for f in ["rays", "grad", "coremask", "core", "sunmask", "textgrad", "suntext", "sub", "art", "edge"]:
    os.remove(f"{D}/{f}.png")
