import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import 'number-flow';

import scenario from '../scenarios/suppression.json';
import { simulate } from './sim-suppression.js';
import { createChart } from './chart.js';
import { createBook, createParties, createProtocol } from './ui.js';
import { schemeFrame, detectFrame } from './acts-suppression.js';
import { setPalette } from './palette.js';
import { createStage } from './stage.js';
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

function srList(section, steps) {
  const ol = section.querySelector('.sr-steps');
  ol.innerHTML = '';
  for (const s of steps) { const li = document.createElement('li'); li.textContent = `${s.title} ${s.sub}`; ol.appendChild(li); }
}

// ---------- Первый экран ----------
if (!reduce) {
  const h1 = document.querySelector('.hero h1');
  const split = SplitText.create(h1, { type: 'lines', mask: 'lines' });
  gsap.from(split.lines, { yPercent: 105, duration: 1.1, ease: 'expo.out', stagger: 0.09, delay: 0.1 });
  gsap.from('.hero .lede, .hero .hero-cta, .hero .keyfacts', { opacity: 0, y: 14, duration: 0.9, ease: 'power2.out', delay: 0.45, stagger: 0.12 });
}

// Подписи оси времени: торговые дни
const B = scenario.params.barsPerDay;
const xTicks = (x0, x1, narrow) => {
  const out = [];
  const span = x1 - x0;
  for (let i = Math.max(0, Math.ceil(x0 / B) * B); i <= x1; i += B) {
    const d = i / B;
    const every = narrow ? (span > 60 ? 3 : span > 30 ? 2 : 1) : (span > 110 ? 2 : 1);
    out.push({ x: i, label: d % every === 0 ? (narrow ? String(d + 1) : `День ${d + 1}`) : '', line: true, align: 'left' });
  }
  return out;
};
const chartOpts = (chart) => ({
  reduce, minVol: scenario.params.baseHourVolume * 3, xTicks,
  volumes: (c, s, v) => {
    const C = chart.colors;
    return [
      { q: c.vMarket * s.f, color: C.vol },
      { q: c.vSeller * s.f, color: C.trader },
      { q: c.vMatched * s.f, color: C.accent, overlay: true, alpha: v.matchedA || 0 },
    ];
  },
});

// ---------- Акт I ----------
const s1 = document.querySelector('#scheme');
srList(s1, actScheme.steps);
const chartRef1 = {};
const chart1 = createChart(s1.querySelector('canvas'), sim, chartOpts(chartRef1));
chartRef1.colors = chart1.colors;
setPalette(chart1.colors);
const book = createBook(s1.querySelector('.book'));
const parties = createParties(s1.querySelector('.acc'), {
  cards: {
    seller: { fields: { shares: {}, sold: {}, avg: { decimals: 2 } } },
    fund: { fields: { shares: {}, price: { decimals: 2 }, mtm: { decimals: 0, suffix: ' млн ₽', sign: true } } },
  },
});
const stage1 = createStage(s1, actScheme.steps, {
  reduce, scrollTo, setScroll,
  onFrame: (k, u) => {
    const f = schemeFrame(sim, k, u);
    chart1.set(f.chart);
    book.update(f.book);
    const acc = f.acc;
    if (acc.cards.fund.fields.mtm != null) acc.cards.fund.fields.mtm = acc.cards.fund.fields.mtm / 1e6;
    parties.update(acc);
  },
});

// ---------- Акт II ----------
const s2 = document.querySelector('#detect');
srList(s2, actDetect.steps);
const chartRef2 = {};
const legend2 = s2.querySelector('.legend');
const chart2 = createChart(s2.querySelector('canvas'), sim, chartOpts(chartRef2));
chartRef2.colors = chart2.colors;
const protocol = createProtocol(s2.querySelector('.proto'), actDetect.steps, scenario.score);
sim.vars.score = String(protocol.total);
sim.vars.scoreBand = protocol.band;
s2.querySelector('.proto-time').textContent = `${scenario.instrument}, ${scenario.params.days} торговых дней`;

const stage2 = createStage(s2, actDetect.steps, {
  reduce, scrollTo, setScroll,
  onFrame: (k, u) => {
    const f = detectFrame(sim, k, u);
    chart2.set(f.chart);
    protocol.update(k, u);
    const hide = String(f.chart.modes.candles < 0.5);
    if (legend2.dataset.hidden !== hide) legend2.dataset.hidden = hide;
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

const ro = new ResizeObserver(() => { chart1.resize(); chart2.resize(); stage1.rerender(); stage2.rerender(); });
ro.observe(s1.querySelector('canvas'));
ro.observe(s2.querySelector('canvas'));
ro.observe(s1.querySelector('.book-asks'));
document.fonts && document.fonts.ready.then(() => { chart1.resize(); chart2.resize(); stage1.rerender(); stage2.rerender(); ScrollTrigger.refresh(); });
window.addEventListener('load', () => ScrollTrigger.refresh());
