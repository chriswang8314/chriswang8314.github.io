/*
 * The painting engine: runs whichever scene (painting) is showing in the
 * hero. It owns everything scenes share — the clock and time of day, the
 * wind, the pointer, the frame loop and its budget, sizing — and gives each
 * scene a stage of its own to paint on (engine/stage.js). See README
 * ("Adding a new painting") for the scene contract.
 *
 * The page around the painting talks to it through window.paintedScene.
 */
import { createWind } from './wind.js';
import { createTime, keyframes, lightAt } from './time.js';
import { createPointer } from './pointer.js';
import { createGovernor } from './governor.js';
import { createLoader } from './loader.js';
import { createStage, STEP } from './stage.js';
import {
  REVEAL, REVEAL_LATE, PAINT, ERASE, revealEnd, revealFront, planReveal, revealMapSteps, createMaskGL, createMask2D, maskScale2D,
} from './reveal.js';
import { offscreen, release, isPromise } from './util.js';
import { SCENES, DEFAULT_SCENE, thumb } from '../scenes/index.js';

const params = new URLSearchParams(location.search);
const FADE = 0.3; // under reduced motion a switch is a crossfade this long (s)
const MASK_DPR = Number(params.get('maskdpr')) || 1; // the masks' resolution (px per CSS px); stretched smoothly over the painting
const SEEDS = [11, 23]; // the repaint's stroke plans: a repaint that overtakes another uses the other one

const first = document.getElementById('scene'); // the first painting's canvas; any others sit beside it
const heroEl = first.parentElement;
const hint = document.getElementById('hint');
const root = document.documentElement;
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

const time = createTime({
  slider: document.getElementById('time-slider'),
  label: document.getElementById('time-label'),
  nowBtn: document.getElementById('time-now'),
});
const wind = createWind();
const pointer = createPointer(first);
const loader = createLoader(SCENES);
const governor = createGovernor(first, { onWake: () => start(), onMotionChange: () => resize(true) });
const shared = { wind, pointer, time, governor, profile: params.has('profile') };

// The size every stage paints at (CSS px). H is the hero (one screen); the
// canvas runs on below it to CH, where the painting dissolves into the page.
const view = {
  W: 0, H: 0, CH: 0, dpr: 1,
  density: 1, // about half the strokes on narrow screens
  motion: governor.motion, // false under prefers-reduced-motion
  skyInView: true,
  viewTop: 0, viewBottom: Infinity,
};

// The stages on screen, bottom to top: one, or while a painting is brushed
// over another, two (or briefly more). See "switching scenes".
let stack = [];
let adopted = null; // the stage the page follows (its hint, its taps, its palettes)
let target = null; // during a switch: the scene being switched to (its definition)
let reveal = null; // the repaint in progress
let ready = false, shown = false, builtW = 0, builtH = 0, buildId = 0;
let running = false, rafId = 0, last = 0, acc = 0, simTime = 0, lastFrame = 0;
let loops = 0; // frame loops alive: always 0 or 1 (stats() reports it, for checking)
// with ?profile: each frame's [time, ms drawing, ms of background work, repainting]
const frameLog = params.has('profile') ? (window.__frameLog = []) : null;

const sceneDef = () => target || stack[0]?.def || null;
const stageOf = (id) => stack.find((s) => s.def.id === id) || pending.get(id)?.stage || null;

// ---------- scenes ----------

// Paint the first scene once the page has loaded and the browser has a
// quiet moment; the still placeholder covers the wait.
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
const firstPaint = new Promise((resolve) => {
  const begin = () => idle(resolve, { timeout: 1500 });
  if (document.readyState === 'complete') begin();
  else window.addEventListener('load', begin, { once: true });
});

// Shows a scene straight away (the first one, or when there's nothing on
// screen to repaint over): fetches its module (once), drops what's there,
// then builds the new one at the current size.
async function show(id) {
  const [def, token] = await loader.load(id);
  if (!loader.latest(token)) return false;
  if (stack.length === 1 && stack[0].def === def && !reveal) return true;
  dropReveal();
  dropPending();
  stop();
  ready = false;
  buildId++; // abandons any build in progress
  for (const st of stack) {
    st.dispose();
    busy.delete(st.canvas);
  }
  const stage = newStage(def);
  stack = [stage];
  target = null;
  adopt(stage);
  window.dispatchEvent(new CustomEvent('scenechange', { detail: describe(def) }));
  await firstPaint;
  // the repaint's WebGL context and shader: made now, while the still is up
  // and nothing moves yet, so a first switch costs nothing extra
  if (!shown) warmMasks();
  if (stack[0] === stage) await resize(true);
  return stack[0] === stage && ready;
}

