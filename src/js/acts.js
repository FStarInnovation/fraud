// Кадры двух актов: «Схема» и «Как находит ТАФС». Всё — чистые функции от (шаг k, прогресс u),
// поэтому прокрутка назад отматывает историю без накопленного состояния.
import { sweepState } from './chart.js';
import { levelSize } from './sim.js';
import { col } from './palette.js';
import * as F from './fmt.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const ramp = (u, a, b) => ease((u - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const r2 = (x) => Math.round(x * 100) / 100;

// ---------- стакан ----------
// eat — трейдер собирает заявки продавцов: уровни от eat.from до текущей цены показываем снятыми (золотом)
function gridBook(sim, price, cap, eat) {
  const known = new Map(sim.P.smallAsks.map(([p, q]) => [p.toFixed(2), q]));
  const size = (p) => known.get(p.toFixed(2)) ?? levelSize(p);
  const asks = [], bids = [];
  let a0 = r2(Math.ceil((price + 1e-6) / 0.2) * 0.2);
  let room = cap.asks;
  if (eat) {
    const taken = [];
    for (let p = r2(a0 - 0.2); p > eat.from + 1e-6 && taken.length < 3; p = r2(p - 0.2)) taken.push(p);
    taken.reverse();
    for (const p of taken) asks.push({ key: 'a' + p.toFixed(2), side: 'ask', price: p, qty: size(p), hit: 1, by: 'trader' });
    room -= taken.length;
  }
  for (let j = 0; j < room; j++) {
    const p = r2(a0 + j * 0.2);
    const target = !!eat && p <= eat.to + 1e-6; // заявки, которые трейдер собирает
    const hit = target && j === 0 ? clamp((price - (a0 - 0.2)) / 0.2) * 0.85 : 0;
    asks.push({ key: 'a' + p.toFixed(2), side: 'ask', price: p, qty: size(p), hit, by: target ? 'trader' : undefined, target });
  }
  let b0 = r2(Math.floor((price - 1e-6) / 0.2) * 0.2);
  for (let j = 0; j < cap.bids; j++) { const p = r2(b0 - j * 0.2); bids.push({ key: 'b' + p.toFixed(2), side: 'bid', price: p, qty: levelSize(p + 0.1), hit: 0 }); }
  const maxQty = Math.max(...asks.map((r) => r.qty), ...bids.map((r) => r.qty));
  return { asks: asks.reverse(), bids, maxQty };
}

function deepBook(sim, cap, traderA, sw) {
  const lv = sim.levels;
  const small = lv.filter((l) => !l.trader);
  const trader = lv.find((l) => l.trader);
  const room = traderA > 0.01 ? cap.asks - 1 : cap.asks;
  // во время исполнения показываем ближайшие ещё живые уровни
  let first = 0;
  if (sw && sw.V > 0) { first = small.findIndex((l) => sw.V < l.to); if (first < 0) first = small.length; first = Math.max(0, Math.min(first, small.length - room)); }
  const shown = small.slice(first, first + room);
  const asks = shown.map((l) => ({ key: 'a' + l.price.toFixed(2), side: 'ask', price: l.price, qty: l.qty, hit: sw ? clamp((sw.V - l.from) / l.qty) : 0 }));
  if (traderA > 0.01) asks.push({ key: 'a' + trader.price.toFixed(2) + 't', side: 'ask', trader: true, price: trader.price, qty: trader.qty, hit: sw ? clamp((sw.V - trader.from) / trader.qty) : 0, alpha: traderA });
  const bids = [];
  let b0 = r2(Math.floor((sim.P.buyTop - 1e-6) / 0.2) * 0.2);
  for (let j = 0; j < cap.bids; j++) { const p = r2(b0 - j * 0.2); bids.push({ key: 'b' + p.toFixed(2), side: 'bid', price: p, qty: levelSize(p + 0.1), hit: 0 }); }
  const maxSmall = Math.max(...small.map((l) => l.qty), ...bids.map((r) => r.qty));
  const maxQty = lerp(maxSmall, trader.qty, traderA);
  return { asks: asks.reverse(), bids, maxQty };
}

