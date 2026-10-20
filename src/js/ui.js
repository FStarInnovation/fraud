// DOM-часть сцены: стакан, счета участников, протокол ТАФС.
import * as F from './fmt.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

// ---------- number-flow с прореживанием обновлений ----------
export function flow(el, { decimals = 0, suffix = '', sign = false } = {}) {
  el.locales = 'ru-RU';
  el.format = { minimumFractionDigits: decimals, maximumFractionDigits: decimals, signDisplay: sign ? 'exceptZero' : 'auto' };
  if (suffix) el.numberSuffix = suffix;
  el.respectMotionPreference = true;
  let last = null, timer = 0, stamp = 0, pending = null;
  const push = (v) => { last = v; stamp = performance.now(); el.update(v); };
  return (v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return;
    const k = Math.round(v * 10 ** decimals) / 10 ** decimals;
    if (k === last) return;
    pending = k;
    const dt = performance.now() - stamp;
    if (dt > 160) { clearTimeout(timer); push(k); }
    else { clearTimeout(timer); timer = setTimeout(() => push(pending), 160 - dt); }
  };
}

// ---------- стакан ----------
export function createBook(root) {
  const asksEl = root.querySelector('.book-asks');
  const bidsEl = root.querySelector('.book-bids');
  const midPx = root.querySelector('.mid-px');
  const bo = root.querySelector('.bank-order');
  const boQ = root.querySelector('.bo-q');
  const boBar = root.querySelector('.bo-bar i');
  const split = root.querySelector('.split');
  const sM = root.querySelector('.s-m');
  const sT = root.querySelector('.s-t');
  const sMv = root.querySelector('.s-m-v');
  const sTv = root.querySelector('.s-t-v');
  const rows = new Map();
  let rowH = 24;

  function row(key) {
    let el = rows.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'row';
      el.innerHTML = '<i class="bar"></i><i class="hit"></i><span class="px"></span><span class="q"></span>';
      el._px = el.querySelector('.px'); el._q = el.querySelector('.q');
      el._bar = el.querySelector('.bar'); el._hit = el.querySelector('.hit');
      rows.set(key, el);
    }
    return el;
  }

  function capacity() {
    const probe = asksEl.firstElementChild;
    if (probe) rowH = probe.getBoundingClientRect().height || rowH;
    const a = Math.floor(asksEl.clientHeight / rowH);
    const b = Math.floor(bidsEl.clientHeight / rowH);
    return { asks: Math.max(3, a), bids: Math.max(2, b) };
  }

  function place(container, list, used, max) {
    let prev = null;
    for (const it of list) {
      const el = row(it.key);
      used.add(it.key);
      el.className = 'row ' + it.side + (it.trader ? ' trader' : '') + (it.by ? ' by-' + it.by : '') + (it.target ? ' target' : '') + (it.hit >= 1 ? ' gone' : it.hit > 0 ? ' hitting' : '');
      const px = F.price(it.price), q = F.int(Math.max(0, it.qty - it.qty * it.hit));
      if (el._px.textContent !== px) el._px.textContent = px;
      const qText = it.hit >= 1 ? F.int(it.qty) : q;
      if (el._q.textContent !== qText) el._q.textContent = qText;
      const w = it.qty > 0 ? Math.max(0.012, it.qty / max) : 0;
      el._bar.style.transform = `scaleX(${w})`;
      el._hit.style.transform = `scaleX(${it.qty > 0 ? Math.max(it.hit > 0 ? 0.012 : 0, (it.qty * it.hit) / max) : 0})`;
      el.style.opacity = String(it.alpha ?? 1);
      const want = prev ? prev.nextSibling : container.firstChild;
      if (el.parentNode !== container || want !== el) container.insertBefore(el, want);
      prev = el;
    }
  }

  function update(s) {
    const used = new Set();
    place(asksEl, s.asks, used, s.maxQty);
    place(bidsEl, s.bids, used, s.maxQty);
    for (const [k, el] of rows) if (!used.has(k)) { el.remove(); rows.delete(k); }
    const mp = F.price(s.price);
    if (midPx.textContent !== mp) midPx.textContent = mp;
    bo.style.opacity = String(s.bank.a);
    bo.hidden = s.bank.a <= 0.01;
    boQ.textContent = `${F.int(s.bank.V)} из ${F.int(s.bank.total)}`;
    boBar.style.transform = `scaleX(${s.bank.total ? s.bank.V / s.bank.total : 0})`;
    split.style.opacity = String(s.split.a);
    split.hidden = s.split.a <= 0.01;
    sM.style.transform = `scaleX(${s.split.small})`;
    sT.style.transform = `scaleX(${s.split.trader})`;
    sMv.textContent = F.pct(s.split.smallShare, 0);
    sTv.textContent = F.pct(s.split.traderShare, 0);
  }

  return { update, capacity };
}