// Makes a stage the one the page follows.
function adopt(stage) {
  const def = stage.def;
  adopted = stage;
  time.setPalettes(def.palettes);
  pointer.onTap = (x, y) => !reveal && stage.inst.interactions?.onTap?.(x, y, stage.state);
  root.style.setProperty('--scene-depth', String(100 + def.dissolve.depth));
  root.style.setProperty('--content-start', String(def.dissolve.contentStart));
  root.dataset.scene = def.id;
  wasNight = null;
  checkNight();
}

const describe = (def) => ({
  id: def.id, title: def.title, artist: def.artist, year: def.year, label: def.label,
  description: def.description, layout: def.layout, placeholder: def.placeholder,
});

// ---------- canvases ----------
// Each stage paints on a canvas of its own, laid over the hero in stacking
// order. They're reused; one not in use is hidden (.offstage) and its pixels
// let go.

const canvases = [first];
const busy = new Set(); // held by a stage (on screen, getting ready, or waiting to be disposed)

function freeCanvas() {
  let c = canvases.find((x) => !busy.has(x));
  if (!c) {
    c = document.createElement('canvas');
    c.className = 'scene-stage offstage';
    c.setAttribute('aria-hidden', 'true');
    canvases[canvases.length - 1].after(c);
    canvases.push(c);
  }
  busy.add(c);
  return c;
}

function newStage(def) {
  const stage = createStage(def, freeCanvas(), shared);
  stage.size(view);
  return stage;
}

// off the screen at once; its scene disposed when the browser is next idle
function retire(stage) {
  stage.canvas.classList.add('offstage');
  clearMask(stage);
  idle(() => {
    stage.dispose();
    release(stage.canvas);
    busy.delete(stage.canvas);
  }, { timeout: 1000 });
}

// ---------- work in the background ----------
// Getting the next painting ready runs in small pieces between frames: once a
// frame is drawn and handed to the browser, in the time left before the next
// one is due. How long that is comes from the frames themselves (about 16 ms
// at 60 Hz; 33 ms where the browser holds the page to 30 fps to save power).
// However long drawing takes, each frame leaves at least SLICE for it, so on
// a slow machine it still gets done; and once a painting has been picked and
// the visitor is waiting for it, at least as long as drawing took (the
// painting on screen may drop to half its frame rate, for that moment, rather
// than keep them waiting). With the loop stopped, in 8 ms slices.

const SLICE = 3; // ms each frame leaves for background work, at the least
const HURRY = 25; // ms: in a hurry it gets as long as drawing took, up to this (so one slow frame isn't doubled)
const MARGIN = 3; // ms left free before the next frame is due
const chores = [];
let choreTimer = 0;
let hurry = null; // the painting picked and waited for, while it's got ready
let due = 0, drawMs = 0; // when the next frame is expected; how long the last one took to draw
// with ?profile: ms spent on each kind of background step, and on getting each painting ready
const choreLog = frameLog ? {} : null, prepLog = frameLog ? {} : null;

// runs a generator's steps that way; resolves true when it's done, false if
// `alive()` turned false first
function background(steps, alive, label = '') {
  return new Promise((resolve) => {
    chores.push({ it: steps && steps[Symbol.iterator] ? steps[Symbol.iterator]() : null, alive, resolve, label, est: 0, starved: 0 });
    if (!running) kick();
  });
}

// Chores run in the order they came, a step at a time. A step is started
// only if steps like its chore's last few fit before `until`; one held back
// for a few frames (one, in a hurry) runs regardless. A step may hand back a
// promise (work done in a worker): its chore waits for it, and the others
// carry on meanwhile. A chore no longer wanted is dropped, waiting or not.
function work(until) {
  let ran = false;
  for (let i = 0; i < chores.length; ) {
    const c = chores[i];
    if (!c.alive()) {
      chores.splice(i, 1);
      c.resolve(false);
      continue;
    }
    if (c.waiting) {
      i++;
      continue;
    }
    const now = performance.now();
    if (now + c.est > until) {
      if (ran) break;
      if (++c.starved <= (hurry ? 1 : 8)) {
        c.est *= 0.8; // one slow step (a cache filled, say) shouldn't hold back all the rest for long
        break;
      }
    }
    let done = !c.it, waitOn = null;
    try {
      if (!done) {
        const step = c.it.next();
        done = step.done;
        if (!done && isPromise(step.value)) waitOn = step.value;
      }
    } catch (err) {
      console.error(err);
      chores.splice(i, 1);
      c.resolve(false);
      continue;
    }
    const took = performance.now() - now;
    c.est = Math.max(took, c.est * 0.8);
    c.starved = 0;
    ran = true;
    // (with ?profile: what that step was, by its chore's label)
    const label = choreLog && (typeof c.label === 'function' ? c.label() : c.label);
    if (choreLog) {
      choreLog[label] = (choreLog[label] || 0) + took;
      if (took > 4) (window.__slowSteps ||= []).push([+took.toFixed(1), label]);
    }
    if (waitOn) {
      c.waiting = true;
      waitOn.then(null, () => {}).then(() => {
        c.waiting = false;
        if (choreLog) choreLog[`${label} (waiting)`] = (choreLog[`${label} (waiting)`] || 0) + performance.now() - now;
        if (!running) kick();
      });
    }
    if (done) {
      chores.splice(i, 1);
      c.resolve(true);
    }
  }
}

