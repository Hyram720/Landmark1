"""Draw the eight 1920x1080 keyframes for "The Shoebox", a 60-second LegacyReady Family short.

Usage: python3 scenes.py OUT_DIR   (writes scene_1.svg ... scene_8.svg)
"""
import math
import sys
from pathlib import Path

W, H = 1920, 1080
FONT = "Inter, 'DejaVu Sans', sans-serif"
SERIF = "'DejaVu Serif', Georgia, serif"
INK = '#2B1B12'
SKIN_MAYA = '#8D5524'
SKIN_ROSE = '#6B4226'
SKIN_DAD = '#5A3A22'
SKIN_MOM = '#7A4A2A'

DEFS = f'''
<defs>
  <radialGradient id="glow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#FFF4C2" stop-opacity="0.95"/>
    <stop offset="100%" stop-color="#FFD966" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="vignette" cx="50%" cy="45%" r="75%">
    <stop offset="55%" stop-color="#000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000" stop-opacity="0.55"/>
  </radialGradient>
  <linearGradient id="sepia" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#E9D6B0"/>
    <stop offset="100%" stop-color="#C9A97A"/>
  </linearGradient>
  <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
    <stop offset="35%" stop-color="#0E1A2E" stop-opacity="0"/>
    <stop offset="100%" stop-color="#0E1A2E" stop-opacity="0.92"/>
  </linearGradient>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18"/></filter>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.35"/>
  </filter>
</defs>'''


def svg(body, bg):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f'{DEFS}<rect width="{W}" height="{H}" fill="{bg}"/>{body}'
            f'<rect width="{W}" height="{H}" fill="url(#vignette)"/></svg>')


def text(x, y, s, size, fill=INK, weight=400, anchor='middle', family=FONT, extra=''):
    return (f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}" {extra}>{s}</text>')


def eyes(y, spread, rx, ry, look=(0, 0), glasses=False):
    out = ''
    for side in (-1, 1):
        cx = side * spread
        out += f'<ellipse cx="{cx}" cy="{y}" rx="{rx}" ry="{ry}" fill="#fff"/>'
        out += f'<circle cx="{cx + look[0]}" cy="{y + look[1]}" r="{rx * 0.6}" fill="{INK}"/>'
        out += f'<circle cx="{cx + look[0] + rx * 0.22}" cy="{y + look[1] - ry * 0.25}" r="{rx * 0.2}" fill="#fff"/>'
        if glasses:
            out += f'<circle cx="{cx}" cy="{y}" r="{rx + 12}" fill="none" stroke="#C9A227" stroke-width="6"/>'
    if glasses:
        out += f'<path d="M {-spread + rx + 12} {y} Q 0 {y - 12} {spread - rx - 12} {y}" stroke="#C9A227" stroke-width="6" fill="none"/>'
    return out


def mouth(y, expr, w=26):
    if expr == 'wonder':
        return f'<ellipse cx="0" cy="{y + 6}" rx="{w * 0.5}" ry="{w * 0.65}" fill="{INK}"/>'
    if expr == 'laugh':
        return (f'<path d="M {-w} {y - 4} Q 0 {y + w * 1.4} {w} {y - 4} Z" fill="{INK}"/>'
                f'<path d="M {-w * 0.6} {y + w * 0.55} Q 0 {y + w * 0.95} {w * 0.6} {y + w * 0.55}" fill="#E06B74"/>')
    if expr == 'think':
        return f'<path d="M {-w * 0.7} {y + 6} Q {w * 0.1} {y - 4} {w * 0.8} {y + 2}" stroke="{INK}" stroke-width="6" fill="none" stroke-linecap="round"/>'
    return f'<path d="M {-w} {y} Q 0 {y + w} {w} {y}" stroke="{INK}" stroke-width="6" fill="none" stroke-linecap="round"/>'


def arm(x, y, length, angle, sleeve, skin, width=34):
    """An arm hanging from shoulder (x, y), rotated `angle` degrees (0 = straight down, positive = toward +x)."""
    return (f'<g transform="translate({x} {y}) rotate({-angle})">'
            f'<rect x="{-width / 2}" y="0" width="{width}" height="{length}" rx="{width / 2}" fill="{sleeve}"/>'
            f'<circle cx="0" cy="{length}" r="{width * 0.62}" fill="{skin}"/></g>')


