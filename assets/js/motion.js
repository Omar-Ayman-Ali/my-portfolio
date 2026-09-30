/**
 * Shared motion engine — GSAP + ScrollTrigger driven by Lenis.
 *
 * Both pages call `startMotion()` once, after their content is in the DOM.
 * Lenis owns the scroll position; GSAP's ticker drives Lenis' RAF loop so the
 * two never fight over frames, and ScrollTrigger updates from Lenis' scroll
 * event rather than the native one.
 *
 * Everything degrades: with `prefers-reduced-motion: reduce`, or if the
 * libraries fail to load, the page stays fully readable and native scrolling
 * takes over.
 */

export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Wait for the GSAP/Lenis/Lucide globals the CDN tags provide. */
export function waitForLibs(timeout = 8000) {
  const ready = () => window.gsap && window.ScrollTrigger && window.Lenis;
  if (ready()) return Promise.resolve(true);

  return new Promise(resolve => {
    const started = performance.now();
    const tick = () => {
      if (ready()) return resolve(true);
      if (performance.now() - started > timeout) {
        console.warn('[motion] animation libraries did not load — running unanimated');
        return resolve(false);
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

export function drawIcons() {
  window.lucide?.createIcons({
    attrs: { 'stroke-width': 2, 'stroke-linecap': 'square', 'stroke-linejoin': 'miter' },
  });
}

/**
 * Boot Lenis + ScrollTrigger and run every shared scroll effect.
 * Returns a handle with the Lenis instance, the GSAP context and a `destroy()`.
 */
export function startMotion({ navSelector = '[data-nav]', onContext } = {}) {
  drawIcons();

  if (reducedMotion() || !window.gsap || !window.ScrollTrigger || !window.Lenis) {
    document.documentElement.classList.add('no-motion');
    return { lenis: null, ctx: null, destroy() {} };
  }

  const { gsap, ScrollTrigger, Lenis } = window;
  gsap.registerPlugin(ScrollTrigger);

  const nav = document.querySelector(navSelector);
  const navHeight = () => nav?.offsetHeight ?? 0;

  const lenis = new Lenis({ lerp: 0.09 });

  // In-page links. Lenis' own `anchors` option only takes a fixed numeric
  // offset, and the nav height is not fixed, so route them here instead.
  const onAnchor = event => {
    const link = event.target.closest?.('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const target = link.hash.length > 1 && document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (!target) return;
    event.preventDefault();
    lenis.scrollTo(target, { offset: -navHeight() });
    history.replaceState(null, '', link.hash);
  };
  document.addEventListener('click', onAnchor);

  lenis.on('scroll', ScrollTrigger.update);
  const tick = time => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);

  // Scroll-progress rule pinned to the top of the viewport.
  const bar = document.createElement('div');
  bar.className = 'scroll-progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);

  const EASE = 'power4.out';

  const ctx = gsap.context(() => {
    gsap.to(bar, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });

    // Section rules draw themselves in from the left.
    gsap.utils.toArray('[data-rule]').forEach(el => {
      gsap.from(el, {
        scaleX: 0,
        transformOrigin: 'left',
        duration: 1.6,
        ease: 'expo.out',
        scrollTrigger: { trigger: el, start: 'top 92%' },
      });
    });

    revealBatch({ gsap, ScrollTrigger, ease: EASE });
    countUp(gsap);

    gsap.utils.toArray('[data-grow-x]').forEach(el => {
      gsap.from(el, {
        scaleX: 0,
        transformOrigin: 'left',
        duration: 1.2,
        ease: 'expo.out',
        scrollTrigger: { trigger: el, start: 'top 92%' },
      });
    });

    magnets(gsap);

    onContext?.({ gsap, ScrollTrigger, lenis, ease: EASE });
  });

  const pointer = cursor(gsap);

  // Late webfonts and images change layout; recompute once things settle.
  // A refresh measures the whole page, so hold it while a full-screen intro is
  // playing (it would drop frames there) — the intro refreshes when it leaves.
  const refresh = () => {
    if (!document.querySelector('[data-intro]')) ScrollTrigger.refresh();
  };
  document.fonts?.ready.then(refresh);
  window.addEventListener('load', refresh, { once: true });
  setTimeout(refresh, 400);

  return {
    lenis,
    ctx,
    destroy() {
      ctx.revert();
      document.removeEventListener('click', onAnchor);
      pointer.destroy();
      lenis.destroy();
      gsap.ticker.remove(tick);
      bar.remove();
    },
  };
}

/**
 * Reveal `[data-reveal]` elements on scroll.
 *
 * Safe to call again after a re-render: elements already handled are skipped,
 * and anything that is created while it is *already* on screen (or scrolled
 * past) is animated straight away rather than waiting for a scroll that will
 * never come. Without that second case a late repaint leaves nodes stuck at
 * the `opacity: 0` the stylesheet gives them.
 */
export function revealBatch({ gsap = window.gsap, ScrollTrigger = window.ScrollTrigger, ease = 'power4.out' } = {}) {
  if (!gsap || !ScrollTrigger) return;

  const fresh = [...document.querySelectorAll('[data-reveal]')].filter(el => !el.dataset.revealed);
  if (!fresh.length) return;

  const cutoff = window.innerHeight * 0.9;
  const shown = [];
  const later = [];
  for (const el of fresh) {
    el.dataset.revealed = '1';
    (el.getBoundingClientRect().top < cutoff ? shown : later).push(el);
  }

  if (shown.length) {
    gsap.fromTo(shown, { opacity: 0, y: 48 },
      { opacity: 1, y: 0, duration: 1.1, ease, stagger: 0.09, overwrite: 'auto' });
  }

  if (later.length) {
    gsap.set(later, { opacity: 0, y: 48 });
    // One ScrollTrigger for the whole group, not one each.
    ScrollTrigger.batch(later, {
      start: 'top 90%',
      once: true,
      onEnter: batch => gsap.to(batch, { opacity: 1, y: 0, duration: 1.1, ease, stagger: 0.09 }),
    });
  }
}

/**
 * Animate any `[data-count]` element from 0 to the integer it already contains.
 * Like `revealBatch`, this is re-render safe and will not reset a number that
 * has already been scrolled past back to zero.
 */
export function countUp(gsap = window.gsap) {
  if (!gsap) return;

  const cutoff = window.innerHeight * 0.95;

  gsap.utils.toArray('[data-count]').forEach(el => {
    if (el.dataset.counted) return;

    const match = el.textContent.trim().match(/^([\d,]+)(.*)$/s);
    if (!match) return;
    const target = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(target)) return;

    // 'pending' until the count actually plays; keepCounts relies on it.
    el.dataset.counted = 'pending';
    const suffix = match[2];
    const value = { n: 0 };
    el.textContent = `0${suffix}`;

    const tween = {
      n: target,
      duration: 1.8,
      ease: 'power3.out',
      onStart: () => { el.dataset.counted = '1'; },
      onUpdate: () => {
        el.textContent = Math.round(value.n).toLocaleString('en') + suffix;
      },
    };

    if (el.getBoundingClientRect().top < cutoff) gsap.to(value, tween);
    else gsap.to(value, { ...tween, scrollTrigger: { trigger: el, start: 'top 95%', once: true } });
  });
}

const parseCount = text => {
  const match = text.trim().match(/^([\d,]+)(.*)$/s);
  return match ? { n: Number(match[1].replace(/,/g, '')), suffix: match[2] } : null;
};

/**
 * Repaint a block of `[data-count]` numbers without replaying them from zero.
 *
 * Live data lands a second or two after first paint. Numbers the visitor has
 * already watched count up tween from their old value to the new one; numbers
 * still waiting for their scroll-in keep waiting (countUp arms the new node).
 * Matched by position — the blocks always render in the same order.
 */
export function keepCounts(container, paint) {
  if (!container) return;
  const before = [...container.querySelectorAll('[data-count]')].map(n =>
    n.dataset.counted === '1' ? parseCount(n.textContent) : null,
  );

  paint(container);

  const gsap = window.gsap;
  container.querySelectorAll('[data-count]').forEach((node, i) => {
    const from = before[i];
    if (!from) return;
    node.dataset.counted = '1';
    const to = parseCount(node.textContent);
    if (!to || to.n === from.n || !gsap || reducedMotion()) return;

    const value = { n: from.n };
    node.textContent = from.n.toLocaleString('en') + to.suffix;
    gsap.to(value, {
      n: to.n,
      duration: 1.2,
      ease: 'power3.out',
      onUpdate: () => { node.textContent = Math.round(value.n).toLocaleString('en') + to.suffix; },
    });
  });
}

/**
 * Hover state for stat boxes (`[data-box]`) inside the given containers.
 *
 * One paused timeline per box, built on first hover and then only played and
 * reversed — no new tweens per event. Listeners are delegated to the
 * container, so boxes replaced by a live repaint work without rebinding.
 * Colour changes are left to CSS (the `data-hover` attribute): the palette is
 * oklch, which GSAP does not interpolate.
 */
export function boxHover(selector) {
  const gsap = window.gsap;
  if (!gsap || reducedMotion() || window.matchMedia('(hover: none)').matches) return;

  const timelines = new WeakMap();

  const build = box => {
    const rule = document.createElement('span');
    rule.className = 'box-rule';
    rule.setAttribute('aria-hidden', 'true');
    box.appendChild(rule);

    const value = box.querySelector('.stat__value, .kv__value, .v');
    const label = box.querySelector('.stat__label, .kv__label, .k');
    const glyph = box.querySelector(':scope > svg');

    const tl = gsap.timeline({ paused: true, defaults: { duration: 0.45, ease: 'power3.out' } })
      .fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'expo.out' }, 0)
      .to(value, { y: -6 }, 0)
      .to(label, { x: 6 }, 0.05);
    if (glyph) tl.to(glyph, { rotation: -14, scale: 1.2, ease: 'back.out(3)' }, 0);

    timelines.set(box, tl);
    return tl;
  };

  document.querySelectorAll(selector).forEach(container => {
    if (container.dataset.boxBound) return;
    container.dataset.boxBound = '1';

    container.addEventListener('mouseover', event => {
      const box = event.target.closest('[data-box]');
      if (!box || !container.contains(box) || box.contains(event.relatedTarget)) return;
      box.dataset.hover = '';
      (timelines.get(box) ?? build(box)).timeScale(1).play();
    });

    container.addEventListener('mouseout', event => {
      const box = event.target.closest('[data-box]');
      if (!box || box.contains(event.relatedTarget)) return;
      delete box.dataset.hover;
      timelines.get(box)?.timeScale(1.6).reverse();
    });
  });
}

const HEAT_IDLE = 'Hover a day';

function writeReadout(readout, text) {
  if (!readout || readout.textContent === text) return;
  readout.textContent = text;
  window.gsap?.fromTo(readout, { y: 6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power3.out' });
}

/**
 * Hovering a heatmap stat lights up the days it counts — the streak, the last
 * 30 days, every active day — dims the rest, and names the span in the
 * readout. Each stat node carries its cells as `node.heatFocus`.
 */
export function heatFocus(box) {
  const stats = box.querySelector('[data-heat-stats]');
  const grid = box.querySelector('[data-heat]');
  const readout = box.querySelector('[data-heat-readout]');
  if (!stats || !grid || stats.dataset.focusBound) return;
  stats.dataset.focusBound = '1';

  const gsap = window.gsap;
  const animate = gsap && !reducedMotion();
  let lit = [];

  const clear = () => {
    delete grid.dataset.focus;
    lit.forEach(cell => delete cell.dataset.in);
    lit = [];
  };

  stats.addEventListener('mouseover', event => {
    const node = event.target.closest('[data-box]');
    if (!node?.heatFocus || node.contains(event.relatedTarget)) return;
    clear();
    lit = node.heatFocus.cells.map(i => grid.children[i]).filter(Boolean);
    lit.forEach(cell => { cell.dataset.in = ''; });
    grid.dataset.focus = '';
    writeReadout(readout, node.heatFocus.readout);
    if (animate && lit.length) {
      gsap.fromTo(lit, { scale: 1 }, {
        scale: 1.5,
        duration: 0.16,
        ease: 'power2.out',
        yoyo: true,
        repeat: 1,
        stagger: { amount: Math.min(0.45, lit.length * 0.03) },
        overwrite: 'auto',
      });
    }
  });

  stats.addEventListener('mouseout', event => {
    const node = event.target.closest('[data-box]');
    if (!node?.heatFocus || node.contains(event.relatedTarget)) return;
    clear();
    writeReadout(readout, HEAT_IDLE);
  });
}

/**
 * The pointer: a square dot that tracks exactly, framed by four corner
 * brackets that trail it and lock onto whatever interactive thing is under
 * it — a button, a stat box, a single heatmap day.
 *
 * Cheap per frame: every part is moved with `gsap.quickTo` (one reusable tween
 * per axis, transforms only), pointer events only record coordinates, and the
 * layout read for a locked target happens once per animation frame at most.
 * Fine pointers only; touch and reduced motion keep the system cursor.
 */
const LOCK = [
  'a', 'button', 'label', 'input', 'select', 'textarea', 'summary',
  '[data-magnet]', '[data-box]', '.heat-grid span', '.legend__row', '.tag-bar', '[data-seg]',
].join(',');
const TEXT = 'input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea';

export function cursor(gsap = window.gsap) {
  const none = { destroy() {} };
  if (!gsap || reducedMotion() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return none;

  const root = document.createElement('div');
  root.className = 'cursor';
  root.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('span');
  dot.className = 'cursor__dot';
  const corners = ['tl', 'tr', 'bl', 'br'].map(pos => {
    const c = document.createElement('span');
    c.className = `cursor__c cursor__c--${pos}`;
    return c;
  });
  root.append(...corners, dot);
  document.body.append(root);
  document.documentElement.classList.add('has-cursor');

  const C = 10;      // corner arm length, px (matches the CSS)
  const IDLE = 13;   // half-width of the idle frame
  const PAD = 6;     // breathing room around a locked target

  const dotX = gsap.quickTo(dot, 'x', { duration: 0.08, ease: 'power3' });
  const dotY = gsap.quickTo(dot, 'y', { duration: 0.08, ease: 'power3' });
  const cornerTo = corners.map(c => ({
    x: gsap.quickTo(c, 'x', { duration: 0.38, ease: 'power3' }),
    y: gsap.quickTo(c, 'y', { duration: 0.38, ease: 'power3' }),
  }));

  let x = -100;
  let y = -100;
  let target = null;   // element the frame is locked to
  let pressed = false;
  let queued = false;

  const frame = (l, t, r, b) => {
    const pinch = pressed ? 3 : 0;
    const pos = [[l + pinch, t + pinch], [r - C - pinch, t + pinch], [l + pinch, b - C - pinch], [r - C - pinch, b - C - pinch]];
    pos.forEach(([px, py], i) => { cornerTo[i].x(px); cornerTo[i].y(py); });
  };

  // One layout read per frame, however many events arrived.
  const update = () => {
    queued = false;
    dotX(x);
    dotY(y);
    if (target && target.isConnected) {
      const r = target.getBoundingClientRect();
      // Big blocks (a whole card, a table row) get a looser idle frame instead.
      if (r.width < 420 && r.height < 160) {
        frame(r.left - PAD, r.top - PAD, r.right + PAD, r.bottom + PAD);
        return;
      }
      frame(x - IDLE * 1.8, y - IDLE * 1.8, x + IDLE * 1.8, y + IDLE * 1.8);
      return;
    }
    frame(x - IDLE, y - IDLE, x + IDLE, y + IDLE);
  };
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };

  // While locked, follow the target every frame — magnetic buttons keep
  // drifting after the pointer stops. Off the ticker again once unlocked.
  const follow = () => update();

  const setTarget = next => {
    if (next === target) return;
    if (next && !target) gsap.ticker.add(follow);
    if (!next && target) gsap.ticker.remove(follow);
    target = next;
    const text = next?.matches(TEXT);
    gsap.to(dot, {
      scaleX: text ? 0.34 : next ? 0 : 1,
      scaleY: text ? 3.4 : next ? 0 : 1,
      duration: 0.3,
      ease: 'power3.out',
      overwrite: 'auto',
    });
    gsap.to(corners, { opacity: text ? 0 : 1, duration: 0.2, overwrite: 'auto' });
    queue();
  };

  const onMove = event => {
    x = event.clientX;
    y = event.clientY;
    if (root.dataset.shown !== '1') {
      root.dataset.shown = '1';
      gsap.set([dot, ...corners], { x, y });
      gsap.to(root, { opacity: 1, duration: 0.3, overwrite: 'auto' });
    }
    queue();
  };
  const onOver = event => setTarget(event.target.closest?.(LOCK) ?? null);
  // Scrolling moves the page under a still pointer: re-resolve the target.
  const onScroll = () => {
    if (root.dataset.shown !== '1') return;
    const under = document.elementFromPoint(x, y);
    setTarget(under?.closest?.(LOCK) ?? null);
    queue();
  };
  const onDown = () => { pressed = true; queue(); };
  const onUp = () => { pressed = false; queue(); };
  const onLeave = () => {
    root.dataset.shown = '0';
    gsap.to(root, { opacity: 0, duration: 0.25, overwrite: 'auto' });
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerover', onOver, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);

  return {
    destroy() {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerover', onOver);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      document.documentElement.classList.remove('has-cursor');
      gsap.ticker.remove(follow);
      root.remove();
    },
  };
}

/** Pointer-following nudge on `[data-magnet]`, using quickTo for per-frame cheapness. */
export function magnets(gsap = window.gsap) {
  if (!gsap || window.matchMedia('(hover: none)').matches) return;
  document.querySelectorAll('[data-magnet]').forEach(el => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3' });
    el.addEventListener('mousemove', event => {
      const rect = el.getBoundingClientRect();
      xTo((event.clientX - rect.left - rect.width / 2) * 0.3);
      yTo((event.clientY - rect.top - rect.height / 2) * 0.4);
    });
    el.addEventListener('mouseleave', () => {
      xTo(0);
      yTo(0);
    });
  });
}

/**
 * Heatmap hover: lift the hovered day, nudge its four neighbours, and write the
 * day's label into the section readout.
 */
export function heatmapHover(root) {
  const grid = root.querySelector('[data-heat]');
  const readout = root.querySelector('[data-heat-readout]');
  if (!grid) return;

  // paintCalendar reuses the grid element, so a repaint would otherwise stack
  // a second copy of every listener on it.
  if (grid.dataset.hoverBound) return;
  grid.dataset.hoverBound = '1';

  const gsap = window.gsap;
  // Read live: a repaint may have replaced the cells since this was bound.
  let cells = [...grid.children];
  let active = -1;

  const scale = (el, to, z) =>
    gsap
      ? gsap.to(el, {
          scale: to,
          zIndex: z,
          duration: to > 1 ? 0.3 : 0.4,
          ease: to > 1 ? 'back.out(3)' : 'power3.out',
          overwrite: 'auto',
        })
      : Object.assign(el.style, { transform: `scale(${to})`, zIndex: z });

  // Four-neighbourhood, clipped so it never wraps across a week boundary.
  const ring = i =>
    [i - 1, i + 1, i - 7, i + 7].filter(
      j => j >= 0 && j < cells.length && !(j === i - 1 && i % 7 === 0) && !(j === i + 1 && i % 7 === 6),
    );

  const clear = () => {
    if (active < 0) return;
    scale(cells[active], 1, 0);
    cells[active].style.outline = '';
    ring(active).forEach(j => scale(cells[j], 1, 0));
    active = -1;
  };

  grid.addEventListener('mouseover', event => {
    if (cells[0] !== grid.firstElementChild) {
      cells = [...grid.children];
      active = -1;
    }
    const i = cells.indexOf(event.target);
    if (i < 0 || i === active) return;
    clear();
    active = i;
    scale(cells[i], 1.9, 3);
    cells[i].style.outline = '2px solid var(--color-text)';
    ring(i).forEach(j => scale(cells[j], 1.3, 2));
    writeReadout(readout, cells[i].dataset.label ?? '');
  });

  grid.addEventListener('mouseleave', () => {
    clear();
    writeReadout(readout, HEAT_IDLE);
  });
}
