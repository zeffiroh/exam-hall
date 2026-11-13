import { el, cleanSvg, typeset, isDark } from './core.js';
import { drawIso } from './tools/iso.js';

const NS = 'http://www.w3.org/2000/svg';
let clipN = 0;
const sv = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

function circum(A, B, C) {
  const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
  const a2 = A[0] ** 2 + A[1] ** 2, b2 = B[0] ** 2 + B[1] ** 2, c2 = C[0] ** 2 + C[1] ** 2;
  const x = (a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / d;
  const y = (a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / d;
  return { c: [x, y], r: Math.hypot(A[0] - x, A[1] - y) };
}
function incircle(A, B, C) {
  const a = Math.hypot(B[0] - C[0], B[1] - C[1]), b = Math.hypot(A[0] - C[0], A[1] - C[1]), c = Math.hypot(A[0] - B[0], A[1] - B[1]), p = a + b + c;
  const x = (a * A[0] + b * B[0] + c * C[0]) / p, y = (a * A[1] + b * B[1] + c * C[1]) / p;
  const s = p / 2, area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
  return { c: [x, y], r: area / s };
}

export function geoSvg(f) {
  const P = f.pts || {}, items = f.items || [];
  const circles = [];
  for (const it of items) {
    if (it[0] === 'circle') circles.push({ c: P[it[1]], r: Math.hypot(P[it[2]][0] - P[it[1]][0], P[it[2]][1] - P[it[1]][1]) });
    if (it[0] === 'circleR') circles.push({ c: P[it[1]], r: it[2] });
    if (it[0] === 'circum') circles.push(circum(P[it[1]], P[it[2]], P[it[3]]));
    if (it[0] === 'incircle') circles.push(incircle(P[it[1]], P[it[2]], P[it[3]]));
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  Object.values(P).forEach(p => grow(p[0], p[1]));
  circles.forEach(c => { grow(c.c[0] - c.r, c.c[1] - c.r); grow(c.c[0] + c.r, c.c[1] + c.r); });
  items.filter(i => i[0] === 'text').forEach(i => grow(i[1], i[2]));
  if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1; }
  const w = f.w || 360, h = f.h || 280, pad = 26;
  const k = Math.min((w - 2 * pad) / ((x1 - x0) || 1), (h - 2 * pad) / ((y1 - y0) || 1));
  const offx = (w - (x1 - x0) * k) / 2, offy = (h - (y1 - y0) * k) / 2;
  const X = x => offx + (x - x0) * k, Y = y => h - offy - (y - y0) * k;
  const S = n => [X(P[n][0]), Y(P[n][1])];
  const svg = sv('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', role: 'img', 'aria-label': f.cap || 'Geometry diagram', style: `max-width:${w}px` });
  const g = sv('g', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  svg.append(g);
  const line = (a, b, extra = {}) => g.append(sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], ...extra }));
  const extend = (a, b, back) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, far = 2000;
    return [[a[0] - (back ? dx / L * far : 0), a[1] - (back ? dy / L * far : 0)], [b[0] + dx / L * far, b[1] + dy / L * far]];
  };
  const cid = 'gclip' + (++clipN);
  svg.insertBefore(sv('clipPath', { id: cid }), g).append(sv('rect', { x: 0, y: 0, width: w, height: h }));
  g.setAttribute('clip-path', 'url(#' + cid + ')');
  const cen = Object.values(P).reduce((a, p, _, arr) => [a[0] + p[0] / arr.length, a[1] + p[1] / arr.length], [0, 0]);
  for (const it of items) {
    const [t, ...a] = it;
    if (t === 'seg') line(S(a[0]), S(a[1]));
    else if (t === 'dashed') line(S(a[0]), S(a[1]), { 'stroke-dasharray': '5 4' });
    else if (t === 'line') { const [p, q] = extend(S(a[0]), S(a[1]), true); line(p, q); }
    else if (t === 'ray') { const [, q] = extend(S(a[0]), S(a[1]), false); line(S(a[0]), q); }
    else if (t === 'poly') g.append(sv('polygon', { points: a.map(n => S(n).join(',')).join(' ') }));
    else if (t === 'circle' || t === 'circleR' || t === 'circum' || t === 'incircle') {
      const c = t === 'circle' ? { c: P[a[0]], r: Math.hypot(P[a[1]][0] - P[a[0]][0], P[a[1]][1] - P[a[0]][1]) } : t === 'circleR' ? { c: P[a[0]], r: a[1] } : (t === 'circum' ? circum : incircle)(P[a[0]], P[a[1]], P[a[2]]);
      g.append(sv('circle', { cx: X(c.c[0]), cy: Y(c.c[1]), r: c.r * k }));
    } else if (t === 'angle' || t === 'right') {
      const A = S(a[0]), B = S(a[1]), C = S(a[2]);
      const u = [A[0] - B[0], A[1] - B[1]], v = [C[0] - B[0], C[1] - B[1]], lu = Math.hypot(...u), lv = Math.hypot(...v);
      const r = t === 'right' ? 11 : 20;
      const pu = [B[0] + u[0] / lu * r, B[1] + u[1] / lu * r], pv = [B[0] + v[0] / lv * r, B[1] + v[1] / lv * r];
      if (t === 'right') g.append(sv('polyline', { points: `${pu} ${pu[0] + v[0] / lv * r},${pu[1] + v[1] / lv * r} ${pv}` }));
      else {
        const sweep = (u[0] * v[1] - u[1] * v[0]) > 0 ? 1 : 0;
        g.append(sv('path', { d: `M${pu}A${r},${r} 0 0 ${sweep} ${pv}`, stroke: 'var(--mar)' }));
        if (a[3]) {
          const m = [u[0] / lu + v[0] / lv, u[1] / lu + v[1] / lv], lm = Math.hypot(...m) || 1;
          const tx = sv('text', { x: B[0] + m[0] / lm * (r + 13), y: B[1] + m[1] / lm * (r + 13) + 4, 'text-anchor': 'middle', fill: 'var(--mar)', stroke: 'none', 'font-size': 13, 'font-style': 'italic' });
          tx.textContent = a[3]; svg.append(tx);
        }
      }
    } else if (t === 'tick') {
      const A = S(a[0]), B = S(a[1]), n = a[2] || 1, m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const d = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(...d), u = [d[0] / L, d[1] / L], nrm = [-u[1], u[0]];
      for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * 4; const c = [m[0] + u[0] * o, m[1] + u[1] * o]; line([c[0] - nrm[0] * 5, c[1] - nrm[1] * 5], [c[0] + nrm[0] * 5, c[1] + nrm[1] * 5]); }
    } else if (t === 'dot') svg.append(sv('circle', { cx: S(a[0])[0], cy: S(a[0])[1], r: 3, fill: 'currentColor' }));
    else if (t === 'text') { const tx = sv('text', { x: X(a[0]), y: Y(a[1]), 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 13, 'font-style': 'italic' }); tx.textContent = a[2]; svg.append(tx); }
  }
  const DIR = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [.7, -.7], nw: [-.7, -.7], se: [.7, .7], sw: [-.7, .7] };
  for (const [n, p] of Object.entries(P)) {
    const pos = (f.labels || {})[n];
    if (pos === 'none') continue;
    let d = DIR[pos];
    if (!d) { const v = [p[0] - cen[0], -(p[1] - cen[1])], L = Math.hypot(...v); d = L < 1e-6 ? [0, -1] : [v[0] / L, v[1] / L]; }
    const [x, y] = S(n);
    svg.append(sv('circle', { cx: x, cy: y, r: 2.4, fill: 'currentColor' }));
    const tx = sv('text', { x: x + d[0] * 13, y: y + d[1] * 13 + 5, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 15, 'font-style': 'italic', 'font-family': 'Georgia,serif' });
    tx.textContent = n; svg.append(tx);
  }
  return svg;
}

