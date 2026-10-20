// Цвета разметки берём из CSS-переменных (их заполняет chart.colors при старте)
let PALETTE = {};
export function setPalette(p) { PALETTE = p; }
export function col(name) { return PALETTE[name] || '#fff'; }