def person(x, y, s=1.0, skin=SKIN_MAYA, shirt='#F4B400', pants='#3B5BA9', hair='puffs', expr='smile',
           look=(0, 0), arm_l=8, arm_r=-8, child=True, hair_color=INK):
    """Origin at the feet. Child stands about 560 units tall, adult about 720."""
    k = 1.0 if child else 1.28
    head_y, head_r = -430 * k, 100 * (1.0 if child else 1.05)
    body_top, body_bot = -335 * k, -150 * k
    g = f'<g transform="translate({x} {y}) scale({s})">'
    g += f'<ellipse cx="0" cy="4" rx="{95 * k}" ry="16" fill="#000" opacity="0.18"/>'
    for side in (-1, 1):
        g += f'<rect x="{side * 28 * k - 18 * k}" y="{body_bot - 10}" width="{36 * k}" height="{-body_bot + 4}" rx="16" fill="{pants}"/>'
        g += f'<ellipse cx="{side * 32 * k}" cy="-6" rx="{30 * k}" ry="16" fill="#F2F2F2"/>'
    g += arm(-80 * k, body_top + 30, 170 * k, arm_l, shirt, skin, 34 * k)
    g += arm(80 * k, body_top + 30, 170 * k, arm_r, shirt, skin, 34 * k)
    g += f'<rect x="{-82 * k}" y="{body_top}" width="{164 * k}" height="{body_bot - body_top}" rx="{46 * k}" fill="{shirt}"/>'
    g += f'<rect x="-18" y="{head_y + head_r * 0.7}" width="36" height="{body_top - head_y - head_r * 0.6}" fill="{skin}"/>'
    g += f'<g transform="translate(0 {head_y})">'
    if hair == 'puffs':
        g += f'<circle cx="-98" cy="-92" r="58" fill="{hair_color}"/><circle cx="98" cy="-92" r="58" fill="{hair_color}"/>'
    if hair == 'bun':
        g += f'<circle cx="0" cy="-128" r="48" fill="{hair_color}"/>'
    if hair == 'curly':
        for i in range(9):
            a = math.pi * (0.1 + 0.8 * i / 8)
            g += f'<circle cx="{-math.cos(a) * head_r * 1.02}" cy="{-math.sin(a) * head_r * 0.95 - 10}" r="34" fill="{hair_color}"/>'
    g += f'<ellipse cx="0" cy="-48" rx="{head_r * 1.16}" ry="{head_r * 0.86}" fill="{hair_color}"/>'
    g += f'<ellipse cx="0" cy="8" rx="{head_r}" ry="{head_r * 0.95}" fill="{skin}"/>'
    g += f'<ellipse cx="{-head_r * 1.0}" cy="14" rx="16" ry="22" fill="{skin}"/><ellipse cx="{head_r * 1.0}" cy="14" rx="16" ry="22" fill="{skin}"/>'
    g += eyes(0, 38, 24, 30, look)
    g += f'<path d="M -62 -42 Q -40 -54 -18 -44" stroke="{INK}" stroke-width="6" fill="none" stroke-linecap="round"/>'
    g += f'<path d="M 18 -44 Q 40 -54 62 -42" stroke="{INK}" stroke-width="6" fill="none" stroke-linecap="round"/>'
    g += f'<circle cx="-62" cy="42" r="15" fill="#E86A6A" opacity="0.3"/><circle cx="62" cy="42" r="15" fill="#E86A6A" opacity="0.3"/>'
    g += mouth(52, expr)
    g += '</g></g>'
    return g


