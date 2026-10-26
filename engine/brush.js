/*
 * The brush. Every mark a scene paints goes through a brush made here from
 * the scene's brushStyle, so each painting keeps one consistent hand.
 *
 * The bristle brush lays a stroke down as a bundle of thin bristle streaks
 * that swells and thins with pressure, runs dry into ragged tails, carries a
 * streak of a neighbouring colour and, on big strokes, catches a little
 * impasto light and shadow. With `scumble` and `feather` set (as in DAB,
 * for Monet) the same brush makes short broken dabs instead: each bristle
 * skips like a dry brush, and a faint wider pass softens the edge.
 *
 * Moving strokes can't be re-brushed every frame, so they're pre-painted
 * into sprite atlases (one canvas, many cells) and stamped, scaled and
 * rotated; stamps are painted in grey and tinted to any colour.
 */
import { clamp, rgb, shadeRGB, offscreen } from './util.js';

// Van Gogh's loaded bristle brush; scenes override any of these
export const BRISTLE = {
  pressure: [0.55, 0.45, 1.15], // base, swell, and how early the swell peaks
  bristleSpacing: 1.6, // px of stroke width per bristle
  bristles: [6, 15], // fewest and most bristles in a stroke (thin strokes: 2)
  bristleWidth: 1.7, // each bristle's width, relative to its share of the stroke
  stepLen: 6, // px per path segment
  maxSteps: 8,
  edgeLift: [0.22, 0.28], // how much shorter edge bristles start and end
  dryChance: 0.3, // share of bristles that run dry early
  dryLength: 0.35, // how early, at most
  shade: [0.9, 0.2], // each bristle's value: base and spread
  edgeFade: 0.3, // how much fainter the edge bristles are
  scumble: 0, // dry-brush breaks along each bristle (0 = solid)
  feather: 0, // a soft, wider, faint pass under the stroke (0 = none)
};

// Monet's short loaded dabs: few, fat bristles, soft feathered edges, and
// dry-brush breaks, so marks flicker and let what's under them show through
export const DAB = {
  pressure: [0.72, 0.28, 1.5],
  bristleSpacing: 2.4,
  bristles: [3, 7],
  bristleWidth: 2.1,
  stepLen: 5,
  maxSteps: 4,
  edgeLift: [0.3, 0.3],
  dryChance: 0.4,
  dryLength: 0.3,
  shade: [0.93, 0.14],
  edgeFade: 0.55,
  scumble: 0.35,
  feather: 0.6,
};

