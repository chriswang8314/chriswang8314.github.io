/*
 * The repaint, planned ahead: the next painting is brushed over the current
 * one in a wave from left to right, as if the canvas were being painted again.
 *
 * Everything is worked out before it starts. planReveal lays out the
 * strokes (where, at what angle, how long, and when each begins): big strokes
 * at the wave's front, smaller ones catching up behind it to fill every gap.
 * paintRevealMap then paints them once, in the new painting's own brush, into
 * a "reveal-time" map: each pixel holds the moment it gets painted (0–255
 * over the whole repaint). Along each stroke that time runs from its start to
 * its end, so a stroke draws itself rather than popping in; the edges of the
 * brush come out a touch later than its middle, which softens them. Under all
 * the strokes a smooth wave with a noise-shaped edge guarantees that every
 * pixel is painted by the end.
 *
 * Both paintings stay live through the repaint, each drawing into its own
 * canvas; each frame, a mask from the map is stamped onto them: the new
 * painting shows where its pixel's time has come, and the old one gives way
 * just after (createMaskGL, one draw call per painting; or, without WebGL,
 * createMask2D, which adds just the strokes that have started).
 */
import { createBrush } from './brush.js';
import { fbm } from './noise.js';
import { offscreen, mulberry32, release } from './util.js';

export const REVEAL = {
  front: 1.25, // seconds for the wave's front to sweep across (eased in and out)
  lag: 0.15, // behind the front, everything is painted within this (no gaps)
  stroke: [0.15, 0.25], // how long one stroke takes to draw itself
  scale: 0.6, // the map's resolution, relative to CSS px
  edge: 7, // softness of a stroke's edge in the shader, in map levels (of 255)
};

const ease = (p) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2; // ease-in-out
const easeInv = (u) => Math.acos(1 - 2 * Math.min(1, Math.max(0, u))) / Math.PI;

// The front: where it has reached on row y at time s (seconds, CSS px), and
// when it reaches x. It wanders with noise, wide and fine, so its edge is
// never a line. Behind it the wave paints everything within REVEAL.lag.
export function revealFront(W, seed = 11) {
  const wander = (y) => (fbm(y * 0.0035, seed) - 0.5) * W * 0.24 + (fbm(y * 0.02 + 9, seed) - 0.5) * W * 0.05;
  const span = W * 1.3, start = -W * 0.15, T = REVEAL.front;
  return {
    lag: REVEAL.lag,
    at: (s, y) => start + span * ease(s / T) + wander(y),
    when: (x, y) => T * easeInv((x - wander(y) - start) / span),
    // `when` along one row (its wander worked out once)
    row(y) {
      const w = wander(y);
      return (x) => T * easeInv((x - w - start) / span);
    },
  };
}

// The latest any pixel is painted (seconds); the map's 0–255 spans 0 to this
export const revealEnd = () => REVEAL.front + REVEAL.lag + REVEAL.stroke[1];

// The old painting gives way this long (seconds) after the new one has
// covered a pixel, so the two never both show half-through (the page would
// show through between them)
export const REVEAL_LATE = (1.5 * REVEAL.edge * revealEnd()) / 255;

// The strokes, in CSS px and seconds. Each: { x, y, angle, len, width, t0, dur, stamp }
export function planReveal({ W, CH, seed = 11 }) {
  const rng = mulberry32(seed * 7919), front = revealFront(W, seed), strokes = [];
  const area = (W * CH) / (1440 * 1215);
  const lay = (n, size, lag) => {
    for (let i = 0; i < n; i++) {
      const y = rng() * CH, x = -W * 0.05 + rng() * W * 1.1;
      const len = size[0] + rng() * (size[1] - size[0]);
      // the brush runs left to right, rising a little, as a painter's would
      const angle = -0.32 + (rng() - 0.5) * 0.7;
      const t0 = Math.max(0, front.when(x, y) + lag[0] + rng() * (lag[1] - lag[0]));
      const dur = REVEAL.stroke[0] + rng() * (REVEAL.stroke[1] - REVEAL.stroke[0]);
      strokes.push({ x, y, angle, len, width: len * (0.28 + rng() * 0.1), t0, dur, stamp: (rng() * STAMPS) | 0 });
    }
  };
  // big strokes at the front, then smaller ones catching up behind it
  lay(Math.round(170 * area), [170, 280], [-0.06, 0.04]);
  lay(Math.round(420 * area), [70, 150], [0.02, 0.12]);
  return { strokes, front, seed };
}