def grandma(x, y, s=1.0, expr='smile', look=(0, 0), arm_l=10, arm_r=-10):
    """Grandma Rose: silver bun, gold glasses, teal cardigan, pearls. Origin at the feet, about 760 tall."""
    g = f'<g transform="translate({x} {y}) scale({s})">'
    g += '<ellipse cx="0" cy="4" rx="120" ry="18" fill="#000" opacity="0.18"/>'
    g += '<path d="M -105 -330 L -135 -10 L 135 -10 L 105 -330 Z" fill="#7B4F9E"/>'
    g += '<ellipse cx="-45" cy="-8" rx="38" ry="15" fill="#3A2A20"/><ellipse cx="45" cy="-8" rx="38" ry="15" fill="#3A2A20"/>'
    g += arm(-105, -460, 210, arm_l, '#2A7F7A', SKIN_ROSE, 40)
    g += arm(105, -460, 210, arm_r, '#2A7F7A', SKIN_ROSE, 40)
    g += '<rect x="-108" y="-480" width="216" height="200" rx="60" fill="#2A7F7A"/>'
    g += '<path d="M 0 -470 L 0 -290" stroke="#1F5F5B" stroke-width="5"/>'
    for i in range(3):
        g += f'<circle cx="0" cy="{-430 + i * 50}" r="7" fill="#E8D9B5"/>'
    g += f'<rect x="-20" y="-520" width="40" height="50" fill="{SKIN_ROSE}"/>'
    for i in range(9):
        a = math.pi * (0.2 + 0.6 * i / 8)
        g += f'<circle cx="{-math.cos(a) * 56}" cy="{-500 + math.sin(a) * 28}" r="7" fill="#F5F0E6"/>'
    g += '<g transform="translate(0 -610)">'
    g += '<circle cx="0" cy="-128" r="50" fill="#D7D3CE"/>'
    g += '<ellipse cx="0" cy="-46" rx="118" ry="88" fill="#D7D3CE"/>'
    g += f'<ellipse cx="0" cy="10" rx="98" ry="100" fill="{SKIN_ROSE}"/>'
    g += eyes(0, 40, 18, 22, look, glasses=True)
    g += f'<path d="M -66 -46 Q -42 -58 -20 -48" stroke="#9C9690" stroke-width="7" fill="none" stroke-linecap="round"/>'
    g += f'<path d="M 20 -48 Q 42 -58 66 -46" stroke="#9C9690" stroke-width="7" fill="none" stroke-linecap="round"/>'
    g += '<circle cx="-64" cy="46" r="15" fill="#E86A6A" opacity="0.25"/><circle cx="64" cy="46" r="15" fill="#E86A6A" opacity="0.25"/>'
    g += mouth(58, expr, 28)
    g += '</g></g>'
    return g


def elijah_photo(x, y, w, h, rot=0, color=False, fade=False, label=True):
    """Studio portrait of Elijah beside his wagon. Sepia, or in colour once his story is restored."""
    sky, ground, coat, hat, wheel = (('#BFD9EE', '#7FA65A', '#3E5C8A', '#3A2A20', '#7A4E2D') if color
                                     else ('#E4CFA6', '#B99B6E', '#6E553C', '#4E3B2A', '#6E553C'))
    skin = '#5A3A22' if color else '#7A5E44'
    g = f'<g transform="translate({x} {y}) rotate({rot})" filter="url(#shadow)">'
    g += f'<rect x="{-w / 2 - 18}" y="{-h / 2 - 18}" width="{w + 36}" height="{h + 70 if label else h + 36}" fill="#FAF6EC"/>'
    g += f'<rect x="{-w / 2}" y="{-h / 2}" width="{w}" height="{h}" fill="{sky}"/>'
    g += f'<rect x="{-w / 2}" y="{h * 0.18}" width="{w}" height="{h * 0.32}" fill="{ground}"/>'
    cx = w * 0.18
    g += f'<circle cx="{cx}" cy="{h * 0.2}" r="{h * 0.17}" fill="none" stroke="{wheel}" stroke-width="{h * 0.025}"/>'
    for i in range(6):
        a = i * math.pi / 3
        g += (f'<line x1="{cx}" y1="{h * 0.2}" x2="{cx + math.cos(a) * h * 0.17}" y2="{h * 0.2 + math.sin(a) * h * 0.17}" '
              f'stroke="{wheel}" stroke-width="{h * 0.012}"/>')
    g += f'<rect x="{cx - h * 0.05}" y="{-h * 0.08}" width="{w * 0.36}" height="{h * 0.12}" fill="{wheel}"/>'
    px, ps = -w * 0.17, h / 700
    g += f'<g transform="translate({px} {h * 0.42}) scale({ps})">'
    g += f'<rect x="-28" y="-160" width="22" height="160" fill="{hat}"/><rect x="6" y="-160" width="22" height="160" fill="{hat}"/>'
    g += f'<rect x="-62" y="-400" width="124" height="250" rx="34" fill="{coat}"/>'
    g += f'<rect x="-12" y="-430" width="24" height="40" fill="{skin}"/>'
    g += f'<ellipse cx="0" cy="-480" rx="52" ry="58" fill="{skin}"/>'
    g += f'<rect x="-70" y="-548" width="140" height="16" rx="8" fill="{hat}"/><rect x="-44" y="-610" width="88" height="66" rx="16" fill="{hat}"/>'
    g += '<path d="M -22 -460 Q 0 -446 22 -460" stroke="#2B1B12" stroke-width="5" fill="none"/>'
    g += '<circle cx="-18" cy="-490" r="6" fill="#2B1B12"/><circle cx="18" cy="-490" r="6" fill="#2B1B12"/>'
    g += '</g>'
    if not color:
        g += f'<rect x="{-w / 2}" y="{-h / 2}" width="{w}" height="{h}" fill="url(#sepia)" opacity="0.35"/>'
    if fade:
        g += f'<rect x="{-w / 2 - 18}" y="{-h / 2 - 18}" width="{w + 36}" height="{h + 70}" fill="url(#fade)"/>'
    if label:
        g += text(0, h / 2 + 38, 'Elijah, about 1889' if color else '?', h * 0.065, '#5B4636', 600, family=SERIF)
    g += '</g>'
    return g


