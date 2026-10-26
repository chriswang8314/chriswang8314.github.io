/*
 * Water, for any scene that has it: one swell model, Monet's painted
 * reflections, and the single pass that makes them move.
 *
 *  - The swell: a few long, slow sine swells rolling toward the viewer (and
 *    a little sideways), with a fine chop on top that a gust stirs up. It's
 *    defined on the water's plane, so seen in perspective its ripples are
 *    fine and packed near the horizon and broad and slow toward the viewer.
 *    swellAt() gives its height and slopes anywhere (a boat riding it, a
 *    highlight catching the light); SWELL_GLSL is the same function for a
 *    shader, written out from the same table, so the two never disagree.
 *  - paintReflection(): what's above the water, already flipped, worked over
 *    as Monet paints a reflection: pulled into vertical streaks, darker and
 *    richer than the things themselves, broken by level pale ripples, and
 *    breaking up and fading further from the waterline. Worker-safe, for
 *    baking (engine/bake.js).
 *  - createWaterGL(): each frame, one fragment-shader pass over a scene's
 *    reflection buffer at half resolution, its lookups displaced by the
 *    swell's slopes and one drifting low-res noise texture (two texture reads
 *    a pixel), with a pale glint where the water tilts toward the viewer.
 *    Without WebGL, drawStrips() does the same in level strips with Canvas 2D.
 *
 * The water's plane: a point y px below the horizon is at distance Z =
 * unit / y, where unit is the px from the horizon to the bottom of the hero
 * (so Z = 1 there); across, X = (x - W/2) / unit × Z.
 */
import { TAU, clamp, smooth, offscreen, release, rgb } from './util.js';

// wavelength (plane units), heading (rad; 0 = straight at the viewer, + to
// the right), period (s) and steepness (the slope it gives); chop ones are
// scaled by the chop (1 calm – about 2 in a gust)
const WAVES = [
  { len: 1.3, dir: -0.1, period: 11, amp: 0.3 },
  { len: 0.85, dir: 0.22, period: 8.5, amp: 0.36 },
  { len: 0.52, dir: -0.36, period: 6.4, amp: 0.3 },
  { len: 0.34, dir: 0.5, period: 5.1, amp: 0.24 },
  { len: 0.12, dir: 1.0, period: 2.4, amp: 0.13, chop: true },
  { len: 0.08, dir: -1.15, period: 1.8, amp: 0.1, chop: true },
].map((w, i) => {
  const k = TAU / w.len, dx = Math.sin(w.dir), dz = Math.cos(w.dir);
  return { ...w, k, dx, dz, kx: k * dx, kz: k * dz, om: TAU / w.period, ph: i * 2.39 };
});

// a wave is let go where it would show finer than this on screen (px), so the
// horizon never flickers
const FINEST = [3, 10];

// the plane under a screen point (CSS px); view: { W, horizonY, unit }
export function planeAt(x, y, view, out = [0, 0]) {
  const Z = view.unit / Math.max(0.5, y - view.horizonY);
  out[0] = ((x - view.W / 2) / view.unit) * Z;
  out[1] = Z;
  return out;
}

// The swell at a point of the plane at time t (s): [height, slope across,
// slope away from the viewer] (a positive slope away means the surface tilts
// toward the viewer). unit: as in planeAt, for letting go of waves too fine to see.
export function swellAt(X, Z, t, chop, unit, out = [0, 0, 0]) {
  let h = 0, sx = 0, sz = 0;
  for (const w of WAVES) {
    const fade = smooth(FINEST[0], FINEST[1], (w.len * unit) / (Z * Z)) * (w.chop ? chop : 1);
    if (fade <= 0) continue;
    const ph = w.kx * X + w.kz * Z + w.om * t + w.ph, a = w.amp * fade, c = Math.cos(ph) * a;
    h += (Math.sin(ph) * a) / w.k;
    sx += c * w.dx;
    sz += c * w.dz;
  }
  out[0] = h;
  out[1] = sx;
  out[2] = sz;
  return out;
}

// the chop for the wind's gust (1 calm – 1.8)
export const chopFor = (gust) => 1 + 1.4 * (gust - 1);

const f = (v) => v.toFixed(6);
// the same as swellAt, for a shader: vec3 swell(vec2 P, float t, float chop, float unit)
export const SWELL_GLSL = `vec3 swell(vec2 P, float t, float chop, float unit) {
  vec3 s = vec3(0.0);
  float ph, a, fade;
  float zz = P.y * P.y;
${WAVES.map((w) => `  fade = smoothstep(${f(FINEST[0])}, ${f(FINEST[1])}, ${f(w.len)} * unit / zz)${w.chop ? ' * chop' : ''};
  ph = ${f(w.kx)} * P.x + ${f(w.kz)} * P.y + ${f(w.om)} * t + ${f(w.ph)};
  a = ${f(w.amp)} * fade;
  s += a * vec3(sin(ph) / ${f(w.k)}, cos(ph) * ${f(w.dx)}, cos(ph) * ${f(w.dz)});`).join('\n')}
  return s;
}`;

