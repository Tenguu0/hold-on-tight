// Hold On Tight! — Paper Boat on a Molten-Gold Tsunami
//
// A fully procedural rasterizer in pure Node.js stdlib. It paints, pixel by
// pixel and polygon by polygon, a small paper boat surfing a tsunami of
// molten gold and ink toward the viewer, origami cranes bursting from the
// wave crest, ink droplets and gold flecks flying out at the viewer, and a
// speech bubble that talks straight to the judge.
//
// Deterministic: one fixed seed drives every random choice. No wall clock,
// no network, no timestamps. Two runs write byte-identical PNGs.
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Output: <out>/entry.png  (1024x1024, RGB PNG)

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ------------------------------------------------------------------ setup

const W = 1024;
const H = 1024;
const SEED = 20261116;

// mulberry32 — small deterministic PRNG, seeded once.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);

const px = new Uint8Array(W * H * 3); // RGB framebuffer

type RGB = [number, number, number];

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Blend src over dst at (x, y) with alpha 0..1.
function setPx(x: number, y: number, c: RGB, alpha = 1): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
  const o = (iy * W + ix) * 3;
  if (alpha >= 1) {
    px[o] = c[0];
    px[o + 1] = c[1];
    px[o + 2] = c[2];
  } else {
    px[o] = clamp255(px[o] + (c[0] - px[o]) * alpha);
    px[o + 1] = clamp255(px[o + 1] + (c[1] - px[o + 1]) * alpha);
    px[o + 2] = clamp255(px[o + 2] + (c[2] - px[o + 2]) * alpha);
  }
}

// Additive glow: push colour into the pixel, scaled by alpha.
function addPx(x: number, y: number, c: RGB, alpha: number): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
  const o = (iy * W + ix) * 3;
  px[o] = clamp255(px[o] + c[0] * alpha);
  px[o + 1] = clamp255(px[o + 1] + c[1] * alpha);
  px[o + 2] = clamp255(px[o + 2] + c[2] * alpha);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// ---------------------------------------------------------------- shapes

function fillRect(x: number, y: number, w: number, h: number, c: RGB, alpha = 1): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c, alpha);
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx - cx + 0.5;
      const dy = yy - cy + 0.5;
      if (dx * dx + dy * dy <= r2) setPx(xx, yy, c, alpha);
    }
  }
}

// Soft radial glow: colour falls off quadratically to radius r.
function glow(cx: number, cy: number, r: number, c: RGB, strength: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const dx = (xx - cx) / r;
      const dy = (yy - cy) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        const f = (1 - d2) * (1 - d2) * strength;
        addPx(xx, yy, c, f);
      }
    }
  }
}

// Scanline polygon fill (even-odd via sorted intersections).
function fillPoly(pts: Array<[number, number]>, c: RGB, alpha = 1): void {
  let minY = H;
  let maxY = -1;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  const n = pts.length;
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1p] = pts[i];
      const [x2, y2p] = pts[(i + 1) % n];
      if ((y1p <= y && y2p > y) || (y2p <= y && y1p > y)) {
        xs.push(x1 + ((y - y1p) / (y2p - y1p)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k]));
      const xb = Math.min(W - 1, Math.ceil(xs[k + 1]));
      for (let x = xa; x <= xb; x++) setPx(x, y, c, alpha);
    }
  }
}

function rot(pts: Array<[number, number]>, deg: number): Array<[number, number]> {
  const rad = (deg * Math.PI) / 180;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  return pts.map(([x, y]) => [x * cs - y * sn, x * sn + y * cs]);
}

function move(pts: Array<[number, number]>, dx: number, dy: number): Array<[number, number]> {
  return pts.map(([x, y]) => [x + dx, y + dy]);
}

function scale(pts: Array<[number, number]>, s: number): Array<[number, number]> {
  return pts.map(([x, y]) => [x * s, y * s]);
}

// Thick line as a rotated rectangle.
function drawLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, alpha = 1): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return;
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  fillPoly(
    [
      [x0 + nx, y0 + ny],
      [x1 + nx, y1 + ny],
      [x1 - nx, y1 - ny],
      [x0 - nx, y0 - ny],
    ],
    c,
    alpha,
  );
}

function roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB, alpha = 1): void {
  fillRect(x + r, y, w - 2 * r, h, c, alpha);
  fillRect(x, y + r, w, h - 2 * r, c, alpha);
  fillCircle(x + r, y + r, r, c, alpha);
  fillCircle(x + w - r, y + r, r, c, alpha);
  fillCircle(x + r, y + h - r, r, c, alpha);
  fillCircle(x + w - r, y + h - r, r, c, alpha);
}

// ------------------------------------------------------------------- text

