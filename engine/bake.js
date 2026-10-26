/*
 * Baking away from the page. A scene's slow, one-off painting (the
 * reflection of everything in it that never moves, say) runs in a worker,
 * so the painting on screen never misses a frame for it.
 *
 * The work is a generator exported from the scene's own module, which the
 * worker imports: given plain values and images (ImageBitmaps, from
 * bitmaps()), it paints with the engine's brush on OffscreenCanvases and
 * returns { name: canvas }; those come back as ImageBitmaps. Run on the page
 * instead (no worker, or it failed), the same generator is sliced like any
 * other build, so a scene writes it once and yields as usual:
 *
 *   const box = {};
 *   yield bitmaps(a, b).then(([a2, b2]) => bake(import.meta.url, 'name', { a: a2, b: b2 }, [a2, b2])).then((out) => (box.out = out), () => {});
 *   const out = box.out || (yield* name({ a, b }));
 *
 * (A build step may yield a promise; the build waits for it.)
 */

let worker = null, n = 0;
let ok = typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function';
const jobs = new Map();

// Runs `name` from the module at `url` in the worker with `args` (transfer:
// what in it to hand over rather than copy). Resolves to its result as
// ImageBitmaps, or to null where there's no worker.
export function bake(url, name, args, transfer = []) {
  if (!ok) return Promise.resolve(null);
  if (!worker) {
    try {
      worker = new Worker(new URL('./bake-worker.js', import.meta.url), { type: 'module' });
    } catch {
      ok = false;
      return Promise.resolve(null);
    }
    worker.onmessage = ({ data }) => {
      const job = jobs.get(data.job);
      if (!job) return;
      jobs.delete(data.job);
      if (data.out) job.resolve(data.out);
      else job.reject(new Error(data.error));
    };
    worker.onerror = () => {
      ok = false; // bake on the page from now on
      for (const job of jobs.values()) job.resolve(null);
      jobs.clear();
      worker.terminate();
      worker = null;
    };
  }
  const job = ++n;
  return new Promise((resolve, reject) => {
    jobs.set(job, { resolve, reject });
    worker.postMessage({ job, url, name, args }, transfer);
  });
}

// canvases as ImageBitmaps, for sending to the worker (or the canvases
// themselves where there's no worker to send them to)
export const bitmaps = (...canvases) => (ok ? Promise.all(canvases.map((c) => createImageBitmap(c))) : Promise.resolve(canvases));

export const canBake = () => ok;