// after each frame (a task posted from it runs once the browser has taken
// the frame): background work until shortly before the next frame is due
const afterFrame = new MessageChannel();
afterFrame.port1.onmessage = () => {
  if (!running || !chores.length) return;
  const t = performance.now();
  work(Math.max(due - MARGIN, t + (hurry ? Math.min(HURRY, Math.max(SLICE, drawMs)) : SLICE)));
  if (frameLog?.length) frameLog[frameLog.length - 1][2] += performance.now() - t;
};

function kick() {
  if (choreTimer || chores.every((c) => c.waiting)) return;
  choreTimer = setTimeout(() => {
    choreTimer = 0;
    if (running) return; // the frames take over
    work(performance.now() + 8);
    kick();
  }, 0);
}

// The time between frames, as the display (or the browser, saving power)
// paces them: the shortest of the last 32.
const gapsSeen = new Float32Array(32).fill(1000 / 60);
let gapN = 0, interval = 1000 / 60;
function paced(gap) {
  gapsSeen[gapN++ % gapsSeen.length] = gap;
  let m = Infinity;
  for (const g of gapsSeen) if (g < m) m = g;
  interval = Math.min(50, Math.max(1000 / 144, m));
}

// ---------- the repaint's masks and maps ----------
// The masks are drawn by WebGL (or Canvas 2D without it), on a canvas that's
// never on the page. Each repaint has a reveal-time map, painted for the
// painting being brushed in (in its brush, at the current size) by a worker
// where there is one, and put on the GPU.

let masks;
function maskRenderer() {
  if (masks === undefined) masks = createMaskGL(document.createElement('canvas')) || createMask2D();
  return masks;
}

function sizeMasks() {
  const m = maskRenderer();
  if (m.kind === 'webgl') m.size(Math.round(view.W * MASK_DPR), Math.round(view.CH * MASK_DPR));
  else m.size(view.W * maskScale2D, view.CH * maskScale2D);
}

function warmMasks() {
  const m = maskRenderer(), dpr = governor.dpr();
  const W = first.clientWidth, CH = Math.max(first.clientHeight, heroEl.clientHeight);
  if (m.kind === 'webgl' && W && CH) m.size(Math.round(W * Math.min(dpr, MASK_DPR)), Math.round(CH * Math.min(dpr, MASK_DPR)));
  m.warm();
}

const maps = new Map(); // `id|WxCH|seed` -> promise of { handle, latest }

function mapFor(id, seed) {
  const key = `${id}|${view.W}x${view.CH}|${seed}`;
  let p = maps.get(key);
  if (!p) {
    p = makeMap(id, seed);
    maps.set(key, p);
    p.catch(() => maps.get(key) === p && maps.delete(key));
  }
  return p;
}

async function makeMap(id, seed) {
  const def = await loader.module(id), m = maskRenderer();
  const opts = { W: view.W, CH: view.CH, seed, brushStyle: def.brushStyle };
  if (m.kind === '2d') return { handle: m.map({ plan: planReveal(opts), ...opts }), latest: revealEnd() };
  let img, latest;
  try {
    ({ map: img, latest } = await workerMap(opts));
  } catch {
    const out = {};
    if (!(await background(revealMapSteps(planReveal(opts), opts, out), () => true))) throw new Error('no map');
    img = out.map;
    latest = img.latest;
  }
  let handle = null;
  await background((function* () {
    handle = m.map(img); // onto the GPU, in a frame with time to spare
  })(), () => true);
  if (img.close) img.close();
  else release(img);
  return { handle, latest };
}

// lets go of maps for another size, unless one is in use
function trimMaps() {
  const size = `|${view.W}x${view.CH}|`, inUse = new Set(stack.map((s) => s.mask?.map));
  for (const [key, p] of maps) {
    if (key.includes(size)) continue;
    maps.delete(key);
    p.then((m) => !inUse.has(m.handle) && masks.free(m.handle), () => {});
  }
}

