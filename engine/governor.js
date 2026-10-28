/*
 * The performance governor: keeps the painting within its frame budget and
 * only running when someone can see it.
 *
 *  - Measures each frame's work. If it averages over 12 ms for two seconds,
 *    `quality` drops by 30% (to no less than 0.3); scenes scale their
 *    optional work (drifting strokes, smoke, flowers) by it. Once frames have
 *    averaged under half that for six seconds, it climbs back a step (the
 *    machine was busy for a while, or has left its low-power mode). Frames
 *    the engine says not to count (a repaint's, with two paintings on
 *    screen) are left out.
 *  - Says when the last few frames since begin() have run over budget, or
 *    come late (`strained`), for work that has to react within a frame or
 *    two (a repaint in progress).
 *  - Caps the device pixel ratio at 2.
 *  - Reports whether the loop should run: the painting is on screen and the
 *    tab is visible. onWake is called when that turns true again.
 *  - Follows prefers-reduced-motion; onMotionChange is called when it flips.
 *
 * The last 600 frames' times are kept for stats().
 */

const PERF_N = 600, BUDGET = 12, WINDOW = 2000, CALM = 3, RECENT = 6, LATE_GAP = 25, LOWEST = 0.3;

export function createGovernor(target, { onWake, onMotionChange }) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const frameTimes = new Float32Array(PERF_N), partTimes = new Float32Array(PERF_N), gaps = new Float32Array(PERF_N);
  let perfI = 0, perfSum = 0, perfN = 0, perfFrom = 0, lastAt = 0, from = 0, calm = 0;
  let visible = true;
  // ?quality=0.5 starts as if the frames had run long, to try a scene's lighter modes (and it climbs back no higher)
  const ceiling = Math.min(1, Math.max(LOWEST, Number(new URLSearchParams(location.search).get('quality')) || 1));
  const ac = new AbortController();

  const gov = {
    quality: ceiling,
    get motion() {
      return !reduceMotion.matches;
    },
    dpr: () => Math.min(window.devicePixelRatio || 1, 2),
    canRun: () => visible && !document.hidden,

    // start a fresh measuring window (when the loop starts or resumes, or a repaint begins)
    begin(now) {
      perfSum = perfN = 0;
      perfFrom = now;
      lastAt = 0;
      from = perfI;
    },

    // whether the last RECENT frames ran over budget: their work averaged
    // over it, or two of them came late (the browser's own share of a frame,
    // rasterising and compositing, isn't in the work measured here)
    strained() {
      const n = Math.min(perfI - from, RECENT);
      let sum = 0, late = 0;
      for (let i = 1; i <= n; i++) {
        const k = (perfI - i) % PERF_N;
        sum += frameTimes[k];
        if (gaps[k] > LATE_GAP) late++;
      }
      return n === RECENT && (sum / n > BUDGET || late >= 2);
    },

    // ms: the whole frame's work; partMs: the animated layers' share;
    // counted: whether it's a fair measure of the painting's cost
    trackFrame(ms, partMs, now, counted = true) {
      frameTimes[perfI % PERF_N] = ms;
      partTimes[perfI % PERF_N] = partMs;
      gaps[perfI % PERF_N] = lastAt ? now - lastAt : 0;
      lastAt = now;
      perfI++;
      if (counted) {
        perfSum += ms;
        perfN++;
      }
      if (now - perfFrom < WINDOW) return;
      const avg = perfSum / (perfN || 1);
      if (perfN && avg > BUDGET) {
        gov.quality = Math.max(LOWEST, gov.quality * 0.7);
        calm = 0;
      } else if (perfN && avg < BUDGET / 2 && gov.quality < ceiling) {
        if (++calm >= CALM) {
          gov.quality = Math.min(ceiling, gov.quality / 0.7);
          calm = 0;
        }
      } else calm = 0;
      perfSum = perfN = 0;
      perfFrom = now;
    },

    stats() {
      const n = Math.min(perfI, PERF_N), f = frameTimes.subarray(0, n), p = partTimes.subarray(0, n);
      const avg = (a) => a.reduce((sum, v) => sum + v, 0) / (a.length || 1);
      return { frames: perfI, frameAvg: avg(f), frameMax: Math.max(0, ...f), partAvg: avg(p), partMax: Math.max(0, ...p), quality: gov.quality };
    },

    dispose: () => ac.abort(),
  };

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    onWake();
  }).observe(target);
  document.addEventListener('visibilitychange', onWake, { signal: ac.signal });
  reduceMotion.addEventListener('change', onMotionChange, { signal: ac.signal });

  return gov;
}
