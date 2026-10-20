// Модель торгов для схемы «Занижение цены перед крупной сделкой»: три торговые недели по часовым свечам,
// отраслевой индекс, продажи инвесткомпании, встречные счета, ликвидность (спред и глубина стакана),
// крупная сделка вне основных торгов и восстановление. Детерминирована (seed).
import { bin } from 'd3-array';
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
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

function pathFor(r, open, close, high, low) {
  return r() < 0.5 ? [open, high, low, close] : [open, low, high, close];
}

export function simulate(sc) {
  const P = sc.params;
  const r = mulberry32(sc.seed);
  const B = P.barsPerDay, N = P.days * B;
  const q0 = P.quietDays * B;            // первый бар продаж
  const q1 = q0 + P.sellDays * B;        // первый бар после недели продаж (день крупной сделки)
  const base = P.basePrice;
  const candles = [];
  const other = [];                       // остальной рынок (индекс без этой бумаги), уровень
  const spread = [], depth = [];          // ликвидность по барам: спред в ₽, глубина уровня (акций)

  // дневные закрытия: боковик → линейное снижение до dropTo → восстановление до recoverTo
  const dayClose = [];
  for (let d = 0; d < P.days; d++) {
    if (d < P.quietDays) dayClose.push(null);
    else if (d < P.quietDays + P.sellDays) dayClose.push(r2(base + (P.dropTo - base) * ((d - P.quietDays + 1) / P.sellDays)));
    else dayClose.push(r2(P.dropTo + (P.recoverTo - P.dropTo) * ((d - q1 / B + 1) / (P.days - q1 / B))));
  }

  const dailyOthers = P.baseHourVolume * B;
  const perDaySold = P.soldOnExchange / P.sellDays;
  let oth = base;
  for (let i = 0; i < N; i++) {
    const d = Math.floor(i / B), h = i % B;
    const open = i === 0 ? base : candles[i - 1].close;
    const phase = i < q0 ? 'quiet' : i < q1 ? 'sell' : 'recover';
    // остальной рынок: мягкий случайный ход вокруг 100
    oth = oth + 0.06 * (base - oth) + gauss(r) * 0.16;
    other.push(r2(oth));
    let close, vSeller = 0, vMarket, sp, dp;
    if (phase === 'quiet') {
      // бумага ходит с остальным рынком (бета 1) плюс своя часть; разрыв с рынком затягивается
      const ret = (other[i] - (i ? other[i - 1] : base)) + 0.1 * (other[i] - open) + gauss(r) * 0.12;
      close = r2(open + ret);
      vMarket = Math.round(P.baseHourVolume * (0.55 + r() * 0.9) / 100) * 100;
      sp = r() < 0.8 ? P.spreadBase : P.spreadBase * 2;
      dp = P.depthBase * (0.8 + r() * 0.4);
    } else if (phase === 'sell') {
      const dayStart = h === 0 ? open : candles[i - h].open;
      const target = dayClose[d];
      const wCum = P.hourWeights.slice(0, h + 1).reduce((s, w) => s + w, 0);
      // снижение внутри дня идёт пропорционально объёму продаж участника в этот час
      close = h === B - 1 ? target : r2(dayStart + (target - dayStart) * wCum + gauss(r) * 0.06);
      vSeller = Math.round(perDaySold * P.hourWeights[h] / 1000) * 1000;
      vMarket = Math.round(P.baseHourVolume * (0.6 + r() * 0.8) / 100) * 100;
      const k = (i - q0 + 1) / (q1 - q0);
      sp = r2(Math.round((P.spreadBase + (P.spreadPeak - P.spreadBase) * Math.min(1, k * 1.15)) / P.tick) * P.tick);
      dp = (P.depthBase + (P.depthPeak - P.depthBase) * Math.min(1, k * 1.1)) * (0.85 + r() * 0.3);
    } else {
      const dayStart = h === 0 ? open : candles[i - h].open;
      const target = dayClose[d];
      close = h === B - 1 ? target : r2(dayStart + (target - dayStart) * ((h + 1) / B) + gauss(r) * 0.08);
      const k = (i - q1) / (N - q1);
      vMarket = Math.round(P.baseHourVolume * (1.9 - 1.1 * k) * (0.6 + r() * 0.8) / 100) * 100;
      sp = r2(Math.round((P.spreadPeak + (P.spreadBase - P.spreadPeak) * Math.min(1, k * 1.4)) / P.tick) * P.tick);
      dp = (P.depthPeak + (P.depthBase * 0.85 - P.depthPeak) * Math.min(1, k * 1.3)) * (0.85 + r() * 0.3);
    }
    const high = r2(Math.max(open, close) + Math.abs(gauss(r)) * 0.06 + 0.02);
    const low = r2(Math.min(open, close) - Math.abs(gauss(r)) * 0.06 - 0.02);
    spread.push(sp); depth.push(Math.round(dp / 100) * 100);
    const vMatched = Math.round(vSeller * P.matchedShare / 1000) * 1000;
    candles.push({ i, d, h, open, close, high, low, vMarket, vSeller, vMatched, vBank: 0, vTrader: 0, phase });
  }
  // спокойная неделя заканчивается ровно на 100 и у бумаги, и у остального рынка: снимаем линейный тренд
  const driftS = base - candles[q0 - 1].close, driftO = base - other[q0 - 1];
  for (let i = 0; i < q0; i++) {
    const c = candles[i], w = (i + 1) / q0, wPrev = i / q0;
    c.open = r2(c.open + driftS * wPrev); c.close = r2(c.close + driftS * w);
    c.high = r2(Math.max(c.high + driftS * w, c.open, c.close)); c.low = r2(Math.min(c.low + driftS * w, c.open, c.close));
    other[i] = r2(other[i] + driftO * w);
  }
  // корректируем объёмы: за неделю продано ровно soldOnExchange, а остальные участники наторговали
  // ровно столько, чтобы доля продавца в обороте была sellShare
  const soldRaw = candles.reduce((s, c) => s + c.vSeller, 0);
  if (soldRaw !== P.soldOnExchange) candles[q1 - 1].vSeller += P.soldOnExchange - soldRaw;
  const othersWant = Math.round(P.soldOnExchange / P.sellShare - P.soldOnExchange);
  const othersRaw = candles.slice(q0, q1).reduce((s, c) => s + c.vMarket, 0);
  for (const c of candles.slice(q0, q1)) c.vMarket = Math.round(c.vMarket * othersWant / othersRaw / 100) * 100;
  const othersNow = candles.slice(q0, q1).reduce((s, c) => s + c.vMarket, 0);
  candles[q1 - 1].vMarket += othersWant - othersNow;
  const matchedRaw = candles.reduce((s, c) => s + c.vMatched, 0);
  const matchedWant = Math.round(P.soldOnExchange * P.matchedShare);
  if (matchedRaw !== matchedWant) candles[q1 - 1].vMatched += matchedWant - matchedRaw;
  candles.forEach((c) => {
    c.path = pathFor(r, c.open, c.close, c.high, c.low);
    c.vTotal = c.vMarket + c.vSeller;
  });
  const index = candles.map((c, i) => r2((1 - P.indexWeight) * other[i] + P.indexWeight * c.close));

  // сделки участника по барам: цена исполнения ≈ середина бара, агрессивная доля, встречный счёт
  const fills = [];
  for (const c of candles) {
    if (!c.vSeller) continue;
    fills.push({ i: c.i, qty: c.vSeller, price: r2((c.open + c.close) / 2), aggressive: Math.round(c.vSeller * P.aggressorShare), matched: c.vMatched, account: c.h % 2 === 0 ? 0 : 1 });
  }
  const sold = fills.reduce((s, f) => s + f.qty, 0);
  const soldAvg = fills.reduce((s, f) => s + f.qty * f.price, 0) / sold;
  const rest = P.position - sold;

  // история: пятидневное отклонение бумаги от индекса за прошлые периоды
  const rh = mulberry32(sc.seed + 7);
  const H = P.history;
  const windows = Array.from({ length: H.windows }, () => gauss(rh) * H.sigma);
  const hist = bin().domain([-0.1, 0.1]).thresholds(Array.from({ length: 41 }, (_, j) => -0.1 + j * 0.005))(windows)
    .map((b) => ({ x0: b.x0, x1: b.x1, n: b.length }));

  // метрики
  const weekOthers = candles.slice(q0, q1).reduce((s, c) => s + c.vMarket, 0);
  const weekTurnover = weekOthers + sold;
  const drop = P.dropTo / base - 1;
  const indexChange = index[q1 - 1] / base - 1;
  const relative = drop - indexChange;
  const quietSpread = spread.slice(0, q0).reduce((s, x) => s + x, 0) / q0;
  const peakSpread = Math.max(...spread.slice(q0, q1));
  const quietDepth = depth.slice(0, q0).reduce((s, x) => s + x, 0) / q0;
  const endDepth = depth.slice(q1 - B, q1).reduce((s, x) => s + x, 0) / B;
  const blockQty = rest, blockValue = rest * P.blockPrice, valueBefore = rest * base;
  const m = {
    N, B, q0, q1, sold, soldAvg, rest, blockQty, blockValue, valueBefore,
    diff: valueBefore - blockValue,
    fundGain: rest * (P.recoverTo - P.blockPrice),
    dailyTurnover: dailyOthers, weekTurnover, weekOthers,
    sellShare: sold / weekTurnover,
    drop, indexChange, relative,
    quietSpread, peakSpread, spreadX: peakSpread / P.spreadBase,
    quietDepth, endDepth, depthDrop: 1 - endDepth / quietDepth,
    aggressive: fills.reduce((s, f) => s + f.aggressive, 0),
    matched: fills.reduce((s, f) => s + f.matched, 0),
    sigma: Math.abs(relative) / H.sigma,
    blockRatio: blockQty / dailyOthers,
    typicalTopShare: P.typicalTopShare,
    blockBar: q1,
  };
  m.aggressorShare = m.aggressive / sold;
  m.matchedShare = m.matched / sold;

  const vars = {
    dailyTurnover: F.int(m.dailyTurnover),
    positionFull: F.int(P.position),
    basePrice: F.price(base),
    soldFull: F.int(sold),
    restFull: F.int(rest),
    dropPct: F.pct(-drop, 0),
    indexPct: F.pct(-indexChange, 0),
    sharePct: F.pct(m.sellShare, 0),
    blockPrice: F.price(P.blockPrice),
    blockValue: F.rub(blockValue, 0),
    recoverPrice: F.price(P.recoverTo),
    fundGain: F.rub(m.fundGain, 0),
    lossShort: F.rub(m.diff, 0),
    valueBefore: F.rub(valueBefore, 0),
    sellDays: String(P.sellDays),
    spreadX: F.ratio(Math.round(m.spreadX)),
    depthDrop: F.pct(Math.round(m.depthDrop * 20) / 20, 0),
    aggrPct: F.pct(m.aggressorShare, 0),
    matchedPct: F.pct(m.matchedShare, 0),
    clipFull: F.int(P.clip),
    sigma: F.ratio(Math.round(m.sigma)),
    blockRatio: F.ratio(Math.round(m.blockRatio)),
    typicalTopShare: F.pct(m.typicalTopShare, 0),
    soldAvg: F.price(soldAvg),
    weekTurnover: F.int(weekTurnover),
  };

  return { sc, P, candles, index, other, spread, depth, fills, hist, windows, m, vars };
}

