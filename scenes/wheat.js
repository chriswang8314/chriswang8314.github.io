/*
 * After Van Gogh, "Summer Evening, Wheatfield with Setting Sun" (Arles,
 * 1888): a wheat field, a town on the horizon and a painted sky.
 *
 * Every mark goes through the scene's bristle brush: a loaded brush laid
 * down as a bundle of thin bristle streaks that swells and thins with
 * pressure, runs dry into ragged tails, carries a streak of a neighbouring
 * colour and, on big strokes, catches a little impasto light and shadow.
 *
 *  - The sun rises on the left around 6 AM, arcs across the sky and sets on
 *    the right around 8 PM, while the sky, field and town lighting blend
 *    continuously through dawn, day, golden hour, dusk and night.
 *  - At night: a crescent moon, the shared stars, fireflies, and soft
 *    lamplight in the town.
 *  - The field's broad warm and lemon masses, stroke size and stroke direction
 *    all follow low-frequency noise. The near strokes sway in the wind's
 *    rolling swell, part around the cursor and get swept along when you drag
 *    through them.
 *  - The wind moves the sky and the chimney smoke: loose strokes drift and
 *    swirl over the painted sky, the sun's halo turns and breathes, and the
 *    smoke rises, bends and billows with the gusts.
 *
 * Colours were sampled region by region from the painting (k-means), with
 * the vermilion accents that pixel averaging washes out added back.
 * Everything that doesn't move is painted once into offscreen canvases; only
 * the moving strokes, the hour's light and the sun are redrawn.
 */
import { TAU, clamp, lerp, mixRGB, shadeRGB, rgb, smooth, rand, mulberry32, offscreen, release, makeGlow } from '../engine/util.js';
import { noise2, fbm } from '../engine/noise.js';
import { createBrush, tintInto, BRISTLE } from '../engine/brush.js';
import { drawHalo } from '../engine/stars.js';
import { SUNRISE, SUNSET } from '../engine/time.js';

// ---------- palettes ----------
// Sky and light keyframes by hour; everything in between is blended.
// `tint` multiplies the field and town (white = full daylight), `dark`
// drives the stars, moon, fireflies and lamplight. Around 6:45 PM the sky
// matches the painting: deep blue overhead, turquoise, then green-yellow
// toward the horizon.
const NIGHT = { top: [12, 20, 62], mid: [22, 36, 90], horizon: [40, 56, 108], tint: [66, 80, 138], dark: 1 }; // deep ultramarine night
const PALETTES = {
  night: [
    { h: 0, ...NIGHT },
    { h: 4.6, top: [14, 22, 64], mid: [26, 38, 92], horizon: [48, 58, 110], tint: [72, 84, 140], dark: 1 },
    { h: 21.8, ...NIGHT },
    { h: 24, ...NIGHT },
  ],
  dawn: [
    { h: 5.6, top: [40, 54, 104], mid: [112, 102, 142], horizon: [216, 142, 120], tint: [176, 146, 156], dark: 0.5 },
    { h: 6.6, top: [64, 112, 176], mid: [152, 174, 190], horizon: [240, 204, 140], tint: [255, 222, 192], dark: 0.05 },
  ],
  day: [
    { h: 8.5, top: [48, 112, 192], mid: [118, 176, 212], horizon: [196, 226, 222], tint: [255, 250, 240], dark: 0 },
    { h: 13, top: [40, 102, 190], mid: [108, 170, 210], horizon: [186, 222, 226], tint: [255, 255, 252], dark: 0 },
    { h: 17, top: [46, 104, 178], mid: [116, 180, 196], horizon: [200, 226, 186], tint: [255, 246, 228], dark: 0 },
  ],
  golden: { h: 18.75, top: [44, 92, 160], mid: [126, 188, 182], horizon: [206, 224, 158], tint: [255, 236, 200], dark: 0 }, // the painting
  dusk: [
    { h: 19.8, top: [50, 72, 132], mid: [150, 124, 132], horizon: [246, 164, 88], tint: [250, 196, 160], dark: 0.15 },
    { h: 20.8, top: [22, 28, 68], mid: [60, 50, 92], horizon: [112, 72, 98], tint: [128, 118, 160], dark: 0.7 },
  ],
};
const NIGHT_WASH = [22, 32, 78]; // laid over the field at night so it reads blue, not brown

const SUN_HIGH = [255, 246, 214];
const SUN_LOW = [241, 227, 84]; // sampled from the painting's sun
const SUN_SET = [255, 148, 58];

// The field, lemon to deep orange. A stroke's place on this ramp comes from
// its depth and the broad warm/lemon masses, plus a little jitter.
const FIELD_PAINT = [
  [255, 232, 112], // pale lemon
  [251, 226, 86],
  [241, 208, 71],
  [228, 187, 58],
  [214, 166, 46],
  [232, 146, 44], // orange
  [200, 142, 32], // deep gold
  [224, 118, 34], // deep orange
  [208, 88, 40],  // vermilion
  [176, 112, 20], // dark ochre
  [150, 72, 28],  // red-brown accent
];
const FIELD_BASE = [241, 208, 71];
const ECHO_VIOLET = [104, 98, 156]; // the town's blue-violet, echoed in the far field's shadows
const STRIP = [[204, 148, 47], [188, 122, 30], [218, 169, 65], [151, 96, 23], [239, 195, 78], [168, 127, 69]];
const HAYSTACK = [[214, 150, 60], [190, 120, 50], [232, 180, 80], [170, 100, 48]];
const FIGURE = [[58, 46, 52], [74, 58, 58], [46, 40, 54]];

const TOWN = {
  near: [[47, 51, 82], [59, 58, 94], [69, 64, 95]], // #2F3352 #3B3A5E #45405F
  warm: [74, 58, 60], // a touch of warm brown among the darks
  far: [[110, 115, 149], [124, 122, 158]], // #6E7395 #7C7A9E
  walls: [[230, 211, 163], [217, 192, 138]], // #E6D3A3 #D9C08A
  roofs: [[200, 68, 42], [214, 95, 53], [184, 58, 38]], // #C8442A #D65F35 #B83A26
  trees: [[47, 74, 69], [62, 91, 82]], // #2F4A45 #3E5B52
  mill: [[110, 52, 44], [130, 62, 50]],
  arch: [30, 30, 50],
  window: [64, 52, 54],
  shadow: [44, 36, 40],
  smoke: [[74, 85, 112], [93, 102, 128], [62, 71, 96]],
  rim: [232, 184, 106], // #E8B86A
};

// ---------- the skyline of Arles ----------
// Designed, not generated. x and w are % of the layout width; h (and spire)
// are % of the height unit, measured up from the ground line. Only the brush
// strokes inside each shape are random.

// [from %, to %, stretch]: on very wide screens the extra room goes to the
// sections with stretch weight (quiet gaps and low house rows), never to
// repeated buildings
const SECTIONS = [
  [0, 10, 0], // factories
  [10, 13, 0], // windmill
  [13, 35, 1], // long row of red-roofed houses
  [35, 40, 2], // quiet gap
  [40, 60, 0], // main town: church, arena, bell tower
  [60, 66, 1.5], // lower stretch
  [66, 76, 0], // secondary cluster
  [76, 93, 1], // medium-low buildings
  [93, 100, 0], // the tall chimney
];

// section 3's house row: [width, wall height, roof, windows, chimney stub]
const HOUSE_ROW = [
  [2.2, 2.4, 'gable', 2, 0], [3.0, 3.0, 'hip', 3, 1], [1.8, 2.2, 'gable', 1, 0], [2.6, 3.4, 'gable', 2, 0],
  [3.4, 2.8, 'hip', 3, 1], [2.0, 2.0, 'gable', 1, 0], [2.8, 3.2, 'hip', 2, 0], [1.6, 2.6, 'gable', 1, 0],
  [3.2, 3.5, 'gable', 3, 1], [2.4, 2.5, 'hip', 2, 0], [2.0, 2.1, 'gable', 1, 0],
];
const houseRow = () => {
  let x = 13.1;
  return HOUSE_ROW.map(([w, h, roof, windows, stub], i) => {
    const house = { type: 'house', x, w, h, roof, windows, stub, pitch: 25 + ((i * 7) % 10) };
    x += w * 0.82; // neighbours overlap a little
    return house;
  });
};

// drawn in order: far layer first, then the near layer back to front
const SKYLINE = [
  // far layer: paler roofs and towers peeking above the two clusters
  { type: 'block', layer: 'far', x: 40.6, w: 3.0, h: 6.0 },
  { type: 'block', layer: 'far', x: 43.0, w: 2.6, h: 7.0, roof: 'gable', pitch: 30 },
  { type: 'block', layer: 'far', x: 45.4, w: 4.2, h: 6.2 },
  { type: 'tower', layer: 'far', x: 50.2, w: 1.1, h: 10.5, top: 'spire', spire: 2.6 },
  { type: 'block', layer: 'far', x: 51.6, w: 4.0, h: 6.4, roof: 'gable', pitch: 26 },
  { type: 'block', layer: 'far', x: 55.6, w: 3.4, h: 7.2 },
  { type: 'block', layer: 'far', x: 66.4, w: 3.0, h: 5.6 },
  { type: 'tower', layer: 'far', x: 70.6, w: 1.0, h: 8.6, top: 'flat' },
  { type: 'block', layer: 'far', x: 71.8, w: 3.6, h: 5.4, roof: 'gable', pitch: 28 },

  // 1. factories, smoke curling off to the left
  { type: 'shed', x: 0.4, w: 8.6, h: 2.5 },
  { type: 'block', x: 4.6, w: 3.4, h: 3.4 },
  { type: 'chimney', x: 2.7, w: 0.6, h: 9, smoke: 'plume' },
  { type: 'chimney', x: 7.65, w: 0.7, h: 11, smoke: 'plume' },
  // 2. windmill
  { type: 'windmill', x: 10.9, w: 1.3, h: 4 },
  // 3. the long row of houses, with one tall chimney behind
  { type: 'chimney', x: 24.7, w: 0.55, h: 8 },
  ...houseRow(),
  // 4. quiet gap
  { type: 'wall', x: 35.0, w: 5.0, h: 1.0 },
  { type: 'trees', x: 36.4, w: 3.0, h: 4.0 },
  // 5. main cluster: the focal point
  { type: 'tower', x: 42.6, w: 1.6, h: 9.5, top: 'spire', spire: 5.5, lean: 0.03 }, // the focal point
  { type: 'arena', x: 46, w: 7, h: 4, arches: 9 },
  { type: 'tower', x: 56.4, w: 1.4, h: 8, top: 'pyramid' },
  { type: 'house', x: 40.1, w: 2.0, h: 3.0, roof: 'gable', windows: 2 },
  { type: 'house', x: 41.3, w: 1.6, h: 3.8, roof: 'hip', windows: 1 },
  { type: 'house', x: 44.1, w: 1.9, h: 5.0, roof: 'gable', windows: 2, stub: 1 },
  { type: 'house', x: 53.1, w: 2.2, h: 4.4, roof: 'hip', windows: 2 },
  { type: 'house', x: 54.7, w: 1.8, h: 5.6, roof: 'gable', windows: 2 },
  { type: 'house', x: 57.6, w: 2.0, h: 3.4, roof: 'gable', windows: 1 },
  // 6. lower stretch, letting the sky show through
  { type: 'house', x: 60.2, w: 2.0, h: 2.4, roof: 'hip', windows: 1 },
  { type: 'house', x: 61.9, w: 2.4, h: 2.0, roof: 'gable', windows: 2 },
  { type: 'house', x: 63.8, w: 2.0, h: 2.8, roof: 'gable', windows: 1 },
  // 7. secondary cluster
  { type: 'tower', x: 67.4, w: 1.5, h: 9, top: 'gothic', spire: 2.4 }, // kept below the church spire
  { type: 'round', x: 72.4, w: 1.6, h: 6.6 },
  { type: 'house', x: 66.1, w: 1.6, h: 3.4, roof: 'gable', windows: 1 },
  { type: 'house', x: 68.7, w: 2.2, h: 4.4, roof: 'hip', windows: 2 },
  { type: 'house', x: 70.6, w: 1.9, h: 3.8, roof: 'gable', windows: 2 },
  { type: 'house', x: 73.9, w: 2.0, h: 3.2, roof: 'gable', windows: 1 },
  // 8. medium-low run
  { type: 'house', x: 76.2, w: 2.6, h: 2.6, roof: 'hip', windows: 2 },
  { type: 'house', x: 78.4, w: 2.0, h: 3.2, roof: 'gable', windows: 1, stub: 1 },
  { type: 'house', x: 80.1, w: 3.0, h: 2.4, roof: 'gable', windows: 3 },
  { type: 'house', x: 82.6, w: 2.2, h: 3.0, roof: 'hip', windows: 2 },
  { type: 'trees', x: 84.4, w: 2.6, h: 3.6 },
  { type: 'house', x: 86.9, w: 2.6, h: 2.8, roof: 'gable', windows: 2 },
  { type: 'house', x: 89.1, w: 2.0, h: 3.4, roof: 'hip', windows: 1 },
  { type: 'house', x: 90.8, w: 2.4, h: 2.6, roof: 'gable', windows: 2 },
  // 9. the tallest element on the right
  { type: 'chimney', x: 96.6, w: 0.75, h: 13, smoke: 'wisp' },
];

