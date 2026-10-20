// Русское форматирование чисел: пробел-разделитель тысяч, запятая, знак ₽.
const nf = (d) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
const NF0 = nf(0), NF1 = nf(1), NF2 = nf(2);

export const int = (x) => NF0.format(Math.round(x));
export const price = (x) => NF2.format(x);
export const pct = (x, d = 1) => nf(d).format(x * 100) + ' %';
export const mln = (x, d = 2) => nf(d).format(x / 1e6) + ' млн';
export const rub = (x, d = 2) => nf(d).format(x / 1e6) + ' млн ₽';
export const signed = (x, f) => (x > 0 ? '+' : x < 0 ? '−' : '') + f(Math.abs(x));
export const ratio = (x) => NF0.format(x);
export const one = (x) => NF1.format(x);

// «11:00» + минуты → «11:41»; секунды опционально
export function clock(start, minutes, seconds) {
  const [h, m] = start.split(':').map(Number);
  let total = h * 3600 + m * 60 + Math.round(minutes * 60) + (seconds || 0);
  const hh = Math.floor(total / 3600), mm = Math.floor((total % 3600) / 60), ss = total % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return seconds === undefined ? `${p2(hh)}:${p2(mm)}` : `${p2(hh)}:${p2(mm)}:${p2(ss)}`;
}

export function duration(minutes) {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

// «около 2 часов»: если до круглого часа меньше 12 минут, округляем до часов
export function durationRound(minutes) {
  const h = Math.round(minutes / 60);
  if (h >= 1 && Math.abs(minutes - h * 60) <= 12) {
    const w = h % 10 === 1 && h % 100 !== 11 ? 'час' : [2, 3, 4].includes(h % 10) && ![12, 13, 14].includes(h % 100) ? 'часа' : 'часов';
    return `${h}\u00a0${w}`;
  }
  return duration(minutes);
}

export function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}
