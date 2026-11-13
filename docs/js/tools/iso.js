import { el, dialog } from '../core.js';

const W = 600, H = 420;
const C30 = Math.cos(Math.PI / 6);

export function projector(s, ox, oy) {
  return {
    p: (x, y, z) => ({ x: ox + (x - y) * s * C30, y: oy + (x + y) * s / 2 - z * s }),
    lat: (a, b) => ({ x: ox + a * s * C30, y: oy + b * s / 2 }),
    toLat: (px, py) => {
      const fa = (px - ox) / (s * C30), fb = (py - oy) / (s / 2);
      let best = null, bd = Infinity;
      for (let a = Math.floor(fa) - 1; a <= Math.ceil(fa) + 1; a++) {
        for (let b = Math.floor(fb) - 2; b <= Math.ceil(fb) + 2; b++) {
          if (((a - b) % 2 + 2) % 2) continue;
          const q = { x: ox + a * s * C30, y: oy + b * s / 2 }, d = Math.hypot(q.x - px, q.y - py);
          if (d < bd) { bd = d; best = [a, b]; }
        }
      }
      return { ab: best, d: bd };
    },
    ground: (px, py) => {
      const u = (px - ox) / (s * C30), v = (py - oy) / (s / 2);
      return [Math.floor((u + v) / 2), Math.floor((v - u) / 2)];
    }
  };
}

function faces(P, [x, y, z]) {
  return {
    top: [P(x, y, z + 1), P(x + 1, y, z + 1), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)],
    right: [P(x + 1, y, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x + 1, y, z + 1)],
    left: [P(x, y + 1, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)]
  };
}
const FILL = { top: '#f3dfe2', left: '#d98a96', right: '#a3202f' };
const inPoly = (pt, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
const order = cubes => [...cubes].sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]) || a[2] - b[2]);

export function drawIso(g, st, w = W, h = H, opt = {}) {
  const s = opt.s || 34, pr = projector(s, w / 2, opt.oy || h * 0.45);
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  if (st.dots !== false) {
    g.fillStyle = '#b9b0b2';
    const na = Math.ceil(w / (s * C30)) + 2, nb = Math.ceil(h / (s / 2)) + 2;
    for (let a = -na; a <= na; a++) for (let b = -nb; b <= nb; b++) {
      if (((a - b) % 2 + 2) % 2) continue;
      const q = pr.lat(a, b);
      if (q.x < -2 || q.x > w + 2 || q.y < -2 || q.y > h + 2) continue;
      g.beginPath(); g.arc(q.x, q.y, 1.6, 0, Math.PI * 2); g.fill();
    }
  }
  g.lineJoin = 'round';
  for (const c of order(st.cubes || [])) {
    const f = faces(pr.p, c);
    for (const k of ['left', 'right', 'top']) {
      g.beginPath(); f[k].forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.closePath();
      g.fillStyle = FILL[k]; g.fill(); g.strokeStyle = '#1d1d1f'; g.lineWidth = 1.2; g.stroke();
    }
  }
  g.strokeStyle = '#1d1d1f'; g.lineWidth = 2.2; g.lineCap = 'round';
  for (const [a1, b1, a2, b2] of st.lines || []) {
    const p = pr.lat(a1, b1), q = pr.lat(a2, b2);
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
  }
  if (opt.pend) { const p = pr.lat(...opt.pend); g.fillStyle = '#8c1c2b'; g.beginPath(); g.arc(p.x, p.y, 5, 0, Math.PI * 2); g.fill(); }
  return pr;
}

const MODES = [['add', 'Add cube'], ['rem', 'Remove cube'], ['line', 'Draw line'], ['erase', 'Erase line']];
const HINTS = {
  add: 'Click the ground to place a cube; click a face to stack a cube against it.',
  rem: 'Click a cube to remove it.',
  line: 'Click two dots to draw a segment along the lattice.',
  erase: 'Click a segment to erase it.'
};

