// Сборка: самодостаточные HTML-страницы (скрипты, стили и шрифты внутри — работают без внешних CDN).
//   docs/index.html     — весь сайт: первый экран, библиотека, схемы по порядку, финал (папка docs — её публикует GitHub Pages)
//   docs/preview.html   — тот же контент без <html>/<head>/<body> (для превью-артефакта)
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = (p) => new URL('./src/' + p, import.meta.url);
mkdirSync(new URL('./docs/', import.meta.url), { recursive: true });

const PAGES = [
  { tpl: 'index.html', entry: 'js/main.js', out: 'index.html', preview: 'preview.html' },
];

const css = (await transform(readFileSync(src('styles.css'), 'utf8'), { loader: 'css', minify: true, target: ['chrome100', 'safari15'] })).code;

const font = (file, range) => {
  const b64 = readFileSync(src('fonts/' + file)).toString('base64');
  return `@font-face{font-family:"Inter Variable";font-style:normal;font-display:swap;font-weight:100 900;src:url(data:font/woff2;base64,${b64}) format("woff2");unicode-range:${range}}`;
};
const fonts = [
  font('inter-latin-opsz-normal.woff2', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'),
  font('inter-cyrillic-opsz-normal.woff2', 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116'),
  font('inter-rub-opsz-normal.woff2', 'U+20BD'),
].join('\n');

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' КБ';

for (const page of PAGES) {
  const js = (await build({
    entryPoints: [src(page.entry).pathname],
    bundle: true, minify: true, format: 'iife', target: ['es2020', 'safari15'], write: false,
    legalComments: 'none', loader: { '.json': 'json' },
  })).outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

  let tpl = readFileSync(src(page.tpl), 'utf8');
  tpl = tpl.replace('/*FONTS*/', () => fonts).replace('/*CSS*/', () => css).replace('/*JS*/', () => js);
  const head = tpl.split('<!--HEAD-->')[1].split('<!--/HEAD-->')[0].trim();
  const body = tpl.split('<!--BODY-->')[1].split('<!--/BODY-->')[0].trim();

  const full = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
${head}
</head>
<body>
${body}
</body>
</html>
`;
  writeFileSync(new URL('./docs/' + page.out, import.meta.url), full);
  writeFileSync(new URL('./docs/' + page.preview, import.meta.url), `${head}\n${body}\n`);
  console.log(`docs/${page.out}`, kb(full), '| JS', kb(js), '| CSS', kb(css), '| шрифты', kb(fonts));
}
