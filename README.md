# Christopher Wang — personal site

A single-page resume site built around a live painting. Three are on offer
from the **Gallery** button over the sky: a Van Gogh–style wheat field
("Summer Evening, Wheatfield with Setting Sun", Arles, 1888), shown by
default, Monet's "Tulip Fields near The Hague" (1886), and Monet's harbour of
moored sailboats ("Sailboats", c. 1866). The painting
follows the visitor's local time; the slider in the corner (or the
**nocturne** toggle in the nav) changes the hour, and the page below takes its
colours from the painting and the hour.

Plain HTML, CSS and JavaScript (ES modules). No build step, no backend, no dependencies.

## Run it locally

Any static file server works. From this folder:

```bash
python3 -m http.server 5173
```

Then open <http://localhost:5173>. Add `?hour=18.75` (or any hour 0–24) to
preview a time of day, and `?scene=tulips` to open a painting (that's also
how to share a link to one). A visitor's own pick from the gallery is
remembered in their browser. `?profile` adds each layer's draw time to
`paintedScene.stats()` in the console, and `?slowmo=20` plays the switch
between paintings twenty times slower, to look at it closely. `?quality=0.5`
starts the painting as if its frames had been running long, to see a
scene's lighter modes. On
`localhost` (or with `?dev`) the page also checks, during a switch, that the
hero card's colours only ever change while it's invisible, and logs an
error to the console if they don't, and in the harbour the **R** key turns the
water's reflections off and on, to measure what they cost
(`paintedScene.stats().water`).

## Edit the content

All text lives in **`content.js`**: name, tagline, links, the "Currently…"
list, projects, about, contact line and the "last updated" date. Change it
there and reload; you never need to touch the layout code.

- **Projects** are listed in the order they appear. Each has a `title`, `org`,
  `dates`, a one- or two-sentence `description`, `tags`, and `links`
  (`{ label, url }`; leave the list empty for none).
- **Email** is stored as `user` and `domain` and only joined in the browser,
  so it never appears whole in the HTML for scrapers to find. If you change
  it, also update the `<noscript>` line in `index.html`.

## Replace the resume (and add a headshot)

- **Resume:** overwrite `resume.pdf` with the new file (keep the name). Note
  that it's public at `/resume.pdf`, so leave off anything you don't want
  online, like a phone number.
- **Headshot (optional):** the About section doesn't use one right now. To
  add one, drop `headshot.jpg` in this folder and add
  `<img src="headshot.jpg" alt="Christopher Wang" class="headshot">` at the
  top of the About section in `index.html`.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page structure and meta tags; its first script picks the painting and its still |
| `content.js` | Every word on the page |
| `site.js` | Renders the content, nav, nocturne theme, hero text placement, the gallery and the footer credit |
| `engine/` | The painting engine every scene shares (see below; `engine.js` wires it together) |
| `scenes/` | One module per painting (`wheat.js`, `tulips.js`, `harbor.js`), listed in `scenes/index.js` |
| `scenes/stills/` | Each painting's day and night stills, shown instantly while the live one renders, and its gallery thumbnail |
| `tools/stills.html` | Makes those stills (see "Adding a new painting") |
| `style.css` | Layout, typography and the default theme (each scene supplies its own page colours) |
| `og-image.jpg` | 1200×630 link preview image |
| `favicon.svg`, `apple-touch-icon.png` | Icons |

## Adding a new painting

Each painting is one module in `scenes/`. The engine does everything they
share; the module says what to paint and how. `scenes/tulips.js` is the best
one to copy from: it uses most of what the engine offers.

### The scene contract

A scene module's default export is:

```js
export default {
  id: 'irises',                  // also its file name and its stills' names
  title: 'Irises', artist: 'Vincent van Gogh', year: 1889, label: 'Irises',
  description: '…',              // read by screen readers in place of the painting
  placeholder: { day: 13, night: 23 },   // the hours its two stills show
  layout: {
    horizonY: 55,                // % of the screen's height
    heroTextRegion: { mode: 'fixed', x: 5, y: 10, maxBottom: 38 },
    // or { mode: 'avoid' }: the text goes wherever obstacles() says is clear
  },
  palettes: { dawn, day, golden, dusk, night },
  brushStyle: { … },             // see "Brush and palettes"
  contentTheme: {                // the page's colours below the painting
    day: { themeColor: '#…', vars: { '--bg': '#…', '--text': '#…', … } },
    evening: { … },              // optional; falls back to day
    night: { … },
    hero: { onLight: { … }, onDark: { … } },  // optional: the hero text's own colours
  },
  heroTone(light) { return 'onLight' },      // with `hero`: which suits the sky now
  dissolve: { depth: 35, contentStart: 26, fade: 0.78, power: 1.4, wander: 0.3, ground: 0.12 },
  create(engine) { … },          // one visit to the scene (below)
};
```

