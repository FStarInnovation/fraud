// Кадры схемы «Занижение цены перед крупной сделкой»: чистые функции от (шаг k, прогресс u).
import { bookAt } from './sim-suppression.js';
import { col } from './palette.js';
import * as F from './fmt.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const ramp = (u, a, b) => ease((u - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;

function priceAt(sim, t) {
  const i = clamp(Math.floor(t), 0, sim.candles.length - 1);
  const c = sim.candles[i];
  const f = clamp(t - i);
  if (f >= 1) return c.close;
  if (f <= 0) return c.open;
  const seg = f * 3, k = Math.min(2, Math.floor(seg));
  return lerp(c.path[k], c.path[k + 1], seg - k);
}

// продано к моменту t (бар с дробной частью) и средняя цена продажи
function soldAt(sim, t) {
  let qty = 0, cost = 0;
  for (const f of sim.fills) {
    const part = clamp(t - f.i);
    if (part <= 0) break;
    qty += f.qty * part; cost += f.qty * part * f.price;
  }
  return { qty, avg: qty > 0 ? cost / qty : null };
}

const dayStart = (sim, d) => d * sim.P.barsPerDay;

// ---------- акт I: схема ----------
export function schemeFrame(sim, k, u) {
  const P = sim.P, m = sim.m, N = m.N, q0 = m.q0, q1 = m.q1;
  let t = q0, marks = [], focus = null, x0 = -0.5, x1 = null;
  const cards = {
    seller: { glow: 0, badge: '', fields: { shares: P.position, sold: null, avg: null } },
    fund: { glow: 0, badge: '', fields: { shares: 0, price: null, mtm: null } },
  };
  const link = { a: 0, label: 'передача пакета', kind: '' };
  const index = { a: 1, label: 'Индекс' };
  let liqA = 0, splitA = 0, blockA = 0, blockGrow = 0;
  const orderLine = (a) => ({ type: 'vline', minute: q0, color: col('trader'), label: 'Поручение: продать пакет', sub: `день ${P.quietDays + 1}, ${sim.sc.sessionStart}`, a });
  const blockMark = (a, grow) => ({ type: 'block', bar: q1 + 0.5, price: P.blockPrice, prices: [P.blockPrice], a, grow, label: `${F.int(m.rest)} по ${F.price(P.blockPrice)}`, sub: `${F.rub(m.blockValue, 0)} · вне основных торгов, ${P.blockTime}`, subLines: [F.rub(m.blockValue, 0), 'вне основных торгов'] });

  switch (k) {
    case 0: {
      t = 9 + (q0 - 9) * u; x1 = Math.max(q0 + 0.5, t + 6);
      break;
    }
    case 1: {
      t = q0; x1 = q0 + 9;
      marks.push(orderLine(ramp(u, 0, 0.4)));
      cards.seller.glow = ramp(u, 0, 0.35); cards.seller.badge = u > 0.15 ? 'поручение: продать' : '';
      break;
    }
    case 2: {
      t = q0 + 2 * P.barsPerDay * u; x1 = t + 6;
      marks.push(orderLine(1 - 0.5 * ramp(u, 0, 0.3)));
      const s = soldAt(sim, t);
      cards.seller.fields.shares = P.position - s.qty; cards.seller.fields.sold = s.qty > 0 ? s.qty : null; cards.seller.fields.avg = s.avg;
      cards.seller.glow = 1; cards.seller.badge = 'поручение: продать';
      liqA = ramp(u, 0.7, 1);
      break;
    }
    case 3: {
      t = q0 + 2 * P.barsPerDay + 3 * P.barsPerDay * u; x1 = t + 4;
      const s = soldAt(sim, t);
      cards.seller.fields.shares = P.position - s.qty; cards.seller.fields.sold = s.qty; cards.seller.fields.avg = s.avg;
      cards.seller.glow = 1; cards.seller.badge = 'поручение: продать';
      liqA = 1;
      break;
    }
    case 4: {
      t = q1; x1 = q1 + 8;
      const a = ramp(u, 0.05, 0.4);
      marks.push({ type: 'hline', price: P.basePrice, prices: [P.basePrice], m0: q0 - 4, m1: q1 + 1, color: col('fg'), label: `Цена до схемы, ${F.price(P.basePrice)}`, labelAlign: 'left', a });
      marks.push({ type: 'dimV', minute: q1 + 2.6, p0: P.basePrice, p1: P.dropTo, prices: [P.dropTo], label: '−' + F.pct(-m.drop, 0), sub: `за ${P.sellDays} дней`, a: ramp(u, 0.3, 0.65) });
      marks.push({ type: 'bracket', from: q0, to: q1, label: 'неделя продаж', small: true, hideNarrow: true, a });
      index.label = `Индекс −${F.pct(-m.indexChange, 0)}`; index.labelShort = 'Индекс';
      cards.seller.fields.shares = m.rest; cards.seller.fields.sold = m.sold; cards.seller.fields.avg = m.soldAvg;
      cards.seller.glow = 0.6; cards.seller.badge = 'поручение: продать';
      liqA = 1; splitA = ramp(u, 0.3, 0.6);
      break;
    }
    case 5: {
      t = q1 + 0.35; x1 = q1 + 12;
      blockA = ramp(u, 0, 0.25); blockGrow = ramp(u, 0.05, 0.45);
      const move = ramp(u, 0.35, 0.85);
      cards.seller.fields.shares = m.rest * (1 - move); cards.seller.fields.sold = m.sold; cards.seller.fields.avg = m.soldAvg;
      cards.seller.glow = 1 - 0.5 * move; cards.seller.badge = u > 0.86 ? 'пакет продан' : 'продаёт пакет';
      cards.fund.fields.shares = m.rest * move; cards.fund.fields.price = move > 0.02 ? P.blockPrice : null; cards.fund.glow = ramp(u, 0.3, 0.6);
      cards.fund.badge = u > 0.3 ? 'покупатель пакета' : '';
      link.a = ramp(u, 0.2, 0.45) * (1 - 0.3 * ramp(u, 0.9, 1)); link.label = `передача ${F.int(m.rest)}`;
      splitA = 1 - ramp(u, 0, 0.3);
      index.a = 0.6;
      break;
    }
    case 6: {
      t = q1 + 0.6; x1 = q1 + 12;
      blockA = 1; blockGrow = 1;
      cards.seller.fields.shares = 0; cards.seller.fields.sold = m.sold; cards.seller.fields.avg = m.soldAvg; cards.seller.glow = 0.3; cards.seller.badge = 'пакет продан';
      cards.fund.fields.shares = m.rest; cards.fund.fields.price = P.blockPrice; cards.fund.glow = 1; cards.fund.badge = 'покупатель пакета';
      cards.fund.fields.mtm = (priceAt(sim, t) - P.blockPrice) * m.rest;
      link.a = 0.7; link.label = `передача ${F.int(m.rest)}`;
      index.a = 0.6;
      break;
    }
    case 7: {
      t = q1 + 1 + (N - q1 - 1) * u; x1 = Math.min(N + 0.5, t + 6);
      blockA = 0.8; blockGrow = 1;
      marks.push({ type: 'hline', price: P.blockPrice, prices: [P.blockPrice], m0: q1 - 2, color: col('bank'), label: `Цена передачи, ${F.price(P.blockPrice)}`, labelAlign: 'right', labelBelow: true, a: ramp(u, 0, 0.3), width: 1.5 });
      cards.seller.fields.shares = 0; cards.seller.fields.sold = m.sold; cards.seller.fields.avg = m.soldAvg; cards.seller.badge = 'пакет продан';
      cards.fund.fields.shares = m.rest; cards.fund.fields.price = P.blockPrice; cards.fund.badge = 'покупатель пакета';
      cards.fund.fields.mtm = (priceAt(sim, t) - P.blockPrice) * m.rest; cards.fund.glow = ramp(u, 0.5, 0.9);
      link.a = 0.3; link.label = `передача ${F.int(m.rest)}`;
      index.a = 0.6;
      break;
    }
    case 8: {
      t = N; x1 = N + 0.5;
      blockA = 0.8; blockGrow = 1;
      const a = ramp(u, 0.05, 0.4);
      marks.push({ type: 'band', m0: q0, m1: q1 + 1, p0: P.basePrice, p1: P.blockPrice, prices: [P.basePrice, P.blockPrice], color: col('breach'), fill: 0.2, a,
        label: F.rub(m.diff, 0), sub: `(${F.price(P.basePrice)} − ${F.price(P.blockPrice)}) × ${F.int(m.rest)}`, subLines: [`(${F.price(P.basePrice)} − ${F.price(P.blockPrice)})`, `× ${F.int(m.rest)}`], labelAt: 'inside' });
      marks.push({ type: 'hline', price: P.basePrice, prices: [P.basePrice], m1: q1 + 1, color: col('fg'), label: `Оценка до схемы ${F.rub(m.valueBefore, 0)}`, labelShort: F.rub(m.valueBefore, 0), labelAlign: 'right', a });
      marks.push({ type: 'hline', price: P.blockPrice, prices: [P.blockPrice], m1: q1 + 1, color: col('bank'), label: `Передан за ${F.rub(m.blockValue, 0)}`, labelShort: F.rub(m.blockValue, 0), labelAlign: 'left', labelBelow: true, a, width: 1.5 });
      cards.seller.fields.shares = 0; cards.seller.fields.sold = m.sold; cards.seller.fields.avg = m.soldAvg; cards.seller.badge = 'пакет продан';
      cards.fund.fields.shares = m.rest; cards.fund.fields.price = P.blockPrice; cards.fund.fields.mtm = m.fundGain; cards.fund.badge = 'покупатель пакета';
      link.a = 0.3; link.label = `передача ${F.int(m.rest)}`;
      index.a = 0.5; index.label = '';
      break;
    }
    default: break;
  }
  if (blockA > 0.01) { const bm = blockMark(blockA, blockGrow); if (k >= 7) { bm.sub = ''; bm.subLines = null; } marks.push(bm); }
  if (cards.fund.fields.mtm != null) cards.fund.tone = cards.fund.fields.mtm > 0 ? 'gain' : '';

  const book = bookAt(sim, t);
  book.midLabel = 'последняя сделка';
  book.liq = { a: liqA, spread: book.spread, spreadMax: P.spreadPeak * 1.25 };
  book.split = { a: splitA, small: 1, trader: 1, smallShare: 1 - m.sellShare, traderShare: m.sellShare, proportional: true };

  const chart = { t, sweep: null, x0, x1: x1 ?? Math.max(q0 + 0.5, t + 6), marks, focus, lastTag: true, index, modes: { candles: 1 } };
  return { chart, book, acc: { cards, link } };
}

