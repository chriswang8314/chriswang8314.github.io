/*
 * Noise, flow fields and curl. Value noise is smooth and cheap; fbm layers
 * three octaves of it for broad masses with some internal variation; curl
 * turns a noise field into a divergence-free flow, so things carried by it
 * eddy and turn without bunching up or thinning out.
 */
import { lerp } from './util.js';

export function hash2(ix, iy) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// smooth 2D value noise in [0, 1]
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return lerp(
    lerp(hash2(ix, iy), hash2(ix + 1, iy), sx),
    lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), sx),
    sy,
  );
}

// three octaves of noise, for broad masses with some internal variation
export const fbm = (x, y) =>
  noise2(x, y) * 0.55 + noise2(x * 2.1 + 17.3, y * 2.1 + 9.1) * 0.3 + noise2(x * 4.3 + 31.7, y * 4.3 + 3.3) * 0.15;

// The curl of a slowly drifting noise field at (x, y) and time t (seconds),
// written into out as [vx, vy] (magnitude about 0–1.5). `scale` is the
// field's frequency per px.
export function curlAt(x, y, t, out, scale = 0.0032) {
  const u = x * scale + t * 0.011, v = y * scale - t * 0.007, e = 0.05;
  out[0] = (noise2(u, v + e) - noise2(u, v - e)) / (2 * e);
  out[1] = -(noise2(u + e, v) - noise2(u - e, v)) / (2 * e);
  return out;
}

// A flow field: an angle at every point from low-frequency fbm, for laying
// strokes along. `swirl` is how far (radians) the angle wanders from `base`.
export const flowField = ({ base = 0, swirl = 1, fx = 0.002, fy = 0.004, ox = 0, oy = 0 } = {}) =>
  (x, y) => base + (fbm(x * fx + ox, y * fy + oy) - 0.5) * 2 * swirl;