let worker = null, workerOk = typeof OffscreenCanvas === 'function' && typeof Worker === 'function', jobN = 0;
const jobs = new Map();
function workerMap(opts) {
  if (!workerOk) return Promise.reject(new Error('no OffscreenCanvas'));
  if (!worker) {
    try {
      worker = new Worker(new URL('./reveal-worker.js', import.meta.url), { type: 'module' });
    } catch {
      workerOk = false;
      return Promise.reject(new Error('no module workers'));
    }
    worker.onmessage = ({ data }) => {
      const job = jobs.get(data.job);
      if (!job) return;
      jobs.delete(data.job);
      if (data.map) job.resolve({ map: data.map, latest: data.latest });
      else job.reject(new Error(data.error));
    };
    worker.onerror = () => {
      workerOk = false; // paint here from now on
      for (const job of jobs.values()) job.reject(new Error('worker failed'));
      jobs.clear();
      worker.terminate();
      worker = null;
    };
  }
  const job = ++jobN;
  return new Promise((resolve, reject) => {
    jobs.set(job, { resolve, reject });
    worker.postMessage({ job, opts });
  });
}

// ---------- getting a painting ready ----------
// Before a switch, the next painting is made ready off screen, with nothing
// on screen changing: built between frames, its clock run up to
// the current one's over its last few seconds (so its smoke, drifting
// strokes and sails are already in motion), drawn once to fill its caches,
// and its repaint map painted. From then it keeps running in step with the
// painting on screen (not drawn) until it's needed. One waits at a time.

const pending = new Map(); // id -> { stage, warm, ready: promise of true when it's ready }
const nextSeed = () => (reveal && reveal.seed === SEEDS[0] ? SEEDS[1] : SEEDS[0]);

// picked: the visitor has chosen it and is waiting (not just looking at its
// card), so it's got ready in a hurry, and nothing merely looked at since
// takes its place
function prepare(id, picked = false) {
  if (!loader.has(id) || !ready) return Promise.resolve(false);
  if (picked) hurry = id;
  else if (hurry && hurry !== id) return Promise.resolve(false);
  const seed = nextSeed();
  if (stack.some((s) => s.def.id === id)) {
    // on screen already: only its map is needed (to brush it back in)
    return view.motion ? mapFor(id, seed).then(() => true, () => false) : Promise.resolve(true);
  }
  const have = pending.get(id);
  if (have) return have.ready;
  dropPending();
  if (picked) hurry = id; // (dropping the last one let go of it)
  const entry = { stage: null, warm: false, ready: null };
  const bid = buildId, alive = () => pending.get(id) === entry && bid === buildId;
  pending.set(id, entry);
  const t0 = performance.now(), log = prepLog ? (prepLog[id] = {}) : null;
  const mark = (what) => log && (log[what] = Math.round(performance.now() - t0));
  entry.ready = (async () => {
    const def = await loader.module(id);
    if (!alive()) return false;
    mark('module');
    const stage = (entry.stage = newStage(def));
    stage.fit();
    const map = view.motion ? mapFor(id, seed).then(() => mark('map'), () => null) : null;
    // built, run up to the current clock and drawn once, as one run of steps
    // (so no frame goes by idle between them)
    let part = 'build';
    const steps = (function* () {
      yield* stage.buildSteps();
      mark('build');
      part = 'warm-up';
      if (view.motion) yield* stage.warmUp(() => simTime);
      mark('warm-up');
      part = 'prime';
      yield* stage.prime();
      mark('prime');
    })();
    const label = () => (part === 'warm-up' ? part : `${stage.compositor.working || ''}${part === 'prime' ? ' (prime)' : ''}`);
    if (!(await background(steps, alive, label))) return false;
    await map;
    if (!alive()) return false;
    mark('ready');
    entry.warm = true;
    return true;
  })().catch((err) => {
    console.error(err);
    return false;
  });
  return entry.ready;
}

// it's being shown: nothing waits on getting it ready any more
const unhurry = (id) => hurry === id && (hurry = null);

function dropPending() {
  hurry = null;
  for (const [id, entry] of pending) {
    pending.delete(id);
    if (entry.stage) retire(entry.stage);
  }
}

// ---------- switching scenes ----------
// The next painting is brushed over the current one (engine/reveal.js), with
// both alive the whole time. Each draws into its own canvas every frame, and
// each frame a mask is stamped onto each: the new one shows where the brush
// has reached, the old one gives way just behind it. When the new one covers
// everything the masks simply stop (the next frame is drawn exactly as the
// last one was, unmasked) and the old one is disposed when the browser is
// idle. Should the frames run over budget, the paintings being covered slow
// to a stop over 300 ms (only those: the new one never slows).
//
// Picking another painting part-way: each mask so far is kept as it is, and
// the next repaint carries on from what's on screen, so nothing jumps.
//
// The page calls prepare(id, true), then retarget(id) (from here on the page's
// questions are answered for the new scene), then reveal(id), which settles
// once it's painted (true) or overtaken (false).

