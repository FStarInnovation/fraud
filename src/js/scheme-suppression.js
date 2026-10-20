// Схема 2 «Занижение цены перед крупной сделкой»: модель, два акта и подстановки внутри своего блока страницы.
import scenario from '../scenarios/suppression.json';
import { simulate } from './sim-suppression.js';
import { createChart } from './chart.js';
import { createBook, createParties, createProtocol } from './ui.js';
import { schemeFrame, detectFrame } from './acts-suppression.js';
import { setPalette } from './palette.js';
import { createStage } from './stage.js';
import * as F from './fmt.js';

function srList(section, steps) {
  const ol = section.querySelector('.sr-steps');
  ol.innerHTML = '';
  for (const s of steps) { const li = document.createElement('li'); li.textContent = `${s.title} ${s.sub}`; ol.appendChild(li); }
}

export function initSuppression(root, { reduce, scrollTo, setScroll }) {
  const sim = simulate(scenario);
  const [actScheme, actDetect] = scenario.acts.map((act) => ({
    ...act,
    steps: act.steps.map((s) => ({
      ...s, title: F.fill(s.title, sim.vars), sub: F.fill(s.sub, sim.vars),
      finding: s.finding && F.fill(s.finding, sim.vars), value: s.value && F.fill(s.value, sim.vars),
    })),
  }));

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
  const chartOpts = (ref) => ({
    reduce, minVol: scenario.params.baseHourVolume * 3, xTicks,
    volumes: (c, s, v) => {
      const C = ref.colors;
      return [
        { q: c.vMarket * s.f, color: C.vol },
        { q: c.vSeller * s.f, color: C.trader },
        { q: c.vMatched * s.f, color: C.accent, overlay: true, alpha: v.matchedA || 0 },
      ];
    },
  });

  // ---------- Акт I ----------
  const s1 = root.querySelector('.act-scheme');
  srList(s1, actScheme.steps);
  const ref1 = {};
  const chart1 = createChart(s1.querySelector('canvas'), sim, chartOpts(ref1));
  ref1.colors = chart1.colors;
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
  const s2 = root.querySelector('.act-detect');
  srList(s2, actDetect.steps);
  const ref2 = {};
  const legend2 = s2.querySelector('.legend');
  const chart2 = createChart(s2.querySelector('canvas'), sim, chartOpts(ref2));
  ref2.colors = chart2.colors;
  const protocol = createProtocol(s2.querySelector('.proto'), actDetect.steps, scenario.score);
  sim.vars.score = String(protocol.total);
  sim.vars.scoreBand = protocol.band;
  sim.vars.conclusion = scenario.conclusion ? scenario.conclusion.text : '';
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

  root.querySelectorAll('[data-v]').forEach((el) => { el.textContent = sim.vars[el.dataset.v] ?? el.textContent; });

  const rerender = () => { chart1.resize(); chart2.resize(); stage1.rerender(); stage2.rerender(); };
  const ro = new ResizeObserver(rerender);
  ro.observe(s1.querySelector('canvas'));
  ro.observe(s2.querySelector('canvas'));
  ro.observe(s1.querySelector('.book-asks'));

  return { sim, vars: sim.vars, stages: { [s1.id]: stage1, [s2.id]: stage2 }, weights: { ['#' + s1.id]: actScheme.steps.map((s) => s.w), ['#' + s2.id]: actDetect.steps.map((s) => s.w) }, rerender };
}
