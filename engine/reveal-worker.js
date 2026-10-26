/*
 * A worker that paints a repaint's reveal-time map (engine/reveal.js) while
 * the painting on the page keeps moving: the strokes are planned and painted
 * here, in the next painting's brush, and come back as an ImageBitmap.
 *
 * in:  { job, opts: { W, CH, seed, brushStyle } }      out: { job, map, latest } or { job, error }
 * (latest: when the map's last pixel is painted, in seconds)
 */
import { planReveal, paintRevealMap } from './reveal.js';

self.onmessage = ({ data: { job, opts } }) => {
  try {
    const canvas = paintRevealMap(planReveal(opts), opts);
    const map = canvas.transferToImageBitmap();
    self.postMessage({ job, map, latest: canvas.latest }, [map]);
  } catch (err) {
    self.postMessage({ job, error: String(err && err.message ? err.message : err) });
  }
};
