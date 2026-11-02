// LegacyReady Family, 20 s promo. Pure function of time: window.seek(t) paints frame t.
// Timing is in beats (u) on the measured 96 bpm grid (32 beats); docs/shotlist.md is the plan.
import * as M from './lib/motion.js';

const { W, H, FORMAT, E, prog, lerp, clamp, springU, springKeys, SPRING, wobble, font, layout, fitSize, text, fill, rrect, bump, mix } = M;

// Brand tokens, from the live site. Gold is the one accent.
const C = { navy: '#12233F', navy2: '#1B2E4E', gold: '#CBA85B', goldL: '#DFC481', cream: '#FBF7EE', white: '#FFFFFF', slate: '#3A4A62', mist: '#C9D1DE' };
const D = 'Display', UI = 'UI';
const P = FORMAT.pick, S = FORMAT.safe;
const TALL = !FORMAT.landscape;          // 9x16 and 1x1 stack; 16x9 sits side by side

// Every accent, [beat, label, sfx, opts]; sfx.mjs voices each so sound can't drift from picture.
const HITS = [
  [0, 'hook lands', 'impact'],
  [1, 'writes it down', 'thud', { gain: 0.5 }],
  [2, 'the story starts to fade', 'type', { n: 7, len: 0.8 }],
  [4, 'gold wipe lands', 'swell'],
  [4, 'wipe lands', 'thud'],
  [4, 'search headline', 'whoosh', { len: 0.45, from: 500, to: 2600 }],
  [4.5, 'ancestors', 'pop', { pitch: 'F5' }],
  [8, 'form lands (drums in)', 'thud'],
  [9, 'name field', 'tick'],
  [10, 'place field', 'tick'],
  [11, 'years field', 'tick'],
  [12, 'search pressed', 'pop', { pitch: 'A5' }],
  [12, 'click', 'click'],
  [14, 'circle opens', 'whoosh', { len: 0.5, from: 2400, to: 500 }],
  [14, 'preserve lands', 'thud'],
  [16, 'Relatives', 'blip', { pitch: 'F5' }],
  [17, 'Timelines', 'blip', { pitch: 'A5' }],
  [18, 'Sources', 'blip', { pitch: 'C6' }],
  [19, 'Stories', 'blip', { pitch: 'F6' }],
  [20, 'free card', 'thud'],
  [21, 'Free to start', 'tick'],
  [22, 'No credit card', 'tick'],
  [23, 'Private by default', 'bell', { pitch: 'C6' }],
  [24, 'push through', 'sub', { len: 0.6 }],
  [24, 'give your family', 'pop', { pitch: 'C5' }],
  [24.85, 'its story', 'pop', { pitch: 'F5', gain: 0.5 }],
  [26, 'not a scavenger hunt', 'pop', { pitch: 'A5' }],
  [28, 'end card', 'impact'],
  [28.5, 'logo drawn', 'bell', { pitch: 'F6', gain: 0.55 }],
  [30, 'start free', 'pop', { pitch: 'C6' }],
];

// ------------------------------------------------------------------ helpers

// Draw img so that image point (cx, cy) sits at the box centre, at screen scale s (image px -> px).
// Returns a mapper from image coords to screen coords so overlays can follow the camera.
function cam(ctx, img, box, cx, cy, s, radius = 0) {
  const hw = box.w / (2 * s), hh = box.h / (2 * s);
  cx = hw * 2 >= img.width ? img.width / 2 : clamp(cx, hw, img.width - hw);
  cy = hh * 2 >= img.height ? img.height / 2 : clamp(cy, hh, img.height - hh);
  const ox = box.x + box.w / 2 - cx * s, oy = box.y + box.h / 2 - cy * s;
  ctx.save();
  if (radius) rrect(ctx, box.x, box.y, box.w, box.h, radius); else { ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); }
  ctx.clip();
  ctx.drawImage(img, ox, oy, img.width * s, img.height * s);
  ctx.restore();
  return (x, y) => [ox + x * s, oy + y * s];
}
const coverScale = (img, w, h) => Math.max(w / img.width, h / img.height);

