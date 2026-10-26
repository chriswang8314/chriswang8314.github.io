/*
 * The page around the painting: fills the layout from content.js, keeps the
 * hero text clear of the sun and the town, shows the nav once the hero is
 * scrolled past, and themes the page by the painting's time of day
 * (day, a warmer evening, or the dark "nocturne").
 */
(() => {
  'use strict';

  const C = window.CONTENT;
  // the painting engine (engine/engine.js, a module) arrives a moment after
  // this script: the words go on the page first, then this is set (see start)
  let scene = null;
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
    const region = scene.scene && scene.scene.layout.heroTextRegion;
    if (region && region.mode === 'fixed') {
      if (placeFixed(region) > 0) {
        heroText.classList.add('compact');
        placeFixed(region);
      }
      return;
    }
    if (placeAt() > 0) {
      heroText.classList.add('compact');
      placeAt();
    }
  }

  // a scene with a fixed spot for the text (x, y and the lowest it may
  // reach, in % of the hero): returns how far past that it still runs
  function placeFixed(region) {
    const W = hero.clientWidth, H = hero.clientHeight;
    const h = heroText.offsetHeight, narrow = W <= 640;
    const margin = narrow ? 16 : Math.max(24, W * 0.05);
    const tc = timeControl.getBoundingClientRect();
    const x = narrow ? margin : Math.max(margin, (W * region.x) / 100);
    const y = narrow ? tc.bottom + 14 : Math.max(64, (H * region.y) / 100);
    // keep above whatever the scene reports in the way (its sails, say)
    const obs = scene.obstacles();
    let floor = (H * region.maxBottom) / 100;
    if (obs) for (const [a, b, top] of obs.skyline) if (b > x && a < x + heroText.offsetWidth) floor = Math.min(floor, top - 12);
    heroText.style.left = `${x}px`;
    heroText.style.top = `${y}px`;
    heroText.classList.add('placed');
    placedHour = scene.hour;
    return Math.max(0, y + h - floor);
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

  // the colours themselves come from the scene showing (style.css has the
  // default scene's day colours, for the moment before it loads)
  function applyTheme(next) {
    if (next === theme) return;
    theme = next;
    root.dataset.theme = next;
    nocturne.setAttribute('aria-pressed', String(next === 'night'));
    const colors = scene && scene.contentTheme(next);
    if (!colors) return;
    for (const [name, value] of Object.entries(colors.vars)) root.style.setProperty(name, value);
    document.querySelector('meta[name="theme-color"]').content = colors.themeColor;
  }

  // the hero text's own colours, for scenes whose sky changes under it
  // from pale to dark (the wheat keeps its blue panel and needs none)
  let heroVars = [], heroTone = null;
  function applyHeroTone() {
    const t = scene.heroTone();
    if ((t && t.tone) === heroTone) return;
    heroTone = t && t.tone;
    for (const name of heroVars) root.style.removeProperty(name);
    heroVars = t ? Object.keys(t.vars) : [];
    if (t) for (const [name, value] of Object.entries(t.vars)) root.style.setProperty(name, value);
  }

  window.addEventListener('scenetime', (e) => {
    if (switching) return; // the switch sets the theme (see switchScene)
    const { hour, dark } = e.detail;
    applyTheme(themeFor(hour, dark));
    applyHeroTone();
    if (placedHour !== null && Math.abs(hour - placedHour) > 0.1) placeHeroText();
  });

  // A new scene brings its own colours, description and credit: the first
  // scene as the page loads (or one shown without a repaint), here; a switch,
  // in switchScene.
  const still = $('.hero-still');
  function credit({ title, artist, year, description }) {
    $('#scene-description').textContent = description;
    const line = $('#footer-scene');
    line.textContent = `Scene after ${artist}, `;
    line.append(el('cite', { textContent: title }), ` (${year})`);
  }
  window.addEventListener('scenechange', (e) => {
    const { id } = e.detail;
    if (switching) return syncGallery(id);
    credit(e.detail);
    const current = theme;
    theme = null;
    applyTheme(current || themeFor(scene.hour, isNightHour(scene.hour) ? 1 : 0));
    heroTone = undefined;
    applyHeroTone();
    // the first scene wasn't the one asked for (an old saved choice, say): show its own still
    if (!still.classList.contains('retired') && !still.currentSrc.includes(`/${id}-`)) {
      const base = `scenes/stills/${id}-${theme === 'night' ? 'night' : 'day'}`;
      still.srcset = `${base}-960.webp 960w, ${base}.webp 1600w`;
      still.src = `${base}.webp`;
    }
    syncGallery(id);
    if (placedHour !== null) placeHeroText();
  });

  // ---------- switching paintings ----------
  // One routine runs every switch, in strict order, and while it runs it's
  // the only thing that touches the hero card or the theme:
  //   1. prepare: the engine gets the new painting ready off screen (nothing visible changes)
  //   2. hide the card: it fades out in its own colours, then is hidden outright
  //   3. swap the theme: with the card hidden and nothing on it animating, the
  //      new painting's colours go on and the card moves to its new place
  //   4. repaint: the new painting is brushed in, both moving throughout
  //   5. show the card: it fades in, already in the new colours
  // Each switch has a token. Picking another painting part-way overtakes it
  // at its next step, and the new switch carries on from what's on screen.

  let switching = 0, switchCount = 0;

  // resolves once the card's opacity transition ends (or `ms` passes, in case it never does)
  const cardSettled = (ms) => new Promise((resolve) => {
    let timer = 0;
    const done = () => {
      heroText.removeEventListener('transitionend', onEnd);
      clearTimeout(timer);
      resolve();
    };
    const onEnd = (e) => e.target === heroText && e.propertyName === 'opacity' && done();
    heroText.addEventListener('transitionend', onEnd);
    timer = setTimeout(done, ms);
  });

  async function hideCard() {
    if (heroText.classList.contains('card-hidden')) return;
    heroText.classList.remove('card-in');
    if (getComputedStyle(heroText).opacity !== '0') {
      const settled = cardSettled(400);
      heroText.classList.add('card-out');
      await settled;
    } else heroText.classList.add('card-out');
    heroText.classList.add('card-hidden');
  }

  async function showCard() {
    const settled = cardSettled(500);
    heroText.classList.add('card-in');
    heroText.classList.remove('card-hidden', 'card-out');
    await settled;
    heroText.classList.remove('card-in');
  }

  // the new painting's colours, description and credit, and the card's
  // place for it (only ever while the card is hidden)
  function swapTheme(described) {
    // the page's colours change over the repaint's length (when any of it is
    // in view: otherwise at once, sparing every element its own animation)
    root.style.setProperty('--switch-ms', `${Math.round(scene.revealSeconds() * 1000)}ms`);
    if ($('main').getBoundingClientRect().top < window.innerHeight) {
      root.classList.add('scene-switching');
      getComputedStyle(document.body).color;
    }
    credit(described);
    theme = null;
    applyTheme(themeFor(scene.hour, scene.dark()));
    heroTone = undefined;
    applyHeroTone();
    placeHeroText();
    getComputedStyle(heroText).color; // all of it in place now, with no transitions
  }

  async function switchScene(id) {
    const token = ++switchCount;
    switching = token;
    const live = () => switching === token;
    // 1. ready off screen; the painting's card in the gallery pulses until then
    await scene.prepare(id);
    if (!live()) return;
    for (const card of options.querySelectorAll('.preparing')) card.classList.remove('preparing');
    // 2.
    await hideCard();
    if (!live()) return;
    // 3.
    const described = await scene.retarget(id);
    if (!live()) return;
    swapTheme(described);
    // 4.
    await scene.reveal(id);
    if (!live()) return;
    // 5.
    placeHeroText(); // the sun may have moved on a little meanwhile
    getComputedStyle(heroText).color;
    await showCard();
    if (!live()) return;
    switching = 0;
    root.classList.remove('scene-switching');
  }

  // Dev check (on localhost, or with ?dev): the card's colours may only
  // change while it can't be seen. Any change to the theme on the page's
  // root during a switch while the card shows at all is logged as an error.
  const DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || new URLSearchParams(location.search).has('dev');
  if (DEV) {
    const themeState = () => {
      const st = root.style;
      let out = root.dataset.theme || '';
      for (let i = 0; i < st.length; i++) {
        const name = st[i];
        if (name.startsWith('--') && name !== '--switch-ms' && name !== '--scene-depth' && name !== '--content-start') out += `|${name}:${st.getPropertyValue(name)}`;
      }
      return out;
    };
    let seen = themeState();
    new MutationObserver(() => {
      const now = themeState();
      if (now === seen) return;
      seen = now;
      const opacity = parseFloat(getComputedStyle(heroText).opacity);
      if (switching && opacity !== 0) console.error(`[scene switch] the theme changed while the hero card showed (opacity ${opacity})`);
    }).observe(root, { attributes: true, attributeFilter: ['style', 'data-theme'] });
  }

  // ---------- gallery: choose the painting ----------
  // A button opens a small panel of the paintings, as a group of radio
  // buttons (arrow keys move between them; the choice takes effect at once).
  // Esc or a click elsewhere closes it. The choice is remembered, and a link
  // with ?scene=… shows that scene first. On a first visit a tip points at
  // the button until it's used or dismissed.

  const SCENE_STORE = 'cw-scene', TIP_STORE = 'cw-gallery-tip';
  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* private mode or blocked storage: it just isn't remembered */
      }
    },
  };

  const gallery = $('#gallery'), galleryToggle = $('#gallery-toggle'), galleryPanel = $('#gallery-panel');
  const options = $('#gallery-options'), tip = $('#gallery-hint');

  function buildGallery() {
    for (const s of scene.scenes) {
      const input = el('input', { type: 'radio', name: 'scene', value: s.id });
      const img = el('img', { src: s.thumb, alt: '', width: 480, height: 270, loading: 'lazy', decoding: 'async' });
      options.append(el('label', { className: 'gallery-card' }, [
        input,
        el('span', { className: 'gallery-frame' }, [img]),
        el('span', { className: 'gallery-name' }, [el('b', { textContent: s.label }), ` · after ${s.after}`]),
      ]));
    }
    syncGallery(root.dataset.scene);
  }

  function syncGallery(id) {
    for (const input of options.querySelectorAll('input')) input.checked = input.value === id;
    for (const card of options.querySelectorAll('.preparing')) card.classList.remove('preparing');
  }

  // the paintings get ready to switch to before they're picked
  const prepareFirstOther = () => {
    const other = scene.scenes.find((s) => s.id !== root.dataset.scene);
    if (other) scene.prepare(other.id);
  };
  options.addEventListener('pointerover', (e) => {
    const input = e.target.closest('.gallery-card')?.querySelector('input');
    if (input && !input.checked) scene.prepare(input.value);
  });
  options.addEventListener('focusin', (e) => e.target.value && !e.target.checked && scene.prepare(e.target.value));

  function openGallery() {
    prepareFirstOther();
    galleryPanel.hidden = false;
    galleryToggle.setAttribute('aria-expanded', 'true');
    hideTip();
    (options.querySelector('input:checked') || options.querySelector('input')).focus();
  }

  let releaseTimer = 0;
  function closeGallery(returnFocus) {
    if (galleryPanel.hidden) return;
    // a painting got ready and not picked is let go after a while
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => galleryPanel.hidden && !switching && scene.release(), 15000);
    galleryPanel.hidden = true;
    galleryToggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) galleryToggle.focus();
  }

  galleryToggle.addEventListener('click', () => (galleryPanel.hidden ? openGallery() : closeGallery(true)));
  galleryPanel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeGallery(true);
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!gallery.contains(e.target)) closeGallery(false);
  });
  galleryPanel.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !gallery.contains(e.relatedTarget)) closeGallery(false);
  });

  options.addEventListener('change', (e) => {
    const id = e.target.value;
    // the card pulses until the repaint begins (the painting may still be getting ready)
    for (const card of options.querySelectorAll('.gallery-card')) card.classList.toggle('preparing', card.contains(e.target));
    switchScene(id);
    store.set(SCENE_STORE, id);
    // a shared link keeps naming the scene it shows
    const url = new URL(location.href);
    if (url.searchParams.has('scene')) {
      url.searchParams.set('scene', id);
      history.replaceState(null, '', url);
    }
  });

  function hideTip() {
    if (!tip.hidden) store.set(TIP_STORE, 'seen');
    tip.hidden = true;
  }
  $('#gallery-hint-close').addEventListener('click', hideTip);
  const offerTip = () => {
    if (store.get(TIP_STORE) !== 'seen') setTimeout(() => galleryPanel.hidden && (tip.hidden = false), 1500);
  };

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
    if (!scene) return;
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
    if (!switching) placeHeroText();
  });

  // ---------- start ----------

  renderContent();

  function init() {
    scene = window.paintedScene;
    const params = new URLSearchParams(location.search);
    const previewing = params.has('hour') || params.has('mode');
    const choice = readChoice();
    if (!previewing) {
      if (choice === 'on') toNight();
      else if (choice === 'off') toDay();
      else if (window.matchMedia('(prefers-color-scheme: dark)').matches) toNight();
    }
    applyTheme(themeFor(scene.hour, isNightHour(scene.hour) ? 1 : 0));

    buildGallery();
    window.addEventListener('sceneready', () => {
      offerTip();
      placeHeroText();
      document.fonts.ready.then(() => !switching && placeHeroText()); // the web fonts change the text's size
      // retire the still once the live painting has finished fading in over it
      setTimeout(() => $('.hero-still').classList.add('retired'), 1000);
    });

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => !switching && placeHeroText(), 250);
    });
  }
  if (window.paintedScene) init();
  else window.addEventListener('paintedscene', init, { once: true });
})();
