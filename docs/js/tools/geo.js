import { el, dialog } from '../core.js';

const W = 640, H = 420;
const INK = '#1d1d1f', ACC = '#8c1c2b', GRID = '#ececec', SEL = '#d98a96';
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const REFS = ['a', 'b', 'c', 'o', 'p', 'l'];

function limit(g, t) {
  if (g.k === 's') return t >= -1e-9 && t <= 1 + 1e-9;
  if (g.k === 'r') return t >= -1e-9;
  return true;
}

function intersect(A, B) {
  if (!A || !B) return [];
  const lineA = A.k !== 'c', lineB = B.k !== 'c';
  if (lineA && lineB) {
    const det = cross(A.d, B.d);
    if (Math.abs(det) < 1e-9) return [];
    const w = sub(B.p, A.p);
    const t = cross(w, B.d) / det, s = cross(w, A.d) / det;
    if (!limit(A, t) || !limit(B, s)) return [];
    return [{ x: A.p.x + t * A.d.x, y: A.p.y + t * A.d.y }];
  }
  if (lineA !== lineB) {
    const L = lineA ? A : B, C = lineA ? B : A;
    const f = sub(L.p, C), a = dot(L.d, L.d), b = 2 * dot(L.d, f), c = dot(f, f) - C.r * C.r;
    const disc = b * b - 4 * a * c;
    if (disc < 0 || a < 1e-12) return [];
    const q = Math.sqrt(disc);
    return [(-b - q) / (2 * a), (-b + q) / (2 * a)].filter(t => limit(L, t)).map(t => ({ x: L.p.x + t * L.d.x, y: L.p.y + t * L.d.y }));
  }
  const d = dist(A, B);
  if (d < 1e-9 || d > A.r + B.r || d < Math.abs(A.r - B.r)) return [];
  const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, A.r * A.r - a * a));
  const ux = (B.x - A.x) / d, uy = (B.y - A.y) / d;
  const mx = A.x + a * ux, my = A.y + a * uy;
  return [{ x: mx - h * uy, y: my + h * ux }, { x: mx + h * uy, y: my - h * ux }];
}

