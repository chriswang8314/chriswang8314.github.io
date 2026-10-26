/*
 * Small shared helpers: numbers, colours, seeded random numbers and
 * offscreen canvases. Colours are [r, g, b] arrays in 0–255.
 */

export const TAU = Math.PI * 2;

export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mixRGB = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const shadeRGB = (c, f) => [clamp(c[0] * f, 0, 255), clamp(c[1] * f, 0, 255), clamp(c[2] * f, 0, 255)];
export const rgb = (c, alpha = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
export const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// a small, fast seeded generator: the same seed paints the same picture
export function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a canvas to paint on away from the screen: an ordinary canvas element on
// the page; in a worker (where there's no document) an OffscreenCanvas,
// painted on the CPU, so the worker never competes with the page for the GPU
export const offscreen = (w, h) => {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  if (typeof document === 'undefined') {
    const c = new OffscreenCanvas(W, H);
    return [c, c.getContext('2d', { willReadFrequently: true })];
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return [c, c.getContext('2d')];
};

// frees a canvas's backing store now rather than whenever it's collected
export const release = (c) => {
  if (c) c.width = c.height = 0;
};

// a soft round glow in one colour, for stars, lamps and fireflies
export function makeGlow(r, g, b) {
  const [c, gx] = offscreen(64, 64);
  const grad = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.25, `rgba(${r},${g},${b},0.4)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  gx.fillStyle = grad;
  gx.fillRect(0, 0, 64, 64);
  return c;
}

// Runs a builder in slices of about 12 ms, handing the main thread back
// between slices so the page never stalls while a painting is prepared.
// Builders are generators that yield between small pieces of work; one may
// yield a promise (work done elsewhere, in a worker), and the build waits for
// it. Returns false if `alive()` turns false part-way (a newer build took over).
export const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
export const isPromise = (v) => !!v && typeof v.then === 'function';
export async function runSliced(steps, alive) {
  let t0 = performance.now();
  if (steps && steps[Symbol.iterator]) {
    for (const v of steps) {
      if (isPromise(v)) {
        await v.then(null, () => {});
        if (!alive()) return false;
        t0 = performance.now();
      } else if (performance.now() - t0 > 12) {
        await nextTask();
        if (!alive()) return false;
        t0 = performance.now();
      }
    }
  }
  return true;
}
