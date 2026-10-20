// Модель торгов по сценарию. Детерминирована (seed), поэтому кадр всегда одинаковый.
import { quantile, median, bin } from 'd3-array';
import * as F from './fmt.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  let u = 0, v = 0;
  while (!u) u = r();
  while (!v) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const r2 = (x) => Math.round(x * 100) / 100;

// Внутриминутный путь цены: open → экстремум → экстремум → close
function pathFor(r, open, close, high, low) {
  const upFirst = r() < 0.5;
  return upFirst ? [open, high, low, close] : [open, low, high, close];
}

export function simulate(sc) {
  const P = sc.params;
  const r = mulberry32(sc.seed);
  const candles = [];
  const base = P.basePrice;

  // 1. Боковик
  const rawVol = [];
  for (let i = 0; i <= P.quietEnd; i++) {
    const open = i === 0 ? base : candles[i - 1].close;
    const close = i === P.quietEnd ? base : r2(open + 0.35 * (base - open) + gauss(r) * 0.07);
    const high = r2(Math.max(open, close) + Math.abs(gauss(r)) * 0.035 + 0.01);
    const low = r2(Math.min(open, close) - Math.abs(gauss(r)) * 0.035 - 0.01);
    rawVol.push(Math.exp(Math.log(P.medianVolume) + gauss(r) * 0.38));
    candles.push({ i, open, close, high, low, vMarket: 0, vTrader: 0, vBank: 0, phase: 'quiet' });
  }
  const k = P.medianVolume / median(rawVol);
  candles.forEach((c, i) => { c.vMarket = Math.round((rawVol[i] * k) / 100) * 100; });

  // 2. Скупка трейдера
  const traderFills = [];
  const buys = P.traderBuys || Array.from({ length: P.buyMinutes }, () => P.traderPerMinute);
  for (let j = 1; j <= P.buyMinutes; j++) {
    const i = P.quietEnd + j;
    const open = candles[i - 1].close;
    const target = base + (j / P.buyMinutes) * (P.buyTop - base);
    const close = j === P.buyMinutes ? P.buyTop : r2(target + gauss(r) * 0.03);
    const high = r2(close + 0.03), low = r2(open - 0.02);
    const vwap = r2((open + close) / 2);
    traderFills.push({ i, qty: buys[j - 1], price: vwap });
    candles.push({ i, open, close, high, low, vMarket: P.medianVolume, vTrader: buys[j - 1], vBank: 0, phase: 'buy' });
  }
  const traderQty = traderFills.reduce((s, f) => s + f.qty, 0);
  P.traderBuys = buys;
  P.traderPerMinute = traderQty / P.buyMinutes; // средний темп, для сравнения оборотов
  const traderAvg = traderFills.reduce((s, f) => s + f.qty * f.price, 0) / traderQty;

  // 3. Заявка банка сметает стакан
  const sweepIndex = P.quietEnd + P.buyMinutes + 1;
  const smallTotal = P.smallAsks.reduce((s, [, q]) => s + q, 0);
  const bankQty = P.bankQty;
  if (smallTotal + traderQty !== bankQty) console.warn('Сценарий: объём банка не сходится со стаканом', smallTotal + traderQty, bankQty);
  const bankCost = P.smallAsks.reduce((s, [p, q]) => s + p * q, 0) + traderQty * P.traderAsk;
  const bankAvg = bankCost / bankQty;
  const sweepOpen = P.buyTop;
  candles.push({
    i: sweepIndex, open: sweepOpen, close: P.sweepClose, high: P.traderAsk, low: r2(sweepOpen - 0.02),
    vMarket: P.sweepPreVolume, vTrader: traderQty, vBank: smallTotal, phase: 'sweep', sweep: true,
  });
  // уровни, которые съедает заявка банка (снизу вверх), с накопленным объёмом
  const levels = [];
  let acc = 0;
  for (const [p, q] of P.smallAsks) { levels.push({ price: p, qty: q, from: acc, to: acc + q, trader: false }); acc += q; }
  levels.push({ price: P.traderAsk, qty: traderQty, from: acc, to: acc + traderQty, trader: true });

  // 4. Откат
  for (let i = sweepIndex + 1; i < P.totalMinutes; i++) {
    const open = candles[i - 1].close;
    const close = r2(P.rollTo + (open - P.rollTo) * 0.8 + gauss(r) * 0.05);
    const high = r2(Math.max(open, close) + Math.abs(gauss(r)) * 0.05 + 0.01);
    const low = r2(Math.min(open, close) - Math.abs(gauss(r)) * 0.05 - 0.01);
    const v = (P.medianVolume + 55000 * Math.exp(-(i - sweepIndex - 1) / 4)) * (0.8 + r() * 0.4);
    candles.push({ i, open, close, high, low, vMarket: Math.round(v / 100) * 100, vTrader: 0, vBank: 0, phase: 'roll' });
  }
  candles.forEach((c) => {
    c.path = pathFor(r, c.open, c.close, c.high, c.low);
    c.vTotal = c.vMarket + c.vTrader + c.vBank;
  });

  // 4б. Контрфакт: та же заявка банка, но без трейдера. Рынок остаётся в боковике,
  // банк набирает позицию пассивными заявками по цене до схемы за несколько минут.
  const rc = mulberry32(sc.seed + 1);
  const CF = P.counterfactual || { minutes: 7 };
  const cf = candles.slice(0, P.quietEnd + 1).map((c) => ({ ...c }));
  const perMin = Math.floor(bankQty / CF.minutes / 1000) * 1000;
  for (let i = P.quietEnd + 1; i < P.totalMinutes; i++) {
    const open = cf[i - 1].close;
    const close = r2(open + 0.35 * (base - open) + gauss(rc) * 0.07);
    const high = r2(Math.max(open, close) + Math.abs(gauss(rc)) * 0.035 + 0.01);
    let low = r2(Math.min(open, close) - Math.abs(gauss(rc)) * 0.035 - 0.01);
    const j = i - (P.quietEnd + 1);
    const vBank = j < CF.minutes ? (j === CF.minutes - 1 ? bankQty - perMin * (CF.minutes - 1) : perMin) : 0;
    if (vBank > 0) low = Math.min(low, r2(base - 0.01));
    const vMarket = Math.round(Math.exp(Math.log(P.medianVolume) + gauss(rc) * 0.38) / 100) * 100;
    cf.push({ i, open, close, high, low, vMarket, vTrader: 0, vBank, phase: 'cf' });
  }
  cf.forEach((c) => {
    if (!c.path) c.path = pathFor(rc, c.open, c.close, c.high, c.low);
    c.vTotal = c.vMarket + c.vTrader + c.vBank;
  });

  // 5. История размеров сделок (для перцентиля)
  const H = P.tradeHistory;
  const sizes = Array.from({ length: H.count }, () => Math.max(1, Math.round(Math.exp(Math.log(H.median) + gauss(r) * H.sigma))));
  sizes.sort((a, b) => a - b);
  const p99 = quantile(sizes, 0.99);
  const logSizes = sizes.map((s) => Math.log10(s));
  const hist = bin().domain([0, 7]).thresholds(Array.from({ length: 70 }, (_, j) => j / 10))(logSizes)
    .map((b) => ({ x0: b.x0, x1: b.x1, n: b.length }));

  // 6. Время подачи заявок (секунды относительно заявки банка)
  const orderTimes = P.smallAskAges.map((age, j) => ({ t: -age, qty: P.smallAsks[j % P.smallAsks.length][1], who: 'market' }));
  orderTimes.push({ t: -P.traderLeadSeconds, qty: traderQty, who: 'trader' });
  orderTimes.push({ t: 0, qty: bankQty, who: 'bank' });

  // Метрики
  const preScheme = candles[P.quietEnd].close;
  const bestAskBefore = P.smallAsks[0][0];
  const finalClose = candles[candles.length - 1].close;
  const sweepCandle = candles[sweepIndex];
  const windowTurnover = P.medianVolume + P.traderPerMinute;
  const m = {
    preScheme, traderQty, traderAvg, bankQty, bankAvg, bestAskBefore, finalClose,
    traderProfit: (P.traderAsk - traderAvg) * traderQty,
    bankLoss: (bankAvg - preScheme) * bankQty,
    bankMtm: (finalClose - bankAvg) * bankQty,
    slippage: bankAvg / bestAskBefore - 1,
    traderShare: traderQty / bankQty,
    aboveMarket: P.traderAsk / P.buyTop - 1,
    bigVolRatio: sweepCandle.vTotal / P.medianVolume,
    turnoverRatio: windowTurnover / P.medianVolume,
    historicalMinutes: traderQty / P.medianVolume,
    p99, counterRatio: traderQty / p99,
    startMinute: P.quietEnd + 1,
    sweepIndex,
    bankAvgCf: base,
    cfMinutes: CF.minutes,
  };

  const vars = {
    traderShare: F.pct(m.traderShare, 0),
    bigVolRatio: F.ratio(Math.round(m.bigVolRatio / 10) * 10),
    traderAvg: F.price(m.traderAvg),
    traderAsk: F.price(P.traderAsk),
    slippage: F.pct(m.slippage, 1),
    counterRatio: F.ratio(Math.round(m.counterRatio / 10) * 10),
    leadSeconds: String(P.traderLeadSeconds),
    traderQtyShort: F.mln(traderQty, 2),
    historicalTime: F.duration(m.historicalMinutes),
    historicalTimeRound: F.durationRound(m.historicalMinutes),
    buyMinutes: String(P.buyMinutes),
    turnoverRatio: F.ratio(m.turnoverRatio),
    startTime: F.clock(sc.sessionStart, m.startMinute),
    bankLossShort: F.rub(m.bankLoss, 2),
    bankQtyFull: F.int(bankQty),
    traderQtyFull: F.int(traderQty),
    traderProfit: F.rub(m.traderProfit, 2),
  };

  return { sc, P, candles, cf, levels, sizes, hist, orderTimes, m, vars, sweepIndex };
}

// Размер «фоновой» заявки на уровне цены — стабилен для одного и того же уровня.
export function levelSize(price) {
  const k = Math.round(price * 100);
  const h = Math.sin(k * 12.9898) * 43758.5453;
  return Math.round((14000 + (h - Math.floor(h)) * 26000) / 1000) * 1000;
}