// the strokes' shapes, in a painting's brush: white on clear, pointing right
const STAMPS = 8, ST_LEN = 200, ST_W = 64, ST_PAD = 14;
function paintStamps(brushStyle, seed) {
  const brush = createBrush(brushStyle), rng = mulberry32(seed);
  return Array.from({ length: STAMPS }, () => {
    const [c, g] = offscreen(ST_LEN + ST_PAD * 2, ST_W * 1.7 + ST_PAD * 2);
    brush.paintStroke(g, rng, { x: ST_PAD, y: c.height / 2, angle: 0, len: ST_LEN, width: ST_W, color: [255, 255, 255], bend: (rng() - 0.5) * 0.3 });
    return c;
  });
}

// Paints the reveal-time map for a plan: grey levels are times (0 = at once,
// 255 = revealEnd()), on a canvas at REVEAL.scale of the CSS size. Painted
// with 'darken', so where strokes overlap the earliest wins. Its `latest` is
// the moment its last pixel is painted (the repaint can end there).
export function paintRevealMap(plan, opts) {
  const out = {};
  for (const _ of revealMapSteps(plan, opts, out));
  return out.map;
}

// the same, in small steps (a generator), for painting it on the page a
// little at a time; the map is left in out.map
export function* revealMapSteps(plan, { W, CH, brushStyle }, out) {
  const S = REVEAL.scale, end = revealEnd();
  const mw = Math.max(1, Math.round(W * S)), mh = Math.max(1, Math.round(CH * S));
  const [map, g] = offscreen(mw, mh);
  const level = (s) => Math.max(0, Math.min(255, Math.round((s / end) * 255)));
  const grey = (s) => {
    const v = level(s);
    return `rgb(${v},${v},${v})`;
  };

  // the wave beneath it all: every pixel painted a little after the front
  // passes, so no gaps survive
  const img = g.createImageData(mw, mh), d = img.data;
  for (let j = 0; j < mh; j++) {
    const when = plan.front.row(j / S);
    for (let i = 0; i < mw; i++) {
      const v = level(when(i / S) + plan.front.lag), k = (j * mw + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = v;
      d[k + 3] = 255;
    }
    if (j % 24 === 23) yield;
  }
  g.putImageData(img, 0, 0);
  yield;

  // Each stroke: a ramp of times along its length (eased out: it starts fast
  // and settles), cut to the stroke's shape, then darkened into the map.
  const stamps = paintStamps(brushStyle, plan.seed);
  const [tmp, tg] = offscreen(stamps[0].width, stamps[0].height);
  g.globalCompositeOperation = 'darken';
  let n = 0;
  for (const s of plan.strokes) {
    const st = stamps[s.stamp], sx = (s.len / ST_LEN) * S, sy = (s.width / ST_W) * S;
    const ramp = tg.createLinearGradient(ST_PAD, 0, ST_PAD + ST_LEN, 0);
    for (let k = 0; k <= 8; k++) {
      const u = k / 8; // the brush reaches u at time 1 - sqrt(1 - u) of its run (ease-out)
      ramp.addColorStop(u, grey(s.t0 + s.dur * (1 - Math.sqrt(1 - u))));
    }
    tg.globalCompositeOperation = 'copy';
    tg.fillStyle = ramp;
    tg.fillRect(0, 0, tmp.width, tmp.height);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(st, 0, 0);
    const cos = Math.cos(s.angle), sin = Math.sin(s.angle);
    g.setTransform(cos * sx, sin * sx, -sin * sy, cos * sy, s.x * S, s.y * S);
    g.drawImage(tmp, -ST_PAD, -tmp.height / 2);
    if (++n % 40 === 0) yield;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  [tmp, ...stamps].forEach(release);
  yield;
  const px = g.getImageData(0, 0, mw, mh).data;
  let latest = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] > latest) latest = px[i];
  map.latest = (latest / 255) * end + 1 / 60;
  out.map = map;
}

