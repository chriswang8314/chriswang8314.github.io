/*
 * After Claude Monet, "Tulip Fields near The Hague" (1886): striped bulb
 * fields running to a low horizon, a canal widening toward us on the right,
 * two windmills on the left and a high, chalky spring sky.
 *
 * Monet, not Van Gogh: every mark is a short, broken dab from the DAB brush
 * (dry-brush breaks, feathered edges), colours sit side by side unmixed, and
 * there are no outlines anywhere, the windmills included. Contrast is kept
 * low, especially in the sky.
 *
 * The painting is laid out from measurements of the original (positions are
 * % of the viewport; sizes of the mills and dabs follow the screen height).
 * Everything is painted once in daylight colours; each hour's light is then
 * laid over it (engine/light.js), so the slider never has to repaint.
 */
import { TAU, clamp, lerp, mixRGB, rgb, hex, smooth, mulberry32, offscreen, release } from '../engine/util.js';
import { noise2, fbm } from '../engine/noise.js';
import { createBrush, createAtlas, DAB } from '../engine/brush.js';
import { keyedCache } from '../engine/compositor.js';
import { relight, lightKey } from '../engine/light.js';
import { SUNRISE, SUNSET } from '../engine/time.js';

// ---------- palettes for the hour ----------
// skyTop/skyMid/skyLow multiply the painted sky (white = as painted); tint,
// desat and wash relight the land, mills and flowers (see engine/light.js);
// sun is the sun's colour; dark drives the stars, moon and the page theme.
const NIGHT = {
  skyTop: [30, 36, 80], skyMid: [38, 46, 98], skyLow: [52, 62, 126],
  tint: [92, 98, 162], desat: 0.36, wash: [30, 36, 84, 0.3], sun: [255, 244, 220], dark: 1,
};
const DAY = {
  skyTop: [255, 255, 255], skyMid: [255, 255, 255], skyLow: [255, 255, 255],
  tint: [255, 255, 255], desat: 0, wash: [30, 36, 84, 0], sun: [255, 253, 244], dark: 0,
};
const PALETTES = {
  night: [{ h: 0, ...NIGHT }, { h: 4.6, ...NIGHT }, { h: 21.6, ...NIGHT }, { h: 24, ...NIGHT }],
  dawn: [
    { h: 5.6, skyTop: [112, 112, 162], skyMid: [176, 160, 194], skyLow: [242, 186, 180], tint: [196, 176, 196], desat: 0.2, wash: [60, 50, 100, 0.12], sun: [255, 196, 160], dark: 0.45 },
    { h: 6.8, skyTop: [222, 226, 246], skyMid: [248, 236, 238], skyLow: [255, 222, 206], tint: [246, 230, 224], desat: 0.04, wash: [30, 36, 84, 0], sun: [255, 230, 200], dark: 0.02 },
  ],
  day: [
    { h: 9, ...DAY, skyTop: [246, 250, 255], skyLow: [255, 252, 250] },
    { h: 13, ...DAY }, // the painting
    { h: 16.5, ...DAY, tint: [255, 250, 240], skyLow: [255, 248, 238], sun: [255, 248, 228] },
  ],
  golden: { h: 18.6, ...DAY, skyTop: [242, 238, 244], skyMid: [255, 240, 228], skyLow: [255, 220, 188], tint: [255, 232, 202], sun: [255, 214, 150] },
  dusk: [
    { h: 19.8, skyTop: [150, 148, 196], skyMid: [218, 178, 190], skyLow: [250, 176, 146], tint: [214, 172, 170], desat: 0.1, wash: [60, 40, 90, 0.06], sun: [255, 160, 110], dark: 0.2 },
    { h: 20.8, skyTop: [58, 60, 116], skyMid: [88, 80, 134], skyLow: [148, 108, 138], tint: [132, 122, 168], desat: 0.3, wash: [30, 36, 84, 0.16], sun: [255, 150, 110], dark: 0.72 },
  ],
};

// ---------- the painting's colours (sampled from the original, then
// brought up to Monet's unmixed brightness) ----------
const C = (s) => hex(s);
const SKY = {
  base: [[0, C('#B2D1E3')], [0.35, C('#CDE3EC')], [0.75, C('#E0ECEE')], [1, C('#ECE4E6')]],
  offWhite: C('#F4F3EC'), chalk: C('#E9F1F0'), cerulean: C('#BCDBE9'), deepCerulean: C('#A4C9E0'),
  lilac: C('#D6CDE4'), peach: C('#F1DCD3'), pink: C('#ECD0D6'), ray: C('#FFFDF4'),
  hills: [C('#6F7FB0'), C('#7F8DBE'), C('#5C6CA0'), C('#8E98C6')], haze: C('#B7BFDA'),
};
const MILL = {
  body: [C('#3D3A7A'), C('#4B4C8F'), C('#2E2C5E')], shadow: [C('#232248'), C('#2E2C5E')],
  skirt: [C('#9C6A44'), C('#B07A4C'), C('#7E5640'), C('#C08A5A'), C('#6B4A3E')], cap: [C('#2E2C5E'), C('#3D3A7A'), C('#26244F')],
  sail: [C('#2E2C5E'), C('#3D3A7A'), C('#4B4C8F')], haze: C('#93A0C8'),
};
const SAIL = C('#A4553A');
const FIGURE = [C('#2A2840'), C('#3A3555'), C('#4A3F4F')];

// colour lists, each [colour, weight]
const BAND_PAINT = {
  far: [['#7FAE5E', 3], ['#9CBF6A', 2], ['#EAD873', 2], ['#F2EFD8', 2], ['#D9583F', 1.2], ['#C8C6DC', 1.6]],
  farRight: [['#D9483A', 3], ['#E0623F', 2], ['#EFD25E', 3], ['#F2E9C0', 1]],
  bank: [['#4E8A4F', 3], ['#3F7A45', 2], ['#6DA060', 2], ['#2F6A3E', 1]],
  water: [['#6F8FC9', 4], ['#8FA6D9', 3], ['#A9A6D6', 1.6], ['#5F7DB8', 1.2], ['#B9C6E6', 0.6]],
  meadow: [['#6E9A4A', 3], ['#87A853', 3], ['#A6A24A', 2], ['#4E7A3C', 1.5], ['#D8C463', 1.4], ['#9A97B8', 0.8], ['#E8DC8A', 0.6], ['#3E6A48', 0.8]],
  path: [['#E2C6B6', 3], ['#D8B5A5', 3], ['#EBD9CC', 2], ['#C9A99F', 1], ['#B89AA8', 1.2], ['#9DB27A', 0.6], ['#F1E4D6', 0.8]],
  bankYellow: [['#F2E06A', 3], ['#EEE68E', 3], ['#E6D34F', 2], ['#F5F0C8', 1.5], ['#8DB85A', 1]],
  creamFar: [['#F4E9A8', 3], ['#F1EFD9', 2.6], ['#EAD36A', 2.4], ['#9BBF6A', 1.2], ['#E8798A', 0.5], ['#E0623F', 0.4]],
  red: [['#E0533A', 3], ['#E8705A', 2], ['#D63A2B', 2], ['#EF8C78', 2], ['#F09AA0', 1], ['#F2E4C8', 0.6]],
  green: [['#5E9B4C', 3], ['#4E8A45', 2], ['#7DB25E', 2], ['#3F7A3D', 1], ['#E9E29A', 1]],
  mid: [['#F3EDC8', 3], ['#F7F4E8', 2.6], ['#F0E58E', 2.5], ['#E9D45C', 1], ['#6DB25A', 1.4], ['#4E9A4A', 1.1], ['#E8798A', 0.5], ['#A9C7E0', 0.3]],
  grass: [['#6E9A4A', 3], ['#87A853', 3], ['#B3A94F', 2], ['#E7D86A', 1.2], ['#4E7A3C', 1]],
  near: [['#EBD45E', 2], ['#4E9A4A', 2.5], ['#6DB25A', 2], ['#E0472F', 2.2], ['#F1EBC6', 1.2], ['#5B63B0', 0.8], ['#E8798A', 0.8]],
  fore: [['#E0472F', 3.8], ['#D63A2B', 2.8], ['#E8798A', 1.8], ['#F09AA0', 1.3], ['#4E9A4A', 3.4], ['#6DB25A', 2], ['#5B63B0', 2.4], ['#3E6A3A', 1.2], ['#EED35A', 0.9]],
};
const palette = (list) => {
  const colors = list.map(([c]) => C(c)), total = list.reduce((s, [, w]) => s + w, 0);
  const cum = [];
  list.reduce((s, [, w]) => (cum.push((s + w) / total), s + w), 0);
  const mean = [0, 1, 2].map((i) => list.reduce((s, [c, w]) => s + C(c)[i] * w, 0) / total);
  return { colors, mean, pick: (r) => colors[cum.findIndex((c) => r <= c)] ?? colors[colors.length - 1] };
};
const PAINT = Object.fromEntries(Object.entries(BAND_PAINT).map(([k, v]) => [k, palette(v)]));