// Стакан в момент t (бар с дробной частью): уровни от лучшего бида с текущим спредом и глубиной
export function bookAt(sim, t, levels = 6) {
  const P = sim.P;
  const i = clamp(Math.floor(t), 0, sim.candles.length - 1);
  const c = sim.candles[i];
  const f = clamp(t - i);
  const seg = f * 3, k = Math.min(2, Math.floor(seg));
  const px = f >= 1 ? c.close : f <= 0 ? c.open : c.path[k] + (c.path[k + 1] - c.path[k]) * (seg - k);
  const sp = sim.spread[i], dp = sim.depth[i];
  const tick = P.tick;
  const bid = Math.floor((px - sp / 2) / tick + 1e-6) * tick;
  const ask = bid + sp;
  const size = (p, side) => { const q = Math.round(dp * (0.7 + 0.6 * frac(p * 7 + side)) / 100) * 100; return q; };
  const asks = [], bids = [];
  for (let j = levels - 1; j >= 0; j--) { const p = r2(ask + j * tick); asks.push({ key: 'a' + p.toFixed(2), side: 'ask', price: p, qty: size(p, 1), hit: 0 }); }
  for (let j = 0; j < levels; j++) { const p = r2(bid - j * tick); bids.push({ key: 'b' + p.toFixed(2), side: 'bid', price: p, qty: size(p, 2), hit: 0 }); }
  return { asks, bids, price: r2(px), spread: sp, depth: dp, maxQty: sim.P.depthBase * 1.3 };
}
function frac(x) { const h = Math.sin(x * 12.9898) * 43758.5453; return h - Math.floor(h); }