// ---------- painted reflections ----------

// `src` is what's above the water, already flipped (its row 0 is the
// waterline); returns a new canvas the same size and lets src go. In device
// px: fade, how far down it lasts; scale, device px per CSS px; k, the
// scene's stroke scale. brush: a wet brush of the scene's (for the ripples).
export function paintReflection(src, rng, brush, { fade, scale, k = 1, stretch = 0.16, gaps = 1, darken = 0.55, deep = [46, 58, 58] }) {
  const w = src.width, h = src.height, u = k * scale;
  const [c, g] = offscreen(w, h);
  g.globalAlpha = 0.7;
  g.drawImage(src, 0, 0);
  // dragged straight down, as a loaded brush pulls paint
  for (let i = 1; i <= 6; i++) {
    g.globalAlpha = 0.3 * (1 - i / 7);
    g.drawImage(src, 0, i * 1.8 * u);
  }
  // and in broad vertical streaks, each pulled down a little and nudged sideways
  for (let x = 0; x < w;) {
    const sw = Math.max(2, (10 + rng() * 20) * u);
    g.globalAlpha = 0.25 + rng() * 0.2;
    g.drawImage(src, x, 0, sw, h, x + (rng() - 0.5) * 3 * u, rng() * 4 * scale, sw, h * (1 + rng() * stretch));
    x += sw * (0.5 + rng() * 0.4);
  }
  // darker and more saturated: the streaks multiplied by themselves
  g.globalAlpha = darken;
  g.globalCompositeOperation = 'multiply';
  g.drawImage(c, 0, 0);
  // and drawn a little toward the water's deep green-black
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = 0.14;
  g.fillStyle = rgb(deep);
  g.fillRect(0, 0, w, h);
  // broken by level ripple gaps, more and longer further down
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 1;
  for (let y = 0; y < h; y += (2.5 + rng() * 4) * u) {
    const t = Math.min(1, y / fade);
    if (rng() > 0.05 + 0.6 * t * gaps) continue;
    const len = (14 + rng() * 50) * u * (0.5 + t);
    for (let x = -rng() * len; x < w; x += len * (1.4 + rng() * 2.6)) {
      brush.paintStroke(g, rng, {
        x, y, angle: (rng() - 0.5) * 0.04, len: len * (0.5 + rng() * 0.7), width: (1.2 + rng() * 2.4 * (1 + t)) * u,
        color: [0, 0, 0], alpha: 0.35 + rng() * 0.5, bristles: 3,
      });
    }
  }
  // and fading away below
  const grad = g.createLinearGradient(0, 0, 0, fade);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.1)');
  grad.addColorStop(0.8, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  release(src);
  return c;
}

