// Рендер графика на Canvas 2D: свечи, объёмы, разметка ТАФС, гистограмма размеров сделок, шкала времени заявок.
import { scaleLinear } from 'd3-scale';
import * as F from './fmt.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

export function cssVars(names) {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const n of names) out[n] = cs.getPropertyValue('--' + n).trim();
  return out;
}

// Состояние заявки банка при прогрессе исполнения e (0..1)
export function sweepState(sim, e) {
  const total = sim.m.bankQty;
  const small = total - sim.m.traderQty;
  let V;
  if (e <= 0) V = 0;
  else if (e < 0.45) V = small * (e / 0.45);
  else if (e < 0.9) V = small + sim.m.traderQty * ((e - 0.45) / 0.45);
  else V = total;
  let price = null, cost = 0, idx = -1;
  for (let j = 0; j < sim.levels.length; j++) {
    const L = sim.levels[j];
    const took = clamp(V - L.from, 0, L.qty);
    if (took > 0) { price = L.price; cost += took * L.price; idx = j; }
  }
  const traderExec = Math.max(0, V - small);
  return { e, V, price, idx, cost, avg: V > 0 ? cost / V : null, smallExec: Math.min(V, small), traderExec, done: V >= total };
}

export function createChart(canvas, sim, opts = {}) {
  const ctx = canvas.getContext('2d');
  const C = cssVars(['fg', 'fg-2', 'fg-3', 'line', 'line-2', 'trader', 'bank', 'accent', 'breach', 'candle-up', 'candle-down', 'vol', 'panel', 'panel-2', 'bg']);
  const FONT = '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
  const reduce = !!opts.reduce;
  // сегменты объёма свечи: [{q, color, alpha?, overlay?}] — overlay рисуется поверх предыдущего сегмента от его основания
  const volumes = opts.volumes || ((c, s) => [{ q: s.vM, color: C.vol }, { q: s.vB, color: C.bank }, { q: s.vT, color: C.trader }]);
  // подписи оси времени: [{x, label, line?}]
  const xTicks = opts.xTicks || ((x0, x1, narrow) => {
    const span = x1 - x0, every = span > 40 ? 15 : span > 18 ? 5 : 2, out = [];
    for (let mnt = Math.ceil(x0 / every) * every; mnt <= x1; mnt += every) out.push({ x: mnt, label: F.clock(sim.sc.sessionStart, mnt) });
    return out;
  });
  let W = 0, H = 0, dpr = 1;
  let view = null;
  const smooth = { p: null, v: null };
  let raf = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(10, r.width); H = Math.max(10, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (view) paint(true);
  }

  function set(v) { view = v; paint(false); }

  function paint(snap) {
    cancelAnimationFrame(raf);
    const again = draw(snap || reduce);
    if (again) raf = requestAnimationFrame(() => paint(false));
  }

  // ---------- свечи ----------
  function candleAt(c, t, sw) {
    if (c.sweep) {
      if (t < c.i) return null;
      const s = sw || { V: sim.m.bankQty, done: true, price: sim.P.traderAsk };
      if (s.V <= 0) return null;
      const px = s.done ? sim.P.traderAsk : s.price;
      const close = s.done ? lerp(sim.P.traderAsk, c.close, clamp(t - c.i)) : px;
      const vB = Math.min(s.V, c.vBank), vT = Math.max(0, s.V - c.vBank);
      return { o: c.open, h: Math.max(c.open, px), l: c.low, c: close, vM: c.vMarket, vB, vT };
    }
    if (t <= c.i) return null;
    const f = Math.min(1, t - c.i);
    if (f >= 1) return { o: c.open, h: c.high, l: c.low, c: c.close, vM: c.vMarket, vB: c.vBank, vT: c.vTrader, f: 1 };
    const seg = f * 3, k = Math.min(2, Math.floor(seg)), u = seg - k;
    const cur = lerp(c.path[k], c.path[k + 1], u);
    let hi = c.open, lo = c.open;
    for (let j = 1; j <= k; j++) { hi = Math.max(hi, c.path[j]); lo = Math.min(lo, c.path[j]); }
    hi = Math.max(hi, cur); lo = Math.min(lo, cur);
    return { o: c.open, h: hi, l: lo, c: cur, vM: c.vMarket * f, vB: c.vBank * f, vT: c.vTrader * f, f };
  }

  // значение ряда (например, индекса) в момент t: между закрытиями соседних баров
  function seriesAt(arr, t) {
    const i = Math.floor(t);
    if (i < 0) return arr[0];
    if (i >= arr.length - 1) return arr[arr.length - 1];
    const prev = i === 0 ? sim.P.basePrice : arr[i - 1];
    return lerp(prev, arr[i], clamp(t - i));
  }

  function text(str, x, y, { size = 12, weight = 500, color = C['fg-2'], align = 'left', base = 'alphabetic', halo = true, alpha = 1 } = {}) {
    if (alpha <= 0.01) return 0;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = base;
    if (halo) { ctx.lineWidth = 4; ctx.strokeStyle = C.bg; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Размерная линия (как на чертеже): отрезок с засечками и подпись
  function dimV(x, y0, y1, label, alpha, color = C.fg, labelSide = 'right', big = true) {
    if (alpha <= 0.01) return;
    ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = 1.25;
    const top = Math.min(y0, y1), bot = Math.max(y0, y1);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot);
    ctx.moveTo(x - 6, top); ctx.lineTo(x + 6, top); ctx.moveTo(x - 6, bot); ctx.lineTo(x + 6, bot); ctx.stroke();
    // стрелки внутрь
    ctx.beginPath(); ctx.moveTo(x - 3.5, top + 6); ctx.lineTo(x, top + 1); ctx.lineTo(x + 3.5, top + 6);
    ctx.moveTo(x - 3.5, bot - 6); ctx.lineTo(x, bot - 1); ctx.lineTo(x + 3.5, bot - 6); ctx.stroke();
    ctx.restore();
    const lx = labelSide === 'right' ? x + 12 : x - 12;
    text(label, lx, (top + bot) / 2, { size: big ? 22 : 14, weight: 650, color: C.fg, align: labelSide === 'right' ? 'left' : 'right', base: 'middle', alpha });
  }

  function dimH(x0, x1, y, label, alpha, color = C.fg, size = 18) {
    if (alpha <= 0.01) return;
    ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = 1.25;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.moveTo(x0, y - 6); ctx.lineTo(x0, y + 6); ctx.moveTo(x1, y - 6); ctx.lineTo(x1, y + 6); ctx.stroke();
    ctx.restore();
    text(label, (x0 + x1) / 2, y - 10, { size, weight: 650, color: C.fg, align: 'center', alpha });
  }

  function dashed(x0, y0, x1, y1, color, alpha, dash = [4, 4], width = 1) {
    if (alpha <= 0.01) return;
    ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  }

  // ---------- основной кадр ----------
  function draw(snap) {
    const v = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const narrow = W < 560;
    const pad = { l: narrow ? 10 : 18, r: narrow ? 50 : 66, t: narrow ? 22 : 30, b: narrow ? 24 : 30 };
    const modes = v.modes || { candles: 1, hist: 0, timeline: 0 };
    let again = false;
    if (modes.candles > 0.01) again = drawCandles(v, pad, narrow, snap, modes.candles) || again;
    if (modes.hist > 0.01) drawHist(v, pad, narrow, modes.hist);
    if (modes.timeline > 0.01) drawTimeline(v, pad, narrow, modes.timeline);
    if (modes.heat > 0.01) drawHeat(v, pad, narrow, modes.heat);
    if (modes.dist > 0.01) drawDist(v, pad, narrow, modes.dist);
    if (modes.graph > 0.01) drawGraph(v, pad, narrow, modes.graph);
    return again;
  }

  function drawCandles(v, pad, narrow, snap, alpha) {
    const cs = sim.candles;
    const sw = v.sweep;
    const x0 = v.x0, x1 = v.x1;
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const priceH = plotH * 0.72, gap = 12, volH = plotH - priceH - gap;
    const xs = scaleLinear().domain([x0, x1]).range([pad.l, pad.l + plotW]);
    const step = plotW / (x1 - x0);

    const collect = (set) => {
      const out = [];
      for (const c of set) {
        if (c.i + 1 < x0 - 1 || c.i > x1 + 1) continue;
        const s = candleAt(c, v.t, c.sweep ? sw : null);
        if (s) out.push([c, s]);
      }
      return out;
    };
    const states = collect(cs);
    const alt = clamp(v.alt || 0);
    const altStates = alt > 0.01 && sim.cf ? collect(sim.cf) : null;
    // целевые домены
    let lo = Infinity, hi = -Infinity, vmax = 1;
    for (const [c, s] of states) {
      if (c.i + 1 < x0 || c.i > x1) continue;
      lo = Math.min(lo, s.l); hi = Math.max(hi, s.h);
      vmax = Math.max(vmax, volumes(c, s, v).reduce((sum, g) => sum + (g.overlay ? 0 : g.q), 0));
    }
    if (!isFinite(lo)) { lo = 99.5; hi = 100.5; }
    const idx = v.index && v.index.a > 0.01 && sim.index ? v.index : null;
    if (idx && idx.domain !== false) {
      for (let i = Math.max(0, Math.floor(x0)); i <= Math.min(sim.index.length - 1, Math.ceil(x1), Math.floor(v.t)); i++) {
        const y = sim.index[i];
        if (y > hi) hi = hi + (y - hi) * idx.a; if (y < lo) lo = lo + (y - lo) * idx.a;
      }
    }
    let elo = lo, ehi = hi;
    for (const mk of v.marks || []) {
      if (!mk.prices) continue;
      const da = clamp(mk.domainA ?? mk.a);
      for (const p of mk.prices) {
        if (p > ehi) ehi = Math.max(ehi, hi + (p - hi) * da);
        if (p < elo) elo = Math.min(elo, lo + (p - lo) * da);
      }
    }
    const range = Math.max(ehi - elo, 1.6);
    if (ehi - elo < 1.6) { const mid = (ehi + elo) / 2; elo = mid - 0.8; ehi = mid + 0.8; }
    const tp = [elo - range * 0.1, ehi + range * 0.16];
    const tv = Math.max(vmax, (opts.minVol || 0)) * 1.12;
    let again = false;
    if (!smooth.p || snap) smooth.p = tp.slice();
    else {
      smooth.p[0] = lerp(smooth.p[0], tp[0], 0.2); smooth.p[1] = lerp(smooth.p[1], tp[1], 0.2);
      if (Math.abs(smooth.p[0] - tp[0]) > 0.002 || Math.abs(smooth.p[1] - tp[1]) > 0.002) again = true;
      else smooth.p = tp.slice();
    }
    if (!smooth.v || snap) smooth.v = tv;
    else {
      smooth.v = lerp(smooth.v, tv, 0.2);
      if (Math.abs(smooth.v - tv) / tv > 0.002) again = true; else smooth.v = tv;
    }
    const ys = scaleLinear().domain(smooth.p).range([pad.t + priceH, pad.t]);
    const yv = scaleLinear().domain([0, smooth.v]).range([pad.t + priceH + gap + volH, pad.t + priceH + gap]);
    const vBase = yv(0);

    ctx.save();
    ctx.globalAlpha = alpha;

    // сетка и шкала цен
    ctx.lineWidth = 1;
    const ticks = ys.ticks(narrow ? 4 : 6);
    const tagY = v.lastTag && states.length ? ys(states[states.length - 1][1].c) : -999;
    for (const p of ticks) {
      const y = Math.round(ys(p)) + 0.5;
      ctx.strokeStyle = C['line-2']; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y); ctx.stroke();
      if (Math.abs(y - tagY) > 15) text(F.price(p), W - pad.r + 10, y, { size: 11, color: C['fg-3'], base: 'middle', halo: false });
    }
    ctx.strokeStyle = C['line-2']; ctx.beginPath(); ctx.moveTo(pad.l, vBase + 0.5); ctx.lineTo(pad.l + plotW, vBase + 0.5); ctx.stroke();

    // шкала времени
    for (const tk of xTicks(x0, x1, narrow)) {
      const x = xs(tk.x);
      if (tk.line && x > pad.l && x < pad.l + plotW) { ctx.strokeStyle = C['line-2']; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, pad.t); ctx.lineTo(Math.round(x) + 0.5, vBase); ctx.stroke(); }
      if (!tk.label || x < pad.l - 2 || x > pad.l + plotW - 12) continue;
      text(tk.label, tk.align === 'left' ? x + 6 : x, H - 8, { size: 11, color: C['fg-3'], align: tk.align || 'center', halo: false });
    }

    // полосы (зоны) под свечами
    for (const mk of v.marks || []) if (mk.type === 'band') drawBand(mk, xs, ys);

    const bodyW = Math.max(1, Math.min(18, step * 0.62));
    const focus = v.focus;
    const drawSet = (list, mul) => {
      if (mul <= 0.01) return;
      for (const [c, s] of list) {
        const cx = xs(c.i + 0.5);
        if (cx < pad.l - bodyW || cx > pad.l + plotW + bodyW) continue;
        let a = 1;
        if (focus && focus.a > 0) {
          const inside = c.i >= focus.from && c.i < focus.to;
          a = inside ? 1 : 1 - 0.72 * focus.a;
        }
        ctx.globalAlpha = alpha * a * mul;
        const up = s.c >= s.o;
        const col = up ? C['candle-up'] : C['candle-down'];
        // фитиль
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(cx) + 0.5, ys(s.h)); ctx.lineTo(Math.round(cx) + 0.5, ys(s.l)); ctx.stroke();
        // тело
        const yt = ys(Math.max(s.o, s.c)), yb = ys(Math.min(s.o, s.c));
        ctx.fillStyle = col;
        roundRect(cx - bodyW / 2, yt, bodyW, Math.max(1.5, yb - yt), 1.5); ctx.fill();
        // объём: сегменты по участникам, с зазором между сегментами
        let y = vBase, prevBase = vBase;
        const segs = volumes(c, s, v);
        const rest = (j) => segs.slice(j + 1).reduce((sum, g) => sum + (g.overlay ? 0 : g.q), 0);
        for (let j = 0; j < segs.length; j++) {
          const { q, color, overlay } = segs[j];
          const ga = segs[j].alpha ?? 1;
          if (q <= 0 || ga <= 0.01) continue;
          const h = vBase - yv(q);
          if (overlay) {
            // поверх предыдущего сегмента, от его основания
            ctx.save(); ctx.globalAlpha *= ga; ctx.fillStyle = color;
            roundRect(cx - bodyW / 2, prevBase - Math.max(1, h), bodyW, Math.max(1, h), 1.5); ctx.fill(); ctx.restore();
            continue;
          }
          const g = y < vBase ? 1 : 0;
          const hh = Math.max(1, h - g);
          ctx.save(); ctx.globalAlpha *= ga; ctx.fillStyle = color;
          roundRect(cx - bodyW / 2, y - g - hh, bodyW, hh, j === 0 && rest(j) > 0 ? 0 : 1.5); ctx.fill(); ctx.restore();
          prevBase = y - g;
          y = y - g - hh;
        }
      }
    };
    drawSet(states, 1 - alt);
    if (altStates) drawSet(altStates, alt);
    ctx.globalAlpha = alpha;

    // линия индекса (приведён к цене на начало)
    if (idx) {
      const i0 = Math.max(0, Math.floor(x0)), i1 = Math.min(sim.index.length - 1, Math.ceil(x1));
      const tEnd = Math.min(v.t, sim.index.length);
      ctx.save(); ctx.globalAlpha = alpha * idx.a * 0.8; ctx.strokeStyle = idx.color || C['fg-3']; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.rect(pad.l, pad.t - 4, plotW, priceH + 8); ctx.clip();
      ctx.beginPath();
      let started = false, lx = 0, ly = 0;
      const pt = (tt, yy) => { const x = xs(tt); if (!started) { ctx.moveTo(x, ys(yy)); started = true; } else ctx.lineTo(x, ys(yy)); lx = x; ly = ys(yy); };
      // точки — закрытия баров в их центрах; кончик линии идёт за временем t
      const tip = tEnd - 0.5;
      for (let i = i0; i <= i1; i++) { if (i + 0.5 > tip) break; pt(i + 0.5, sim.index[i]); }
      if (tip > i0 + 0.5 && tip < i1 + 0.5) pt(tip, seriesAt(sim.index, tip + 0.5));
      ctx.stroke();
      if (started && idx.label) {
        ctx.fillStyle = idx.color || C['fg-3']; ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fill();
        const fits = lx + 10 + 60 < pad.l + plotW;
        text(narrow && idx.labelShort != null ? idx.labelShort : idx.label, fits ? lx + 10 : lx - 10, ly, { size: narrow ? 10.5 : 12, weight: 550, color: C['fg-2'], align: fits ? 'left' : 'right', base: 'middle' });
      }
      ctx.restore();
    }

    // разметка
    for (const mk of v.marks || []) drawMark(mk, xs, ys, yv, pad, plotW, narrow, mk.set === 'cf' && altStates ? altStates : states);

    // плашка последней цены
    if (v.lastTag && states.length) {
      const [c, s] = states[states.length - 1];
      const y = ys(s.c);
      dashed(xs(c.i + 0.5) + bodyW / 2 + 2, y, W - pad.r + 2, y, C['fg-3'], 0.8, [2, 3]);
      ctx.fillStyle = C.fg;
      roundRect(W - pad.r + 4, y - 10, pad.r - 8, 20, 10); ctx.fill();
      text(F.price(s.c), W - pad.r + 4 + (pad.r - 8) / 2, y + 0.5, { size: 11, weight: 650, color: C.bg, align: 'center', base: 'middle', halo: false });
    }
    ctx.restore();
    return again;
  }

  function drawBand(mk, xs, ys) {
    if (mk.a <= 0.01) return;
    const x0 = xs(mk.m0), x1 = xs(mk.m1);
    const y0 = ys(Math.max(mk.p0, mk.p1)), y1 = ys(Math.min(mk.p0, mk.p1));
    ctx.save(); ctx.globalAlpha *= mk.a;
    ctx.fillStyle = mk.color || C.breach; ctx.globalAlpha *= mk.fill ?? 0.16;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }

  function drawMark(mk, xs, ys, yv, pad, plotW, narrow, states) {
    const v = view;
    const a = mk.a ?? 1;
    if (a <= 0.01 || (narrow && mk.hideNarrow)) return;
    const right = pad.l + plotW;
    switch (mk.type) {
      case 'hline': {
        const y = ys(mk.price);
        const xa = mk.m0 != null ? xs(mk.m0) : pad.l;
        const xb = mk.m1 != null ? Math.min(right, xs(mk.m1)) : right;
        dashed(xa, y, xb, y, mk.color || C.fg, a, mk.dash || [5, 4], mk.width || 1.25);
        if (mk.label) {
          const below = mk.labelBelow;
          const al = mk.labelAlign || 'right';
          const lbl = narrow && mk.labelShort ? mk.labelShort : mk.label;
          if (al === 'before') {
            text(lbl, xa - 8, y, { size: narrow ? 11 : 12.5, weight: 550, color: C.fg, align: 'right', base: 'middle', alpha: a });
          } else {
            const lx = al === 'right' ? xb : al === 'left' ? xa : (xa + xb) / 2;
            text(lbl, lx, below ? y + 16 : y - 8, { size: narrow ? 11 : 12.5, weight: 550, color: C.fg, align: al, alpha: a });
          }
        }
        break;
      }
      case 'vline': {
        const x = xs(mk.minute);
        dashed(x, pad.t - 6, x, H - pad.b + 2, mk.color || C.fg, a, mk.dash || [4, 4], 1.25);
        if (mk.label) text(mk.label, x + (mk.labelLeft ? -8 : 8), pad.t + 24, { size: narrow ? 11 : 13, weight: 600, color: C.fg, align: mk.labelLeft ? 'right' : 'left', alpha: a });
        if (mk.sub) text(mk.sub, x + (mk.labelLeft ? -8 : 8), pad.t + 41, { size: narrow ? 11 : 12, weight: 500, color: C['fg-2'], align: mk.labelLeft ? 'right' : 'left', alpha: a });
        break;
      }
      case 'dimV': {
        const x = xs(mk.minute);
        dimV(x, ys(mk.p0), ys(mk.p1), mk.label, a, mk.color, mk.side || 'right', !narrow);
        if (mk.sub) {
          const yMid = (ys(mk.p0) + ys(mk.p1)) / 2;
          const side = mk.side || 'right';
          text(narrow && mk.subShort ? mk.subShort : mk.sub, x + (side === 'right' ? 12 : -12), yMid + (narrow ? 16 : 20), { size: narrow ? 10.5 : 12, color: C['fg-2'], align: side === 'right' ? 'left' : 'right', base: 'middle', alpha: a });
        }
        break;
      }
      case 'bracket': {
        // скобка над диапазоном минут
        let top = Infinity;
        for (const [c, s] of states) if (c.i >= mk.from && c.i < mk.to) top = Math.min(top, ys(s.h));
        if (!isFinite(top)) break;
        const y = top - 18;
        dimH(xs(mk.from + 0.15), xs(mk.to - 0.15), y, narrow && mk.labelShort ? mk.labelShort : mk.label, a, C.fg, mk.small ? (narrow ? 11.5 : 13) : (narrow ? 14 : 17));
        break;
      }
      case 'chevrons': {
        const down = mk.dir === 'down';
        const pick = (c) => c.i >= mk.from && c.i < mk.to && (!mk.only || mk.only(c));
        ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = mk.color || C.fg; ctx.lineWidth = 1.5;
        for (const [c, s] of states) {
          if (!pick(c)) continue;
          const x = xs(c.i + 0.5);
          if (x < pad.l || x > right) continue;
          if (down) {
            const y = ys(s.l) + 12;
            ctx.beginPath(); ctx.moveTo(x - 4, y - 3); ctx.lineTo(x, y + 2); ctx.lineTo(x + 4, y - 3); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x - 4, y - 8); ctx.lineTo(x, y - 3); ctx.lineTo(x + 4, y - 8); ctx.stroke();
          } else {
            const y = ys(s.h) - 12;
            ctx.beginPath(); ctx.moveTo(x - 4, y + 3); ctx.lineTo(x, y - 2); ctx.lineTo(x + 4, y + 3); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x - 4, y + 8); ctx.lineTo(x, y + 3); ctx.lineTo(x + 4, y + 8); ctx.stroke();
          }
        }
        ctx.restore();
        if (mk.label) {
          let low = -Infinity, top = Infinity;
          for (const [c, s] of states) if (pick(c)) { low = Math.max(low, ys(s.l)); top = Math.min(top, ys(s.h)); }
          const lx = xs(mk.from + (mk.to - mk.from) * (mk.labelAt ?? 0.55));
          if (down && isFinite(top)) text(mk.label, lx, top - 14, { size: narrow ? 12 : 14, weight: 600, color: C.fg, align: mk.labelAlign || 'left', alpha: a });
          else if (isFinite(low)) text(mk.label, lx, low + 26, { size: narrow ? 12 : 14, weight: 600, color: C.fg, align: mk.labelAlign || 'left', alpha: a });
        }
        break;
      }
      case 'block': {
        // сделка вне основных торгов: метка на уровне цены, столбик объёма уходит за край шкалы
        const x = xs(mk.bar), y = ys(mk.price);
        const top = yv(smooth.v), base = yv(0);
        ctx.save(); ctx.globalAlpha *= a;
        const color = mk.color || C.bank;
        const grow = clamp(mk.grow ?? 1);
        const bw = Math.max(6, Math.min(14, (xs(1) - xs(0)) * 0.8));
        // столбик объёма с «разрывом» наверху
        const hFull = (base - top + 6) * grow;
        ctx.fillStyle = color;
        roundRect(x - bw / 2, base - hFull, bw, hFull, 1.5); ctx.fill();
        if (grow > 0.98) {
          ctx.strokeStyle = C.panel; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(x - bw / 2 - 2, top + 10); ctx.lineTo(x + bw / 2 + 2, top + 5); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - bw / 2 - 2, top + 15); ctx.lineTo(x + bw / 2 + 2, top + 10); ctx.stroke();
        }
        // линия к цене и ромб
        ctx.setLineDash([3, 3]); ctx.strokeStyle = color; ctx.lineWidth = 1.25;
        ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x, base - hFull); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.closePath(); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = C.panel; ctx.stroke();
        ctx.restore();
        if (mk.label) {
          ctx.save(); ctx.font = `600 ${narrow ? 12 : 13.5}px ${FONT}`; const lw = ctx.measureText(mk.label).width; ctx.restore();
          const fits = x + 16 + lw < right;
          const lx = fits ? x + 16 : x - 16, al = fits ? 'left' : 'right';
          const ly = y - (mk.labelBelow ? -18 : 6);
          text(mk.label, lx, ly, { size: narrow ? 12 : 13.5, weight: 600, color: C.fg, align: al, alpha: a });
          const subs = narrow && mk.subLines ? mk.subLines : mk.sub ? [mk.sub] : [];
          subs.forEach((line, j) => text(line, lx, ly + 16 + j * 14, { size: narrow ? 10.5 : 12, color: C['fg-2'], align: al, alpha: a }));
        }
        break;
      }
      case 'dot': {
        // точка на цене с подписью (например, восстановление)
        const x = xs(mk.minute), y = ys(mk.price);
        ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = mk.color || C.fg; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = C.panel; ctx.stroke(); ctx.restore();
        if (mk.label) {
          const al = mk.labelAlign || 'left';
          const lx = al === 'left' ? x + 12 : x - 12;
          const up = mk.labelAbove ? 18 : 0;
          text(mk.label, lx, y - 4 - up, { size: narrow ? 12 : 13.5, weight: 600, color: C.fg, align: al, alpha: a });
          if (mk.sub) text(mk.sub, lx, y + 13 - up, { size: narrow ? 10.5 : 12, color: C['fg-2'], align: al, alpha: a });
        }
        break;
      }
      case 'ring': {
        const st = states.find(([c]) => c.i === mk.minute);
        if (!st) break;
        const [c, s] = st;
        const x = xs(c.i + 0.5);
        ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = C.fg; ctx.lineWidth = 1.25; ctx.setLineDash([3, 3]);
        const yt = ys(s.h) - 10, yb = yv(0) + 4;
        roundRect(x - 16, yt, 32, yb - yt, 10); ctx.stroke(); ctx.restore();
        if (mk.label) {
          const y = yv(s.vM + s.vB + s.vT);
          const ly = Math.max(y + 14, yv(0) - (yv(0) - y) / 2);
          ctx.save(); ctx.font = `650 ${narrow ? 12 : 14}px ${FONT}`; const lw = ctx.measureText(mk.label).width; ctx.restore();
          const left = x + 24 + lw > right;
          const lx = left ? x - 24 : x + 24, al = left ? 'right' : 'left';
          text(mk.label, lx, ly, { size: narrow ? 12 : 14, weight: 650, color: C.fg, base: 'middle', align: al, alpha: a });
          if (mk.sub) text(mk.sub, lx, ly + 17, { size: 11.5, color: C['fg-2'], base: 'middle', align: al, alpha: a });
        }
        break;
      }
      case 'band': {
        if (mk.label) {
          const yTop = ys(Math.max(mk.p0, mk.p1));
          const yBot = ys(Math.min(mk.p0, mk.p1));
          let lx, ly, al = 'left';
          if (mk.labelAt === 'left') { lx = pad.l + 12; ly = yTop + (narrow ? 30 : 42); }
          else if (mk.labelAt === 'inside') { lx = Math.max(pad.l + 12, xs(mk.m0) + 14); ly = yTop + (narrow ? 30 : 42); }
          else { lx = Math.min(right - 8, xs(mk.m1) + 14); ly = (yTop + yBot) / 2 - 4; }
          text(mk.label, lx, ly, { size: narrow ? 22 : 34, weight: 680, color: C.fg, align: al, base: 'middle', alpha: a });
          const subs = narrow && mk.subLines ? mk.subLines : mk.sub ? [mk.sub] : [];
          subs.forEach((line, j) => text(line, lx, ly + (narrow ? 20 : 28) + j * 15, { size: narrow ? 11 : 13, color: C['fg-2'], align: al, base: 'middle', alpha: a }));
        }
        break;
      }
      case 'inset': {
        // сравнение оборота: две полосы
        const rows = mk.rows;
        const rowH = narrow ? 34 : 40;
        const priceH = (H - pad.t - pad.b) * 0.72;
        const bx = pad.l + 14, bw = Math.min(narrow ? 150 : 260, plotW * 0.42);
        const by = mk.at === 'bottom-left' && !narrow ? pad.t + priceH - rows.length * rowH - (mk.note ? 22 : 6) : pad.t + 4 + (narrow ? 0 : (v.topInset || 0));
        ctx.save(); ctx.globalAlpha *= a;
        if (narrow) {
          // на телефоне блок лежит поверх свечей — подложка
          ctx.fillStyle = C.panel; ctx.globalAlpha *= 0.9;
          roundRect(bx - 8, by - 2, bw + 96, rows.length * rowH + (mk.note ? 18 : 2), 8); ctx.fill();
          ctx.globalAlpha = a;
        }
        const max = Math.max(...rows.map((r) => r.value));
        rows.forEach((r, j) => {
          const y = by + j * rowH;
          text(r.label, bx, y + 10, { size: narrow ? 10.5 : 12, color: C['fg-2'], halo: false, alpha: 1 });
          const w = Math.max(3, (r.value / max) * bw * clamp((mk.grow ?? 1)));
          ctx.fillStyle = r.color; roundRect(bx, y + 16, w, narrow ? 7 : 9, 2); ctx.fill();
          text(r.text, bx + w + 8, y + 16 + (narrow ? 4 : 5), { size: narrow ? 11 : 12.5, weight: 600, color: C.fg, base: 'middle', halo: false, alpha: 1 });
        });
        if (mk.note) text(mk.note, bx, by + rows.length * rowH + 6, { size: narrow ? 10.5 : 12, color: C['fg-2'], halo: false, alpha: 1 });
        ctx.restore();
        break;
      }
      default: break;
    }
  }

  // ---------- гистограмма размеров сделок ----------
  function drawHist(v, pad, narrow, alpha) {
    const plotW = W - pad.l - pad.r + (narrow ? 30 : 40), plotH = H - pad.t - pad.b - 26;
    const xl = scaleLinear().domain([0.6, 6.7]).range([pad.l + 8, pad.l + plotW]);
    const maxN = Math.max(...sim.hist.map((b) => b.n));
    const top = pad.t + 54;
    const yb = scaleLinear().domain([0, maxN * 1.05]).range([pad.t + plotH, top]);
    const grow = v.histGrow ?? 1;
    ctx.save(); ctx.globalAlpha = alpha;
    text('История сделок по бумаге, по размеру сделки', pad.l + 8, pad.t + (narrow ? 24 : 6), { size: narrow ? 11.5 : 13, color: C['fg-2'], halo: false });
    ctx.fillStyle = C.vol;
    for (const b of sim.hist) {
      if (!b.n) continue;
      const x0 = xl(b.x0) + 0.5, x1 = xl(b.x1) - 0.5;
      const h = (yb(0) - yb(b.n)) * grow;
      roundRect(x0, yb(0) - h, Math.max(1, x1 - x0), h, 1); ctx.fill();
    }
    ctx.strokeStyle = C['line']; ctx.beginPath(); ctx.moveTo(pad.l + 8, yb(0) + 0.5); ctx.lineTo(pad.l + plotW, yb(0) + 0.5); ctx.stroke();
    const labels = ['10', '100', '1 тыс.', '10 тыс.', '100 тыс.', '1 млн'];
    for (let d = 1; d <= 6; d++) text(labels[d - 1], xl(d), yb(0) + 17, { size: 11, color: C['fg-3'], align: 'center', halo: false });
    text('акций в сделке, логарифмическая шкала', pad.l + plotW, yb(0) + 34, { size: 11, color: C['fg-3'], align: 'right', halo: false });

    const p99x = xl(Math.log10(sim.m.p99));
    const tx = xl(Math.log10(sim.m.traderQty));
    const ma = v.histMarks ?? 1;
    // 99-й перцентиль
    dashed(p99x, top - 6, p99x, yb(0), C.fg, ma, [4, 4], 1.25);
    text('99-й перцентиль', p99x + 8, top + 8, { size: narrow ? 11 : 12.5, weight: 600, color: C.fg, alpha: ma });
    text(F.int(sim.m.p99) + ' акций', p99x + 8, top + 25, { size: narrow ? 11 : 12, color: C['fg-2'], alpha: ma });
    // сделка трейдера
    const ta = v.histTrader ?? 1;
    const ty = yb(maxN * 0.42);
    ctx.save(); ctx.globalAlpha *= ta; ctx.strokeStyle = C.trader; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(tx, yb(0)); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.fillStyle = C.trader; ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.bg; ctx.stroke();
    ctx.restore();
    text('Встречная сделка', tx - 12, ty - 30, { size: narrow ? 11.5 : 13, weight: 600, color: C.fg, align: 'right', alpha: ta });
    text(F.int(sim.m.traderQty) + ' акций', tx - 12, ty - 13, { size: narrow ? 11 : 12, color: C['fg-2'], align: 'right', alpha: ta });
    // размер разрыва
    dimH(p99x, tx, yb(maxN * 0.22), '×' + F.ratio(Math.round(sim.m.counterRatio / 10) * 10), v.histDim ?? 1, C.fg, narrow ? 18 : 24);
    ctx.restore();
  }

  // ---------- встречные заявки: объём × время подачи до заявки банка ----------
  function drawTimeline(v, pad, narrow, alpha) {
    const left = pad.l + (narrow ? 52 : 70), right = W - pad.r + (narrow ? 34 : 40);
    const top = pad.t + (narrow ? 44 : 50), bottom = H - pad.b - (narrow ? 22 : 26);
    const xt = scaleLinear().domain([-62, 9]).range([left, right]);
    const ylog = (q) => bottom - ((Math.log10(q) - 4) / (Math.log10(narrow ? 1.2e7 : 6e6) - 4)) * (bottom - top);
    ctx.save(); ctx.globalAlpha = alpha;
    if (!narrow) text('Встречные заявки: объём и время подачи до заявки банка', pad.l + 8, pad.t + 6, { size: 13, color: C['fg-2'], halo: false });
    // сетка по объёму (логарифм) и по времени
    for (const [q, lbl] of [[1e4, '10 тыс.'], [1e5, '100 тыс.'], [1e6, '1 млн']]) {
      const y = Math.round(ylog(q)) + 0.5;
      ctx.strokeStyle = C['line-2']; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      text(lbl, left - 10, y, { size: 11, color: C['fg-3'], align: 'right', base: 'middle', halo: false });
    }
    if (!narrow) text('акций', left - 10, top - 14, { size: 11, color: C['fg-3'], align: 'right', halo: false });
    for (const sec of [-60, -45, -30, -15, 0]) {
      const x = Math.round(xt(sec)) + 0.5;
      ctx.strokeStyle = C['line-2']; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      text(sec === 0 ? '0' : '\u2212' + Math.abs(sec) + '\u00a0с', x, bottom + 16, { size: 11, color: C['fg-3'], align: 'center', halo: false });
    }
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(left, bottom + 0.5); ctx.lineTo(right, bottom + 0.5); ctx.stroke();
    text(sim.P.bankOrderTime, xt(0), bottom + 31, { size: 11, color: C['fg-3'], align: 'center', halo: false });

    const grow = v.tlGrow ?? 1;
    // заявки других продавцов
    const visible = sim.orderTimes.filter((o) => o.who === 'market' && o.t >= -62);
    const earlier = sim.orderTimes.filter((o) => o.who === 'market' && o.t < -62);
    ctx.fillStyle = C['fg-2'];
    for (const o of visible) { ctx.beginPath(); ctx.arc(xt(o.t), ylog(o.qty), 4.5 * grow, 0, Math.PI * 2); ctx.fill(); }
    if (earlier.length) {
      const yq = ylog(earlier.reduce((s, o) => s + o.qty, 0) / earlier.length);
      ctx.strokeStyle = C['fg-3']; ctx.lineWidth = 1.25; ctx.beginPath(); ctx.moveTo(left + 9, yq - 4); ctx.lineTo(left + 3, yq); ctx.lineTo(left + 9, yq + 4); ctx.stroke();
      text(`ещё ${earlier.length} раньше`, left + 14, yq - 10, { size: 11, color: C['fg-3'] });
    }
    // крупная встречная заявка и заявка банка
    const big = sim.orderTimes.find((o) => o.who === 'trader');
    const bk = sim.orderTimes.find((o) => o.who === 'bank');
    const ta = v.tlTrader ?? 1, ba = v.tlBank ?? 1;
    const bx = xt(big.t), by = ylog(big.qty), kx = xt(bk.t), ky = ylog(bk.qty);
    ctx.save(); ctx.globalAlpha *= ta; ctx.strokeStyle = C.trader; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(bx, by + 8); ctx.lineTo(bx, bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.trader; ctx.beginPath(); ctx.arc(bx, by, 8, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    text('Крупная заявка ' + F.int(big.qty), bx - 16, by - 3, { size: narrow ? 11.5 : 13, weight: 600, color: C.fg, align: 'right', base: 'middle', alpha: ta });
    text('продажа по ' + F.price(sim.P.traderAsk) + ', ' + shift(sim.P.bankOrderTime, big.t), bx - 16, by + 14, { size: narrow ? 10.5 : 12, color: C['fg-2'], align: 'right', base: 'middle', alpha: ta });
    ctx.save(); ctx.globalAlpha *= ba; ctx.strokeStyle = C.bank; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(kx, ky + 8); ctx.lineTo(kx, bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.bank; ctx.beginPath(); ctx.arc(kx, ky, 8, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    text('Заявка банка ' + F.int(bk.qty), kx + 2, ky + (narrow ? 48 : 56), { size: narrow ? 11.5 : 13, weight: 600, color: C.fg, align: 'right', base: 'middle', alpha: ba });
    text('покупка, ' + sim.P.bankOrderTime, kx + 2, ky + (narrow ? 64 : 73), { size: narrow ? 10.5 : 12, color: C['fg-2'], align: 'right', base: 'middle', alpha: ba });
    // интервал между ними
    const da = v.tlDim ?? 1;
    const yd = Math.min(by, ky) - 34;
    dimH(bx, kx, yd, `${Math.abs(big.t)}\u00a0с`, da, C.fg, narrow ? 16 : 20);
    dashed(bx, yd, bx, by - 10, C['fg-3'], da, [2, 3]);
    dashed(kx, yd, kx, ky - 10, C['fg-3'], da, [2, 3]);
    ctx.restore();
  }

  // ---------- карта ликвидности: заявки у лучшей цены по часам ----------
  // v.heat = { from, to, grow, annA, title, dayLabel(d), spreadLabel, depthLabel, weekFrom, weekTo, weekLabel }
  function drawHeat(v, pad, narrow, alpha) {
    const h = v.heat; if (!h) return;
    const P = sim.P, B = P.barsPerDay;
    const group = narrow ? 3 : 1;
    const cols = [];
    for (let i = h.from; i < h.to; i += group) {
      let sp = 0, dp = 0, n = 0;
      for (let j = i; j < Math.min(h.to, i + group); j++) { sp += sim.spread[j]; dp += sim.depth[j]; n++; }
      cols.push({ i, ticks: Math.max(1, Math.round(sp / n / P.tick)), depth: dp / n });
    }
    const maxTicks = Math.max(...cols.map((c) => c.ticks));
    const nAsk = 5, nBid = 5;
    const rows = nBid + (maxTicks - 1) + nAsk; // ряды: биды, пустые ряды спреда (до maxTicks − 1), аски
    const left = pad.l + (narrow ? 64 : 92), right = W - pad.r + (narrow ? 36 : 44);
    const top = pad.t + (narrow ? 66 : 56), bottom = H - pad.b - (narrow ? 30 : 34);
    const cw = (right - left) / cols.length, rh = (bottom - top) / rows;
    const gap = Math.min(2, cw * 0.14);
    const grow = clamp(h.grow ?? 1);
    ctx.save(); ctx.globalAlpha = alpha;
    text(narrow ? (h.titleShort || 'Карта ликвидности') : (h.title || 'Карта ликвидности'), pad.l + 8, pad.t + (narrow ? 24 : 6), { size: narrow ? 11.5 : 13, color: C['fg-2'], halo: false });
    // ряды: r = 0 — лучший бид, отрицательные — биды глубже, положительные — спред и аски
    const rowY = (r) => bottom - (r + nBid) * rh;
    text(narrow ? 'продажа' : 'заявки на продажу', left - 10, rowY(maxTicks + nAsk - 1) + rh * nAsk / 2, { size: 11, color: C['fg-3'], align: 'right', base: 'middle', halo: false });
    text(narrow ? 'покупка' : 'заявки на покупку', left - 10, rowY(0) + rh * nBid / 2, { size: 11, color: C['fg-3'], align: 'right', base: 'middle', halo: false });
    // ячейки
    const shown = Math.floor(cols.length * grow + 0.999);
    cols.forEach((c, j) => {
      if (j >= shown) return;
      const x = left + j * cw;
      const cell = (r, q) => {
        const a = 0.05 + 0.82 * Math.pow(clamp(q / (P.depthBase * 1.1)), 1.5);
        ctx.fillStyle = `rgba(245,245,247,${a.toFixed(3)})`;
        roundRect(x + gap / 2, rowY(r) + gap / 2, cw - gap, rh - gap, Math.min(3, rh / 4)); ctx.fill();
      };
      for (let k = 0; k < nBid; k++) cell(-k, c.depth * (0.75 + 0.5 * frac(c.i * 3.1 + k)));
      for (let k = 0; k < nAsk; k++) cell(c.ticks + k, c.depth * (0.75 + 0.5 * frac(c.i * 5.3 + k)));
      // пустые ряды спреда — тонкая рамка
      if (c.ticks > 1) {
        ctx.strokeStyle = 'rgba(255,69,58,0.35)'; ctx.lineWidth = 1;
        roundRect(x + gap / 2 + 0.5, rowY(c.ticks - 1) + gap / 2 + 0.5, cw - gap - 1, rh * (c.ticks - 1) - gap - 1, 3); ctx.stroke();
      }
    });
    // дни
    for (let i = h.from; i < h.to; i += B) {
      const j = (i - h.from) / group, x = left + j * cw;
      if (i > h.from) { ctx.strokeStyle = C['line-2']; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top - 4); ctx.lineTo(Math.round(x) + 0.5, bottom + 4); ctx.stroke(); }
      const d = Math.floor(i / B);
      if (!narrow || d % 2 === 0) text(h.dayLabel ? h.dayLabel(d) : String(d + 1), x + 4, bottom + 18, { size: 11, color: C['fg-3'], halo: false });
    }
    // неделя продаж
    const aa = clamp(h.annA ?? 1);
    if (h.weekFrom != null && aa > 0.01) {
      const xa = left + ((h.weekFrom - h.from) / group) * cw, xb = left + ((h.weekTo - h.from) / group) * cw;
      dimH(xa + 2, xb - 2, top - 14, h.weekLabel || '', aa, C.fg, narrow ? 12 : 14);
    }
    // спред и глубина: подписи у правого края, поверх ячеек
    if (aa > 0.01) {
      const lastTicks = cols[cols.length - 1].ticks;
      const ySpread = rowY(lastTicks - 1) + rh * (lastTicks - 1) / 2;
      const yAsk = rowY(lastTicks + nAsk - 1) + rh * nAsk / 2;
      text(h.spreadLabel || '', right - 8, ySpread, { size: narrow ? 11.5 : 13, weight: 650, color: C.breach, align: 'right', base: 'middle', alpha: aa });
      text(h.depthLabel || '', right - 8, yAsk, { size: narrow ? 11.5 : 13, weight: 650, color: C.fg, align: 'right', base: 'middle', alpha: aa });
    }
    ctx.restore();
  }
  function frac(x) { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); }

  // ---------- распределение: история против эпизода ----------
  // v.dist = { title, bins:[{x0,x1,n}], domain:[a,b], ticks:[{x,label}], axis, band:{from,to,label}, marker:{x,label,sub,color}, dim:{label}, grow, bandA, markerA, dimA }
  function drawDist(v, pad, narrow, alpha) {
    const D = v.dist; if (!D) return;
    const plotW = W - pad.l - pad.r + (narrow ? 30 : 40), plotH = H - pad.t - pad.b - 26;
    const xl = scaleLinear().domain(D.domain).range([pad.l + 8, pad.l + plotW]);
    const maxN = Math.max(...D.bins.map((b) => b.n));
    const top = pad.t + 54;
    const yb = scaleLinear().domain([0, maxN * 1.05]).range([pad.t + plotH, top]);
    const grow = clamp(D.grow ?? 1);
    ctx.save(); ctx.globalAlpha = alpha;
    text(D.title || '', pad.l + 8, pad.t + (narrow ? 24 : 6), { size: narrow ? 11.5 : 13, color: C['fg-2'], halo: false });
    ctx.fillStyle = C.vol;
    for (const b of D.bins) {
      if (!b.n) continue;
      const x0 = xl(b.x0) + 0.5, x1 = xl(b.x1) - 0.5;
      const hh = (yb(0) - yb(b.n)) * grow;
      roundRect(x0, yb(0) - hh, Math.max(1, x1 - x0), hh, 1); ctx.fill();
    }
    ctx.strokeStyle = C['line']; ctx.beginPath(); ctx.moveTo(pad.l + 8, yb(0) + 0.5); ctx.lineTo(pad.l + plotW, yb(0) + 0.5); ctx.stroke();
    for (const t of D.ticks || []) text(t.label, xl(t.x), yb(0) + 17, { size: 11, color: C['fg-3'], align: 'center', halo: false });
    if (D.axis) text(D.axis, pad.l + plotW, yb(0) + 34, { size: 11, color: C['fg-3'], align: 'right', halo: false });
    // обычный разброс
    const ba = clamp(D.bandA ?? 1);
    if (D.band && ba > 0.01) {
      const x0 = xl(D.band.from), x1 = xl(D.band.to);
      ctx.save(); ctx.globalAlpha *= ba;
      ctx.fillStyle = 'rgba(245,245,247,0.06)'; ctx.fillRect(x0, top - 6, x1 - x0, yb(0) - top + 6);
      dashed(x0, top - 6, x0, yb(0), C.fg, 1, [4, 4], 1); dashed(x1, top - 6, x1, yb(0), C.fg, 1, [4, 4], 1);
      ctx.restore();
      text(D.band.label, (x0 + x1) / 2, top + 8, { size: narrow ? 11 : 12.5, weight: 600, color: C.fg, align: 'center', alpha: ba });
      if (D.band.sub) text(D.band.sub, (x0 + x1) / 2, top + 25, { size: narrow ? 11 : 12, color: C['fg-2'], align: 'center', alpha: ba });
    }
    // эпизод
    const ma = clamp(D.markerA ?? 1);
    if (D.marker && ma > 0.01) {
      const mx = xl(D.marker.x), my = yb(maxN * 0.42);
      const color = D.marker.color || C.trader;
      ctx.save(); ctx.globalAlpha *= ma; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx, yb(0)); ctx.lineTo(mx, my); ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = C.bg; ctx.stroke(); ctx.restore();
      const leftSide = D.marker.x < (D.domain[0] + D.domain[1]) / 2;
      const lx = leftSide ? mx + 12 : mx - 12, al = leftSide ? 'left' : 'right';
      text(D.marker.label, lx, my - 30, { size: narrow ? 11.5 : 13, weight: 600, color: C.fg, align: al, alpha: ma });
      if (D.marker.sub) text(D.marker.sub, lx, my - 13, { size: narrow ? 11 : 12, color: C['fg-2'], align: al, alpha: ma });
      if (D.band && D.dim) {
        const bx = D.marker.x < D.band.from ? xl(D.band.from) : xl(D.band.to);
        dimH(Math.min(bx, mx), Math.max(bx, mx), yb(maxN * 0.22), D.dim.label, clamp(D.dimA ?? 1), C.fg, narrow ? 18 : 24);
      }
    }
    ctx.restore();
  }

  // ---------- граф связей участников ----------
  // v.graph = { nodes:[{id,label,sub,x,y,color,kind}], edges:[{from,to,label,dashed,at,width}], reveal, legend }
  function drawGraph(v, pad, narrow, alpha) {
    const G = v.graph; if (!G) return;
    const left = pad.l + 10, right = W - pad.r + (narrow ? 40 : 50);
    const top = pad.t + (narrow ? 30 : 36), bottom = H - pad.b - (narrow ? 26 : 30);
    const px = (x) => left + x * (right - left), py = (y) => top + y * (bottom - top);
    const reveal = clamp(G.reveal ?? 1);
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.font = `600 ${narrow ? 11.5 : 13}px ${FONT}`;
    // размеры узлов
    const box = new Map();
    for (const n of G.nodes) {
      ctx.font = `600 ${narrow ? 11.5 : 13}px ${FONT}`;
      const label = narrow && n.labelShort != null ? n.labelShort : n.label;
      const sub = narrow ? n.subShort : n.sub;
      const w = Math.max(ctx.measureText(label).width, sub ? ctx.measureText(sub).width * 0.9 : 0) + (narrow ? 20 : 28);
      const hh = sub ? (narrow ? 38 : 44) : (narrow ? 28 : 32);
      box.set(n.id, { x: px(narrow && n.xn != null ? n.xn : n.x), y: py(narrow && n.yn != null ? n.yn : n.y), w, h: hh, n, label, sub });
    }
    const nodeA = (n) => clamp((reveal - (n.at ?? 0)) / 0.12);
    // точка на границе прямоугольника в направлении другой точки
    const edgePt = (b, tx, ty) => {
      const dx = tx - b.x, dy = ty - b.y;
      if (!dx && !dy) return { x: b.x, y: b.y };
      const sx = (b.w / 2) / Math.abs(dx || 1e-9), sy = (b.h / 2) / Math.abs(dy || 1e-9);
      const s = Math.min(sx, sy);
      return { x: b.x + dx * s, y: b.y + dy * s };
    };
    // рёбра
    for (const e of G.edges) {
      const a = clamp((reveal - (e.at ?? 0)) / 0.14);
      if (a <= 0.01) continue;
      const A = box.get(e.from), Bx = box.get(e.to);
      if (!A || !Bx) continue;
      const p0 = edgePt(A, Bx.x, Bx.y), p1 = edgePt(Bx, A.x, A.y);
      const color = e.color || (e.dashed ? C['fg-2'] : C.fg);
      ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = color; ctx.lineWidth = e.width || 1.25;
      if (e.dashed) ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
      // рисуем ребро постепенно
      const t = clamp((reveal - (e.at ?? 0)) / 0.2);
      ctx.lineTo(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t); ctx.stroke();
      ctx.restore();
      if (e.label && t > 0.95 && !(narrow && e.hideNarrow)) {
        const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
        const lines = narrow && e.labelLines ? e.labelLines : [e.label];
        lines.forEach((ln, j) => text(ln, mx + (narrow && e.dxn != null ? e.dxn : (e.dx || 0)), my + (e.dy || 0) + j * 13 - (lines.length - 1) * 6, { size: narrow ? 10 : 11.5, weight: 500, color: e.dashed ? C['fg-2'] : C.fg, align: 'center', base: 'middle', alpha: a }));
      }
    }
    // узлы
    for (const [, b] of box) {
      const n = b.n, a = nodeA(n);
      if (a <= 0.01) continue;
      ctx.save(); ctx.globalAlpha *= a;
      const color = n.color || C['fg-3'];
      ctx.fillStyle = C['panel-2']; ctx.strokeStyle = color; ctx.lineWidth = n.kind === 'person' ? 1.25 : 1.5;
      if (n.kind === 'person') {
        roundRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, b.h / 2); ctx.fill(); ctx.stroke();
        // силуэт
        const ix = b.x - b.w / 2 + 14, iy = b.y;
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(ix, iy - 4, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ix, iy + 6, 5.5, Math.PI, 0); ctx.fill();
      } else {
        roundRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 8); ctx.fill(); ctx.stroke();
      }
      const tx = n.kind === 'person' ? b.x + 8 : b.x;
      text(b.label, tx, b.sub ? b.y - 7 : b.y, { size: narrow ? 11.5 : 13, weight: 600, color: C.fg, align: 'center', base: 'middle', halo: false });
      if (b.sub) text(b.sub, tx, b.y + 9, { size: narrow ? 10 : 11, color: C['fg-2'], align: 'center', base: 'middle', halo: false });
      ctx.restore();
    }
    if (G.legend) {
      const legend = narrow && G.legendShort ? G.legendShort : G.legend;
      const ly = H - pad.b + 2;
      ctx.save(); ctx.strokeStyle = C.fg; ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.moveTo(pad.l + 8, ly); ctx.lineTo(pad.l + 30, ly); ctx.stroke();
      const w1 = text(legend[0], pad.l + 38, ly, { size: 11, color: C['fg-3'], base: 'middle', halo: false });
      ctx.setLineDash([4, 4]); ctx.strokeStyle = C['fg-2'];
      ctx.beginPath(); ctx.moveTo(pad.l + 38 + w1 + 18, ly); ctx.lineTo(pad.l + 38 + w1 + 40, ly); ctx.stroke(); ctx.setLineDash([]);
      text(legend[1], pad.l + 38 + w1 + 48, ly, { size: 11, color: C['fg-3'], base: 'middle', halo: false });
      ctx.restore();
    }
    ctx.restore();
  }

  function shift(hms, secs) {
    const [h, m, s] = hms.split(':').map(Number);
    let t = h * 3600 + m * 60 + s + secs;
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(Math.floor(t / 3600))}:${p2(Math.floor((t % 3600) / 60))}:${p2(t % 60)}`;
  }

  return { resize, set, colors: C };
}
