/*
 * After Claude Monet, "Sailboats" (c. 1866): fishing boats moored close
 * along a harbour wall on the left, their tall dark masts and big grey and
 * ochre sails against a broken mackerel sky, dark houses and a low quay
 * behind them, a cutter under sail on the right, and gold light breaking
 * through the clouds over calm lavender water.
 *
 * Early Monet: broader and flatter than the tulips' dabs, many marks laid
 * like a palette knife's flat swipes, in a restrained palette of grey
 * lavenders, slate blues, ochre golds and dark navy, with one red accent
 * (the near boat's hull). Nothing is outlined except the thin painted
 * lines of the masts, spars and rigging.
 *
 * The painting is laid out from measurements of the original (positions are
 * % of the viewport). Everything is painted once in daylight colours; each
 * hour's light is then laid over it (engine/light.js). Every boat, masts and
 * rigging and all, is one sprite with its own painted reflection.
 */
import { TAU, clamp, lerp, mixRGB, shadeRGB, rgb, hex, smooth, mulberry32, offscreen, release, makeGlow } from '../engine/util.js';
import { noise2, fbm } from '../engine/noise.js';
import { createBrush, DAB } from '../engine/brush.js';
import { keyedCache } from '../engine/compositor.js';
import { relight, lightKey } from '../engine/light.js';
import { planeAt, swellAt, chopFor, paintReflection, createWaterGL, drawStrips } from '../engine/water.js';
import { bake, bitmaps } from '../engine/bake.js';

// broader and flatter than the tulips' dabs: more, fatter bristles that
// merge into one flat swipe, with fewer dry breaks
const KNIFE = {
  ...DAB,
  pressure: [0.86, 0.14, 1.2],
  bristleSpacing: 3,
  bristles: [4, 10],
  bristleWidth: 2.6,
  stepLen: 9,
  maxSteps: 5,
  edgeLift: [0.1, 0.14],
  dryChance: 0.22,
  dryLength: 0.22,
  shade: [0.95, 0.08],
  edgeFade: 0.3,
  scumble: 0.14,
  feather: 0.45,
};

// ---------- palettes for the hour ----------
// skyTop/skyMid/skyLow multiply the painted sky (white = as painted); tint,
// desat and wash relight the harbour, the water and the boats (see
// engine/light.js); gold is how strongly the light breaks through the
// clouds (and shows in the water); dark drives the stars and the page theme.
const NIGHT = {
  skyTop: [30, 36, 76], skyMid: [40, 48, 94], skyLow: [56, 66, 118],
  tint: [78, 86, 140], desat: 0.35, wash: [24, 30, 70, 0.3], gold: 0, dark: 1,
};
const DAY = {
  skyTop: [255, 255, 255], skyMid: [255, 255, 255], skyLow: [255, 255, 255],
  tint: [255, 255, 255], desat: 0, wash: [24, 30, 70, 0], gold: 0.85, dark: 0,
};
const PALETTES = {
  night: [{ h: 0, ...NIGHT }, { h: 4.6, ...NIGHT }, { h: 21.6, ...NIGHT }, { h: 24, ...NIGHT }],
  dawn: [
    { h: 5.6, skyTop: [100, 100, 150], skyMid: [160, 146, 182], skyLow: [230, 176, 170], tint: [186, 170, 192], desat: 0.2, wash: [60, 50, 100, 0.12], gold: 0.3, dark: 0.45 },
    { h: 6.8, skyTop: [214, 212, 236], skyMid: [240, 226, 232], skyLow: [255, 220, 204], tint: [240, 226, 224], desat: 0.04, wash: [24, 30, 70, 0], gold: 0.6, dark: 0.02 },
  ],
  day: [
    { h: 9, ...DAY, skyTop: [246, 248, 255], gold: 0.7 },
    { h: 13, ...DAY }, // the painting
    { h: 16.5, ...DAY, tint: [255, 249, 238], skyLow: [255, 247, 236], gold: 0.95 },
  ],
  // the light breaks through hardest and warms the sails
  golden: { h: 18.75, ...DAY, skyTop: [244, 234, 228], skyMid: [255, 236, 214], skyLow: [255, 224, 190], tint: [255, 232, 204], gold: 1.3 },
  dusk: [
    { h: 19.8, skyTop: [150, 140, 186], skyMid: [212, 170, 182], skyLow: [246, 168, 140], tint: [206, 164, 162], desat: 0.1, wash: [60, 40, 90, 0.06], gold: 0.75, dark: 0.2 },
    { h: 20.8, skyTop: [56, 58, 112], skyMid: [84, 78, 130], skyLow: [140, 104, 132], tint: [128, 118, 164], desat: 0.3, wash: [24, 30, 70, 0.16], gold: 0.12, dark: 0.72 },
  ],
};

// ---------- the painting's colours ----------
const C = (s) => hex(s);
const SKY = {
  base: [[0, C('#8B97C2')], [0.45, C('#A3ACD0')], [0.8, C('#BCC1DA')], [1, C('#CDD0E0')]],
  slate: C('#5E6E9E'), blue: C('#7D8BB8'), grey: C('#9CA6C9'), gap: C('#D9DCE6'), cream: C('#ECE8DE'),
  gold: C('#F2D27A'), deepGold: C('#E8B54A'), paleGold: C('#F6E4A8'), rim: C('#E6D8B8'),
  shore: [C('#5E6890'), C('#6E78A0'), C('#525C84')],
};
const HULL = [C('#2B2F45'), C('#232637'), C('#30344C'), C('#262A3E')];
const RIM = [C('#D8D4CC'), C('#C9C4BC'), C('#E2DED6')];
const RED = [C('#D6402A'), C('#C6382A'), C('#E0553A'), C('#B83226')];
const MAST = C('#262833'), WOOD = [C('#8A6A3A'), C('#A57E40'), C('#6E5232')];
const ROPE = C('#2E3040');
// sail paints: light, mid, mid, shadow, crease
const SAILS = {
  grey: [C('#DCDAE2'), C('#C4C2D0'), C('#B8B8C8'), C('#9A9AB2'), C('#6E6E8A')],
  lavender: [C('#D6D4DC'), C('#BDB8D2'), C('#B2AECA'), C('#9690B4'), C('#6C6890')],
  white: [C('#ECEAEE'), C('#D6D4DC'), C('#CFCCD8'), C('#B0AEC4'), C('#8A88A2')],
  ochre: [C('#E8C060'), C('#D9A93E'), C('#C89530'), C('#A87A26'), C('#7E5A20')],
  rust: [C('#8A4A36'), C('#6E3A30'), C('#7A4232'), C('#5A3030'), C('#3E2428')],
  slate: [C('#7D8BB8'), C('#4A4E6E'), C('#3A3E5A'), C('#2B2F45'), C('#22253A')],
  // the cutter's sails, catching the gold light on their luffs
  cutter: [C('#E2DEE2'), C('#CCC8D6'), C('#C0BED0'), C('#9C9CB8'), C('#74748E')],
};
const BUILD = { navy: [C('#2E3350'), C('#33364A'), C('#3C3A4A'), C('#2A2E46')], stone: [C('#5E4A4E'), C('#6A5252'), C('#584248'), C('#72585A')] };
const STONE = { top: [C('#B0A898'), C('#A39C90')], face: [C('#8C8478'), C('#7A7470'), C('#948C82')], foot: C('#5E5A62') };
const WATER = [C('#8C93B8'), C('#A5A9C9'), C('#B0B3D0'), C('#9EA3C6'), C('#BDBDD6')];
const WATER_LEFT = [C('#86829A'), C('#7A7690'), C('#948FA6'), C('#80808F'), C('#857A70')];
const PALE = [C('#D6D6E4'), C('#C4C3D8'), C('#E2E0EA'), C('#D9DCE6')];
const REFL_DARK = C('#2E3A3A');

// ---------- the composition ----------
const HORIZON = 54; // the far waterline (% of the hero's height)
const QUAY_WL = 57.4; // where the quay and the houses meet the water: what they reflect about

// where the gold light breaks through (% of the viewport): [x, y, rx, ry, angle, strength]
const GOLD = [
  [66, 28, 17, 5.5, -0.5, 1],
  [56, 37.5, 7.5, 4.2, -0.3, 1],
  [17, 11.5, 8.5, 2.8, 0, 0.55],
  [5, 9, 3, 2, 0, 0.4],
];

// by night: the moon (% of the viewport, set in the clearest sky near
// here), the lanterns on three boats and one lit window in the stone house
const MOON = { x: 63, y: 41, r: 1.25 };
const LAMPS = [{ boat: 'b', x: 24.6, y: 51.3 }, { boat: 'd', x: 45.4, y: 52.5 }, { boat: 'cutter', x: 95.3, y: 54.3 }];
const WINDOW = { x: 47.4, y: 41.2 };

// houses behind the boats: x0, x1, wall top, roof height (all %); chimneys [x, top]
const BUILDINGS = [
  { x0: 2, x1: 9.5, top: 22.5, roof: 3, paint: 'navy' },
  { x0: 9, x1: 14, top: 21, roof: 1.5, paint: 'navy', chimneys: [[10.6, 15.2]] },
  { x0: 13.5, x1: 20.5, top: 20.2, roof: 2.5, paint: 'navy' },
  { x0: 19.5, x1: 26, top: 23, roof: 3.5, paint: 'navy', chimneys: [[21.2, 19.6]] },
  { x0: 25, x1: 31, top: 24.5, roof: 2, paint: 'navy' },
  { x0: 36, x1: 41, top: 33.5, roof: 2, paint: 'navy' },
  { x0: 40.5, x1: 44.5, top: 32.4, roof: 1.5, paint: 'navy', chimneys: [[41.8, 24.6], [43.6, 29.2]] },
  { x0: 44, x1: 50.6, top: 31.4, roof: 1.2, paint: 'stone', windows: true },
  { x0: 50, x1: 51.6, top: 37, roof: 0, paint: 'navy' },
];