function prim(o, m) {
  const g = id => m.get(id);
  switch (o.t) {
    case 'p': {
      if (!o.d) return { k: 'p', x: o.x, y: o.y };
      const d = o.d;
      if (d.k === 'mid') { const a = g(d.a), b = g(d.b); return { k: 'p', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
      if (d.k === 'int') { const r = intersect(g(d.a), g(d.b)); const p = r[d.s] || r[0]; return p ? { k: 'p', x: p.x, y: p.y } : null; }
      if (d.k === 'on') {
        const L = g(d.o);
        if (L.k === 'c') return { k: 'p', x: L.x + L.r * Math.cos(d.u), y: L.y + L.r * Math.sin(d.u) };
        return { k: 'p', x: L.p.x + d.u * L.d.x, y: L.p.y + d.u * L.d.y };
      }
      return null;
    }
    case 's': case 'l': case 'r': { const a = g(o.a), b = g(o.b); return { k: o.t, p: a, d: sub(b, a), a, b }; }
    case 'pp': { const L = g(o.l), P = g(o.p); return { k: 'l', p: P, d: { x: -L.d.y, y: L.d.x } }; }
    case 'pa': { const L = g(o.l), P = g(o.p); return { k: 'l', p: P, d: L.d }; }
    case 'pb': { const a = g(o.a), b = g(o.b); return { k: 'l', p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: { x: -(b.y - a.y), y: b.x - a.x } }; }
    case 'bi': {
      const a = g(o.a), b = g(o.b), c = g(o.c);
      const u = sub(a, b), v = sub(c, b), lu = Math.hypot(u.x, u.y) || 1, lv = Math.hypot(v.x, v.y) || 1;
      let d = { x: u.x / lu + v.x / lv, y: u.y / lu + v.y / lv };
      if (Math.hypot(d.x, d.y) < 1e-9) d = { x: -u.y, y: u.x };
      return { k: 'l', p: b, d };
    }
    case 'c': { const O = g(o.o), P = g(o.p); return { k: 'c', x: O.x, y: O.y, r: dist(O, P) }; }
    case 'a': return { k: 'a', a: g(o.a), b: g(o.b), c: g(o.c) };
    case 'd': return { k: 'd', a: g(o.a), b: g(o.b) };
    case 'tx': return { k: 'tx', x: o.x, y: o.y };
    default: return null;
  }
}

export function compute(objs) {
  const m = new Map();
  for (const o of objs) {
    let p = null;
    try { p = prim(o, m); } catch { p = null; }
    m.set(o.i, p);
  }
  return m;
}

const dependsOn = (o, id) => REFS.some(k => o[k] === id) || (o.d && ['a', 'b', 'o', 'p', 'l'].some(k => o.d[k] === id));

function toScreen(v, p) { return { x: v.ox + p.x * v.k, y: v.oy - p.y * v.k }; }
function toWorld(v, x, y) { return { x: (x - v.ox) / v.k, y: (v.oy - y) / v.k }; }

function clipLine(g, v) {
  const P = toScreen(v, g.p), D = { x: g.d.x * v.k, y: -g.d.y * v.k };
  const L = Math.hypot(D.x, D.y) || 1, ux = D.x / L, uy = D.y / L, far = 4000;
  let t0 = -far, t1 = far;
  if (g.k === 'r') t0 = 0;
  if (g.k === 's') { t0 = 0; t1 = L; }
  return [{ x: P.x + ux * t0, y: P.y + uy * t0 }, { x: P.x + ux * t1, y: P.y + uy * t1 }];
}

export function draw(g, st, sel = [], width = W, height = H, grid = true) {
  const v = st.v, m = compute(st.o);
  g.fillStyle = '#fff'; g.fillRect(0, 0, width, height);
  if (grid) {
    g.strokeStyle = GRID; g.lineWidth = 1; g.beginPath();
    const step = v.k;
    for (let x = ((v.ox % step) + step) % step; x < width; x += step) { g.moveTo(x, 0); g.lineTo(x, height); }
    for (let y = ((v.oy % step) + step) % step; y < height; y += step) { g.moveTo(0, y); g.lineTo(width, y); }
    g.stroke();
  }
  const isSel = o => sel.includes(o.i);
  g.lineWidth = 1.8;
  for (const o of st.o) {
    const p = m.get(o.i);
    if (!p) continue;
    g.strokeStyle = isSel(o) ? SEL : INK;
    if (p.k === 's' || p.k === 'l' || p.k === 'r') {
      const [a, b] = clipLine(p, v);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    } else if (p.k === 'c') {
      const c = toScreen(v, p);
      g.beginPath(); g.arc(c.x, c.y, p.r * v.k, 0, Math.PI * 2); g.stroke();
    } else if (p.k === 'a' && p.a && p.b && p.c) {
      const B = toScreen(v, p.b);
      const a1 = Math.atan2(-(p.a.y - p.b.y), p.a.x - p.b.x), a2 = Math.atan2(-(p.c.y - p.b.y), p.c.x - p.b.x);
      let d = a2 - a1; while (d < 0) d += Math.PI * 2; while (d > Math.PI * 2) d -= Math.PI * 2;
      const ccw = d > Math.PI;
      g.strokeStyle = ACC; g.beginPath(); g.arc(B.x, B.y, 24, a1, a2, ccw); g.stroke();
      const u = sub(p.a, p.b), w = sub(p.c, p.b);
      const deg = Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y) || 1)))) * 180 / Math.PI;
      const mid = a1 + (ccw ? -(Math.PI * 2 - d) / 2 : d / 2);
      g.fillStyle = ACC; g.font = '13px system-ui'; g.textAlign = 'center';
      g.fillText(deg.toFixed(1) + '°', B.x + Math.cos(mid) * 42, B.y + Math.sin(mid) * 42 + 4);
    } else if (p.k === 'd' && p.a && p.b) {
      const A = toScreen(v, p.a), B = toScreen(v, p.b);
      g.fillStyle = ACC; g.font = '13px system-ui'; g.textAlign = 'center';
      g.fillText(dist(p.a, p.b).toFixed(2), (A.x + B.x) / 2, (A.y + B.y) / 2 - 7);
    } else if (p.k === 'tx') {
      const s = toScreen(v, p);
      g.fillStyle = INK; g.font = '15px Georgia,serif'; g.textAlign = 'left';
      g.fillText(o.s, s.x, s.y);
    }
  }
  g.textAlign = 'left';
  for (const o of st.o) {
    const p = m.get(o.i);
    if (!p || p.k !== 'p') continue;
    const s = toScreen(v, p);
    g.fillStyle = isSel(o) ? SEL : (o.d ? ACC : INK);
    g.beginPath(); g.arc(s.x, s.y, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = INK; g.font = 'italic 15px Georgia,serif';
    g.fillText(o.n || '', s.x + 7, s.y - 7);
  }
}

