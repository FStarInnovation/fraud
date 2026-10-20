// Схема 1 «Опережающие сделки»: модель, два акта и итоговые подстановки внутри своего блока страницы.
import { gsap } from 'gsap';
import scenario from '../scenarios/front-running.json';
import { simulate } from './sim.js';
import { createChart } from './chart.js';
import { createBook, createAccounts, createProtocol } from './ui.js';
import { schemeFrame, detectFrame } from './acts.js';
import { setPalette } from './palette.js';
import { createStage } from './stage.js';
import * as F from './fmt.js';

function srList(section, steps) {
  const ol = section.querySelector('.sr-steps');
  ol.innerHTML = '';
  for (const s of steps) { const li = document.createElement('li'); li.textContent = `${s.title} ${s.sub}`; ol.appendChild(li); }
}

export function initFrontRunning(root, { reduce, scrollTo, setScroll }) {
  const sim = simulate(scenario);
  const [actScheme, actDetect] = scenario.acts.map((act) => ({
    ...act,
    steps: act.steps.map((s) => ({
      ...s, title: F.fill(s.title, sim.vars), sub: F.fill(s.sub, sim.vars),
      finding: s.finding && F.fill(s.finding, sim.vars), value: s.value && F.fill(s.value, sim.vars),
    })),
  }));

  // ---------- Акт I ----------
  const s1 = root.querySelector('.act-scheme');
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
  const s2 = root.querySelector('.act-detect');
  srList(s2, actDetect.steps);
  const chart2 = createChart(s2.querySelector('canvas'), sim, { reduce, minVol: sim.P.medianVolume * 4 });
  const protocol = createProtocol(s2.querySelector('.proto'), actDetect.steps, scenario.score);
  sim.vars.score = String(protocol.total);
  sim.vars.scoreBand = protocol.band;
  s2.querySelector('.proto-time').textContent = `Заявка банка, ${sim.P.bankOrderTime}`;

  // Переключатель «со схемой / без схемы»
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

  root.querySelectorAll('[data-v]').forEach((el) => { el.textContent = sim.vars[el.dataset.v] ?? el.textContent; });

  const rerender = () => { chart1.resize(); chart2.resize(); cap = book.capacity(); stage1.rerender(); stage2.rerender(); };
  const ro = new ResizeObserver(rerender);
  ro.observe(s1.querySelector('canvas'));
  ro.observe(s2.querySelector('canvas'));
  ro.observe(s1.querySelector('.book-asks'));

  return { sim, vars: sim.vars, stages: { [s1.id]: stage1, [s2.id]: stage2 }, weights: { ['#' + s1.id]: actScheme.steps.map((s) => s.w), ['#' + s2.id]: actDetect.steps.map((s) => s.w) }, rerender };
}
