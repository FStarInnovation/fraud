import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import 'number-flow';

import scenario from '../scenarios/front-running.json';
import { simulate } from './sim.js';
import { createChart } from './chart.js';
import { createBook, createAccounts, createProtocol } from './ui.js';
import { schemeFrame, detectFrame, setPalette } from './acts.js';
import { createStage } from './stage.js';
import { createHero } from './hero.js';
import * as F from './fmt.js';

gsap.registerPlugin(ScrollTrigger, SplitText);

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sim = simulate(scenario);
const [actScheme, actDetect] = scenario.acts.map((act) => ({
  ...act,
  steps: act.steps.map((s) => ({
    ...s, title: F.fill(s.title, sim.vars), sub: F.fill(s.sub, sim.vars),
    finding: s.finding && F.fill(s.finding, sim.vars), value: s.value && F.fill(s.value, sim.vars),
  })),
}));
window.__tafs = { sim };
window.__w = { '#scheme': actScheme.steps.map((s) => s.w), '#detect': actDetect.steps.map((s) => s.w) };

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
document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const id = a.getAttribute('href').slice(1);
  const el = id && document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  if (a.hasAttribute('data-watch')) { stage1.goStart(() => stage1.play()); return; }
  scrollTo(el.getBoundingClientRect().top + window.scrollY);
}));

// Текст для чтения с экрана: все шаги по порядку
function srList(section, steps) {
  const ol = section.querySelector('.sr-steps');
  ol.innerHTML = '';
  for (const s of steps) { const li = document.createElement('li'); li.textContent = `${s.title} ${s.sub}`; ol.appendChild(li); }
}

// ---------- Первый экран ----------
const hero = createHero(document.querySelector('#hero-canvas'), { reduce });

if (!reduce) {
  const h1 = document.querySelector('.hero h1');
  const split = SplitText.create(h1, { type: 'lines', mask: 'lines' });
  gsap.from(split.lines, { yPercent: 105, duration: 1.1, ease: 'expo.out', stagger: 0.09, delay: 0.1 });
  gsap.from('.hero .lede, .hero .lens-wrap', { opacity: 0, y: 14, duration: 0.9, ease: 'power2.out', delay: 0.45, stagger: 0.12 });
}

// ---------- Акт I ----------
const s1 = document.querySelector('#scheme');
srList(s1, actScheme.steps);
const chart1 = createChart(s1.querySelector('canvas'), sim, { reduce, minVol: sim.P.medianVolume * 4 });
setPalette(chart1.colors);
const book = createBook(s1.querySelector('.book'));
const accounts = createAccounts(s1.querySelector('.acc'));
let cap = book.capacity();
const stage1 = createStage(s1, actScheme.steps, {
  reduce, scrollTo, setScroll,
  onFrame: (k, u) => {
    const f = schemeFrame(sim, k, u, cap);
    chart1.set(f.chart);
    book.update(f.book);
    accounts.update(f.acc);
  },
});

// ---------- Акт II ----------
const s2 = document.querySelector('#detect');
srList(s2, actDetect.steps);
const chart2 = createChart(s2.querySelector('canvas'), sim, { reduce, minVol: sim.P.medianVolume * 4 });
const protocol = createProtocol(s2.querySelector('.proto'), actDetect.steps, scenario.score);
sim.vars.score = String(protocol.total);
sim.vars.scoreBand = protocol.band;
s2.querySelector('.proto-time').textContent = `Заявка банка, ${sim.P.bankOrderTime}`;

// Переключатель «со схемой / без схемы»: доля контрфакта плавно меняется, кадр перерисовывается
const altCtl = s2.querySelector('.alt-ctl');
const altState = { v: 0 };
let altTween = null;
altCtl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  const target = Number(b.dataset.alt);
  altCtl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  if (altTween) altTween.kill();
  if (reduce) { altState.v = target; stage2.rerender(); return; }
  altTween = gsap.to(altState, { v: target, duration: 0.7, ease: 'power2.inOut', onUpdate: () => stage2.rerender() });
}));

const stage2 = createStage(s2, actDetect.steps, {
  reduce, scrollTo, setScroll,
  onFrame: (k, u) => {
    const f = detectFrame(sim, k, u, altState.v);
    chart2.set(f.chart);
    protocol.update(k, u);
    const show = f.chart.modes.candles > 0.5;
    if (altCtl.dataset.hidden !== String(!show)) altCtl.dataset.hidden = String(!show);
  },
});

// ---------- Итог ----------
document.querySelectorAll('[data-v]').forEach((el) => { el.textContent = sim.vars[el.dataset.v] ?? el.textContent; });
const copyBtn = document.querySelector('.copy');
if (copyBtn) copyBtn.addEventListener('click', async () => {
  const mail = document.querySelector('.mail').textContent.trim();
  try { await navigator.clipboard.writeText(mail); copyBtn.textContent = 'Адрес скопирован'; }
  catch { const r = document.createRange(); r.selectNodeContents(document.querySelector('.mail')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); copyBtn.textContent = 'Выделено, нажмите Ctrl+C'; }
  setTimeout(() => { copyBtn.textContent = 'Скопировать адрес'; }, 2400);
});

// Размеры холстов
const ro = new ResizeObserver(() => {
  chart1.resize(); chart2.resize();
  cap = book.capacity();
  stage1.rerender(); stage2.rerender();
});
ro.observe(s1.querySelector('canvas'));
ro.observe(s2.querySelector('canvas'));
ro.observe(s1.querySelector('.book-asks'));

document.fonts && document.fonts.ready.then(() => { chart1.resize(); chart2.resize(); hero.redraw(); stage1.rerender(); stage2.rerender(); ScrollTrigger.refresh(); });
window.addEventListener('load', () => ScrollTrigger.refresh());