// ---------- счета ----------
export function createAccounts(root) {
  const q = (s) => root.querySelector(s);
  const tr = q('.acc-trader'), bk = q('.acc-bank'), leak = q('.leak'), intent = q('.intent');
  const f = {
    tShares: flow(q('[data-f="t-shares"]')),
    tAvg: flow(q('[data-f="t-avg"]'), { decimals: 2 }),
    tRes: flow(q('[data-f="t-res"]'), { decimals: 2, suffix: ' млн ₽', sign: true }),
    bQty: flow(q('[data-f="b-qty"]')),
    bAvg: flow(q('[data-f="b-avg"]'), { decimals: 2 }),
    bMtm: flow(q('[data-f="b-mtm"]'), { decimals: 2, suffix: ' млн ₽', sign: true }),
  };
  const slots = {};
  root.querySelectorAll('[data-slot]').forEach((el) => { slots[el.dataset.slot] = el; });
  const show = (key, on) => { const el = slots[key]; if (el && el.dataset.on !== String(on)) { el.dataset.on = String(on); } };

  function update(s) {
    f.tShares(s.trader.shares);
    show('t-avg', s.trader.avg != null); if (s.trader.avg != null) f.tAvg(s.trader.avg);
    show('t-res', s.trader.result != null); if (s.trader.result != null) f.tRes(s.trader.result / 1e6);
    f.bQty(s.bank.bought);
    show('b-avg', s.bank.avg != null); if (s.bank.avg != null) f.bAvg(s.bank.avg);
    show('b-mtm', s.bank.mtm != null); if (s.bank.mtm != null) f.bMtm(s.bank.mtm / 1e6);
    tr.style.setProperty('--glow', String(s.trader.glow || 0));
    bk.style.setProperty('--glow', String(s.bank.glow || 0));
    intent.style.opacity = String(s.bank.intent);
    leak.style.setProperty('--a', String(s.leak));
    root.dataset.res = s.trader.result != null && s.trader.result > 0 ? 'profit' : '';
    root.dataset.mtm = s.bank.mtm != null && s.bank.mtm < 0 ? 'loss' : '';
  }
  return { update };
}

// ---------- протокол ТАФС со скором риска ----------
// items[j].points — вклад проверки в риск; score.bands — зоны [{from, label}]
export function createProtocol(root, items, score) {
  const list = root.querySelector('.proto-list');
  const status = root.querySelector('.proto-status');
  const scoreFlow = flow(root.querySelector('[data-f="score"]'));
  const bandEl = root.querySelector('.score-band');
  const fillEl = root.querySelector('.score-fill');
  const bands = (score && score.bands) || [{ from: 0, label: '' }];
  const bandFor = (v) => { let b = bands[0]; for (const x of bands) if (v >= x.from) b = x; return b; };
  const bandIndex = (v) => bands.indexOf(bandFor(v));
  const total = items.reduce((s, it) => s + (it.points || 0), 0);
  root.querySelectorAll('.score-tick').forEach((t, j) => { const b = bands[j + 1]; if (b) t.style.left = b.from + '%'; else t.hidden = true; });

  const els = items.map((it, j) => {
    const li = document.createElement('li');
    li.className = 'pi' + (it.critical ? ' critical' : '');
    li.innerHTML = `<span class="pi-n">${j + 1}</span><span class="pi-t"></span><span class="pi-v"></span><span class="pi-p"></span>`;
    li.querySelector('.pi-t').textContent = it.finding;
    li.querySelector('.pi-v').textContent = it.value;
    li.querySelector('.pi-p').textContent = it.points ? '+' + it.points : '';
    list.appendChild(li);
    return li;
  });

  function update(k, u) {
    let sum = 0;
    els.forEach((li, j) => {
      const st = j < k ? 'done' : j === k ? (u > 0.25 ? 'now' : 'pending') : 'pending';
      if (li.dataset.st !== st) li.dataset.st = st;
      const counted = j < k || (j === k && u > 0.45);
      if (counted) sum += items[j].points || 0;
      const pst = counted ? 'on' : 'off';
      if (li.dataset.pts !== pst) li.dataset.pts = pst;
    });
    scoreFlow(sum);
    const band = bandFor(sum);
    if (bandEl.textContent !== band.label) bandEl.textContent = band.label;
    const bi = String(bandIndex(sum));
    if (root.dataset.band !== bi) root.dataset.band = bi;
    fillEl.style.transform = `scaleX(${sum / 100})`;
    const on = k === items.length - 1 && u > 0.45;
    if (status.dataset.on !== String(on)) status.dataset.on = String(on);
  }
  return { update, total, band: bandFor(total).label };
}

export { clamp };
