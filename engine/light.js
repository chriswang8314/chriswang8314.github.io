/*
 * Relighting a painted layer for the hour. Scenes paint their still layers
 * once, in daylight colours; each hour's light is then laid over that paint
 * (only where there is paint) instead of repainting it:
 *
 *  - tint:  multiplied in (white = full daylight)
 *  - desat: 0–1, how much of the colour drains away (for night)
 *  - wash:  [r, g, b, alpha], a colour glazed over the top (for night's blue)
 *
 * `g` is the target; `paint` is the daylight layer, drawn at the same size.
 * Leaves g's transform at the identity.
 */
import { rgb } from './util.js';

export function relight(g, paint, { tint, desat = 0, wash = null }) {
  const w = g.canvas.width, h = g.canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'copy';
  g.drawImage(paint, 0, 0, w, h);
  if (tint && (tint[0] < 255 || tint[1] < 255 || tint[2] < 255)) {
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = rgb(tint);
    g.fillRect(0, 0, w, h);
  }
  if (desat > 0.004) {
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = `rgba(128,128,128,${Math.min(1, desat)})`;
    g.fillRect(0, 0, w, h);
  }
  if (wash && wash[3] > 0.004) {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = rgb(wash, wash[3]);
    g.fillRect(0, 0, w, h);
  }
  // back to exactly where the paint is, with its own edges
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(paint, 0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}

// a short string that changes when the light visibly does, for static layer
// keys: colours to the nearest unit, fractions to three places
export const lightKey = (light, names) =>
  names.map((n) => [].concat(light[n] ?? 0).map((v) => (Math.abs(v) > 2 ? Math.round(v) : v.toFixed(3))).join(',')).join('|');
