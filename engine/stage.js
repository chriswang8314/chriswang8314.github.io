/*
 * A stage: one scene, live, on its own canvas. The engine normally has one
 * on screen; while the next painting is brushed over the current one there
 * are two, and both keep moving. Each stage has its own clock, light, layers
 * and caches, so a scene never has to share them, and it draws only into its
 * own canvas.
 *
 * The clock: `sim` (ms) advances one fixed step at a time, `scale` times as
 * fast as the engine's (1, or easing to 0 for a painting being covered when
 * the frame budget runs short).
 */
import { keyframes, lightAt } from './time.js';
import { createStars } from './stars.js';
import { createCompositor } from './compositor.js';
import { release } from './util.js';

export const STEP = 1000 / 60; // fixed physics step, so 120 Hz screens don't run double speed

export function createStage(def, canvas, { wind, pointer, time, governor, profile }) {
  const ctx = canvas.getContext('2d');
  const keys = keyframes(def.palettes);
  const ac = new AbortController();

  // what every layer of this scene paints from (see README, "Adding a new painting")
  const state = {
    ctx, canvas,
    W: 0, H: 0, CH: 0, dpr: 1, horizonY: 0,
    density: 1, // about half the strokes on narrow screens
    time: 0, // sim time, ms
    motion: governor.motion, // false under prefers-reduced-motion
    skyInView: true,
    viewTop: 0, viewBottom: Infinity,
    viewLeft: -Infinity, viewRight: Infinity, // the columns that will show (narrower while it's brushed in or out)
    wind, pointer,
    light: lightAt(keys, time.hour), // the palette at the hour shown
    get hour() {
      return time.hour;
    },
    get quality() {
      return governor.quality;
    },
  };
  const inst = def.create({ state, ctx, wind, pointer, signal: ac.signal, createStars });
  const compositor = createCompositor();
  compositor.profile = profile;
  compositor.setLayers(inst.layers);

  const stage = {
    def, inst, canvas, ctx, state, compositor,
    sim: 0, // its clock, ms
    acc: 0,
    scale: 1, // how fast its clock runs
    mask: null, // while a repaint runs: how much of it shows (see reveal.js)
    still: null, // its last frame, once its clock has stopped part-way through a repaint

    lightAt: (h) => lightAt(keys, h),
    relight() {
      state.light = lightAt(keys, time.hour);
    },

    // the size to paint at (CSS px, as the engine's view)
    size(view) {
      Object.assign(state, view, { horizonY: Math.round(view.H * (def.layout.horizonY / 100)) });
    },
    // the canvas to match
    fit() {
      const w = Math.round(state.W * state.dpr), h = Math.round(state.CH * state.dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    },
    // builds every layer, sliced; or the same as steps (a generator), for the engine to slice
    build: (alive) => compositor.build(state, alive),
    buildSteps: () => compositor.buildSteps(state),

    // one engine step: advances this scene's clock by `scale` of it
    step() {
      stage.acc += STEP * stage.scale;
      while (stage.acc >= STEP) {
        stage.sim += STEP;
        state.time = stage.sim;
        stage.relight();
        compositor.update(STEP / 1000, state);
        stage.acc -= STEP;
      }
    },
    // once per animation frame, while the wind blows
    frame(dts) {
      if (stage.scale > 0) compositor.frame(dts * stage.scale, state);
    },
    // clip: only [left, right] (CSS px) need be drawn (the rest of the
    // canvas is left as it was)
    draw(clip) {
      if (!state.W || !state.H) return; // canvas not laid out yet
      state.time = stage.sim;
      if (!clip) return compositor.render(ctx, state);
      if (clip[1] <= clip[0]) return;
      [state.viewLeft, state.viewRight] = clip;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(Math.floor(clip[0] * state.dpr), 0, Math.ceil((clip[1] - clip[0]) * state.dpr) + 1, canvas.height);
      ctx.clip();
      compositor.render(ctx, state);
      ctx.restore();
      state.viewLeft = -Infinity;
      state.viewRight = Infinity;
    },

    // Runs its clock up to `until` (ms) in a few big steps, so it arrives
    // moving: smoke and drifting strokes spread out, sails at the wind's speed.
    // A generator, a twelfth of a second of the scene per step.
    *warmUp(until, span = 2500) {
      stage.sim = Math.max(stage.sim, until() - span, 0);
      let n = 0;
      while (stage.sim < until()) {
        stage.sim += STEP;
        state.time = stage.sim;
        stage.relight();
        compositor.update(STEP / 1000, state);
        if (++n % 3 === 0 && state.motion) compositor.frame((3 * STEP) / 1000, state);
        if (n % 5 === 0) yield;
      }
      stage.acc = 0;
    },
    // draws it once, a layer per step (off screen), so every cache it keeps
    // is filled before it's first seen
    prime: () => compositor.prime(ctx, state),

    dispose() {
      inst.dispose?.();
      ac.abort();
      compositor.dispose();
      release(stage.still);
      stage.still = null;
    },
  };
  return stage;
}
