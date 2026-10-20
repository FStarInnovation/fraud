// Закреплённая сцена: прокрутка → (шаг k, прогресс u). Подписи, полоски шагов, переход к шагу по клику,
// режим воспроизведения (сцена прокручивает себя сама, пока зритель не вмешается).
import { gsap } from 'gsap';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

const ICONS = {
  idle: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z"/></svg>',
  playing: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2h2.6v8H2.5zM6.9 2h2.6v8H6.9z"/></svg>',
  end: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.2a3.8 3.8 0 1 1-3.6 2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.6 1.6v3.4H5z"/></svg>',
};
const LABELS = { idle: 'Показать', playing: 'Пауза', end: 'Сначала' };

export function createStage(section, steps, { reduce, onFrame, scrollTo, setScroll, secondsPerUnit = 4.2 }) {
  const total = steps.reduce((s, st) => s + st.w, 0);
  section.style.setProperty('--len', String(total));
  const cum = [];
  let acc = 0;
  for (const st of steps) { cum.push(acc); acc += st.w; }

  const capTitle = section.querySelector('.cap-title');
  const capSub = section.querySelector('.cap-sub');
  const capWrap = section.querySelector('.cap');
  const dotsEl = section.querySelector('.dots-row');
  const counter = section.querySelector('.dots-count');
  const playBtn = section.querySelector('.play');
  const dots = steps.map((st, j) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'dot';
    b.setAttribute('aria-label', `Шаг ${j + 1}: ${st.title}`);
    b.addEventListener('click', () => { pause(); go(j); });
    dotsEl.appendChild(b);
    return b;
  });

  let curK = -1, swapTimer = 0;
  function caption(k) {
    if (k === curK) return;
    const first = curK === -1;
    curK = k;
    dots.forEach((d, j) => { d.dataset.st = j < k ? 'done' : j === k ? 'now' : ''; d.setAttribute('aria-current', j === k ? 'step' : 'false'); });
    counter.textContent = `${k + 1} из ${steps.length}`;
    const apply = () => { capTitle.textContent = steps[k].title; capSub.textContent = steps[k].sub; capWrap.classList.remove('swap'); };
    clearTimeout(swapTimer);
    if (first || reduce) apply();
    else { capWrap.classList.add('swap'); swapTimer = setTimeout(apply, 170); }
  }

  function locate(p) {
    const x = clamp(p) * total;
    let k = steps.length - 1;
    for (let j = 0; j < steps.length; j++) if (x < cum[j] + steps[j].w) { k = j; break; }
    return { k, u: clamp((x - cum[k]) / steps[k].w) };
  }

  let lastP = 0;
  function render(p) {
    lastP = p;
    const { k, u } = locate(p);
    caption(k);
    dots[k].style.setProperty('--u', u.toFixed(3));
    onFrame(k, u);
    if (!tween) setState(p >= 0.985 ? 'end' : 'idle');
  }

  function bounds() {
    const top = section.getBoundingClientRect().top + window.scrollY;
    return { top, dist: section.offsetHeight - window.innerHeight };
  }
  function yFor(p) { const { top, dist } = bounds(); return top + p * dist; }

  function go(k, cb) {
    scrollTo(yFor((cum[k] + steps[k].w * 0.62) / total), cb);
  }
  function goStart(cb) { scrollTo(yFor(0), cb); }

  // ---------- воспроизведение ----------
  let tween = null, state = '';
  const proxyPlay = { p: 0 };
  function setState(st) {
    if (st === state || !playBtn) return;
    state = st;
    playBtn.dataset.st = st;
    playBtn.innerHTML = ICONS[st] + '<span>' + LABELS[st] + '</span>';
    playBtn.setAttribute('aria-label', st === 'playing' ? 'Остановить показ' : st === 'end' ? 'Показать схему сначала' : 'Показать схему автоматически');
  }
  function play() {
    if (tween) tween.kill();
    let from = lastP;
    if (from >= 0.985) from = 0;
    proxyPlay.p = from;
    setScroll(yFor(from));
    tween = gsap.to(proxyPlay, {
      p: 1, ease: 'none', duration: Math.max(0.5, (1 - from) * total * secondsPerUnit),
      onUpdate: () => setScroll(yFor(proxyPlay.p)),
      onComplete: () => { tween = null; setState('end'); },
    });
    setState('playing');
  }
  function pause() {
    if (!tween) return;
    tween.kill(); tween = null;
    setState(lastP >= 0.985 ? 'end' : 'idle');
  }
  if (playBtn) {
    playBtn.addEventListener('click', () => (tween ? pause() : play()));
    // любое вмешательство зрителя останавливает показ
    const interrupt = (e) => { if (tween && !(e.target && e.target.closest && e.target.closest('.play, .dot'))) pause(); };
    window.addEventListener('wheel', interrupt, { passive: true });
    window.addEventListener('touchstart', interrupt, { passive: true });
    window.addEventListener('pointerdown', interrupt, { passive: true });
    window.addEventListener('keydown', (e) => { if (tween && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key)) pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  }

  const proxy = { p: 0 };
  gsap.to(proxy, {
    p: 1, ease: 'none',
    scrollTrigger: { trigger: section, start: 'top top', end: 'bottom bottom', scrub: reduce ? true : 0.35 },
    onUpdate: () => render(proxy.p),
  });
  render(0);

  return { rerender: () => render(lastP), go, goStart, play, pause, isPlaying: () => !!tween };
}