// Words that rise out of a mask line, glyph by glyph. words: [[str, u0, color]], one line.
function riseLine(ctx, words, x, base, size, weight, family, align = 'left', track = -0.03) {
  const f = font(size, weight, family), tr = track * size;
  const space = layout(ctx, ' ', f, 0).width;
  const Ls = words.map(([w]) => layout(ctx, w, f, tr));
  const total = Ls.reduce((a, L) => a + L.width, 0) + space * (words.length - 1);
  let x0 = align === 'center' ? x - total / 2 : x;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, base - size * 1.15, W, size * 1.45); ctx.clip();
  words.forEach(([w, u0, color], i) => {
    const L = Ls[i];
    L.glyphs.forEach((g, j) => {
      const k = springU(UNOW, u0 + j * Math.min(0.035, 0.28 / L.glyphs.length), SPRING.snappy);
      if (k <= 0) return;
      M.glyph(ctx, g.ch, x0 + g.cx, base + (1 - k) * size * 1.1, f, color);
    });
    x0 += L.width + space;
  });
  ctx.restore();
  return total;
}
let UNOW = 0;

function check(ctx, x, y, r, bg, fg) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, M.TAU); ctx.fillStyle = bg; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - r * 0.42, y + r * 0.02); ctx.lineTo(x - r * 0.1, y + r * 0.34); ctx.lineTo(x + r * 0.45, y - r * 0.3);
  ctx.strokeStyle = fg; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
}

function kicker(ctx, str, x, y, size, color, u0, align = 'left') {
  const k = E.outQuint(prog(UNOW, u0, u0 + 0.8));
  if (k <= 0) return;
  ctx.save(); ctx.globalAlpha = k;
  text(ctx, str, x + (align === 'left' ? (1 - k) * -30 : 0), y, font(size, 600, UI), color, align, size * 0.18);
  ctx.restore();
}