function lastPrice(sim, t, sw) {
  const i = Math.min(sim.candles.length - 1, Math.max(0, Math.floor(t)));
  const c = sim.candles[i];
  if (c.sweep) {
    if (sw && !sw.done) return sw.V > 0 ? sw.price : c.open;
    return lerp(sim.P.traderAsk, c.close, clamp(t - c.i));
  }
  const f = clamp(t - c.i);
  if (f >= 1) return c.close;
  if (f <= 0) return c.open;
  const seg = f * 3, k = Math.min(2, Math.floor(seg));
  return lerp(c.path[k], c.path[k + 1], seg - k);
}

// ---------- акт I: схема ----------
export function schemeFrame(sim, k, u, cap) {
  const P = sim.P, m = sim.m, SW = sim.sweepIndex, start = P.quietEnd + 1;
  let t = 41, sw = null, marks = [], focus = null;
  const acc = {
    trader: { shares: 0, avg: null, result: null, glow: 0 },
    bank: { bought: 0, avg: null, mtm: null, intent: 0, glow: 0 },
    leak: 0,
  };
  let book;
  const bankBlue = 'bank', gold = 'trader';
  const intentLine = (a) => ({ type: 'vline', minute: start, color: col(bankBlue), label: 'Банк решил купить', sub: F.clock(sim.sc.sessionStart, start), a, labelLeft: true });

  const traderBuyState = (tt) => {
    const done = clamp(tt - start, 0, P.buyMinutes);
    let shares = 0, cost = 0;
    for (let j = 0; j < P.buyMinutes; j++) {
      const part = clamp(done - j, 0, 1);
      if (part <= 0) break;
      const c = sim.candles[start + j];
      shares += P.traderBuys[j] * part;
      cost += P.traderBuys[j] * part * ((c.open + c.close) / 2);
    }
    return { shares, avg: shares > 0 ? cost / shares : null };
  };

  switch (k) {
    case 0: {
      t = 20 + 21 * u;
      break;
    }
    case 1: {
      t = start;
      marks.push(intentLine(ramp(u, 0, 0.4)));
      acc.bank.intent = ramp(u, 0, 0.35); acc.bank.glow = acc.bank.intent;
      acc.leak = ramp(u, 0.3, 0.75);
      break;
    }
    case 2: {
      t = start + P.buyMinutes * u;
      marks.push(intentLine(1 - 0.5 * ramp(u, 0, 0.3)));
      const b = traderBuyState(t);
      acc.trader.shares = b.shares; acc.trader.avg = b.avg; acc.trader.glow = ramp(u, 0, 0.15) * (1 - ramp(u, 0.92, 1));
      acc.bank.intent = 1; acc.leak = 1 - 0.65 * ramp(u, 0, 0.3);
      break;
    }
    case 3: {
      t = SW; sw = sweepState(sim, 0);
      const a1 = ramp(u, 0, 0.4);
      marks.push(intentLine(0.5 * (1 - ramp(u, 0, 0.3))));
      marks.push({ type: 'hline', price: P.traderAsk, prices: [P.traderAsk], m0: SW - 0.2, color: col(gold), label: `Продажа трейдера ${F.int(m.traderQty)} по ${F.price(P.traderAsk)}`, a: a1, dash: [6, 4], width: 1.5 });
      marks.push({ type: 'dimV', minute: SW + 1.4, p0: P.buyTop, p1: P.traderAsk, prices: [P.traderAsk], label: '+' + F.pct(m.aboveMarket, 1), sub: 'выше рынка', a: ramp(u, 0.35, 0.75) });
      acc.trader.shares = m.traderQty; acc.trader.avg = m.traderAvg; acc.trader.glow = ramp(u, 0, 0.3);
      acc.bank.intent = 1; acc.leak = 0.35;
      book = { traderA: a1 };
      break;
    }
    case 4: {
      t = SW; sw = sweepState(sim, u);
      marks.push({ type: 'hline', price: P.traderAsk, prices: [P.traderAsk], m0: SW - 0.2, color: col(gold), label: `Продажа трейдера ${F.int(m.traderQty)} по ${F.price(P.traderAsk)}`, a: 1 - ramp(u, 0.82, 0.96), dash: [6, 4], width: 1.5 });
      marks.push({ type: 'dimV', minute: SW + 1.4, p0: P.buyTop, p1: P.traderAsk, prices: [P.traderAsk], label: '+' + F.pct(m.aboveMarket, 1), sub: 'выше рынка', a: 1 - ramp(u, 0, 0.12) });
      acc.trader.shares = m.traderQty - sw.traderExec; acc.trader.avg = m.traderAvg;
      acc.trader.result = sw.traderExec > 0 ? sw.traderExec * (P.traderAsk - m.traderAvg) : null;
      acc.trader.glow = ramp(u, 0.45, 0.6);
      acc.bank.bought = sw.V; acc.bank.avg = sw.avg; acc.bank.glow = ramp(u, 0, 0.1);
      acc.bank.intent = 1 - ramp(u, 0, 0.1);
      book = { traderA: 1 - ramp(u, 0.93, 1) };
      break;
    }
    case 5: {
      sw = sweepState(sim, 1); t = SW + u;
      const a = ramp(u, 0.1, 0.5);
      marks.push({ type: 'ring', minute: SW, a, label: `${F.mln(sim.candles[SW].vTotal, 2)} акций за минуту` });
      focus = { from: SW, to: SW + 1, a: ramp(u, 0, 0.4) };
      acc.trader.result = m.traderProfit; acc.trader.avg = m.traderAvg;
      acc.bank.bought = m.bankQty; acc.bank.avg = m.bankAvg;
      break;
    }
    case 6: {
      sw = sweepState(sim, 1); t = SW + 1;
      const a = ramp(u, 0.05, 0.45);
      marks.push({ type: 'hline', price: m.traderAvg, prices: [m.traderAvg], m0: start, m1: SW, color: col(gold), label: `Покупал в среднем по ${F.price(m.traderAvg)}`, labelAlign: 'before', a, dash: [6, 4], width: 1.5 });
      marks.push({ type: 'hline', price: P.traderAsk, prices: [P.traderAsk], m0: start, m1: SW + 1, color: col(gold), label: `Продал банку по ${F.price(P.traderAsk)}`, labelAlign: 'before', a, dash: [6, 4], width: 1.5 });
      marks.push({ type: 'dimV', minute: SW + 1.8, p0: m.traderAvg, p1: P.traderAsk, label: '+' + F.price(P.traderAsk - m.traderAvg) + ' ₽', sub: 'на каждой акции', subShort: 'на акцию', a: ramp(u, 0.3, 0.7) });
      focus = { from: start, to: SW + 1, a: ramp(u, 0, 0.35) * 0.8 };
      acc.trader.result = m.traderProfit; acc.trader.avg = m.traderAvg; acc.trader.glow = ramp(u, 0.2, 0.5);
      acc.bank.bought = m.bankQty; acc.bank.avg = m.bankAvg;
      break;
    }
    case 7: {
      sw = sweepState(sim, 1); t = SW + 1 + (P.totalMinutes - SW - 1) * u;
      const a = ramp(u, 0, 0.35);
      marks.push({ type: 'hline', price: m.bankAvg, prices: [m.bankAvg], m0: SW, color: col(bankBlue), label: `Банк купил в среднем по ${F.price(m.bankAvg)}`, a, dash: [6, 4], width: 1.5 });
      acc.trader.result = m.traderProfit; acc.trader.avg = m.traderAvg;
      acc.bank.bought = m.bankQty; acc.bank.avg = m.bankAvg;
      acc.bank.mtm = (lastPrice(sim, t, sw) - m.bankAvg) * m.bankQty;
      acc.bank.glow = ramp(u, 0.5, 0.9);
      break;
    }
    default: break;
  }

  const price = lastPrice(sim, t, sw);
  let bookState;
  if (k === 3 || k === 4) bookState = deepBook(sim, cap, book.traderA, k === 4 ? sw : null);
  else if (k === 2) bookState = gridBook(sim, price, cap, { from: sim.candles[start].open, to: P.buyTop });
  else bookState = gridBook(sim, price, cap);
  const total = m.bankQty, small = total - m.traderQty;
  const swv = k >= 4 ? sw : null;
  bookState.price = price;
  bookState.bank = { a: k === 4 ? ramp(u, 0, 0.1) : k === 5 ? 1 - ramp(u, 0.5, 0.9) : 0, V: swv ? swv.V : 0, total };
  bookState.split = {
    a: k === 4 ? ramp(u, 0.04, 0.16) : k === 5 ? 1 : k === 6 ? 1 - ramp(u, 0.6, 0.95) : 0,
    small: swv ? swv.smallExec / small : 0,
    trader: swv ? swv.traderExec / m.traderQty : 0,
    smallShare: 1 - m.traderShare, traderShare: m.traderShare,
  };

  const x1 = Math.min(P.totalMinutes + 0.5, Math.max(41.5, t + 8.5));
  const chart = { t, sweep: sw, x0: -0.5, x1, marks, focus, lastTag: true, modes: { candles: 1, hist: 0, timeline: 0 } };
  return { chart, book: bookState, acc };
}

