/*
 * Every painting the site can show, for the gallery. Each entry's module is
 * only downloaded when a visitor picks it. The first is the default.
 *
 *  - label, after: the gallery card's words ("Wheat Field · after Van Gogh")
 *  - its stills (placeholders and gallery thumbnail) live in scenes/stills/,
 *    named by id: <id>-day.webp, <id>-day-960.webp, <id>-night.webp,
 *    <id>-night-960.webp and <id>-thumb.webp (see tools/stills.html)
 */
export const SCENES = [
  { id: 'wheat', label: 'Wheat Field', after: 'Van Gogh', load: () => import('./wheat.js') },
  { id: 'tulips', label: 'Tulip Fields', after: 'Monet', load: () => import('./tulips.js') },
];

export const DEFAULT_SCENE = SCENES[0].id;

// where a scene's stills are, relative to the site's root
export const still = (id, variant, small = false) => `scenes/stills/${id}-${variant}${small ? '-960' : ''}.webp`;
export const thumb = (id) => `scenes/stills/${id}-thumb.webp`;