// The boats, back to front. Everything in % of the viewport. x, wl: the
// point each moves about (its waterline, under its middle); depth: 0 far –
// 1 near. hull: x0, x1, gunwale top, which end the bow is, pale rims
// [[x0, x1]] along the gunwale, a red band [top, bottom]. masts: x, top,
// base. sails: polygons in a paint; `front` ones go over the hull. spars
// and ropes: [x0, y0, x1, y1].
const DISTANT = [
  {
    id: 'far-white', x: 66.4, wl: 53.75, depth: 0.02,
    hull: { x0: 66, x1: 66.9, top: 53.45, bow: -1 },
    masts: [],
    sails: [{ paint: 'white', pts: [[66.25, 52.3], [66.85, 53.5], [66.05, 53.5]] }],
  },
  {
    id: 'far-dark', x: 70.9, wl: 55.4, depth: 0.12,
    hull: { x0: 69.2, x1: 72.6, top: 54.5, bow: -1 },
    masts: [{ x: 70.6, top: 40.6, base: 54.6 }],
    sails: [
      { paint: 'slate', pts: [[70.65, 41.2], [72.5, 54.4], [70.65, 54.4]], shade: 0.3 },
      { paint: 'slate', pts: [[70.55, 41.6], [70.55, 54.4], [69.2, 54.4]], shade: 0.95 },
    ],
  },
  {
    id: 'far-sail', x: 77, wl: 54.35, depth: 0.05,
    hull: { x0: 76.2, x1: 77.9, top: 53.95, bow: -1 },
    masts: [{ x: 76.7, top: 50.1, base: 54 }],
    sails: [{ paint: 'white', pts: [[76.75, 50.4], [77.95, 53.95], [76.3, 53.95]] }],
  },
];
const SAILING = {
  id: 'cutter', x: 89, wl: 59, depth: 0.5, sailing: true,
  hull: { x0: 82, x1: 96.6, top: 55.4, bow: -1, rise: 0.9, rim: [[82.6, 90.5]] },
  dinghy: { x0: 93.6, x1: 98.6, top: 57.3 },
  masts: [{ x: 85.9, top: 25, base: 55.6, wood: true }, { x: 88.4, top: 30, base: 55.6, wood: true }],
  sails: [
    { paint: 'cutter', pts: [[88.6, 34.6], [91.5, 28.4], [97.7, 49], [88.6, 52.7]], luff: 0 },
    { paint: 'cutter', pts: [[86, 27.2], [88.2, 32.4], [88.2, 52.7], [83.4, 52.7]], luff: 0 },
    { paint: 'cutter', pts: [[85.7, 25.9], [79, 53.4], [84.2, 52.9]], luff: 1 },
  ],
  spars: [[88.4, 34.8, 91.6, 28.3], [88.4, 52.7, 98, 49.1], [82.2, 55.1, 78.8, 53.6]],
  ropes: [[85.9, 25.6, 78.9, 53.5], [88.4, 30.4, 96.4, 55.2], [85.9, 26.2, 82.3, 55.3], [91.5, 28.5, 89.6, 33]],
};
const MOORED = [
  {
    id: 'd', x: 40.5, wl: 59.6, depth: 0.55,
    hull: { x0: 32, x1: 49, top: 54, bow: 1, rim: [[40, 48]] },
    masts: [{ x: 39.2, top: 17.5, base: 54.2 }],
    sails: [
      { paint: 'grey', pts: [[36.6, 52.6], [39.05, 22], [42, 35], [48.2, 50.6], [46, 53.6]] },
      { paint: 'lavender', pts: [[40, 31], [42.6, 33.4], [48.6, 49.6], [40.2, 49.6]] },
      { paint: 'white', pts: [[41.5, 51.2], [48, 50.6], [48.8, 54.3], [42, 54.6]], front: true },
    ],
    ropes: [[39.2, 18, 33, 54.2], [39.2, 18, 48.8, 53.6], [39.2, 24, 44, 40]],
  },
  {
    id: 'c', x: 31, wl: 60.2, depth: 0.7, pennant: { x: 34.6, y: 3.2 },
    hull: { x0: 23.5, x1: 41, top: 52.6, bow: -1 },
    masts: [{ x: 34.6, top: 3, base: 53 }],
    sails: [
      { paint: 'grey', pts: [[24.2, 48.6], [24.6, 22], [26.4, 8.6], [30.5, 11.5], [34.2, 15], [33.8, 48.6]] },
      { paint: 'rust', pts: [[33.6, 16], [34.7, 13.5], [35.3, 45], [33.9, 48]] },
      { paint: 'ochre', pts: [[35, 21.5], [36.1, 20.5], [38.2, 49.6], [36.6, 49.7]] },
    ],
    spars: [[26.2, 8.4, 34.6, 4.2]],
    ropes: [[34.6, 4, 41, 53], [26.4, 9, 24.4, 49], [34.6, 6, 30, 20]],
  },
  {
    id: 'b', x: 20.5, wl: 60.4, depth: 0.85,
    hull: { x0: 9.5, x1: 32, top: 52.4, bow: -1, rim: [[14.5, 30]] },
    masts: [{ x: 11, top: 13.5, base: 53 }, { x: 17.2, top: 40, base: 53 }],
    sails: [
      { paint: 'grey', pts: [[10.2, 52.6], [10.6, 21.5], [13.6, 19.4], [22, 30], [31.2, 52.7]] },
      { paint: 'ochre', pts: [[21.3, 31.4], [23.6, 34.4], [31.4, 52.8], [23.2, 52.8]] },
    ],
    spars: [[10.8, 21.4, 22, 30]],
    ropes: [[11, 14, 22, 30], [11, 14, 9.5, 52.4], [11, 15, 32, 52.2]],
  },
  {
    id: 'a', x: 4.5, wl: 61.3, depth: 1,
    hull: { x0: -3, x1: 10.8, top: 51.6, bow: 1, rim: [[-3, 10]], red: [56.2, 61.3] },
    masts: [{ x: 2.6, top: 6, base: 52 }, { x: 0.6, top: 14, base: 52 }],
    sails: [
      { paint: 'grey', pts: [[-1, 17], [2.8, 20], [9.2, 47.6], [5.5, 50.6], [-1, 50.6]] },
      { paint: 'ochre', pts: [[3, 25], [4.3, 24.5], [5.8, 50], [4.3, 50.2]] },
    ],
    ropes: [[2.6, 7, 10.5, 52], [2.6, 7, -2, 40], [2.6, 12, 8, 30]],
  },
];
const BOATS = [...DISTANT, SAILING, ...MOORED];

const DISSOLVE = { depth: 35, contentStart: 26, fade: 0.78, power: 1.4, wander: 0.3, ground: 0.12 };

// the same hand, wetter on the water (hardly any dry breaks)
const WET = { ...KNIFE, scumble: 0.05, dryChance: 0.1, feather: 0.3 };

// The reflections are kept at half the screen's resolution (the water's
// movement and the brushwork hide it), and displaced by the swell this far
// (CSS px at the bottom of the hero, for a stroke scale of 1): swell across,
// swell down, noise across, noise down
const REFL_RES = 0.5;
const SWAY = [7, 12, 3.5, 3];

// how strongly the gold light shows at a point (0–1), in a hero W × H
function goldAt(x, y, W, H) {
  const xp = (x / W) * 100, yp = (y / H) * 100;
  let m = 0;
  for (const [gx, gy, rx, ry, a, s] of GOLD) {
    const dx = xp - gx, dy = yp - gy, c = Math.cos(a), sn = Math.sin(a);
    const u = (dx * c + dy * sn) / rx, v = (-dx * sn + dy * c) / ry;
    m = Math.max(m, s * Math.exp(-(u * u + v * v)));
  }
  return m;
}

// The reflections of everything that never moves, baked once, in a worker
// where there is one (engine/bake.js), at REFL_RES: the sky (faintly: the
// water's own colour is mostly the sky's already) and the harbour
// (strongly), each flipped about its own waterline and painted over in
// Monet's way; and the gold light's reflection on its own, since it
// strengthens and fades with the hour. Both cover the water from the horizon
// down. sky, harbor, gold: the painted layers (canvases or ImageBitmaps).
export function* bakeReflections({ sky, harbor, gold, W, H, CH, dpr, horizonY, harborTop, k }) {
  const s = dpr * REFL_RES, rh = Math.min(CH - horizonY, horizonY);
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(rh * s));
  const rng = mulberry32(1868), brush = createBrush(WET), quay = (H * QUAY_WL) / 100;
  const [r, rg] = offscreen(w, h);
  rg.setTransform(s, 0, 0, -s, 0, horizonY * s);
  rg.globalAlpha = 0.3;
  rg.drawImage(sky, 0, 0, W, sky.height / dpr);
  // only what stands above the quay's waterline (not the dinghies below it)
  rg.setTransform(s, 0, 0, -s, 0, (2 * quay - horizonY) * s);
  rg.globalAlpha = 0.95;
  const above = quay - harborTop;
  rg.drawImage(harbor, 0, 0, harbor.width, Math.round(above * dpr), 0, harborTop, W, above);
  yield;
  const still = paintReflection(r, rng, brush, { fade: h * 0.9, scale: s, k, stretch: 0.2, gaps: 0.5, darken: 0.4, deep: REFL_DARK });
  yield;

  const [gr, gg] = offscreen(w, h);
  gg.setTransform(s, 0, 0, -s, 0, horizonY * s);
  gg.globalAlpha = 0.7;
  gg.drawImage(gold, 0, 0, W, gold.height / dpr);
  const glow = paintReflection(gr, rng, brush, { fade: h, scale: s, k, stretch: 0.15, gaps: 1.2, darken: 0.2, deep: REFL_DARK });
  // and broken level strokes of gold under the light
  const g = glow.getContext('2d');
  g.setTransform(s, 0, 0, s, 0, -horizonY * s);
  for (let i = 0; i < (W * 0.3) / k; i++) {
    if (i % 50 === 49) yield;
    const x = W * (0.44 + rng() * 0.56), y = horizonY + rng() * rh, t = (y - horizonY) / (H - horizonY);
    const m = goldAt(x, 2 * horizonY - y, W, H); // the sky it mirrors
    if (rng() > m * 0.8) continue;
    const len = k * (10 + 60 * t) * (0.5 + rng());
    brush.paintStroke(g, rng, {
      x: x - len / 2, y, angle: (rng() - 0.5) * 0.03, len, width: k * (1.2 + 4 * t),
      color: rng() < 0.5 ? SKY.gold : SKY.paleGold, alpha: (0.4 + rng() * 0.4) * (1 - t * 0.5),
    });
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  return { still, gold: glow };
}

// on localhost (or with ?dev or ?profile): the R key turns the reflections
// off and on, to measure what they cost
const DEV = typeof location !== 'undefined' &&
  (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || /[?&](dev|profile)\b/.test(location.search));

export default {
  id: 'harbor',
  // the title as it's commonly given; to be confirmed for the credit line
  title: 'Sailboats',
  artist: 'Claude Monet',
  year: 'c. 1866',
  label: 'Harbor',

  // the hours of its two placeholder stills (scenes/stills/harbor-*.webp)
  placeholder: { day: 13, night: 23 },

  layout: {
    horizonY: HORIZON,
    // the masts fill the upper left, so the text sits in the open sky at
    // centre right, left of the cutter's sails (maxRight)
    heroTextRegion: { mode: 'fixed', x: 52, y: 12, maxBottom: 40, maxRight: 78 },
  },

  palettes: PALETTES,
  brushStyle: KNIFE,

  // the hero text keeps the default dark scrim card: cream on a translucent
  // navy panel is 5.8:1 even over pure white, more over the gold
  contentTheme: {
    day: {
      themeColor: '#5E6E9E',
      vars: {
        '--bg': '#eef0f5',
        '--card': '#f7f8fb',
        '--text': '#2b2f45',
        '--muted': '#5a5f78',
        '--border': 'rgba(43, 47, 69, 0.14)',
        '--accent': '#8a6416', // the sail ochre (#D9A93E) deepened for 4.5:1 as text
        '--link': '#4a5f9e',
        '--underline': '#d6402a', // the hull red
        '--chip-bg': 'rgba(217, 169, 62, 0.16)',
        '--chip-text': '#7a5812',
        '--weave': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='3' height='3'%3E%3Cpath d='M0 .5h3M.5 0v3' stroke='%232b2f45' stroke-opacity='.04'/%3E%3C/svg%3E")`,
        '--nav-bg': 'rgba(238, 240, 245, 0.8)',
      },
    },
    night: {
      themeColor: '#121828',
      vars: {
        '--bg': '#121828',
        '--card': '#192034',
        '--text': '#f3ebd6',
        '--muted': '#b0b0c4',
        '--border': 'rgba(242, 210, 122, 0.18)',
        '--accent': '#f2d27a',
        '--link': '#f2d27a',
        '--underline': '#e8b54a',
        '--chip-bg': 'rgba(242, 210, 122, 0.12)',
        '--chip-text': '#f2d27a',
        '--weave': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='3' height='3'%3E%3Cpath d='M0 .5h3M.5 0v3' stroke='%23fff' stroke-opacity='.035'/%3E%3C/svg%3E")`,
        '--nav-bg': 'rgba(18, 24, 40, 0.8)',
      },
    },
  },

  dissolve: DISSOLVE,

  description:
    'A painting in the style of Monet’s harbour scene of moored sailboats: fishing boats with tall dark masts and big grey and ochre sails packed along a harbour wall on the left, dark houses and a low quay behind them, a boat under sail on the right, and gold light breaking through a broken grey-blue sky over calm lavender water. The light follows the time of day.',

  create,
};

// a lasting number for each object trace() reports
const traceIds = new WeakMap();
let traceN = 0;
const traceId = (o) => traceIds.get(o) ?? (traceIds.set(o, ++traceN), traceN);

