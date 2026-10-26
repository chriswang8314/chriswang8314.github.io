/*
 * Paints one still frame of a scene, away from the screen: the scene's
 * layers are built and drawn once at a given size and hour, with the wind
 * calm and nobody's pointer on it. Used by tools/stills.html to make each
 * scene's placeholder stills.
 *
 * opts: { W, H, CH, dpr, density, motion, hour } (CSS px, as the engine's state)
 */
import { createWind } from './wind.js';
import { keyframes, lightAt } from './time.js';
import { createStars } from './stars.js';
import { createCompositor } from './compositor.js';
import { offscreen } from './util.js';

export async function prerender(def, { W, H, CH = H, dpr = 1, density = W < 640 ? 0.5 : 1, motion = true, hour = 13 }) {
  const [canvas, ctx] = offscreen(W * dpr, CH * dpr);
  const wind = createWind();
  wind.setWidth(W);
  const pointer = { x: 0, y: 0, dx: 0, dy: 0, vx: 0, vy: 0, active: false, moved: 0, onTap: null, step() {}, dispose() {} };
  const state = {
    ctx, canvas, W, H, CH, dpr, density, motion,
    horizonY: Math.round(H * (def.layout.horizonY / 100)),
    time: 0, skyInView: true, viewTop: 0, viewBottom: CH, viewLeft: -Infinity, viewRight: Infinity,
    wind, pointer, hour, light: lightAt(keyframes(def.palettes), hour), quality: 1,
  };
  const inst = def.create({ state, ctx, wind, pointer, signal: new AbortController().signal, createStars });
  const compositor = createCompositor();
  compositor.setLayers(inst.layers);
  await compositor.build(state, () => true);
  compositor.render(ctx, state);
  inst.dispose?.();
  compositor.dispose();
  return canvas;
}
