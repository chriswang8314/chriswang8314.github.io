/*
 * Stars, shared by every scene at night. Each is a painted dot (a few
 * strokes from the scene's own brush) and the brighter ones wear a small
 * painted halo: Van Gogh's swirling rings for `style: 'swirl'`, softer dabs
 * for `style: 'soft'`. They fade in with the palette's `dark`, so they come
 * out through dusk, and each twinkles on its own slow phase.
 *
 *  - Hover: stars within ~100 px of the pointer brighten and their halos
 *    swirl faster. Each bright star you brush links to the previous one with
 *    a faint painted line, so the lines follow the pointer's path like a
 *    constellation, then fade once the pointer moves on.
 *  - launch(x, y): a painted shooting star from there, along the wind. One
 *    also crosses the sky on its own every 30–60 seconds.
 *  - list(): the stars, for scenes that reflect them (the tulips' canal).
 *
 * Under prefers-reduced-motion they hold still: no twinkle, no swirl, no
 * shooting stars.
 *
 * A scene makes its own set with createStars and places the two layers
 * (stars, and the shooting star) where they belong among its own.
 */
import { TAU, clamp, lerp, rand, mulberry32, offscreen, makeGlow, release } from './util.js';

// The halos turn once every five minutes of wind
export const HALO_TURN = TAU / 300;