export function createBrush(style = {}) {
  const st = { ...BRISTLE, ...style };
  const [p0, p1, p2] = st.pressure;
  const [eS, eE] = st.edgeLift;
  const [sh0, sh1] = st.shade;

  // pressure along a stroke: light at the touch-down, full in the middle,
  // easing off as the brush lifts
  const pressure = (f) => p0 + p1 * Math.sin(Math.PI * Math.min(1, f * p2));

  // Lays one stroke down as thin bristle streaks along a gently bent path.
  // s: { x, y, angle, len, width, color, streak?, bend?, alpha?, impasto?, bristles? }
  function paintStroke(g, rng, s) {
    const n = s.bristles || clamp(Math.round(s.width / st.bristleSpacing), s.width < 3 ? 2 : st.bristles[0], st.bristles[1]);
    const cos = Math.cos(s.angle), sin = Math.sin(s.angle), nx = -sin, ny = cos;
    const bend = (s.bend || 0) * s.len, alpha = s.alpha ?? 1;
    const streakFrom = s.streak ? Math.floor(rng() * n) : -1;
    const streakTo = s.streak ? streakFrom + 1 + Math.floor(rng() * n * 0.35) : -1;
    const steps = clamp(Math.round(s.len / st.stepLen), 2, st.maxSteps);
    const at = (f, v) => {
      const off = v * s.width * pressure(f) + bend * 4 * f * (1 - f);
      return [s.x + cos * s.len * f + nx * off, s.y + sin * s.len * f + ny * off];
    };
    g.lineCap = 'round';
    // feathering: a faint wider pass first, so the edge melts into what's under it
    if (st.feather > 0) {
      g.lineWidth = s.width * 1.25;
      g.strokeStyle = rgb(s.color, alpha * 0.22 * st.feather);
      g.beginPath();
      for (let k = 0; k <= steps; k++) {
        const [px, py] = at(0.08 + 0.84 * (k / steps), 0);
        if (k) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.stroke();
    }
    g.lineWidth = Math.max(0.5, (s.width / n) * st.bristleWidth);
    for (let i = 0; i < n; i++) {
      const v = (i + 0.5) / n - 0.5 + (rng() - 0.5) * 0.06;
      const edge = Math.min(1, Math.abs(v) * 2);
      // bristles at the edge of the brush only touch while it's pressed hardest
      const start = 0.03 + edge * edge * eS + rng() * 0.06;
      let end = 1 - edge * edge * eE - rng() * 0.08;
      if (rng() < st.dryChance) end -= rng() * st.dryLength; // runs dry early: a ragged tail
      if (end <= start) continue;
      const base = i >= streakFrom && i < streakTo ? s.streak : s.color;
      g.strokeStyle = rgb(shadeRGB(base, sh0 + rng() * sh1), alpha * (1 - st.edgeFade + st.edgeFade * (1 - edge)));
      // dry brush: the bristle skips, leaving the paint below showing in gaps
      if (st.scumble > 0) {
        const L = s.len * (end - start);
        g.setLineDash([L * (0.2 + rng() * 0.4), L * st.scumble * (0.1 + rng() * 0.3), L * (0.1 + rng() * 0.3), L * st.scumble * rng() * 0.3]);
        g.lineDashOffset = -L * rng() * 0.3;
      }
      g.beginPath();
      for (let k = 0; k <= steps; k++) {
        const [px, py] = at(start + (end - start) * (k / steps), v);
        if (k) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.stroke();
    }
    if (st.scumble > 0) g.setLineDash([]);
    // impasto: big strokes catch light on the upper edge, shade on the lower
    if (s.impasto && s.width > 6) {
      g.lineWidth = Math.max(0.6, s.width * 0.08);
      for (const [v, f, a] of [[-0.42, 1.28, 0.35], [0.46, 0.68, 0.3]]) {
        g.strokeStyle = rgb(shadeRGB(s.color, f), alpha * a);
        g.beginPath();
        for (let k = 0; k <= steps; k++) {
          const [px, py] = at(0.15 + 0.6 * (k / steps), v);
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.stroke();
      }
    }
  }

  // A pale grey stroke on its own small canvas (pointing right, centred),
  // coloured later with tintInto. dpr sizes it for the screen.
  function paintStamp(rng, len, width, bend, dpr) {
    const pad = 3, w = len + pad * 2, h = width * 1.2 + Math.abs(bend) * len * 2 + pad * 2;
    const [c, g] = offscreen(w * dpr, h * dpr);
    g.scale(dpr, dpr);
    paintStroke(g, rng, { x: pad, y: h / 2, angle: 0, len, width, bend, color: [236, 236, 236], streak: rng() < 0.6 ? [204, 204, 204] : null });
    return c;
  }

  return { style: st, paintStroke, paintStamp, pressure };
}

// A copy of a grey stamp in one colour, keeping its bristle light and
// shade. Reuses `c` when given.
export function tintInto(c, stamp, color) {
  c = c || offscreen(stamp.width, stamp.height)[0];
  if (c.width !== stamp.width || c.height !== stamp.height) {
    c.width = stamp.width;
    c.height = stamp.height;
  }
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'copy';
  g.drawImage(stamp, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = rgb(shadeRGB(color, 1.13)); // the stamp's greys average about 0.88
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(stamp, 0, 0);
  g.globalCompositeOperation = 'source-over';
  return c;
}

// A sprite atlas: `count` equal cells of cw × ch px on one canvas. paint(i, fn)
// hands fn a context whose origin is cell i's top-left corner; draw stamps a
// cell with its top-left at (dx, dy) in the current transform. Cells are
// padded with clear space, so neighbours never bleed into a stamp.
export function createAtlas(cw, ch, count) {
  const cols = Math.max(1, Math.min(count, Math.floor(4096 / cw)));
  const rows = Math.ceil(count / cols);
  const [canvas, g] = offscreen(cols * cw, rows * ch);
  const at = (i) => [(i % cols) * cw, Math.floor(i / cols) * ch];
  return {
    canvas, cw, ch, count,
    paint(i, fn) {
      const [x, y] = at(i);
      g.save();
      g.beginPath();
      g.rect(x, y, cw, ch);
      g.clip();
      g.translate(x, y);
      fn(g);
      g.restore();
    },
    // `src` may be another canvas laid out the same (the atlas relit, say)
    draw(target, i, dx, dy, src = canvas) {
      const [x, y] = at(i);
      target.drawImage(src, x, y, cw, ch, dx, dy, cw, ch);
    },
  };
}