// ---------- акт II: детекция ----------
function detRanges(sim) {
  const m = sim.m, N = m.N, q0 = m.q0, q1 = m.q1;
  return [
    { d: [-0.5, q1 + 8], mode: 'candles' },
    { d: [-0.5, q1 + 8], mode: 'heat' },
    { d: [q0 - 5, q1 + 3], mode: 'candles' },
    { d: [q0 - 5, q1 + 3], mode: 'candles' },
    { d: [q0 - 5, q1 + 3], mode: 'candles' },
    { d: [q0 - 5, q1 + 3], mode: 'dist' },
    { d: [q1 - 18, q1 + 12], mode: 'candles' },
    { d: [q0 - 5, N + 0.5], mode: 'candles' },
    { d: [q0 - 5, N + 0.5], mode: 'graph' },
  ];
}

function detMarks(sim, k, a) {
  const P = sim.P, m = sim.m, q0 = m.q0, q1 = m.q1;
  const out = { marks: [], focus: null, index: { a: 0.3, domain: false }, matchedA: 0, blockA: 0.5 };
  switch (k) {
    case 0:
      out.focus = { from: q0, to: q1, a: a * 0.7 };
      out.marks.push({ type: 'hline', price: P.basePrice, prices: [P.basePrice], m0: q0 - 4, m1: q1 + 1, color: col('fg'), label: `Цена до схемы, ${F.price(P.basePrice)}`, labelAlign: 'left', a });
      out.marks.push({ type: 'dimV', minute: q1 + 5.5, p0: P.basePrice, p1: P.dropTo, prices: [P.dropTo], label: '−' + F.pct(-m.drop, 0), sub: 'бумага', a });
      out.marks.push({ type: 'bracket', from: q0, to: q1, label: `${P.sellDays} торговых дней`, labelShort: `${P.sellDays} дней`, small: true, hideNarrow: true, a });
      out.index = { a: 1, label: `Индекс −${F.pct(-m.indexChange, 0)}`, labelShort: 'Индекс', domain: true };
      break;
    case 2:
      out.focus = { from: q0, to: q1, a: a * 0.8 };
      out.marks.push({ type: 'inset', at: 'bottom-left', a, grow: a, rows: [
        { label: 'Инвесткомпания, продажи за неделю', value: m.sold, text: `${F.int(m.sold)}   ${F.pct(m.sellShare, 0)}`, color: col('trader') },
        { label: 'Все остальные участники', value: m.weekOthers, text: `${F.int(m.weekOthers)}   ${F.pct(1 - m.sellShare, 0)}`, color: col('vol') },
      ] });
      break;
    case 3:
      out.focus = { from: q0, to: q1, a: a * 0.8 };
      out.marks.push({ type: 'chevrons', dir: 'down', from: q0, to: q1, only: (c) => c.vSeller > 0, label: 'Агрессор: продавец', labelAt: 0.02, a });
      out.marks.push({ type: 'inset', at: 'bottom-left', a, grow: a, rows: [
        { label: 'Рыночными заявками, против спроса', value: m.aggressive, text: `${F.int(m.aggressive)}   ${F.pct(m.aggressorShare, 0)}`, color: col('trader') },
        { label: 'Лимитными заявками', value: m.sold - m.aggressive, text: `${F.int(m.sold - m.aggressive)}   ${F.pct(1 - m.aggressorShare, 0)}`, color: col('vol') },
      ] });
      break;
    case 4:
      out.focus = { from: q0, to: q1, a: a * 0.8 };
      out.matchedA = a;
      out.marks.push({ type: 'inset', at: 'bottom-left', a, grow: a, rows: [
        { label: 'Встречная заявка за секунды до продажи, схожий объём', value: m.matched, text: `${F.int(m.matched)}   ${F.pct(m.matchedShare, 0)}`, color: col('accent') },
        { label: 'Прочие покупатели', value: m.sold - m.matched, text: `${F.int(m.sold - m.matched)}   ${F.pct(1 - m.matchedShare, 0)}`, color: col('vol') },
      ], note: `опережение до ${P.matchedLeadSeconds} с, объём ±${F.pct(P.matchedSizeTolerance, 0)}, исполнение с проскальзыванием` });
      break;
    case 6:
      out.focus = { from: q1, to: q1 + 1, a: a * 0.6 };
      out.blockA = 1;
      out.marks.push({ type: 'inset', a, grow: a, rows: [
        { label: 'Обычный дневной оборот бумаги', value: m.dailyTurnover, text: F.int(m.dailyTurnover), color: col('vol') },
        { label: 'Сделка вне основных торгов', value: m.blockQty, text: `${F.int(m.blockQty)}   ×${F.ratio(Math.round(m.blockRatio))}`, color: col('bank') },
      ] });
      break;
    case 7:
      out.blockA = 0.8;
      out.marks.push({ type: 'band', keepAlt: true, m0: q0, m1: q1 + 1, p0: P.basePrice, p1: P.blockPrice, prices: [P.basePrice, P.blockPrice], color: col('breach'), fill: 0.2, a,
        label: F.rub(m.diff, 0), sub: `(${F.price(P.basePrice)} − ${F.price(P.blockPrice)}) × ${F.int(m.rest)}`, subLines: [`(${F.price(P.basePrice)} − ${F.price(P.blockPrice)})`, `× ${F.int(m.rest)}`], labelAt: 'inside' });
      out.marks.push({ type: 'hline', price: P.basePrice, prices: [P.basePrice], m1: q1 + 1, color: col('fg'), label: `Цена до схемы, ${F.price(P.basePrice)}`, labelAlign: 'right', a });
      out.marks.push({ type: 'hline', price: P.blockPrice, prices: [P.blockPrice], m1: q1 + 1, color: col('bank'), label: `Цена передачи, ${F.price(P.blockPrice)}`, labelAlign: 'left', labelBelow: true, a, width: 1.5 });
      out.marks.push({ type: 'dot', minute: m.N - 0.5, price: P.recoverTo, prices: [P.recoverTo], color: col('bank'), label: `${F.price(P.recoverTo)} через неделю`, sub: `фонд +${F.rub(m.fundGain, 0)}`, labelAlign: 'right', labelAbove: true, a });
      break;
    default: break;
  }
  return out;
}