const LATE = () => (view.motion ? REVEAL_LATE : FADE);
const maskTime = (mask, s) => (mask.mode === ERASE ? s - LATE() : s);
// under reduced motion each painting's mask is a single opacity
function alphaAt(mask, s) {
  const r = Math.min(1, Math.max(0, maskTime(mask, s) / FADE));
  return mask.mode === PAINT ? mask.baked + (1 - mask.baked) * r : mask.baked * (1 - r);
}

function clearMask(st) {
  if (st.mask && typeof st.mask.baked === 'object') masks.free(st.mask.baked);
  st.mask = null;
  st.scale = 1;
  release(st.still);
  st.still = null;
  st.canvas.style.opacity = st.canvas.style.transition = '';
}

let revealSeq = 0;
async function revealTo(id) {
  if (!loader.has(id)) return false;
  const mine = ++revealSeq;
  if (reveal && reveal.target.def.id === id) {
    unhurry(id);
    return reveal.promise;
  }
  if (!reveal && stack.length === 1 && stack[0].def.id === id) {
    unhurry(id);
    target = null;
    return true;
  }
  // nothing on screen to repaint over (still loading, scrolled away, or in a
  // hidden tab): it's just shown
  if (!ready || !governor.canRun()) return showNow(id, mine);
  const ok = await prepare(id, true);
  if (mine !== revealSeq) return false;
  const stage = stageOf(id);
  if (!ok || !ready || !stage || !governor.canRun()) return showNow(id, mine);
  const seed = nextSeed();
  let src = null;
  if (view.motion) {
    try {
      src = await mapFor(id, seed);
    } catch {
      return showNow(id, mine);
    }
    if (mine !== revealSeq) return false;
    if (!ready || stageOf(id) !== stage) return showNow(id, mine);
  }
  return begin(stage, src, seed);
}

function begin(stage, src, seed) {
  const prev = reveal, m = maskRenderer();
  hurry = null;
  // the frames given up to getting it ready aren't the repaint's to answer for
  governor.begin(performance.now());
  if (view.motion) sizeMasks();
  const mw = Math.round(view.W * REVEAL.scale), mh = Math.round(view.CH * REVEAL.scale);
  // what's on screen stays as it is: each painting's mask so far is kept
  for (const st of stack) {
    const old = st.mask;
    let baked;
    if (!view.motion) baked = old ? alphaAt(old, prev.s) : 1;
    else baked = old ? m.bake({ ...old }, maskTime(old, prev.s), mw, mh) : m.one;
    if (old && typeof old.baked === 'object') m.free(old.baked);
    st.mask = { mode: ERASE, baked, map: src?.handle };
  }
  if (!stack.includes(stage)) {
    pending.delete(stage.def.id);
    stack[stack.length - 1].canvas.after(stage.canvas);
    stack.push(stage);
    stage.mask = { mode: PAINT, baked: view.motion ? m.zero : 0, map: src?.handle };
  } else stage.mask.mode = PAINT;
  // the painting brushed in never slows
  stage.scale = 1;
  release(stage.still);
  stage.still = null;
  if (prev) prev.resolve(false);
  const r = {
    target: stage, src, seed, start: 0, s: 0, dur: view.motion ? src.latest + REVEAL_LATE : 2 * FADE, easing: false,
    front: view.motion ? revealFront(view.W, seed) : null,
  };
  r.promise = new Promise((resolve) => (r.resolve = resolve));
  reveal = r;
  target = stage.def;
  if (!view.motion) stage.draw(); // a still painting: drawn once, at the hour it is
  // should they be picked again part-way: the maps for brushing each of the others back in
  const other = seed === SEEDS[0] ? SEEDS[1] : SEEDS[0];
  if (view.motion) for (const st of stack) if (st !== stage) mapFor(st.def.id, other).catch(() => {});
  start();
  return r.promise;
}

// the repaint's clock, before a frame is drawn (?slowmo=20 runs it twenty
// times slower, for looking at it closely)
const SLOWMO = Math.max(1, Number(params.get('slowmo')) || 1);
function advanceReveal(now, dt) {
  const r = reveal;
  if (!r.start) r.start = now;
  r.s = Math.min(r.dur, (now - r.start) / 1000 / SLOWMO);
  if (!r.easing && view.motion && governor.strained()) r.easing = true;
  if (r.easing) for (const st of stack) if (st !== r.target) st.scale = Math.max(0, st.scale - dt / 300);
}

