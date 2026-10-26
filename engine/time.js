/*
 * Time of day. The painting follows the visitor's local time; the slider
 * (or ?hour=18.75, or ?mode=day|night) previews any hour, and "now" goes
 * back to the real clock. The shown hour eases toward the chosen one.
 *
 * Each scene gives keyframed palettes for dawn, day, golden hour, dusk and
 * night. A phase is one keyframe or a list of them; each keyframe may set its
 * own hour `h` (otherwise the phase's default hour below is used). Every
 * array and number in a keyframe is blended continuously between hours, so
 * a scene can key whatever it needs (sky colours, a tint, `dark`, ...).
 * `dark` (0 day – 1 night) is the one value the engine itself reads.
 */
import { clamp, lerp } from './util.js';

export const SUNRISE = 6; // hours, local time
export const SUNSET = 20;
export const PHASE_HOURS = { night: 0, dawn: 6, day: 13, golden: 18.75, dusk: 20.3 };

export const realHour = () => {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
};

export function formatHour(h) {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

// a scene's palettes as one list of keyframes sorted by hour, wrapping
// around midnight (a keyframe at 0 is repeated at 24 if none is there)
export function keyframes(palettes) {
  const keys = [];
  for (const [phase, value] of Object.entries(palettes)) {
    for (const k of [].concat(value)) keys.push({ ...k, h: k.h ?? PHASE_HOURS[phase] });
  }
  keys.sort((a, b) => a.h - b.h);
  if (keys[0].h > 0) keys.unshift({ ...keys[keys.length - 1], h: 0 });
  if (keys[keys.length - 1].h < 24) keys.push({ ...keys[0], h: 24 });
  return keys;
}

// blends every array and number between two keyframes
function mix(a, b, t) {
  const out = {};
  for (const k in a) {
    if (k === 'h') continue;
    const va = a[k], vb = b[k];
    if (Array.isArray(va)) out[k] = va.map((v, i) => lerp(v, vb[i], t));
    else if (typeof va === 'number') out[k] = lerp(va, vb, t);
    else out[k] = t < 0.5 ? va : vb;
  }
  return out;
}

// the palette at hour h from a list of keyframes (see keyframes)
export function lightAt(keys, h) {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].h <= h) i++;
  const a = keys[i], b = keys[i + 1];
  return mix(a, b, clamp((h - a.h) / (b.h - a.h), 0, 1));
}

export function createTime({ slider, label, nowBtn }) {
  let keys = null;
  let manualHour = null;

  const time = {
    hour: 12, // the hour shown, easing toward the target
    light: null, // the scene's palette at that hour

    setPalettes(palettes) {
      keys = keyframes(palettes);
      time.light = time.lightAt(time.hour);
    },

    // the palette at any hour; before a scene's palettes arrive, just
    // whether it's dark
    lightAt(h) {
      if (!keys) return { dark: h >= 20.5 || h < 5.6 ? 1 : 0 };
      return lightAt(keys, h);
    },

    get manual() {
      return manualHour !== null;
    },
    target: () => manualHour ?? realHour(),

    // one fixed step: ease the shown hour toward the target
    step() {
      const target = time.target();
      let diff = target - time.hour;
      if (diff > 12) diff -= 24;
      if (diff < -12) diff += 24;
      time.hour = Math.abs(diff) < 0.001 ? target : (time.hour + diff * 0.06 + 24) % 24;
      time.light = time.lightAt(time.hour);
    },

    // jump to an hour (0–24), or null to follow the real clock
    setHour(h) {
      manualHour = h === null ? null : clamp(h, 0, 23.99);
      if (manualHour !== null) slider.value = manualHour;
      time.updateUI();
      time.emit();
    },

    // snap the shown hour to the target (on load, and for a fresh scene)
    snap() {
      time.hour = time.target();
      time.light = time.lightAt(time.hour);
    },

    updateUI() {
      const h = time.target();
      if (manualHour === null) slider.value = h.toFixed(2);
      label.textContent = formatHour(h);
      slider.setAttribute('aria-valuetext', formatHour(h));
      nowBtn.hidden = manualHour === null;
    },

    // tells the page what time it is in the painting, so it can theme itself
    emit() {
      const h = time.target();
      window.dispatchEvent(new CustomEvent('scenetime', { detail: { hour: h, dark: time.lightAt(h).dark } }));
    },
  };

  slider.addEventListener('input', () => time.setHour(parseFloat(slider.value)));
  nowBtn.addEventListener('click', () => time.setHour(null));

  const params = new URLSearchParams(location.search);
  const forcedHour = parseFloat(params.get('hour'));
  if (!Number.isNaN(forcedHour)) manualHour = clamp(forcedHour, 0, 23.99);
  else if (params.get('mode') === 'night') manualHour = 23;
  else if (params.get('mode') === 'day') manualHour = 13;
  if (manualHour !== null) slider.value = manualHour;
  time.snap();

  return time;
}
