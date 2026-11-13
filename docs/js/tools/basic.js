import { el, clean, dialog } from '../core.js';

export function mountText(host, ctx) {
  const ed = el('div', { class: 'ed', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', html: clean(ctx.get() || '') });
  const cmd = (c, label, title) => el('button', { type: 'button', html: label, title, onmousedown: e => e.preventDefault(), onclick: () => { document.execCommand(c); save(); ed.focus(); } });
  const save = () => ctx.set(clean(ed.innerHTML));
  ed.addEventListener('input', save);
  ed.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
  host.append(el('div', { class: 'tb' },
    cmd('bold', '<b>B</b>', 'Bold'), cmd('italic', '<i>I</i>', 'Italic'), cmd('underline', '<u>U</u>', 'Underline'),
    cmd('subscript', 'x<sub>2</sub>', 'Subscript'), cmd('superscript', 'x<sup>2</sup>', 'Superscript'),
    cmd('insertUnorderedList', '• List', 'Bulleted list'), cmd('undo', '↶', 'Undo')), ed);
}
export const viewText = v => el('div', { class: 'ans', html: clean(v || '') || '<span class="mut">No answer</span>' });

const PW = 560, PH = 300;
export function mountDraw(host, ctx, opt) {
  const c = el('canvas', { class: 'pad', width: PW, height: PH, style: 'width:100%;max-width:' + PW + 'px', 'aria-label': 'Drawing pad' });
  const g = c.getContext('2d');
  let pen = 'pen', hist = [];
  const base = () => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, PW, PH); g.strokeStyle = '#ececec'; g.lineWidth = 1;
    for (let x = 0; x <= PW; x += 20) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, PH); g.stroke(); }
    for (let y = 0; y <= PH; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(PW, y); g.stroke(); }
    const ax = opt && opt.draw;
    if (ax && ax.ax) {
      const L = 60, B = PH - 40, R = PW - 14, T = 12;
      g.strokeStyle = '#1d1d1f'; g.lineWidth = 2; g.beginPath(); g.moveTo(L, T); g.lineTo(L, B); g.lineTo(R, B); g.stroke();
      g.fillStyle = '#1d1d1f'; g.font = '11px system-ui'; g.lineWidth = 1;
      const xt = ax.xt || [], yt = ax.yt || [];
      g.textAlign = 'center';
      xt.forEach((t, i) => { const x = L + (R - L) * i / Math.max(1, xt.length - 1); g.beginPath(); g.moveTo(x, B); g.lineTo(x, B + 5); g.stroke(); g.fillText(t, x, B + 16); });
      g.textAlign = 'right';
      yt.forEach((t, i) => { const y = B - (B - T) * i / Math.max(1, yt.length - 1); g.beginPath(); g.moveTo(L - 5, y); g.lineTo(L, y); g.stroke(); g.fillText(t, L - 8, y + 4); });
      g.textAlign = 'center'; g.font = '12px system-ui'; g.fillText(ax.ax[0] || '', (L + R) / 2, PH - 6);
      g.save(); g.translate(14, (T + B) / 2); g.rotate(-Math.PI / 2); g.fillText(ax.ax[1] || '', 0, 0); g.restore();
    }
  };
  base();
  const saved = ctx.get();
  if (saved && saved.startsWith('data:image/png')) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0); im.src = saved; }
  const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * PW / r.width, (e.clientY - r.top) * PH / r.height]; };
  let down = false, px, py;
  c.onpointerdown = e => { down = true; [px, py] = pos(e); hist.push(c.toDataURL()); if (hist.length > 20) hist.shift(); c.setPointerCapture(e.pointerId); };
  c.onpointermove = e => {
    if (!down) return;
    const [x, y] = pos(e);
    g.strokeStyle = pen === 'pen' ? '#1d1d1f' : '#fff'; g.lineWidth = pen === 'pen' ? 2.2 : 18; g.lineCap = 'round';
    g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke(); px = x; py = y;
  };
  c.onpointerup = () => { if (down) { down = false; ctx.set(c.toDataURL()); } };
  const pb = el('button', { type: 'button', text: 'Pen', class: 'on' }), eb = el('button', { type: 'button', text: 'Eraser' });
  pb.onclick = () => { pen = 'pen'; pb.classList.add('on'); eb.classList.remove('on'); };
  eb.onclick = () => { pen = 'eraser'; eb.classList.add('on'); pb.classList.remove('on'); };
  host.append(el('div', { class: 'tools' }, pb, eb,
    el('button', { type: 'button', text: 'Undo', onclick: () => { const u = hist.pop(); if (!u) return; const im = new Image(); im.onload = () => { g.drawImage(im, 0, 0); ctx.set(c.toDataURL()); }; im.src = u; } }),
    el('button', { type: 'button', text: 'Clear', onclick: async () => { if (await dialog({ title: 'Clear the drawing?', body: '', ok: 'Clear', danger: true })) { base(); ctx.set(''); } } })), c);
}
export const viewDraw = v => v && v.startsWith('data:image/png') ? el('img', { src: v, alt: 'Drawing', style: 'max-width:100%;border:1px solid var(--ln);border-radius:6px' }) : el('span', { class: 'mut', text: 'No drawing' });