// ---------- the composition ----------
// The fields as bands, top to bottom. Each band runs down to its `bottom`
// curve ([x %, y %] points); a band is only as deep as its curve is below
// the one above, so bands taper away where their curve dips under it. Their
// edges all lean toward the vanishing area near x ≈ 45% on the horizon.
const HORIZON = 57.5;
const VANISH = [45, HORIZON];
const BANDS = [
  { id: 'far', bottom: [[0, 59.4], [40, 59.6], [46, 59.7], [50, 58.6], [100, 58.4]] },
  { id: 'bank', bottom: [[0, 59.4], [40, 59.6], [46, 59.75], [50, 60.0], [70, 60.3], [100, 60.8]] },
  { id: 'water', bottom: [[0, 59.4], [40, 59.6], [46, 59.8], [50, 60.3], [55, 61.3], [60, 62.3], [70, 64.4], [80, 65.8], [90, 67.0], [100, 68.6]] },
  { id: 'meadow', bottom: [[0, 70.2], [12, 67.2], [20, 64.8], [30, 62.5], [38, 60.8], [46, 59.85], [50, 0], [100, 0]] },
  { id: 'path', bottom: [[0, 73.5], [12, 70], [20, 67.2], [30, 64.6], [38, 62.0], [44, 60.6], [48, 0], [100, 0]] },
  { id: 'bankYellow', bottom: [[0, 0], [47, 0], [50, 60.9], [55, 62.0], [60, 63.2], [70, 65.7], [80, 67.5], [90, 69.1], [100, 71.0]] },
  { id: 'creamFar', bottom: [[0, 0], [24, 0], [28, 65.0], [32, 64.0], [40, 63.2], [46, 62.4], [50, 61.8], [54, 0], [100, 0]] },
  { id: 'red', bottom: [[0, 0], [22, 0], [24, 66.4], [32, 66.0], [40, 65.4], [46, 64.6], [50, 63.6], [56, 62.6], [60, 0], [100, 0]] },
  { id: 'green', bottom: [[0, 0], [38, 0], [40, 65.8], [50, 65.2], [60, 65.0], [70, 66.8], [80, 68.2], [100, 71.6]] },
  { id: 'mid', bottom: [[0, 76.5], [10, 74.5], [20, 72.5], [30, 71.2], [40, 70.6], [55, 70.2], [70, 70.8], [85, 72.2], [100, 73.6]] },
  { id: 'near', bottom: [[0, 80], [30, 77.5], [60, 77], [100, 78.5]] },
  { id: 'fore', bottom: null }, // down to the bottom of the canvas
];
const FLOWER_BANDS = new Set(['near', 'fore']); // the foreground: the bottom ~30%

// the mills: hub position (% of W, % of H), size in % of H, and how far into the haze
const MILLS = [
  { id: 'far', x: 7.5, hub: 52.2, base: 59.6, size: 0.5, haze: 0.5, speed: 0.78 }, // turns at its own pace
  { id: 'main', x: 17.6, hub: 48.3, base: 63, size: 1, haze: 0, speed: 1 },
];
const BOATS = [
  { x: 40, y: 59.3, h: 2.9, w: 1.5, color: C('#7A4A48'), reflect: 0.5 },
  { x: 48, y: 59.95, h: 4.5, w: 2.3, color: SAIL, reflect: 1 },
];
const FIGURES = [[22.4, 61.9, 2.2], [23.3, 62.1, 2.0], [26.2, 61.0, 1.7], [32.6, 60.8, 1.4]];
const POSTS = [[11, 64.2, 69.2], [21.2, 60.6, 63.8]];

const DISSOLVE = { depth: 35, contentStart: 26, fade: 0.78, power: 1.4, wander: 0.3, ground: 0.12 };

// linear interpolation through [x %, y %] points, as a function of x %
const curve = (pts) => (xp) => {
  if (xp <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (xp <= x1) {
      const [x0, y0] = pts[i - 1];
      return lerp(y0, y1, (xp - x0) / (x1 - x0));
    }
  }
  return pts[pts.length - 1][1];
};
const BAND_CURVES = BANDS.map((b) => b.bottom && curve(b.bottom));

// the flower strokes' sprites: one colour per row, a few variants each
const FLOWER_HEX = [...new Set([...BAND_PAINT.fore, ...BAND_PAINT.near].map(([c]) => c))];
const FLOWER_COLORS = FLOWER_HEX.map(C);
const flowerIndex = (color) => FLOWER_COLORS.findIndex((c) => c[0] === color[0] && c[1] === color[1] && c[2] === color[2]);
const SPR_LEN = 64, SPR_W = 26, SPR_PAD = 12, SPR_VARIANTS = 3;

export default {
  id: 'tulips',
  title: 'Tulip Fields near The Hague',
  artist: 'Claude Monet',
  year: 1886,
  label: 'Tulip Fields',

  // the hours of its two placeholder stills (scenes/stills/tulips-*.webp)
  placeholder: { day: 13, night: 23 },

  layout: {
    horizonY: HORIZON,
    // the hero text sits in the pale sky, upper left, above the sails
    heroTextRegion: { mode: 'fixed', x: 5, y: 10, maxBottom: 38 },
  },

  palettes: PALETTES,
  brushStyle: DAB,

  contentTheme: {
    day: {
      themeColor: '#7F9AC8',
      vars: {
        '--bg': '#f7f3f6',
        '--card': '#fcfafc',
        '--text': '#2e2f5b',
        '--muted': '#5d5e80',
        '--border': 'rgba(46, 47, 91, 0.14)',
        '--accent': '#d8433a',
        '--link': '#4b6ab3', // the canal blue (#4F6FB8), a shade deeper for 4.5:1 contrast
        '--underline': '#d8433a',
        '--chip-bg': 'rgba(94, 155, 76, 0.13)',
        '--chip-text': '#3d7330',
        '--weave': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='3' height='3'%3E%3Cpath d='M0 .5h3M.5 0v3' stroke='%232e2f5b' stroke-opacity='.04'/%3E%3C/svg%3E")`,
        '--nav-bg': 'rgba(247, 243, 246, 0.8)',
      },
    },
    night: {
      themeColor: '#151936',
      vars: {
        '--bg': '#151936',
        '--card': '#1c2145',
        '--text': '#f3ebd6',
        '--muted': '#b4b2cc',
        '--border': 'rgba(240, 154, 160, 0.18)',
        '--accent': '#f09aa0',
        '--link': '#f09aa0',
        '--underline': '#f09aa0',
        '--chip-bg': 'rgba(240, 154, 160, 0.13)',
        '--chip-text': '#f5b9bd',
        '--weave': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='3' height='3'%3E%3Cpath d='M0 .5h3M.5 0v3' stroke='%23fff' stroke-opacity='.035'/%3E%3C/svg%3E")`,
        '--nav-bg': 'rgba(21, 25, 54, 0.8)',
      },
    },
    // the hero text over the sky: dark ink with a soft light glow while the
    // sky is pale, cream on a soft dark glow once it isn't
    hero: {
      onLight: {
        '--hero-fg': '#2e2f5b',
        '--hero-panel': 'rgba(247, 243, 246, 0.62)',
        '--hero-panel-filter': 'blur(16px)',
        '--hero-shadow': '0 0 10px rgba(255, 255, 255, 0.9), 0 0 2px rgba(255, 255, 255, 0.8)',
        '--hero-ring': 'rgba(46, 47, 91, 0.45)',
        '--hero-ring-hover': 'rgba(46, 47, 91, 0.1)',
        '--resume-bg': '#2e2f5b',
        '--resume-fg': '#f7f3f6',
      },
      onDark: {
        '--hero-fg': '#fff8e7',
        '--hero-panel': 'rgba(21, 25, 54, 0.6)',
        '--hero-panel-filter': 'blur(16px)',
        '--hero-shadow': '0 1px 8px rgba(10, 14, 40, 0.6)',
        '--hero-ring': 'rgba(255, 248, 231, 0.45)',
        '--hero-ring-hover': 'rgba(255, 248, 231, 0.16)',
        '--resume-bg': '#f2e6c9',
        '--resume-fg': '#2b2a3a',
      },
    },
  },

  // which hero text style suits the sky at this hour
  heroTone(light) {
    // the painted sky up top is about 72% luminance; the hour multiplies it
    const lin = (v) => ((v / 255) <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = light.skyTop;
    return 0.72 * (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)) > 0.3 ? 'onLight' : 'onDark';
  },

  dissolve: DISSOLVE,

  description:
    'A painting in the style of Monet’s Tulip Fields near The Hague: stripes of red, yellow and white tulips running to a low horizon under a pale, chalky sky, with two windmills on the left and a blue canal on the right. The light follows the time of day.',

  create,
};

// a lasting number for each object trace() reports
const traceIds = new WeakMap();
let traceN = 0;
const traceId = (o) => traceIds.get(o) ?? (traceIds.set(o, ++traceN), traceN);