// ---------- акт II: детекция ----------
const DET = [
  { d: [35.5, 55.5], mode: 'candles' },
  { d: [35.5, 55.5], mode: 'hist' },
  { d: [35.5, 55.5], mode: 'timeline' },
  { d: [29.5, 49.5], mode: 'candles' },
  { d: [33.5, 49.5], mode: 'candles' },
  { d: [29.5, 52.5], mode: 'candles' },
  { d: [27.5, 62.5], mode: 'candles' },
];

function detMarks(sim, k, a) {
  const P = sim.P, m = sim.m, SW = sim.sweepIndex, start = P.quietEnd + 1;
  const out = { marks: [], focus: null };
  switch (k) {
    case 0:
      out.focus = { from: SW, to: SW + 1, a: a * 0.85 };
      out.marks.push({ type: 'hline', price: m.bestAskBefore, prices: [m.bestAskBefore], m0: SW - 7, m1: SW + 3, color: col('fg'), label: `Лучшая цена до заявки, ${F.price(m.bestAskBefore)}`, labelBelow: true, labelAlign: 'left', a });
      out.marks.push({ type: 'hline', price: m.bankAvg, prices: [m.bankAvg], m0: SW - 7, m1: SW + 3, color: col('bank'), label: `Средняя цена банка, ${F.price(m.bankAvg)}`, labelAlign: 'left', a, width: 1.5 });
      out.marks.push({ type: 'dimV', minute: SW + 3.8, p0: m.bestAskBefore, p1: m.bankAvg, label: '+' + F.pct(m.slippage, 1), sub: 'проскальзывание', a });
      break;
    case 3:
      out.focus = { from: start, to: start + P.buyMinutes, a: a * 0.8 };
      out.marks.push({ type: 'bracket', from: start, to: start + P.buyMinutes, label: `${P.buyMinutes} мин`, a });
      out.marks.push({ type: 'inset', a, grow: a, rows: [
        { label: 'Обычно, акций в минуту', value: P.medianVolume, text: F.int(P.medianVolume), color: col('vol') },
        { label: 'В окне схемы, в среднем', value: P.medianVolume + P.traderPerMinute, text: `${F.int(P.medianVolume + P.traderPerMinute)}   ×${F.ratio(m.turnoverRatio)}`, color: col('trader') },
      ] });
      break;
    case 4:
      out.focus = { from: start, to: start + P.buyMinutes, a: a * 0.8 };
      out.marks.push({ type: 'chevrons', from: start, to: start + P.buyMinutes, label: 'Агрессор: покупатель', a });
      break;
    case 5:
      out.focus = { from: start, to: SW + 1, a: a * 0.7 };
      out.marks.push({ type: 'vline', minute: start, color: col('fg'), label: F.clock(sim.sc.sessionStart, start), sub: 'начало схемы', labelLeft: true, a });
      break;
    case 6:
      out.marks.push({ type: 'band', keepAlt: true, m0: start, m1: SW + 1, p0: m.preScheme, p1: m.bankAvg, prices: [m.preScheme, m.bankAvg], color: col('breach'), fill: 0.22, a,
        label: F.rub(m.bankLoss, 2), sub: `(${F.price(m.bankAvg)} − ${F.price(m.preScheme)}) × ${F.int(m.bankQty)}`, subLines: [`(${F.price(m.bankAvg)} − ${F.price(m.preScheme)})`, `× ${F.int(m.bankQty)}`], labelAt: 'left' });
      out.marks.push({ type: 'hline', keepAlt: true, price: m.preScheme, prices: [m.preScheme], color: col('fg'), label: `Цена до схемы, ${F.price(m.preScheme)}`, labelBelow: true, labelAlign: 'right', a });
      out.marks.push({ type: 'hline', keepAlt: true, price: m.bankAvg, prices: [m.bankAvg], m0: start, color: col('bank'), label: `Цена покупки банка, ${F.price(m.bankAvg)}`, labelAlign: 'right', a, width: 1.5 });
      break;
    default: break;
  }
  return out;
}