def thought(x, y, w, h, lines):
    g = f'<g transform="translate({x} {y})" filter="url(#shadow)">'
    g += f'<ellipse cx="0" cy="0" rx="{w / 2}" ry="{h / 2}" fill="#FFFDF7"/>'
    g += f'<circle cx="{-w * 0.32}" cy="{h * 0.62}" r="26" fill="#FFFDF7"/><circle cx="{-w * 0.42}" cy="{h * 0.85}" r="14" fill="#FFFDF7"/>'
    for i, (s, op) in enumerate(lines):
        g += text(0, -h * 0.2 + i * h * 0.27, s, h * 0.15, f'rgba(43,27,18,{op})', 600, family=SERIF, extra='font-style="italic"')
    g += '</g>'
    return g


def sparkle(x, y, r, fill='#FFE38A', op=1.0):
    return (f'<path d="M {x} {y - r} Q {x + r * 0.2} {y - r * 0.2} {x + r} {y} Q {x + r * 0.2} {y + r * 0.2} {x} {y + r} '
            f'Q {x - r * 0.2} {y + r * 0.2} {x - r} {y} Q {x - r * 0.2} {y - r * 0.2} {x} {y - r} Z" fill="{fill}" opacity="{op}"/>')


def tablet(x, y, w, h, rot=0, content=''):
    g = f'<g transform="translate({x} {y}) rotate({rot})">'
    g += f'<ellipse cx="0" cy="0" rx="{w * 0.9}" ry="{h * 0.9}" fill="url(#glow)" filter="url(#soft)"/>'
    g += f'<rect x="{-w / 2 - 22}" y="{-h / 2 - 22}" width="{w + 44}" height="{h + 44}" rx="38" fill="#1C2433" filter="url(#shadow)"/>'
    g += f'<rect x="{-w / 2}" y="{-h / 2}" width="{w}" height="{h}" rx="18" fill="#FFFDF7"/>'
    g += content + '</g>'
    return g