export function mountIso(host, ctx) {
  let st;
  try { st = JSON.parse(ctx.get()); } catch { st = null; }
  if (!st) st = { cubes: [], lines: [], dots: true };
  let mode = 'add', pend = null, undo = [];
  const canvas = el('canvas', { class: 'cv', width: W, height: H, style: 'width:100%;max-width:' + W + 'px', 'aria-label': 'Isometric grid' });
  const g = canvas.getContext('2d');
  const hint = el('div', { class: 'hint' });
  const count = el('span', { class: 'mut' });
  const btns = {};
  const bar = el('div', { class: 'tools' });
  MODES.forEach(([k, t]) => { btns[k] = el('button', { type: 'button', text: t, onclick: () => setMode(k) }); bar.append(btns[k]); });
  bar.append(el('span', { class: 'sep' }),
    el('button', { type: 'button', text: 'Undo', onclick: () => { if (undo.length) { st = JSON.parse(undo.pop()); commit(); } } }),
    el('button', { type: 'button', text: 'Clear', onclick: async () => { if (await dialog({ title: 'Clear the grid?', body: 'All cubes and lines will be removed.', ok: 'Clear', danger: true })) { snap(); st.cubes = []; st.lines = []; commit(); } } }),
    el('label', { class: 'mut' }, el('input', { type: 'checkbox', checked: st.dots !== false, onchange: e => { st.dots = e.target.checked; commit(); } }), ' Dots'),
    count);
  host.append(el('div', { class: 'toolbar' }, bar, hint), canvas);

  let pr;
  const render = () => { pr = drawIso(g, st, W, H, { pend }); count.textContent = (st.cubes.length ? st.cubes.length + ' cube' + (st.cubes.length > 1 ? 's' : '') : ''); };
  const commit = () => { ctx.set(JSON.stringify(st)); render(); };
  const snap = () => { undo.push(JSON.stringify(st)); if (undo.length > 80) undo.shift(); };
  const setMode = m => { mode = m; pend = null; Object.entries(btns).forEach(([k, b]) => b.classList.toggle('on', k === m)); hint.textContent = HINTS[m]; render(); };
  const has = c => st.cubes.some(q => q[0] === c[0] && q[1] === c[1] && q[2] === c[2]);
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };

  function hitCube(p) {
    const list = order(st.cubes).reverse();
    for (const c of list) {
      const f = faces(pr.p, c);
      for (const k of ['top', 'left', 'right']) if (inPoly(p, f[k])) return { c, face: k };
    }
    return null;
  }
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }

  canvas.addEventListener('pointerdown', e => {
    const p = pos(e);
    if (mode === 'add') {
      const h = hitCube(p);
      let n;
      if (h) { const [x, y, z] = h.c; n = h.face === 'top' ? [x, y, z + 1] : h.face === 'right' ? [x + 1, y, z] : [x, y + 1, z]; }
      else { const [x, y] = pr.ground(p.x, p.y); n = [x, y, 0]; }
      if (n[2] > 12 || has(n)) return;
      snap(); st.cubes.push(n); commit();
    } else if (mode === 'rem') {
      const h = hitCube(p); if (!h) return;
      snap(); st.cubes = st.cubes.filter(q => q !== h.c); commit();
    } else if (mode === 'line') {
      const t = pr.toLat(p.x, p.y); if (t.d > 16) return;
      if (!pend) { pend = t.ab; render(); return; }
      if (pend[0] !== t.ab[0] || pend[1] !== t.ab[1]) { snap(); st.lines.push([...pend, ...t.ab]); }
      pend = null; commit();
    } else if (mode === 'erase') {
      let best = -1, bd = 8;
      st.lines.forEach((l, i) => { const d = segDist(p, pr.lat(l[0], l[1]), pr.lat(l[2], l[3])); if (d < bd) { bd = d; best = i; } });
      if (best < 0) return;
      snap(); st.lines.splice(best, 1); commit();
    }
  });
  setMode('add');
}

export function viewIso(json) {
  let st; try { st = JSON.parse(json); } catch { st = null; }
  if (!st || (!(st.cubes || []).length && !(st.lines || []).length)) return el('span', { class: 'mut', text: 'No drawing' });
  const c = el('canvas', { width: W, height: H, style: 'max-width:100%;border:1px solid var(--ln);border-radius:6px' });
  drawIso(c.getContext('2d'), st);
  return c;
}
