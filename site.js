/*
 * The page around the painting: fills the layout from content.js, keeps the
 * hero text clear of the sun and the town, shows the nav once the hero is
 * scrolled past, and themes the page by the painting's time of day
 * (day, a warmer evening, or the dark "nocturne").
 */
(() => {
  'use strict';

  const C = window.CONTENT;
  const scene = window.paintedScene;
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  // ---------- content ----------

  const ICONS = {
    email:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/></svg>',
    github:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
    linkedin:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4v11H3zm7 0h3.8v1.5h.06c.53-.95 1.83-1.95 3.77-1.95 4.03 0 4.77 2.5 4.77 5.75v5.7h-4v-5.05c0-1.2-.02-2.75-1.7-2.75-1.7 0-1.95 1.3-1.95 2.66v5.14h-4z"/></svg>',
  };

  // the address is only ever assembled here, never written whole in the HTML
  const email = `${C.email.user}@${C.email.domain}`;
  const mailto = () => `mailto:${email}`;

  const external = (label, url) =>
    el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, [label, ' ', el('span', { ariaHidden: 'true', textContent: '↗' })]);

  const iconLink = (name, label, href, isExternal) => {
    const a = el('a', { className: 'icon-link', href, ariaLabel: label });
    if (isExternal) Object.assign(a, { target: '_blank', rel: 'noopener noreferrer' });
    a.innerHTML = ICONS[name];
    a.firstChild.setAttribute('aria-hidden', 'true');
    return el('li', {}, [a]);
  };

  function renderContent() {
    document.querySelectorAll('[data-content]').forEach((node) => {
      node.textContent = C[node.dataset.content];
    });
    $('#hero-tagline').textContent = `${C.tagline} · ${C.location}`;

    $('#hero-links').append(
      iconLink('email', `Email ${C.name}`, mailto(), false),
      iconLink('github', 'GitHub', C.links.github, true),
      iconLink('linkedin', 'LinkedIn', C.links.linkedin, true),
      el('li', {}, [el('a', { className: 'resume-button', href: C.links.resume, textContent: 'Resume' })]),
    );

    $('#currently-list').append(...C.currently.map((item) => el('li', { textContent: item })));

    $('#project-list').append(
      ...C.projects.map((p) =>
        el('article', { className: 'card' }, [
          el('h3', { className: 'card-title' }, [el('span', { textContent: p.title })]),
          el('p', { className: 'card-meta', textContent: `${p.org} · ${p.dates}` }),
          el('p', { className: 'card-desc', textContent: p.description }),
          el('ul', { className: 'tags', ariaLabel: 'Tools and topics' }, p.tags.map((t) => el('li', { textContent: t }))),
          ...(p.links.length ? [el('p', { className: 'card-links' }, p.links.map((l) => external(l.label, l.url)))] : []),
        ]),
      ),
    );

    $('#about-text').append(...C.about.map((para) => el('p', { textContent: para })));

    $('#contact-links').append(
      el('li', {}, [el('a', { href: mailto(), textContent: email })]),
      el('li', {}, [external('GitHub', C.links.github)]),
      el('li', {}, [external('LinkedIn', C.links.linkedin)]),
      el('li', {}, [el('a', { href: C.links.resume, textContent: 'Resume (PDF)' })]),
    );

    $('#footer-made').textContent = `Made by ${C.name} · ${new Date().getFullYear()}`;
    $('#footer-updated').textContent = `Last updated ${C.lastUpdated}`;
  }

  // ---------- hero text: keep clear of the sun, the moon and the town ----------

  const hero = $('.hero'), heroText = $('#hero-text'), timeControl = $('#time-control');
  let placedHour = null;

  // tries the full-size text first, then a compact version if nothing fits
  function placeHeroText() {
    heroText.classList.remove('compact');
    if (placeAt() > 0) {
      heroText.classList.add('compact');
      placeAt();
    }
  }

  // puts the text in the clearest spot, returning how badly it still collides
  function placeAt() {
    const obs = scene && scene.obstacles();
    if (!obs) return 0;
    const W = hero.clientWidth, H = hero.clientHeight;
    const w = heroText.offsetWidth, h = heroText.offsetHeight;
    const narrow = W <= 640;
    const margin = narrow ? 16 : Math.max(24, W * 0.05);
    const tc = timeControl.getBoundingClientRect();
    const topMin = narrow ? tc.bottom + 14 : Math.max(64, H * 0.1);
    const belowControl = tc.bottom + 16;

    // the lowest point the town reaches between x0 and x1, as a y coordinate
    const townTop = (x0, x1) =>
      obs.skyline.reduce((y, [a, b, top]) => (b > x0 && a < x1 ? Math.min(y, top) : y), obs.horizonY);

    const xs = narrow ? [margin] : [margin, W - margin - w];
    const candidates = [];
    for (const x of xs) {
      const right = x > W / 2;
      const top = right ? Math.max(topMin, belowControl) : topMin;
      const low = townTop(x, x + w) - 18 - h;
      candidates.push([x, top]);
      if (low > top + 24) candidates.push([x, low]);
    }

    // how badly a spot collides: with the sun or moon (heavily), and with the town
    const cost = ([x, y]) => {
      let c = 0;
      for (const o of obs.orbs) {
        const dx = Math.max(x - o.x, 0, o.x - (x + w)), dy = Math.max(y - o.y, 0, o.y - (y + h));
        const gap = Math.hypot(dx, dy) - o.r;
        if (gap < 0) c += 1000 - gap;
      }
      const overTown = y + h + 10 - townTop(x, x + w);
      if (overTown > 0) c += 100 + overTown;
      return c;
    };

    let best = candidates[0], bestCost = Infinity;
    for (const cand of candidates) {
      const c = cost(cand);
      if (c < bestCost) {
        best = cand;
        bestCost = c;
      }
      if (c === 0) break; // candidates are in order of preference
    }
    heroText.style.left = `${best[0]}px`;
    heroText.style.top = `${best[1]}px`;
    heroText.classList.add('placed');
    placedHour = scene.hour;
    return bestCost;
  }

  // ---------- nav: appears once the hero is scrolled past ----------

  const nav = $('#site-nav');
  new IntersectionObserver(([entry]) => nav.classList.toggle('visible', !entry.isIntersecting), {
    rootMargin: '-64px 0px 0px 0px',
  }).observe(hero);

  // ---------- theme from the painting's hour ----------

  const root = document.documentElement;
  const nocturne = $('#nocturne-toggle');
  let theme = null;

  const themeFor = (hour, dark) => (dark > 0.5 ? 'night' : hour >= 17 && hour < 21 ? 'evening' : 'day');

  function applyTheme(next) {
    if (next === theme) return;
    theme = next;
    root.dataset.theme = next;
    nocturne.setAttribute('aria-pressed', String(next === 'night'));
    document.querySelector('meta[name="theme-color"]').content = next === 'night' ? '#141B33' : '#2D4F9E';
  }

  window.addEventListener('scenetime', (e) => {
    const { hour, dark } = e.detail;
    applyTheme(themeFor(hour, dark));
    if (placedHour !== null && Math.abs(hour - placedHour) > 0.1) placeHeroText();
  });

  // ---------- nocturne: jump the painting to night, and back ----------
  // The choice is remembered. Without one, a visitor whose system prefers a
  // dark theme starts in nocturne; everyone else sees their own local time.

  const STORE = 'cw-nocturne';
  const readChoice = () => {
    try {
      return localStorage.getItem(STORE);
    } catch {
      return null;
    }
  };
  const saveChoice = (value) => {
    try {
      localStorage.setItem(STORE, value);
    } catch {
      /* private mode or blocked storage: the toggle still works for this visit */
    }
  };

  const NIGHT_HOUR = 23, DAY_HOUR = 18.75; // 6:45 PM is the painting's own light
  const isNightHour = (h) => h >= 20.5 || h < 5.6;
  const realHour = () => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  };
  const toNight = () => scene.setHour(NIGHT_HOUR);
  const toDay = () => scene.setHour(isNightHour(realHour()) ? DAY_HOUR : null);

  nocturne.addEventListener('click', () => {
    if (theme === 'night') {
      toDay();
      saveChoice('off');
    } else {
      toNight();
      saveChoice('on');
    }
  });

  // ---------- scroll cue: gone as soon as the page moves ----------

  const cue = $('.scroll-cue');
  const updateCue = () => cue.classList.toggle('gone', window.scrollY > 8);
  window.addEventListener('scroll', updateCue, { passive: true });
  updateCue();

  // ---------- small screens: the time control opens on tap ----------

  const timeToggle = $('#time-toggle');
  timeToggle.addEventListener('click', () => {
    const open = !timeControl.classList.contains('open');
    timeControl.classList.toggle('open', open);
    timeToggle.setAttribute('aria-expanded', String(open));
    placeHeroText();
  });

  // ---------- start ----------

  renderContent();

  if (scene) {
    const params = new URLSearchParams(location.search);
    const previewing = params.has('hour') || params.has('mode');
    const choice = readChoice();
    if (!previewing) {
      if (choice === 'on') toNight();
      else if (choice === 'off') toDay();
      else if (window.matchMedia('(prefers-color-scheme: dark)').matches) toNight();
    }
    applyTheme(themeFor(scene.hour, isNightHour(scene.hour) ? 1 : 0));

    window.addEventListener('sceneready', () => {
      placeHeroText();
      document.fonts.ready.then(placeHeroText); // the web fonts change the text's size
    });

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(placeHeroText, 250);
    });
  }
})();