def search_screen(w, h):
    fs = h * 0.055
    g = f'<rect x="{-w / 2}" y="{-h / 2}" width="{w}" height="{h * 0.14}" rx="18" fill="#0B1F3A"/>'
    g += f'<rect x="{-w / 2}" y="{-h / 2 + h * 0.07}" width="{w}" height="{h * 0.07}" fill="#0B1F3A"/>'
    g += text(-w / 2 + 34, -h / 2 + h * 0.095, 'LegacyReady  ·  Ancestry search', fs * 1.05, '#F5D27A', 700, 'start')
    rows = [('Ancestor', 'Elijah Carter'), ('Place', 'Charleston, SC'), ('Years', '1870 – 1920'), ('Collection', 'Newspapers')]
    for i, (k, v) in enumerate(rows):
        ry = -h * 0.24 + i * h * 0.15
        g += text(-w / 2 + 40, ry, k, fs * 0.8, '#5B6475', 600, 'start')
        g += f'<rect x="{-w / 2 + 40}" y="{ry + 12}" width="{w - 80}" height="{h * 0.08}" rx="10" fill="#EEF1F6" stroke="#C9D1DE" stroke-width="2"/>'
        g += text(-w / 2 + 60, ry + 12 + h * 0.058, v, fs, INK, 500, 'start')
    g += f'<rect x="{-w / 2 + 40}" y="{h * 0.36}" width="{w - 80}" height="{h * 0.1}" rx="{h * 0.05}" fill="#E0A526"/>'
    g += text(0, h * 0.36 + h * 0.068, 'Search for ancestors', fs * 1.05, '#1C1408', 700)
    return g


def scene_1():
    b = '<path d="M 0 0 L 960 -40 L 1920 0 L 1920 200 L 960 60 L 0 200 Z" fill="#2E2018"/>'
    for i in range(7):
        x = 120 + i * 280
        b += f'<path d="M {x} 0 L {x + 40} 0 L {x + 160} 1080 L {x + 120} 1080 Z" fill="#3D2A1E" opacity="0.6"/>'
    b += '<circle cx="1480" cy="250" r="120" fill="#FFE9A8"/><circle cx="1480" cy="250" r="120" fill="none" stroke="#5A3E2B" stroke-width="22"/>'
    b += '<path d="M 1480 130 L 1480 370 M 1360 250 L 1600 250" stroke="#5A3E2B" stroke-width="14"/>'
    b += '<path d="M 1380 300 L 1590 300 L 1150 1000 L 560 1000 Z" fill="#FFE9A8" opacity="0.16"/>'
    b += '<rect x="0" y="860" width="1920" height="220" fill="#4A3324"/>'
    for i, (bx, by, bw, bh) in enumerate([(120, 600, 260, 260), (300, 700, 220, 160), (1580, 640, 240, 220)]):
        b += f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" fill="#8A6648" stroke="#5A3E2B" stroke-width="6"/>'
        b += f'<path d="M {bx} {by + 40} L {bx + bw} {by + 40}" stroke="#5A3E2B" stroke-width="5"/>'
    for i in range(26):
        b += f'<circle cx="{620 + (i * 137) % 640}" cy="{360 + (i * 89) % 520}" r="{3 + i % 4}" fill="#FFF1C4" opacity="{0.25 + (i % 5) * 0.12}"/>'
    b += '<rect x="1020" y="780" width="300" height="130" fill="#B85C38" stroke="#6E3420" stroke-width="6"/>'
    b += '<path d="M 1020 780 L 1060 690 L 1360 690 L 1320 780 Z" fill="#D9774D" stroke="#6E3420" stroke-width="6"/>'
    for i in range(5):
        b += f'<rect x="{1050 + i * 48}" y="{740 - (i % 2) * 18}" width="70" height="88" fill="#EDE2C8" stroke="#A88F6A" stroke-width="3" transform="rotate({-12 + i * 6} {1085 + i * 48} {784})"/>'
    b += person(760, 930, 1.05, expr='wonder', look=(8, -6), arm_l=-10, arm_r=-150)
    b += elijah_photo(1000, 330, 170, 210, rot=6, label=False)
    return svg(b, '#3A2A1F')


def scene_2():
    b = '<rect x="0" y="0" width="1920" height="1080" fill="#F1DFC2"/>'
    b += '<rect x="0" y="760" width="1920" height="320" fill="#C99E6E"/>'
    for (fx, fy, fw, fh) in [(160, 160, 200, 250), (420, 210, 160, 200)]:
        b += f'<rect x="{fx}" y="{fy}" width="{fw}" height="{fh}" fill="#E6D3B1" stroke="#8B5E3C" stroke-width="14"/>'
    b += grandma(760, 1500, 1.55, expr='think', look=(14, -10), arm_l=10, arm_r=-128)
    b += elijah_photo(1190, 650, 210, 260, rot=-8, label=False)
    b += thought(1480, 300, 640, 380, [('Elijah?', 0.95), ('Eli? … Ezra?', 0.55), ('Born 18…?', 0.3)])
    return svg(b, '#F1DFC2')