`create(engine)` is called each time the scene is shown, so every visit
starts fresh. `engine` has `state` (everything to paint from: `W`, `H`, `CH`,
`dpr`, `horizonY`, `hour`, `light`, `time`, `wind`, `pointer`, `motion`,
`quality`, and the part that will show: rows `viewTop`/`viewBottom`,
columns `viewLeft`/`viewRight`), the scene's own canvas's `ctx`, an
AbortSignal `signal` for any listeners the scene adds, and `createStars`.
During a switch two scenes run side by side, each with its own `state`,
canvas and clock, so a scene must keep everything it has to itself: never
write to `wind`, `pointer` or anything else it's handed. It returns:

```js
{
  layers: [                      // built, updated and framed in this order; drawn by z
    { id, kind: 'static' | 'animated', z,
      build(state),              // a generator: paint textures, yielding often
      update(dt, state),         // each fixed 60 Hz step
      frame(dt, state),          // each animation frame, while the wind blows
      render(ctx, state),        // draw
      key(state), bounds(state), // static layers: redrawn only when key() changes
    },
  ],
  interactions: { hint: { day, night }, onTap(x, y) },
  obstacles(hour, light),        // optional: what the hero text should keep clear of
  stats(),                       // optional: numbers for paintedScene.stats()
  trace(),                       // optional: where its moving things are, for paintedScene.trace()
  dispose(),                     // free its canvases
}
```

Paint everything that doesn't move once, in `build`, and keep per-frame
work for what moves. Anything that moves belongs only to an animated layer,
never painted into a static texture as well. `build` runs in the spare time
at the end of each frame while another scene is on screen, so yield often:
every few milliseconds of work at most. A step may yield a promise (work
done in a worker, say) and the build waits for it without spending the
frames' time. A static
layer is cached by the compositor and redrawn only when its `key` changes; an
animated one draws every frame and can keep its own buffers (a `keyedCache`
from `engine/compositor.js` re-renders one only when the light changes).

### What the engine gives you

| Module | Use it for |
| --- | --- |
| `engine/brush.js` | `createBrush(style)` for every mark (`paintStroke`, `paintStamp`), `tintInto` to colour grey stamps, `createAtlas` for many small sprites on one canvas |
| `engine/noise.js` | `noise2`, `fbm` for broad masses, `curlAt` for swirl, `flowField` for stroke directions |
| `engine/wind.js` | The one breeze: `wind.dir`, `wind.speed`, `wind.gust` (1–1.8), `wind.curlAt`, `wind.swell(ms)` for ground-level waves. Read it; never advance it |
| `engine/time.js` | Palettes by hour (the engine hands you `state.light`); `SUNRISE`, `SUNSET` |
| `engine/light.js` | `relight(g, paint, light)`: lay the hour's tint, desaturation and glaze over a layer painted in daylight colours, instead of repainting it |
| `engine/stars.js` | `engine.createStars({ brush, style: 'swirl' \| 'soft' })`: place its `layer(z)` and `shootingLayer(z)`; `launch(x, y, wind)` from a tap; `list()` to reflect them |
| `engine/pointer.js` | `state.pointer`: `x`, `y`, `active`, and smoothed `vx`, `vy` per step |
| `engine/water.js` | Water: `swellAt(X, Z, t, chop, unit)` (the swell's height and slopes on the water's plane; `planeAt` maps a screen point onto it), `SWELL_GLSL` (the same, for a shader), `paintReflection` (Monet's painted reflection of what's above, flipped), `createWaterGL()` (one pass moving a reflection buffer by the swell; `drawStrips` without WebGL). The harbour shows how they fit together |
| `engine/bake.js` | `bake(import.meta.url, 'name', args)`: runs a generator the scene exports in a worker (slow one-off painting) and hands back its canvases as ImageBitmaps; `bitmaps()` to send it images |
| `engine/governor.js` | `state.quality` (1, dropping to 0.3 if frames run long): scale optional work by it. `state.motion` is false under reduced motion: paint the scene still |

