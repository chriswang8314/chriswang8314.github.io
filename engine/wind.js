/*
 * The wind: one breeze shared by everything that moves in a scene.
 *
 * It blows along `dir` (a unit vector; to the left by default) at a slow
 * base speed that strengthens and eases in gusts every 6–12 s (never past
 * 1.8× the base), and the curl of a slowly shifting noise field adds swirl.
 * Low down, a slower swell rolls across the ground in long waves, for fields
 * and flowers. Its clock only runs while motion is allowed and the sky is in
 * view; scenes read it, never advance it.
 */
import { clamp, smooth } from './util.js';
import { noise2, curlAt } from './noise.js';

export const WIND_SPEED = 11; // px/s on a 1440 px wide screen, before gusts

export function createWind() {
  const wind = {
    t: 0, // seconds of wind so far
    gust: 1, // 1 (calm) to 1.8
    speed: WIND_SPEED, // base px/s for this screen width
    dir: [-1, 0],

    // gust strength over time: 1 (calm) to 1.8, from two octaves of slow noise
    gustAt: (t) => 1 + 0.8 * smooth(0.3, 0.75, noise2(t / 9, 0.5) * 0.7 + noise2(t / 3.7, 4.5) * 0.3),

    // swirl at a point: the curl of a slowly drifting noise field
    curlAt: (x, y, t, out) => curlAt(x, y, t, out),

    // the ground swell at sim time `ms`: 0.6 (lull) to 1, in long slow waves
    swell: (ms) => 0.6 + 0.4 * Math.max(0, Math.sin(ms * 0.00023)),

    setWidth(W) {
      wind.speed = WIND_SPEED * clamp(W / 1440, 0.45, 1.2);
    },

    update(dt) {
      wind.t += dt;
      wind.gust = wind.gustAt(wind.t);
    },
  };
  return wind;
}