function wrap(ctx, str, f, maxW) {
  ctx.font = f;
  const out = []; let line = '';
  for (const w of str.split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  out.push(line);
  return out;
}

// ------------------------------------------------------------------ S1 hook   (u 0..4)
function s1(ctx, u, I) {
  fill(ctx, C.navy);
  const img = I.attic;
  const z = 1.08 * (1.22 / 1.08) ** E.inOutSine(prog(u, -0.5, 4.2));     // log-space push
  ctx.save();
  ctx.filter = `blur(${P({ '16x9': 3, '9x16': 6, '1x1': 4 })}px) sepia(0.3) brightness(0.82)`;
  const s = coverScale(img, W, H) * z;
  cam(ctx, img, { x: 0, y: 0, w: W, h: H }, img.width * P({ '16x9': 0.52, '9x16': 0.45, '1x1': 0.47 }), img.height * 0.5, s);
  ctx.restore();
  // shade so the type reads at phone size
  const g = ctx.createLinearGradient(0, 0, TALL ? 0 : W, TALL ? H : 0);
  g.addColorStop(0, 'rgba(18,35,63,0.9)'); g.addColorStop(TALL ? 0.7 : 0.55, 'rgba(18,35,63,0.45)'); g.addColorStop(1, 'rgba(18,35,63,0.05)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const big = TALL ? ['When nobody', 'writes', 'it down,'] : ['When nobody', 'writes it down,'];
  const maxW = TALL ? S.w : S.w * 0.62;
  const size = Math.min(P({ '16x9': 150, '9x16': 170, '1x1': 140 }), fitSize(ctx, big[0], 800, D, maxW, 400, -0.03));
  const small = ['the story starts', 'to fade.'];
  const ssz = size * 0.56;
  const blockH = size * 0.98 * big.length + ssz * 1.1 * 2 + size * 0.25;
  let y = TALL ? S.y + S.h * 0.5 - blockH / 2 + size * 0.8 : H * 0.5 - blockH / 2 + size * 0.82;
  const x = S.x + (TALL ? 0 : 30);
  const starts = TALL ? [[-0.3, 0.2], [1], [1.3, 1.5]] : [[-0.3, 0.2], [1, 1.3, 1.6]];
  big.forEach((line, i) => {
    const ws = line.split(' ').map((w, j) => [w, starts[i][j] ?? starts[i][0], C.white]);
    riseLine(ctx, ws, x, y, size, 800, D);
    y += size * 0.98;
  });
  y += size * 0.25;
  // typed in, then the last word drifts apart like dust
  const f = font(ssz, 800, D);
  small.forEach((line, li) => {
    const L = layout(ctx, line, f, -0.02 * ssz);
    const n0 = li === 0 ? 0 : small[0].length;
    L.glyphs.forEach((gl, j) => {
      const idx = n0 + j;
      const tOn = 2 + idx * 0.04;
      if (u < tOn) return;
      let dx = 0, dy = 0, a = 1, rot = 0;
      if (li === 1 && j >= 3) {        // "fade."
        const q = E.inCubic(prog(u, 2.9 + (j - 3) * 0.12, 3.75 + (j - 3) * 0.12));
        dx = q * (60 + 40 * M.hash01(j, 4)); dy = -q * (90 + 70 * M.hash01(j, 7)); a = 1 - q; rot = q * (M.hash01(j, 9) - 0.5) * 0.8;
      }
      if (a <= 0.01) return;
      ctx.save(); ctx.globalAlpha = a;
      M.glyph(ctx, gl.ch, x + gl.cx + dx, y + dy, f, C.goldL, 1, 1, rot);
      ctx.restore();
    });
    y += ssz * 1.1;
  });
}

// ------------------------------------------------------------------ S2 search headline   (u 4..8)
function s2Layout() {
  if (!TALL) return { card: { x: W * 0.5, y: 72, w: W * 0.5 - 72, h: H - 144 }, tx: S.x + 30, tw: W * 0.5 - S.x - 90, ty: H * 0.5 };
  const top = P({ '9x16': 480, '1x1': 330 });
  return { card: { x: S.x, y: S.y + top, w: S.w, h: S.h - top + P({ '9x16': 80, '1x1': 0 }) }, tx: S.x, tw: S.w, ty: S.y };
}
function s2(ctx, u, I) {
  fill(ctx, C.navy);
  const Ly = s2Layout(), b = Ly.card, img = I.hero;
  const k = springU(u, 3.15, SPRING.gentle);
  const off = TALL ? [0, (1 - k) * H * 0.6] : [(1 - k) * W * 0.55, 0];
  const z = 1.0 * (1.14) ** E.inOutSine(prog(u, 3.6, 8));
  const box = { ...b, x: b.x + off[0], y: b.y + off[1] };
  if (k > 0) cam(ctx, img, box, img.width * P({ '16x9': 0.5, '9x16': 0.55, '1x1': 0.55 }), img.height * P({ '16x9': 0.5, '9x16': 0.42, '1x1': 0.4 }), coverScale(img, b.w, b.h) * z, 28);

  const lines = [['Search for your'], ['ancestors.']];
  const size = Math.min(P({ '16x9': 128, '9x16': 132, '1x1': 112 }), fitSize(ctx, 'Search for your', 800, D, Ly.tw, 400, -0.03));
  const ksz = P({ '16x9': 36, '9x16': 38, '1x1': 32 });
  const blockH = ksz + 40 + size * 1.95;
  let y = TALL ? Ly.ty + ksz : Ly.ty - blockH / 2 + ksz;
  kicker(ctx, 'FREE PRIVATE ANCESTRY SEARCH', Ly.tx, y, ksz, C.gold, 3.6);
  y += 40 + size * 0.9;
  riseLine(ctx, [['Search', 3.7, C.white], ['for', 3.82, C.white], ['your', 3.94, C.white]], Ly.tx, y, size, 800, D);
  y += size * 1.0;
  riseLine(ctx, [['ancestors.', 4.2, C.goldL]], Ly.tx, y, size, 800, D);
}

// ------------------------------------------------------------------ S3 the real search form   (u 8..14)
const FIELD = { name: [28, 255, 378, 42], place: [421, 255, 182, 42], years: [618, 255, 379, 42], button: [815, 312, 182, 66], all: [0, 0, 1024, 532] };
function s3Cam(u) {
  const img = { w: 1024, h: 532 };
  const box = TALL ? { x: S.x - 30, y: P({ '9x16': S.y + 60, '1x1': S.y + 40 }), w: S.w + 60, h: P({ '9x16': 900, '1x1': 640 }) }
    : { x: (W - 1560) / 2, y: 70, w: 1560, h: 810 };
  const s0 = TALL ? Math.max(box.w / img.w, box.h / img.h) : box.w / img.w;
  const zf = P({ '16x9': 1.55, '9x16': 1.3, '1x1': 1.5 });
  const c = (r, z) => [r[0] + r[2] / 2, r[1] + r[3] / 2, z];
  const [cx, cy, z] = springKeys(u, [
    [7, [512, 266, 1]], [8.6, c(FIELD.name, zf)], [9.6, c(FIELD.place, zf)], [10.6, c(FIELD.years, zf)], [11.6, c(FIELD.button, zf * 1.08)],
  ], SPRING.gentle);
  const ring = springKeys(u, [[7, FIELD.name], [9.6, FIELD.place], [10.6, FIELD.years], [11.6, FIELD.button]], SPRING.snappy);
  return { box, s: s0 * z, cx, cy, ring };
}
function s3(ctx, u, I) {
  fill(ctx, C.cream);
  const img = I.form, c = s3Cam(u);
  const land = 0.035 * wobble(u - 8, 2.2, 5);
  ctx.save();
  ctx.translate(W / 2, c.box.y + c.box.h); ctx.scale(1 + land, 1 - land); ctx.translate(-W / 2, -(c.box.y + c.box.h));
  // card shadow + white card so the form floats on the cream
  ctx.save(); ctx.shadowColor = 'rgba(18,35,63,0.18)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
  rrect(ctx, c.box.x, c.box.y, c.box.w, c.box.h, 26); ctx.fillStyle = C.white; ctx.fill(); ctx.restore();
  const map = cam(ctx, img, c.box, c.cx, c.cy, c.s, 26);
  // focus ring follows the camera from field to field
  const ra = E.outQuint(prog(u, 8.6, 9.2)) * (1 - E.inQuad(prog(u, 13.2, 13.6)));
  if (ra > 0) {
    const [x0, y0] = map(c.ring[0], c.ring[1]), [x1, y1] = map(c.ring[0] + c.ring[2], c.ring[1] + c.ring[3]);
    const pad = 8 + 6 * bump(u, 12.1, 0.5);
    ctx.save(); ctx.beginPath(); rrect(ctx, c.box.x, c.box.y, c.box.w, c.box.h, 26); ctx.clip();
    ctx.globalAlpha = ra; rrect(ctx, x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad, 18 + pad);
    ctx.strokeStyle = C.gold; ctx.lineWidth = 6; ctx.stroke();
    // the button pops when pressed: a scaled crop of the real button
    const pr = wobble(u - 12, 2.6, 6) * (u >= 12 ? 1 : 0);
    if (u >= 12) {
      const r = FIELD.button, sc = 1 + 0.07 * pr;
      const [bx0, by0] = map(r[0], r[1]), [bx1, by1] = map(r[0] + r[2], r[1] + r[3]);
      const cxs = (bx0 + bx1) / 2, cys = (by0 + by1) / 2, bw = (bx1 - bx0) * sc, bh = (by1 - by0) * sc;
      ctx.globalAlpha = 1;
      ctx.drawImage(img, r[0], r[1], r[2], r[3], cxs - bw / 2, cys - bh / 2, bw, bh);
    }
    ctx.restore();
  }
  ctx.restore();
  // caption in the site's own words
  const csz = P({ '16x9': 40, '9x16': 46, '1x1': 38 });
  const f = font(csz, 600, UI);
  const lines = wrap(ctx, 'Search historical newspapers, photographs, maps, and land records.', f, TALL ? S.w : 1500);
  const ca = E.outQuint(prog(u, 8.3, 9.1));
  let y = c.box.y + c.box.h + P({ '16x9': 90, '9x16': 110, '1x1': 80 });
  ctx.save(); ctx.globalAlpha = ca;
  lines.forEach((l) => { text(ctx, l, W / 2, y + (1 - ca) * 30, f, C.navy, 'center', -0.2); y += csz * 1.3; });
  ctx.restore();
}
function s3ButtonScreen(u) {
  const c = s3Cam(u), r = FIELD.button;
  const hw = c.box.w / (2 * c.s), hh = c.box.h / (2 * c.s);
  const cx = hw * 2 >= 1024 ? 512 : clamp(c.cx, hw, 1024 - hw), cy = hh * 2 >= 532 ? 266 : clamp(c.cy, hh, 532 - hh);
  return [c.box.x + c.box.w / 2 + (r[0] + r[2] / 2 - cx) * c.s, c.box.y + c.box.h / 2 + (r[1] + r[3] / 2 - cy) * c.s];
}

// ------------------------------------------------------------------ S4 preserve   (u 14..20)
const CHIPS = [['Relatives', 16], ['Timelines', 17], ['Sources', 18], ['Stories', 19]];
function s4(ctx, u, I) {
  fill(ctx, C.navy);
  const img = I.research;
  const k = springU(u, 13.6, SPRING.gentle);
  let photo, tx, ty, tw, chipY, chipCols;
  if (!TALL) { photo = { x: S.x, y: 72, w: 700, h: H - 144 }; tx = S.x + 700 + 110; tw = W - tx - S.x; ty = H * 0.5 - 200; chipY = H * 0.5 + 150; chipCols = 2; }
  else {
    const top = P({ '9x16': 360, '1x1': 280 });
    tx = S.x; tw = S.w; ty = S.y;
    const chipsH = P({ '9x16': 220, '1x1': 200 });
    photo = { x: S.x, y: S.y + top, w: S.w, h: S.h - top - chipsH - 40 };
    chipY = photo.y + photo.h + 50; chipCols = 2;
  }
  const pb = { ...photo, y: photo.y + (1 - k) * 160 };
  ctx.save(); ctx.globalAlpha = clamp(k * 1.5);
  cam(ctx, img, pb, img.width * 0.5, img.height * P({ '16x9': 0.5, '9x16': 0.42, '1x1': 0.38 }), coverScale(img, photo.w, photo.h) * (1.0 * 1.1 ** E.inOutSine(prog(u, 14, 20))), 28);
  ctx.restore();

  const size = Math.min(P({ '16x9': 112, '9x16': 124, '1x1': 98 }), fitSize(ctx, "family's story.", 800, D, tw, 400, -0.03));
  const ksz = P({ '16x9': 36, '9x16': 38, '1x1': 32 });
  let y = ty + ksz;
  kicker(ctx, 'FAMILY HISTORY CENTER', tx, y, ksz, C.gold, 13.7);
  y += 40 + size * 0.9;
  riseLine(ctx, [['Preserve', 13.75, C.white], ['your', 13.95, C.white]], tx, y, size, 800, D);
  y += size * 1.0;
  riseLine(ctx, [["family's", 14.3, C.white], ['story.', 14.55, C.goldL]], tx, y, size, 800, D);
  if (!TALL) chipY = y + 90;

  const csz = P({ '16x9': 38, '9x16': 42, '1x1': 36 }), ch = csz * 2.1, gap = 22;
  const cw = (tw - gap) / chipCols;
  CHIPS.forEach(([label, u0], i) => {
    const s = springU(u, u0 - 0.25, { stiffness: 320, damping: 20 });
    if (s <= 0.001) return;
    const col = i % chipCols, row = Math.floor(i / chipCols);
    const x = tx + col * (cw + gap), yy = chipY + row * (ch + gap);
    ctx.save(); ctx.translate(x + cw / 2, yy + ch / 2); ctx.scale(s, s); ctx.translate(-(x + cw / 2), -(yy + ch / 2));
    rrect(ctx, x, yy, cw, ch, ch / 2); ctx.fillStyle = C.cream; ctx.fill();
    check(ctx, x + ch / 2 + 4, yy + ch / 2, ch * 0.3, C.gold, C.navy);
    text(ctx, label, x + ch + 12, yy + ch / 2 + csz * 0.36, font(csz, 600, UI), C.navy);
    ctx.restore();
  });
}

// ------------------------------------------------------------------ S5 free to start   (u 20..24)
const CARD = [4, 4, 354, 416], ZERO = [83, 224];   // the "$0" card, and the centre of the 0 (the push goes through it)
function s5Geom(u) {
  const ch = TALL ? P({ '9x16': 820, '1x1': 480 })   : 700;
  const cw = ch * CARD[2] / CARD[3];
  const box = TALL ? { x: (W - cw) / 2, y: S.y + P({ '9x16': 10, '1x1': 0 }), w: cw, h: ch } : { x: S.x + 40, y: (H - ch) / 2, w: cw, h: ch };
  const z = 1.0 * 1.12 ** E.inOutSine(prog(u, 20.3, 23.5));
  return { box, s: (cw / CARD[2]) * z };
}
function s5(ctx, u, I) {
  fill(ctx, C.cream);
  const g = s5Geom(u), img = I.pricing;
  const k = springU(u, 19.6, SPRING.gentle);
  const box = { ...g.box, y: g.box.y + (1 - k) * 200 };
  // the zoom pushes toward the $0
  const fx = lerp(CARD[0] + CARD[2] / 2, ZERO[0], prog(g.s / (g.box.w / CARD[2]), 1, 1.12));
  const fy = lerp(CARD[1] + CARD[3] / 2, ZERO[1], prog(g.s / (g.box.w / CARD[2]), 1, 1.12));
  ctx.save(); ctx.shadowColor = 'rgba(18,35,63,0.16)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
  rrect(ctx, box.x, box.y, box.w, box.h, 30); ctx.fillStyle = C.white; ctx.fill(); ctx.restore();
  cam(ctx, img, box, fx, fy, g.s, 30);

  const lines = ['Free to start.', 'No credit card.', 'Private by default.'];
  const tx = TALL ? S.x : box.x + box.w + 90, tw = TALL ? S.w - 90 : W - tx - S.x - 20;
  const size = Math.min(P({ '16x9': 100, '9x16': 92, '1x1': 72 }), fitSize(ctx, lines[2], 800, D, tw, 400, -0.03));
  const lh = size * 1.32;
  let y = TALL ? box.y + box.h + P({ '9x16': 100, '1x1': 80 }) + size * 0.4 : H / 2 - lh + size * 0.35;
  lines.forEach((l, i) => {
    const u0 = 21 + i;
    const p = springU(u, u0 - 0.25, SPRING.bouncy);
    if (p > 0.001) check(ctx, tx + size * 0.32, y - size * 0.34, size * 0.32 * p, C.gold, C.navy);
    riseLine(ctx, [[l, u0 - 0.4, C.navy]], tx + size * 0.85, y, size, 800, D);
    y += lh;
  });
}
function s5ZeroScreen(u) {
  const g = s5Geom(u);
  const z = g.s / (g.box.w / CARD[2]);
  const fx = lerp(CARD[0] + CARD[2] / 2, ZERO[0], prog(z, 1, 1.12)), fy = lerp(CARD[1] + CARD[3] / 2, ZERO[1], prog(z, 1, 1.12));
  return [g.box.x + g.box.w / 2 + (ZERO[0] - fx) * g.s, g.box.y + g.box.h / 2 + (ZERO[1] - fy) * g.s];
}

// ------------------------------------------------------------------ S6 the brand's line   (u 24..28)
function s6(ctx, u) {
  fill(ctx, C.navy);
  const L = P({
    '16x9': [[['Give', 23.8], ['your', 24.0], ['family', 24.2]], [['its', 24.5], ['story,', 24.65]], [['not', 25.45], ['a', 25.55], ['scavenger', 25.65], ['hunt.', 25.85]]],
    '9x16': [[['Give', 23.8], ['your', 24.0]], [['family', 24.2]], [['its', 24.5], ['story,', 24.65]], [['not', 25.45], ['a', 25.55]], [['scavenger', 25.65]], [['hunt.', 25.85]]],
    '1x1': [[['Give', 23.8], ['your', 24.0], ['family', 24.2]], [['its', 24.5], ['story,', 24.65]], [['not', 25.45], ['a', 25.55], ['scavenger', 25.65]], [['hunt.', 25.85]]],
  });
  const strs = L.map((l) => l.map((w) => w[0]).join(' '));
  const widest = strs.reduce((a, b) => (b.length > a.length ? b : a));
  const size = Math.min(P({ '16x9': 150, '9x16': 175, '1x1': 130 }), fitSize(ctx, widest, 800, D, S.w * 0.96, 400, -0.03));
  const lh = size * 1.02;
  const blockH = lh * L.length;
  let y = (TALL ? S.y + S.h / 2 : H / 2) - blockH / 2 + size * 0.8;
  const x = S.x + (TALL ? 0 : 40);
  L.forEach((line, i) => {
    const story = strs[i].startsWith('its');
    const w = riseLine(ctx, line.map(([s, u0]) => [s, u0, C.white]), x, y, size, 800, D);
    if (story) {      // gold underline draws under "its story,"
      const p = E.inOutCubic(prog(u, 25.5, 26.1));
      if (p > 0) { ctx.fillStyle = C.gold; rrect(ctx, x, y + size * 0.14, (w - size * 0.2) * p, size * 0.09, size * 0.045); ctx.fill(); }
    }
    y += lh;
  });
}

// ------------------------------------------------------------------ S7 end card   (u 28..32)
const LOGO_L = new Path2D('M18 15v34h19'), LOGO_R = new Path2D('M34 18h7c7 0 11 4 11 10s-4 10-11 10h-7m9 0 10 11');
function logo(ctx, u, x, y, size) {
  const k = springU(u, 27.55, SPRING.bouncy);
  if (k <= 0) return;
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2); ctx.scale(k, k); ctx.translate(-size / 2, -size / 2);
  ctx.scale(size / 64, size / 64);
  rrect(ctx, 0, 0, 64, 64, 14); ctx.fillStyle = '#13233E'; ctx.fill();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const draw = (path, color, lw, a, b, len) => {
    const p = E.inOutCubic(prog(u, a, b));
    if (p <= 0) return;
    ctx.setLineDash([len, len]); ctx.lineDashOffset = len * (1 - p);
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(path);
  };
  draw(LOGO_L, '#DFC481', 7, 27.7, 28.2, 54);
  draw(LOGO_R, '#FFFFFF', 6, 27.9, 28.45, 60);
  ctx.restore();
}
function s7(ctx, u) {
  fill(ctx, C.cream);
  const wsz = P({ '16x9': 150, '9x16': 132, '1x1': 118 });
  const f = font(wsz, 800, D);
  const wm = layout(ctx, 'LegacyReady', f, -0.03 * wsz);
  const ls = TALL ? P({ '9x16': 250, '1x1': 180 }) : 190;
  let lx, ly, wx, wy, cy;
  if (!TALL) {
    const total = ls + 50 + wm.width;
    lx = (W - total) / 2; ly = H * 0.42 - ls / 2; wx = lx + ls + 50; wy = H * 0.42 + wsz * 0.36; cy = H * 0.42 + ls / 2 + 110;
  } else {
    const top = P({ '9x16': S.y + 230, '1x1': S.y + 70 });
    lx = (W - ls) / 2; ly = top; wx = (W - wm.width) / 2; wy = top + ls + 50 + wsz * 0.8; cy = wy + P({ '9x16': 120, '1x1': 90 });
  }
  logo(ctx, u, lx, ly, ls);
  riseLine(ctx, [['Legacy', 27.85, C.navy], ['Ready', 28.0, C.gold]].map((w) => w), wx, wy, wsz, 800, D);
  // URL
  const usz = P({ '16x9': 48, '9x16': 50, '1x1': 42 });
  const ua = E.outQuint(prog(u, 28.6, 29.3));
  if (ua > 0) { ctx.save(); ctx.globalAlpha = ua; text(ctx, 'legacyreadyfamily.com', W / 2, cy + (1 - ua) * 30, font(usz, 600, UI), C.slate, 'center', 0.5); ctx.restore(); }
  // pill, in the site's words
  const psz = P({ '16x9': 38, '9x16': 42, '1x1': 36 });
  const pf = font(psz, 600, UI), label = 'Start free, no credit card';
  ctx.font = pf; const tw = ctx.measureText(label).width;
  const pw = tw + psz * 3.4, ph = psz * 2.3, px = (W - pw) / 2, py = cy + usz * 0.9;
  const s = springU(u, 29.75, SPRING.bouncy);
  if (s > 0.001) {
    ctx.save(); ctx.translate(W / 2, py + ph / 2); ctx.scale(s, s); ctx.translate(-W / 2, -(py + ph / 2));
    rrect(ctx, px, py, pw, ph, ph / 2); ctx.fillStyle = C.navy; ctx.fill();
    text(ctx, label, px + psz * 1.2, py + ph / 2 + psz * 0.36, pf, C.white);
    const ax = px + pw - psz * 1.5, ay = py + ph / 2, aw = psz * 0.55;    // arrow, drawn
    ctx.strokeStyle = C.goldL; ctx.lineWidth = psz * 0.12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(ax - aw, ay); ctx.lineTo(ax + aw * 0.6, ay); ctx.moveTo(ax + aw * 0.1, ay - aw * 0.5); ctx.lineTo(ax + aw * 0.6, ay); ctx.lineTo(ax + aw * 0.1, ay + aw * 0.5); ctx.stroke();
    ctx.restore();
  }
}

// ------------------------------------------------------------------ transitions + film

function clipDraw(ctx, path, fn) { ctx.save(); ctx.beginPath(); path(ctx); ctx.clip(); fn(); ctx.restore(); }

M.film({
  fonts: [font(100, 800, D), font(40, 500, UI), font(40, 600, UI)],
  images: { attic: 'assets/attic_girl.png', hero: 'assets/hero_photo.png', form: 'assets/search_form.png', research: 'assets/research_photo.png', pricing: 'assets/pricing.png' },
  hits: HITS,
  draw(ctx, u, t, I) {
    UNOW = u;
    if (u < 3.5) return s1(ctx, u, I);
    if (u < 4) {                                   // S1 -> S2: a gold band sweeps, S2 behind it
      s1(ctx, u, I);
      const p = E.inOutCubic(prog(u, 3.5, 4)), band = W * 0.14, edge = lerp(0, W + band, p);
      clipDraw(ctx, (c) => c.rect(0, 0, Math.max(0, edge - band), H), () => s2(ctx, u, I));
      ctx.fillStyle = C.gold; ctx.fillRect(edge - band, 0, band, H);
      return;
    }
    if (u < 7.4) return s2(ctx, u, I);
    if (u < 8) {                                   // S2 -> S3: whip, both on screen
      const p = E.inOutCubic(prog(u, 7.4, 8));
      ctx.save(); ctx.translate(-W * p, 0); s2(ctx, u, I); ctx.restore();
      ctx.save(); ctx.translate(W * (1 - p), 0); s3(ctx, u, I); ctx.restore();
      return;
    }
    if (u < 13.3) return s3(ctx, u, I);
    if (u < 14) {                                  // S3 -> S4: the gold button grows into a circle
      s3(ctx, u, I);
      const [bx, by] = s3ButtonScreen(u);
      const r = lerp(0, Math.hypot(W, H) * 1.05, E.inCubic(prog(u, 13.3, 14)));
      clipDraw(ctx, (c) => c.arc(bx, by, r, 0, M.TAU), () => s4(ctx, u, I));
      ctx.beginPath(); ctx.arc(bx, by, r, 0, M.TAU); ctx.strokeStyle = C.gold; ctx.lineWidth = 26; ctx.stroke();
      return;
    }
    if (u < 19.5) return s4(ctx, u, I);
    if (u < 20) {                                  // S4 -> S5: cream rises from the bottom
      s4(ctx, u, I);
      const p = E.inOutCubic(prog(u, 19.5, 20)), top = H * (1 - p);
      clipDraw(ctx, (c) => c.rect(0, top, W, H - top), () => s5(ctx, u, I));
      return;
    }
    if (u < 23.4) return s5(ctx, u, I);
    if (u < 24) {                                  // S5 -> S6: push through the 0
      const [zx, zy] = s5ZeroScreen(u);
      const p = prog(u, 23.4, 24), sc = 10 ** E.inCubic(p);
      ctx.save(); M.zoomAbout(ctx, sc, zx, zy); s5(ctx, u, I); ctx.restore();
      ctx.beginPath(); ctx.arc(zx, zy, Math.hypot(W, H) * 1.05 * E.inCubic(prog(p, 0.3, 1)), 0, M.TAU); ctx.fillStyle = C.navy; ctx.fill();
      return;
    }
    if (u < 27.4) return s6(ctx, u);
    if (u < 28) {                                  // S6 -> S7: cream rises
      s6(ctx, u);
      const p = E.inOutCubic(prog(u, 27.4, 28)), top = H * (1 - p);
      clipDraw(ctx, (c) => c.rect(0, top, W, H - top), () => s7(ctx, u));
      return;
    }
    s7(ctx, u);
  },
});