// ---------- the dissolve ----------
// Below the fold the field dissolves into the page the way paint gives out
// at the edge of a canvas: strokes thin out (they never fade), more and more
// bare ground shows, and the line where they give out wanders with noise.
const DISSOLVE = {
  depth: 35, // the painting runs on this far past the hero (% of viewport height)
  contentStart: 26, // the page content starts this far past the hero
  fade: 0.78, // how far into the dissolve the last strokes give out (0–1)
  power: 1.4, // how quickly they thin
  wander: 0.3, // how much the edge wanders with noise
  ground: 0.12, // the yellow ground under the strokes ends this far in
};

// ---------- the moving parts ----------
const STATIC_T = 0.2; // strokes nearer the horizon than this are small: painted once, not animated
const SPRITE_LEN = 240, SPRITE_W = 68, SPRITE_PAD = 40; // big enough for the nearest strokes on a retina screen
const WIND_STAMPS = 24, SMOKE_STAMPS = 8;
const LOOK_W = 64, LOOK_H = 24; // the grid the sky's colour is sampled on
const LIFT_DAY = [248, 250, 232], DEEP_DAY = [26, 56, 140]; // what strokes lighten or deepen toward
const LIFT_NIGHT = [84, 110, 180], DEEP_NIGHT = [8, 14, 52];
const SMOKE_NIGHT = [118, 130, 168]; // a lighter grey-blue against the night sky
const ORB_R = 100;

const glowFirefly = makeGlow(220, 255, 140);
const glowWarm = makeGlow(255, 196, 100);

export default {
  id: 'wheat',
  title: 'Wheat Field with Setting Sun',
  artist: 'Vincent van Gogh',
  year: 1888,
  label: 'Wheat Field',

  // the hours of its two placeholder stills (scenes/stills/wheat-*.webp),
  // shown instantly while the live painting is prepared
  placeholder: { day: 18.75, night: 23 },

  layout: {
    horizonY: 46, // % of the hero's height
    // the hero text goes wherever the sky is clearest of the sun, moon and town
    heroTextRegion: { mode: 'avoid' },
  },

  palettes: PALETTES,
  brushStyle: BRISTLE,

  // colours for the page below the painting, by the painting's light
  contentTheme: {
    day: {
      themeColor: '#2D4F9E',
      vars: {
        '--bg': '#f6efdd',
        '--card': '#fbf7ec',
        '--text': '#2b2a3a',
        '--muted': '#5e5868',
        '--border': 'rgba(59, 58, 94, 0.16)',
        '--accent': '#2d4f9e',
        '--underline': '#c8442a',
        '--chip-bg': 'rgba(45, 79, 158, 0.08)',
        '--chip-text': '#2d4f9e',
        '--weave': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='3' height='3'%3E%3Cpath d='M0 .5h3M.5 0v3' stroke='%233b2a14' stroke-opacity='.05'/%3E%3C/svg%3E")`,
        '--nav-bg': 'rgba(246, 239, 221, 0.78)',
      },
    },
    evening: {
      themeColor: '#2D4F9E',
      vars: {
        '--bg': '#f7ecd6',
        '--card': '#fcf5e8',
        '--accent': '#9a3a22',
        '--underline': '#d65f35',
        '--chip-bg': 'rgba(200, 68, 42, 0.09)',
        '--chip-text': '#93361f',
        '--nav-bg': 'rgba(247, 236, 214, 0.8)',
      },
    },
    night: {
      themeColor: '#141B33',
      vars: {
        '--bg': '#141b33',
        '--card': '#1b2442',
        '--text': '#f3ebd6',
        '--muted': '#b1adc4',
        '--border': 'rgba(242, 194, 48, 0.18)',
        '--accent': '#f2c230',
        '--underline': '#f2c230',
        '--chip-bg': 'rgba(242, 194, 48, 0.12)',
        '--chip-text': '#f2d06b',
        '--weave': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='3' height='3'%3E%3Cpath d='M0 .5h3M.5 0v3' stroke='%23fff' stroke-opacity='.035'/%3E%3C/svg%3E")`,
        '--nav-bg': 'rgba(20, 27, 51, 0.8)',
      },
    },
  },

  dissolve: DISSOLVE,

  // read by screen readers in place of the painting
  description:
    'A painting in the style of Van Gogh’s Wheat Field with Setting Sun: a field of yellow and orange brushstrokes under a swirling sky, with the town of Arles on the horizon. The light follows the time of day.',

  create,
};

// One visit to the scene: everything it paints and moves. `engine` gives
// the shared state (sizes, hour, light, wind, pointer, sim time), the main
// canvas context and the shared stars.
// a lasting number for each object trace() reports
const traceIds = new WeakMap();
let traceN = 0;
const traceId = (o) => traceIds.get(o) ?? (traceIds.set(o, ++traceN), traceN);