def scene_3():
    b = '<rect width="1920" height="1080" fill="#0E1A2E"/>'
    b += '<ellipse cx="960" cy="520" rx="700" ry="420" fill="#20324F" opacity="0.6" filter="url(#soft)"/>'
    b += elijah_photo(860, 500, 520, 640, rot=-4, fade=True, label=False)
    for i in range(46):
        px = 1150 + (i * 53) % 640
        py = 160 + (i * 97) % 700
        sz = 10 + (i % 6) * 7
        b += (f'<rect x="{px}" y="{py}" width="{sz}" height="{sz * 0.8}" fill="#E4CFA6" opacity="{max(0.08, 0.75 - (px - 1150) / 800)}" '
              f'transform="rotate({(i * 37) % 90} {px} {py})"/>')
    for i, ch in enumerate('ELIJAH'):
        b += text(1180 + i * 95, 330 - i * 34, ch, 70, '#E4CFA6', 700, family=SERIF, extra=f'opacity="{0.85 - i * 0.13}"')
    b += text(1480, 640, '18 ??', 64, '#E4CFA6', 700, family=SERIF, extra='opacity="0.35"')
    return svg(b, '#0E1A2E')


def scene_4():
    b = '<rect width="1920" height="1080" fill="#2C2440"/>'
    b += '<rect x="0" y="0" width="1920" height="1080" fill="#3B2F55" opacity="0.6"/>'
    b += '<path d="M 0 740 Q 960 680 1920 740 L 1920 1080 L 0 1080 Z" fill="#8C2F39"/>'
    b += '<rect x="0" y="820" width="1920" height="260" fill="#6E2430"/>'
    b += grandma(350, 1150, 1.05, expr='smile', look=(18, 6), arm_l=10, arm_r=-60)
    b += person(640, 1010, 1.05, expr='smile', look=(18, 4), arm_l=8, arm_r=-70)
    b += tablet(1270, 470, 860, 600, rot=-3, content=search_screen(860, 600))
    return svg(b, '#2C2440')


def clipping(x, y, rot, title, src):
    g = f'<g transform="translate({x} {y}) rotate({rot})" filter="url(#shadow)">'
    g += '<rect x="-230" y="-150" width="460" height="300" fill="#F3EAD3"/>'
    g += text(0, -100, title, 23, INK, 800, family=SERIF)
    g += '<line x1="-200" y1="-80" x2="200" y2="-80" stroke="#2B1B12" stroke-width="3"/>'
    for i in range(6):
        g += f'<rect x="-200" y="{-60 + i * 26}" width="{(400, 360, 390, 300, 380, 240)[i]}" height="10" fill="#8C7B62" opacity="0.6"/>'
    g += f'<rect x="-210" y="105" width="420" height="34" rx="17" fill="#0B1F3A"/>'
    g += text(0, 129, src, 20, '#F5D27A', 700)
    g += '</g>'
    return g


def land_map(x, y, rot):
    g = f'<g transform="translate({x} {y}) rotate({rot})" filter="url(#shadow)">'
    g += '<rect x="-220" y="-160" width="440" height="320" fill="#E7DDB8"/>'
    for i in range(1, 4):
        g += f'<line x1="{-220 + i * 110}" y1="-160" x2="{-220 + i * 110}" y2="160" stroke="#B5A77A" stroke-width="2"/>'
        g += f'<line x1="-220" y1="{-160 + i * 80}" x2="220" y2="{-160 + i * 80}" stroke="#B5A77A" stroke-width="2"/>'
    g += '<path d="M -110 -80 L 0 -80 L 0 0 L 110 0 L 110 80 L -110 80 Z" fill="#7FA65A" opacity="0.55" stroke="#4E6B2F" stroke-width="5"/>'
    g += '<path d="M -220 120 Q -60 60 220 110" stroke="#5D8FC4" stroke-width="10" fill="none"/>'
    g += text(0, -110, 'Land patent · 1889', 28, INK, 800, family=SERIF)
    g += '<rect x="-210" y="118" width="420" height="34" rx="17" fill="#0B1F3A" transform="translate(0 -4)"/>'
    g += text(0, 138, 'Source: BLM land records', 20, '#F5D27A', 700)
    g += '</g>'
    return g