// one painting's frame during a repaint: drawn, then its mask stamped on
// Where a painting can show at all at s (CSS px, [left, right]), so it's
// drawn only there: the one being brushed in, up to a little ahead of the
// furthest stroke; the others, from a little behind where the wave has
// covered everything. (Elsewhere its mask is 0.)
const REACH = 320; // px: a stroke's furthest reach past where it starts, brush and all
function shows(st, s) {
  const { front } = reveal, m = st.mask;
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y <= view.CH; y += 24) {
    const ahead = front.at(s + 0.11, y), behind = front.at(s - REVEAL_LATE - front.lag - 0.02, y);
    if (ahead > hi) hi = ahead;
    if (behind < lo) lo = behind;
  }
  if (m.mode === PAINT) return m.baked === masks.zero ? [0, Math.min(view.W, hi + REACH)] : null;
  return lo > 0 ? [Math.min(view.W, lo - 4), view.W] : null;
}

function drawMasked(st, s) {
  const g = st.ctx;
  if (st.scale > 0) st.draw(shows(st, s));
  else if (!st.still) {
    // its clock has stopped: its last frame is kept, and only its mask moves on
    st.draw();
    const [c, cg] = offscreen(st.canvas.width, st.canvas.height);
    cg.drawImage(st.canvas, 0, 0);
    st.still = c;
  } else {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.drawImage(st.still, 0, 0);
  }
  const img = masks.draw(st.mask, maskTime(st.mask, s));
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0, st.canvas.width, st.canvas.height);
  g.globalCompositeOperation = 'source-over';
  onstage(st);
}

function fade(st, s) {
  st.canvas.style.transition = 'none';
  st.canvas.style.opacity = String(alphaAt(st.mask, s));
  onstage(st);
}

const onstage = (st) => st.canvas.classList.contains('offstage') && st.canvas.classList.remove('offstage');

// The new painting covers everything: the others go, and it carries on
// unmasked. Nothing is rebuilt or reset.
function handoff() {
  const r = reveal, keep = r.target;
  reveal = null;
  for (const st of stack) if (st !== keep) retire(st);
  clearMask(keep);
  onstage(keep);
  stack = [keep];
  target = null;
  adopt(keep);
  trimMaps();
  r.resolve(true);
  window.dispatchEvent(new CustomEvent('scenepainted', { detail: describe(keep.def) }));
}

// a repaint nobody can see (a hidden tab, say) is done at once
function finishNow() {
  if (!reveal) return;
  reveal.s = reveal.dur;
  handoff();
}

function dropReveal() {
  if (!reveal) return;
  const r = reveal;
  reveal = null;
  for (const st of stack) clearMask(st);
  r.resolve(false);
}

// Shows a scene without a repaint: at once if it's ready, or else built from scratch.
async function showNow(id, mine) {
  unhurry(id);
  const entry = pending.get(id);
  const stage = stack.find((s) => s.def.id === id) || (entry?.warm ? entry.stage : null);
  if (stage && ready) {
    const r = reveal;
    reveal = null;
    pending.delete(id);
    if (!stack.includes(stage)) stack[stack.length - 1].canvas.after(stage.canvas);
    for (const st of stack) if (st !== stage) retire(st);
    clearMask(stage);
    stack = [stage];
    target = null;
    adopt(stage);
    stage.draw();
    onstage(stage);
    r?.resolve(false);
    window.dispatchEvent(new CustomEvent('scenepainted', { detail: describe(stage.def) }));
    return true;
  }
  const ok = await show(id);
  if (ok) window.dispatchEvent(new CustomEvent('scenepainted', { detail: describe(stack[0].def) }));
  return ok && mine === revealSeq;
}

// ---------- sizing ----------

// Rebuilds the painting only when the size changes meaningfully (not for a
// phone's address bar sliding away). The old picture stays up, stretched a
// little, until the new one is ready. A repaint in progress ends at once.
async function resize(force) {
  if (!stack.length) return;
  const w = first.clientWidth, h = heroEl.clientHeight, ch = first.clientHeight;
  if (!w || !h) return;
  const widthChanged = Math.abs(w - builtW) >= 40;
  // on phones the address bar sliding changes only the height: never repaint for that
  const heightChanged = !coarsePointer && Math.abs(h - builtH) >= h * 0.15;
  if (!force && !widthChanged && !heightChanged) return;
  finishNow();
  dropPending();
  const stage = stack[0];
  builtW = w;
  builtH = h;
  Object.assign(view, { dpr: governor.dpr(), W: w, H: h, CH: Math.max(ch, h), density: w < 640 ? 0.5 : 1, motion: governor.motion });
  wind.setWidth(w);
  ready = false;
  const id = ++buildId;
  stage.size(view);
  if (!(await stage.build(() => id === buildId && stack[0] === stage))) return;
  stage.fit();
  checkSky();
  ready = true;
  stage.draw();
  onstage(stage);
  trimMaps();
  if (!shown) {
    shown = true;
    first.classList.add('ready'); // crossfades over the still placeholder
    window.dispatchEvent(new CustomEvent('sceneready'));
  }
  start();
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => resize(false), 200);
});