// ---------- the masks: WebGL ----------
// Each painting on screen during a repaint has a mask: how much of it shows,
// pixel by pixel. The painting being brushed in is "painted" (shown where its
// time has come, on top of whatever of it showed already); the others are
// "erased" a moment later (REVEAL_LATE), so by the end only the new one is
// left. If another painting is picked part-way, each mask so far is baked
// into a texture (bake) and the next repaint carries on from there.
//
// Each frame, draw() renders one painting's mask into this canvas (one draw
// call) and the engine stamps it onto that painting's canvas with
// 'destination-in'. The context and shader are made once, at load, and kept.

const VERT = `attribute vec2 p; uniform float flip; varying vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - flip * p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision mediump float;
varying vec2 uv;
uniform sampler2D mapTex, bakedTex;
uniform float now, edge, mode;
void main() {
  float t = texture2D(mapTex, uv).r;
  float b = texture2D(bakedTex, uv).a;
  // painted once its time has come, over a soft brush edge
  float r = smoothstep(t - edge, t + edge * 0.25, now);
  float a = mode < 0.5 ? b + (1.0 - b) * r : b * (1.0 - r);
  gl_FragColor = vec4(a);
}`;

export const PAINT = 0, ERASE = 1;

export function createMaskGL(canvas) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) return null;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(prog, n);
  const uNow = u('now'), uMode = u('mode'), uFlip = u('flip');
  gl.uniform1f(u('edge'), REVEAL.edge / 255);
  gl.uniform1i(u('mapTex'), 0);
  gl.uniform1i(u('bakedTex'), 1);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const fb = gl.createFramebuffer();

  const texture = (w, h, src) => {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2); // a spare unit, so the draw's bindings are left alone
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (src && !ArrayBuffer.isView(src)) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src || null);
    return { tex, w, h };
  };
  // nothing of it shows yet; all of it shows
  const zero = texture(1, 1, new Uint8Array([0, 0, 0, 0])), one = texture(1, 1, new Uint8Array([255, 255, 255, 255]));

  const render = ({ map, baked, mode }, s) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, (map || zero).tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (baked || zero).tex);
    gl.uniform1f(uNow, map ? s / revealEnd() : -1);
    gl.uniform1f(uMode, mode);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  return {
    kind: 'webgl',
    canvas,
    zero,
    one,
    size(w, h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    },
    // a reveal-time map onto the GPU
    map: (img) => texture(img.width, img.height, img),
    // m: { map, baked, mode: PAINT or ERASE }; s: seconds into the repaint.
    // Returns the canvas holding the mask (until the next draw).
    draw(m, s) {
      gl.uniform1f(uFlip, 1);
      gl.viewport(0, 0, canvas.width, canvas.height);
      render(m, s);
      return canvas;
    },
    // the mask as it is at s, kept in a new w × h texture
    bake(m, s, w, h) {
      const out = texture(w, h, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.tex, 0);
      gl.viewport(0, 0, w, h);
      gl.uniform1f(uFlip, -1); // rows top first, as in an uploaded image
      render(m, s);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out;
    },
    free(h) {
      if (h && h !== zero && h !== one) gl.deleteTexture(h.tex);
    },
    // compile, draw once and wait for the GPU, so the first real use costs nothing
    warm() {
      this.draw({ map: null, baked: one, mode: PAINT }, 0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    },
  };
}

// ---------- the masks: Canvas 2D, without WebGL ----------
// The same masks, at half resolution. A map here is the plan itself, drawn on
// stroke by stroke as time passes (each frame adds the wave's band since the
// last frame, and of each stroke that has begun only the part drawn since);
// there's one copy of it running on time and one running REVEAL_LATE behind.

const S2D = 0.5;