def scene_5():
    b = '<rect width="1920" height="1080" fill="#1E2A44"/>'
    b += '<ellipse cx="960" cy="700" rx="760" ry="420" fill="#FFD966" opacity="0.18" filter="url(#soft)"/>'
    b += tablet(960, 690, 520, 300, rot=0, content=text(0, 14, 'Results · 3 leads', 44, INK, 700))
    b += '<path d="M 960 560 Q 700 470 560 330 M 960 560 Q 1000 420 980 260 M 960 560 Q 1220 470 1380 330" stroke="#FFE38A" stroke-width="5" fill="none" stroke-dasharray="4 18" opacity="0.8"/>'
    b += clipping(560, 300, -8, 'THE CHARLESTON NEWS · 1889', 'Source: Library of Congress')
    b += elijah_photo(985, 250, 150, 180, rot=4, label=False)
    b += land_map(1390, 310, 7)
    for (sx, sy, r) in [(760, 520, 22), (1180, 560, 18), (420, 520, 14), (1560, 560, 16), (980, 470, 12), (300, 180, 10), (1680, 160, 12)]:
        b += sparkle(sx, sy, r)
    b += grandma(250, 1180, 0.95, expr='laugh', look=(14, -14), arm_l=10, arm_r=-160)
    b += person(1690, 1060, 0.95, expr='smile', look=(-16, -12), arm_l=150, arm_r=-8)
    b += '<g transform="translate(1390 545)" filter="url(#shadow)"><rect x="-150" y="-36" width="300" height="72" rx="36" fill="#2E8B57"/>'
    b += text(0, 12, '✓ Saved with source', 30, '#FFFFFF', 700) + '</g>'
    return svg(b, '#1E2A44')


def scene_6():
    b = '<rect width="1920" height="1080" fill="#22264A"/>'
    for i in range(40):
        b += f'<circle cx="{(i * 173) % 1920}" cy="{(i * 61) % 420}" r="{1.5 + i % 3}" fill="#FFF6D6" opacity="0.6"/>'
    b += '<path d="M -20 150 Q 480 330 960 230 Q 1440 130 1940 300" stroke="#3A3A3A" stroke-width="5" fill="none"/>'
    events = [('1868', 'Born'), ('1889', 'Land patent'), ('1891', 'Married Hattie'), ('1902', 'Moved north')]
    for i, (yr, what) in enumerate(events):
        cx = 300 + i * 440
        t = cx / 1920
        cy = 150 + 180 * math.sin(math.pi * t * 1.4) * (1 - t) + 70 * t
        b += f'<circle cx="{cx}" cy="{cy + 26}" r="44" fill="#FFE38A" opacity="0.35" filter="url(#soft)"/>'
        b += f'<circle cx="{cx}" cy="{cy + 22}" r="18" fill="#FFE38A"/>'
        b += f'<line x1="{cx}" y1="{cy + 40}" x2="{cx}" y2="{cy + 110}" stroke="#C9B98F" stroke-width="3"/>'
        b += f'<g transform="translate({cx} {cy + 230}) rotate({(-4, 3, -2, 4)[i]})" filter="url(#shadow)">'
        b += '<rect x="-150" y="-120" width="300" height="240" rx="14" fill="#FFFDF7"/>'
        b += text(0, -50, yr, 64, '#0B1F3A', 800)
        b += text(0, 20, what, 34, INK, 600)
        b += '<rect x="-110" y="58" width="220" height="30" rx="15" fill="#EEF1F6"/>'
        b += text(0, 80, '+ source', 20, '#5B6475', 600)
        b += '</g>'
    b += '<g transform="translate(1440 820)" filter="url(#shadow)"><rect x="-200" y="-44" width="400" height="88" rx="44" fill="#0B1F3A"/>'
    b += '<rect x="-170" y="-14" width="34" height="28" rx="5" fill="#F5D27A"/><path d="M -164 -14 L -164 -24 Q -153 -40 -142 -24 L -142 -14" stroke="#F5D27A" stroke-width="5" fill="none"/>'
    b += text(30, 12, 'Private · only you see it', 28, '#FFFFFF', 600) + '</g>'
    b += grandma(250, 1220, 0.78, expr='smile', look=(10, -16), arm_l=10, arm_r=-10)
    b += person(470, 1100, 0.78, expr='laugh', look=(6, -16), arm_l=8, arm_r=-150)
    return svg(b, '#22264A')