export function mountTable(host, ctx, opt) {
  const t = opt.table || { rows: [], cols: [] };
  let v = []; try { v = JSON.parse(ctx.get() || '[]'); } catch {}
  const tb = el('table', { style: 'width:auto' });
  tb.append(el('tr', null, el('th'), t.cols.map(c => el('th', { text: c }))));
  t.rows.forEach((r, i) => tb.append(el('tr', null, el('th', { text: r }), t.cols.map((_, j) => el('td', null, el('input', {
    value: (v[i] || [])[j] || '', style: 'width:84px', 'aria-label': r + ' ' + t.cols[j],
    oninput: e => { (v[i] = v[i] || [])[j] = e.target.value; ctx.set(JSON.stringify(v)); }
  }))))));
  host.append(el('div', { style: 'overflow-x:auto;margin:6px 0' }, tb));
}
export function viewTable(val, opt) {
  const t = opt.table || { rows: [], cols: [] };
  let v = []; try { v = JSON.parse(val || '[]'); } catch {}
  return el('table', { style: 'width:auto' }, el('tr', null, el('th'), t.cols.map(c => el('th', { text: c }))),
    t.rows.map((r, i) => el('tr', null, el('th', { text: r }), t.cols.map((_, j) => el('td', { text: (v[i] || [])[j] || '' })))));
}