// ---------- the distortion pass: WebGL ----------

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D reflTex, noiseTex;
uniform vec2 res;      // this canvas, px
uniform vec3 view;     // the region's width and height (CSS px; it starts at the horizon) and unit
uniform vec4 amp;      // px of displacement: swell across, swell down, noise across, noise down
uniform float t, chop, detail, glint;
uniform vec3 pale;
uniform vec3 tint;     // the hour's light, as engine/light.js lays it over paint: multiplied in,
uniform float desat;   // the colour drained away,
uniform vec4 wash;     // and a colour glazed over (rgb, amount)
uniform vec4 lights[4]; // lamps and lit windows: x, the row their streak starts (CSS px), strength, width
uniform vec3 lightColor;
uniform vec3 moon;     // x (CSS px), its path's half-width at the bottom of the hero, strength
${SWELL_GLSL}
void main() {
  vec2 uv = vec2(gl_FragCoord.x / res.x, 1.0 - gl_FragCoord.y / res.y);
  vec2 css = uv * view.xy;
  float d = max(css.y / view.z, 0.002); // 0 at the horizon, 1 at the bottom of the hero
  float Z = 1.0 / d;
  vec2 P = vec2((css.x - view.x * 0.5) / view.z * Z, Z);
  vec3 s = swell(P, t, chop, view.z);
  // one drifting low-res noise lookup, laid level and rolling toward us:
  // the fine wobble, and where glints catch
  vec4 n = texture2D(noiseTex, vec2(P.x * 0.3 + t * 0.006, P.y * 1.1 + t * 0.045));
  float nf = detail * smoothstep(2.0, 8.0, 0.09 * view.z / (Z * Z));
  vec2 dpx = vec2(
    (s.y * amp.x + (n.r - 0.5) * 2.0 * amp.z * nf) * (0.15 + 0.85 * d),
    (s.z * amp.y + (n.g - 0.5) * 2.0 * amp.w * nf) * d);
  vec4 r = texture2D(reflTex, uv + dpx / view.xy);
  // the reflections are kept in daylight colours and lit for the hour here,
  // so the light on them changes as smoothly as everywhere else (premultiplied throughout)
  r.rgb *= tint;
  r.rgb = mix(r.rgb, vec3(dot(r.rgb, vec3(0.3, 0.59, 0.11))), desat);
  r.rgb = mix(r.rgb, wash.rgb * r.a, wash.a);
  // pale sky where the water tilts toward us, broken into level streaks
  float facing = s.z * 2.2 + (n.b - 0.5) * 0.7;
  float g = smoothstep(0.35, 0.85, facing) * smoothstep(0.5, 0.8, n.a) * glint * smoothstep(0.015, 0.1, d) * (1.0 - 0.6 * r.a);
  vec3 rgb = r.rgb + pale * g;
  float a = r.a + g * (1.0 - r.a);
  // By night: the moon's broken path toward us, and each light's long
  // wavering streak, moved by the same swell. They give light (added, not
  // lit by the hour).
  float wob = css.x + dpx.x * 1.8;
  float streak = smoothstep(0.4, 0.75, n.a + (n.b - 0.5) * 0.5);
  vec3 em = vec3(0.0);
  if (moon.z > 0.0) {
    float m = (wob - moon.x) / (moon.y * (0.12 + 0.88 * d));
    // brightest in the middle distance, as a moon path is, fading toward us
    em += vec3(0.86, 0.9, 1.0) * moon.z * exp(-m * m) * streak * smoothstep(0.0, 0.03, d) * (1.0 - 0.75 * smoothstep(0.35, 1.0, d))
      * (0.45 + 0.55 * smoothstep(-0.3, 0.4, facing));
  }
  for (int i = 0; i < 4; i++) {
    vec4 L = lights[i];
    float below = css.y - L.y;
    if (L.z > 0.0 && below > 0.0) {
      float q = (wob - L.x) / (L.w * (1.0 + below / view.z * 2.5));
      em += lightColor * L.z * exp(-q * q) * exp(-below / (view.z * 0.3)) * (0.3 + 0.7 * streak);
    }
  }
  rgb += em;
  a = max(a + clamp(max(em.r, max(em.g, em.b)), 0.0, 1.0) * (1.0 - a), max(rgb.r, max(rgb.g, rgb.b)));
  gl_FragColor = vec4(rgb, min(a, 1.0));
}`;

// a 64 × 64 tile of smooth noise, four independent channels, wrapping
function noiseTile() {
  const N = 64, cells = 8, px = new Uint8Array(N * N * 4);
  const lattice = Array.from({ length: 4 }, (_, ch) => Array.from({ length: cells * cells }, (_, i) => {
    let x = Math.imul(i + ch * 7919, 2654435761) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 15), 2246822519);
    return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
  }));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const gx = (x / N) * cells, gy = (y / N) * cells, ix = Math.floor(gx), iy = Math.floor(gy);
      const fx = gx - ix, fy = gy - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const at = (l, i, j) => l[((j % cells) * cells) + (i % cells)];
      for (let ch = 0; ch < 4; ch++) {
        const l = lattice[ch];
        const a = at(l, ix, iy) + (at(l, ix + 1, iy) - at(l, ix, iy)) * sx;
        const b = at(l, ix, iy + 1) + (at(l, ix + 1, iy + 1) - at(l, ix, iy + 1)) * sx;
        px[(y * N + x) * 4 + ch] = Math.round((a + (b - a) * sy) * 255);
      }
    }
  }
  return { px, N };
}

const NO_LIGHTS = new Float32Array(16);

export function createWaterGL() {
  const canvas = document.createElement('canvas');
  const opts = { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true };
  const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
  if (!gl) return null;
  // compiled and linked without asking how it went, so that with
  // KHR_parallel_shader_compile it all happens in the background; poll()
  // says when it's done
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  const parallel = gl.getExtension('KHR_parallel_shader_compile');
  let status = 'compiling', u = null, timerExt = null;
  const queries = [], gpu = { sum: 0, n: 0 };

  function finish() {
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      status = 'failed';
      return;
    }
    setup();
    status = 'ready';
  }

  function setup() {
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    u = {};
    for (const n of ['reflTex', 'noiseTex', 'res', 'view', 'amp', 't', 'chop', 'detail', 'glint', 'pale', 'tint', 'desat', 'wash', 'lights', 'lightColor', 'moon']) u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(u.reflTex, 0);
    gl.uniform1i(u.noiseTex, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    const texture = (unit, wrap) => {
      const tex = gl.createTexture();
      gl.activeTexture(unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return tex;
    };
    const reflTex = texture(gl.TEXTURE0, gl.CLAMP_TO_EDGE);
    texture(gl.TEXTURE1, gl.REPEAT);
    const { px, N } = noiseTile();
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, reflTex);

    // the GPU's time for the pass, where the browser offers a timer
    timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    // and one draw, so the driver's last setup is done before the first frame
    gl.viewport(0, 0, 1, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function pollTimers() {
    while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = queries.shift();
      if (!gl.getParameter(timerExt.GPU_DISJOINT_EXT)) {
        gpu.sum += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gpu.n++;
      }
      gl.deleteQuery(q);
    }
  }

  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
  });

  return {
    kind: 'webgl',
    canvas,
    get lost() {
      return lost || gl.isContextLost();
    },
    // 'compiling', 'ready' or 'failed'; ask until it isn't 'compiling'
    poll() {
      if (status === 'compiling' && (!parallel || gl.getProgramParameter(prog, parallel.COMPLETION_STATUS_KHR))) finish();
      return status;
    },
    size(w, h) {
      w = Math.max(1, Math.round(w));
      h = Math.max(1, Math.round(h));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    },
    // src: the reflection buffer (a canvas covering the region, in daylight
    // colours); p: { t, chop, W, H (the region, CSS px), unit, amp: [4],
    // detail, glint, pale: [r, g, b] 0–1, light: the hour's { tint, desat, wash } as for engine/light.js,
    // and by night lights: 16 numbers (4 × x, row, strength, width), lightColor: [r, g, b] 0–1, moon: [x, width, strength] }
    draw(src, p) {
      if (this.lost || status !== 'ready') return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform3f(u.view, p.W, p.H, p.unit);
      gl.uniform4f(u.amp, ...p.amp);
      gl.uniform1f(u.t, p.t);
      gl.uniform1f(u.chop, p.chop);
      gl.uniform1f(u.detail, p.detail);
      gl.uniform1f(u.glint, p.glint);
      gl.uniform3f(u.pale, ...p.pale);
      const { tint = [255, 255, 255], desat = 0, wash = null } = p.light || {};
      gl.uniform3f(u.tint, tint[0] / 255, tint[1] / 255, tint[2] / 255);
      gl.uniform1f(u.desat, Math.min(1, desat));
      gl.uniform4f(u.wash, wash ? wash[0] / 255 : 0, wash ? wash[1] / 255 : 0, wash ? wash[2] / 255 : 0, wash ? wash[3] : 0);
      gl.uniform4fv(u.lights, p.lights || NO_LIGHTS);
      gl.uniform3f(u.lightColor, ...(p.lightColor || [1, 0.72, 0.42]));
      gl.uniform3f(u.moon, ...(p.moon || [0, 1, 0]));
      let q = null;
      if (timerExt && queries.length < 4) {
        q = gl.createQuery();
        gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (q) {
        gl.endQuery(timerExt.TIME_ELAPSED_EXT);
        queries.push(q);
      }
      if (timerExt) pollTimers();
    },
    // the GPU's average ms for the pass since last asked (null without a timer)
    gpuMs() {
      if (!timerExt || !gpu.n) return null;
      const ms = gpu.sum / gpu.n;
      gpu.sum = gpu.n = 0;
      return ms;
    },
    dispose() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      release(canvas);
    },
  };
}

// ---------- the distortion: Canvas 2D, without WebGL ----------
// The reflection buffer in level strips (4–6 px), each slid sideways by the
// swell at its height (about 100–150 drawImage calls a frame).
// g: the scene's context (CSS px transform); src: the buffer; p as for
// createWaterGL's draw, plus top (the region's top, CSS px).
const tmp = [0, 0], sw = [0, 0, 0];
export function drawStrips(g, src, p) {
  const n = clamp(Math.round(p.H / 5), 1, 150), sh = p.H / n, sy = src.height / n;
  const view = { W: p.W, horizonY: 0, unit: p.unit };
  for (let i = 0; i < n; i++) {
    const y = (i + 0.5) * sh, d = y / p.unit;
    planeAt(p.W / 2, y, view, tmp);
    swellAt(tmp[0], tmp[1], p.t, p.chop, p.unit, sw);
    const dx = sw[1] * p.amp[0] * (0.15 + 0.85 * d) + sw[2] * p.amp[1] * d * 0.3;
    g.drawImage(src, 0, i * sy, src.width, sy, dx, p.top + i * sh, p.W, sh + 0.5);
  }
}