// the wind only blows while the sky is in view; viewTop/viewBottom are the
// rows of the canvas on screen, so layers can skip what can't be seen
const checkSky = () => {
  view.skyInView = window.scrollY < heroEl.offsetTop + (stack[0]?.state.horizonY ?? 0);
  view.viewTop = window.scrollY - heroEl.offsetTop;
  view.viewBottom = view.viewTop + window.innerHeight;
  const { skyInView, viewTop, viewBottom } = view;
  for (const st of stack) Object.assign(st.state, { skyInView, viewTop, viewBottom });
  for (const p of pending.values()) if (p.stage) Object.assign(p.stage.state, { skyInView, viewTop, viewBottom });
};
window.addEventListener('scroll', checkSky, { passive: true });

// ---------- the loop ----------
// It only runs while the painting is on screen and the tab is visible.
// After a pause everything carries on from where it was.

function start() {
  if (running || !ready || !governor.canRun()) return;
  running = true;
  loops++;
  last = performance.now();
  lastFrame = 0; // (the first frame's gap is no measure of the pace)
  governor.begin(last);
  rafId = requestAnimationFrame(frame);
}

function stop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (running) loops--;
  running = false;
  kick();
}

// every stage that runs: those on screen, and one made ready off screen
function live() {
  const out = stack.slice();
  for (const p of pending.values()) if (p.warm) out.push(p.stage);
  return out;
}

function frame(now) {
  rafId = 0;
  if (!ready || !governor.canRun()) {
    running = false;
    loops--;
    finishNow();
    kick();
    return;
  }
  const t0 = performance.now(), dt = Math.min(100, now - last);
  let t1 = t0;
  last = now;
  if (!view.motion) {
    // Under prefers-reduced-motion the painting is still: nothing advances,
    // and it's only redrawn when the hour changes (the slider jumps there).
    const hour = time.hour;
    time.snap();
    if (time.hour !== hour) {
      for (const st of stack) {
        st.relight();
        st.draw();
      }
    }
    if (reveal) {
      advanceReveal(now, dt);
      for (const st of stack) if (st.mask) fade(st, reveal.s);
    }
  } else {
    acc += dt;
    while (acc >= STEP) {
      simTime += STEP;
      step();
      acc -= STEP;
    }
    t1 = performance.now();
    if (view.skyInView) {
      const dts = Math.min(dt, 50) / 1000;
      wind.update(dts);
      for (const st of live()) st.frame(dts);
    }
    if (reveal) advanceReveal(now, dt);
    draw();
  }
  const repainting = !!reveal;
  if (reveal && reveal.s >= reveal.dur) handoff();
  const t2 = performance.now();
  governor.trackFrame(t2 - t0, t2 - t1, now, !repainting);
  if (lastFrame) paced(now - lastFrame);
  lastFrame = now;
  due = now + interval;
  drawMs = t2 - t0;
  if (frameLog) frameLog.push([now, t2 - t0, 0, repainting ? 1 : 0]);
  if (running) {
    rafId = requestAnimationFrame(frame); // unless something stopped the loop during this frame
    if (chores.length) afterFrame.port2.postMessage(0);
  }
}

function step() {
  time.step();
  pointer.step();
  if (pointer.moved > 700) hint.classList.add('hidden');
  for (const st of live()) st.step();
}

function draw() {
  for (const st of stack) {
    if (st.mask && reveal) drawMasked(st, reveal.s);
    else st.draw();
  }
}

// ---------- night & the hint ----------

let hintTimer = 0, wasNight = null;

function showHint(night) {
  const text = adopted?.inst.interactions?.hint;
  if (!text) return;
  hint.textContent = (night ? text.night : text.day).replace('{pointer}', coarsePointer ? 'finger' : 'cursor');
  hint.classList.remove('hidden');
  pointer.moved = 0;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.add('hidden'), 9000);
}

function checkNight() {
  const night = time.light.dark > 0.5;
  if (night === wasNight) return;
  wasNight = night;
  document.body.classList.toggle('night', night);
  showHint(night);
}

time.updateUI();
document.body.classList.toggle('night', time.light.dark > 0.5);
setInterval(() => {
  time.updateUI();
  if (adopted) checkNight();
  time.emit();
}, 500);

