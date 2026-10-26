/*
 * The worker for engine/bake.js: imports a scene's module, runs one of its
 * bake generators to the end, and sends what it painted back as ImageBitmaps.
 *
 * in:  { job, url, name, args }      out: { job, out: { name: ImageBitmap } } or { job, error }
 */
self.onmessage = async ({ data: { job, url, name, args } }) => {
  try {
    const mod = await import(url);
    const it = mod[name](args);
    let step;
    while (!(step = it.next()).done);
    const out = {}, transfer = [];
    for (const [key, canvas] of Object.entries(step.value)) {
      out[key] = canvas.transferToImageBitmap();
      transfer.push(out[key]);
    }
    for (const v of Object.values(args)) if (v && typeof v.close === 'function') v.close();
    self.postMessage({ job, out }, transfer);
  } catch (err) {
    self.postMessage({ job, error: String(err && err.message ? err.message : err) });
  }
};