// A painted halo (with whatever it surrounds), turning very slowly with the
// wind's clock `t` and gently brightening and dimming, ±5%. At rest it's
// drawn exactly as painted. Leaves ctx at the plain dpr transform.
export function drawHalo(ctx, img, x, y, half, alpha, t, dpr) {
  const spin = t * HALO_TURN, pulse = 0.05 * Math.sin((t * TAU) / 8);
  const cos = Math.cos(spin) * dpr, sin = Math.sin(spin) * dpr;
  ctx.setTransform(cos, sin, -sin, cos, x * dpr, y * dpr);
  ctx.globalAlpha = alpha * (1 + Math.min(0, pulse));
  ctx.drawImage(img, -half, -half, half * 2, half * 2);
  if (pulse > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * pulse;
    ctx.drawImage(img, -half, -half, half * 2, half * 2);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const glowStar = makeGlow(255, 250, 220);
const HOVER_R = 100, LINK_DIST = 150;
const DOTS = 3, HALOS = 3;

// opts.brush: the scene's brush; opts.style: 'swirl' (Van Gogh) or 'soft' (Monet)
export function createStars({ brush, style = 'swirl' }) {
  const swirl = style === 'swirl';
  const ink = swirl ? [255, 246, 200] : [242, 240, 255];
  let stars = [], links = [], lastLit = null;
  let dots = [], halos = [], streak = null;
  let shooting = [], nextShooting = 0, sky = { W: 0, H: 0, horizonY: 0 };

  // the sprites, painted once per set with the scene's brush
  function paintSprites() {
    const rng = mulberry32(31);
    [...dots, ...halos, streak].forEach(release);
    dots = [];
    halos = [];
    // dots: a few short strokes crossing at the star
    for (let i = 0; i < DOTS; i++) {
      const [c, g] = offscreen(32, 32);
      for (let k = 0; k < (swirl ? 4 : 3); k++) {
        const a = rng() * Math.PI, len = swirl ? 9 + rng() * 6 : 8 + rng() * 5;
        brush.paintStroke(g, rng, {
          x: 16 - (Math.cos(a) * len) / 2, y: 16 - (Math.sin(a) * len) / 2, angle: a, len,
          width: swirl ? 4.5 : 5.5, color: ink, alpha: swirl ? 0.95 : 0.8, bristles: 3,
        });
      }
      dots.push(c);
    }
    // halos: rings of short strokes swirling round (Van Gogh), or a loose
    // soft ring of dabs (Monet)
    for (let i = 0; i < HALOS; i++) {
      const size = 120, m = size / 2;
      const [c, g] = offscreen(size, size);
      for (let r = 14; r < 54; r += swirl ? 8 + rng() * 5 : 12 + rng() * 6) {
        for (let a = rng(); a < TAU; a += swirl ? 0.45 + rng() * 0.55 : 0.7 + rng() * 0.8) {
          const len = swirl ? 6 + rng() * 9 : 9 + rng() * 8, start = a - len / (2 * r);
          brush.paintStroke(g, rng, {
            x: m + Math.cos(start) * r, y: m + Math.sin(start) * r, angle: a + Math.PI / 2, len,
            width: swirl ? 3.2 : 5, bend: -len / (8 * r), color: ink,
            alpha: (swirl ? 0.55 : 0.32) * (1 - r / 60), bristles: 3,
          });
        }
      }
      halos.push(c);
    }
    // a long, thin, dry stroke: constellation lines and shooting stars
    const [c, g] = offscreen(256, 16);
    brush.paintStroke(g, rng, { x: 4, y: 8, angle: 0, len: 248, width: 4, color: ink, alpha: 0.9, bristles: 3 });
    streak = c;
  }

  function build({ W, H, horizonY }) {
    sky = { W, H, horizonY };
    const nStars = Math.round(clamp((W * horizonY) / 1600, 80, 600));
    stars = Array.from({ length: nStars }, () => {
      const r = 0.4 + Math.pow(Math.random(), 4) * 1.8, b = rand(0.25, 1);
      return {
        x: Math.random() * W,
        y: Math.pow(Math.random(), 1.3) * horizonY * 0.85,
        r, b,
        tw: rand(0.4, 1.8),
        ph: rand(0, TAU),
        glow: 0,
        lit: false,
        links: 0,
        major: r > 0.8 || b > 0.85, // only the brighter stars join constellations
        halo: r > 1.1 || b > 0.9, // and wear a halo
        spin: rand(0, TAU),
        dot: (Math.random() * DOTS) | 0,
        ring: (Math.random() * HALOS) | 0,
      };
    });
    links = [];
    lastLit = null;
    shooting = [];
    nextShooting = 20000 + Math.random() * 25000;
    paintSprites();
  }

  function update(dt, { pointer, horizonY, light, motion }) {
    const hovering = pointer.active && pointer.y < horizonY + 40 && light.dark > 0.5;
    for (const s of stars) {
      s.glow *= 0.985;
      if (hovering) {
        const dx = s.x - pointer.x, dy = s.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < HOVER_R * HOVER_R) {
          const f = 1 - Math.sqrt(d2) / HOVER_R;
          const target = Math.min(1, f * 1.4);
          if (target > s.glow) s.glow = lerp(s.glow, target, 0.2);
        }
      }
      // halos swirl slowly, and fast while the pointer's near
      if (motion) s.spin += dt * (0.12 + s.glow * 3);

      if (!s.lit && s.glow > 0.5) {
        s.lit = true;
        if (!s.major) continue;
        const prev = lastLit;
        if (prev && prev !== s && prev.glow > 0.3 && prev.links < 2 && s.links < 2 &&
            Math.hypot(prev.x - s.x, prev.y - s.y) < LINK_DIST) {
          links.push([prev, s]);
          prev.links++;
          s.links++;
        }
        lastLit = s;
      } else if (s.lit && s.glow < 0.1) {
        s.lit = false;
      }
    }

    links = links.filter(([a, b]) => {
      if (Math.min(a.glow, b.glow) > 0.04) return true;
      a.links--;
      b.links--;
      return false;
    });
  }

  // A shooting star from (x, y), heading downwind and a little down. `wind`
  // is the shared wind (its direction); speed in px per step.
  function launch(x, y, wind) {
    const [dx] = wind ? wind.dir : [Math.random() < 0.5 ? -1 : 1];
    const dir = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx);
    const speed = rand(8, 12), slope = rand(0.28, 0.48);
    const n = Math.hypot(1, slope);
    shooting.push({ x, y, vx: (dir / n) * speed, vy: (slope / n) * speed, life: 1 });
  }

  function updateShooting(dt, { time, light, W, H, horizonY, wind, motion }) {
    if (!motion) {
      shooting = [];
      return;
    }
    if (light.dark > 0.8 && time > nextShooting) {
      launch(rand(W * 0.2, W * 0.8), rand(H * 0.03, horizonY * 0.35), wind);
      nextShooting = time + rand(30000, 60000);
    }
    for (const s of shooting) {
      s.x += s.vx;
      s.y += s.vy;
      s.life -= 0.016;
    }
    shooting = shooting.filter((s) => s.life > 0 && s.y < horizonY && s.x > -60 && s.x < W + 60);
  }

  // a sprite stretched from (x1, y1) to (x2, y2), `width` px thick
  function stretch(ctx, img, x1, y1, x2, y2, width, dpr) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    const cos = (x2 - x1) / len, sin = (y2 - y1) / len, sx = (len / img.width) * dpr, sy = (width / img.height) * dpr;
    ctx.setTransform(cos * sx, sin * sx, -sin * sy, cos * sy, x1 * dpr, y1 * dpr);
    ctx.drawImage(img, 0, -img.height / 2);
  }

  function draw(ctx, { time, light, horizonY, dpr, motion }) {
    const dark = light.dark;
    for (const s of stars) {
      const twinkle = motion ? 0.7 + 0.3 * Math.sin(time * 0.001 * s.tw + s.ph) : 0.85;
      const fade = 1 - (s.y / horizonY) * 0.55;
      const bright = Math.min(1, s.b * twinkle * fade + s.glow);
      if (s.halo || s.glow > 0.08) {
        const half = s.r * (swirl ? 7 : 8) * (1 + s.glow * 0.7), cos = Math.cos(s.spin) * dpr, sin = Math.sin(s.spin) * dpr;
        ctx.globalAlpha = dark * Math.min(1, (s.halo ? 0.45 * s.b * twinkle : 0) + s.glow * 0.6);
        ctx.setTransform(cos, sin, -sin, cos, s.x * dpr, s.y * dpr);
        ctx.drawImage(halos[s.ring], -half, -half, half * 2, half * 2);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (s.glow > 0.03) {
        const size = s.r * (8 + s.glow * 16);
        ctx.globalAlpha = dark * s.glow * 0.8;
        ctx.drawImage(glowStar, s.x - size / 2, s.y - size / 2, size, size);
      }
      const size = s.r * (swirl ? 5.5 : 5) * (1 + s.glow * 0.6);
      ctx.globalAlpha = dark * bright;
      ctx.drawImage(dots[s.dot], s.x - size / 2, s.y - size / 2, size, size);
    }

    // the constellation lines: faint painted strokes, fading with their stars
    for (const [a, b] of links) {
      ctx.globalAlpha = dark * Math.min(a.glow, b.glow) * 0.55;
      stretch(ctx, streak, a.x, a.y, b.x, b.y, 3, dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
  }

  // a shooting star: a bright painted head trailing a long thinning stroke
  function drawShooting(ctx, { light, dpr }) {
    for (const s of shooting) {
      const a = s.life * Math.max(light.dark, 0.6);
      ctx.globalAlpha = a * 0.85;
      stretch(ctx, streak, s.x - s.vx * 18, s.y - s.vy * 18, s.x, s.y, 4.5, dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = a;
      ctx.drawImage(glowStar, s.x - 9, s.y - 9, 18, 18);
      ctx.drawImage(dots[0], s.x - 5, s.y - 5, 10, 10);
    }
    ctx.globalAlpha = 1;
  }

  const visible = (state) => state.light.dark > 0.01;

  return {
    // the stars themselves, with their halos and constellation lines
    layer: (z) => ({
      id: 'stars', kind: 'animated', z,
      build: (state) => build(state),
      update: (dt, state) => update(dt, state),
      render: (ctx, state) => visible(state) && draw(ctx, state),
    }),
    // the shooting stars, usually drawn over the moon
    shootingLayer: (z) => ({
      id: 'shooting-star', kind: 'animated', z,
      update: (dt, state) => updateShooting(dt, state),
      render: (ctx, state) => shooting.length && drawShooting(ctx, state),
    }),
    launch,
    list: () => stars,
    dispose() {
      [...dots, ...halos, streak].forEach(release);
      stars = [];
      links = [];
      shooting = [];
    },
  };
}