function strokePainter(plan, stamps, W, CH) {
  const [mask, mg] = offscreen(W * S2D, CH * S2D);
  const order = [...plan.strokes].sort((a, b) => a.t0 - b.t0).map((s) => ({ ...s, reached: 0 }));
  const live = new Set();
  let next = 0, at = -Infinity;
  mg.fillStyle = '#fff';
  return {
    canvas: mask,
    advance(s) {
      if (s <= at) return;
      at = s;
      // the wave behind the front (it only grows, so this adds a thin band)
      mg.setTransform(S2D, 0, 0, S2D, 0, 0);
      mg.beginPath();
      mg.moveTo(-20, -20);
      for (let y = -20; y <= CH + 20; y += 12) mg.lineTo(plan.front.at(s - plan.front.lag, y), y);
      mg.lineTo(-20, CH + 20);
      mg.closePath();
      mg.fill();
      // strokes that have begun, each drawn on from where it reached last frame
      while (next < order.length && order[next].t0 <= s) live.add(order[next++]);
      for (const st of live) {
        const p = Math.min(1, (s - st.t0) / st.dur), u = 1 - (1 - p) ** 2; // ease-out along the stroke
        const img = stamps[st.stamp], sx = (st.len / ST_LEN) * S2D, sy = (st.width / ST_W) * S2D;
        const cos = Math.cos(st.angle), sin = Math.sin(st.angle), to = ST_PAD + ST_LEN * u;
        mg.setTransform(cos * sx, sin * sx, -sin * sy, cos * sy, st.x * S2D, st.y * S2D);
        if (to > st.reached) {
          const from = Math.max(0, st.reached - 1);
          mg.drawImage(img, from, 0, to - from, img.height, from - ST_PAD, -img.height / 2, to - from, img.height);
          st.reached = to;
        }
        if (p >= 1) live.delete(st);
      }
      mg.setTransform(1, 0, 0, 1, 0, 0);
      if (s >= revealEnd()) mg.fillRect(0, 0, mask.width, mask.height);
    },
    release: () => release(mask),
  };
}

export function createMask2D() {
  const [scratch, sg] = offscreen(1, 1);
  const zero = { kind: 'zero' }, one = { kind: 'one' };
  const compose = ({ map, baked, mode }, s) => {
    sg.globalCompositeOperation = 'copy';
    if (baked && baked.canvas) sg.drawImage(baked.canvas, 0, 0);
    else {
      sg.fillStyle = baked === one ? '#fff' : 'rgba(0,0,0,0)';
      sg.fillRect(0, 0, scratch.width, scratch.height);
    }
    if (map) {
      const r = map.painters[mode];
      r.advance(s);
      sg.globalCompositeOperation = mode === PAINT ? 'source-over' : 'destination-out';
      sg.drawImage(r.canvas, 0, 0);
    }
    sg.globalCompositeOperation = 'source-over';
    return scratch;
  };
  return {
    kind: '2d',
    canvas: scratch,
    zero,
    one,
    size(w, h) {
      const mw = Math.max(1, Math.round(w)), mh = Math.max(1, Math.round(h));
      if (scratch.width !== mw || scratch.height !== mh) {
        scratch.width = mw;
        scratch.height = mh;
      }
    },
    // a map here: { plan, W, CH, brushStyle }
    map({ plan, W, CH, brushStyle }) {
      const stamps = paintStamps(brushStyle, plan.seed);
      return { stamps, painters: [strokePainter(plan, stamps, W, CH), strokePainter(plan, stamps, W, CH)] };
    },
    draw: compose,
    bake(m, s) {
      const [c, g] = offscreen(scratch.width, scratch.height);
      g.drawImage(compose(m, s), 0, 0);
      return { canvas: c };
    },
    free(h) {
      if (!h || h === zero || h === one) return;
      if (h.canvas) release(h.canvas);
      if (h.painters) {
        h.painters.forEach((p) => p.release());
        h.stamps.forEach(release);
      }
    },
    warm() {},
  };
}

// The masks' size: the 2D masks work at S2D of CSS px; the WebGL ones at device px
export const maskScale2D = S2D;
