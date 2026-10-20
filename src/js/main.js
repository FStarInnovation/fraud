import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import 'number-flow';

import { createHero } from './hero.js';
import { initFrontRunning } from './scheme-front-running.js';
import { initSuppression } from './scheme-suppression.js';

gsap.registerPlugin(ScrollTrigger, SplitText);

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Плавная прокрутка (кроме режима «меньше движения»)
let lenis = null;
if (!reduce) {
  lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.9 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}
// Плавный переход (с колбэком по прибытии) и мгновенная установка позиции (для режима воспроизведения)
const scrollTo = (y, cb) => {
  if (lenis) lenis.scrollTo(y, { duration: 1.4, onComplete: cb });
  else { window.scrollTo({ top: y, behavior: 'auto' }); if (cb) setTimeout(cb, 30); }
};
const setScroll = (y) => (lenis ? lenis.scrollTo(y, { immediate: true, force: true }) : window.scrollTo(0, y));

// ---------- Первый экран ----------
const hero = createHero(document.querySelector('#hero-canvas'), { reduce });
if (!reduce) {
  const h1 = document.querySelector('.hero h1');
  const split = SplitText.create(h1, { type: 'lines', mask: 'lines' });
  gsap.from(split.lines, { yPercent: 105, duration: 1.1, ease: 'expo.out', stagger: 0.09, delay: 0.1 });
  gsap.from('.hero .lede, .hero .hero-cta, .hero .lens-wrap', { opacity: 0, y: 14, duration: 0.9, ease: 'power2.out', delay: 0.45, stagger: 0.12 });
}

// ---------- Схемы, по порядку ----------
const schemes = [
  initFrontRunning(document.querySelector('#fr'), { reduce, scrollTo, setScroll }),
  initSuppression(document.querySelector('#sq'), { reduce, scrollTo, setScroll }),
];
const stages = Object.assign({}, ...schemes.map((s) => s.stages));
window.__tafs = { schemes };
window.__w = Object.assign({}, ...schemes.map((s) => s.weights));

// Якоря: плавный переход; ссылка с data-watch запускает показ сцены с начала
document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const id = a.getAttribute('href').slice(1);
  const el = id && document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  const stage = stages[id];
  if (a.hasAttribute('data-watch') && stage) { stage.goStart(() => stage.play()); return; }
  scrollTo(el.getBoundingClientRect().top + window.scrollY);
}));

// ---------- Итог: цифры обеих схем ----------
schemes.forEach((s, j) => {
  document.querySelectorAll(`[data-v${j + 1}]`).forEach((el) => { el.textContent = s.vars[el.dataset['v' + (j + 1)]] ?? el.textContent; });
});
const copyBtn = document.querySelector('.copy');
if (copyBtn) copyBtn.addEventListener('click', async () => {
  const mail = document.querySelector('.mail').textContent.trim();
  try { await navigator.clipboard.writeText(mail); copyBtn.textContent = 'Адрес скопирован'; }
  catch { const r = document.createRange(); r.selectNodeContents(document.querySelector('.mail')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); copyBtn.textContent = 'Выделено, нажмите Ctrl+C'; }
  setTimeout(() => { copyBtn.textContent = 'Скопировать адрес'; }, 2400);
});

document.fonts && document.fonts.ready.then(() => { hero.redraw(); schemes.forEach((s) => s.rerender()); ScrollTrigger.refresh(); });
window.addEventListener('load', () => ScrollTrigger.refresh());