const GW = 480, GH = 330, M = 54;
function drawGraph(g, G) {
  const X = x => M + (x - G.x0) / (G.x1 - G.x0) * (GW - M - 12), Y = y => GH - M - (y - G.y0) / (G.y1 - G.y0) * (GH - M - 12);
  g.fillStyle = '#fff'; g.fillRect(0, 0, GW, GH); g.font = '11px system-ui'; g.textAlign = 'center'; g.fillStyle = '#1d1d1f';
  g.strokeStyle = '#ececec'; g.lineWidth = 1;
  if (G.xs > 0) for (let x = G.x0; x <= G.x1 + 1e-9; x += G.xs) { g.beginPath(); g.moveTo(X(x), 12); g.lineTo(X(x), GH - M); g.stroke(); g.fillText(+x.toFixed(4), X(x), GH - M + 15); }
  g.textAlign = 'right';
  if (G.ys > 0) for (let y = G.y0; y <= G.y1 + 1e-9; y += G.ys) { g.beginPath(); g.moveTo(M, Y(y)); g.lineTo(GW - 12, Y(y)); g.stroke(); g.fillText(+y.toFixed(4), M - 5, Y(y) + 4); }
  g.strokeStyle = '#1d1d1f'; g.lineWidth = 2; g.beginPath(); g.moveTo(M, 12); g.lineTo(M, GH - M); g.lineTo(GW - 12, GH - M); g.stroke();
  g.textAlign = 'center'; g.font = '12px system-ui'; g.fillText(G.lx, (M + GW) / 2, GH - 16);
  g.save(); g.translate(14, (GH - M) / 2); g.rotate(-Math.PI / 2); g.fillText(G.ly, 0, 0); g.restore();
  const ps = [...G.p].sort((a, b) => a.x - b.x);
  g.strokeStyle = '#8c1c2b'; g.fillStyle = '#8c1c2b'; g.lineWidth = 1.8;
  if (G.cn && ps.length > 1) { g.beginPath(); ps.forEach((p, i) => i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))); g.stroke(); }
  ps.forEach(p => {
    g.beginPath(); g.arc(X(p.x), Y(p.y), 4, 0, Math.PI * 2); g.fill();
    if (p.e) { g.beginPath(); g.moveTo(X(p.x), Y(p.y - p.e)); g.lineTo(X(p.x), Y(p.y + p.e)); g.moveTo(X(p.x) - 5, Y(p.y - p.e)); g.lineTo(X(p.x) + 5, Y(p.y - p.e)); g.moveTo(X(p.x) - 5, Y(p.y + p.e)); g.lineTo(X(p.x) + 5, Y(p.y + p.e)); g.stroke(); }
  });
}
const graphState = v => { const G = { lx: 'x', ly: 'y', x0: 0, x1: 10, xs: 1, y0: 0, y1: 10, ys: 1, p: [], cn: 1 }; try { Object.assign(G, JSON.parse(v || '{}')); } catch {} return G; };
export function mountGraph(host, ctx) {
  const G = graphState(ctx.get());
  const c = el('canvas', { class: 'pad', width: GW, height: GH, style: 'width:100%;max-width:' + GW + 'px', 'aria-label': 'Graph' });
  const g = c.getContext('2d');
  let mode = 'p';
  const sv = () => { ctx.set(JSON.stringify(G)); drawGraph(g, G); };
  const fields = [['lx', 'x-axis label', 'text'], ['ly', 'y-axis label', 'text'], ['x0', 'x min'], ['x1', 'x max'], ['xs', 'x step'], ['y0', 'y min'], ['y1', 'y max'], ['ys', 'y step']];
  const form = el('div', { class: 'row', style: 'gap:6px;margin:4px 0' }, fields.map(([k, label, type]) => el('label', { class: 'mut' }, label + ' ',
    el('input', { type: type || 'number', value: G[k], style: type ? 'width:130px' : 'width:70px', oninput: e => { G[k] = type ? e.target.value : +e.target.value; if (G.x1 > G.x0 && G.y1 > G.y0) sv(); } }))));
  const mb = (k, t) => el('button', { type: 'button', text: t, class: k === mode ? 'on' : '', onclick: e => { mode = k; e.target.parentNode.querySelectorAll('button[data-m]').forEach(b => b.classList.toggle('on', b === e.target)); }, 'data-m': k });
  host.append(form, el('div', { class: 'tools' }, mb('p', 'Plot point'), mb('e', 'Error bar'), mb('d', 'Delete point'),
    el('label', { class: 'mut' }, el('input', { type: 'checkbox', checked: !!G.cn, onchange: e => { G.cn = e.target.checked ? 1 : 0; sv(); } }), ' Connect points'),
    el('button', { type: 'button', text: 'Clear points', onclick: () => { G.p = []; sv(); } })), c);
  c.onclick = e => {
    const r = c.getBoundingClientRect(), px = (e.clientX - r.left) * GW / r.width, py = (e.clientY - r.top) * GH / r.height;
    const x = G.x0 + (px - M) / (GW - M - 12) * (G.x1 - G.x0), y = G.y0 + (GH - M - py) / (GH - M - 12) * (G.y1 - G.y0);
    if (x < G.x0 || x > G.x1 || y < G.y0 || y > G.y1) return;
    const near = G.p.reduce((b, p, i) => { const d = Math.abs(p.x - x) / (G.x1 - G.x0); return d < 0.03 && (!b || d < b.d) ? { i, d } : b; }, null);
    const r2 = v => Math.round(v * 1000) / 1000;
    if (mode === 'p') G.p.push({ x: r2(x), y: r2(y) });
    else if (mode === 'd' && near) G.p.splice(near.i, 1);
    else if (mode === 'e' && near) G.p[near.i].e = r2(Math.abs(y - G.p[near.i].y));
    sv();
  };
  drawGraph(g, G);
}
export function viewGraph(v) {
  const c = el('canvas', { width: GW, height: GH, style: 'max-width:100%;border:1px solid var(--ln);border-radius:6px' });
  drawGraph(c.getContext('2d'), graphState(v));
  return c;
}
