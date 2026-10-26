/*
 * The performance governor: keeps the painting within its frame budget and
 * only running when someone can see it.
 *
 *  - Measures each frame's work. If it averages over 12 ms for two seconds,
 *    `quality` drops by 30% (to no less than 0.3); scenes scale their
 *    optional work (drifting strokes, smoke, flowers) by it.
 *  - Says when the last few frames have run over budget, or come late
 *    (`strained`), for work that has to react within a frame or two (a
 *    repaint in progress).
 *  - Caps the device pixel ratio at 2.
 *  - Reports whether the loop should run: the painting is on screen and the
 *    tab is visible. onWake is called when that turns true again.
 *  - Follows prefers-reduced-motion; onMotionChange is called when it flips.
 *
 * The last 600 frames' times are kept for stats().
 */

const PERF_N = 600, BUDGET = 12, WINDOW = 2000, RECENT = 6, LATE_GAP = 25;

export function createGovernor(target, { onWake, onMotionChange }) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const frameTimes = new Float32Array(PERF_N), partTimes = new Float32Array(PERF_N), gaps = new Float32Array(PERF_N);
  let perfI = 0, perfSum = 0, perfN = 0, perfFrom = 0, lastAt = 0;
  let visible = true;
  const ac = new AbortController();

  const gov = {
    quality: 1,
    get motion() {
      return !reduceMotion.matches;
    },
    dpr: () => Math.min(window.devicePixelRatio || 1, 2),
    canRun: () => visible && !document.hidden,

    // start a fresh measuring window (when the loop starts or resumes)
    begin(now) {
      perfSum = perfN = 0;
      perfFrom = now;
      lastAt = 0;
    },

    // whether the last RECENT frames ran over budget: their work averaged
    // over it, or two of them came late (the browser's own share of a frame,
    // rasterising and compositing, isn't in the work measured here)
    strained() {
      const n = Math.min(perfI, RECENT);
      let sum = 0, late = 0;
      for (let i = 1; i <= n; i++) {
        const k = (perfI - i) % PERF_N;
        sum += frameTimes[k];
        if (gaps[k] > LATE_GAP) late++;
      }
      return n === RECENT && (sum / n > BUDGET || late >= 2);
    },

    // ms: the whole frame's work; partMs: the animated layers' share
    trackFrame(ms, partMs, now) {
      frameTimes[perfI % PERF_N] = ms;
      partTimes[perfI % PERF_N] = partMs;
      gaps[perfI % PERF_N] = lastAt ? now - lastAt : 0;
      lastAt = now;
      perfI++;
      perfSum += ms;
      perfN++;
      if (now - perfFrom < WINDOW) return;
      if (perfSum / perfN > BUDGET && gov.quality > 0.3) gov.quality *= 0.7;
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
