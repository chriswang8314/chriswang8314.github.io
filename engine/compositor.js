/*
 * The layer compositor. A scene is a stack of layers:
 *
 *   { id, kind: 'static' | 'animated', z,
 *     build?(state),            // generator or function: paint textures (sliced)
 *     update?(dt, state),       // once per fixed 60 Hz step (dt in seconds)
 *     frame?(dt, state),        // once per animation frame, while the wind runs
 *     render?(ctx, state),      // draw
 *     key?(state),              // static only: re-render when this changes
 *     bounds?(state) }          // static only: { x, y, w, h } it covers (CSS px)
 *
 * Static layers are rendered once into their own cached canvas (and again
 * only when their key changes, e.g. with the palette, or on resize); each
 * frame just draws the cache. Animated layers draw every frame, using their
 * own offscreen canvases as they need. Layers are drawn in z order;
 * build/update/frame run in the order the scene lists them.
 */
import { runSliced, offscreen, release } from './util.js';

export function createCompositor() {
  let layers = [], drawOrder = [];
  const timings = new Map();
  const time = (id, ms) => {
    const t = timings.get(id) || { sum: 0, n: 0, max: 0 };
    t.sum += ms;
    t.n++;
    t.max = Math.max(t.max, ms);
    timings.set(id, t);
  };
  const caches = new Map(); // layer -> { canvas, ctx, key }

  const comp = {
    setLayers(list) {
      comp.dispose();
      layers = list;
      drawOrder = list.map((l, i) => [l, i]).sort((a, b) => a[0].z - b[0].z || a[1] - b[1]).map(([l]) => l);
    },

    get layers() {
      return layers;
    },

    // Builds every layer, sliced (runSliced); false if `alive()` turned
    // false part-way.
    async build(state, alive) {
      return (await runSliced(comp.buildSteps(state), alive)) && alive();
    },

    // the same as steps (a generator), every layer's one after another, for
    // the engine to slice along with other work; `working` is the layer
    // they're at
    working: null,
    *buildSteps(state) {
      for (const cache of caches.values()) cache.key = null; // sizes change: re-render statics
      for (const layer of layers) {
        if (!layer.build) continue;
        comp.working = layer.id;
        const steps = layer.build(state);
        if (steps && steps[Symbol.iterator]) yield* steps;
        yield;
      }
      comp.working = null;
    },

    update(dt, state) {
      for (const layer of layers) layer.update?.(dt, state);
    },

    frame(dt, state) {
      for (const layer of layers) layer.frame?.(dt, state);
    },

    render(ctx, state) {
      const { dpr } = state;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, state.W, state.CH);
      for (const layer of drawOrder) {
        const t0 = comp.profile ? performance.now() : 0;
        if (layer.kind === 'static') drawStatic(ctx, layer, state);
        else layer.render?.(ctx, state);
        if (comp.profile) time(layer.id, performance.now() - t0);
      }
    },

    // the same as render, a layer per step (a generator): for drawing a
    // scene once off screen, a little at a time, so its caches are filled
    *prime(ctx, state) {
      const { dpr } = state;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, state.W, state.CH);
      for (const layer of drawOrder) {
        comp.working = layer.id;
        if (layer.kind === 'static') drawStatic(ctx, layer, state);
        else layer.render?.(ctx, state);
        yield;
      }
      comp.working = null;
    },

    // with `profile` on: each layer's render time since last asked, as [avg, max] ms
    profile: false,
    timings() {
      const out = {};
      for (const [id, t] of timings) out[id] = [+(t.sum / t.n).toFixed(2), +t.max.toFixed(2)];
      timings.clear();
      return out;
    },

    dispose() {
      for (const cache of caches.values()) release(cache.canvas);
      caches.clear();
    },
  };

  function drawStatic(ctx, layer, state) {
    const { dpr } = state;
    const b = layer.bounds ? layer.bounds(state) : { x: 0, y: 0, w: state.W, h: state.CH };
    const cw = Math.max(1, Math.round(b.w * dpr)), ch = Math.max(1, Math.round(b.h * dpr));
    const key = `${cw}x${ch}|${layer.key ? layer.key(state) : ''}`;
    let cache = caches.get(layer);
    if (!cache) {
      const [canvas, g] = offscreen(cw, ch);
      cache = { canvas, ctx: g, key: null };
      caches.set(layer, cache);
    }
    if (cache.key !== key) {
      const { canvas, ctx: g } = cache;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      } else {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, cw, ch);
      }
      // drawn in scene coordinates
      g.setTransform(dpr, 0, 0, dpr, -b.x * dpr, -b.y * dpr);
      layer.render(g, state);
      g.setTransform(1, 0, 0, 1, 0, 0);
      cache.key = key;
    }
    ctx.drawImage(cache.canvas, b.x, b.y, b.w, b.h);
  }

  return comp;
}

// The same idea for a scene's own buffers: a canvas re-rendered only when
// its key (or size, in device px) changes, e.g. painted layers relit for the
// hour. get() returns the canvas, up to date.
export function keyedCache(render) {
  const [canvas, g] = offscreen(1, 1);
  let key = null;
  return {
    canvas,
    get(k, w, h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        key = null;
      }
      if (k !== key) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, w, h);
        render(g);
        key = k;
      }
      return canvas;
    },
    reset: () => (key = null),
    release: () => release(canvas),
  };
}