// ---------- for the page around the painting ----------

window.paintedScene = {
  // jump the painting to an hour (0–24), or null to follow the real clock
  setHour: time.setHour,
  get hour() {
    return time.target();
  },
  get manual() {
    return time.manual;
  },

  // the scene showing (or being switched to), and every scene there is
  get scene() {
    const def = sceneDef();
    return def && describe(def);
  },
  scenes: SCENES.map(({ id, label, after }) => ({ id, label, after, thumb: thumb(id) })),

  // Switching, a step at a time (site.js runs the steps): get a scene ready
  // off screen (resolves true once it is; the gallery also does this as it
  // opens and as a card is pointed at; `prepare(id, true)` once it's been
  // picked), let go of one got ready and not used, make the page's questions
  // below answer for it, and brush it in (resolves true once it's painted,
  // false if another switch overtook it).
  prepare,
  release: () => !reveal && dropPending(),
  // fetch every painting's module (as the gallery opens), so none is waited for when picked
  preload: () => SCENES.forEach(({ id }) => loader.module(id).catch(() => {})),
  async retarget(id) {
    const def = await loader.module(id);
    target = def === stack[0]?.def && !reveal ? null : def;
    time.setPalettes(def.palettes);
    root.dataset.scene = id;
    return describe(def);
  },
  reveal: revealTo,
  // how dark the painting's sky is at the hour chosen (0 day – 1 night), for the scene showing or being switched to
  dark: () => time.lightAt(time.target()).dark,
  // about how long a repaint takes (s)
  revealSeconds: () => (view.motion ? REVEAL.front + REVEAL.lag / 2 : 2 * FADE),

  // the CSS variables (and browser theme colour) for the page below the
  // painting, for 'day', 'evening' or 'night'
  contentTheme(name) {
    const themes = sceneDef()?.contentTheme;
    if (!themes) return null;
    const t = themes[name] || (name === 'evening' ? themes.day : themes.night);
    return { themeColor: t.themeColor || themes.day.themeColor, vars: { ...themes.day.vars, ...t.vars } };
  },

  // the hero text's style for the sky at this hour, if the scene has its
  // own: { tone, vars }
  heroTone() {
    const def = sceneDef(), tones = def?.contentTheme?.hero;
    if (!tones || !def.heroTone) return null;
    const tone = def.heroTone(lightAt(keyframes(def.palettes), time.target()));
    return { tone, vars: tones[tone] };
  },

  // where the scene's bright or busy parts sit (CSS px within the hero),
  // so text over the sky can keep clear of them
  obstacles() {
    const def = sceneDef(), stage = def && stageOf(def.id);
    if (!stage?.inst.obstacles) return null;
    const h = time.target();
    return stage.inst.obstacles(h, stage.lightAt(h));
  },

  // recent frame times (ms of work per frame, all and animated layers only),
  // for checking performance
  stats() {
    return {
      running, loops, wind: view.motion, gust: wind.gust, scene: stack[0]?.def.id, switching: !!reveal,
      phase: reveal ? 'reveal' : null,
      stages: stack.map((s) => s.def.id), scales: stack.map((s) => +s.scale.toFixed(2)), pending: [...pending.keys()],
      repaint: reveal ? reveal.s / reveal.dur : null,
      revealTime: reveal ? reveal.s : null,
      renderer: masks?.kind || null, chores: chores.length,
      ...governor.stats(), ...(adopted?.inst.stats?.() || {}),
      ...(shared.profile && adopted ? { layers: adopted.compositor.timings() } : {}),
      // with ?profile: ms into getting each painting ready that each part was done, and ms of background work by kind
      ...(prepLog ? { prepare: prepLog, background: Object.fromEntries(Object.entries(choreLog).map(([k, v]) => [k || 'other', Math.round(v)])) } : {}),
    };
  },
  // where each moving thing is in every painting that runs (on screen, or
  // ready off screen), for checking that nothing jumps (scenes report these
  // through their own trace())
  trace() {
    return {
      wind: wind.t,
      stages: live().map((st) => ({
        id: st.def.id, sim: st.sim, scale: st.scale, shown: stack.includes(st), masked: !!st.mask, ...(st.inst.trace?.() || {}),
      })),
    };
  },
};

// the page's script (site.js) runs first and waits for this
window.dispatchEvent(new Event('paintedscene'));

// ---------- start ----------
// The scene is set up as soon as its module arrives, so the page can take
// its colours; it's painted at firstPaint.

// (index.html's first script picks it: the link's ?scene=, else this
// visitor's last choice, else the default)
const wanted = root.dataset.scene || params.get('scene');
show(loader.has(wanted) ? wanted : DEFAULT_SCENE);