The engine also handles the time slider, pausing off screen, the DPR cap,
resizing, and switching scenes. A switch is prepared before anything on
screen changes: the next scene is built off screen, in the frames' spare
time, and run a few seconds ahead so it arrives already moving, and a worker
paints the reveal-time map of the brushstrokes that will paint it in
(`engine/reveal.js`). The gallery starts this as it opens, or when a card is
hovered or focused. During the repaint both scenes keep running, each on its
own canvas (`engine/stage.js`), and each frame a mask from the map (one
WebGL draw; Canvas 2D without WebGL) shows the new one where the brush has
been and lets the old one go just behind it. At the end the old scene is
simply dropped. Under reduced motion it's a 300 ms crossfade. `site.js`
runs each switch in a fixed order (prepare, hide the hero card, swap the
page's colours, repaint, show the card), and nothing else touches the card
or the colours meanwhile. A scene needs no DOM code; keep it that way.

### Brush and palettes

- **brushStyle** is passed to `createBrush`. `BRISTLE` (in `engine/brush.js`)
  is Van Gogh's loaded bristle brush; `DAB` is Monet's short broken dabs.
  Start from one and change what you need: `pressure`, `bristles`,
  `bristleWidth`, `edgeLift`, `dryChance`, `edgeFade`, `scumble` (dry-brush
  breaks) and `feather` (a soft edge). The repaint that brings the scene in
  lays its strokes with the scene's own brush too.
- **palettes** has one entry per phase (`dawn`, `day`, `golden`, `dusk`,
  `night`), each a keyframe or a list of them. A keyframe may set its own
  hour `h`; otherwise the phase's default hour is used. Every number and
  array in a keyframe is blended between hours, so key whatever your layers
  read (sky colours, a land `tint`, …). `dark` (0 day – 1 night) is required:
  it drives the stars, the page theme and the hint.
- A good pattern (both scenes use it): paint in daylight colours once, then
  per hour multiply in a `tint` and glaze a `wash` (see `engine/light.js`),
  so moving the slider never repaints anything.

### Stills (the placeholder WebPs)

Each scene needs five files in `scenes/stills/`: `<id>-day.webp` and
`<id>-night.webp` (1600 × 1215: one 1600 × 900 screen plus the dissolve),
their 960-wide `-960` versions, and `<id>-thumb.webp` (480 × 270) for the
gallery. To make them, serve the site locally, open
<http://localhost:5173/tools/stills.html>, click **Make stills** and save each
file under the name shown. It paints every scene at its `placeholder` hours.

### Register it in the gallery

Add one line to `scenes/index.js`:

```js
{ id: 'irises', label: 'Irises', after: 'Van Gogh', load: () => import('./irises.js') },
```

That's all: the gallery card, `?scene=irises`, the remembered choice, the
footer credit ("Scene after …") and the stills all follow from the id. The
label is repeated there (rather than read from the module) so the gallery can
show every painting without downloading them.

### Before you ship it

- Hero text contrast of at least 4.5:1 against its sky at every hour (the
  `hero` colours and `heroTone` are there for pale skies), and the page
  colours in `contentTheme` too.
- Animation work within about 4 ms a frame on a laptop
  (`paintedScene.stats()` in the console; add `?profile` for each layer).
- Under reduced motion (`state.motion` false) the scene is still.
- The dissolve: strokes thin out into the page and never stop at a hard edge.

## Deploy

It's a folder of static files, so any static host works for free.

- **GitHub Pages:** push this folder to a repository, then *Settings → Pages*
  → deploy from the `main` branch, root folder.
- **Netlify / Cloudflare Pages / Vercel:** create a new site from the
  repository (or drag the folder into Netlify's dashboard). There's no build
  command and the publish directory is the root.

### Custom domain

1. Buy the domain from any registrar.
2. Add it in your host's settings (GitHub Pages: *Settings → Pages → Custom
   domain*; Netlify, Cloudflare and Vercel: *Domains*).
3. At the registrar, add the DNS records the host shows you, usually an
   `A`/`ALIAS` record for the bare domain and a `CNAME` for `www`.
4. Turn on HTTPS in the host's settings once DNS has propagated.

### Where it lives now

The site is deployed with GitHub Pages from the `main` branch of
`chriswang8314/chriswang8314.github.io`, at <https://chriswang8314.github.io>.
To update it, commit and push to `main`; Pages republishes within a minute or
two.

When you move to a custom domain, also update the addresses in the
`canonical`, `og:url`, `og:image` and `twitter:image` tags in `index.html`, so
link previews (iMessage, LinkedIn, Slack) keep working.
