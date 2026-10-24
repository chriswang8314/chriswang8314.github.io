# Christopher Wang — personal site

A single-page resume site built around a live, Van Gogh–style painting of a
wheat field ("Summer Evening, Wheatfield with Setting Sun", Arles, 1888). The
painting follows the visitor's local time; the slider in the corner (or the
**nocturne** toggle in the nav) changes the hour, and the page below takes its
theme from it: day, a warmer evening, or a dark starry night.

Plain HTML, CSS and JavaScript. No build step, no backend, no dependencies.

## Run it locally

Any static file server works. From this folder:

```bash
python3 -m http.server 5173
```

Then open <http://localhost:5173>. Add `?hour=18.75` (or any hour 0–24) to
preview a time of day.

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
| `index.html` | Page structure and meta tags |
| `content.js` | Every word on the page |
| `site.js` | Renders the content, nav, nocturne theme, hero text placement |
| `scene.js` | The painting (sky, sun, town, wheat) and the time slider |
| `style.css` | Layout, typography and the three themes |
| `hero.webp`, `hero-960.webp` | A still of the painting shown instantly while the live one renders (the smaller one for phones) |
| `og-image.jpg` | 1200×630 link preview image |
| `favicon.svg`, `apple-touch-icon.png` | Icons |

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