def scene_7():
    b = '<rect width="1920" height="1080" fill="#F2D9B0"/>'
    b += '<ellipse cx="960" cy="140" rx="380" ry="140" fill="#FFE9A8" opacity="0.7" filter="url(#soft)"/>'
    b += elijah_photo(960, 240, 230, 280, rot=0, color=True, label=True)
    family = [
        person(330, 1010, 0.9, SKIN_DAD, '#3E6FA8', '#2F3B4F', 'short', 'laugh', (10, 0), 10, -10, child=False),
        grandma(660, 1080, 0.86, 'laugh', (10, -4)),
        person(1260, 1000, 0.92, SKIN_MAYA, '#F4B400', '#3B5BA9', 'puffs', 'laugh', (-10, -4), 10, -10),
        person(1600, 1010, 0.9, SKIN_MOM, '#C2452D', '#3A2E4F', 'bun', 'smile', (-12, 0), 10, -10, child=False),
        person(960, 930, 0.62, SKIN_MAYA, '#2E8B57', '#3B5BA9', 'curly', 'wonder', (0, -14), 10, -10),
    ]
    b += ''.join(family)
    b += '<rect x="80" y="760" width="1760" height="60" rx="20" fill="#8B5E3C"/>'
    b += '<rect x="120" y="820" width="1680" height="260" fill="#A9774E"/>'
    for px in (330, 660, 1260, 1600):
        b += f'<ellipse cx="{px}" cy="770" rx="110" ry="26" fill="#FFFDF7" stroke="#D7CBB5" stroke-width="4"/>'
    b += '<g transform="translate(960 805) rotate(-3)" filter="url(#shadow)"><rect x="-235" y="-60" width="470" height="90" rx="10" fill="#0B1F3A"/>'
    b += text(0, -4, 'The Story of Elijah Carter', 30, '#F5D27A', 700, family=SERIF) + '</g>'
    return svg(b, '#F2D9B0')


def scene_8():
    b = '<rect width="1920" height="1080" fill="#0B1F3A"/>'
    b += '<ellipse cx="960" cy="420" rx="700" ry="300" fill="#16345E" opacity="0.8" filter="url(#soft)"/>'
    nodes = [(960, 150), (860, 240), (1060, 240), (810, 330), (910, 330), (1010, 330), (1110, 330)]
    for (a, c) in [(0, 1), (0, 2), (1, 3), (1, 4), (2, 5), (2, 6)]:
        b += f'<line x1="{nodes[a][0]}" y1="{nodes[a][1]}" x2="{nodes[c][0]}" y2="{nodes[c][1]}" stroke="#F5D27A" stroke-width="5"/>'
    for (nx, ny) in nodes:
        b += f'<circle cx="{nx}" cy="{ny}" r="22" fill="#F5D27A"/>'
    b += text(960, 500, 'LegacyReady Family', 110, '#FFFFFF', 800)
    b += text(960, 590, 'Search for your ancestors. Preserve your family’s story.', 46, '#F5D27A', 500)
    b += '<rect x="620" y="660" width="680" height="110" rx="55" fill="#E0A526"/>'
    b += text(960, 730, 'Start free — no credit card', 46, '#1C1408', 800)
    b += text(960, 850, 'legacyreadyfamily.com', 52, '#FFFFFF', 700)
    b += text(960, 1035, 'Dramatization. Characters, names, and records shown are fictional.', 24, '#9FB0C8', 400)
    return svg(b, '#0B1F3A')


SCENES = [scene_1, scene_2, scene_3, scene_4, scene_5, scene_6, scene_7, scene_8]

if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for i, fn in enumerate(SCENES, 1):
        (out / f'scene_{i}.svg').write_text(fn(), encoding='utf-8')
    print(f'wrote {len(SCENES)} scenes to {out}')