function create(engine) {
  const { paintStroke } = createBrush(KNIFE);
  // the same hand, wetter on the water (hardly any dry breaks)
  const { paintStroke: wetStroke } = createBrush(WET);
  const { state, ctx, wind } = engine;
  const stars = engine.createStars({ brush: { paintStroke }, style: 'soft' });

  let W = 0, H = 0, CH = 0, dpr = 1, horizonY = 0, density = 1, k = 1;
  let skyPaint = null, goldPaint = null, harborPaint = null, harborTop = 0, waterPaint = null, waterTop = 0;
  let boats = [];

  const X = (p) => (W * p) / 100;
  const Y = (p) => (H * p) / 100;

  function measure(s) {
    ({ W, H, CH, dpr, horizonY, density } = s);
    k = clamp(Math.min(W * 0.625, H) / 900, 0.55, 1.4); // stroke scale
  }

  // how near a point on the water is: 0 at the horizon, 1 at the bottom of the hero (and on past it)
  const depth = (y) => Math.max(0, (y - horizonY) / (H - horizonY));

  // the dissolve, as in the other scenes: strokes thin out past the fold along a wandering line
  const intoDissolve = (x, y) => (y - H) / (CH - H) + (fbm(x * 0.0035, 7.7) - 0.3) * DISSOLVE.wander;
  const paintDensity = (x, y) => Math.pow(1 - smooth(0, DISSOLVE.fade, intoDissolve(x, y)), DISSOLVE.power);
  const groundEnd = (x) =>
    H + (CH - H) * (DISSOLVE.ground + (fbm(x * 0.004, 3.1) - 0.5) * 0.16 + (noise2(x * 0.05, 9.9) - 0.5) * 0.04);

  // a polygon from [x %, y %] points
  const poly = (pts) => {
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i ? p.lineTo(X(x), Y(y)) : p.moveTo(X(x), Y(y))));
    p.closePath();
    return p;
  };

  // A thin painted line (a mast, a spar, a rope): tapering from w0 to w1 px,
  // a little uneven and once in a while skipping, in two passes so it reads
  // as paint rather than a ruled line. `sag` (px) bows it down in the middle.
  function paintLine(g, rng, x0, y0, x1, y1, w0, w1, color, alpha = 0.92, sag = 0) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.5) return;
    const n = Math.max(2, Math.ceil(len / 12)), nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      const off = pass ? Math.max(w0, w1) * 0.18 : 0;
      g.strokeStyle = rgb(shadeRGB(color, pass ? 1.25 : 0.95), alpha * (pass ? 0.45 : 1));
      let px = x0 + nx * off, py = y0 + ny * off;
      for (let i = 1; i <= n; i++) {
        const f = i / n, wob = (rng() - 0.5) * 0.45;
        const x = lerp(x0, x1, f) + nx * (off + wob), y = lerp(y0, y1, f) + ny * (off + wob) + sag * 4 * f * (1 - f);
        g.lineWidth = Math.max(0.5, lerp(w0, w1, f) * (pass ? 0.5 : 1) * (0.85 + rng() * 0.3));
        if (!(pass && rng() < 0.12)) {
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(x, y);
          g.stroke();
        }
        px = x;
        py = y;
      }
    }
  }

  // ---------- the sky ----------
  // A broken mackerel sky: long rows of small flat patches of slate and
  // blue-grey with pale gaps between, finer and flatter toward the horizon,
  // paler and creamier over the masts on the left, deeper blue on the right.
  // The gold light breaking through behind the clouds is painted on a layer
  // of its own (it strengthens at golden hour and fades at night).
  const goldMask = (x, y) => goldAt(x, y, W, H);

  // how thick the cloud is at a point: 0 (a gap) – 1 (slate)
  function cloudAt(x, y) {
    const u = x / H, v = y / H, f = clamp(y / horizonY, 0, 1);
    const n = fbm(u * 3.2 + 3.1, v * (9 + f * 10) + 1.7) * 0.62 + noise2(u * 11 + 9.2, v * (30 + f * 26)) * 0.38;
    const lean = ((x / W) - 0.45) * 0.6 * (1 - f * 0.6); // creamier left, bluer right
    return clamp((n - 0.36) * 2.3 + lean - goldMask(x, y) * 0.6 - smooth(0.82, 1, f) * 0.1, 0, 1);
  }

  function cloudColor(c, rng) {
    if (c > 0.74) return SKY.slate;
    if (c > 0.52) return rng() < 0.6 ? SKY.blue : SKY.slate;
    if (c > 0.4) return rng() < 0.6 ? SKY.grey : SKY.blue;
    if (c > 0.28) return rng() < 0.5 ? SKY.grey : SKY.gap;
    return rng() < 0.55 ? SKY.gap : SKY.cream;
  }

  function* buildSky() {
    const sh = horizonY + Y(1);
    const [c, g] = offscreen(W * dpr, sh * dpr);
    g.scale(dpr, dpr);
    const rng = mulberry32(1866);
    const grad = g.createLinearGradient(0, 0, 0, sh);
    for (const [at, col] of SKY.base) grad.addColorStop(at, rgb(col));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, sh);

    // broad flat swipes laying in the masses
    const nBig = Math.round(((W * horizonY) / (2400 * k * k)) * density);
    for (let i = 0; i < nBig; i++) {
      if (i % 20 === 19) yield;
      const x = rng() * W, y = rng() * horizonY, f = y / horizonY, len = (120 + rng() * 220) * k;
      paintStroke(g, rng, {
        x: x - len / 2, y, angle: (rng() - 0.5) * 0.08, len, width: (20 + rng() * 22) * k * (1 - 0.5 * f),
        color: cloudColor(cloudAt(x, y), rng), alpha: 0.5 + rng() * 0.15, bend: (rng() - 0.5) * 0.1,
      });
    }

    // the mackerel: rows of flat knife swipes side by side, each coloured by
    // the cloud under it, smaller and flatter toward the horizon
    let work = 0;
    for (let y = -Y(0.5); y < horizonY + Y(0.5);) {
      const f = clamp(y / horizonY, 0, 1), rh = (10 - 5 * f) * k;
      for (let x = -40 * k * rng(); x < W + 40;) {
        const len = (22 + rng() * 40) * k * (1 - 0.4 * f);
        const yy = y + (rng() - 0.5) * rh * 0.7, cl = cloudAt(x + len / 2, yy);
        paintStroke(g, rng, {
          x, y: yy, angle: (rng() - 0.5) * 0.09 - 0.03, len, width: rh * (0.9 + rng() * 0.6),
          color: mixRGB(cloudColor(cl, rng), SKY.grey, rng() * 0.12), alpha: 0.8 + rng() * 0.15, bend: (rng() - 0.5) * 0.16,
        });
        x += (len * (0.55 + rng() * 0.35)) / Math.sqrt(density);
        if (++work % 40 === 0) yield;
      }
      y += (rh * 0.6) / Math.sqrt(density);
    }

    // the clearest gaps, brightened with a few pale knife swipes
    const nGap = Math.round(((W * horizonY) / (1400 * k * k)) * density);
    for (let i = 0; i < nGap; i++) {
      if (i % 40 === 39) yield;
      const x = rng() * W, y = rng() * horizonY * 0.96;
      if (cloudAt(x, y) > 0.24) continue;
      const len = (22 + rng() * 50) * k * (1 - 0.4 * (y / horizonY));
      paintStroke(g, rng, {
        x: x - len / 2, y, angle: (rng() - 0.5) * 0.08, len, width: (5 + rng() * 7) * k,
        color: rng() < 0.5 ? SKY.cream : SKY.gap, alpha: 0.65 + rng() * 0.25,
      });
    }

    // the far shore on the right: a thin blue-grey strip along the horizon
    for (let x = X(64); x < W + 10; x += 6 * k) {
      const top = horizonY - Y(0.9 + noise2(x * 0.02, 3.3) * 0.7);
      paintStroke(g, rng, {
        x, y: (top + horizonY) / 2, angle: (rng() - 0.5) * 0.06, len: (10 + rng() * 14) * k, width: horizonY - top + 1,
        color: SKY.shore[(rng() * SKY.shore.length) | 0], alpha: 0.5 + rng() * 0.3, bristles: 3,
      });
    }
    yield;
    release(skyPaint);
    skyPaint = c;

    // the gold: a soft glow behind the clouds, swipes of gold and pale gold
    // in the gaps, and warm rims on the clouds around them
    const [gc, gg] = offscreen(W * dpr, sh * dpr);
    gg.scale(dpr, dpr);
    for (const [gx, gy, rx, ry, a, s] of GOLD) {
      gg.save();
      gg.translate(X(gx), Y(gy));
      gg.rotate(a);
      gg.scale(X(rx) * 1.6, Y(ry) * 1.6);
      const glow = gg.createRadialGradient(0, 0, 0, 0, 0, 1);
      glow.addColorStop(0, rgb(SKY.gold, 0.32 * s));
      glow.addColorStop(1, rgb(SKY.gold, 0));
      gg.fillStyle = glow;
      gg.beginPath();
      gg.arc(0, 0, 1, 0, TAU);
      gg.fill();
      gg.restore();
    }
    const nGold = Math.round(((W * horizonY) / (320 * k * k)) * density);
    for (let i = 0; i < nGold; i++) {
      if (i % 40 === 39) yield;
      const x = rng() * W, y = rng() * horizonY, m = goldMask(x, y);
      if (rng() > m) continue;
      const cl = cloudAt(x, y), len = (24 + rng() * 60) * k * (1 - 0.35 * (y / horizonY));
      if (cl < 0.48) {
        paintStroke(gg, rng, {
          x: x - len / 2, y, angle: (rng() - 0.5) * 0.1 - 0.05, len, width: (6 + rng() * 11) * k,
          color: cl < 0.2 || rng() < 0.35 ? SKY.paleGold : rng() < 0.75 ? SKY.gold : SKY.deepGold, alpha: 0.5 + 0.45 * m,
        });
      } else if (cl < 0.62) {
        paintStroke(gg, rng, {
          x: x - len / 2, y, angle: (rng() - 0.5) * 0.1, len: len * 0.7, width: (3 + rng() * 4) * k,
          color: SKY.rim, alpha: 0.32 * m,
        });
      }
    }
    release(goldPaint);
    goldPaint = gc;
    yield* buildGaps();
    yield* buildMoon();
    yield* buildDrift();
  }

  // the sky for this hour: the painted sky, the gold at its strength, and
  // the hour's colours multiplied over the lot
  // ---------- the sky in motion ----------
  // The painted sky stays put. Over it drift loose patches of cloud, carried
  // along by the wind and fading in and out, so the mackerel sky slowly
  // moves; the gold light shimmers (about ±8%) and shifts a little, as if
  // the clouds were passing in front of the sun. Each frame they're laid
  // together in daylight colours and the hour's colours go over the lot.
  const DRIFT_STAMPS = 16, GAP_CELL = 6;
  let driftStamps = [], drift = [], driftRng = mulberry32(606);
  let gapMask = null, gapSoft = null, gapGrid = null, gapW = 0, gapH = 0;
  let silverPaint = null, moonSprite = null, glowSprite = null, moon = { x: 0, y: 0, r: 0 };
  const [skyBuf, skyCtx] = offscreen(1, 1), [moonBuf, moonCtx] = offscreen(1, 1), [starBuf, starCtx] = offscreen(1, 1);
  const driftTarget = () => Math.round(clamp((W * horizonY) / 5000, 50, 160) * state.quality);

  function* buildDrift() {
    const rng = mulberry32(707);
    driftStamps.forEach(release);
    driftStamps = [];
    const tones = [SKY.slate, SKY.blue, SKY.blue, SKY.grey, SKY.grey, SKY.gap, SKY.cream, SKY.slate];
    for (let i = 0; i < DRIFT_STAMPS; i++) {
      const len = (40 + rng() * 80) * k, width = (7 + rng() * 8) * k, pad = 4;
      const [c, g] = offscreen((len + pad * 2) * dpr, (width * 1.5 + pad * 2) * dpr);
      g.scale(dpr, dpr);
      paintStroke(g, rng, { x: pad, y: width * 0.75 + pad, angle: 0, len, width, color: tones[i % tones.length], bend: (rng() - 0.5) * 0.12 });
      driftStamps.push(c);
      if (i % 4 === 3) yield;
    }
    for (const c of [skyBuf, starBuf]) {
      c.width = skyPaint.width;
      c.height = skyPaint.height;
    }
    driftRng = mulberry32(606); // the same start on every load
    drift = [];
    for (let i = 0, n = driftTarget(); i < n; i++) drift.push(spawnDrift({}, true));
  }

  function spawnDrift(s, midLife) {
    const y = Math.pow(driftRng(), 1.15) * horizonY * 0.94;
    Object.assign(s, {
      x: -120 + driftRng() * (W + 240), y,
      stamp: (driftRng() * DRIFT_STAMPS) | 0,
      life: 14 + driftRng() * 10, fade: 4,
      peak: 0.3 + driftRng() * 0.35,
      scale: (0.8 + driftRng() * 0.5) * (1 - 0.45 * (y / horizonY)), // smaller toward the horizon
      sf: 0.6 + driftRng() * 0.6,
    });
    s.age = midLife ? driftRng() * s.life : 0;
    return s;
  }

  // once per frame while the wind blows: level, with the wind, slower far off
  function updateDrift(dt) {
    const target = driftTarget();
    for (let i = drift.length - 1; i >= 0; i--) {
      const s = drift[i];
      s.age += dt;
      if (s.age >= s.life) {
        if (drift.length > target) {
          drift.splice(i, 1);
          continue;
        }
        spawnDrift(s, false);
      }
      s.x += wind.dir[0] * wind.speed * s.sf * wind.gust * 0.7 * (1 - 0.45 * (s.y / horizonY)) * dt;
    }
    while (drift.length < target) drift.push(spawnDrift({}, false));
  }

  const driftAlpha = (s) => s.peak * smooth(0, s.fade, s.age) * (1 - smooth(s.life - s.fade, s.life, s.age));

  // the drifting patches into g (in CSS px), each at `alpha` of its own;
  // `near` (optional [x, y, r]) keeps to those around a point
  function drawDrift(g, alpha = 1, near = null) {
    for (const s of drift) {
      const a = driftAlpha(s) * alpha;
      if (a < 0.004) continue;
      const c = driftStamps[s.stamp], w = (c.width / dpr) * s.scale, h = (c.height / dpr) * s.scale;
      if (near && (Math.abs(s.x - near[0]) > near[2] + w / 2 || Math.abs(s.y - near[1]) > near[2] + h)) continue;
      g.globalAlpha = a;
      g.drawImage(c, s.x - w / 2, s.y - h / 2, w, h);
    }
    g.globalAlpha = 1;
  }

  // where the painted sky is clear (1) or clouded (0), coarsely: the stars
  // and the moon show only through its gaps (gapSoft lets a little of the
  // moon through the cloud too)
  function* buildGaps() {
    gapW = Math.ceil(W / GAP_CELL) + 1;
    gapH = Math.ceil(horizonY / GAP_CELL) + 1;
    gapGrid = new Float32Array(gapW * gapH);
    const [c, g] = offscreen(gapW, gapH), [cs, gs] = offscreen(gapW, gapH);
    const img = g.createImageData(gapW, gapH), soft = gs.createImageData(gapW, gapH);
    for (let j = 0; j < gapH; j++) {
      for (let i = 0; i < gapW; i++) {
        const o = j * gapW + i, v = 1 - smooth(0.18, 0.5, cloudAt(i * GAP_CELL, j * GAP_CELL));
        gapGrid[o] = v;
        img.data.fill(255, o * 4, o * 4 + 3);
        soft.data.fill(255, o * 4, o * 4 + 3);
        img.data[o * 4 + 3] = Math.round(v * 255);
        soft.data[o * 4 + 3] = Math.round((0.3 + 0.7 * v) * 255);
      }
      if (j % 8 === 7) yield;
    }
    g.putImageData(img, 0, 0);
    gs.putImageData(soft, 0, 0);
    [gapMask, gapSoft].forEach(release);
    gapMask = c;
    gapSoft = cs;
  }
  const gapAt = (x, y) => gapGrid[clamp(Math.round(y / GAP_CELL), 0, gapH - 1) * gapW + clamp(Math.round(x / GAP_CELL), 0, gapW - 1)];

  // The moon, low over the harbour mouth (after Monet's moonlit seascapes),
  // set in the clearest patch of sky near MOON; silver along the edges of the
  // cloud around it, painted once like the gold; and the soft glows for the
  // moon and the lamps.
  function* buildMoon() {
    let best = -1;
    for (let dx = -3; dx <= 3; dx += 0.5) {
      for (let dy = -2; dy <= 2; dy += 0.5) {
        const v = gapAt(X(MOON.x + dx), Y(MOON.y + dy)) - Math.hypot(dx, dy) * 0.03;
        if (v > best) {
          best = v;
          moon = { x: X(MOON.x + dx), y: Y(MOON.y + dy), r: Math.max(5, Y(MOON.r)) };
        }
      }
    }
    const rng = mulberry32(1868);
    const [c, g] = offscreen(skyPaint.width, skyPaint.height);
    g.scale(dpr, dpr);
    const glow = g.createRadialGradient(moon.x, moon.y, 0, moon.x, moon.y, X(14));
    glow.addColorStop(0, 'rgba(220,226,244,0.22)');
    glow.addColorStop(1, 'rgba(220,226,244,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, horizonY);
    for (let i = 0; i < (W * horizonY) / (260 * k * k); i++) {
      const x = moon.x + (rng() - 0.5) * X(34), y = moon.y + (rng() - 0.5) * Y(26);
      const m = Math.exp(-(((x - moon.x) / X(13)) ** 2) - ((y - moon.y) / Y(10)) ** 2), cl = cloudAt(x, y);
      if (y > horizonY || rng() > m || cl < 0.26 || cl > 0.62) continue;
      const len = (16 + rng() * 40) * k;
      paintStroke(g, rng, { x: x - len / 2, y, angle: (rng() - 0.5) * 0.1, len, width: (2.5 + rng() * 4) * k, color: C('#E4E8F4'), alpha: 0.5 * m });
      if (i % 60 === 59) yield;
    }
    release(silverPaint);
    silverPaint = c;
    // the disc: a few pale dabs, and the glows
    const size = Math.ceil(moon.r * 2.6) * 2;
    const [mc, mg] = offscreen(size * dpr, size * dpr);
    mg.scale(dpr, dpr);
    for (let yy = -moon.r * 0.75, i = 0; yy <= moon.r * 0.76; yy += moon.r * 0.5, i++) {
      const half = Math.sqrt(Math.max(0, moon.r * moon.r - yy * yy));
      paintStroke(mg, rng, {
        x: size / 2 - half, y: size / 2 + yy, angle: 0, len: half * 2, width: moon.r * 0.62,
        color: i % 2 ? C('#E6E6EE') : C('#F4F1E6'), alpha: 0.92, bristles: 3,
      });
    }
    release(moonSprite);
    moonSprite = mc;
    if (!glowSprite) glowSprite = { moon: makeGlow(226, 232, 250), lamp: makeGlow(255, 196, 120) };
    yield;
  }

  function drawSky() {
    const light = state.light, { skyTop, skyMid, skyLow, dark } = light, t = state.motion ? state.time / 1000 : 0;
    const g = skyCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.drawImage(skyPaint, 0, 0);
    g.globalCompositeOperation = 'source-over';
    // the gold, breathing about ±8% and shifting a little
    const breathe = Math.sin(t * 0.31) * 0.6 + Math.sin(t * 0.097 + 1.3) * 0.4;
    const a = light.gold * (1 - dark) * (1 + 0.08 * breathe), shift = X(0.5) * Math.sin(t * 0.045) * dpr;
    if (a > 0.004) {
      g.globalAlpha = Math.min(1, a);
      g.drawImage(goldPaint, shift, 0);
      if (a > 1) {
        g.globalCompositeOperation = 'screen';
        g.globalAlpha = a - 1;
        g.drawImage(goldPaint, shift, 0);
        g.globalCompositeOperation = 'source-over';
      }
      g.globalAlpha = 1;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawDrift(g);
    if (Math.min(...skyTop, ...skyMid, ...skyLow) < 254.5) {
      const grad = g.createLinearGradient(0, 0, 0, horizonY);
      grad.addColorStop(0, rgb(skyTop));
      grad.addColorStop(0.55, rgb(skyMid));
      grad.addColorStop(1, rgb(skyLow));
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = grad;
      g.fillRect(0, 0, W, skyBuf.height / dpr);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(skyBuf, 0, 0, W, skyBuf.height / dpr);
    if (dark > 0.05) drawMoon(dark, breathe);
  }

  // the moon behind the clouds: partly through the painted sky's gaps, hidden
  // as the drifting patches pass in front; then the silver at the cloud's edges
  function drawMoon(dark, breathe) {
    const a = smooth(0.3, 0.9, dark), box = moon.r * 14, x0 = moon.x - box / 2, y0 = moon.y - box / 2;
    if (moonBuf.width !== Math.ceil(box * dpr)) moonBuf.width = moonBuf.height = Math.ceil(box * dpr);
    const g = moonCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, moonBuf.width, moonBuf.height);
    g.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    g.globalAlpha = 0.55;
    g.drawImage(glowSprite.moon, moon.x - moon.r * 6, moon.y - moon.r * 6, moon.r * 12, moon.r * 12);
    g.globalAlpha = 1;
    g.drawImage(moonSprite, moon.x - moonSprite.width / dpr / 2, moon.y - moonSprite.height / dpr / 2, moonSprite.width / dpr, moonSprite.height / dpr);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(gapSoft, 0, 0, gapW * GAP_CELL, gapH * GAP_CELL);
    g.globalCompositeOperation = 'destination-out';
    drawDrift(g, 0.9, [moon.x, moon.y, box / 2]);
    g.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    ctx.drawImage(moonBuf, x0, y0, box, box);
    ctx.globalAlpha = a * 0.55 * (0.92 + 0.08 * breathe);
    ctx.drawImage(silverPaint, 0, 0, W, silverPaint.height / dpr);
    ctx.globalAlpha = 1;
  }

  // The shared stars, but only in the gaps between the clouds: drawn on a
  // canvas of their own, then cut to the painted sky's gaps and away where a
  // drifting patch passes in front.
  const starLayer = stars.layer(2);
  const maskedStars = {
    ...starLayer,
    render(c, s) {
      if (s.light.dark <= 0.01) return;
      const g = starCtx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, starBuf.width, starBuf.height);
      starLayer.render(g, s);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(gapMask, 0, 0, gapW * GAP_CELL, gapH * GAP_CELL);
      g.globalCompositeOperation = 'destination-out';
      drawDrift(g, 1.2);
      g.globalCompositeOperation = 'source-over';
      c.drawImage(starBuf, 0, 0, W, starBuf.height / dpr);
    },
  };

  // ---------- the harbour ----------
  // Dark houses behind the boats, a taller rust-brown stone house among
  // them, the low stone quay on the right with its small dark house and lamp
  // post, and a few dinghies moored below it.
  function* buildHarbor() {
    harborTop = Math.floor(Y(14));
    const bottom = Y(63);
    const [c, g] = offscreen(W * dpr, (bottom - harborTop) * dpr);
    g.scale(dpr, dpr);
    g.translate(0, -harborTop);
    const rng = mulberry32(1640);

    // the harbour wall behind the moored boats
    for (let x = -10; x < X(51); x += 9 * k) {
      paintStroke(g, rng, {
        x, y: Y(55.5) + (rng() - 0.5) * Y(1.5), angle: (rng() - 0.5) * 0.05, len: (24 + rng() * 30) * k, width: Y(3.2),
        color: BUILD.navy[(rng() * 4) | 0], alpha: 0.95,
      });
    }
    for (const b of BUILDINGS) {
      paintBuilding(g, rng, b);
      yield;
    }
    paintQuay(g, rng);
    yield;
    release(harborPaint);
    harborPaint = c;
    harborCache.reset();
    yield;
    harborCache.get(relightKey(), c.width, c.height);
  }

  function paintBuilding(g, rng, b) {
    const x0 = X(b.x0), x1 = X(b.x1), top = Y(b.top), base = Y(56), w = x1 - x0;
    const paints = BUILD[b.paint], peak = top - Y(b.roof);
    const body = new Path2D();
    body.moveTo(x0, base);
    body.lineTo(x0, top);
    if (b.roof) body.lineTo(x0 + w * 0.5, peak);
    body.lineTo(x1, top);
    body.lineTo(x1, base);
    body.closePath();
    g.fillStyle = rgb(paints[0], 0.96);
    g.fill(body);
    g.save();
    g.clip(body);
    // walls: flat vertical swipes, darker on the shaded right side
    for (let x = x0 - 2; x < x1 + 2; x += 5 * k) {
      const shade = (x - x0) / w > 0.7 ? 0.82 : 1;
      for (let y = peak; y < base; y += (18 + rng() * 14) * k) {
        const len = (20 + rng() * 26) * k;
        paintStroke(g, rng, {
          x: x + (rng() - 0.5) * 3, y: y + len, angle: -Math.PI / 2 + (rng() - 0.5) * 0.12, len, width: (5 + rng() * 4) * k,
          color: shadeRGB(paints[(rng() * paints.length) | 0], shade), alpha: 0.85,
        });
      }
    }
    // the roof: dark slanting swipes
    if (b.roof) {
      for (let i = 0; i < w / (4 * k); i++) {
        const f = rng(), x = x0 + f * w, y = lerp(top, peak, 1 - Math.abs(f - 0.5) * 2) + rng() * Y(1);
        paintStroke(g, rng, {
          x, y, angle: (f < 0.5 ? -1 : 1) * 0.5 + (rng() - 0.5) * 0.2, len: (10 + rng() * 10) * k, width: 4 * k,
          color: shadeRGB(BUILD.navy[1], 0.7), alpha: 0.8,
        });
      }
    }
    // a few dark windows in rows on the stone house
    if (b.windows) {
      for (let y = top + Y(2.5); y < Y(51); y += Y(4.2)) {
        for (let x = x0 + w * 0.15; x < x1 - w * 0.15; x += w * 0.24) {
          if (rng() < 0.55) continue;
          paintStroke(g, rng, {
            x: x + (rng() - 0.5) * w * 0.08, y: y + Y(1.6) + (rng() - 0.5) * Y(0.8), angle: -Math.PI / 2, len: Y(1.6), width: Math.max(2, w * 0.08),
            color: C('#3A3242'), alpha: 0.55, bristles: 3,
          });
        }
      }
    }
    g.restore();
    // the outline loosened: swipes half over the walls' and roof's edges
    const edge = [[x0, base], [x0, top], ...(b.roof ? [[x0 + w * 0.5, peak]] : []), [x1, top], [x1, base]];
    for (let i = 0; i < edge.length - 1; i++) {
      const [ax, ay] = edge[i], [bx, by] = edge[i + 1], L = Math.hypot(bx - ax, by - ay);
      for (let d = rng() * 10 * k; d < L; d += (10 + rng() * 14) * k) {
        const f = d / L;
        paintStroke(g, rng, {
          x: lerp(ax, bx, f), y: lerp(ay, by, f), angle: Math.atan2(by - ay, bx - ax) + (rng() - 0.5) * 0.3, len: (8 + rng() * 10) * k,
          width: 3.5 * k, color: paints[(rng() * paints.length) | 0], alpha: 0.6,
        });
      }
    }
    for (const [cx, ctop] of b.chimneys || []) {
      const yb = b.roof ? lerp(top, peak, 1 - Math.abs((X(cx) - x0) / w - 0.5) * 2) + 2 : top + 2;
      paintStroke(g, rng, {
        x: X(cx), y: yb, angle: -Math.PI / 2 + (rng() - 0.5) * 0.04, len: yb - Y(ctop), width: Math.max(3, X(0.8)),
        color: BUILD.navy[1], alpha: 0.95, bristles: 4,
      });
    }
  }

  function paintQuay(g, rng) {
    const x0 = X(49.6), x1 = X(65), top = Y(54), base = Y(QUAY_WL);
    // the face: level swipes of weathered grey-brown stone, darker at the foot
    for (let y = top + Y(0.4); y < base; y += 3.2 * k) {
      for (let x = x0; x < x1;) {
        const len = (18 + rng() * 34) * k;
        const near = (base - y) / (base - top);
        paintStroke(g, rng, {
          x, y, angle: (rng() - 0.5) * 0.04, len: Math.min(len, x1 - x + 4), width: 4.2 * k,
          color: near < 0.25 ? mixRGB(STONE.foot, STONE.face[0], rng() * 0.5) : STONE.face[(rng() * 3) | 0], alpha: 0.92,
        });
        x += len * 0.75;
      }
    }
    // the pale top edge
    for (let x = x0; x < x1; x += 12 * k) {
      paintStroke(g, rng, {
        x, y: top + Y(0.2), angle: (rng() - 0.5) * 0.03, len: (14 + rng() * 16) * k, width: Y(0.7),
        color: STONE.top[(rng() * 2) | 0], alpha: 0.9,
      });
    }
    // the small dark house on the quay
    paintBuilding(g, rng, { x0: 54, x1: 61, top: 50.6, roof: 2.4, paint: 'navy' });
    // pale crates at the quay's end
    for (let i = 0; i < 4; i++) {
      paintStroke(g, rng, {
        x: X(61.6 + i * 0.75), y: Y(53.8), angle: -Math.PI / 2, len: Y(0.8 + rng() * 0.5), width: X(0.6),
        color: PALE[(rng() * 4) | 0], alpha: 0.85, bristles: 3,
      });
    }
    // the lamp post
    paintLine(g, rng, X(53.2), Y(54.1), X(53.2), Y(48.6), 2 * k, 1.5 * k, MAST, 0.95);
    paintStroke(g, rng, { x: X(53.2), y: Y(48.9), angle: -Math.PI / 2, len: Y(0.9), width: X(0.45), color: MAST, alpha: 0.95, bristles: 3 });
    // dinghies below the quay, each with a short dark reflection
    for (const [d0, d1, dy] of [[50.5, 57.5, 61.2], [52.2, 60, 59], [60.6, 64.6, 58.6]]) {
      const len = X(d1 - d0), y = Y(dy);
      paintStroke(g, rng, { x: X(d0), y, angle: 0, len, width: Y(1.1), color: HULL[(rng() * 4) | 0], alpha: 0.95, bend: 0.04 });
      paintStroke(g, rng, { x: X(d0) + len * 0.1, y: y - Y(0.45), angle: 0, len: len * 0.75, width: Y(0.3), color: C('#4A4E6A'), alpha: 0.7, bristles: 2 });
      for (let i = 0; i < 3; i++) {
        wetStroke(g, rng, {
          x: X(d0) + rng() * len * 0.3, y: y + Y(0.9 + i * 0.7), angle: (rng() - 0.5) * 0.04, len: len * (0.5 + rng() * 0.4),
          width: Y(0.45), color: REFL_DARK, alpha: 0.5 - i * 0.12,
        });
      }
    }
  }

  // ---------- the boats ----------
  // Each boat (masts, spars, rigging and all) is painted once into a sprite
  // of its own, positioned by its waterline, with a reflection to match.

  function boatBox(b) {
    let x0 = b.hull.x0, x1 = b.hull.x1, y0 = b.hull.top;
    const take = (x, y) => {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
    };
    for (const m of b.masts) take(m.x, m.top);
    for (const s of b.sails) for (const [x, y] of s.pts) take(x, y);
    for (const [ax, ay, bx, by] of [...(b.spars || []), ...(b.ropes || [])]) {
      take(ax, ay);
      take(bx, by);
    }
    if (b.dinghy) take(b.dinghy.x1, b.dinghy.top);
    if (b.pennant) take(b.pennant.x - 4, b.pennant.y - 1);
    const pad = 4 + 6 * k;
    return { x: X(x0) - pad, y: Y(y0) - pad, w: X(x1 - x0) + pad * 2, h: Y(b.wl - y0 + 0.8) + pad * 2 };
  }

  function* buildBoats() {
    const rng = mulberry32(1866 + 31);
    disposeBoats();
    for (const b of BOATS) {
      const box = boatBox(b);
      const [c, g] = offscreen(box.w * dpr, box.h * dpr);
      g.setTransform(dpr, 0, 0, dpr, -box.x * dpr, -box.y * dpr);
      for (const s of b.sails) {
        if (s.front) continue;
        paintSail(g, rng, s, b);
        yield;
      }
      for (const m of b.masts) {
        const color = m.wood ? WOOD[(rng() * 3) | 0] : MAST, w = (b.depth * 2 + 1.4) * k;
        paintLine(g, rng, X(m.x), Y(m.base), X(m.x) + (rng() - 0.5) * 2, Y(m.top), w, w * 0.45, color);
      }
      for (const [ax, ay, bx, by] of b.spars || []) paintLine(g, rng, X(ax), Y(ay), X(bx), Y(by), (1 + b.depth * 1.4) * k, (0.8 + b.depth) * k, b.sailing ? WOOD[1] : MAST);
      paintHull(g, rng, b.hull, b.wl, b.depth);
      if (b.dinghy) paintHull(g, rng, { ...b.dinghy, bow: 1, rise: 0.5 }, b.wl - 0.3, b.depth);
      yield;
      for (const s of b.sails) if (s.front) paintSail(g, rng, s, b);
      for (const [ax, ay, bx, by] of b.ropes || []) {
        paintLine(g, rng, X(ax), Y(ay), X(bx), Y(by), (0.6 + b.depth * 0.6) * k, (0.5 + b.depth * 0.4) * k, ROPE, 0.6, Y(0.25));
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      const ox = X(b.x) - box.x, oy = Y(b.wl) - box.y; // the waterline point, in the sprite (CSS px)
      yield;
      const refl = reflectBoat(c, ox, oy, rng, b);
      const boat = {
        def: b, sprite: c, refl, x: X(b.x), y: Y(b.wl), ox, oy, w: box.w, h: box.h,
        pose: { dx: 0, dy: 0, roll: 0, skew: 0 }, raw: [0, 0],
        // how far the swell heaves it (px at full swell) and rolls it: the
        // moored boats least, tied up; the cutter most; the far ones barely
        heave: Y(b.sailing ? 0.34 : DISTANT.includes(b) ? 0.06 : 0.36 * (0.7 + 0.5 * b.depth)),
        rollGain: b.sailing ? 0.5 : DISTANT.includes(b) ? 0.3 : 0.6,
        pennant: b.pennant ? paintPennant(rng, b) : null,
        lit: keyedCache((lg) => relight(lg, c, boatLight())),
      };
      boats.push(boat);
      yield;
      // relit for the hour now, rather than all at once in the first frame
      boat.lit.get(relightKey(), c.width, c.height);
      yield;
    }
    moored = boats.filter((b) => MOORED.includes(b.def)).sort((p, q) => p.x - q.x); // side by side, left to right
    lamps = LAMPS.map((l) => ({ ...l, b: boats.find((b) => b.def.id === l.boat) }));
  }
  let moored = [], lamps = [];

  // darker than the harbour at night: the boats turn to silhouettes
  const boatLight = () => {
    const light = state.light;
    return { ...light, tint: light.tint.map((v) => v * (1 - 0.45 * light.dark)) };
  };

  function paintHull(g, rng, h, wl, near) {
    const x0 = X(h.x0), x1 = X(h.x1), top = Y(h.top), bot = Y(wl) + Y(0.5), L = x1 - x0;
    const rise = Y(h.rise ?? 0.7), rake = (bot - top) * 0.45;
    const topAt = (x) => {
      const f = clamp((x - x0) / L, 0, 1), toBow = h.bow > 0 ? f : 1 - f;
      return top - rise * smooth(0.6, 1, toBow) - rise * 0.25 * smooth(0.8, 1, 1 - toBow);
    };
    const path = new Path2D();
    path.moveTo(x0, topAt(x0));
    for (let i = 1; i <= 24; i++) path.lineTo(x0 + (L * i) / 24, topAt(x0 + (L * i) / 24));
    // the ends round down into the water, the bow more gently
    const r1 = h.bow > 0 ? rake : rake * 0.4, r0 = h.bow > 0 ? rake * 0.4 : rake;
    path.quadraticCurveTo(x1 - r1 * 0.2, bot - (bot - top) * 0.2, x1 - r1, bot);
    path.lineTo(x0 + r0, bot);
    path.quadraticCurveTo(x0 + r0 * 0.2, bot - (bot - top) * 0.2, x0, topAt(x0));
    path.closePath();
    g.fillStyle = rgb(HULL[0], 0.97);
    g.fill(path);
    g.save();
    g.clip(path);
    // level knife swipes along the planking
    for (let y = top - rise; y < bot + 2; y += 2.2 * k) {
      for (let x = x0 - 6; x < x1;) {
        const len = (18 + rng() * 36) * k;
        paintStroke(g, rng, { x, y, angle: (rng() - 0.5) * 0.04, len, width: 4 * k, color: HULL[(rng() * 4) | 0], alpha: 0.9 });
        x += len * 0.7;
      }
    }
    // pale rims along the gunwale
    for (const [r0, r1] of h.rim || []) {
      for (let x = X(r0); x < X(r1); x += 10 * k) {
        const y = topAt(x) + Y(0.35) + (rng() - 0.5) * Y(0.3);
        paintStroke(g, rng, { x, y, angle: (rng() - 0.5) * 0.05, len: (10 + rng() * 18) * k, width: Y(0.55) * (0.7 + near * 0.6), color: RIM[(rng() * 3) | 0], alpha: 0.85 });
      }
    }
    // the near boat's red band, down to the water
    if (h.red) {
      for (let y = Y(h.red[0]); y < bot; y += 2.6 * k) {
        for (let x = x0 - 6, end = X(10.4) + (rng() - 0.5) * X(0.8); x < end;) {
          const len = Math.min((16 + rng() * 30) * k, end - x + 4);
          paintStroke(g, rng, { x, y, angle: (rng() - 0.5) * 0.05, len, width: 4.6 * k, color: RED[(rng() * 4) | 0], alpha: 0.95 });
          x += len * 0.7;
        }
      }
    }
    g.restore();
    // softened along the top: a few swipes straddling the edge
    for (let x = x0; x < x1; x += 14 * k) {
      if (rng() < 0.5) continue;
      paintStroke(g, rng, { x, y: topAt(x) + 1, angle: (rng() - 0.5) * 0.05, len: (10 + rng() * 12) * k, width: 2.4 * k, color: HULL[(rng() * 4) | 0], alpha: 0.7 });
    }
  }

  // A sail: its paint filled flat, then worked over with knife swipes that
  // fall the way the cloth hangs, lighter on its folds and toward the light
  // on the right, darker in the creases and low on the left.
  function paintSail(g, rng, s, b) {
    const pts = s.pts.map(([x, y]) => [X(x), Y(y)]), pal = SAILS[s.paint];
    const path = poly(s.pts);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX, h = maxY - minY;
    // the way the cloth falls: from its highest corner to the middle of its foot
    const top = pts[ys.indexOf(minY)], foot = pts.filter((p) => p[1] > minY + h * 0.7);
    const fx = foot.reduce((a, p) => a + p[0], 0) / foot.length, fy = foot.reduce((a, p) => a + p[1], 0) / foot.length;
    const fall = Math.atan2(fy - top[1], fx - top[0]);
    const lit = s.shade ?? 0.5, seed = rng() * TAU, folds = 2 + rng() * 2.5;
    g.fillStyle = rgb(pal[s.shade !== undefined ? (lit > 0.6 ? 0 : 2) : 2], 0.96);
    g.fill(path);
    if (w < 6 * k && h < 30 * k) return; // far away: a single touch of paint
    g.save();
    g.clip(path);
    const n = Math.round((w * h) / (150 * k * k) + 6);
    for (let i = 0; i < n; i++) {
      const x = minX + rng() * w, y = minY + rng() * h, u = (x - minX) / w, v = (y - minY) / h;
      const fold = Math.sin((u * folds + v * 0.6) * TAU * 0.5 + seed);
      let lum = (s.shade ?? 0.52) + 0.24 * fold + 0.22 * (u - 0.5) - 0.18 * (v - 0.5) + (rng() - 0.5) * 0.2;
      if (s.luff !== undefined) lum += 0.12 * (1 - Math.abs(u - s.luff) * 2); // the cutter: its luffs catch the light
      const col = lum > 0.74 ? pal[0] : lum > 0.5 ? pal[1 + ((rng() * 2) | 0)] : lum > 0.28 ? pal[3] : pal[4];
      const len = Math.min(h * 0.7, (30 + rng() * 50) * k);
      paintStroke(g, rng, {
        x: x - (Math.cos(fall) * len) / 2, y: y - (Math.sin(fall) * len) / 2, angle: fall + (rng() - 0.5) * 0.3 + fold * 0.08,
        len, width: Math.min(w * 0.6, (8 + rng() * 10) * k), color: col, alpha: 0.85, bend: (rng() - 0.5) * 0.15,
      });
    }
    // a few long creases down the cloth
    for (let i = 0; i < Math.max(1, w / (30 * k)); i++) {
      const x = minX + w * (0.15 + rng() * 0.7), y = minY + h * rng() * 0.3, len = h * (0.4 + rng() * 0.4);
      paintStroke(g, rng, { x, y, angle: fall + (rng() - 0.5) * 0.15, len, width: 2 * k, color: pal[4], alpha: 0.35, bristles: 2 });
    }
    // the gold light on the cutter's sails, toward their luffs
    if (s.luff !== undefined) {
      for (let i = 0; i < n * 0.25; i++) {
        const u = clamp(s.luff + (rng() - 0.5) * 0.5, 0, 1), x = minX + u * w, y = minY + rng() * h;
        paintStroke(g, rng, { x, y, angle: fall + (rng() - 0.5) * 0.3, len: (10 + rng() * 20) * k, width: 4 * k, color: C('#E8DCB4'), alpha: 0.5 });
      }
    }
    g.restore();
    // edges loosened: a few swipes half over the outline
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length], L = Math.hypot(bx - ax, by - ay);
      for (let d = rng() * 20 * k; d < L; d += (16 + rng() * 22) * k) {
        if (rng() < 0.55) continue;
        const f = d / L;
        paintStroke(g, rng, {
          x: lerp(ax, bx, f), y: lerp(ay, by, f), angle: Math.atan2(by - ay, bx - ax) + (rng() - 0.5) * 0.2, len: (8 + rng() * 12) * k,
          width: 3 * k, color: pal[1 + ((rng() * 3) | 0)], alpha: 0.55,
        });
      }
    }
  }

  // a little pale streamer at a masthead, painted pointing right from its
  // mast; drawn turned downwind
  function paintPennant(rng, b) {
    const len = Math.max(14, X(2.4)), w = Math.max(3, Y(0.7)), pad = 3;
    const [c, g] = offscreen((len + pad * 2) * dpr, (w * 2 + pad * 2) * dpr);
    g.scale(dpr, dpr);
    paintStroke(g, rng, { x: pad, y: w + pad, angle: 0.06, len, width: w, color: C('#E8E2D4'), alpha: 0.95, bristles: 3, bend: 0.08 });
    paintStroke(g, rng, { x: pad + len * 0.7, y: w + pad + len * 0.04, angle: 0.06, len: len * 0.3, width: w * 0.6, color: SKY.slate, alpha: 0.8, bristles: 2 });
    return {
      canvas: c, x: X(b.pennant.x), y: Y(b.pennant.y), w: len + pad * 2, h: w * 2 + pad * 2, pad,
      lit: keyedCache((lg) => relight(lg, c, boatLight())),
    };
  }

  // ---------- reflections ----------
  // A boat's reflection, baked once with its sprite at REFL_RES: its sprite
  // above the waterline, flipped (a little shortened), with wavering gold
  // streaks under its ochre sails and red under the red band, painted over
  // in Monet's way (engine/water.js). Row 0 is the waterline.
  function reflectBoat(sprite, ox, oy, rng, b) {
    const s = dpr * REFL_RES, fade = Y(18 + 24 * b.depth) * s, squash = 0.86;
    const w = Math.max(1, Math.round((sprite.width / dpr) * s)), h = Math.max(2, Math.round(Math.min(oy * squash * s, fade)));
    const [r, rg] = offscreen(w, h);
    rg.setTransform(s / dpr, 0, 0, (-squash * s) / dpr, 0, oy * s * squash);
    rg.drawImage(sprite, 0, 0);
    rg.setTransform(s, 0, 0, s, 0, 0);
    for (const sl of b.sails) {
      if (sl.paint !== 'ochre') continue;
      const xs = sl.pts.map((p) => p[0]), x0 = X(Math.min(...xs)) - (X(b.x) - ox), x1 = X(Math.max(...xs)) - (X(b.x) - ox);
      const from = (Y(b.wl) - Y(Math.max(...sl.pts.map((p) => p[1])))) * squash;
      for (let i = 0; i < 3 + (x1 - x0) / (10 * k); i++) {
        const x = lerp(x0, x1, rng()), len = Y(4 + rng() * 10);
        for (let j = 0, y = from + rng() * Y(2); j < 6 && y < h / s; j++) {
          const seg = len / 6;
          wetStroke(rg, rng, { x: x + (j % 2 ? 2 : -2) * k, y, angle: Math.PI / 2 + (j % 2 ? -0.5 : 0.5), len: seg, width: 2.6 * k, color: SAILS.ochre[(rng() * 3) | 0], alpha: 0.8 });
          y += seg * 0.85;
        }
      }
    }
    if (b.hull.red) {
      const x1 = X(10.4) - (X(b.x) - ox);
      for (let y = 1; y < Y(5); y += 2.4 * k) {
        for (let x = 0; x < x1;) {
          const len = (12 + rng() * 26) * k;
          wetStroke(rg, rng, { x, y, angle: (rng() - 0.5) * 0.06, len, width: 3.6 * k, color: RED[(rng() * 4) | 0], alpha: 0.85 * (1 - y / Y(5)) });
          x += len * (0.8 + rng() * 0.6);
        }
      }
    }
    rg.setTransform(1, 0, 0, 1, 0, 0);
    return paintReflection(r, rng, { paintStroke: wetStroke }, { fade, scale: s, k, stretch: 0.12, gaps: 0.85, darken: 0.72, deep: REFL_DARK });
  }

  // ---------- the water ----------
  // Lavender-grey and soft blue in level strokes, longer and broader toward
  // us, paler under the horizon where it mirrors the sky; over it the
  // reflections, moving with the swell; over those a scatter of still pale
  // ripples, and highlights that catch the light as the swell passes.
  function* buildWater() {
    // the still reflections and the water's shader don't need the water: the
    // worker and the browser start on them now, while it's painted here
    const still = bakeStill();
    if (waterGL === undefined) waterGL = createWaterGL();
    waterTop = Math.floor(horizonY - 1);
    const [c, g] = offscreen(W * dpr, (CH - waterTop) * dpr);
    g.scale(dpr, dpr);
    g.translate(0, -waterTop);
    const rng = mulberry32(1867);

    // the water, ending raggedly in the dissolve
    const ground = new Path2D();
    ground.moveTo(-10, horizonY);
    for (let x = -10; x <= W + 10; x += 6) ground.lineTo(x, horizonY);
    for (let x = W + 10; x >= -10; x -= 6) ground.lineTo(x, groundEnd(x));
    ground.closePath();
    const grad = g.createLinearGradient(0, horizonY, 0, H);
    grad.addColorStop(0, rgb(C('#BDBDD4')));
    grad.addColorStop(0.35, rgb(C('#A2A6C6')));
    grad.addColorStop(1, rgb(C('#9096BA')));
    g.fillStyle = grad;
    g.fill(ground);
    // and fading out below the fold, so the strokes alone make its edge
    const fadeOut = g.createLinearGradient(0, H, 0, H + (CH - H) * 0.2);
    fadeOut.addColorStop(0, 'rgba(0,0,0,0)');
    fadeOut.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = fadeOut;
    g.fillRect(-10, H, W + 20, CH - H);
    g.globalCompositeOperation = 'source-over';
    yield;

    // level strokes, row by row from the horizon down
    let work = 0;
    for (let y = horizonY + 0.5; y < CH - 4;) {
      const t = depth(y), rh = k * (1.6 + 15 * Math.pow(t, 1.2)), len0 = k * (18 + 150 * t);
      for (let x = -10 + rng() * len0; x < W + 10;) {
        if (++work % 8 === 0) yield;
        const len = len0 * (0.6 + rng() * 0.8);
        x += (len * (0.55 + rng() * 0.45)) / Math.sqrt(density);
        const yy = y + (rng() - 0.5) * rh * 0.4;
        if (yy + rh * 0.6 > CH - 4) continue; // never cut off by the canvas's bottom edge
        const stray = rng() < 0.01 && intoDissolve(x, yy) < 0.8;
        if (rng() > paintDensity(x, yy) && !stray) continue;
        const xp = (x / W) * 100;
        const pale = xp > 52 && t < 0.12 ? 0.6 : xp > 52 ? 0.15 : 0.05;
        const color = rng() < pale ? PALE[(rng() * 4) | 0] : xp < 50 && rng() < 0.75 - t * 0.4 ? WATER_LEFT[(rng() * 5) | 0] : WATER[(rng() * 5) | 0];
        wetStroke(g, rng, {
          x: x - len / 2, y: yy, angle: (rng() - 0.5) * 0.03, len, width: rh * (0.9 + rng() * 0.5),
          color, alpha: 0.85, bend: (rng() - 0.5) * 0.08,
        });
      }
      y += (rh * 0.55) / Math.sqrt(density);
    }
    release(waterPaint);
    waterPaint = c;
    waterCache.reset();

    yield* buildRipples(rng);
    yield* still;
    buildGlints(rng);

    // the reflection buffer the boats' reflections are gathered into each
    // frame, and the pass that moves it
    reflH = Math.min(CH - horizonY, horizonY);
    buf.width = Math.max(1, Math.round(W * dpr * REFL_RES));
    buf.height = Math.max(1, Math.round(reflH * dpr * REFL_RES));
    // its shader compiles in the background where the browser can: wait for it, a frame at a time
    while (waterGL && waterGL.poll() === 'compiling') yield new Promise((resolve) => setTimeout(resolve, 16));
    if (waterGL && waterGL.poll() === 'failed') {
      waterGL.dispose();
      waterGL = null;
    }
    for (const c of [boatBuf, litBuf]) {
      c.width = buf.width;
      c.height = buf.height;
    }
    drawnAt = -Infinity;
    // the relit layers filled now, a step each, rather than all in the first frame
    const key = relightKey();
    for (const [cache, img] of [[waterCache, waterPaint], [rippleCache, ripplePaint]]) {
      cache.get(key, img.width, img.height);
      yield;
    }
  }

  // pale ripples: short level dashes, denser on the open water to the right,
  // laid over the reflections and still
  function* buildRipples(rng) {
    const [c, g] = offscreen(W * dpr, (CH - waterTop) * dpr);
    g.scale(dpr, dpr);
    g.translate(0, -waterTop);
    const nRip = Math.round(((W * (H - horizonY)) / (2600 * k * k)) * density);
    for (let i = 0; i < nRip; i++) {
      if (i % 40 === 39) yield;
      const x = rng() * W, y = horizonY + Math.pow(rng(), 1.3) * (CH - horizonY), t = depth(y);
      if (y > CH - 8 || rng() > paintDensity(x, y)) continue;
      if (x < X(50) && rng() < 0.45) continue;
      const len = k * (16 + 120 * t) * (0.5 + rng());
      wetStroke(g, rng, {
        x: x - len / 2, y, angle: (rng() - 0.5) * 0.03, len, width: k * (1.6 + 7 * t) * (0.6 + rng() * 0.6),
        color: PALE[(rng() * 4) | 0], alpha: 0.3 + rng() * 0.35,
      });
    }
    release(ripplePaint);
    ripplePaint = c;
    rippleCache.reset();
  }

  // the still reflections, baked away from the page where it can be
  // (bakeReflections, above), on the page otherwise: the bake starts when
  // this is called, and its steps wait for it and keep what it made
  function bakeStill() {
    const args = { W, H, CH, dpr, horizonY, harborTop, k }, box = {};
    const job = bitmaps(skyPaint, harborPaint, goldPaint)
      .then(([sky, harbor, gold]) => bake(import.meta.url, 'bakeReflections', { ...args, sky, harbor, gold }, [sky, harbor, gold]))
      .then((out) => (box.out = out), () => {});
    return keepStill(job, box, args);
  }
  function* keepStill(job, box, args) {
    yield job;
    const out = box.out || (yield* bakeReflections({ ...args, sky: skyPaint, harbor: harborPaint, gold: goldPaint }));
    [stillRefl, goldRefl].forEach(free);
    stillRefl = out.still;
    goldRefl = out.gold;
    baked = box.out ? 'worker' : 'page';
  }

  // the highlights: short pale level strokes, each painted once, that catch
  // the light as the swell tilts the water toward us, slide a little, and
  // lengthen and shorten
  function buildGlints(rng) {
    glintStamps.forEach(release);
    glintStamps = [];
    for (let i = 0; i < 4; i++) {
      const len = 48, w = 5, pad = 3;
      const [c, g] = offscreen((len + pad * 2) * dpr, (w * 2 + pad * 2) * dpr);
      g.scale(dpr, dpr);
      wetStroke(g, rng, { x: pad, y: w + pad, angle: 0, len, width: w, color: i < 2 ? [246, 248, 255] : [222, 226, 244], bristles: 3 });
      glintStamps.push(c);
    }
    glints = [];
    for (let i = 0, n = Math.round((W / (8 * k)) * Math.sqrt(density)); i < n; i++) {
      // mostly on the open water, away from the boats
      const x = rng() < 0.75 ? X(48) + rng() * X(52) : rng() * X(48);
      const y = horizonY + Y(0.6) + Math.pow(rng(), 1.5) * (H * 0.97 - horizonY - Y(0.6));
      glints.push({ x, y, len: 0.5 + rng() * 0.9, ph: rng() * TAU, ph2: rng() * TAU, sp: 0.6 + rng() * 0.8, stamp: (rng() * 4) | 0 });
    }
  }

  // ---------- the boats on the swell ----------
  // Every boat rides the same swell (engine/water.js), sampled where it
  // floats, so a wave crossing the harbour lifts them one after another: each
  // heaves and rolls about its waterline (its masts swing wide while its hull
  // hardly moves). The moored boats, tied up, move less, and each partly with
  // its neighbours, so their overlapping hulls stay together. The cutter heels
  // further in the gusts, its sails fill a little, and it drifts to and fro
  // over a couple of minutes; the distant boats drift very slowly. Worked out
  // once per step of the clock, from the clock alone, so a boat is wherever
  // the time says (the same in its reflection, and in a painting run ahead
  // before it's shown).
  let posesAt = NaN;
  const plane = [0, 0], sw = [0, 0, 0];
  function updatePoses() {
    if (posesAt === state.time) return;
    posesAt = state.time;
    const motion = state.motion, t = motion ? state.time / 1000 : 0, chop = chopFor(motion ? wind.gust : 1);
    const unit = H - horizonY, view = { W, horizonY, unit }, gust = motion ? (wind.gust - 1) / 0.8 : 0, lee = wind.dir[0] < 0 ? -1 : 1;
    for (const b of boats) {
      planeAt(b.x, b.y, view, plane);
      swellAt(plane[0], plane[1], t, chop, Infinity, sw); // every wave, however fine it looks from here
      b.raw[0] = -(sw[0] / 0.12) * b.heave; // the water rises, the boat rises (up is -y)
      b.raw[1] = (sw[1] * 0.07 + sw[2] * 0.03) * b.rollGain;
    }
    moored.forEach((b, i) => {
      const n = [moored[i - 1], moored[i + 1]].filter(Boolean);
      for (let j = 0; j < 2; j++) {
        const theirs = n.reduce((sum, o) => sum + o.raw[j], 0) / n.length;
        b.raw[j] = 0.55 * b.raw[j] + 0.45 * theirs;
      }
    });
    boats.forEach((b, i) => {
      const p = b.pose;
      p.dy = b.raw[0];
      p.roll = b.raw[1];
      p.dx = 0;
      p.skew = 0;
      if (b.def.sailing) {
        p.roll += lee * (0.012 + 0.03 * gust); // heeled by the wind, a little further in a gust
        p.skew = -lee * 0.012 * gust; // its sails filling: their heads lean downwind
        p.dx = motion ? X(2.2) * Math.sin((TAU * t) / 150 + 0.6) : 0;
      } else if (DISTANT.includes(b.def)) {
        p.dx = motion ? X(0.6) * Math.sin((TAU * t) / 230 + i * 1.7) : 0;
      }
    });
  }
  const poseOf = (b) => (updatePoses(), b.pose);

  // a pose as a transform at (x, y) device px, `s` device px per CSS px:
  // rolled about the waterline point, then the sails' lean; mirrored for a
  // reflection (it rolls and leans the other way)
  function poseMatrix(g, p, s, x, y, mirror = false) {
    const roll = mirror ? -p.roll : p.roll, kx = mirror ? -p.skew : p.skew, c = Math.cos(roll), sn = Math.sin(roll);
    g.setTransform(c * s, sn * s, (c * kx - sn) * s, (sn * kx + c) * s, x, y);
  }

  // a point of a boat (CSS px) where its pose puts it, or its reflection
  function posed(b, x, y, mirror = false) {
    const p = poseOf(b), u = x - b.x, v = mirror ? b.y - y : y - b.y;
    const roll = mirror ? -p.roll : p.roll, kx = mirror ? -p.skew : p.skew, c = Math.cos(roll), sn = Math.sin(roll);
    return [b.x + p.dx + c * u + (c * kx - sn) * v, (mirror ? b.y - p.dy : b.y + p.dy) + sn * u + (sn * kx + c) * v];
  }

  // The reflection buffer, gathered in daylight colours (the hour's light
  // goes on in the distortion pass, every frame, so it changes as smoothly as
  // the rest of the painting; nothing here is relit): the still reflections,
  // the gold's at the hour's strength, and each boat's reflection where its
  // boat is now, mirrored (it rises, its reflection sinks; it rolls one way,
  // its reflection the other). The boats' reflections are gathered on their
  // own first, to darken with the boats at night.
  function composeBuffer() {
    const s = dpr * REFL_RES, light = state.light, bg = boatBufCtx;
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.clearRect(0, 0, boatBuf.width, boatBuf.height);
    bg.globalAlpha = 0.92;
    for (const b of boats) {
      const p = poseOf(b);
      poseMatrix(bg, p, s, (b.x + p.dx) * s, (b.y - p.dy - horizonY) * s, true);
      bg.drawImage(b.refl, -b.ox, 0, b.refl.width / s, b.refl.height / s);
    }
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.globalAlpha = 1;
    if (light.dark > 0.01) {
      // as boatLight darkens the boats
      bg.globalCompositeOperation = 'source-atop';
      bg.fillStyle = `rgba(0,0,0,${0.45 * light.dark})`;
      bg.fillRect(0, 0, boatBuf.width, boatBuf.height);
      bg.globalCompositeOperation = 'source-over';
    }
    const g = bufCtx;
    g.globalCompositeOperation = 'copy';
    g.drawImage(stillRefl, 0, 0, buf.width, buf.height);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(cloudReflection(), 0, 0, buf.width, buf.height);
    const a = light.gold * (1 - light.dark) * 0.75;
    if (a > 0.01) {
      g.globalAlpha = Math.min(1, a);
      g.drawImage(goldRefl, 0, 0, buf.width, buf.height);
      g.globalAlpha = 1;
    }
    g.drawImage(boatBuf, 0, 0);
  }

  // The drifting clouds, mirrored, at a quarter of the screen's resolution
  // and redrawn at most 15 times a second (the water's movement hides it):
  // faint, as the sky's own reflection is, and fading with distance.
  const [cloudBuf, cloudCtx] = offscreen(1, 1);
  let cloudsAt = -Infinity;
  function cloudReflection() {
    if (state.motion && Math.abs(state.time - cloudsAt) < 1000 / 15 - 1) return cloudBuf;
    cloudsAt = state.time;
    const q = dpr * 0.25, w = Math.max(1, Math.round(W * q)), h = Math.max(1, Math.round(reflH * q)), g = cloudCtx;
    if (cloudBuf.width !== w || cloudBuf.height !== h) {
      cloudBuf.width = w;
      cloudBuf.height = h;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(q, 0, 0, q, 0, 0);
    for (const s of drift) {
      const a = driftAlpha(s) * 0.3, y = horizonY - s.y; // as far below the horizon as it is above
      if (a < 0.01 || y > reflH) continue;
      const c = driftStamps[s.stamp], sw2 = (c.width / dpr) * s.scale, sh = (c.height / dpr) * s.scale;
      g.globalAlpha = a;
      g.drawImage(c, s.x - sw2 / 2, y - sh / 2, sw2, sh * 1.3);
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const fade = g.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    return cloudBuf;
  }

  // by night (0 – 1), and each lamp's own slow flicker
  const night = () => smooth(0.35, 0.85, state.light.dark);
  const flicker = (i, t) => 0.88 + 0.07 * Math.sin(t * 7.3 + i * 2.1) + 0.05 * Math.sin(t * 13.1 + i);

  // the distortion's settings for this frame
  const pale = [0, 0, 0];
  function sway(t) {
    const light = state.light, dark = light.dark, q = state.quality;
    // the glints: pale sky by day, a dim silver by night, in the hour's tint
    for (let i = 0; i < 3; i++) pale[i] = lerp(0.88 * (light.tint[i] / 255), 0.5, dark) * (i === 2 ? 1 : 0.97);
    // by night the lamps' and the window's long streaks, and the moon's path
    const nt = night();
    lights.fill(0);
    if (nt > 0.01) {
      lamps.forEach((l, i) => {
        const [x] = posed(l.b, X(l.x), Y(l.y), true), p = poseOf(l.b);
        lights.set([x, l.b.y - p.dy - horizonY, nt * flicker(i, t), (1.6 + 1.6 * l.b.def.depth) * k], i * 4);
      });
      lights.set([X(WINDOW.x), Y(QUAY_WL) - horizonY, nt * 0.7, 2.4 * k], 12);
    }
    moonPath[0] = moon.x;
    moonPath[1] = X(3.5);
    moonPath[2] = smooth(0.3, 0.9, dark) * (0.35 + 0.65 * gapAt(moon.x, moon.y)) * 0.55;
    return {
      t, chop: chopFor(state.motion ? wind.gust : 1), W, H: reflH, unit: H - horizonY, light,
      amp: SWAY.map((v) => v * k), detail: q < 0.6 ? 0 : 1, glint: 0.38 * (1 - 0.5 * dark), pale, top: horizonY,
      lights, moon: moonPath,
    };
  }
  const lights = new Float32Array(16), moonPath = [0, 0, 0];

  // Each frame: the buffer gathered and moved in one pass (WebGL; or level
  // strips with Canvas 2D). Under strain they update at 30 fps, then lose
  // their fine wobble; they're never dropped.
  function drawReflections() {
    const t = state.motion ? state.time / 1000 : 0, q = state.quality;
    if (waterGL && waterGL.lost) waterGL = null; // the 2D way from here on
    const p = sway(t);
    const every = q < 0.85 ? 1000 / 30 : 0;
    if (!state.motion || state.time - drawnAt >= every - 1 || state.time < drawnAt) {
      composeBuffer();
      if (waterGL) {
        const r = q < 0.6 ? 0.7 : 1;
        waterGL.size(buf.width * r, buf.height * r);
        waterGL.draw(buf, p);
      } else relight(litBufCtx, buf, state.light); // without WebGL, the light goes on here

      drawnAt = state.time;
      updates++;
    }
    if (waterGL) ctx.drawImage(waterGL.canvas, 0, horizonY, W, reflH);
    else {
      drawStrips(ctx, litBuf, p);
      drawStreaks2D(p);
    }
  }

  // without WebGL, the night's streaks as stacked soft glows, swaying
  function drawStreaks2D(p) {
    const lamp = glowSprite.lamp;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const [x, row, a, w] = p.lights.subarray(i * 4, i * 4 + 4);
      if (a <= 0) continue;
      for (let y = row; y < row + reflH * 0.4; y += 4 * k) {
        const f = Math.exp(-(y - row) / (reflH * 0.3)), dx = Math.sin(p.t * 1.7 + y * 0.09) * w;
        ctx.globalAlpha = a * f * 0.35;
        ctx.drawImage(lamp, x + dx - w * 2, horizonY + y - w, w * 4, w * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawGlints() {
    const light = state.light, dark = light.dark, motion = state.motion, t = motion ? state.time / 1000 : 0;
    const chop = chopFor(motion ? wind.gust : 1), unit = H - horizonY, view = { W, horizonY, unit };
    const base = ((1 - dark) * 0.5 + dark * 0.1) * (0.6 + (0.4 * Math.min(light.tint[0], light.tint[2])) / 255);
    const n = Math.round(glints.length * clamp(state.quality, 0.5, 1));
    for (let i = 0; i < n; i++) {
      const gl = glints[i], d = depth(gl.y);
      planeAt(gl.x, gl.y, view, plane);
      swellAt(plane[0], plane[1], t, chop, unit, sw);
      // bright where the swell tilts the water toward us, flickering on its own phase too
      const a = base * smooth(0.05, 0.6, sw[2] * 2.2 + 0.25 * Math.sin(t * 0.9 * gl.sp + gl.ph));
      if (a < 0.02) continue;
      const len = gl.len * k * (14 + 40 * d) * (motion ? 0.75 + 0.25 * Math.sin(t * 1.3 * gl.sp + gl.ph2) : 1);
      const slide = (motion ? Math.sin(t * 0.7 * gl.sp + gl.ph2) * (2 + 5 * d) * k : 0) + sw[1] * SWAY[0] * k * (0.15 + 0.85 * d);
      const h = Math.max(1.2, k * (1 + 2.2 * d));
      ctx.globalAlpha = a;
      ctx.drawImage(glintStamps[gl.stamp], gl.x + slide - len / 2, gl.y - h, len, h * 2);
    }
    // the brighter stars, faintly, where the water is calm (and the sky clear above)
    if (dark > 0.4) {
      for (const s of stars.list()) {
        if (s.b < 0.6 || s.x < X(48)) continue;
        const y = horizonY + (horizonY - s.y) * 0.85;
        if (y > H * 0.97) continue;
        planeAt(s.x, y, view, plane);
        swellAt(plane[0], plane[1], t, chop, unit, sw);
        const calm = 1 - smooth(0.08, 0.3, Math.abs(sw[1]) + Math.abs(sw[2]));
        const a = dark * s.b * calm * gapAt(s.x, s.y) * 0.45;
        if (a < 0.03) continue;
        const len = (2 + s.r * 3) * (1 + depth(y)), wob = sw[1] * SWAY[0] * k;
        ctx.globalAlpha = a;
        ctx.drawImage(glintStamps[0], s.x + wob - len / 2, y - 1, len, 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  // the water and all on it, timed together
  function drawWater() {
    const t0 = performance.now(), key = relightKey();
    ctx.drawImage(waterCache.get(key, waterPaint.width, waterPaint.height), 0, waterTop, W, CH - waterTop);
    if (reflectionsOn) drawReflections();
    ctx.drawImage(rippleCache.get(key, ripplePaint.width, ripplePaint.height), 0, waterTop, W, CH - waterTop);
    if (reflectionsOn) drawGlints();
    waterMs[waterN++ % waterMs.length] = performance.now() - t0;
  }

  function drawHarbor() {
    ctx.drawImage(harborCache.get(relightKey(), harborPaint.width, harborPaint.height), 0, harborTop, W, harborPaint.height / dpr);
    const nt = night();
    if (nt > 0.01) {
      // the lit window: a warm dab and its glow
      const x = X(WINDOW.x), y = Y(WINDOW.y), r = Math.max(3, Y(0.9));
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = nt * 0.8;
      ctx.drawImage(glowSprite.lamp, x - r * 3, y - r * 3, r * 6, r * 6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = nt;
      ctx.fillStyle = 'rgb(255,214,150)';
      ctx.fillRect(x - r * 0.35, y - r * 0.6, r * 0.7, r * 1.2);
      ctx.globalAlpha = 1;
    }
  }

  function drawBoats() {
    const key = relightKey(), motion = state.motion, t = motion ? state.time / 1000 : 0;
    const gust = motion ? (wind.gust - 1) / 0.8 : 0, nt = night();
    for (const b of boats) {
      const img = b.lit.get(key, b.sprite.width, b.sprite.height), p = poseOf(b);
      poseMatrix(ctx, p, dpr, (b.x + p.dx) * dpr, (b.y + p.dy) * dpr);
      ctx.drawImage(img, -b.ox, -b.oy, b.w, b.h);
      if (b.pennant) {
        // streaming downwind from the masthead, fluttering, longer in a gust
        const pn = b.pennant, dir = wind.dir[0] < 0 ? -1 : 1;
        const stretch = 0.85 + 0.15 * gust + (motion ? 0.05 * Math.sin(t * 11) : 0), wave = motion ? Math.sin(t * 8.5) * 0.12 * (0.5 + gust) : 0;
        ctx.transform(dir * stretch, wave, 0, 1, pn.x - b.x, pn.y - b.y);
        ctx.drawImage(pn.lit.get(key, pn.canvas.width, pn.canvas.height), -pn.pad, -pn.h / 2, pn.w, pn.h);
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the lanterns, swaying with their boats
    if (nt > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      lamps.forEach((l, i) => {
        const [x, y] = posed(l.b, X(l.x), Y(l.y)), r = Math.max(3, Y(0.7)) * (0.7 + 0.5 * l.b.def.depth), a = nt * flicker(i, t);
        ctx.globalAlpha = a * 0.9;
        ctx.drawImage(glowSprite.lamp, x - r * 4, y - r * 4, r * 8, r * 8);
        ctx.globalAlpha = a;
        ctx.drawImage(glowSprite.lamp, x - r, y - r, r * 2, r * 2);
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  function disposeBoats() {
    for (const b of boats) {
      [b.sprite, b.refl, b.pennant?.canvas].forEach(release);
      b.pennant?.lit.release();
      b.lit.release();
    }
    boats = [];
  }

  // ---------- the layers ----------

  const relightKey = () => lightKey(state.light, ['tint', 'desat', 'wash', 'dark']);
  const free = (img) => (img && img.close ? img.close() : release(img));
  const harborCache = keyedCache((g) => relight(g, harborPaint, state.light));
  const waterCache = keyedCache((g) => relight(g, waterPaint, state.light));
  const rippleCache = keyedCache((g) => relight(g, ripplePaint, state.light));
  let ripplePaint = null, stillRefl = null, goldRefl = null, glints = [], glintStamps = [], reflH = 0, baked = null;
  const [buf, bufCtx] = offscreen(1, 1), [boatBuf, boatBufCtx] = offscreen(1, 1), [litBuf, litBufCtx] = offscreen(1, 1);
  let waterGL, drawnAt = -Infinity, updates = 0;
  let reflectionsOn = true;
  const waterMs = new Float32Array(600);
  let waterN = 0;

  if (DEV && typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'r' || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      reflectionsOn = !reflectionsOn;
      waterN = 0; // measured afresh
      console.info(`[harbor] reflections ${reflectionsOn ? 'on' : 'off'}`);
    }, { signal: engine.signal });
  }

  const layers = [
    {
      id: 'sky', kind: 'animated', z: 0,
      *build(s) {
        measure(s);
        yield* buildSky();
      },
      frame: updateDrift,
      render: drawSky,
    },
    maskedStars,
    stars.shootingLayer(3),
    { id: 'harbor', kind: 'animated', z: 5, build: buildHarbor, render: drawHarbor },
    // the boats are painted before the water (its reflections need theirs)
    { id: 'boats', kind: 'animated', z: 7, build: buildBoats, render: drawBoats },
    // and the water after the harbour (it reflects it), but drawn under it
    { id: 'water', kind: 'animated', z: 4, build: buildWater, render: drawWater },
  ];

  // the cutter's sails, for the hero text to keep clear of
  const cutterTop = () => {
    const xs = SAILING.sails.flatMap((s) => s.pts.map((p) => p[0])), ys = SAILING.sails.flatMap((s) => s.pts.map((p) => p[1]));
    return [X(Math.min(...xs)), X(Math.max(...xs)), Y(Math.min(...ys))];
  };

  // the water's cost per frame (ms): average, 95th percentile and worst of the last 600 frames
  function waterStats() {
    const n = Math.min(waterN, waterMs.length), v = Array.from(waterMs.subarray(0, n)).sort((a, b) => a - b);
    const r = (x) => +x.toFixed(3);
    return {
      mode: waterGL ? 'webgl' : '2d', reflections: reflectionsOn, baked,
      ms: n ? r(v.reduce((a, b) => a + b, 0) / n) : 0, p95: n ? r(v[Math.floor(n * 0.95)]) : 0, max: n ? r(v[n - 1]) : 0,
      gpu: waterGL ? waterGL.gpuMs() : null, buffer: [buf.width, buf.height], pass: waterGL ? [waterGL.canvas.width, waterGL.canvas.height] : null, updates,
    };
  }

  return {
    layers,
    interactions: {
      hint: { day: 'slide toward evening for the gold', night: 'brush your {pointer} across the stars ✦' },
      onTap(x, y) {
        if (state.light.dark > 0.5 && y < horizonY) stars.launch(x, y, wind);
      },
    },
    obstacles() {
      if (!W) return null;
      return { orbs: [], skyline: [cutterTop()], horizonY };
    },
    // where each moving thing is, for checking that nothing jumps: each boat
    // ([id, x, y, roll] and where its reflection is drawn, [x, y, roll]:
    // mirrored, it sinks as the boat rises), the drifting cloud patches
    // [id, x, y, alpha], and how far (ms of its clock) the reflections trail
    // the boats (0: drawn from the same moment)
    trace: () => ({
      boats: boats.map((b) => {
        const p = poseOf(b);
        return [b.def.id, b.x + p.dx, b.y + p.dy, p.roll, b.x + p.dx, b.y - p.dy, -p.roll];
      }),
      drift: drift.map((d) => [traceId(d), d.x, d.y, driftAlpha(d)]),
      reflectionLag: Number.isFinite(drawnAt) ? state.time - drawnAt : null,
    }),
    stats: () => ({ boats: boats.length, water: waterStats() }),
    dispose() {
      stars.dispose();
      disposeBoats();
      [skyPaint, goldPaint, harborPaint, waterPaint, ripplePaint, buf, boatBuf, litBuf, cloudBuf, skyBuf, moonBuf, starBuf, gapMask, gapSoft, silverPaint, moonSprite, ...glintStamps, ...driftStamps].forEach(release);
      [stillRefl, goldRefl].forEach(free);
      [harborCache, waterCache, rippleCache].forEach((c) => c.release());
      waterGL?.dispose();
      skyPaint = goldPaint = harborPaint = waterPaint = ripplePaint = stillRefl = goldRefl = waterGL = null;
      glints = glintStamps = drift = driftStamps = moored = lamps = [];
    },
  };
}