function graphData(sim) {
  const P = sim.P, m = sim.m, N = sim.sc.parties;
  return {
    nodes: [
      { id: 'seller', label: N.seller, sub: 'продавец пакета', x: 0.15, y: 0.16, xn: 0.24, yn: 0.07, color: col('trader'), at: 0 },
      { id: 'desk', label: N.desk, labelShort: 'Торговый деск', sub: `продажи ${F.int(m.sold)} за неделю`, x: 0.15, y: 0.56, xn: 0.2, yn: 0.66, color: col('trader'), at: 0.05 },
      { id: 'fund', label: N.fund, sub: `купил ${F.int(m.rest)} по ${F.price(P.blockPrice)}`, x: 0.85, y: 0.16, xn: 0.8, yn: 0.07, color: col('bank'), at: 0.08 },
      { id: 'mc', label: N.mc, labelShort: 'УК', sub: 'небольшая УК', x: 0.85, y: 0.56, xn: 0.82, yn: 0.66, color: col('bank'), at: 0.2 },
      { id: 'person', label: N.person, sub: 'до прошлого года — руководитель продаж инвесткомпании', x: 0.5, y: 0.38, xn: 0.5, yn: 0.37, color: col('fg'), kind: 'person', at: 0.35 },
      { id: 'acc', label: N.counter, labelShort: 'Встречные', sub: `${F.pct(m.matchedShare, 0)} продаж: заявки за секунды до, схожий объём`, x: 0.5, y: 0.86, xn: 0.5, yn: 1.0, color: col('accent'), at: 0.55 },
    ],
    edges: [
      { from: 'seller', to: 'desk', at: 0.05 },
      { from: 'seller', to: 'fund', label: `сделка ${F.int(m.rest)} по ${F.price(P.blockPrice)}`, labelLines: [`${F.int(m.rest)}`, `по ${F.price(P.blockPrice)}`], at: 0.1, width: 2, color: col('bank'), dy: -12 },
      { from: 'mc', to: 'fund', label: 'управляет', at: 0.22, dx: 34, hideNarrow: true },
      { from: 'person', to: 'mc', label: 'гендиректор', at: 0.38, dy: 12, hideNarrow: true },
      { from: 'person', to: 'seller', label: 'работал до прошлого года', labelLines: ['работал', 'раньше'], at: 0.46, dy: 12, hideNarrow: true },
      { from: 'desk', to: 'acc', label: 'признаки договорённости', labelLines: ['договорённость?'], dashed: true, at: 0.58, dy: 12, dxn: -30 },
    ],
    legend: ['подтверждено справочниками', 'предполагаемая связь'],
    legendShort: ['подтверждено', 'предполагается'],
  };
}

