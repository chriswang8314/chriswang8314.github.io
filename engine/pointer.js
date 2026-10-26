/*
 * Pointer input, in scene coordinates (CSS px from the canvas's top-left),
 * with a smoothed velocity. Listens on the window with passive listeners, so
 * the painting still responds while the cursor is over the hero text, and
 * never blocks scrolling (the canvas itself has touch-action: pan-y).
 *
 * `active` is true while the pointer is over the painting. `vx`/`vy` are the
 * pointer's smoothed movement per fixed step, clamped to ±60 px. Taps and
 * clicks on the painting (not on links or buttons over it) go to onTap.
 */
import { clamp, lerp } from './util.js';

export function createPointer(canvas) {
  const pointer = {
    x: 0, y: 0, // position
    dx: 0, dy: 0, // movement since the last step
    vx: 0, vy: 0, // smoothed movement per step
    active: false,
    moved: 0, // total distance moved, for hiding the hint
    onTap: null, // (x, y) => {}
  };

  const ac = new AbortController();
  const opts = { passive: true, signal: ac.signal };

  function locate(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    return [x, y, x >= 0 && y >= 0 && x <= rect.width && y <= rect.height];
  }

  function onMove(e) {
    const [x, y, inside] = locate(e);
    if (!inside) {
      pointer.active = false;
      return;
    }
    if (pointer.active) {
      pointer.dx += x - pointer.x;
      pointer.dy += y - pointer.y;
      pointer.moved += Math.abs(x - pointer.x) + Math.abs(y - pointer.y);
    }
    pointer.x = x;
    pointer.y = y;
    pointer.active = true;
  }

  const release = () => (pointer.active = false);

  // a tap lands on the painting unless something interactive sits over it
  const interactive = (el) => el && el.closest && el.closest('a, button, input, select, textarea, label, [role="radio"], [role="dialog"]');

  window.addEventListener('pointermove', onMove, opts);
  window.addEventListener('pointerdown', (e) => {
    onMove(e);
    const [x, y, inside] = locate(e);
    if (inside && pointer.onTap && !interactive(e.target)) pointer.onTap(x, y, e);
  }, opts);
  window.addEventListener('pointerup', (e) => e.pointerType !== 'mouse' && release(), opts);
  window.addEventListener('pointercancel', release, opts);
  window.addEventListener('pointerout', (e) => !e.relatedTarget && release(), opts); // left the window
  window.addEventListener('blur', release, opts);

  // once per fixed step
  pointer.step = () => {
    pointer.vx = lerp(pointer.vx, clamp(pointer.dx, -60, 60), 0.5);
    pointer.vy = lerp(pointer.vy, clamp(pointer.dy, -60, 60), 0.5);
    pointer.dx = pointer.dy = 0;
  };

  pointer.dispose = () => ac.abort();
  return pointer;
}