function create(engine) {
  const { paintStroke } = createBrush(DAB);
  // the same hand, wetter on the water (fewer dry breaks) and drier for the light
  const { paintStroke: wetStroke } = createBrush({ ...DAB, scumble: 0.08, dryChance: 0.15 });
  const { paintStroke: rays } = createBrush({ ...DAB, scumble: 0.9, dryChance: 0.6, bristleSpacing: 3.2, feather: 1 });
  const { state, ctx, wind, pointer } = engine;
  const stars = engine.createStars({ brush: { paintStroke }, style: 'soft' });

  let W = 0, H = 0, CH = 0, dpr = 1, horizonY = 0, density = 1, k = 1, mu = 1;
  let skyPaint = null, raysPaint = null, landPaint = null, landTop = 0, millPaint = null, millBox = null;
  let sunSprite = null, atlas = null, flowers = [];
  let bounds = null; // per px column: the bottom of each band, in px
  let mills = [];

  const X = (p) => (W * p) / 100;
  const Y = (p) => (H * p) / 100;

  function measure(s) {
    ({ W, H, CH, dpr, horizonY, density } = s);
    k = clamp(Math.min(W * 0.625, H) / 900, 0.55, 1.4); // dab scale
    mu = Math.min(H / 100, (W / 100) * 1.6); // mill scale: px per % of height, narrower on phones
  }

  // ---------- where things are ----------

  function buildBounds() {
    const n = BANDS.length;
    bounds = new Float32Array((Math.ceil(W) + 1) * n);
    for (let x = 0; x <= Math.ceil(W); x++) {
      const xp = (x / W) * 100;
      let prev = horizonY;
      for (let i = 0; i < n; i++) {
        const f = BAND_CURVES[i];
        // the far edge of each band wavers a little, never ruler-straight
        const amp = i <= 2 ? 0.25 : BANDS[i].id === 'meadow' || BANDS[i].id === 'path' ? 1.6 : 0.9;
        const y = f ? Y(f(xp)) + ((noise2(x * 0.012, i * 3.1) - 0.5) * 1.2 + (noise2(x * 0.06, i * 7.7) - 0.5) * 0.6) * Y(amp) : CH + 1;
        prev = Math.max(prev, y);
        bounds[x * n + i] = prev;
      }
    }
  }
  const bandAt = (x, y) => {
    const n = BANDS.length, base = clamp(Math.round(x), 0, Math.ceil(W)) * n;
    for (let i = 0; i < n; i++) if (y < bounds[base + i]) return i;
    return n - 1;
  };
  const bandTop = (x, i) => (i ? bounds[clamp(Math.round(x), 0, Math.ceil(W)) * BANDS.length + i - 1] : horizonY);

  // how near a point is: 0 at the horizon, 1 at the bottom of the hero (and on past it)
  const depth = (y) => Math.max(0, (y - horizonY) / (H - horizonY));
  const dabLen = (t) => k * (3.6 + 27 * Math.pow(t, 1.2) + 16 * Math.max(0, t - 0.55));

  // the canal's edges at x (px)
  const canalTop = (x) => bandTop(x, 2);
  const canalBottom = (x) => bounds[clamp(Math.round(x), 0, Math.ceil(W)) * BANDS.length + 2];

  // the dissolve, as in the wheat: strokes thin out past the fold along a wandering line
  const intoDissolve = (x, y) => (y - H) / (CH - H) + (fbm(x * 0.0035, 7.7) - 0.3) * DISSOLVE.wander;
  const paintDensity = (x, y) => Math.pow(1 - smooth(0, DISSOLVE.fade, intoDissolve(x, y)), DISSOLVE.power);
  const groundEnd = (x) =>
    H + (CH - H) * (DISSOLVE.ground + (fbm(x * 0.004, 3.1) - 0.5) * 0.16 + (noise2(x * 0.05, 9.9) - 0.5) * 0.04);

  // ---------- the sky ----------
  // High-key and chalky: a pale gradient worked over with big soft scumbles,
  // then a dense layer of small broken dabs in off-white, cerulean, lilac
  // and peach, then dry-brushed streaks of light raking down from the upper
  // right. Pink haze gathers just above the horizon.
  function* buildSky() {
    const sh = horizonY + Y(1);
    const [c, g] = offscreen(W * dpr, sh * dpr);
    g.scale(dpr, dpr);
    const rng = mulberry32(1886);
    const grad = g.createLinearGradient(0, 0, 0, sh);
    for (const [at, col] of SKY.base) grad.addColorStop(at, rgb(col));
    g.fillStyle = grad;
    g.fillRect(0, 0, W, sh);

    const RAY = Math.PI * 0.68; // down and to the left
    // broad masses: pale chalky whites in some places, cerulean in others
    const colorAt = (y, r, x = W / 2) => {
      const f = y / horizonY, mass = fbm(x * 0.0022 + 3, y * 0.0045);
      if (mass > 0.56 && rng() < 0.7) return rng() < 0.6 ? SKY.offWhite : SKY.chalk;
      if (mass < 0.42 && rng() < 0.6) return rng() < 0.4 ? SKY.deepCerulean : SKY.cerulean;
      if (r < 0.24) return SKY.offWhite;
      if (r < 0.36) return SKY.chalk;
      if (r < 0.36 + 0.34 * (1 - f * 0.6)) return rng() < 0.35 ? SKY.deepCerulean : SKY.cerulean;
      if (r < 0.84) return rng() < 0.45 ? SKY.lilac : SKY.cerulean;
      return f > 0.55 && rng() < 0.6 ? SKY.pink : SKY.peach;
    };
    const angleFor = (r) => (r < 0.45 ? RAY : r < 0.75 ? RAY - Math.PI / 2 + 0.25 : 0.1) + (rng() - 0.5) * 0.5;

    // big soft scumbles
    const nBig = Math.round(((W * horizonY) / (1300 * k * k)) * density);
    for (let i = 0; i < nBig; i++) {
      if (i % 20 === 19) yield;
      const x = rng() * W, y = rng() * horizonY, len = (80 + rng() * 130) * k;
      const a = angleFor(rng());
      paintStroke(g, rng, {
        x: x - (Math.cos(a) * len) / 2, y: y - (Math.sin(a) * len) / 2, angle: a, len, width: len * (0.24 + rng() * 0.12),
        color: colorAt(y, rng(), x), alpha: 0.2 + rng() * 0.14, bend: (rng() - 0.5) * 0.2,
      });
    }

    // the chalky surface: small broken dabs, side by side and criss-crossing
    // (low contrast: each colour is drawn halfway back toward the chalk white)
    const nSmall = Math.round(((W * horizonY) / (520 * k * k)) * density);
    for (let i = 0; i < nSmall; i++) {
      if (i % 60 === 59) yield;
      const x = rng() * W, y = Math.pow(rng(), 0.9) * horizonY, len = (20 + rng() * 34) * k;
      const a = angleFor(rng());
      paintStroke(g, rng, {
        x: x - (Math.cos(a) * len) / 2, y: y - (Math.sin(a) * len) / 2, angle: a, len, width: len * (0.3 + rng() * 0.16),
        color: mixRGB(colorAt(y, rng(), x), SKY.chalk, 0.2 + rng() * 0.3), alpha: 0.2 + rng() * 0.24, bend: (rng() - 0.5) * 0.3,
      });
    }

    // pink haze over the horizon
    for (let i = 0; i < W / (9 * k); i++) {
      const x = rng() * W, y = horizonY - Y(0.4 + rng() * 4.4), len = (40 + rng() * 80) * k;
      paintStroke(g, rng, {
        x: x - len / 2, y, angle: (rng() - 0.5) * 0.12, len, width: len * 0.2,
        color: rng() < 0.55 ? SKY.pink : SKY.peach, alpha: 0.18 + rng() * 0.14,
      });
    }
    yield;

    release(skyPaint);
    skyPaint = c;

    // light raking down from the upper right: long, thin, dry-brushed, on a
    // layer of its own so it can brighten and dim
    const [rc, rg] = offscreen(c.width, c.height);
    rg.scale(dpr, dpr);
    for (let i = 0; i < 26 * Math.sqrt(density); i++) {
      const x = W * (0.45 + rng() * 0.65), y = -Y(6) + rng() * horizonY * 0.4;
      const a = RAY + (rng() - 0.5) * 0.3, len = (240 + rng() * 380) * k;
      rays(rg, rng, {
        x, y, angle: a, len, width: (16 + rng() * 26) * k,
        color: rng() < 0.75 ? SKY.ray : SKY.offWhite, alpha: 0.12 + rng() * 0.12, bend: (rng() - 0.5) * 0.1,
      });
    }
    release(raysPaint);
    raysPaint = rc;
  }

  // ---------- the sky in motion ----------
  // The painted sky stays put. Over it drift loose scumbled strokes and a
  // few soft streaks of light, carried along by the wind and fading in and
  // out, so the haze drifts and shimmers without ever making cloud shapes;
  // the rays of light brighten and dim slowly, about ±8%. Each frame they're
  // laid together in daylight colours and the hour's colours go over the lot.
  const DRIFT_STAMPS = 18, STREAK_STAMPS = 6;
  let driftStamps = [], drift = [], driftRng = mulberry32(606);
  const [skyBuf, skyCtx] = offscreen(1, 1);
  const curl = [0, 0];
  const driftTarget = () => Math.round(clamp((W * horizonY) / 4000, 50, 150) * state.quality);

  function* buildDrift() {
    const rng = mulberry32(707);
    driftStamps.forEach(release);
    driftStamps = [];
    const tones = [SKY.offWhite, SKY.chalk, SKY.cerulean, SKY.lilac, SKY.peach, SKY.offWhite];
    for (let i = 0; i < DRIFT_STAMPS + STREAK_STAMPS; i++) {
      const streak = i >= DRIFT_STAMPS;
      const len = (streak ? 160 + rng() * 140 : 40 + rng() * 60) * k;
      const width = streak ? (12 + rng() * 10) * k : len * (0.22 + rng() * 0.12), pad = 4;
      const [c, g] = offscreen((len + pad * 2) * dpr, (width * 1.4 + pad * 2) * dpr);
      g.scale(dpr, dpr);
      (streak ? rays : paintStroke)(g, rng, {
        x: pad, y: width * 0.7 + pad, angle: 0, len, width,
        color: streak ? SKY.ray : tones[(rng() * tones.length) | 0], bend: (rng() - 0.5) * 0.2,
      });
      driftStamps.push(c);
      yield;
    }
    skyBuf.width = skyPaint.width;
    skyBuf.height = skyPaint.height;
    driftRng = mulberry32(606); // the same start on every load
    drift = [];
    for (let i = 0, n = driftTarget(); i < n; i++) drift.push(spawnDrift({}, true));
  }

  function spawnDrift(s, midLife) {
    const streak = driftRng() < 0.12;
    Object.assign(s, {
      x: -80 + driftRng() * (W + 200), y: driftRng() * horizonY * 0.92,
      stamp: streak ? DRIFT_STAMPS + ((driftRng() * STREAK_STAMPS) | 0) : (driftRng() * DRIFT_STAMPS) | 0,
      angle: streak ? Math.PI * 0.68 + (driftRng() - 0.5) * 0.2 : (driftRng() < 0.5 ? Math.PI * 0.68 : 0) + (driftRng() - 0.5) * 1.1,
      life: 10 + driftRng() * 8, fadeIn: 3, fadeOut: 3,
      peak: streak ? 0.08 + driftRng() * 0.08 : 0.12 + driftRng() * 0.14,
      scale: 0.8 + driftRng() * 0.5, sf: 0.6 + driftRng() * 0.6,
    });
    s.age = midLife ? driftRng() * s.life : 0;
    return s;
  }

  // once per frame while the wind blows
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
      wind.curlAt(s.x, s.y, wind.t, curl);
      const sp = wind.speed * s.sf * wind.gust * 0.8;
      s.x += (wind.dir[0] + 0.35 * curl[0]) * sp * dt;
      s.y += (wind.dir[1] + 0.25 * curl[1]) * sp * dt;
    }
    while (drift.length < target) drift.push(spawnDrift({}, false));
  }

  function drawSky() {
    const { skyTop, skyMid, skyLow, dark } = state.light;
    const g = skyCtx, sh = skyBuf.height / dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.drawImage(skyPaint, 0, 0);
    g.globalCompositeOperation = 'source-over';
    const breathe = state.motion ? Math.sin(wind.t * 0.23) * 0.6 + Math.sin(wind.t * 0.071 + 1) * 0.4 : 0;
    g.globalAlpha = (1 - dark * 0.7) * (0.92 + 0.08 * breathe);
    g.drawImage(raysPaint, 0, 0);
    for (const s of drift) {
      const a = s.peak * smooth(0, s.fadeIn, s.age) * (1 - smooth(s.life - s.fadeOut, s.life, s.age)) *
        (1 - smooth(horizonY * 0.8, horizonY, s.y)); // thinning toward the horizon
      if (a < 0.004) continue;
      const c = driftStamps[s.stamp], cos = Math.cos(s.angle) * s.scale, sin = Math.sin(s.angle) * s.scale;
      g.globalAlpha = a;
      g.setTransform(cos, sin, -sin, cos, s.x * dpr, s.y * dpr);
      g.drawImage(c, -c.width / 2, -c.height / 2);
    }
    g.globalAlpha = 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (Math.min(...skyTop, ...skyMid, ...skyLow) < 254.5) {
      const grad = g.createLinearGradient(0, 0, 0, horizonY);
      grad.addColorStop(0, rgb(skyTop));
      grad.addColorStop(0.55, rgb(skyMid));
      grad.addColorStop(1, rgb(skyLow));
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = grad;
      g.fillRect(0, 0, W, sh);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(skyBuf, 0, 0, W, sh);
  }

  // ---------- the sun and moon ----------
  // A small, pale, high-key sun (as in the painting, where it hangs at
  // about 40% across and a third of the way down at midday), and at night a
  // soft moon glow.
  function sunAt(h) {
    const p = (h - SUNRISE) / (SUNSET - SUNRISE);
    if (p < -0.08 || p > 1.08) return null;
    const alt = Math.sin(Math.PI * p);
    return { x: W * (0.395 + (p - 0.5) * 0.9), y: horizonY - alt * (horizonY - Y(33)), r: Y(0.9) * (1 + 0.4 * (1 - Math.max(0, alt))), alt };
  }
  function moonAt(h) {
    const span = 24 - (SUNSET - SUNRISE) + 1;
    const p = ((h - (SUNSET - 0.5) + 24) % 24) / span;
    if (p <= 0 || p >= 1) return null;
    return { x: W * (0.3 + 0.62 * p), y: horizonY - Math.sin(Math.PI * p) * horizonY * 0.72, r: Y(1.1) };
  }

  function buildSun() {
    const size = 256, m = size / 2;
    const [c, g] = offscreen(size, size);
    const glow = g.createRadialGradient(m, m, 0, m, m, m);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.07, 'rgba(255,255,255,0.95)');
    glow.addColorStop(0.12, 'rgba(255,255,255,0.45)');
    glow.addColorStop(0.4, 'rgba(255,255,255,0.12)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, size, size);
    release(sunSprite);
    sunSprite = c;
  }

  // the sprite is white: the hour's colour goes on with 'multiply' over it, so
  // draw it to a small buffer first
  const [orbBuf, orbCtx] = offscreen(256, 256);
  function drawOrb(x, y, r, color, alpha) {
    orbCtx.globalCompositeOperation = 'copy';
    orbCtx.drawImage(sunSprite, 0, 0);
    orbCtx.globalCompositeOperation = 'multiply';
    orbCtx.fillStyle = rgb(color);
    orbCtx.fillRect(0, 0, 256, 256);
    orbCtx.globalCompositeOperation = 'destination-in';
    orbCtx.drawImage(sunSprite, 0, 0);
    const half = r * 8;
    ctx.globalAlpha = alpha;
    ctx.drawImage(orbBuf, x - half, y - half, half * 2, half * 2);
    ctx.globalAlpha = 1;
  }

  function drawSunMoon() {
    const light = state.light;
    const sun = sunAt(state.hour);
    if (sun && light.dark < 0.95) drawOrb(sun.x, sun.y, sun.r, light.sun, 0.9 * (1 - light.dark));
    const moon = light.dark > 0.05 && moonAt(state.hour);
    if (moon) drawOrb(moon.x, moon.y, moon.r, [236, 236, 255], light.dark * 0.85);
  }

  // ---------- the land ----------
  // Painted top to bottom, so nearer marks overlap farther ones: the hazy
  // hills and towns on the horizon, then every band of the fields as an
  // underpainting of big translucent strokes worked over with dabs in its own
  // colours, the canal, the path, then the boats, figures and posts.
  function* buildLand() {
    buildBounds();
    landTop = Math.floor(horizonY - Y(4));
    const [c, g] = offscreen(W * dpr, (CH - landTop) * dpr);
    g.scale(dpr, dpr);
    g.translate(0, -landTop);
    const rng = mulberry32(1637);

    // the ground, ending raggedly in the dissolve
    const ground = new Path2D();
    ground.moveTo(-10, horizonY);
    for (let x = -10; x <= W + 10; x += 6) ground.lineTo(x, horizonY + (noise2(x * 0.02, 1.3) - 0.5) * 2);
    for (let x = W + 10; x >= -10; x -= 6) ground.lineTo(x, groundEnd(x));
    ground.closePath();
    g.fillStyle = rgb(PAINT.mid.mean);
    g.fill(ground);

    // each band's mean colour, filled flat; the dabs will break up its edges
    for (let i = 0; i < BANDS.length; i++) {
      const p = new Path2D();
      for (let x = -4; x <= W + 4; x += 4) p.lineTo(x, bandTop(clamp(x, 0, W), i));
      for (let x = W + 4; x >= -4; x -= 4) p.lineTo(x, i === BANDS.length - 1 ? groundEnd(x) : bounds[clamp(Math.round(x), 0, Math.ceil(W)) * BANDS.length + i]);
      p.closePath();
      g.fillStyle = rgb(paintFor(i, W / 2, horizonY + 1).mean);
      g.fill(p);
    }
    yield;

    // the distant band: hazy blue-violet trees and towns, low hills on the right
    yield* paintDistance(g, rng);

    // underpainting: big translucent strokes laying in each band's colour masses
    const nUnder = Math.round(((W * (CH - horizonY)) / (900 * k * k)) * density);
    for (let i = 0; i < nUnder; i++) {
      if (i % 10 === 9) yield;
      const x = rng() * W, y = horizonY + Math.pow(rng(), 1.4) * (CH - horizonY);
      if (y > groundEnd(x) - 4 || rng() > paintDensity(x, y)) continue;
      const b = bandAt(x, y), t = depth(y), len = dabLen(t) * (2.2 + rng() * 1.6);
      paintStroke(g, rng, {
        x: x - len / 2, y, angle: angleFor(b, x, y, rng), len, width: len * 0.4,
        color: paintFor(b, x, y).pick(rng()), alpha: 0.35 + rng() * 0.2,
      });
    }

    // the dabs, row by row from the horizon down
    let work = 0;
    for (let y = horizonY + 0.5; y < CH - 4;) {
      const t = depth(y), len0 = dabLen(t);
      for (let x = -10 + rng() * len0; x < W + 10;) {
        if (++work % 8 === 0) yield;
        const len = len0 * (0.7 + rng() * 0.6);
        const yy = y + (rng() - 0.5) * len0 * 0.3;
        x += len * (0.55 + rng() * 0.5) / Math.sqrt(density);
        if (yy + len * 0.4 > CH - 6) continue; // never cut off by the canvas's bottom edge
        const b = bandAt(x, yy), id = BANDS[b].id;
        // the foreground's top layer is the flowers, so only a light pass here
        if (FLOWER_BANDS.has(id) && rng() < 0.45) continue;
        const stray = rng() < 0.01 && intoDissolve(x, yy) < 0.8;
        if (rng() > paintDensity(x, yy) && !stray) continue;
        const a = angleFor(b, x, yy, rng), w = len * (id === 'water' ? 0.24 : 0.36 + rng() * 0.14);
        const pal = paintFor(b, x, yy);
        paintStroke(g, rng, {
          x: x - (Math.cos(a) * len) / 2, y: yy - (Math.sin(a) * len) / 2, angle: a, len, width: w,
          color: pal.pick(rng()), streak: rng() < 0.25 ? pal.pick(rng()) : null,
          alpha: id === 'far' ? 0.75 : 0.9, bend: (rng() - 0.5) * 0.3,
        });
      }
      y += Math.max(0.6, len0 * 0.28) / Math.sqrt(density);
    }

    yield* paintCanal(g, rng);
    paintFigures(g, rng);

    release(landPaint);
    landPaint = c;
    landCache.reset();
  }

  // the band's colours here, with broad masses: on the left the middle band
  // is grass, and on the right the far strip is tulips over the canal's bank
  function paintFor(i, x, y) {
    const id = BANDS[i].id, xp = (x / W) * 100;
    if (id === 'far' && xp > 47 + (noise2(y * 0.3, 5) - 0.5) * 4) return PAINT.farRight;
    if (id === 'mid' && xp < 22 + (fbm(x * 0.01, y * 0.02) - 0.5) * 16) return PAINT.grass;
    return PAINT[id];
  }

  // the brush's direction in each band: level on the water and in the far
  // stripes, along the path, leaning toward the vanishing area elsewhere,
  // and diagonal, criss-crossing, in the foreground
  function angleFor(i, x, y, rng) {
    const id = BANDS[i].id, j = (rng() - 0.5);
    const toV = Math.atan2(Y(VANISH[1]) - y, X(VANISH[0]) - x); // toward the vanishing area
    const lean = Math.abs(toV) > Math.PI / 2 ? toV - Math.PI * Math.sign(toV) : toV; // either way along the line
    switch (id) {
      case 'far': return j * 0.12;
      case 'water': return j * 0.06;
      case 'bank': return j * 0.15;
      case 'path': return -0.3 + j * 0.3;
      case 'fore': case 'near': {
        const flow = -0.58 + (fbm(x * 0.003, y * 0.004) - 0.5) * 0.7; // gusts of direction across the field
        return (rng() < 0.12 ? flow + 1.1 : flow) + j * 0.45;
      }
      default: return lean * 0.6 + j * 0.6;
    }
  }

  function* paintDistance(g, rng) {
    // a low profile of bumps: hills on the right, trees and towns on the left
    const profile = (x) => {
      const xp = (x / W) * 100;
      const right = smooth(44, 52, xp), left = 1 - smooth(10, 22, xp);
      const bumps = fbm(x * 0.006, 2.2) * 0.6 + noise2(x * 0.03, 4.4) * 0.4;
      return horizonY - Y(0.4 + right * (1.6 + bumps * 1.8) + left * (0.9 + bumps * 1.4) + (1 - right) * (1 - left) * bumps * 0.6);
    };
    for (let x = -10; x < W + 10; x += 3 * k) {
      const top = profile(x);
      for (let y = top; y < horizonY + 2; y += 2.2 * k) {
        const len = (5 + rng() * 9) * k;
        paintStroke(g, rng, {
          x: x - len / 2, y, angle: (rng() - 0.5) * 0.25, len, width: 2.6 * k,
          color: mixRGB(SKY.hills[(rng() * SKY.hills.length) | 0], SKY.haze, 0.2 + ((horizonY - y) / Y(4)) * 0.5),
          alpha: 0.55 + rng() * 0.3,
        });
      }
      if (x % (60 * k) < 3 * k) yield;
    }
    // haze over their tops
    for (let i = 0; i < W / (14 * k); i++) {
      const x = rng() * W, len = (30 + rng() * 60) * k;
      paintStroke(g, rng, {
        x: x - len / 2, y: profile(x) + rng() * Y(0.6), angle: (rng() - 0.5) * 0.1, len, width: 4 * k,
        color: rng() < 0.6 ? SKY.haze : SKY.pink, alpha: 0.25 + rng() * 0.2,
      });
    }
  }

  // The canal: level strokes of blue, periwinkle and lavender with white
  // reflections of the sky, darker greens under the far bank.
  function* paintCanal(g, rng) {
    const x0 = X(44);
    for (let x = x0; x < W + 10; x += 9 * k) {
      const top = canalTop(Math.min(x, W)), bot = canalBottom(Math.min(x, W));
      if (bot - top < 0.6) continue;
      for (let y = top + 0.4; y < bot; y += Math.max(0.8, (bot - top) / 9)) {
        const t = depth(y), len = (22 + rng() * 40) * k * (0.35 + t * 1.3);
        const f = (y - top) / (bot - top);
        const color = f < 0.2 && rng() < 0.5 ? mixRGB(C('#3F7A45'), C('#6F8FC9'), 0.55) // the bank's reflection
          : PAINT.water.pick(rng());
        wetStroke(g, rng, {
          x: x - len / 2 + (rng() - 0.5) * 10, y: y + (rng() - 0.5) * 1.2, angle: (rng() - 0.5) * 0.04, len,
          width: Math.max(1.4, (bot - top) * 0.15 * (0.7 + rng() * 0.6)), color, alpha: 0.88,
        });
      }
      if (x % (60 * k) < 9 * k) yield;
    }
    // the sky's reflection: a few long pale strokes, broken
    for (let i = 0; i < (W - x0) / (34 * k); i++) {
      const x = x0 + rng() * (W - x0), top = canalTop(x), bot = canalBottom(x);
      if (bot - top < 3) continue;
      const y = top + (0.25 + rng() * 0.65) * (bot - top), len = (18 + rng() * 40) * k * (0.4 + depth(y));
      wetStroke(g, rng, {
        x: x - len / 2, y, angle: (rng() - 0.5) * 0.03, len, width: Math.max(1.2, (bot - top) * 0.07),
        color: rng() < 0.5 ? C('#E6ECF8') : C('#C3CDEB'), alpha: 0.4 + rng() * 0.25,
      });
    }
  }

  // ---------- the boats ----------
  // Two small rust sails near the horizon, each painted once as a sprite (a
  // low dark hull, a loose triangle of vertical dabs, peak to the right)
  // with its reflection: the sprite upside down, sunk into the water's blue.
  function* buildBoats() {
    const rng = mulberry32(48);
    for (const b of boats) [b.sprite, b.mirror].forEach(release);
    boats = BOATS.map((b, i) => {
      const h = mu * b.h, w = Math.max(6, mu * b.w * 1.1), pad = 4;
      const cw = w * 1.6 + pad * 2, ch = h + Y(0.6) + pad * 2;
      const [c, g] = offscreen(cw * dpr, ch * dpr);
      g.scale(dpr, dpr);
      const bx = cw / 2, by = ch - pad - Y(0.25); // the waterline, in the sprite
      for (let j = 0; j < 26; j++) {
        const f = rng(), up = rng();
        const yy = by - Y(0.2) - up * h, half = w * 0.5 * (1 - up * 0.85);
        paintStroke(g, rng, {
          x: bx + w * 0.12 * up + (f - 0.5) * 2 * half, y: yy + h * 0.08, angle: -Math.PI / 2 + (rng() - 0.5) * 0.3,
          len: h * (0.16 + rng() * 0.1), width: Math.max(1.4, w * 0.22),
          color: mixRGB(b.color, rng() < 0.3 ? C('#C9785A') : C('#6E3A30'), rng() * 0.35), alpha: 0.9,
        });
      }
      paintStroke(g, rng, { x: bx - w * 0.55, y: by, angle: 0, len: w * 1.1, width: Y(0.35), color: C('#3A3048'), alpha: 0.9 });
      // the reflection: flipped, tinted toward the canal's blue, broken into level strokes
      const [m, mg] = offscreen(c.width, c.height);
      mg.setTransform(1, 0, 0, -1, 0, c.height);
      mg.drawImage(c, 0, 0);
      mg.setTransform(1, 0, 0, 1, 0, 0);
      mg.globalCompositeOperation = 'source-atop';
      mg.fillStyle = rgb(C('#6F8FC9'), 0.45);
      mg.fillRect(0, 0, m.width, m.height);
      mg.globalCompositeOperation = 'destination-out';
      for (let y = 0; y < m.height; y += 3 * dpr) if (rng() < 0.35) mg.fillRect(0, y, m.width, 1.2 * dpr);
      mg.globalCompositeOperation = 'source-over';
      return {
        ...b, sprite: c, mirror: m, w: cw, h: ch, wl: by, x: X(b.x), y: Y(b.y),
        ph: i * 2.1, lit: keyedCache((lg) => relight(lg, c, state.light)), litMirror: keyedCache((lg) => relight(lg, m, state.light)),
      };
    });
    yield;
  }

  // They bob, rock a little, and drift slowly along the canal with the wind
  // (back and forth over a few minutes, so they never sail off); their
  // reflections wobble.
  function drawBoats() {
    const key = relightKey(), t = state.motion ? state.time / 1000 : 0;
    for (const b of boats) {
      const img = b.lit.get(key, b.sprite.width, b.sprite.height), mirror = b.litMirror.get(key, b.mirror.width, b.mirror.height);
      const drift = state.motion ? wind.dir[0] * X(0.7) * Math.sin((TAU * t) / 240 + b.ph) : 0;
      const bob = Math.sin(t * 1.1 + b.ph) * 0.6 * k, rock = Math.sin(t * 0.8 + b.ph * 1.7) * 0.035;
      const x = b.x + drift - b.w / 2, y = b.y + bob - b.wl;
      // the reflection, in level slices that wobble independently, only on the water
      if (b.reflect && canalPath) {
        const slices = 6, sh = b.mirror.height / slices;
        ctx.save();
        ctx.clip(canalPath);
        ctx.globalAlpha = 0.75 * b.reflect;
        for (let i = 0; i < slices; i++) {
          const wob = Math.sin(t * 2.3 + i * 1.3 + b.ph) * 0.9 * k * (i + 1) * 0.4;
          ctx.drawImage(mirror, 0, i * sh, mirror.width, sh, x + wob, b.y + bob - (b.h - b.wl) + (i * sh) / dpr + 1, b.w, sh / dpr);
        }
        ctx.restore();
      }
      const cos = Math.cos(rock) * dpr, sin = Math.sin(rock) * dpr;
      ctx.setTransform(cos, sin, -sin, cos, (b.x + drift) * dpr, (b.y + bob) * dpr);
      ctx.drawImage(img, -b.w / 2, -b.wl, b.w, b.h);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // tiny dark figures near the mill, and a couple of dark posts by the path
  function paintFigures(g, rng) {
    for (const [xp, yp, hp] of FIGURES) {
      const x = X(xp), y = Y(yp), h = Y(hp) * Math.min(1, mu / (H / 100));
      paintStroke(g, rng, { x, y, angle: -Math.PI / 2 + (rng() - 0.5) * 0.1, len: h * 0.75, width: Math.max(1.6, h * 0.28), color: FIGURE[(rng() * 3) | 0], alpha: 0.95, bristles: 3 });
      paintStroke(g, rng, { x, y: y - h * 0.72, angle: -Math.PI / 2, len: h * 0.22, width: Math.max(1.4, h * 0.2), color: FIGURE[0], alpha: 0.95, bristles: 2 });
    }
    for (const [xp, y0, y1] of POSTS) {
      const x = X(xp);
      paintStroke(g, rng, { x, y: Y(y1), angle: -Math.PI / 2 + (rng() - 0.5) * 0.06, len: Y(y1 - y0), width: Math.max(2, mu * 0.55), color: C('#2C2A44'), alpha: 0.95, bristles: 4 });
      // a short shadow on the ground
      paintStroke(g, rng, { x, y: Y(y1), angle: 0.25, len: Y(1.2), width: Math.max(1.4, mu * 0.35), color: C('#4A5A3C'), alpha: 0.5, bristles: 3 });
    }
  }

  // The land for this hour, then the midground and far bands swaying a
  // little with the wind: thin rows of the cached paint, nudged sideways,
  // more for nearer rows and in the swell of a gust.
  function drawLand() {
    const lit = landCache.get(relightKey(), landPaint.width, landPaint.height);
    ctx.drawImage(lit, 0, landTop, W, CH - landTop);
    if (!state.motion) return;
    const t = state.time / 1000, push = wind.swell(state.time) * (0.6 + 0.4 * wind.gust);
    const ROW = 3, y1 = Math.min(Y(70), state.viewBottom);
    for (let y = Math.max(horizonY + 1, state.viewTop); y < y1; y += ROW) {
      const d = depth(y);
      const dx = Math.sin(t * 1.25 - y * 0.07 + Math.sin(t * 0.29 + y * 0.01) * 2) * k * (0.2 + 1.2 * d) * push;
      if (Math.abs(dx) < 0.08) continue;
      ctx.drawImage(lit, 0, Math.round((y - landTop) * dpr), lit.width, ROW * dpr, dx, y, W, ROW);
    }
  }

  // ---------- the windmills ----------
  // Built from loose dark-violet dabs, no outlines: a tapered body with a
  // warm tan-brown skirt on its lower left, a dark cap, and four lattice
  // sails, each a stock with a loose frame along its trailing side. The
  // sails are painted once per mill as their own sprite and turned each
  // frame about the hub, so they keep their painted look.
  function* buildMills() {
    const rng = mulberry32(1886);
    const main = MILLS[1];
    const sailMain = 11.3 * mu * main.size;
    // on a phone the main mill moves in from the edge so its sails stay on screen
    const mainX = Math.max(X(main.x), sailMain * 0.78 + 6);
    for (const m of mills) if (m.sails) release(m.sails.canvas);
    mills = MILLS.map((m) => {
      const s = mu * m.size, R = 11.3 * s;
      const x = m.id === 'main' ? mainX : Math.max(X(m.x), R * 0.5);
      return {
        ...m, cx: x, hubY: Y(m.hub), baseY: Y(m.base), s, R,
        angle: Math.PI / 4 + (m.id === 'far' ? 0.31 : 0), omega: TURN * m.speed * 0.95, boost: 0, // already turning
      };
    });
    // the region the towers cover
    const x0 = 0, x1 = Math.max(...mills.map((m) => m.cx + m.R)) + 8;
    const y0 = Math.min(...mills.map((m) => m.hubY - m.R)) - 8, y1 = Math.max(...mills.map((m) => m.baseY)) + 8;
    millBox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const [c, g] = offscreen(millBox.w * dpr, millBox.h * dpr);
    g.scale(dpr, dpr);
    g.translate(-x0, -y0);
    for (const m of mills) {
      yield* paintTower(g, rng, m);
      m.sails = paintSails(rng, m);
      m.lit = keyedCache((lg) => relight(lg, m.sails.canvas, millLight()));
      yield;
    }
    release(millPaint);
    millPaint = c;
    millCache.reset();
  }

  // darker than the land at night: near-black violet silhouettes
  const millLight = () => {
    const light = state.light;
    return { ...light, tint: light.tint.map((v) => v * (1 - 0.5 * light.dark)) };
  };

  // The sails' speed follows the wind with inertia: about one turn every
  // eight seconds in a normal breeze, easing up through a gust and slowing
  // smoothly after; slower at night. A click adds a boost that dies away
  // over a few seconds. Dutch mills turn counterclockwise, seen from the front.
  const TURN = TAU / 8.5; // rad/s at an average gust
  function updateMills(dt) {
    if (!state.motion) return;
    for (const m of mills) {
      const target = TURN * m.speed * (0.45 + 0.5 * wind.gust) * (1 - 0.4 * state.light.dark);
      m.omega += (target - m.omega) * (1 - Math.exp(-dt / 2.5));
      m.boost *= Math.exp(-dt / 1.8);
      m.angle -= (m.omega + m.boost) * dt;
    }
  }

  function drawMills() {
    const key = relightKey();
    ctx.drawImage(millCache.get(key, millPaint.width, millPaint.height), millBox.x, millBox.y, millBox.w, millBox.h);
    for (const m of mills) {
      const { size } = m.sails, img = m.lit.get(key, m.sails.canvas.width, m.sails.canvas.height);
      const cos = Math.cos(m.angle) * dpr, sin = Math.sin(m.angle) * dpr;
      ctx.setTransform(cos, sin, -sin, cos, m.cx * dpr, m.hubY * dpr);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // a mill under (x, y): on its sails' sweep or its tower
  const millAt = (x, y) => mills.find((m) => Math.hypot(x - m.cx, y - m.hubY) < m.R * 1.05 ||
    (Math.abs(x - m.cx) < 4.2 * m.s && y > m.hubY && y < m.baseY));

  const tone = (m, col) => (m.haze ? mixRGB(col, MILL.haze, m.haze) : col);

  function* paintTower(g, rng, m) {
    const { cx, s } = m, top = m.hubY + 1.4 * s, base = m.baseY;
    const halfAt = (y) => lerp(2.3, 4.0, (y - top) / (base - top)) * s;
    for (let y = top; y < base; y += 0.55 * s) {
      const hw = halfAt(y), f = (y - top) / (base - top);
      for (let x = cx - hw; x < cx + hw; x += 0.7 * s) {
        const u = (x - (cx - hw)) / (2 * hw); // 0 left – 1 right
        const skirt = f > 0.5 && u < 0.5 + (rng() - 0.5) * 0.2;
        const col = skirt ? MILL.skirt[(rng() * MILL.skirt.length) | 0]
          : u > 0.72 ? MILL.shadow[(rng() * 2) | 0] : MILL.body[(rng() * 3) | 0];
        const len = (1.4 + rng() * 1.2) * s;
        paintStroke(g, rng, {
          x: x + (rng() - 0.5) * 0.5 * s, y: y + len * 0.5, angle: -Math.PI / 2 + (u - 0.5) * 0.25 + (rng() - 0.5) * 0.3, len,
          width: (0.7 + rng() * 0.5) * s, color: tone(m, col), alpha: 0.9,
        });
      }
      if (y % (4 * s) < 0.55 * s) yield;
    }
    // the cap: a dark dome of curved dabs over the hub
    for (let i = 0; i < 30; i++) {
      const a = Math.PI + rng() * Math.PI, r = 2.4 * s * Math.sqrt(rng());
      paintStroke(g, rng, {
        x: cx + Math.cos(a) * r, y: m.hubY + 1.6 * s + Math.sin(a) * r * 0.75, angle: a + Math.PI / 2, len: 1.4 * s,
        width: 0.9 * s, bend: 0.3, color: tone(m, MILL.cap[(rng() * 3) | 0]), alpha: 0.92,
      });
    }
    // a dark door at the foot
    paintStroke(g, rng, { x: cx + 0.4 * s, y: base, angle: -Math.PI / 2, len: 2.2 * s, width: 1.1 * s, color: tone(m, C('#1F1D3C')), alpha: 0.85, bristles: 3 });
  }

  // the four sails as one sprite, centred on the hub, pointing along 0 rad:
  // each a heavy dark stock and, along its trailing side, a loose frame of
  // rails and crossbars over a thin dark wash of sailcloth
  function paintSails(rng, m) {
    const R = m.R, pad = 6, size = Math.ceil((R + pad) * 2);
    const [c, g] = offscreen(size * dpr, size * dpr);
    g.scale(dpr, dpr);
    const o = size / 2, s = m.s;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + (rng() - 0.5) * 0.04, cos = Math.cos(a), sin = Math.sin(a), px = -sin, py = cos;
      const pt = (r, off) => [o + cos * r + px * off, o + sin * r + py * off];
      const col = () => tone(m, MILL.sail[(rng() * 3) | 0]);
      const r0 = 0.22 * R, fw = (0.24 + rng() * 0.05) * R;
      // the cloth: a thin, uneven dark wash over the frame
      for (let r = r0; r < R; r += 0.12 * R) {
        const [x, y] = pt(r + rng() * 0.05 * R, fw * (0.2 + rng() * 0.6));
        paintStroke(g, rng, { x, y, angle: a + (rng() - 0.5) * 0.5, len: 0.2 * R, width: fw * 0.5, color: col(), alpha: 0.12 + rng() * 0.12 });
      }
      // crossbars, unevenly spaced, some missing
      for (let r = r0; r <= R; r += (0.1 + rng() * 0.06) * R) {
        if (rng() < 0.18) continue;
        const [x, y] = pt(r, -0.1 * fw);
        paintStroke(g, rng, { x, y, angle: a + Math.PI / 2 + (rng() - 0.5) * 0.25, len: fw * (0.8 + rng() * 0.35), width: (0.3 + rng() * 0.22) * s, color: col(), alpha: 0.5 + rng() * 0.3, bristles: 2 });
      }
      // the outer rail, loose
      for (let r = r0; r < R; r += 0.2 * R) {
        const [x, y] = pt(r, fw * (0.95 + (rng() - 0.5) * 0.15));
        paintStroke(g, rng, { x, y, angle: a + (rng() - 0.5) * 0.1, len: 0.24 * R, width: (0.45 + rng() * 0.2) * s, color: col(), alpha: 0.75, bristles: 2 });
      }
      // the stock: a heavy dark spar from the hub out
      for (let r = 0.02 * R; r < R; r += 0.16 * R) {
        const [x, y] = pt(r, (rng() - 0.5) * 0.3 * s);
        paintStroke(g, rng, { x, y, angle: a + (rng() - 0.5) * 0.05, len: 0.22 * R, width: (0.9 + rng() * 0.4) * s, color: col(), alpha: 0.95, bristles: 4 });
      }
    }
    return { canvas: c, size };
  }

  // ---------- the flowers ----------
  // The foreground (the bottom ~30%): a dense sea of diagonal dabs in
  // vermilion, coral, pink, leaf green and blue-violet shadow, larger toward
  // the bottom. Each is an instance of a sprite from one atlas, with a base
  // point it bends about.
  function* buildFlowers() {
    const rng = mulberry32(4040);
    const cw = SPR_LEN + SPR_PAD * 2, chh = SPR_W + SPR_PAD * 2;
    if (atlas) release(atlas.canvas);
    atlas = createAtlas(cw, chh, FLOWER_COLORS.length * SPR_VARIANTS);
    FLOWER_COLORS.forEach((color, ci) => {
      for (let v = 0; v < SPR_VARIANTS; v++) {
        atlas.paint(ci * SPR_VARIANTS + v, (g) => paintStroke(g, rng, {
          x: SPR_PAD, y: chh / 2, angle: 0, len: SPR_LEN, width: SPR_W, color,
          streak: rng() < 0.4 ? FLOWER_COLORS[(rng() * FLOWER_COLORS.length) | 0] : null, bend: (rng() - 0.5) * 0.3,
        }));
      }
    });
    atlasCache.reset();
    yield;

    flowers = [];
    const nearTop = Y(70);
    for (let y = nearTop; y < CH;) {
      const t = depth(y), len0 = dabLen(t) * 1.35;
      for (let x = -12 + rng() * len0; x < W + 12;) {
        const len = len0 * (0.7 + rng() * 0.6);
        x += len * (0.42 + rng() * 0.4) / Math.sqrt(density);
        const yy = y + (rng() - 0.5) * len0 * 0.4;
        const b = bandAt(x, yy), id = BANDS[b].id;
        if (!FLOWER_BANDS.has(id) || yy + len * 0.5 > CH - 6) continue;
        const stray = rng() < 0.012 && intoDissolve(x, yy) < 0.8;
        if (rng() > paintDensity(x, yy) && !stray) continue;
        let color = PAINT[id].pick(rng());
        // broad masses: some patches mostly red, others greener and shadowed
        const mass = fbm(x * 0.004 + 11, yy * 0.007);
        if (mass > 0.56 && (color[1] > color[0] || color[2] > color[0]) && rng() < 0.55) color = PAINT[id].pick(rng() * 0.45);
        else if (mass < 0.4 && color[0] > 200 && rng() < 0.35) color = PAINT[id].pick(0.6 + rng() * 0.4);
        const a = angleFor(b, x, yy, rng);
        flowers.push({
          // the base point, the lower end of the dab
          x: x - (Math.cos(a) * len) / 2, y: yy - (Math.sin(a) * len) / 2,
          a, len, width: len * (0.3 + rng() * 0.12), t,
          sprite: flowerIndex(color) * SPR_VARIANTS + ((rng() * SPR_VARIANTS) | 0),
          ph: rng() * TAU, give: 0.75 + rng() * 0.5, // how far this one bends
        });
      }
      y += Math.max(0.8, len0 * 0.26) / Math.sqrt(density);
      if (flowers.length % 400 < 20) yield;
    }
    flowers.sort((p, q) => p.y - q.y); // back to front

    // the displacement grid over the foreground
    gridTop = nearTop - Y(4);
    cellW = W / GX;
    cellH = (CH - gridTop) / GY;
    grid.fill(0);
  }

  // The pointer's wake: a coarse grid over the foreground, each cell a
  // little damped spring. Moving the pointer pushes the cells near it (within
  // ~120 px) the way it's moving, harder the faster it goes; each settles
  // back over a second or two, so a fading wake trails behind it. Touch drags
  // do the same (the page still scrolls).
  const GX = 64, GY = 24, PUSH_R = 120, SPRING = 15, DAMP = 4.2;
  const grid = new Float32Array(GX * GY * 4); // per cell: dx, dy, vx, vy
  let gridTop = 0, cellW = 1, cellH = 1, gridAwake = false;

  function updateGrid(dt) {
    if (!state.motion) return;
    const p = pointer, speed = Math.hypot(p.vx, p.vy);
    const pushing = p.active && speed > 0.4 && p.y > gridTop - PUSH_R && p.y < CH + PUSH_R;
    if (!pushing && !gridAwake) return;
    if (pushing) {
      const c0 = Math.max(0, Math.floor((p.x - PUSH_R) / cellW)), c1 = Math.min(GX - 1, Math.floor((p.x + PUSH_R) / cellW));
      const r0 = Math.max(0, Math.floor((p.y - PUSH_R - gridTop) / cellH)), r1 = Math.min(GY - 1, Math.floor((p.y + PUSH_R - gridTop) / cellH));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const dx = (c + 0.5) * cellW - p.x, dy = gridTop + (r + 0.5) * cellH - p.y, d = Math.hypot(dx, dy);
          if (d >= PUSH_R) continue;
          const f = (1 - d / PUSH_R) ** 2, i = (r * GX + c) * 4;
          grid[i + 2] += p.vx * f * 0.06;
          grid[i + 3] += p.vy * f * 0.06;
        }
      }
    }
    let energy = 0;
    for (let i = 0; i < grid.length; i += 4) {
      grid[i + 2] += (-SPRING * grid[i] - DAMP * grid[i + 2]) * dt;
      grid[i + 3] += (-SPRING * grid[i + 1] - DAMP * grid[i + 3]) * dt;
      grid[i] = clamp(grid[i] + grid[i + 2] * dt, -1.4, 1.4);
      grid[i + 1] = clamp(grid[i + 1] + grid[i + 3] * dt, -1.4, 1.4);
      energy += Math.abs(grid[i]) + Math.abs(grid[i + 1]) + Math.abs(grid[i + 2]) + Math.abs(grid[i + 3]);
    }
    gridAwake = pushing || energy > 0.02;
  }

  // the grid's displacement under a point, blended between cells
  const wake = [0, 0];
  function sampleGrid(x, y) {
    const gx = clamp(x / cellW - 0.5, 0, GX - 1.001), gy = clamp((y - gridTop) / cellH - 0.5, 0, GY - 1.001);
    const c = gx | 0, r = gy | 0, tx = gx - c, ty = gy - r, i = (r * GX + c) * 4, j = i + GX * 4;
    for (let k2 = 0; k2 < 2; k2++) {
      wake[k2] = lerp(lerp(grid[i + k2], grid[i + 4 + k2], tx), lerp(grid[j + k2], grid[j + 4 + k2], tx), ty);
    }
    return wake;
  }

  // Each flower leans downwind a little; a gentle wave rolls across the
  // field (the wind's swell plus slow noise drifting downwind, so gusts
  // seem to pass through), with each stroke's own flutter on top; then the
  // pointer's wake bends it away and presses it down.
  function drawFlowers() {
    const img = atlasCache.get(relightKey(), atlas.canvas.width, atlas.canvas.height);
    const motion = state.motion, t = state.time, swell = wind.swell(t), gust = 0.6 + 0.4 * wind.gust;
    const lean = wind.dir[0] * 0.07 * gust, drift = (t / 1000) * wind.speed * 0.012;
    const top = state.viewTop - 80, bottom = state.viewBottom + 80, left = state.viewLeft - 80, right = state.viewRight + 80;
    const chh = SPR_W + SPR_PAD * 2;
    for (const f of flowers) {
      if (f.y < top || f.y > bottom || f.x < left || f.x > right) continue;
      let bend = 0, squash = 1;
      if (motion) {
        const wave = Math.sin(t * 0.0016 - f.x * 0.0055 + f.y * 0.003) * 0.07 +
          (noise2(f.x * 0.004 - drift * wind.dir[0], f.y * 0.008) - 0.5) * 0.24;
        bend = (lean + wave) * swell * gust * (0.5 + f.t * 0.6) + Math.sin(t * 0.0023 + f.ph) * 0.025;
        if (gridAwake) {
          const [wx, wy] = sampleGrid(f.x, f.y);
          bend += wx * 1.15 * f.give;
          squash = 1 - 0.38 * Math.min(1, Math.abs(wy) * 0.9 + Math.abs(wx) * 0.45);
        }
      }
      const ang = f.a + bend, cos = Math.cos(ang), sin = Math.sin(ang);
      const sx = ((f.len * squash) / SPR_LEN) * dpr, sy = (f.width / SPR_W) * dpr;
      ctx.setTransform(cos * sx, sin * sx, -sin * sy, cos * sy, f.x * dpr, f.y * dpr);
      atlas.draw(ctx, f.sprite, -SPR_PAD, -chh / 2, img);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- the water ----------
  // Highlights on the canal shimmer: level pale strokes that slide a little,
  // lengthen and shorten, and fade in and out, each on its own phase. At
  // night the moon lays a broken track across the water, and the stars
  // reflect as short, shimmering, broken dots.
  function* buildWater() {
    const rng = mulberry32(919);
    // the canal's outline, for keeping reflections on the water
    canalPath = new Path2D();
    for (let x = X(38); x <= W + 2; x += 4) canalPath.lineTo(x, canalTop(Math.min(x, W)) - 0.5);
    for (let x = W + 2; x >= X(38); x -= 4) canalPath.lineTo(x, canalBottom(Math.min(x, W)) + 0.5);
    canalPath.closePath();
    glintStamps.forEach(release);
    glintStamps = [];
    for (let i = 0; i < 4; i++) {
      const len = 48, w = 5, pad = 3;
      const [c, g] = offscreen((len + pad * 2) * dpr, (w * 2 + pad * 2) * dpr);
      g.scale(dpr, dpr);
      wetStroke(g, rng, { x: pad, y: w + pad, angle: 0, len, width: w, color: i < 2 ? [246, 248, 255] : [214, 222, 246], bristles: 3 });
      glintStamps.push(c);
    }
    glints = [];
    const x0 = X(48);
    for (let i = 0; i < ((W - x0) / (10 * k)) * Math.sqrt(density); i++) {
      const x = x0 + Math.pow(rng(), 0.8) * (W - x0);
      if (canalBottom(x) - canalTop(x) < 2.5) continue;
      glints.push({ x, f: 0.12 + rng() * 0.8, len: (0.5 + rng() * 0.9), ph: rng() * TAU, ph2: rng() * TAU, sp: 0.6 + rng() * 0.8, stamp: (rng() * 4) | 0 });
    }
    yield;
  }

  function drawWater() {
    const light = state.light, dark = light.dark, motion = state.motion, t = motion ? state.time / 1000 : 0;
    const moon = dark > 0.1 ? moonAt(state.hour) : null;
    const gust = 0.7 + 0.3 * wind.gust, tint = mixRGB(light.tint, [255, 255, 255], dark * 0.65);
    const dim = tint.map((v) => v / 255);
    ctx.globalCompositeOperation = 'source-over';
    for (const g of glints) {
      const top = canalTop(g.x), bot = canalBottom(g.x), y = top + g.f * (bot - top), d = depth(y);
      const near = moon ? Math.exp(-(((g.x - moon.x) / (W * 0.1)) ** 2)) : 0;
      const base = (1 - dark) * 0.42 + dark * (0.08 + 0.75 * near);
      const flicker = motion ? (0.5 + 0.5 * Math.sin(t * 0.9 * g.sp * gust + g.ph)) ** 2 : 0.5;
      const a = base * flicker;
      if (a < 0.02) continue;
      const len = g.len * k * (14 + 40 * d) * (motion ? 0.75 + 0.25 * Math.sin(t * 1.3 * g.sp + g.ph2) : 1);
      const slide = motion ? Math.sin(t * 0.7 * g.sp + g.ph2) * (2 + 5 * d) * k : 0;
      const img = glintStamps[g.stamp], h = Math.max(1.2, (bot - top) * 0.06 + 1.2 * k);
      ctx.globalAlpha = a * (0.6 + 0.4 * Math.min(dim[0], dim[2]));
      ctx.drawImage(img, g.x + slide - len / 2, y - h, len, h * 2);
    }
    // the stars, mirrored into the water: brighter stars, as broken dots
    if (dark > 0.4) {
      const x0 = X(49);
      for (const s of stars.list()) {
        if (s.b < 0.55 || s.x < x0) continue;
        const top = canalTop(s.x), bot = canalBottom(s.x);
        if (bot - top < 3) continue;
        const y = top + (bot - top) * clamp(0.08 + (s.y / horizonY) * 0.9, 0.08, 0.95);
        const shimmer = motion ? 0.5 + 0.5 * Math.sin(t * 2.4 + s.ph * 3 + s.x * 0.05) : 0.7;
        const a = dark * s.b * shimmer * 0.7;
        if (a < 0.04) continue;
        ctx.globalAlpha = a;
        const len = 2 + s.r * 3, wob = motion ? Math.sin(t * 1.7 + s.ph) * 1.5 : 0;
        ctx.drawImage(glintStamps[0], s.x + wob - len, y, len, 2);
        ctx.drawImage(glintStamps[1], s.x - wob + len * 0.3, y + 1.6, len * 0.7, 1.6);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- the layers ----------

  const relightKey = () => lightKey(state.light, ['tint', 'desat', 'wash']);
  const landCache = keyedCache((g) => relight(g, landPaint, state.light));
  const millCache = keyedCache((g) => relight(g, millPaint, millLight()));
  const atlasCache = keyedCache((g) => relight(g, atlas.canvas, state.light));
  let boats = [], glints = [], glintStamps = [], canalPath = null;

  const layers = [
    {
      id: 'sky', kind: 'animated', z: 0,
      *build(s) {
        measure(s);
        yield* buildSky();
        buildSun();
        yield* buildDrift();
      },
      frame: updateDrift,
      render: drawSky,
    },
    { id: 'sun', kind: 'animated', z: 1, render: drawSunMoon },
    stars.layer(2),
    stars.shootingLayer(3),
    { id: 'land', kind: 'animated', z: 4, build: buildLand, render: drawLand },
    { id: 'water', kind: 'animated', z: 5, build: buildWater, render: drawWater },
    { id: 'boats', kind: 'animated', z: 6, build: buildBoats, render: drawBoats },
    { id: 'mills', kind: 'animated', z: 7, build: buildMills, update: updateMills, render: drawMills },
    { id: 'flowers', kind: 'animated', z: 8, build: buildFlowers, update: updateGrid, render: drawFlowers },
  ];

  return {
    layers,
    interactions: {
      hint: { day: 'drag your {pointer} through the tulips', night: 'brush your {pointer} across the stars ✦' },
      // a tap on a windmill spins it up; on the night sky, it sends a shooting star off along the wind
      onTap(x, y) {
        const m = millAt(x, y);
        if (m && state.motion) m.boost = Math.min(m.boost + TAU * 0.9, TAU * 2.5);
        else if (state.light.dark > 0.5 && y < horizonY) stars.launch(x, y, wind);
      },
    },
    // the sails' reach, so the hero text can keep above them
    obstacles() {
      if (!mills.length) return null;
      const m = mills.find((q) => q.id === 'main');
      return { orbs: [], skyline: [[m.cx - m.R, m.cx + m.R, m.hubY - m.R]], horizonY };
    },
    // where each moving thing is, for checking that nothing jumps: the boats
    // [x, y, rock], the sails' angles, and the drifting strokes [id, x, y, alpha]
    trace() {
      const t = state.motion ? state.time / 1000 : 0;
      return {
        boats: boats.map((b) => {
          const drift = state.motion ? wind.dir[0] * X(0.7) * Math.sin((TAU * t) / 240 + b.ph) : 0;
          return [b.x + drift, b.y + Math.sin(t * 1.1 + b.ph) * 0.6 * k, Math.sin(t * 0.8 + b.ph * 1.7) * 0.035];
        }),
        sails: mills.map((m) => m.angle),
        drift: drift.map((d) => [traceId(d), d.x, d.y, d.peak * smooth(0, d.fadeIn, d.age) * (1 - smooth(d.life - d.fadeOut, d.life, d.age))]),
      };
    },
    // sails: seconds per turn, main mill first
    stats: () => ({ flowers: flowers.length, drift: drift.length, sails: [...mills].reverse().map((m) => +(TAU / Math.max(1e-6, m.omega + m.boost)).toFixed(1)) }),
    dispose() {
      stars.dispose();
      [skyPaint, raysPaint, landPaint, millPaint, sunSprite, orbBuf, skyBuf, ...driftStamps, ...glintStamps].forEach(release);
      [landCache, millCache, atlasCache].forEach((c) => c.release());
      if (atlas) release(atlas.canvas);
      for (const m of mills) {
        if (m.sails) release(m.sails.canvas);
        m.lit.release();
      }
      for (const b of boats) {
        [b.sprite, b.mirror].forEach(release);
        b.lit.release();
        b.litMirror.release();
      }
      skyPaint = raysPaint = landPaint = millPaint = sunSprite = atlas = null;
      flowers = mills = boats = drift = driftStamps = glints = glintStamps = [];
    },
  };
}
