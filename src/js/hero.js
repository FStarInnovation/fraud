// Первый экран: обычный график и «линза ТАФС», которая проявляет скрытых участников.
import { cssVars } from './chart.js';

function rng(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function series() {
  const r = rng(77);
  const n = 220, out = [];
  let p = 100;
  const events = [
    { at: 52, len: 7, kind: 'front', label: 'Опережающие сделки' },
    { at: 118, len: 6, kind: 'spoof', label: 'Спуфинг' },
    { at: 176, len: 9, kind: 'pump', label: 'Разгон и сброс' },
  ];
  for (let i = 0; i < n; i++) {
    const ev = events.find((e) => i >= e.at && i < e.at + e.len);
    let drift = (100 - p) * 0.04 + (r() - 0.5) * 0.5;
    let vM = 0.6 + r() * 0.6, vT = 0, vB = 0;
    if (ev) {
      const j = i - ev.at;
      if (ev.kind === 'front') { if (j < ev.len - 1) { drift = 0.35; vT = 2.2; } else { drift = 1.6; vB = 1.2; vT = 5.5; } }
      if (ev.kind === 'spoof') { drift = j < 3 ? 0.4 : -0.5; vT = 0.9; }
      if (ev.kind === 'pump') { drift = j < 5 ? 0.6 : -1.1; vT = j < 5 ? 1.8 : 2.4; }
    }
    const o = p, c = p + drift;
    const h = Math.max(o, c) + r() * 0.35, l = Math.min(o, c) - r() * 0.35;
    out.push({ o, c, h, l, vM, vT, vB, ev: ev && i === ev.at ? ev : null, inEv: !!ev });
    p = c;
  }
  return { bars: out, events };
}

export function createHero(canvas, { reduce }) {
  const ctx = canvas.getContext('2d');
  const C = cssVars(['fg', 'fg-2', 'fg-3', 'trader', 'bank', 'breach', 'candle-up', 'candle-down', 'vol', 'bg', 'line-2']);
  const FONT = '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
  const data = series();
  let W = 0, H = 0, dpr = 1;
  const dim = document.createElement('canvas'), lit = document.createElement('canvas'), lens = document.createElement('canvas');
  const pos = { x: 0, y: 0 }, target = { x: 0, y: 0 };
  let pointer = false, raf = 0, running = false, t0 = performance.now();

  function layer(cv, bright) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = data.bars.length;
    const step = W / n, bw = Math.max(1, step * 0.6);
    let lo = Infinity, hi = -Infinity, vmax = 0;
    for (const b of data.bars) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); vmax = Math.max(vmax, b.vM + b.vT + b.vB); }
    const priceTop = H * 0.08, priceBot = H * 0.7, volBot = H - 4, volTop = H * 0.76;
    const y = (p) => priceBot - ((p - lo) / (hi - lo)) * (priceBot - priceTop);
    const yv = (v) => volBot - (v / vmax) * (volBot - volTop);
    data.bars.forEach((b, i) => {
      const cx = step * (i + 0.5);
      const up = b.c >= b.o;
      g.fillStyle = g.strokeStyle = bright ? (up ? C['candle-up'] : C['candle-down']) : (up ? '#3a3a40' : '#232327');
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(cx) + 0.5, y(b.h)); g.lineTo(Math.round(cx) + 0.5, y(b.l)); g.stroke();
      const yt = y(Math.max(b.o, b.c)), yb = y(Math.min(b.o, b.c));
      g.fillRect(cx - bw / 2, yt, bw, Math.max(1, yb - yt));
      let base = volBot;
      const segs = bright ? [[b.vM, C.vol], [b.vB, C.bank], [b.vT, C.trader]] : [[b.vM + b.vB + b.vT, '#1f1f23']];
      for (const [q, color] of segs) {
        if (q <= 0) continue;
        const h = volBot - yv(q);
        g.fillStyle = color; g.fillRect(cx - bw / 2, base - h, bw, Math.max(1, h - 1)); base -= h;
      }
    });
    if (bright) {
      // скрытые заявки и метки схем
      g.font = `600 13px ${FONT}`;
      for (const ev of data.events) {
        const i0 = ev.at, i1 = ev.at + ev.len;
        let top = Infinity, bot = -Infinity;
        for (let i = i0; i < i1; i++) { top = Math.min(top, y(data.bars[i].h)); bot = Math.max(bot, y(data.bars[i].l)); }
        const x0 = step * i0 - 6, x1 = step * i1 + 6;
        if (ev.kind === 'spoof') {
          // ложные заявки: стенка пустых пунктирных полос над рынком, снятая до исполнения (крестик)
          const wx0 = step * i0, wx1 = step * (i0 + 4);
          for (let j = 0; j < 3; j++) {
            const ry = top - 9 - j * 7;
            g.strokeStyle = C.trader; g.lineWidth = 1.25; g.setLineDash([3, 2]);
            g.strokeRect(wx0 + 0.5, ry + 0.5, wx1 - wx0, 4);
            g.setLineDash([]);
          }
          const cy = top - 9 - 2 * 7 + 2, cx = wx1 + 7;
          g.strokeStyle = C.trader; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(cx - 3, cy - 3); g.lineTo(cx + 3, cy + 3); g.moveTo(cx + 3, cy - 3); g.lineTo(cx - 3, cy + 3); g.stroke();
          top = top - 9 - 2 * 7;
        }
        g.strokeStyle = C.breach; g.lineWidth = 1.25; g.setLineDash([3, 3]);
        g.strokeRect(x0, top - 8, x1 - x0, bot - top + 18); g.setLineDash([]);
        // подпись над рамкой; если рамка у верхнего края холста — под ней
        const ly = top - 30 > 4 ? top - 14 : bot + 28;
        g.fillStyle = C.fg; g.textAlign = 'center'; g.textBaseline = 'bottom';
        g.lineWidth = 4; g.strokeStyle = C.bg; g.strokeText(ev.label, (x0 + x1) / 2, ly); g.fillText(ev.label, (x0 + x1) / 2, ly);
      }
    }
    return { y, step };
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(10, r.width); H = Math.max(10, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    lens.width = canvas.width; lens.height = canvas.height;
    layer(dim, false); layer(lit, true);
    if (!pos.x) { pos.x = target.x = W * 0.3; pos.y = target.y = H * 0.42; }
    frame(true);
  }

  function radius() { return Math.max(W < 600 ? 104 : 84, Math.min(150, W * 0.11)); }

  function frame(force) {
    const now = performance.now();
    if (!pointer) {
      const ev = data.events[0];
      if (reduce) { target.x = (ev.at + ev.len / 2) / data.bars.length * W; target.y = H * 0.36; }
      else {
        const k = (now - t0) / 1000;
        target.x = W * (0.5 + 0.4 * Math.sin(k * 0.21));
        target.y = H * (0.42 + 0.14 * Math.sin(k * 0.37 + 1));
      }
    }
    const f = reduce || force ? 1 : 0.12;
    pos.x += (target.x - pos.x) * f; pos.y += (target.y - pos.y) * f;
    const R = radius();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(dim, 0, 0);
    const l = lens.getContext('2d');
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, lens.width, lens.height);
    const px = pos.x * dpr, py = pos.y * dpr, pr = R * dpr;
    l.drawImage(lit, px - pr, py - pr, pr * 2, pr * 2, px - pr, py - pr, pr * 2, pr * 2);
    l.globalCompositeOperation = 'destination-in';
    const grd = l.createRadialGradient(px, py, pr * 0.72, px, py, pr);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = grd; l.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    ctx.drawImage(lens, 0, 0);
    // визир
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(245,245,247,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(245,245,247,0.7)';
    for (let q = 0; q < 4; q++) {
      const ang = q * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(pos.x + Math.cos(ang) * (R - 7), pos.y + Math.sin(ang) * (R - 7));
      ctx.lineTo(pos.x + Math.cos(ang) * (R + 7), pos.y + Math.sin(ang) * (R + 7));
      ctx.stroke();
    }
    ctx.font = `600 11px ${FONT}`; ctx.fillStyle = 'rgba(245,245,247,0.75)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('ТАФС', pos.x + R * 0.72 + 8, pos.y + R * 0.72 + 8);
  }

  function loop() {
    frame(false);
    raf = running ? requestAnimationFrame(loop) : 0;
  }
  function start() { if (!running) { running = true; raf = requestAnimationFrame(loop); } }
  function stop() { running = false; cancelAnimationFrame(raf); }

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    pointer = true; target.x = e.clientX - r.left; target.y = e.clientY - r.top;
    if (reduce) frame(true);
  });
  canvas.addEventListener('pointerleave', () => { pointer = false; t0 = performance.now() - 0; });

  new ResizeObserver(() => resize()).observe(canvas);
  if (!reduce) {
    new IntersectionObserver((ents) => { ents[0].isIntersecting && !document.hidden ? start() : stop(); }).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  }
  return { resize, redraw: () => { layer(dim, false); layer(lit, true); frame(true); } };
}