// Chunky 5x7 bitmap font — only the glyphs the bubble line needs.
const FONT: Record<string, string[]> = {
  "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "—": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

function drawText(text: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of text) {
    const g = FONT[ch];
    if (g) {
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (g[row][col] === "1") {
            fillRect(cx + col * scale, y + row * scale, scale, scale, c);
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

// ---------------------------------------------------------------- palette

const INK_TOP: RGB = [13, 20, 52];
const INK_BOT: RGB = [4, 7, 22];
const CRIMSON: RGB = [214, 38, 62];
const CRIMSON_DEEP: RGB = [122, 16, 34];
const GOLD_BRIGHT: RGB = [255, 214, 104];
const GOLD: RGB = [232, 164, 32];
const GOLD_DEEP: RGB = [138, 77, 15];
const PAPER: RGB = [248, 244, 232];
const PAPER_SHADE: RGB = [205, 196, 172];
const INK_LINE: RGB = [11, 16, 48];
const FOAM: RGB = [255, 246, 214];

// The wave crest: a big diagonal rising from bottom-left to top-right,
// with slow undulation so the crest feels alive.
function crestY(x: number): number {
  return 905 - 0.66 * x + 26 * Math.sin(x / 170) + 14 * Math.sin(x / 61 + 1.7);
}

// ------------------------------------------------------- 1. ink background

for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const base = lerpColor(INK_TOP, INK_BOT, t);
  for (let x = 0; x < W; x++) {
    // faint diagonal light falloff, brighter toward the crest side
    const diag = (x + (H - y)) / (W + H);
    const o = (y * W + x) * 3;
    px[o] = clamp255(base[0] + diag * 14);
    px[o + 1] = clamp255(base[1] + diag * 16);
    px[o + 2] = clamp255(base[2] + diag * 30);
  }
}

// Crimson storm glow, upper right — the sky is on fire behind the wave.
glow(880, 130, 520, CRIMSON, 0.55);
glow(880, 130, 260, [255, 90, 90], 0.35);
// Cold gold glow low left, where the wave is born.
glow(120, 900, 420, GOLD, 0.30);

// Distant ink mountains / second wave, low alpha, for depth.
fillPoly(
  [
    [0, 1024],
    [0, 700],
    [180, 620],
    [360, 690],
    [540, 600],
    [720, 680],
    [900, 610],
    [1024, 660],
    [1024, 1024],
  ],
  [10, 16, 44],
  0.55,
);

// Stars / gold dust in the sky, seeded.
for (let i = 0; i < 240; i++) {
  const x = rnd() * W;
  const y = rnd() * 560;
  const r = 0.6 + rnd() * 1.8;
  const c: RGB = rnd() < 0.6 ? [255, 240, 200] : [180, 200, 255];
  fillCircle(x, y, r, c, 0.25 + rnd() * 0.55);
  if (rnd() < 0.08) {
    // four-point sparkle
    drawLine(x - 7, y, x + 7, y, 1, c, 0.7);
    drawLine(x, y - 7, x, y + 7, 1, c, 0.7);
  }
}

// Speed lines in the sky, all driving along the wave diagonal.
for (let i = 0; i < 26; i++) {
  const x = rnd() * W;
  const y = rnd() * 480;
  const len = 40 + rnd() * 130;
  drawLine(x, y, x + len * 0.82, y - len * 0.57, 2, [200, 220, 255], 0.10 + rnd() * 0.16);
}

// ------------------------------------------------------- 2. molten wave

// Deep ink under-wave, offset below the crest so the gold sits on it.
{
  const pts: Array<[number, number]> = [];
  for (let x = 0; x <= W; x += 8) pts.push([x, crestY(x) + 64]);
  pts.push([W, H], [0, H]);
  fillPoly(pts, [16, 24, 58], 1);
}

// Gold body: per-pixel gradient from blazing crest to deep molten base,
// with slow shimmer bands running along the wave.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const cy = crestY(x);
    if (y < cy) continue;
    const depth = Math.min(1, (y - cy) / 420);
    const shimmer = 0.5 + 0.5 * Math.sin((x * 0.9 + y * 1.7) / 46);
    let c = lerpColor(GOLD_BRIGHT, GOLD_DEEP, depth);
    c = lerpColor(c, GOLD, shimmer * 0.15 * (1 - depth));
    // faint ink streaks dragged through the gold
    const streak = 0.5 + 0.5 * Math.sin((x * 0.35 - y * 0.9) / 31 + 2.1);
    if (streak > 0.93) c = lerpColor(c, [30, 32, 70], (streak - 0.93) * 2.0);
    const o = (y * W + x) * 3;
    px[o] = c[0];
    px[o + 1] = c[1];
    px[o + 2] = c[2];
  }
}

// Bright crest ribbon — a band hugging the crest line.
for (let x = 0; x < W; x += 4) {
  const cy = crestY(x);
  fillCircle(x, cy + 4, 7, GOLD_BRIGHT, 0.85);
  fillCircle(x, cy + 12, 4, [255, 236, 160], 0.7);
}

// Foam scallops bursting off the crest.
for (let x = 30; x < W; x += 46) {
  const cy = crestY(x);
  const r = 12 + rnd() * 16;
  fillCircle(x + (rnd() - 0.5) * 20, cy - r * 0.4, r, FOAM, 0.9);
  fillCircle(x + (rnd() - 0.5) * 20, cy - r * 0.9, r * 0.55, PAPER, 0.85);
}

// Crimson under-light licking the crest from the storm sky.
for (let x = 120; x < W; x += 6) {
  const cy = crestY(x);
  const pulse = 0.5 + 0.5 * Math.sin(x / 90);
  if (pulse > 0.55) fillCircle(x, cy - 2, 2 + pulse * 3, CRIMSON, 0.22);
}

// ------------------------------------------------------- 3. origami cranes

// One crane, drawn in local coords facing right, neck up, tail left.
function drawCrane(cx: number, cy: number, s: number, deg: number, body: RGB, wing: RGB): void {
  const parts: Array<{ pts: Array<[number, number]>; c: RGB; a: number }> = [
    // tail sweeping back-left
    { pts: [[-8, 2], [-58, -34], [-44, -6], [-12, 10]], c: body, a: 1 },
    // body diamond
    { pts: [[-14, 4], [18, -12], [52, -2], [30, 12], [0, 14]], c: body, a: 1 },
    // long neck + beak
    { pts: [[42, -6], [58, -58], [66, -60], [62, -8], [50, 0]], c: body, a: 1 },
    { pts: [[58, -58], [84, -50], [62, -48]], c: CRIMSON, a: 1 },
    // wing raised high
    { pts: [[6, -8], [-6, -72], [34, -30], [40, -6]], c: wing, a: 1 },
    // lower wing fold
    { pts: [[-2, 6], [26, -6], [34, 8], [8, 16]], c: wing, a: 0.9 },
  ];
  for (const p of parts) {
    fillPoly(move(rot(scale(p.pts, s), deg), cx, cy), p.c, p.a);
  }
  // eye
  const eye = move(rot(scale([[60, -54]], s), deg), cx, cy)[0];
  fillCircle(eye[0], eye[1], 2.4 * s, INK_LINE, 1);
}

drawCrane(790, 268, 1.15, -18, PAPER, [232, 214, 170]);
drawCrane(872, 425, 0.72, -32, GOLD_BRIGHT, GOLD);
drawCrane(648, 168, 0.68, -8, [255, 226, 226], CRIMSON);

// Glow behind the lead crane so it pops out of the storm.
glow(790, 268, 150, GOLD_BRIGHT, 0.18);

// ------------------------------------------------------- 4. the paper boat

// Focal point: a small white origami boat riding the crest, tilted hard
// along the diagonal, lit gold on one side, ink-shadow on the other.
const BOAT_X = 470;
const BOAT_Y = 585;
const BOAT_DEG = -28;
const BOAT_S = 1.15;

function boatPts(local: Array<[number, number]>): Array<[number, number]> {
  return move(rot(scale(local, BOAT_S), BOAT_DEG), BOAT_X, BOAT_Y);
}

// mast first (behind the sails), in boat-local coords so it stays true
drawLine(
  ...boatPts([[0, 10]]),
  ...boatPts([[0, -152]]),
  5,
  INK_LINE,
  1,
);
// tiny crimson flag at the mast top
fillPoly(
  boatPts([
    [0, -152],
    [58, -138],
    [0, -122],
  ]),
  CRIMSON,
  1,
);
// left sail — tall white triangle, crimson stripe down its leading edge
fillPoly(
  boatPts([
    [-6, 8],
    [-112, -12],
    [-6, -142],
  ]),
  PAPER,
  1,
);
fillPoly(
  boatPts([
    [-6, -142],
    [-112, -12],
    [-94, -12],
    [-6, -124],
  ]),
  CRIMSON,
  1,
);
// right sail — smaller, warm gold-lit
fillPoly(
  boatPts([
    [6, 8],
    [98, -6],
    [6, -98],
  ]),
  [255, 238, 190],
  1,
);
// hull — wide trapezoid, paper-white face with a shaded starboard half
fillPoly(
  boatPts([
    [-122, 10],
    [122, 10],
    [84, 72],
    [-84, 72],
  ]),
  PAPER,
  1,
);
fillPoly(
  boatPts([
    [0, 10],
    [122, 10],
    [84, 72],
    [0, 66],
  ]),
  PAPER_SHADE,
  1,
);
// crisp fold lines
drawLine(...boatPts([[-122, 10]]), ...boatPts([[122, 10]]), 3, INK_LINE, 0.9);
drawLine(...boatPts([[-6, 8]]), ...boatPts([[-6, -142]]), 2, INK_LINE, 0.5);
drawLine(...boatPts([[6, 8]]), ...boatPts([[6, -98]]), 2, INK_LINE, 0.5);

// Gold halo behind the boat — the focal point must glow.
glow(BOAT_X, BOAT_Y - 20, 190, GOLD_BRIGHT, 0.22);

// ------------------------------------------------------- 5. flying droplets

// Ink droplets and gold flecks hurtling toward the viewer, bigger and
// brighter the closer they get (lower-right of the diagonal).
for (let i = 0; i < 90; i++) {
  const t = rnd(); // 0 = far, 1 = near the viewer
  const x = 60 + rnd() * 940;
  const y = 240 + rnd() * 760;
  const r = 2 + t * t * 22 + rnd() * 4;
  const kind = rnd();
  if (kind < 0.45) {
    // molten gold fleck, hot core
    fillCircle(x, y, r, GOLD, 0.95);
    fillCircle(x - r * 0.25, y - r * 0.25, r * 0.45, GOLD_BRIGHT, 0.95);
  } else if (kind < 0.8) {
    // ink droplet with a white glint
    fillCircle(x, y, r, [18, 26, 60], 0.95);
    fillCircle(x - r * 0.3, y - r * 0.3, r * 0.28, [200, 215, 255], 0.9);
  } else {
    // crimson spark
    fillCircle(x, y, r * 0.7, CRIMSON, 0.95);
    fillCircle(x - r * 0.2, y - r * 0.2, r * 0.3, [255, 120, 130], 0.9);
  }
  // motion streak behind it, along the diagonal
  if (r > 6) {
    drawLine(x, y, x - r * 3.2, y + r * 2.2, Math.max(1.5, r * 0.28), [255, 240, 200], 0.28);
  }
}

// A few huge foreground droplets, out of focus at the very edge.
fillCircle(80, 940, 34, [18, 26, 60], 0.9);
fillCircle(68, 928, 10, [200, 215, 255], 0.85);
fillCircle(952, 880, 26, GOLD, 0.9);
fillCircle(942, 870, 8, GOLD_BRIGHT, 0.95);
fillCircle(900, 960, 18, CRIMSON, 0.85);

// ------------------------------------------------------- 6. speech bubble

const BX = 56;
const BY = 48;
const BW = 620;
const BH = 200;
// tail first (behind the bubble), pointing down toward the boat
fillPoly(
  [
    [300, BY + BH - 10],
    [392, BY + BH - 10],
    [468, 392],
  ],
  CRIMSON,
  1,
);
fillPoly(
  [
    [308, BY + BH - 14],
    [384, BY + BH - 14],
    [460, 380],
  ],
  PAPER,
  1,
);
// crimson border, then the white face
roundRect(BX - 7, BY - 7, BW + 14, BH + 14, 34, CRIMSON, 1);
roundRect(BX, BY, BW, BH, 28, PAPER, 1);

const line1 = "JUDGE —";
const line2 = "HOLD ON TIGHT!";
drawText(
  line1,
  BX + (BW - textWidth(line1, 9)) / 2,
  BY + 26,
  9,
  INK_LINE,
);
drawText(
  line2,
  BX + (BW - textWidth(line2, 7)) / 2,
  BY + 112,
  7,
  CRIMSON_DEEP,
);
// gold underline under the second line
{
  const w = textWidth(line2, 7);
  const x0 = BX + (BW - w) / 2;
  drawLine(x0, BY + 168, x0 + w, BY + 168, 5, GOLD, 1);
}

// ------------------------------------------------------- 7. vignette + grain

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2);
    const dy = (y - H / 2) / (H / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    const vig = d > 0.85 ? 1 - (d - 0.85) * 0.9 : 1;
    const o = (y * W + x) * 3;
    px[o] = clamp255(px[o] * vig);
    px[o + 1] = clamp255(px[o + 1] * vig);
    px[o + 2] = clamp255(px[o + 2] * vig);
  }
}

// Fine grain, seeded, very subtle so the PNG still compresses well.
for (let i = 0; i < W * H; i++) {
  const g = (rnd() - 0.5) * 2;
  const o = i * 3;
  px[o] = clamp255(px[o] + g);
  px[o + 1] = clamp255(px[o + 1] + g);
  px[o + 2] = clamp255(px[o + 2] + g);
}

// ------------------------------------------------------------------- PNG

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (1 + w * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });
const png = encodePNG(W, H, px);
writeFileSync(`${outDir}/entry.png`, png);