let chartLib;
const loadChart = () => chartLib || (chartLib = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'; s.onload = ok; s.onerror = no; document.head.append(s); }));
const errorBars = {
  id: 'err',
  afterDatasetsDraw(c) {
    const g = c.ctx, ink = getComputedStyle(document.documentElement).getPropertyValue('--ink');
    c.data.datasets.forEach((d, i) => {
      if (!d.err) return;
      const meta = c.getDatasetMeta(i); if (meta.hidden) return;
      meta.data.forEach((pt, j) => {
        const e = d.err[j]; if (!e) return;
        const y = c.scales.y, top = y.getPixelForValue(d.data[j] + e), bot = y.getPixelForValue(d.data[j] - e);
        g.save(); g.strokeStyle = ink; g.lineWidth = 1.2; g.beginPath();
        g.moveTo(pt.x, top); g.lineTo(pt.x, bot); g.moveTo(pt.x - 4, top); g.lineTo(pt.x + 4, top); g.moveTo(pt.x - 4, bot); g.lineTo(pt.x + 4, bot);
        g.stroke(); g.restore();
      });
    });
  }
};
async function chart(host, cfg0) {
  await loadChart();
  const cfg = JSON.parse(JSON.stringify(cfg0)), dk = isDark(), tc = dk ? '#f1ebe8' : '#1d1d1f', gc = 'rgba(128,128,128,.28)';
  const o = cfg.options = cfg.options || {};
  o.responsive = true; o.animation = false;
  o.plugins = o.plugins || {}; o.plugins.legend = Object.assign(o.plugins.legend || {}, { labels: { color: tc } });
  o.scales = o.scales || {};
  for (const a of Object.keys(o.scales).length ? Object.keys(o.scales) : ['x', 'y']) {
    const s = o.scales[a] = o.scales[a] || {};
    s.ticks = Object.assign(s.ticks || {}, { color: tc }); s.grid = { color: gc };
    if (s.title) s.title.color = tc;
  }
  if (dk) cfg.data.datasets.forEach(d => { ['backgroundColor', 'borderColor'].forEach(k => { if (d[k] === '#555') d[k] = '#bbb'; }); });
  cfg.plugins = [errorBars];
  const c = el('canvas'); host.append(c);
  return new window.Chart(c, cfg);
}

const packs = {};
const loadPack = name => packs[name] || (packs[name] = import('../packs/' + name + '.js').then(m => m.default));

export async function renderFig(host, f, card, opts = {}) {
  const box = el('div', { class: 'fig' });
  host.append(box);
  try {
    if (f.t === 'svg') box.innerHTML = cleanSvg(f.svg);
    else if (f.t === 'geo') box.append(geoSvg(f));
    else if (f.t === 'iso') { const c = el('canvas', { width: f.w || 480, height: f.h || 300, style: 'max-width:100%' }); drawIso(c.getContext('2d'), f, f.w || 480, f.h || 300, { s: f.s || 30 }); box.append(c); }
    else if (f.t === 'table') box.append(el('table', null, f.head ? el('tr', null, f.head.map(x => el('th', { html: x }))) : null, (f.rows || []).map(r => el('tr', null, r.map(x => el('td', { html: x }))))));
    else if (f.t === 'chart') { const ch = await chart(box, f.cfg); if (opts.charts) opts.charts.push(ch); }
    else if (f.t === 'img') box.append(el('img', { src: f.src, alt: f.alt || '', style: 'max-width:100%' }));
    else if (f.t === 'html') box.innerHTML = f.html;
    else if (f.t === 'mod' && opts.pack) { const p = await loadPack(opts.pack); await p.mount(box, f, card); }
    if (f.cap) box.append(el('div', { class: 'cap', html: f.cap }));
  } catch (e) {
    box.append(el('div', { class: 'cap', text: 'This figure could not be displayed.' }));
  }
  return box;
}

export async function renderStim(host, card, opts = {}) {
  host.innerHTML = card.stim || '';
  const figs = card.figs || [];
  const used = new Set();
  const jobs = [];
  host.querySelectorAll('[data-fig]').forEach(ph => {
    const i = +ph.dataset.fig; const f = figs[i]; if (!f) return; used.add(i);
    const slot = el('div'); ph.replaceWith(slot); jobs.push(renderFig(slot, f, card, opts));
  });
  figs.forEach((f, i) => { if (!used.has(i)) jobs.push(renderFig(host, f, card, opts)); });
  await Promise.all(jobs);
  await typeset(host);
}