// alt — доля контрфакта «без схемы» (0..1): свечи и разметка схемы растворяются, остаётся то, что было бы без трейдера
export function detectFrame(sim, k, u, alt = 0) {
  const prev = k > 0 ? DET[k - 1] : { d: [-0.5, sim.P.totalMinutes + 0.5], mode: 'candles' };
  const cur = DET[k];
  const tr = ramp(u, 0, 0.35);
  const x0 = lerp(prev.d[0], cur.d[0], tr), x1 = lerp(prev.d[1], cur.d[1], tr);
  const modes = { candles: 0, hist: 0, timeline: 0 };
  modes[prev.mode] += 1 - tr; modes[cur.mode] += tr;
  const a = ramp(u, 0.3, 0.6);
  const now = detMarks(sim, k, a);
  const before = k > 0 ? detMarks(sim, k - 1, 1 - ramp(u, 0, 0.25)) : { marks: [], focus: null };
  const marks = [...before.marks, ...now.marks].map((mk) => (mk.keepAlt || alt <= 0 ? mk : { ...mk, a: (mk.a ?? 1) * (1 - alt) }));
  if (alt > 0.01) {
    const P = sim.P, m = sim.m, start = P.quietEnd + 1;
    marks.push({ type: 'hline', price: m.bankAvgCf, prices: [m.bankAvgCf], m0: start - 0.3, m1: start + m.cfMinutes + 0.3, color: col('bank'), width: 1.5, dash: [6, 4],
      label: `Без схемы банк купил бы по ${F.price(m.bankAvgCf)}`, labelShort: `Банк купил бы по ${F.price(m.bankAvgCf)}`, labelAlign: 'left', a: alt });
    marks.push({ type: 'bracket', from: start, to: start + m.cfMinutes, label: `${m.cfMinutes} мин спокойного рынка`, labelShort: `${m.cfMinutes} мин`, a: alt, set: 'cf', small: true });
  }
  const focus = alt > 0.5 ? null : (now.focus && now.focus.a > 0.01 ? now.focus : before.focus);
  const chart = {
    t: sim.P.totalMinutes, sweep: null, x0, x1, marks, focus, lastTag: false, modes, alt, topInset: 34,
    histGrow: k === 1 ? ramp(u, 0.15, 0.55) : 1, histMarks: k === 1 ? ramp(u, 0.4, 0.6) : 1, histTrader: k === 1 ? ramp(u, 0.5, 0.7) : 1, histDim: k === 1 ? ramp(u, 0.65, 0.85) : 1,
    tlTrader: k === 2 ? ramp(u, 0.3, 0.5) : 1, tlBank: k === 2 ? ramp(u, 0.42, 0.62) : 1, tlDim: k === 2 ? ramp(u, 0.6, 0.8) : 1,
  };
  return { chart };
}

export { setPalette } from './palette.js';