function create(engine) {
  const { state, wind, pointer, ctx } = engine;
  const { paintStroke, paintStamp } = createBrush(BRISTLE);
  const stars = engine.createStars({ brush: { paintStroke }, style: 'swirl' });

  // H is the hero (one screen); the canvas runs on below it to CH, where the
  // field dissolves into the page
  let W = 0, H = 0, CH = 0, dpr = 1, horizonY = 0, fieldH = 0, density = 1, windOn = true;
  let dabs = [], strokeSprites = [], fireflies = [];
  let skyTex = null, town = null, fieldLayer = null, fieldTopY = 0, grain = null, grainField = null;
  // the field is composed off-screen each frame, so the hour's light can be
  // laid over the paint alone and the bare canvas below it stays untouched
  const [fieldBuf, fieldCtx] = offscreen(1, 1);
  const [maskBuf, maskCtx] = offscreen(1, 1);
  let sunSprite = null, sunKey = '', moonSprite = null;

  const yAt = (t) => horizonY + t * fieldH;
  // where the field begins: wavering around the horizon, never ruler-straight
  const fieldTop = (x) => horizonY + 1 + (noise2(x * 0.03, 2.3) - 0.5) * 4 + (noise2(x * 0.006, 7.1) - 0.5) * 4;

  // the sizes for this build
  function measure(s) {
    ({ W, H, CH, dpr, horizonY, density } = s);
    fieldH = H - horizonY;
    windOn = s.motion;
    sunKey = '';
  }

  // ---------- sun and moon ----------

  function sunAt(h) {
    const p = (h - SUNRISE) / (SUNSET - SUNRISE);
    if (p < -0.12 || p > 1.12) return null;
    const alt = Math.sin(Math.PI * p); // below zero once it's under the horizon
    const up = Math.max(0, alt);
    return {
      x: W * (0.06 + 0.88 * p),
      y: horizonY - alt * horizonY * 0.8,
      r: clamp(Math.min(W, H) * 0.045, 20, 56) * (1 + 0.3 * (1 - up)),
      color: up > 0.4 ? mixRGB(SUN_LOW, SUN_HIGH, (up - 0.4) / 0.6) : mixRGB(SUN_SET, SUN_LOW, up / 0.4),
      up,
    };
  }

  function moonAt(h) {
    const span = 24 - (SUNSET - SUNRISE) + 1; // from just before sunset to just after sunrise
    const p = ((h - (SUNSET - 0.5) + 24) % 24) / span;
    if (p <= 0 || p >= 1) return null;
    return {
      x: W * (0.08 + 0.84 * p),
      y: horizonY - Math.sin(Math.PI * p) * horizonY * 0.75,
      r: clamp(Math.min(W, H) * 0.03, 14, 32),
    };
  }

  // ---------- the field's stroke sprites ----------

  // Moving strokes can't be re-brushed every frame, so each paint gets a few
  // strokes pre-painted with the same brush (pointing right, base at the
  // left); a moving stroke stamps one, scaled and rotated to its current lean.
  // (Each on its own canvas: stamped from a shared atlas, their edges
  // resample a little differently.)
  function* buildStrokeSprites() {
    const rng = mulberry32(77);
    strokeSprites.flat().forEach(release);
    strokeSprites = [];
    for (const [ci, color] of FIELD_PAINT.entries()) {
      const variants = [];
      for (let v = 0; v < 4; v++) {
        const [c, g] = offscreen(SPRITE_LEN + SPRITE_PAD * 2, SPRITE_W + SPRITE_PAD * 2);
        const neighbour = FIELD_PAINT[clamp(ci + (rng() < 0.5 ? -1 : 1), 0, FIELD_PAINT.length - 1)];
        paintStroke(g, rng, {
          x: SPRITE_PAD, y: c.height / 2, angle: 0, len: SPRITE_LEN, width: SPRITE_W,
          color, streak: rng() < 0.75 ? neighbour : null, bend: (rng() - 0.5) * 0.25, impasto: true,
        });
        variants.push(c);
        yield;
      }
      strokeSprites.push(variants);
    }
  }

  // ---------- the moon ----------

  // the moon: a painted orb with a crescent bite taken out of its disc
  function* buildMoon() {
    const out = {};
    yield* orbSteps([250, 236, 160], [255, 248, 210], null, 1, out);
    moonSprite = out.canvas;
    const mg = moonSprite.getContext('2d'), mc = moonSprite.width / 2;
    mg.globalCompositeOperation = 'destination-out';
    mg.beginPath();
    mg.arc(mc + ORB_R * 0.45, mc - ORB_R * 0.2, ORB_R * 0.92, 0, TAU);
    mg.fill();
  }

  // the sun for the current hour, so the first frame doesn't have to paint it
  function* buildSun() {
    const sun = sunAt(state.hour);
    if (!sun) return;
    const out = {};
    yield* orbSteps(sun.color, mixRGB(sun.color, [255, 250, 226], 0.55), state.light.mid, 0.9, out);
    sunSprite = out.canvas;
    sunKey = orbKey(sun);
  }

  // ---------- the field ----------

  // the brush's direction across the field: rising to the right at about
  // 15–35° up close, flattening toward the horizon, drifting in gentle waves
  function flowAngle(x, t) {
    const k = clamp((t - 0.05) / 0.8, 0, 1);
    const wave = (fbm(x * 0.0025, t * 3.5) - 0.5) * 0.6 * (0.3 + k);
    return -(lerp(0.03, 0.44, k) + wave);
  }

  // broad masses across the field: some patches warmer and more orange,
  // some lighter and more lemon, some denser, some with bigger strokes
  const warmMass = (x, t) => fbm(x * 0.0022, t * 4.5);
  const sizeMass = (x, t) => fbm(x * 0.003 + 50, t * 6 + 20);

  function fieldPaint(x, t, rng) {
    // warmer with nearness, but no further past the fold, so the dissolve keeps the field's own colours
    const warmth = clamp(0.2 + Math.min(t, 1.05) * 0.4 + (warmMass(x, t) - 0.5) * 1.2, 0, 1);
    const jitter = (rng() + rng() - 1) * 2.2;
    return clamp(Math.round(warmth * (FIELD_PAINT.length - 1) + jitter), 0, FIELD_PAINT.length - 1);
  }

  function makeFieldStroke(rng, x, y, t) {
    const s = 0.02 + t;
    const len = Math.max(2, s * H * 0.075 * (0.75 + sizeMass(x, t) * 0.6) * (0.8 + rng() * 0.4));
    return {
      x, y, t, s,
      rest: flowAngle(x, t) + (rng() - 0.5) * 0.14,
      a: 0, v: 0,
      len, width: len * (0.24 + rng() * 0.1),
      c: fieldPaint(x, t, rng),
      variant: (rng() * 4) | 0,
      ph: rng() * TAU,
    };
  }

  // how far a point is into the dissolve: 0 at the fold, about 1 at the canvas's bottom edge
  const intoDissolve = (x, y) => (y - H) / (CH - H) + (fbm(x * 0.0035, 7.7) - 0.3) * DISSOLVE.wander;
  // the share of strokes that survive there: thinning across the whole zone
  const paintDensity = (x, y) => Math.pow(1 - smooth(0, DISSOLVE.fade, intoDissolve(x, y)), DISSOLVE.power);
  // The yellow ground under them ends just past the fold, along a ragged line,
  // so the bare ground shows more and more between the thinning strokes.
  const groundEnd = (x) =>
    H + (CH - H) * (DISSOLVE.ground + (fbm(x * 0.004, 3.1) - 0.5) * 0.16 + (noise2(x * 0.05, 9.9) - 0.5) * 0.04);

  // The still part of the field, painted once: the yellow ground broken into
  // broad warm and lemon masses, the ochre strip of land under the town, the
  // small far furrows, a few haystacks and a pair of figures. The moving
  // strokes in front are laid out as furrow rows, then a dense, interlocking
  // foreground. Seeded, so it's the same on every load.
  function* buildField() {
    const rng = mulberry32(2024);
    fieldTopY = horizonY - 14;
    const [c, g] = offscreen(W * dpr, (CH - fieldTopY) * dpr);
    g.scale(dpr, dpr);
    g.translate(0, -fieldTopY); // draw in screen coordinates
    const tMax = (CH - horizonY) / fieldH; // the field runs on past the fold, still in perspective

    // the ground: a wavering top edge at the horizon, a ragged end in the dissolve
    const ground = new Path2D();
    for (let x = -10; x <= W + 10; x += 6) ground.lineTo(x, fieldTop(x));
    for (let x = W + 10; x >= -10; x -= 6) ground.lineTo(x, groundEnd(x));
    ground.closePath();
    g.fillStyle = rgb(FIELD_BASE);
    g.fill(ground);

    // underpainting: broad translucent strokes laying in the colour masses
    for (let i = 0; i < ((W * fieldH) / 2200) * density * (tMax / 1.14); i++) {
      if (i % 8 === 7) yield;
      const t = 0.04 + rng() * (tMax - 0.02), x = rng() * W;
      const len = (60 + rng() * 120) * (0.4 + t), y = yAt(t);
      // thinned through the dissolve, and never cut off by the canvas's bottom edge
      if (rng() > paintDensity(x, y) || y + len * 0.2 > CH - 8) continue;
      paintStroke(g, rng, {
        x: x - len / 2, y, angle: flowAngle(x, t), len, width: len * 0.35,
        color: FIELD_PAINT[fieldPaint(x, t, rng)], alpha: 0.4,
      });
    }

    // brush the end of the yellow ground ragged, so it never reads as a line
    for (let x = -20; x < W + 20; x += 7 + rng() * 6) {
      if (rng() < 0.15) continue;
      const y = groundEnd(x) - rng() * 12, t = (y - horizonY) / fieldH;
      const len = 14 + rng() * 26;
      paintStroke(g, rng, {
        x, y, angle: flowAngle(x, t) + (rng() - 0.5) * 0.3, len, width: len * (0.25 + rng() * 0.1),
        color: FIELD_PAINT[1 + ((rng() * 3) | 0)], streak: FIELD_BASE,
      });
    }

    // the ochre strip: horizontal dabs, thicker in some places than others,
    // some reaching up over the foot of the town
    for (let x = -20; x < W + 20; x += 5 + rng() * 6) {
      yield;
      const thick = fieldH * (0.012 + 0.032 * fbm(x * 0.004, 3.3));
      const top = fieldTop(x) - 3;
      for (let y = top; y < top + thick; y += 2.5 + rng() * 2) {
        paintStroke(g, rng, {
          x, y, angle: (rng() - 0.5) * 0.1, len: 10 + rng() * 16, width: 2.5 + rng() * 2.5,
          color: STRIP[(rng() * STRIP.length) | 0], streak: STRIP[(rng() * STRIP.length) | 0],
        });
      }
    }

    const stripBottom = Math.max(3, fieldH * 0.03);
    dabs = [];
    let row = 0, work = 0;
    for (let t = stripBottom / fieldH + 0.012; t < 0.5; t += Math.max(0.006, t * 0.09), row++) {
      yield;
      const gap = Math.max(4, (0.02 + t) * H * 0.075 * 1.6) / Math.sqrt(density);
      for (let x = -20 + rng() * gap; x < W + 20; x += gap * (0.6 + rng() * 0.8)) {
        if (++work % 12 === 0) yield;
        // rows wander a little rather than ruling straight across
        const wobble = (noise2(x * 0.004, row * 0.6) - 0.5) * fieldH * Math.max(0.008, t * 0.07);
        const d = makeFieldStroke(rng, x, yAt(t) + wobble, t);
        if (t < STATIC_T) {
          paintStroke(g, rng, {
            x: d.x, y: d.y, angle: d.rest, len: d.len, width: d.width,
            color: FIELD_PAINT[d.c], streak: FIELD_PAINT[clamp(d.c + 1, 0, FIELD_PAINT.length - 1)],
          });
        } else {
          dabs.push(d);
        }
      }
    }

    // a few blue-violet strokes in the far field's shadows, echoing the town
    for (let i = 0; i < W / 60; i++) {
      const t = 0.03 + rng() * 0.15, x = rng() * W;
      if (warmMass(x, t) < 0.55) continue;
      paintStroke(g, rng, {
        x, y: yAt(t), angle: flowAngle(x, t), len: (0.02 + t) * H * 0.07, width: (0.02 + t) * H * 0.018,
        color: ECHO_VIOLET, alpha: 0.6,
      });
    }

    // haystacks and a pair of figures, as in the painting
    const mound = (cx, by, size, colors, count, upright) => {
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI, r = size * Math.sqrt(rng());
        paintStroke(g, rng, {
          x: cx + Math.cos(a) * r * (upright ? 0.3 : 1.1),
          y: by - Math.sin(a) * r * (upright ? 1 : 0.6),
          angle: upright ? -Math.PI / 2 + (rng() - 0.5) * 0.4 : -0.3 + (rng() - 0.5) * 1.2,
          len: size * (0.3 + rng() * 0.25), width: size * 0.16,
          color: colors[(rng() * colors.length) | 0],
        });
      }
    };
    for (const [fx, t] of [[0.15, 0.05], [0.205, 0.062], [0.27, 0.046]]) {
      mound(W * fx, yAt(t), (0.02 + t) * H * 0.15, HAYSTACK, 26, false);
    }
    for (const fx of [0.535, 0.552]) {
      const t = 0.07;
      mound(W * fx, yAt(t), (0.02 + t) * H * 0.12, FIGURE, 10, true);
    }

    release(fieldLayer);
    fieldLayer = c;

    // the moving foreground: big strokes covering the ground and interlocking,
    // thinned a little where the density mass is low
    const n = Math.round(clamp((W * fieldH) / 230, 900, 3200) * density * ((tMax - 0.42) / 0.83));
    for (let i = 0; i < n; i++) {
      const t = 0.42 + rng() * (tMax - 0.42), x = -40 + rng() * (W + 80), y = yAt(t);
      if (fbm(x * 0.003 + 90, t * 5) < 0.35 && rng() < 0.4) continue;
      // through the dissolve only some survive, plus a few strays below the edge
      const stray = rng() < 0.012 && intoDissolve(x, y) < 0.8;
      if (rng() > paintDensity(x, y) && !stray) continue;
      const d = makeFieldStroke(rng, x, y, t);
      if (d.y + d.width * 0.6 > CH - 6) continue; // never cut off by the canvas's bottom edge
      dabs.push(d);
    }
    dabs.sort((a, b) => a.t - b.t); // back to front
  }

  // the sky's broad swirling flow lines, which its strokes (painted and drifting) follow
  const skyFlow = (x, y) => {
    const swirl = fbm(x * 0.0016, y * 0.004);
    return (swirl - 0.5) * 2.6 + Math.sin(y * 0.012 + swirl * 5) * 0.35;
  };

  // Sky strokes laid over the hour's sky colour: light, deep blue, turquoise
  // and pale yellow, translucent so the same texture works at any hour, of
  // varied size and following broad swirling flow lines.
  function* buildSkyTexture() {
    const [c, g] = offscreen(W * dpr, horizonY * dpr);
    g.scale(dpr, dpr);
    const rng = mulberry32(3);
    const u = clamp(Math.min(W, H) / 800, 0.6, 1.3);
    // dense and low-contrast, so the strokes weave into one surface instead
    // of floating as separate marks
    const n = Math.round(((W * horizonY) / (190 * u * u)) * density);
    for (let i = 0; i < n; i++) {
      if (i % 30 === 29) yield;
      const x = rng() * W, y = rng() * horizonY, f = y / horizonY;
      const angle = skyFlow(x, y);
      const size = 0.6 + fbm(x * 0.003 + 40, y * 0.006) * 1.1;
      const len = (26 + rng() * 40) * u * size;
      const r = rng();
      // deep blue gathers overhead, pale yellow toward the horizon
      const color = r < 0.22 ? [240, 248, 236]
        : r < 0.22 + 0.3 * (1 - f) ? [30, 64, 150]
        : r < 0.78 ? [100, 186, 176]
        : [228, 230, 156];
      paintStroke(g, rng, {
        x: x - Math.cos(angle) * len / 2, y: y - Math.sin(angle) * len / 2, angle, len,
        width: len * (0.16 + rng() * 0.08), color, streak: [150, 200, 190],
        bend: (rng() - 0.5) * 0.2, alpha: 0.07 + rng() * 0.05,
      });
    }
    release(skyTex);
    skyTex = c;
  }

  // The sun (or moon) as a painted orb: a thick disc of short strokes swirling
  // round its centre, ringed by a halo of short strokes in concentric arcs of
  // uneven length and spacing, fading from pale yellow through yellow-green
  // into the sky, with a few orange-yellow strokes echoing the field.
  // the painted sun is re-brushed only when its colour or the sky around it changes noticeably
  const orbKey = (sun) => [sun.color, state.light.mid].map((c) => c.map((v) => Math.round(v / 12)).join(',')).join('|');
  function renderOrb(color, cream, sky, haloAlpha) {
    const out = {};
    for (const _ of orbSteps(color, cream, sky, haloAlpha, out));
    return out.canvas;
  }
  function* orbSteps(color, cream, sky, haloAlpha, out) {
    const rng = mulberry32(9);
    const size = ORB_R * 9;
    const [c, g] = offscreen(size, size);
    const m = size / 2;
    const ringColor = (k) => k < 1.9 ? mixRGB(color, [255, 250, 214], 0.45)
      : k < 2.8 ? mixRGB([206, 226, 142], color, 0.25)
      : sky ? mixRGB([170, 214, 186], sky, 0.5) : mixRGB(color, [160, 170, 200], 0.6);
    for (let k = 1.2; k < 4.2; k += 0.22 + rng() * 0.16) {
      yield;
      const fade = 1 - (k - 1.2) / 3.2;
      for (let a = rng() * 0.4; a < TAU; a += (0.14 + rng() * 0.2) * (1.7 / k)) {
        const r = k * ORB_R + (rng() - 0.5) * ORB_R * 0.1, len = (0.3 + rng() * 0.35) * ORB_R;
        const echo = sky && k > 2 && rng() < 0.08;
        // laid along the arc, so the rings read as circles of short strokes
        const start = a - len / (2 * r);
        paintStroke(g, rng, {
          x: m + Math.cos(start) * r, y: m + Math.sin(start) * r, angle: a + Math.PI / 2, len,
          width: ORB_R * (0.09 + rng() * 0.05), bend: -len / (8 * r),
          color: echo ? [240, 180, 70] : ringColor(k), alpha: haloAlpha * (0.2 + 0.45 * fade),
        });
      }
    }
    // a solid disc, then thick swirling strokes worked into it and kept
    // inside its slightly uneven edge
    const disc = new Path2D();
    for (let a = 0; a < TAU; a += 0.15) {
      const r = ORB_R * (1 + (rng() - 0.5) * 0.04);
      disc.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r);
    }
    disc.closePath();
    yield;
    g.fillStyle = rgb(color);
    g.fill(disc);
    g.save();
    g.clip(disc);
    for (let k = 0.15; k < 1.05; k += 0.16) {
      yield;
      for (let a = rng(); a < TAU; a += 0.5 + rng() * 0.5) {
        const r = k * ORB_R;
        paintStroke(g, rng, {
          x: m + Math.cos(a) * r, y: m + Math.sin(a) * r, angle: a + Math.PI / 2,
          len: ORB_R * (0.5 + rng() * 0.5), width: ORB_R * 0.32, bend: 0.2,
          color: rng() < 0.4 ? cream : color, streak: cream,
        });
      }
    }
    g.restore();
    out.canvas = c;
  }

  // ---------- the town ----------

  // The town, painted from the SKYLINE design. Each building's outline is a
  // clean path with only a slight, slow waver, filled and then worked over
  // with short opaque strokes that follow its form: vertical on walls and
  // towers, along the slope on roofs, horizontal on long low buildings,
  // curved on the arena and the round tower. Rim-light strokes for faces
  // turned left and right go on two separate layers, so each frame can light
  // whichever faces point toward the sun.
  function* buildTown() {
    const k0 = Math.min(W, H * 2) / 100; // px per % of layout width
    const hU = Math.min(H, W * 0.75) / 100; // px per % of height
    const base = horizonY + 3; // the common ground line, just under the ochre strip
    const top = Math.max(0, base - 34 * hU);
    const [c, g] = offscreen(W * dpr, (base + 5 - top) * dpr);
    const [rimL, gl] = offscreen(c.width, c.height);
    const [rimR, gr] = offscreen(c.width, c.height);
    for (const layer of [g, gl, gr]) {
      layer.scale(dpr, dpr);
      layer.translate(0, -top); // draw in screen coordinates
    }
    const rng = mulberry32(17);
    const pick = (list) => list[(rng() * list.length) | 0];
    const tone = (list) => shadeRGB(pick(list), 0.94 + rng() * 0.12); // a narrow value range within each shape
    const sw = clamp(k0 * 0.32, 2.6, 5); // the brush, scaled down for the town
    const windows = [], footprints = [], tops = [], chimneys = [];
    // with the wind on, the smoke rises live from the chimneys instead; its
    // strokes are still brushed (off to one side) so the town comes out the same
    const sg = windOn ? offscreen(1, 1)[1] : g;

    // lay the sections out across the screen; extra width on wide screens
    // goes to the stretchable ones
    const extra = W - k0 * 100;
    const totalWeight = SECTIONS.reduce((sum, s) => sum + s[2], 0);
    let cursor = 0;
    const spans = SECTIONS.map(([a, b, weight]) => {
      const width = (b - a) * k0 + extra * (weight / totalWeight);
      const span = { a, b, start: cursor, width, scale: Math.min(1.6, width / ((b - a) * k0)) };
      cursor += width;
      return span;
    });
    const spanOf = (p) => spans.find((s) => p < s.b) || spans[spans.length - 1];
    const X = (p) => {
      const s = spanOf(p);
      return s.start + ((p - s.a) / (s.b - s.a)) * s.width;
    };
    const widthOf = (e) => Math.max(3, e.w * k0 * spanOf(e.x + e.w / 2).scale);

    // outlines waver only slightly and slowly: hand-drawn, but straight
    const wob = (a, b) => (noise2(a * 0.02 + 3.1, b * 0.02 + 7.7) - 0.5) * 3;
    const shape = (pts) => {
      const p = new Path2D();
      pts.forEach(([ax, ay], i) => {
        const [bx, by] = pts[(i + 1) % pts.length];
        const steps = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 8));
        for (let s = 0; s < steps; s++) {
          const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps;
          const ground = y >= base - 0.5; // the ground line stays level
          p.lineTo(x + (ground ? 0 : wob(x, y)), y + (ground ? 0 : wob(y + 40, x)));
        }
      });
      p.closePath();
      return p;
    };
    const boxOf = (pts) => {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    };

    // fill a shape, then work it over with short opaque dabs laid along `angle`
    const paintShape = function* (pts, colors, angle, bend = 0) {
      const path = shape(pts), box = boxOf(pts);
      g.fillStyle = rgb(colors[0]);
      g.fill(path);
      g.save();
      g.clip(path);
      const cos = Math.cos(angle), sin = Math.sin(angle), px = -sin, py = cos;
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.hypot(box.w, box.h) / 2 + sw;
      for (let o = -R; o <= R; o += sw * 0.75) {
        yield; // a row at a time, so a big building never stalls the page
        for (let s = -R - rng() * sw * 2; s < R;) {
          const len = sw * (2 + rng() * 2.5);
          paintStroke(g, rng, {
            x: cx + px * o + cos * s, y: cy + py * o + sin * s, angle: angle + (rng() - 0.5) * 0.1,
            len, width: sw, color: tone(colors), streak: tone(colors), bend, alpha: 0.95, bristles: 4,
          });
          s += len * 0.75;
        }
      }
      g.restore();
      // whatever stands in front hides the rim light of what's behind it
      for (const layer of [gl, gr]) {
        layer.save();
        layer.globalCompositeOperation = 'destination-out';
        layer.fill(path);
        layer.restore();
      }
    };

    // a thin warm rim just inside an edge, on the layer for the way it faces
    const rim = ([x1, y1], [x2, y2], side) => {
      const inset = side < 0 ? sw * 0.4 : -sw * 0.4;
      paintStroke(side < 0 ? gl : gr, rng, {
        x: x1 + inset, y: y1, angle: Math.atan2(y2 - y1, x2 - x1), len: Math.hypot(x2 - x1, y2 - y1),
        width: sw * 0.7, color: TOWN.rim, alpha: 0.9, bristles: 3,
      });
    };

    const pitchOf = (e) => ((e.pitch || 30) * Math.PI) / 180;
    const roofOf = (x0, w, y, e) => {
      const o = k0 * 0.15, xl = x0 - o, xr = x0 + w + o, pitch = pitchOf(e);
      if (e.roof === 'hip') {
        const rh = Math.min(((xr - xl) / 2) * Math.tan(pitch), w * 0.28), inset = rh / Math.tan(pitch);
        return [[xl, y], [xl + inset, y - rh], [xr - inset, y - rh], [xr, y]];
      }
      return [[xl, y], [(xl + xr) / 2, y - ((xr - xl) / 2) * Math.tan(pitch)], [xr, y]];
    };

    const smoke = (cx, cy, plume) => {
      const n = plume ? 34 : 14;
      for (let j = 0; j < n; j++) {
        const p = j / (n - 1);
        const x = cx - p * k0 * (plume ? 9 : 4) - Math.sin(p * 5.5) * k0 * 1.2 * p;
        const y = cy - p * hU * (plume ? 13 : 7) + Math.sin(p * 4) * hU * 0.8 * p;
        for (let s = 0; s < (plume ? 3 : 1); s++) {
          paintStroke(sg, rng, {
            x: x + (rng() - 0.5) * k0 * p, y: y + (rng() - 0.5) * hU * p,
            angle: Math.PI + 0.5 * Math.sin(p * 8 + s) - 0.3, len: (plume ? 1.2 + p * 2.6 : 0.8 + p) * k0,
            width: (plume ? 0.5 + p * 1.6 : 0.3 + p * 0.4) * k0, bend: 0.35,
            color: pick(TOWN.smoke), alpha: (plume ? 0.08 : 0.05) * (1 - p * 0.6),
          });
        }
      }
    };

    const PAINTERS = {
      *block(e, x0, w, h, colors) {
        const yt = base - h, pts = [[x0, base], [x0, yt]];
        let apex = null;
        if (e.roof === 'gable') {
          apex = roofOf(x0, w, yt, e)[1];
          pts.push(apex);
        }
        pts.push([x0 + w, yt], [x0 + w, base]);
        yield* paintShape(pts, colors, -Math.PI / 2);
        rim([x0, base], [x0, yt], -1);
        rim([x0 + w, base], [x0 + w, yt], 1);
        if (apex) {
          rim([x0, yt], apex, -1);
          rim([x0 + w, yt], apex, 1);
        }
      },

      *tower(e, x0, w, h, colors) {
        const yt = base - h, o = w * 0.12;
        yield* paintShape([[x0, base], [x0, yt], [x0 + w, yt], [x0 + w, base]], colors, -Math.PI / 2);
        rim([x0, base], [x0, yt], -1);
        rim([x0 + w, base], [x0 + w, yt], 1);
        if (e.top === 'spire' || e.top === 'gothic') {
          const gothic = e.top === 'gothic', sh = (e.spire || 3.4) * hU, bw = gothic ? w * 0.7 : w + 2 * o;
          const bx = x0 + w / 2 - bw / 2;
          // leaning very slightly, and a touch off-centre
          const apex = [x0 + w / 2 + (e.lean || 0) * sh * 3 + w * 0.06, yt - sh];
          const roof = [[bx, yt], apex, [bx + bw, yt]];
          yield* paintShape(roof, colors, Math.atan2(apex[1] - yt, apex[0] - bx));
          rim([bx, yt], apex, -1);
          rim([bx + bw, yt], apex, 1);
          if (gothic) {
            for (const px of [x0, x0 + w * 0.76]) {
              const pin = [[px, yt], [px + w * 0.12, yt - hU * 1.6], [px + w * 0.24, yt]];
              yield* paintShape(pin, colors, -Math.PI / 2);
            }
          }
        } else if (e.top === 'pyramid') {
          const apex = [x0 + w / 2, yt - w * 0.55];
          yield* paintShape([[x0 - o, yt], apex, [x0 + w + o, yt]], colors, -0.6);
          rim([x0 - o, yt], apex, -1);
          rim([x0 + w + o, yt], apex, 1);
        } else {
          yield* paintShape([[x0 - o, yt], [x0 - o, yt - w * 0.18], [x0 + w + o, yt - w * 0.18], [x0 + w + o, yt]], colors, 0);
        }
      },

      *chimney(e, x0, w, h) {
        const tw = w * 0.72, cx = x0 + w / 2, yt = base - h;
        const colors = [TOWN.near[0], TOWN.warm, TOWN.near[1]];
        yield* paintShape([[x0, base], [cx - tw / 2, yt], [cx + tw / 2, yt], [x0 + w, base]], colors, -Math.PI / 2);
        const band = h * 0.07;
        yield* paintShape([[cx - tw / 2 - 0.6, yt], [cx - tw / 2 - 0.6, yt + band], [cx + tw / 2 + 0.6, yt + band], [cx + tw / 2 + 0.6, yt]],
          [shadeRGB(TOWN.near[0], 0.7)], 0);
        rim([x0, base], [cx - tw / 2, yt], -1);
        rim([x0 + w, base], [cx + tw / 2, yt], 1);
        if (e.smoke) {
          smoke(cx, yt, e.smoke === 'plume');
          chimneys.push({ x: cx, y: yt, w: tw, plume: e.smoke === 'plume' });
        }
      },

      *shed(e, x0, w, h) {
        const yt = base - h, rise = hU * 0.9, teeth = Math.max(3, Math.round(w / (k0 * 1.3)));
        const pts = [[x0, base], [x0, yt]];
        for (let i = 0; i < teeth; i++) pts.push([x0 + (w * i) / teeth, yt - rise], [x0 + (w * (i + 1)) / teeth, yt]);
        pts.push([x0 + w, base]);
        yield* paintShape(pts, [TOWN.near[1], TOWN.near[0], TOWN.warm], 0);
        rim([x0, base], [x0, yt - rise], -1);
        rim([x0 + w, base], [x0 + w, yt], 1);
      },

      *windmill(e, x0, w, h) {
        const cx = x0 + w / 2, yt = base - h;
        yield* paintShape([[x0, base], [cx - w * 0.3, yt], [cx + w * 0.3, yt], [x0 + w, base]], TOWN.mill, -Math.PI / 2);
        yield* paintShape([[cx - w * 0.38, yt], [cx, yt - w * 0.35], [cx + w * 0.38, yt]], TOWN.mill, -0.6);
        rim([x0, base], [cx - w * 0.3, yt], -1);
        rim([x0 + w, base], [cx + w * 0.3, yt], 1);
        for (let i = 0; i < 4; i++) {
          paintStroke(g, rng, {
            x: cx, y: yt - w * 0.1, angle: Math.PI / 4 + (i * Math.PI) / 2, len: h * 0.75,
            width: Math.max(1.5, w * 0.16), color: TOWN.mill[0], bristles: 3,
          });
        }
      },

      *house(e, x0, w, h) {
        const yt = base - h, roof = roofOf(x0, w, yt, e), pitch = pitchOf(e);
        yield* paintShape([[x0, base], [x0, yt], [x0 + w, yt], [x0 + w, base]], TOWN.walls, -Math.PI / 2);
        rim([x0, base], [x0, yt], -1);
        rim([x0 + w, base], [x0 + w, yt], 1);
        for (let i = 0; i < (e.windows || 0); i++) {
          const wx = x0 + (w * (i + 1)) / (e.windows + 1), wy = yt + h * 0.62;
          paintStroke(g, rng, {
            x: wx, y: wy, angle: -Math.PI / 2, len: Math.max(2, h * 0.3), width: Math.max(1.4, k0 * 0.25),
            color: TOWN.window, bristles: 2,
          });
          windows.push({ x: wx, y: wy - h * 0.15 });
        }
        if (e.stub) {
          const sx = x0 + w * 0.68, sy = yt - (roof[1][1] - yt) * -0.4;
          yield* paintShape([[sx, sy], [sx, roof[1][1] - hU * 0.5], [sx + k0 * 0.35, roof[1][1] - hU * 0.5], [sx + k0 * 0.35, sy]],
            [TOWN.near[0], TOWN.warm], -Math.PI / 2);
        }
        g.fillStyle = rgb(TOWN.roofs[0]);
        g.fill(shape(roof)); // under the facets, so no seams show between them
        const [p0, p1] = roof, pN = roof[roof.length - 1], pR = roof[roof.length - 2];
        yield* paintShape([p0, p1, [p1[0], p0[1]]], TOWN.roofs, -pitch);
        if (roof.length === 4) yield* paintShape([[p1[0], p0[1]], p1, pR, [pR[0], p0[1]]], TOWN.roofs, 0);
        yield* paintShape([[pR[0], p0[1]], pR, pN], TOWN.roofs, pitch);
        rim(p0, p1, -1);
        rim(pN, pR, 1);
      },

      *arena(e, x0, w, h) {
        const pts = [[x0, base]];
        for (let i = 0; i <= 16; i++) {
          const f = i / 16;
          pts.push([x0 + w * f, base - h - Math.sin(Math.PI * f) * hU * 0.6]);
        }
        pts.push([x0 + w, base]);
        yield* paintShape(pts, TOWN.near, 0, 0.18);
        // two tiers of arched openings
        for (const [y0, y1] of [[0.12, 0.46], [0.56, 0.88]]) {
          for (let i = 0; i < e.arches; i++) {
            const aw = (w / e.arches) * 0.5, ax = x0 + (w * (i + 0.5)) / e.arches - aw / 2;
            const yb = base - h * y0, ya = base - h * y1;
            const p = new Path2D();
            p.moveTo(ax, yb);
            p.lineTo(ax, ya + aw / 2);
            p.arc(ax + aw / 2, ya + aw / 2, aw / 2, Math.PI, 0);
            p.lineTo(ax + aw, yb);
            p.closePath();
            g.fillStyle = rgb(TOWN.arch);
            g.fill(p);
          }
        }
        rim([x0, base], [x0, base - h], -1);
        rim([x0 + w, base], [x0 + w, base - h], 1);
      },

      *round(e, x0, w, h) {
        const yt = base - h;
        yield* paintShape([[x0, base], [x0, yt], [x0 + w, yt], [x0 + w, base]], TOWN.near, 0, 0.3);
        yield* paintShape([[x0 - 1, yt], [x0 - 1, yt - hU * 0.5], [x0 + w + 1, yt - hU * 0.5], [x0 + w + 1, yt]],
          [shadeRGB(TOWN.near[1], 0.8)], 0, 0.2);
        rim([x0, base], [x0, yt], -1);
        rim([x0 + w, base], [x0 + w, yt], 1);
      },

      *wall(e, x0, w, h) {
        yield* paintShape([[x0, base], [x0, base - h], [x0 + w, base - h], [x0 + w, base]], [TOWN.warm, TOWN.near[2]], 0);
      },

      // rounded masses of short curved dabs, the middle one tallest
      *trees(e, x0, w, h) {
        for (const [fx, fh, fr] of [[0.22, 0.55, 0.3], [0.5, 1.0, 0.36], [0.8, 0.7, 0.3]]) {
          yield;
          const r = w * fr, cx = x0 + w * fx, cy = base - h * fh + r;
          const p = new Path2D();
          p.arc(cx, cy, r, 0, TAU);
          p.rect(cx - r * 0.85, cy, r * 1.7, base - cy);
          g.fillStyle = rgb(TOWN.trees[0]);
          g.fill(p);
          g.save();
          g.clip(p);
          for (let i = 0; i < (r * r) / (sw * 1.2); i++) {
            const a = rng() * TAU, d = Math.sqrt(rng()) * r * 1.1;
            paintStroke(g, rng, {
              x: cx + Math.cos(a) * d, y: Math.min(base, cy + Math.sin(a) * d), angle: a + Math.PI / 2,
              len: sw * 1.6, width: sw * 1.1, bend: 0.4, color: tone(TOWN.trees), bristles: 3,
            });
          }
          g.restore();
          for (const layer of [gl, gr]) {
            layer.save();
            layer.globalCompositeOperation = 'destination-out';
            layer.fill(p);
            layer.restore();
          }
        }
      },
    };

    for (const e of SKYLINE) {
      yield;
      const x0 = X(e.x), w = widthOf(e), h = e.h * hU;
      yield* PAINTERS[e.type](e, x0, w, h, e.layer === 'far' ? TOWN.far : TOWN.near);
      if (e.layer !== 'far') footprints.push([x0, w]);
      // roughly how high each building reaches, so page text can keep clear of it
      const reach = h + (e.spire || 0) * hU + (e.top ? w * 0.6 : 0) + (e.roof ? w * 0.3 : 0) + (e.type === 'windmill' ? h * 0.75 : 0);
      tops.push([x0, x0 + w, base - reach]);
    }

    // a thin dark shadow along the foot of every building plants it in the field
    for (const [x0, w] of footprints) {
      for (let x = x0; x < x0 + w; x += sw * 3) {
        paintStroke(g, rng, {
          x, y: base - 2.5, angle: 0, len: Math.min(sw * 4, x0 + w - x), width: 2,
          color: TOWN.shadow, alpha: 0.7, bristles: 2,
        });
      }
    }

    if (town) [town.canvas, town.rimL, town.rimR].forEach(release);
    town = { canvas: c, rimL, rimR, top, h: c.height / dpr, glows: windows, glowSize: Math.max(8, hU * 2), tops, hU, k0, chimneys };
  }

  // a fine canvas weave with a little grain, laid over the whole image
  function buildGrain() {
    const size = 96;
    const [c, g] = offscreen(size, size);
    const img = g.createImageData(size, size);
    const rng = mulberry32(5);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const weave = Math.sin((x * TAU) / 3) * Math.sin((y * TAU) / 3) * 22 + ((x + y) % 6 < 3 ? 8 : -8);
        const v = clamp(128 + weave + (rng() - 0.5) * 50, 0, 255);
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    grain = ctx.createPattern(c, 'repeat');
    grainField = fieldCtx.createPattern(c, 'repeat');
  }

  function buildFireflies() {
    fireflies = Array.from({ length: Math.round(clamp(W / 50, 10, 36)) }, () => ({
      x: Math.random() * W,
      y: rand(horizonY + fieldH * 0.2, H * 0.95),
      vx: 0, vy: 0,
      ph: rand(0, TAU),
      sp: rand(0.6, 1.4),
    }));
  }

  // ---------- wind in the sky and the smoke ----------
  // The shared wind moves the sky and the smoke. The painted sky underneath
  // never changes: a few hundred loose strokes drift over it on their own
  // layer, each stamped from a stroke pre-painted with the same brush and
  // coloured from the sky beneath it. Under prefers-reduced-motion none of
  // this runs, and the town keeps its painted smoke instead.

  let windRng = mulberry32(101), windDirty = false, windKey = '', recolorT = -1, retintAt = 0, retintAll = 0;
  let windStamps = [], windStrokes = [], smokeStamps = [], smokeTinted = [], puffs = [], emitters = [];
  let texLook = null;
  const skyLook = new Float32Array(LOOK_W * LOOK_H * 3);
  const [windBuf, windCtx] = offscreen(1, 1);
  const [smokeBuf, smokeCtx] = offscreen(1, 1);
  const curl = [0, 0];

  // how many strokes drift over the sky: about 250 on a laptop, 100 on a phone
  const windTarget = () => Math.round(clamp((W * horizonY) / 2400, 100, 250) * state.quality);

  function* buildWind() {
    windBuf.width = smokeBuf.width = windOn ? Math.round(W * dpr) : 1;
    windBuf.height = smokeBuf.height = windOn ? Math.round(horizonY * dpr) : 1;
    windDirty = true;
    puffs = [];
    windStrokes = [];
    if (!windOn) return;
    const rng = mulberry32(41), u = clamp(Math.min(W, H) / 800, 0.6, 1.3), { k0, hU } = town;
    windRng = mulberry32(101); // the same start on every load
    windStamps = [];
    for (let i = 0; i < WIND_STAMPS; i++) {
      const len = (28 + (i % 6) * 9 + rng() * 8) * u;
      windStamps.push(paintStamp(rng, len, len * (0.15 + rng() * 0.09), (rng() - 0.5) * 0.24, dpr));
      yield;
    }
    // curling smoke strokes, painted at their full grown size
    smokeStamps = [];
    for (let i = 0; i < SMOKE_STAMPS; i++) {
      smokeStamps.push(paintStamp(rng, k0 * (2.4 + rng() * 0.8), k0 * (1 + rng() * 0.4), 0.3 + rng() * 0.15, dpr));
      yield;
    }
    smokeTinted = [];

    // the painted sky texture, shrunk to the lookup grid once
    const [, lg] = offscreen(LOOK_W, LOOK_H);
    lg.imageSmoothingQuality = 'high';
    lg.drawImage(skyTex, 0, 0, LOOK_W, LOOK_H);
    texLook = lg.getImageData(0, 0, LOOK_W, LOOK_H).data;
    yield;
    recolor();
    yield;

    recolorT = -1;
    const n = windTarget();
    for (let i = 0; i < n; i++) {
      const s = {};
      spawnStroke(s, true);
      windStrokes.push(s);
      if (i % 8 === 7) yield;
    }

    // each chimney at its own pace; the tall one on the right only a thin wisp
    emitters = town.chimneys.map((c, i) => ({
      ...c, acc: rng(), phase: rng() * TAU,
      rate: c.plume ? 10 - i * 1.5 : 7, life: c.plume ? [6, 10] : [5, 8], grow: c.plume ? [2.2, 3] : [2, 2.5],
      peak: c.plume ? 0.2 : 0.05, size: c.plume ? 1 : 0.5,
      rise: (c.plume ? 3 : 2.2) * hU, drift: (c.plume ? 1.4 : 0.8) * k0, swirl: (c.plume ? 0.35 : 0.25) * k0,
    }));
    // run the smoke for ten seconds first, so the plumes are already up (on
    // a clock of its own: the wind's is shared, and never set back)
    for (let end = wind.t, t = end - 10, n = 0; t < end; t += 1 / 30) {
      updateSmoke(1 / 30, wind.gustAt(t), t);
      if (++n % 10 === 0) yield;
    }
    windDirty = true;
  }

  // The base sky's colour on the lookup grid, as drawn for this hour: the
  // gradient under the painted texture. Recolours the strokes and smoke to suit.
  function recolor() {
    const light = state.light;
    windKey = lightKey();
    const k = 1 - light.dark * 0.35;
    for (let j = 0; j < LOOK_H; j++) {
      const f = (j + 0.5) / LOOK_H;
      const grad = f < 0.6 ? mixRGB(light.top, light.mid, f / 0.6) : mixRGB(light.mid, light.horizon, (f - 0.6) / 0.4);
      for (let i = 0; i < LOOK_W; i++) {
        const p = (j * LOOK_W + i) * 4, q = (j * LOOK_W + i) * 3, a = (texLook[p + 3] / 255) * k;
        for (let c = 0; c < 3; c++) skyLook[q + c] = texLook[p + c] * a + grad[c] * (1 - a);
      }
    }
    // the smoke takes the hour's light like the town, but turns a lighter grey-blue at night
    const lit = (c) => c.map((v, i) => (v * light.tint[i]) / 255);
    const colors = TOWN.smoke.map((c) => mixRGB(lit(c), SMOKE_NIGHT, light.dark * 0.85));
    colors.push(mixRGB(colors[1], mixRGB(lit([196, 202, 218]), SMOKE_NIGHT, light.dark * 0.6), 0.4)); // the wisp, lighter
    smokeTinted = colors.map((c, ci) => smokeStamps.map((stamp, i) => tintInto(smokeTinted[ci]?.[i], stamp, c)));
    retintAll = windStrokes.length; // the strokes follow over the next few frames
    windDirty = true;
  }

  const lightKey = () => {
    const light = state.light;
    return light.top.concat(light.mid, light.horizon, light.tint).map((v) => Math.round(v / 3)).join() + light.dark.toFixed(2);
  };

  function sampleSky(x, y) {
    const fx = clamp((x / W) * LOOK_W - 0.5, 0, LOOK_W - 1.001), fy = clamp((y / horizonY) * LOOK_H - 0.5, 0, LOOK_H - 1.001);
    const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, q = (j * LOOK_W + i) * 3, r = q + LOOK_W * 3;
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      out[c] = lerp(lerp(skyLook[q + c], skyLook[q + 3 + c], tx), lerp(skyLook[r + c], skyLook[r + 3 + c], tx), ty);
    }
    return out;
  }

  // the sky's colour under a stroke, a little lighter or deeper (deeper blues at night)
  const windColor = (s) => {
    const dark = state.light.dark;
    return mixRGB(sampleSky(s.x, s.y), s.shade > 0 ? mixRGB(LIFT_DAY, LIFT_NIGHT, dark) : mixRGB(DEEP_DAY, DEEP_NIGHT, dark), Math.abs(s.shade));
  };

  // Sets a stroke off from a fresh spot: the best of three candidates, the
  // one furthest from the others, so the strokes stay evenly spread. Some
  // start off the right edge and drift in.
  function spawnStroke(s, midLife) {
    let bx = 0, by = 0, best = -1;
    for (let k = 0; k < 3; k++) {
      const x = -20 + windRng() * (W + wind.speed * 6 + 20), y = windRng() * horizonY * 0.95;
      let d = Infinity;
      for (const o of windStrokes) if (o !== s) d = Math.min(d, (o.x - x) ** 2 + (o.y - y) ** 2);
      if (d > best) [best, bx, by] = [d, x, y];
    }
    Object.assign(s, {
      x: bx, y: by, stamp: (windRng() * WIND_STAMPS) | 0,
      life: 8 + windRng() * 7, fadeIn: 2 + windRng(), fadeOut: 2 + windRng(), peak: 0.4 + windRng() * 0.4,
      scale: 0.8 + windRng() * 0.45, sf: 0.75 + windRng() * 0.5, shade: (windRng() < 0.5 ? 1 : -1) * (0.06 + windRng() * 0.08),
    });
    s.age = midLife ? windRng() * s.life : 0;
    windVelocity(s, wind.gust, sunAt(state.hour));
    s.a = Math.atan2(s.vy, s.vx);
    s.color = windColor(s);
    s.canvas = tintInto(s.canvas, windStamps[s.stamp], s.color);
  }

  // Along the sky's flow lines, heading downwind, plus swirl; near the sun,
  // drawn a little into the halo's slow circling.
  function windVelocity(s, gust, sun) {
    const fa = skyFlow(s.x, s.y);
    let fx = Math.cos(fa), fy = Math.sin(fa);
    if (fx > 0) [fx, fy] = [-fx, -fy];
    wind.curlAt(s.x, s.y, wind.t, curl);
    const sp = wind.speed * s.sf * gust * (1 - state.light.dark * 0.2); // a little slower at night
    let vx = (0.6 * fx + 0.4 * wind.dir[0] + 0.3 * curl[0]) * sp, vy = (0.6 * fy + 0.3 * curl[1]) * sp;
    if (sun) {
      const dx = s.x - sun.x, dy = s.y - sun.y, d = Math.hypot(dx, dy);
      const pull = 0.7 * (1 - smooth(sun.r * 1.5, sun.r * 5, d));
      if (pull > 0 && d > 1) {
        const m = Math.hypot(vx, vy);
        vx = lerp(vx, (-dy / d) * m, pull);
        vy = lerp(vy, (dx / d) * m, pull);
      }
    }
    s.vx = vx;
    s.vy = vy;
  }

  // once per frame, after the wind has advanced
  function updateWind(dt) {
    // when the hour's light changes, recolour, at most five times a second
    if (lightKey() !== windKey && wind.t - recolorT > 0.2) {
      recolorT = wind.t;
      recolor();
    }
    const sun = sunAt(state.hour), target = windTarget();
    for (let i = windStrokes.length - 1; i >= 0; i--) {
      const s = windStrokes[i];
      s.age += dt;
      if (s.age >= s.life) {
        // faded out: set off again somewhere else, unless there are too many
        if (windStrokes.length > target) {
          windStrokes.splice(i, 1);
          continue;
        }
        spawnStroke(s, false);
      }
      windVelocity(s, wind.gust, sun);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      // turn smoothly to face the way it's moving
      let da = Math.atan2(s.vy, s.vx) - s.a;
      da -= TAU * Math.round(da / TAU);
      s.a += da * Math.min(1, dt * 2);
    }
    while (windStrokes.length < target) {
      const s = {};
      spawnStroke(s, false);
      windStrokes.push(s);
    }
    // A few strokes a frame take on the colour of the sky they've drifted
    // over; after the hour's light changes, all of them, 64 a frame.
    const all = retintAll > 0, n = all ? Math.min(retintAll, 64) : Math.ceil(windStrokes.length / 30);
    for (let k = n; k > 0 && windStrokes.length; k--) {
      const s = windStrokes[retintAt++ % windStrokes.length], c = windColor(s);
      if (all || Math.abs(c[0] - s.color[0]) + Math.abs(c[1] - s.color[1]) + Math.abs(c[2] - s.color[2]) > 6) {
        s.color = all ? c : mixRGB(s.color, c, 0.5);
        tintInto(s.canvas, windStamps[s.stamp], s.color);
      }
    }
    if (all) retintAll -= n;
    updateSmoke(dt, wind.gust);
    windDirty = true;
  }

  // Smoke rises from each chimney, slowing as it cools, and bends over with
  // the wind; gusts push it further sideways and the swirl makes it billow.
  function updateSmoke(dt, gust, t = wind.t) {
    for (const e of emitters) {
      e.acc += dt * e.rate * state.quality * (1 + 0.3 * Math.sin(t * 0.9 + e.phase));
      for (; e.acc >= 1; e.acc--) {
        puffs.push({
          e, x: e.x + (windRng() - 0.5) * e.w * 0.6, y: e.y, age: 0, life: lerp(e.life[0], e.life[1], windRng()),
          grow: lerp(e.grow[0], e.grow[1], windRng()), a0: Math.PI - 0.3 + (windRng() - 0.5), spin: (windRng() - 0.5) * 0.08,
          stamp: (windRng() * SMOKE_STAMPS) | 0, color: e.plume ? (windRng() * 3) | 0 : 3, peak: e.peak * (0.7 + windRng() * 0.6),
        });
      }
    }
    let n = 0;
    for (const p of puffs) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const e = p.e, a = p.age, stir = e.swirl * Math.min(1, a / 2);
      wind.curlAt(p.x, p.y, t, curl);
      p.x += (e.drift * wind.dir[0] * gust * (1 - Math.exp(-a / 0.8)) + curl[0] * stir) * dt;
      p.y += (-e.rise * (Math.exp(-a / 3) + 0.15) + curl[1] * stir) * dt;
      puffs[n++] = p; // kept in order, so overlapping puffs never swap
    }
    puffs.length = n;
  }

  // the moving strokes and the smoke, each onto its own layer over the sky
  function renderWind() {
    const night = 1 - state.light.dark * 0.35, stretch = 1 + 0.18 * (wind.gust - 1);
    let g = windCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, windBuf.width, windBuf.height);
    for (const s of windStrokes) {
      const alpha = s.peak * night * smooth(0, s.fadeIn, s.age) * (1 - smooth(s.life - s.fadeOut, s.life, s.age)) *
        (1 - smooth(horizonY * 0.86, horizonY, s.y)); // thinning out toward the town
      if (alpha < 0.004) continue;
      const c = s.canvas, cos = Math.cos(s.a), sin = Math.sin(s.a), sx = s.scale * stretch, sy = s.scale;
      g.globalAlpha = alpha;
      g.setTransform(cos * sx, sin * sx, -sin * sy, cos * sy, s.x * dpr, s.y * dpr);
      g.drawImage(c, -c.width / 2, -c.height / 2);
    }
    g.globalAlpha = 1;

    // each puff grows two to three times over, turns a little and thins out as it rises
    g = smokeCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, smokeBuf.width, smokeBuf.height);
    for (const p of puffs) {
      const f = p.age / p.life, alpha = p.peak * smooth(0, 0.02, f) * Math.pow(1 - f, 1.4);
      if (alpha < 0.004) continue;
      const img = smokeTinted[p.color][p.stamp];
      const size = p.e.size * (1 / p.grow + (1 - 1 / p.grow) * (1 - (1 - f) ** 2));
      const ang = p.a0 + p.spin * p.age, cos = Math.cos(ang) * size, sin = Math.sin(ang) * size;
      g.globalAlpha = alpha;
      g.setTransform(cos, sin, -sin, cos, p.x * dpr, p.y * dpr);
      g.drawImage(img, -img.width / 2, -img.height / 2);
    }
    g.globalAlpha = 1;
    windDirty = false;
  }

  // ---------- simulation ----------

  function updateDabs(time) {
    const gust = wind.swell(time);
    const { x: px, y: py, vx: pvx, active } = pointer;

    for (const d of dabs) {
      // rolling waves of wind across the field, plus each stroke's own flutter
      let target =
        Math.sin(time * 0.0015 - d.x * 0.006 + d.y * 0.004) * 0.12 * gust +
        Math.sin(time * 0.0021 + d.ph) * 0.03;

      if (active) {
        const dx = d.x - px, dy = d.y - py, R = 24 + 64 * d.s;
        if (dx > -R && dx < R && dy > -R && dy < R) {
          const dist = Math.hypot(dx, dy);
          if (dist < R) {
            const f = 1 - dist / R;
            target += Math.sign(dx) * 0.5 * f * f; // part around the cursor
            d.v += pvx * 0.004 * f; // get swept along by the drag
          }
        }
      }

      d.v += (target - d.a) * 0.05;
      d.v *= 0.88;
      d.a = clamp(d.a + d.v, -1.2, 1.2);
    }
  }

  function updateFireflies() {
    const top = horizonY + fieldH * 0.15;
    for (const f of fireflies) {
      f.vx = (f.vx + rand(-0.05, 0.05)) * 0.97;
      f.vy = (f.vy + rand(-0.04, 0.04)) * 0.97;
      f.x += f.vx;
      f.y += f.vy;
      if (f.x < -10) f.x = W + 10;
      if (f.x > W + 10) f.x = -10;
      if (f.y < top || f.y > H - 10) f.vy *= -1;
    }
  }

  // ---------- drawing ----------

  function drawSky() {
    const light = state.light;
    if (windOn && windDirty) renderWind();
    const g = ctx.createLinearGradient(0, 0, 0, horizonY);
    g.addColorStop(0, rgb(light.top));
    g.addColorStop(0.6, rgb(light.mid));
    g.addColorStop(1, rgb(light.horizon));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizonY + 2);

    ctx.globalAlpha = 1 - light.dark * 0.35;
    ctx.drawImage(skyTex, 0, 0, W, horizonY);
    ctx.globalAlpha = 1;
    if (windOn) ctx.drawImage(windBuf, 0, 0, W, horizonY);
  }

  function drawSun() {
    const sun = sunAt(state.hour);
    if (!sun) return;
    // the painted sun is re-brushed only when its colour or the sky around it changes noticeably
    const key = orbKey(sun);
    if (key !== sunKey) {
      sunKey = key;
      sunSprite = renderOrb(sun.color, mixRGB(sun.color, [255, 250, 226], 0.55), state.light.mid, 0.9);
    }
    drawHalo(ctx, sunSprite, sun.x, sun.y, (sun.r / ORB_R) * (sunSprite.width / 2), 1, wind.t, dpr);
  }

  // a crescent within a painted halo, like the moon in The Starry Night
  function drawMoon() {
    const m = moonAt(state.hour);
    if (!m) return;
    const s = (m.r / ORB_R) * (moonSprite.width / 2);
    ctx.globalAlpha = state.light.dark;
    ctx.drawImage(moonSprite, m.x - s, m.y - s, s * 2, s * 2);
    ctx.globalAlpha = 1;
  }

  // The town is relit whenever the light changes: multiplied by the hour's
  // light, then either warmed a little near a high sun or, when the sun sinks
  // toward the skyline, darkened into silhouette around it; masked back to
  // its own shape. (A static layer: `g` is its cache, the town's own size.)
  function renderTown(g) {
    const sun = sunAt(state.hour), w = g.canvas.width, h = g.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.drawImage(town.canvas, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = rgb(state.light.tint);
    g.fillRect(0, 0, w, h);
    const sunNear = sun && sun.y < horizonY + sun.r;
    if (sunNear) {
      const sx = sun.x * dpr, sy = (horizonY - town.top) * dpr, R = W * 0.32 * dpr;
      const low = sun.up < 0.35 ? 1 - sun.up / 0.35 : 0;
      const wash = g.createRadialGradient(sx, sy, 0, sx, sy, R);
      if (low > 0) {
        wash.addColorStop(0, `rgba(20,18,36,${0.55 * low})`);
        wash.addColorStop(1, 'rgba(20,18,36,0)');
      } else {
        wash.addColorStop(0, rgb(mixRGB(sun.color, [255, 255, 255], 0.3), 0.25));
        wash.addColorStop(1, rgb(sun.color, 0));
      }
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = wash;
      g.fillRect(0, 0, w, h);
    }
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(town.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }

  // everything the town's relighting depends on
  const townKey = () => {
    const sun = sunAt(state.hour);
    return state.light.tint.join() + (sun ? `|${sun.x},${sun.y},${sun.r},${sun.up},${sun.color.join()}` : '');
  };

  // The rim light goes on the faces turned toward the sun: right-facing
  // rims left of the sun, left-facing rims right of it.
  function drawRims() {
    const sun = sunAt(state.hour), light = state.light;
    const sunNear = sun && sun.y < horizonY + sun.r;
    if (sunNear && light.dark < 0.9) {
      const w = town.canvas.width, h = town.canvas.height;
      const strength = (sun.up < 0.35 ? lerp(1, 0.6, sun.up / 0.35) : lerp(0.6, 0.3, (sun.up - 0.35) / 0.65)) * (1 - light.dark);
      const split = clamp(sun.x, 0, W), sd = split * dpr;
      ctx.globalAlpha = strength;
      if (sd >= 1) ctx.drawImage(town.rimR, 0, 0, sd, h, 0, town.top, split, town.h);
      if (w - sd >= 1) ctx.drawImage(town.rimL, sd, 0, w - sd, h, split, town.top, W - split, town.h);
      ctx.globalAlpha = 1;
    }
  }

  // after dark, the windows light up as warm yellow dabs with a soft glow
  function drawTownLights(time) {
    const light = state.light;
    if (light.dark < 0.05) return;
    const ww = Math.max(1.4, town.hU * 0.32), wh = Math.max(2, town.hU * 0.5);
    ctx.fillStyle = 'rgb(255,214,110)';
    ctx.globalAlpha = light.dark;
    for (const p of town.glows) ctx.fillRect(p.x - ww / 2, p.y - wh / 2, ww, wh);
    ctx.globalCompositeOperation = 'lighter';
    const size = town.glowSize;
    town.glows.forEach((p, i) => {
      ctx.globalAlpha = light.dark * (0.45 + 0.1 * Math.sin(time * 0.004 + i));
      ctx.drawImage(glowWarm, p.x - size / 2, p.y - size / 2, size, size);
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // The field, composed off-screen: the still layer, then the moving strokes
  // back to front, each stamped from a pre-painted stroke at its current lean.
  // Then the hour's light, the sun's wash and the canvas weave go on, and are
  // trimmed back to exactly where there's paint, so the bare ground in the
  // dissolve stays clear and the page background shows through it unchanged.
  // Only the rows on screen are composed (the dissolve runs on below the
  // fold): the work is clipped to them, and strokes wholly outside are skipped.
  function drawField() {
    const sun = sunAt(state.hour), light = state.light;
    const g = fieldCtx, w = fieldBuf.width, h = fieldBuf.height, oy = fieldTopY * dpr;
    const y0 = clamp(Math.floor((state.viewTop - fieldTopY) * dpr), 0, h), y1 = clamp(Math.ceil((state.viewBottom - fieldTopY) * dpr), 0, h);
    if (y1 <= y0) return;
    const top = fieldTopY + y0 / dpr, bottom = fieldTopY + y1 / dpr;
    for (const c of [g, maskCtx]) {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.beginPath();
      c.rect(0, y0, w, y1 - y0);
      c.clip();
    }
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    g.drawImage(fieldLayer, 0, 0, w, h);
    const left = state.viewLeft, right = state.viewRight;
    for (const d of dabs) {
      if (d.y + d.len * 1.5 < top || d.y - d.len * 1.5 > bottom || d.x + d.len * 1.5 < left || d.x - d.len * 1.5 > right) continue;
      const sprite = strokeSprites[d.c][d.variant];
      const ang = d.rest + d.a, cos = Math.cos(ang), sin = Math.sin(ang);
      const sx = (d.len / SPRITE_LEN) * dpr, sy = (d.width / SPRITE_W) * dpr;
      g.setTransform(cos * sx, sin * sx, -sin * sy, cos * sy, d.x * dpr, d.y * dpr - oy);
      g.drawImage(sprite, -SPRITE_PAD, -sprite.height / 2);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);

    maskCtx.globalCompositeOperation = 'copy';
    maskCtx.drawImage(fieldBuf, 0, 0); // where the paint is

    g.globalCompositeOperation = 'multiply';
    g.fillStyle = rgb(light.tint);
    g.fillRect(0, 0, w, h);
    if (light.dark > 0.01) {
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = rgb(NIGHT_WASH, light.dark * 0.4);
      g.fillRect(0, 0, w, h);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, -oy);
    drawSurface(g, sun, fieldTopY, CH);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(maskBuf, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.restore();
    maskCtx.restore();

    ctx.drawImage(fieldBuf, 0, y0, w, y1 - y0, 0, top, W, (y1 - y0) / dpr);
  }

  // One light and one surface: a soft wash of the sun's colour that fades
  // with distance from it, then the canvas weave, over rows y0–y1 of `g`.
  function drawSurface(g, sun, y0, y1) {
    if (sun && (sun.up > 0 || sun.y < horizonY + sun.r * 2)) {
      const R = Math.max(W, H) * 1.1;
      const wash = g.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, R);
      wash.addColorStop(0, rgb(sun.color, 0.4));
      wash.addColorStop(1, rgb(sun.color, 0));
      g.globalCompositeOperation = 'soft-light';
      g.fillStyle = wash;
      g.fillRect(0, y0, W, y1 - y0);
    }
    const m = g.getTransform();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.08;
    g.fillStyle = g === ctx ? grain : grainField;
    g.fillRect(0, y0 * m.d + m.f, g.canvas.width, (y1 - y0) * m.d);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.setTransform(m);
  }

  function drawFireflies(time) {
    for (const f of fireflies) {
      const blink = Math.pow(Math.max(0, Math.sin(time * 0.0015 * f.sp + f.ph)), 3);
      if (blink < 0.02) continue;
      ctx.globalAlpha = state.light.dark * blink;
      ctx.drawImage(glowFirefly, f.x - 9, f.y - 9, 18, 18);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- the layers ----------
  // Listed in build and update order; drawn by z.

  const night = () => state.light.dark > 0.01;
  const layers = [
    {
      id: 'sky', kind: 'animated', z: 0,
      *build(s) {
        measure(s);
        yield* buildStrokeSprites();
        yield* buildSkyTexture();
      },
      render: drawSky,
    },
    {
      id: 'town', kind: 'static', z: 5,
      build: buildTown,
      bounds: () => ({ x: 0, y: town.top, w: W, h: town.h }),
      key: townKey,
      render: renderTown,
    },
    { id: 'town-rims', kind: 'animated', z: 6, render: drawRims },
    {
      id: 'field', kind: 'animated', z: 9,
      *build() {
        yield* buildField();
        buildGrain();
        fieldBuf.width = maskBuf.width = Math.round(W * dpr);
        fieldBuf.height = maskBuf.height = Math.round((CH - fieldTopY) * dpr);
      },
      update: (dt, s) => updateDabs(s.time),
      render: drawField,
    },
    stars.layer(1),
    {
      id: 'fireflies', kind: 'animated', z: 11,
      build: buildFireflies,
      update: updateFireflies,
      render: (c, s) => night() && drawFireflies(s.time),
    },
    { id: 'moon', kind: 'animated', z: 2, build: buildMoon, render: () => night() && drawMoon() },
    stars.shootingLayer(3),
    { id: 'sun', kind: 'animated', z: 4, build: buildSun, render: drawSun },
    {
      id: 'wind', kind: 'animated', z: 7,
      build: buildWind,
      frame: (dt) => updateWind(dt),
      render: () => windOn && ctx.drawImage(smokeBuf, 0, 0, W, horizonY), // the chimney smoke
    },
    // the sun's light and the canvas weave over the sky and the town
    { id: 'surface', kind: 'animated', z: 8, render: () => drawSurface(ctx, sunAt(state.hour), 0, horizonY + 10) },
    { id: 'town-lights', kind: 'animated', z: 10, render: (c, s) => drawTownLights(s.time) },
  ];

  return {
    layers,

    interactions: {
      hint: { day: 'drag your {pointer} through the wheat', night: 'brush your {pointer} across the stars ✦' },
      // the field and stars read the shared pointer directly; a tap on the
      // night sky sends a shooting star off along the wind
      onTap(x, y) {
        if (state.light.dark > 0.5 && y < horizonY) stars.launch(x, y, wind);
      },
    },

    // where the sun or moon and the town sit (CSS px within the hero), so
    // text over the sky can keep clear of them
    obstacles(h, lightAtH) {
      if (!town) return null;
      const orbs = [];
      const sun = sunAt(h), moon = lightAtH.dark > 0.3 ? moonAt(h) : null;
      if (sun && sun.y < horizonY) orbs.push({ x: sun.x, y: sun.y, r: sun.r * 3 });
      if (moon) orbs.push({ x: moon.x, y: moon.y, r: moon.r * 3 });
      return { orbs, skyline: town.tops, horizonY };
    },

    stats: () => ({ strokes: windStrokes.length, smoke: puffs.length }),

    // where each moving thing is, for checking that nothing jumps: the
    // drifting strokes and the smoke, [id, x, y, alpha] (the halos turn with
    // the wind's clock, which the engine reports)
    trace: () => ({
      strokes: windStrokes.map((s) => [traceId(s), s.x, s.y, s.peak * smooth(0, s.fadeIn, s.age) * (1 - smooth(s.life - s.fadeOut, s.life, s.age))]),
      smoke: puffs.map((p) => {
        const f = p.age / p.life;
        return [traceId(p), p.x, p.y, p.peak * smooth(0, 0.02, f) * Math.pow(1 - f, 1.4)];
      }),
    }),

    dispose() {
      stars.dispose();
      if (town) [town.canvas, town.rimL, town.rimR].forEach(release);
      strokeSprites.flat().forEach(release);
      [skyTex, fieldLayer, fieldBuf, maskBuf, windBuf, smokeBuf, sunSprite, moonSprite].forEach(release);
      for (const c of windStamps.concat(smokeStamps, windStrokes.map((s) => s.canvas), smokeTinted.flat())) release(c);
      town = skyTex = fieldLayer = sunSprite = moonSprite = null;
      dabs = strokeSprites = windStrokes = puffs = emitters = fireflies = windStamps = smokeStamps = smokeTinted = [];
    },
  };
}