export function detectFrame(sim, k, u) {
  const P = sim.P, m = sim.m;
  const DET = detRanges(sim);
  const prev = k > 0 ? DET[k - 1] : { d: [-0.5, m.N + 0.5], mode: 'candles' };
  const cur = DET[k];
  const tr = ramp(u, 0, 0.35);
  const x0 = lerp(prev.d[0], cur.d[0], tr), x1 = lerp(prev.d[1], cur.d[1], tr);
  const modes = { candles: 0, heat: 0, dist: 0, graph: 0 };
  modes[prev.mode] += 1 - tr; modes[cur.mode] += tr;
  const a = ramp(u, 0.3, 0.6);
  const now = detMarks(sim, k, a);
  const before = k > 0 ? detMarks(sim, k - 1, 1 - ramp(u, 0, 0.25)) : { marks: [], focus: null, index: { a: 0.3, domain: false }, matchedA: 0, blockA: 0.5 };
  const marks = [...before.marks, ...now.marks];
  const blockA = lerp(before.blockA, now.blockA, ramp(u, 0, 0.3));
  marks.push({ type: 'block', bar: m.q1 + 0.5, price: P.blockPrice, prices: [P.blockPrice], domainA: 1, a: blockA, grow: 1,
    label: blockA > 0.7 ? `${F.int(m.rest)} по ${F.price(P.blockPrice)}` : '', sub: 'вне основных торгов' });
  const focus = now.focus && now.focus.a > 0.01 ? now.focus : before.focus;
  const index = { ...now.index, a: lerp(before.index.a, now.index.a, ramp(u, 0, 0.3)) };
  const matchedA = lerp(before.matchedA, now.matchedA, ramp(u, 0, 0.3));
  const sigma = P.history.sigma;
  const chart = {
    t: m.N, sweep: null, x0, x1, marks, focus, lastTag: false, modes, index, matchedA, topInset: 34,
    heat: k === 1 ? {
      from: 0, to: m.q1, grow: ramp(u, 0.1, 0.5), annA: ramp(u, 0.55, 0.8),
      title: 'Карта ликвидности: цена и заявки у лучшей цены, по часам', titleShort: 'Карта ликвидности', dayLabel: (d) => `День ${d + 1}`,
      weekFrom: m.q0, weekTo: m.q1, weekLabel: 'неделя продаж',
      spreadLabel: `спред ×${F.ratio(Math.round(m.spreadX))}`, spreadSub: `${F.price(P.spreadBase)} → ${F.price(m.peakSpread)} ₽`,
    } : null,
    dist: k === 5 ? {
      title: 'Отклонение бумаги от индекса за 5 дней, вся история торгов', bins: sim.hist, domain: [-0.1, 0.1],
      ticks: [-0.08, -0.04, 0, 0.04, 0.08].map((x) => ({ x, label: (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100) + ' %' })),
      axis: 'отклонение за 5 торговых дней',
      band: { from: -sigma, to: sigma, label: 'обычный разброс', sub: `±${F.pct(sigma, 1)}` },
      marker: { x: m.relative, label: 'Эта неделя', sub: `−${F.pct(-m.relative, 0)} к индексу`, color: col('trader') },
      dim: { label: `×${F.ratio(Math.round(m.sigma))}` },
      grow: ramp(u, 0.15, 0.55), bandA: ramp(u, 0.4, 0.6), markerA: ramp(u, 0.5, 0.7), dimA: ramp(u, 0.65, 0.85),
    } : null,
    graph: k === 8 ? { ...graphData(sim), reveal: ramp(u, 0.05, 0.92) } : null,
  };
  return { chart };
}