function distToCurve(p, g, v) {
  if (g.k === 'c') { const c = toScreen(v, g); return Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - g.r * v.k); }
  if (g.k === 's' || g.k === 'l' || g.k === 'r') {
    const [a, b] = clipLine(g, v), ab = sub(b, a), ap = sub(p, a);
    const t = Math.max(0, Math.min(1, dot(ap, ab) / (dot(ab, ab) || 1)));
    return Math.hypot(ap.x - t * ab.x, ap.y - t * ab.y);
  }
  return Infinity;
}

const TOOLS = [
  ['move', 'Move'], ['pt', 'Point'], ['seg', 'Segment'], ['line', 'Line'], ['ray', 'Ray'], ['circ', 'Circle'], '|',
  ['mid', 'Midpoint'], ['int', 'Intersect'], ['perp', 'Perpendicular'], ['para', 'Parallel'], ['bis', 'Angle bisector'], ['pbis', 'Perp. bisector'], '|',
  ['ang', 'Angle'], ['len', 'Length'], ['txt', 'Text'], ['ren', 'Rename'], ['del', 'Delete']
];
const HINTS = {
  move: 'Drag points to move them. Drag empty space to pan. Scroll to zoom.',
  pt: 'Click to place a point. Click a line or circle to put a point on it.',
  seg: 'Click two points.', line: 'Click two points.', ray: 'Click the start point, then a second point.', circ: 'Click the centre, then a point on the circle.',
  mid: 'Click two points.', int: 'Click two lines/circles, near the intersection you want.', perp: 'Click a point, then a line.', para: 'Click a point, then a line.',
  bis: 'Click a point on one arm, the vertex, then a point on the other arm.', pbis: 'Click two points.',
  ang: 'Click three points; the second is the vertex.', len: 'Click two points.', txt: 'Click where the text should go.', ren: 'Click a point to rename it.', del: 'Click an object to delete it and everything built from it.'
};

export function mountGeo(host, ctx) {
  let st;
  try { st = JSON.parse(ctx.get()); } catch { st = null; }
  if (!st || !st.o) st = { o: [], n: 0, v: { ox: W / 2, oy: H / 2, k: 40 } };
  let tool = 'move', pend = [], snap = true, grid = true, undo = [], redo = [], drag = null;
  const canvas = el('canvas', { class: 'cv', width: W, height: H, style: 'width:100%;max-width:' + W + 'px', tabindex: 0, 'aria-label': 'Geometry canvas' });
  const g = canvas.getContext('2d');
  const hint = el('div', { class: 'hint' });
  const bar = el('div', { class: 'tools' });
  const btns = {};

  const render = () => draw(g, st, pend, W, H, grid);
  const commit = () => { ctx.set(JSON.stringify(st)); render(); };
  const snapshot = () => { undo.push(JSON.stringify(st)); if (undo.length > 60) undo.shift(); redo = []; };
  const setTool = t => {
    tool = t; pend = [];
    Object.entries(btns).forEach(([k, b]) => b.classList.toggle('on', k === t));
    hint.textContent = HINTS[t];
    render();
  };

  for (const t of TOOLS) {
    if (t === '|') { bar.append(el('span', { class: 'sep' })); continue; }
    btns[t[0]] = el('button', { type: 'button', text: t[1], onclick: () => setTool(t[0]) });
    bar.append(btns[t[0]]);
  }
  const act = (txt, fn, title) => el('button', { type: 'button', text: txt, title, onclick: fn });
  const bar2 = el('div', { class: 'tools' },
    act('Undo', () => { if (!undo.length) return; redo.push(JSON.stringify(st)); st = JSON.parse(undo.pop()); commit(); }),
    act('Redo', () => { if (!redo.length) return; undo.push(JSON.stringify(st)); st = JSON.parse(redo.pop()); commit(); }),
    act('Clear', async () => { if (!st.o.length || !(await dialog({ title: 'Clear the canvas?', body: 'This removes every object.', ok: 'Clear', danger: true }))) return; snapshot(); st.o = []; commit(); }),
    el('span', { class: 'sep' }),
    act('Zoom in', () => zoom(1.25)), act('Zoom out', () => zoom(0.8)), act('Reset view', () => { st.v = { ox: W / 2, oy: H / 2, k: 40 }; commit(); }),
    el('span', { class: 'sep' }),
    el('label', { class: 'mut' }, el('input', { type: 'checkbox', checked: true, onchange: e => { snap = e.target.checked; } }), ' Snap'),
    el('label', { class: 'mut' }, el('input', { type: 'checkbox', checked: true, onchange: e => { grid = e.target.checked; render(); } }), ' Grid'));
  host.append(el('div', { class: 'toolbar' }, bar, bar2, hint), canvas);

  function zoom(f, cx = W / 2, cy = H / 2) {
    const v = st.v, w = toWorld(v, cx, cy);
    v.k = Math.max(8, Math.min(240, v.k * f));
    v.ox = cx - w.x * v.k; v.oy = cy + w.y * v.k;
    commit();
  }
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  const nameFor = () => {
    const used = new Set(st.o.map(o => o.n));
    for (let i = 0; i < 26; i++) { const n = String.fromCharCode(65 + i); if (!used.has(n)) return n; }
    for (let i = 1; ; i++) { const n = 'P' + i; if (!used.has(n)) return n; }
  };
  const add = o => { o.i = ++st.n; st.o.push(o); return o.i; };
  const prims = () => compute(st.o);

  function hitPoint(p) {
    const m = prims(); let best = null, bd = 11;
    for (const o of st.o) {
      if (o.t !== 'p') continue;
      const q = m.get(o.i); if (!q) continue;
      const d = Math.hypot(toScreen(st.v, q).x - p.x, toScreen(st.v, q).y - p.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function hitCurve(p, kinds) {
    const m = prims(); let best = null, bd = 7;
    for (const o of st.o) {
      const q = m.get(o.i); if (!q || o.t === 'p') continue;
      if (kinds && !kinds.includes(q.k)) continue;
      const d = distToCurve(p, q, st.v);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function hitText(p) {
    return st.o.find(o => { if (o.t !== 'tx') return false; const s = toScreen(st.v, o); return p.x > s.x - 6 && p.x < s.x + 8 * o.s.length + 6 && p.y > s.y - 18 && p.y < s.y + 6; }) || null;
  }
  const snapW = w => snap ? { x: Math.round(w.x * 2) / 2, y: Math.round(w.y * 2) / 2 } : w;

  function pickPoint(p, create = true) {
    const hp = hitPoint(p);
    if (hp) return hp.i;
    if (!create) return null;
    const c = hitCurve(p, ['s', 'l', 'r', 'c']);
    if (c) {
      const q = prims().get(c.i), w = toWorld(st.v, p.x, p.y);
      let u;
      if (q.k === 'c') u = Math.atan2(w.y - q.y, w.x - q.x);
      else { const dd = dot(q.d, q.d) || 1; u = dot(sub(w, q.p), q.d) / dd; if (q.k === 's') u = Math.max(0, Math.min(1, u)); if (q.k === 'r') u = Math.max(0, u); }
      return add({ t: 'p', n: nameFor(), d: { k: 'on', o: c.i, u } });
    }
    const w = snapW(toWorld(st.v, p.x, p.y));
    return add({ t: 'p', n: nameFor(), x: w.x, y: w.y });
  }

  function collect(n, id) {
    pend.push(id);
    if (pend.length < n) return null;
    const r = pend; pend = []; return r;
  }

  canvas.addEventListener('pointerdown', async e => {
    canvas.focus({ preventScroll: true });
    const p = pos(e);
    if (tool === 'move') {
      const hp = hitPoint(p), tx = hitText(p);
      const free = hp && (!hp.d || hp.d.k === 'on');
      snapshot();
      if (free) drag = { o: hp }; else if (tx) drag = { o: tx };
      else drag = { pan: true, x: p.x, y: p.y, ox: st.v.ox, oy: st.v.oy };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'del') {
      const t = hitPoint(p) || hitCurve(p) || hitText(p);
      if (!t) return;
      snapshot();
      const dead = new Set([t.i]); let grew = true;
      while (grew) { grew = false; for (const o of st.o) if (!dead.has(o.i) && [...dead].some(id => dependsOn(o, id))) { dead.add(o.i); grew = true; } }
      st.o = st.o.filter(o => !dead.has(o.i)); commit(); return;
    }
    if (tool === 'ren') {
      const hp = hitPoint(p); if (!hp) return;
      const n = await dialog({ title: 'Rename point', body: '', input: hp.n || '', ok: 'Rename' });
      if (n != null) { snapshot(); hp.n = n.slice(0, 8); commit(); }
      return;
    }
    if (tool === 'txt') {
      const s = await dialog({ title: 'Add text', body: '', input: '', ok: 'Add' });
      if (s) { snapshot(); const w = toWorld(st.v, p.x, p.y); add({ t: 'tx', x: w.x, y: w.y, s: s.slice(0, 80) }); commit(); }
      return;
    }
    if (tool === 'int') {
      const c = hitCurve(p, ['s', 'l', 'r', 'c']); if (!c) return;
      const r = collect(2, c.i); if (!r) { render(); return; }
      const m = prims(), pts = intersect(m.get(r[0]), m.get(r[1]));
      if (!pts.length) { hint.textContent = 'These objects do not intersect.'; render(); return; }
      const w = toWorld(st.v, p.x, p.y);
      let s = 0, bd = Infinity;
      pts.forEach((q, i) => { const d = Math.hypot(q.x - w.x, q.y - w.y); if (d < bd) { bd = d; s = i; } });
      snapshot(); add({ t: 'p', n: nameFor(), d: { k: 'int', a: r[0], b: r[1], s } }); commit(); return;
    }
    if (tool === 'perp' || tool === 'para') {
      const c = hitCurve(p, ['s', 'l', 'r']);
      const hp = hitPoint(p);
      let sel = null;
      if (hp) sel = { pt: hp.i }; else if (c) sel = { ln: c.i }; else if (!pend.length) { snapshot(); sel = { pt: pickPoint(p) }; }
      if (!sel) return;
      pend.push(sel);
      if (pend.length < 2) { render(); return; }
      const pt = pend.find(q => q.pt), ln = pend.find(q => q.ln);
      pend = [];
      if (!pt || !ln) { render(); return; }
      snapshot(); add({ t: tool === 'perp' ? 'pp' : 'pa', p: pt.pt, l: ln.ln }); commit(); return;
    }
    const need = { pt: 1, seg: 2, line: 2, ray: 2, circ: 2, mid: 2, pbis: 2, bis: 3, ang: 3, len: 2 }[tool];
    if (!need) return;
    snapshot();
    const id = pickPoint(p);
    pend.push(id);
    if (pend.length < need) { render(); ctx.set(JSON.stringify(st)); return; }
    const a = pend; pend = [];
    if (tool === 'seg' || tool === 'line' || tool === 'ray') add({ t: { seg: 's', line: 'l', ray: 'r' }[tool], a: a[0], b: a[1] });
    if (tool === 'circ') add({ t: 'c', o: a[0], p: a[1] });
    if (tool === 'mid') add({ t: 'p', n: nameFor(), d: { k: 'mid', a: a[0], b: a[1] } });
    if (tool === 'pbis') add({ t: 'pb', a: a[0], b: a[1] });
    if (tool === 'bis') add({ t: 'bi', a: a[0], b: a[1], c: a[2] });
    if (tool === 'ang') add({ t: 'a', a: a[0], b: a[1], c: a[2] });
    if (tool === 'len') add({ t: 'd', a: a[0], b: a[1] });
    commit();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = pos(e);
    if (drag.pan) { st.v.ox = drag.ox + p.x - drag.x; st.v.oy = drag.oy + p.y - drag.y; render(); return; }
    const o = drag.o, w = toWorld(st.v, p.x, p.y);
    if (o.t === 'tx') { o.x = w.x; o.y = w.y; }
    else if (o.d && o.d.k === 'on') {
      const q = prims().get(o.d.o);
      if (q.k === 'c') o.d.u = Math.atan2(w.y - q.y, w.x - q.x);
      else { let u = dot(sub(w, q.p), q.d) / (dot(q.d, q.d) || 1); if (q.k === 's') u = Math.max(0, Math.min(1, u)); if (q.k === 'r') u = Math.max(0, u); o.d.u = u; }
    } else { const s = snapW(w); o.x = s.x; o.y = s.y; }
    render();
  });
  const end = () => { if (drag) { drag = null; commit(); } };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e); zoom(e.deltaY < 0 ? 1.12 : 0.89, p.x, p.y); }, { passive: false });
  canvas.addEventListener('keydown', e => {
    if (e.key === 'Escape') { pend = []; render(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (undo.length) { redo.push(JSON.stringify(st)); st = JSON.parse(undo.pop()); commit(); } }
  });
  setTool('move');
}

export function viewGeo(json) {
  let st; try { st = JSON.parse(json); } catch { return el('span', { class: 'mut', text: 'No drawing' }); }
  if (!st || !st.o || !st.o.length) return el('span', { class: 'mut', text: 'No drawing' });
  const c = el('canvas', { width: W, height: H, style: 'max-width:100%;border:1px solid var(--ln);border-radius:6px' });
  draw(c.getContext('2d'), st);
  return c;
}
