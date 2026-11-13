import { css } from '../js/core.js';

const LIBS = {
  d3: ['https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js', () => window.d3],
  three: ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', () => window.THREE],
  p5: ['https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js', () => window.p5],
  mol: ['https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.0.4/3Dmol-min.js', () => window.$3Dmol]
};
const loading = {};
const loadLib = name => {
  const [src, ready] = LIBS[name];
  if (ready()) return Promise.resolve(ready());
  return loading[name] || (loading[name] = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => ok(ready());
    s.onerror = () => { delete loading[name]; fail(new Error('Could not load ' + name)); };
    document.head.append(s);
  }));
};

function lifecycle(host) {
  const ends = [];
  const born = Date.now();
  let seen = host.isConnected, dead = false;
  const finish = () => {
    dead = true;
    ends.splice(0).forEach(fn => { try { fn(); } catch {} });
  };
  const alive = () => {
    if (dead) return false;
    if (host.isConnected) { seen = true; return true; }
    if (seen || Date.now() - born > 15000) { finish(); return false; }
    return true;
  };
  const watch = setInterval(() => { if (!alive()) clearInterval(watch); }, 1000);
  ends.push(() => clearInterval(watch));
  return {
    alive,
    stop: finish,
    onEnd: fn => ends.push(fn),
    every(fn, ms) {
      const id = setInterval(() => { if (alive()) fn(); }, ms);
      ends.push(() => clearInterval(id));
    },
    frame(fn) {
      const step = t => { if (!alive()) return; fn(t); requestAnimationFrame(step); };
      step(0);
    }
  };
}

const loseGl = canvas => {
  if (!canvas) return;
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  const ext = gl && gl.getExtension('WEBGL_lose_context');
  if (ext) ext.loseContext();
};

const rng = a => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const perlin = seed => {
  const R = rng(seed), P = Array.from({ length: 256 }, () => R());
  const h = (a, b) => P[(a * 57 + b * 131 + ((a ^ b) & 15)) & 255];
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
    const s1 = u * u * (3 - 2 * u), s2 = v * v * (3 - 2 * v);
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    return a + (b - a) * s1 + (c - a) * s2 + (a - b - c + d) * s1 * s2;
  };
};
const fbm = (n, x, y) => .55 * n(x, y) + .3 * n(x * 2.1, y * 2.1) + .15 * n(x * 4.3, y * 4.3);

function fluo2(host, panels) {
  const W = 320, H = 260, wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center';
  host.appendChild(wrap);
  panels.forEach((p, k) => {
    const sd = p.seed || k + 3, n = perlin(sd), m2 = perlin(sd + 50), R = rng(sd * 9);
    const N = p.n || 6, r = p.r || 30, rod = p.rod || 0;
    const cols = Math.ceil(Math.sqrt(N * W / H)), rows = Math.ceil(N / cols), cells = [];
    for (let i = 0; i < N; i++) cells.push({ x: (i % cols + .5) * W / cols + (R() - .5) * 14, y: (Math.floor(i / cols) + .5) * H / rows + (R() - .5) * 14, s: R() * 50, a: R() * 3.14, rr: r * (.85 + R() * .3) });
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H; cv.style.cssText = 'max-width:100%;border-radius:6px';
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const tg = tmp.getContext('2d'), im = tg.createImageData(W, H), px = im.data;
    const rgb = p.ch.map(ch => [1, 3, 5].map(i => parseInt(ch.c.slice(i, i + 2), 16)));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = p.ch.map(() => 0);
      for (const c of cells) {
        let dx = x - c.x, dy = y - c.y;
        if (Math.abs(dx) > c.rr * 1.7 + rod || Math.abs(dy) > c.rr * 1.7 + rod) continue;
        if (rod) {
          const ca = Math.cos(c.a), sa = Math.sin(c.a), lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
          dx = lx - Math.max(-rod, Math.min(rod, lx)); dy = ly;
        }
        const th = Math.atan2(dy, dx), rad = c.rr * (1 + .44 * (n(Math.cos(th) * 1.3 + c.s, Math.sin(th) * 1.3 + c.s) - .5)), d = Math.hypot(dx, dy) / rad;
        if (d > 1.2) continue;
        const dn = Math.hypot(dx - c.rr * .1, dy + c.rr * .05) / (c.rr * .42), tex = fbm(n, x * .09, y * .09), t2 = fbm(m2, x * .3, y * .3), ins = d < 1 ? 1 : 0;
        p.ch.forEach((ch, q) => {
          const I = ch.I ?? 1, m = ch.m;
          let a = 0;
          if (m == 'cyto') a = ins * I * (.4 + .6 * tex) * (dn < 1 ? .2 : 1) * (1 - .25 * d);
          else if (m == 'nuc') a = dn < 1 ? I * (.45 + .55 * t2) * (1 - .4 * dn * dn) : 0;
          else if (m == 'mem') a = I * Math.exp(-(((d - .96) / .07) ** 2)) * (.5 + .9 * tex);
          else if (m == 'ring') a = I * Math.exp(-(((dn - 1) / .09) ** 2)) * (.6 + .6 * t2);
          else if (m == 'punct') { const t = n(x * .16, y * .16); a = ins * (dn > 1 ? 1 : 0) * I * Math.pow(1 - Math.abs(2 * t - 1), 7) * 1.6; }
          else if (m == 'blob') a = ins * I * Math.exp(-((d / .55) ** 2)) * (.35 + t2);
          v[q] += a;
        });
      }
      const o = (y * W + x) * 4;
      v.forEach((a, q) => {
        const z = Math.max(0, Math.min(1, a) * (1 + (R() - .5) * .35) + R() * .03);
        for (let u = 0; u < 3; u++) px[o + u] += rgb[q][u] * z;
      });
      px[o + 3] = 255;
    }
    tg.putImageData(im, 0, 0);
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.filter = 'blur(.7px)'; g.drawImage(tmp, 0, 0); g.filter = 'none';
    g.fillStyle = '#fff'; g.font = '12px system-ui'; g.fillText(p.t, 8, H - 10);
    g.fillRect(W - 40, H - 14, 30, 3); g.fillText('10 µm', W - 44, H - 20);
    wrap.appendChild(cv);
  });
}

function diffusion(host, life, channels) {
  const c = document.createElement('canvas');
  c.width = 440; c.height = 220; c.style.cssText = 'width:100%;max-width:100%';
  host.appendChild(c);
  const g = c.getContext('2d'), R = rng(5), chn = [];
  for (let i = 0; i < channels; i++) chn.push(30 + (i + .5) * (160 / channels));
  const gap = y => chn.some(v => Math.abs(y - v) < 13), P = [];
  for (let i = 0; i < 110; i++) P.push({ x: 10 + R() * 190, y: 10 + R() * 200, s: 0 });
  for (let i = 0; i < 50; i++) P.push({ x: 10 + R() * 190, y: 10 + R() * 200, s: 1 });
  life.every(() => {
    P.forEach(p => {
      const nx = p.x + (R() - .5) * 7, ny = Math.min(215, Math.max(5, p.y + (R() - .5) * 7));
      if ((p.x < 220) != (nx < 220) && !(p.s ? R() < .5 : gap(ny))) { p.y = ny; return; }
      p.x = Math.min(435, Math.max(5, nx)); p.y = ny;
    });
    g.clearRect(0, 0, 440, 220);
    const ink = css('--ink');
    g.strokeStyle = g.fillStyle = css('--mar'); g.lineWidth = 1.5;
    for (let y = 6; y < 216; y += 9) {
      if (gap(y)) continue;
      [214, 226].forEach(x => { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); });
      g.beginPath(); g.moveTo(214, y + 4); g.lineTo(218, y + 14); g.moveTo(226, y + 4); g.lineTo(222, y + 14); g.stroke();
    }
    chn.forEach(v => { g.strokeRect(206, v - 18, 12, 36); g.strokeRect(222, v - 18, 12, 36); });
    P.forEach(p => { g.fillStyle = p.s ? '#888' : css('--mar'); g.beginPath(); g.arc(p.x, p.y, 2.6, 0, 7); g.fill(); });
    g.fillStyle = ink; g.font = '11px system-ui';
    const count = (s, left) => P.filter(p => p.s == s && (p.x < 220) == left).length;
    g.fillText('Left: S ' + count(0, true) + ', L ' + count(1, true) + '   |   Right: S ' + count(0, false) + ', L ' + count(1, false), 8, 12);
    g.fillText(channels + ' channel protein(s)', 340, 214);
  }, 45);
}

const FL2 = [0, 10, 100, 1000].map((c, i) => ({ t: c + ' nM L', n: 5, r: 24, seed: 30 + i, ch: [{ m: 'cyto', c: '#30ff70', I: Math.min(1, [.2, 3.1, 7.8, 8.2][i] / 8.2) }] }));
const FLO = [['Control', 1, .9], ['FCCP', 5.5, .2], ['2-DG', 4.8, .25], ['FCCP + KI', 1.5, .9]].map((q, i) => ({ t: q[0], n: 5, r: 24, seed: 40 + i, ch: [{ m: 'cyto', c: '#30ff70', I: Math.min(1, q[1] / 5.5) * .9 + .05 }, { m: 'nuc', c: '#30ff70', I: 1 - Math.min(1, (q[1] - 1) / 4.5) * .85 }] }));

const svgRoot = (g, viewBox) => {
  const s = d3.select(g).append('svg').attr('viewBox', viewBox).style('width', '100%');
  s.append('defs').append('marker').attr('id', 'mk').attr('markerWidth', 8).attr('markerHeight', 8).attr('refX', 6).attr('refY', 4).attr('orient', 'auto').append('path').attr('d', 'M0 0L8 4L0 8z').attr('fill', '#a3202f');
  return s;
};
const T = (s, x, y, t, o = {}) => s.append('text').attr('x', x).attr('y', y).attr('font-size', o.f || 11).attr('text-anchor', o.a || 'middle').attr('fill', 'currentColor').text(t);
const B = (s, x, y, w, h, o = {}) => s.append('rect').attr('x', x).attr('y', y).attr('width', w).attr('height', h).attr('rx', o.r ?? 6).attr('fill', o.fill || 'none').attr('fill-opacity', o.fo ?? 1).attr('stroke', o.st || '#a3202f').attr('stroke-width', o.sw || 2);
const AR = (s, d, dash) => s.append('path').attr('d', d).attr('fill', 'none').attr('stroke', '#a3202f').attr('stroke-width', 2).attr('marker-end', 'url(#mk)').attr('stroke-dasharray', dash || null);
const CI = (s, x, y, r, f, o) => s.append('circle').attr('cx', x).attr('cy', y).attr('r', r).attr('fill', f).attr('fill-opacity', o ?? 1);

const MODS = {};

MODS.A12 = { libs: ['p5'], draw(g, life) {
  const sketch = new p5(p => {
    const M = [];
    p.setup = () => {
      p.createCanvas(440, 175);
      for (let k = 0; k < 2; k++) for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) M.push({ k, x: 22 + k * 226 + i * 40, y: 24 + j * 36 });
    };
    p.draw = () => {
      if (!life.alive()) return;
      p.background(css('--bg'));
      const t = p.frameCount * .012;
      M.forEach(m => { m.px = m.x + (p.noise(m.x * .1, m.y * .1, t) - .5) * 20; m.py = m.y + (p.noise(m.y * .1, m.x * .1, t + 9) - .5) * 20; });
      p.stroke(150); p.drawingContext.setLineDash([3, 3]);
      M.forEach((a, i) => M.forEach((b, j) => { if (!a.k && !b.k && j > i && p.dist(a.px, a.py, b.px, b.py) < 56) p.line(a.px, a.py, b.px, b.py); }));
      p.drawingContext.setLineDash([]); p.noStroke();
      M.forEach(m => {
        p.fill(163, 32, 47);
        if (m.k) { p.circle(m.px, m.py, 10); p.circle(m.px + 12, m.py + 5, 10); }
        else { p.circle(m.px, m.py, 14); p.fill(130); p.circle(m.px + 8, m.py + 6, 6); p.circle(m.px - 8, m.py + 6, 6); }
      });
      p.fill(css('--ink')); p.textSize(11);
      p.text('Water: dashed lines = hydrogen bonds between molecules', 6, 168);
      p.text('Oil: no hydrogen bonds', 252, 168);
    };
  }, g);
  life.onEnd(() => sketch.remove());
} };

MODS.A10 = { libs: ['mol'], draw(g, life) {
  const e = document.createElement('div');
  e.style.cssText = 'width:100%;height:250px;position:relative';
  g.appendChild(e);
  const v = $3Dmol.createViewer(e, { backgroundColor: 'white' }), P = [];
  for (let i = 0; i < 22; i++) {
    const a = i * 1.745, q = { x: 2.3 * Math.cos(a), y: 2.3 * Math.sin(a), z: i * 1.5 };
    P.push(q);
    v.addSphere({ center: q, radius: .55, color: '#a3202f' });
    if (i) v.addCylinder({ start: P[i - 1], end: q, radius: .14, color: '#8c1c2b' });
  }
  for (let i = 0; i + 4 < 22; i++) v.addCylinder({ start: P[i], end: P[i + 4], radius: .05, color: '#555', dashed: true, dashLength: .25, gapLength: .2 });
  const c = P[10], S1 = { x: c.x * 2, y: c.y * 2, z: c.z }, S2 = { x: c.x * 2.9, y: c.y * 2.9, z: c.z };
  v.addCylinder({ start: c, end: S1, radius: .12, color: '#8c1c2b' });
  v.addSphere({ center: S1, radius: .6, color: '#e8c000' });
  v.addSphere({ center: S2, radius: .6, color: '#e8c000' });
  v.addCylinder({ start: S1, end: S2, radius: .2, color: '#e8c000' });
  for (let k = 1; k <= 4; k++) for (const sg of [-1, 1]) {
    const q = { x: S2.x, y: S2.y, z: S2.z + sg * k * 1.5 };
    v.addSphere({ center: q, radius: .5, color: '#888' });
    v.addCylinder({ start: k == 1 ? S2 : { x: S2.x, y: S2.y, z: S2.z + sg * (k - 1) * 1.5 }, end: q, radius: .12, color: '#888' });
  }
  v.addLabel('disulfide S–S', { position: S2, fontSize: 12, fontColor: '#222', backgroundOpacity: .2 });
  v.addLabel('backbone H-bonds', { position: P[3], fontSize: 12, fontColor: '#222', backgroundOpacity: .2 });
  v.zoomTo(); v.spin('y', .4); v.render();
  life.onEnd(() => { v.spin(false); v.clear(); loseGl(e.querySelector('canvas')); });
} };

MODS.A20 = { libs: [], draw(g, life) {
  const N = 36;
  const colony = pr => {
    const c = document.createElement('canvas');
    c.width = c.height = N * 5;
    c.style.cssText = 'width:48%;image-rendering:pixelated;border:1px solid var(--ln)';
    g.appendChild(c);
    const x = c.getContext('2d'), R = rng(Math.round(pr * 100) + 3);
    let A, t = 0;
    const init = () => {
      A = Array.from({ length: N }, () => Array(N).fill(0));
      for (let i = 16; i < 20; i++) for (let j = 16; j < 20; j++) A[i][j] = 1;
    };
    init();
    life.every(() => {
      if (++t > 70) { t = 0; init(); }
      const next = A.map(r => r.slice());
      for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) if (A[i][j] == 1 && R() < .4) {
        const a = i + Math.floor(R() * 3) - 1, b = j + Math.floor(R() * 3) - 1;
        if (!next[a][b]) next[a][b] = R() < pr ? 2 : 1;
      }
      A = next;
      x.fillStyle = css('--bg'); x.fillRect(0, 0, N * 5, N * 5);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (A[i][j]) { x.fillStyle = A[i][j] == 2 ? '#999' : '#a3202f'; x.fillRect(i * 5, j * 5, 4, 4); }
    }, 120);
  };
  colony(.6); colony(0);
} };

MODS.A23 = { libs: ['d3'], draw(g) {
  const sv = d3.select(g).append('svg').attr('viewBox', '0 0 440 190').style('width', '100%');
  [['Saturated tails: tight packing', 10, 19], ['cis-unsaturated tail: kinked, looser packing', 7, 27]].forEach((q, k) => {
    const G = sv.append('g').attr('transform', 'translate(' + (8 + k * 222) + ',0)');
    G.append('text').attr('x', 2).attr('y', 14).attr('font-size', 11).attr('fill', 'currentColor').text(q[0]);
    d3.range(q[1]).forEach(i => {
      const x = 12 + i * q[2];
      [1, -1].forEach(sd => {
        const y0 = sd > 0 ? 44 : 150, y1 = sd > 0 ? 92 : 102;
        G.append('circle').attr('cx', x).attr('cy', y0).attr('r', 6).attr('fill', '#a3202f');
        [-3.5, 3.5].forEach((o, t) => {
          const kink = k && t ? 'L' + (x + o) + ' ' + (y0 + (y1 - y0) * .4) + 'L' + (x + o + 5) + ' ' + (y0 + (y1 - y0) * .5) + 'L' + (x + o) + ' ' + (y0 + (y1 - y0) * .6) : '';
          G.append('path').attr('d', 'M' + (x + o) + ' ' + y0 + kink + 'L' + (x + o) + ' ' + y1).attr('fill', 'none').attr('stroke', '#a3202f').attr('stroke-width', 1.6);
        });
      });
    });
  });
} };

MODS.A21 = { libs: ['three'], draw(g, life) {
  const W = 440, H = 260, s = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, W / H, .1, 200), rn = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  rn.setSize(W, H); rn.domElement.style.maxWidth = '100%'; g.appendChild(rn.domElement);
  cam.position.set(0, 15, 27); cam.lookAt(0, 0, 0);
  s.add(new THREE.AmbientLight(0xffffff, .75));
  const light = new THREE.DirectionalLight(0xffffff, .8);
  light.position.set(10, 20, 10); s.add(light);
  const n = perlin(3), chs = [[-6, 0], [0, -3], [6, 2]];
  const hm = new THREE.InstancedMesh(new THREE.SphereGeometry(.42, 10, 8), new THREE.MeshStandardMaterial({ color: 0xa3202f }), 900), pts = [], M = new THREE.Matrix4(), G = new THREE.Group();
  let c = 0;
  for (let i = -12; i <= 12; i++) for (let j = -8; j <= 8; j++) for (const sg of [1, -1]) {
    const x = i * 1.1, z = j * 1.1;
    if (chs.some(q => Math.hypot(x - q[0], z - q[1]) < 2.1)) continue;
    const y = (n(x * .15 + 5, z * .15 + 5) - .5) * 3, y1 = y + sg * 2.1, y0 = y + sg * .2;
    M.setPosition(x, y1, z); hm.setMatrixAt(c++, M);
    pts.push(x - .15, y1, z, x - .2, y0, z, x + .15, y1, z, x + .2, y0, z);
  }
  hm.count = c; hm.instanceMatrix.needsUpdate = true; G.add(hm);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  G.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8c1c2b })));
  chs.forEach(q => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 5.4, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x777777, side: THREE.DoubleSide, transparent: true, opacity: .8 }));
    m.position.set(q[0], (n(q[0] * .15 + 5, q[1] * .15 + 5) - .5) * 3, q[1]);
    G.add(m);
  });
  s.add(G);
  life.onEnd(() => { rn.dispose(); rn.forceContextLoss(); });
  life.frame(t => { G.rotation.y = .5 * Math.sin(t * .0004); rn.render(s, cam); });
} };

MODS.A1 = { libs: ['d3', 'mol'], draw(g, life) {
  const sv = d3.select(g).append('svg').attr('viewBox', '0 0 470 150').style('width', '100%');
  [20, 30, 40, 50, 60].forEach((T, i) => {
    const G = sv.append('g').attr('transform', 'translate(' + (10 + i * 92) + ',8)');
    G.append('rect').attr('x', 0).attr('y', 16).attr('width', 76).attr('height', 80).attr('fill', '#a3202f').attr('fill-opacity', .05 + .05 * i);
    G.append('path').attr('d', 'M0 8V96H76V8').attr('fill', 'none').attr('stroke', '#a3202f').attr('stroke-width', 2);
    G.append('rect').attr('x', 29).attr('y', 0).attr('width', 18).attr('height', 66).attr('rx', 9).attr('fill', 'var(--bg)').attr('stroke', '#a3202f').attr('stroke-width', 1.8);
    G.append('rect').attr('x', 31.5).attr('y', 34).attr('width', 13).attr('height', 29).attr('rx', 6).attr('fill', '#a3202f').attr('fill-opacity', .35);
    G.append('text').attr('x', 38).attr('y', 114).attr('text-anchor', 'middle').attr('font-size', 12).attr('fill', 'currentColor').text(T + ' °C');
    G.append('text').attr('x', 38).attr('y', 128).attr('text-anchor', 'middle').attr('font-size', 9.5).attr('fill', 'currentColor').text('water bath');
  });
  sv.append('text').attr('x', 10).attr('y', 146).attr('font-size', 10.5).attr('fill', 'currentColor').text('Each tube: enzyme + saturating substrate, pH 7.4; incubate 5 min, stop, then measure product.');
  const e = document.createElement('div');
  e.style.cssText = 'width:100%;height:260px;position:relative';
  g.appendChild(e);
  const v = $3Dmol.createViewer(e, { backgroundColor: 'white' }), P = [];
  for (let i = 0; i < 90; i++) {
    const t = i * .21;
    P.push({ x: 9 * Math.sin(1.7 * t) + 3 * Math.sin(5 * t), y: 9 * Math.sin(1.3 * t + 1) + 3 * Math.cos(4.1 * t), z: 9 * Math.sin(2.1 * t + 2) + 3 * Math.sin(3.3 * t) });
  }
  const cn = { x: 0, y: 0, z: 0 };
  P.forEach(q => { cn.x += q.x / 90; cn.y += q.y / 90; cn.z += q.z / 90; });
  const ds = q => Math.hypot(q.x - cn.x, q.y - cn.y, q.z - cn.z), ks = [...P.keys()];
  const outer = ks.filter(i => i > 15 && i < 75).sort((a, b) => ds(P[b]) - ds(P[a])), s1 = outer[0], s2 = outer.find(i => Math.abs(i - s1) > 10);
  const ac = ks.sort((a, b) => ds(P[a]) - ds(P[b]))[0];
  P.forEach((q, i) => {
    const hi = i == s1 || i == s2;
    v.addSphere({ center: q, radius: hi ? 1.1 : .6, color: hi ? '#e8c000' : '#a3202f' });
    if (i) v.addCylinder({ start: P[i - 1], end: q, radius: .18, color: '#8c1c2b' });
  });
  v.addSphere({ center: P[ac], radius: 3.2, color: '#555', alpha: .3 });
  v.addLabel('active-site region', { position: P[ac], fontSize: 11, fontColor: '#222', backgroundOpacity: .2 });
  v.addLabel('substituted surface residue', { position: P[s1], fontSize: 11, fontColor: '#222', backgroundOpacity: .2 });
  v.zoomTo(); v.spin('y', .4); v.render();
  life.onEnd(() => { v.spin(false); v.clear(); loseGl(e.querySelector('canvas')); });
} };

MODS.A2 = { libs: ['d3'], draw(g) {
  const sv = d3.select(g).append('svg').attr('viewBox', '0 0 470 80').style('width', '100%');
  sv.append('defs').append('marker').attr('id', 'm5').attr('markerWidth', 8).attr('markerHeight', 8).attr('refX', 4).attr('refY', 4).attr('orient', 'auto').append('path').attr('d', 'M0 0L8 4L0 8z').attr('fill', '#a3202f');
  ['Cells in buffer|3 batches', 'Add labelled|solute X or Y|(1–32 mM)', 'Sample at|30 s', 'Filter and|wash', 'Count label|= uptake rate'].forEach((s, i) => {
    const G = sv.append('g').attr('transform', 'translate(' + (4 + i * 94) + ',12)'), lines = s.split('|');
    G.append('rect').attr('width', 82).attr('height', 52).attr('rx', 7).attr('fill', 'none').attr('stroke', '#a3202f').attr('stroke-width', 2);
    lines.forEach((l, k) => G.append('text').attr('x', 41).attr('y', 22 + k * 13 - (lines.length - 2) * 6).attr('text-anchor', 'middle').attr('font-size', 10.5).attr('fill', 'currentColor').text(l));
    if (i < 4) G.append('path').attr('d', 'M84 26H92').attr('stroke', '#a3202f').attr('stroke-width', 2).attr('marker-end', 'url(#m5)');
  });
  const rates = { X: { 2: 5.5, 8: 12, 32: 14 }, Y: { 2: 2, 8: 8, 32: 32 } }, P = [];
  ['X', 'Y'].forEach(s => [2, 8, 32].forEach((c, j) => P.push({ t: 'Solute ' + s + ', ' + c + ' mM', n: 5, r: 24, seed: 20 + j + (s == 'Y' ? 7 : 0), ch: [{ m: 'cyto', c: '#30ff70', I: Math.min(1, rates[s][c] / 32 * 1.3) }, { m: 'nuc', c: '#ff3040', I: .5 }] })));
  fluo2(g, P);
  g.querySelectorAll('canvas').forEach(c => c.style.width = '32%');
} };

MODS.A3 = { libs: ['d3'], draw(g) {
  const s = svgRoot(g, '0 0 470 200');
  d3.range(23).forEach(i => {
    const x = 8 + i * 20;
    [[72, 77, 95], [122, 117, 99]].forEach(q => { CI(s, x, q[0], 4.2, '#a3202f'); s.append('path').attr('d', 'M' + x + ' ' + q[1] + 'V' + q[2]).attr('stroke', '#a3202f').attr('stroke-width', 1.4); });
  });
  [[60, 'I'], [150, 'III'], [240, 'IV']].forEach(c => {
    B(s, c[0] - 17, 58, 34, 78, { r: 9, fill: '#a3202f', fo: .18 });
    T(s, c[0], 102, c[1], { f: 13 });
    AR(s, 'M' + (c[0] + 26) + ' 130V44');
    T(s, c[0] + 26, 38, 'H⁺', { f: 10 });
  });
  AR(s, 'M60 52Q105 34 150 52Q195 34 240 52Q262 44 280 50', '4 3');
  T(s, 170, 20, 'e⁻ flow', { f: 10.5 });
  T(s, 335, 54, '½ O₂ + 2 H⁺ → H₂O', { f: 10.5 });
  B(s, 364, 64, 32, 66, { r: 8, fill: '#a3202f', fo: .18 });
  T(s, 380, 102, 'F₀', { f: 12 });
  B(s, 376, 130, 8, 14, { r: 2, fill: '#a3202f', fo: .4 });
  CI(s, 380, 162, 17, '#a3202f', .25);
  T(s, 380, 166, 'F₁', { f: 12 });
  AR(s, 'M380 30V62', '4 3');
  T(s, 392, 44, 'H⁺', { a: 'start', f: 10 });
  T(s, 6, 16, 'Intermembrane space', { a: 'start' });
  T(s, 6, 194, 'Matrix', { a: 'start' });
  T(s, 380, 196, 'ADP + Pᵢ → ATP', { f: 10.5 });
} };

MODS.A4 = { libs: ['d3'], draw(g) {
  const s = svgRoot(g, '0 0 470 224'), A = [[.8, .6, .42, .25, .1], [.8, .79, .8, .78, .79], [.8, .79, .8, .79, .78]];
  [['Active chloroplasts', 'light'], ['Active chloroplasts', 'dark (foil-wrapped)'], ['Boiled chloroplasts', 'light']].forEach((c, k) => {
    const G = s.append('g').attr('transform', 'translate(' + (10 + k * 155) + ',4)');
    if (k != 1) {
      CI(G, 60, 12, 7, '#e8c000');
      d3.range(8).forEach(i => G.append('path').attr('d', 'M' + (60 + 11 * Math.cos(i * .785)) + ' ' + (12 + 11 * Math.sin(i * .785)) + 'l' + (8 * Math.cos(i * .785)) + ' ' + (8 * Math.sin(i * .785))).attr('stroke', '#e8c000').attr('stroke-width', 2));
    }
    B(G, 38, 36, 44, 100, { r: 18, fill: '#4a6fa5', fo: .45 });
    d3.range(14).forEach(i => CI(G, 44 + ((i * 37) % 32), 66 + ((i * 53) % 62), 2.6, k == 2 ? '#7a6a50' : '#2e8b57'));
    if (k == 1) B(G, 34, 32, 52, 108, { r: 20, fill: '#999', fo: .55, st: '#666' });
    T(G, 60, 154, c[0], { f: 10.5 });
    T(G, 60, 167, c[1], { f: 10.5 });
    [0, 1, 2, 3, 4].forEach(i => { B(G, 6 + i * 22, 174, 20, 18, { r: 2, fill: '#4a6fa5', fo: A[k][i] / .8 * .9 + .05, st: 'none' }); T(G, 16 + i * 22, 205, [0, 2, 4, 6, 8][i], { f: 9 }); });
  });
  T(s, 235, 220, 'Swatches: DCPIP color at 0, 2, 4, 6 and 8 min (opacity scaled to measured absorbance)', { f: 10 });
} };

MODS.A8 = { libs: ['three'], draw(g, life) {
  const W = 440, H = 240, sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(38, W / H, .1, 100), rn = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  rn.setSize(W, H); rn.domElement.style.maxWidth = '100%'; g.appendChild(rn.domElement);
  cam.position.set(0, 6, 22); cam.lookAt(0, 0, 0);
  sc.add(new THREE.AmbientLight(0xffffff, .8));
  const light = new THREE.DirectionalLight(0xffffff, .7);
  light.position.set(5, 10, 8); sc.add(light);
  const grp = new THREE.Group(), box = new THREE.BoxGeometry(.9, .9, .9);
  let ox = -9;
  [1, 2, 4].forEach(n => {
    const cg = new THREE.Group();
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const surface = i == 0 || j == 0 || k == 0 || i == n - 1 || j == n - 1 || k == n - 1;
      const m = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: surface ? 0xa3202f : 0xbbbbbb, transparent: true, opacity: surface ? .9 : .55 }));
      m.position.set(i - (n - 1) / 2, j - (n - 1) / 2, k - (n - 1) / 2);
      cg.add(m);
    }
    cg.position.set(ox + n / 2, 0, 0); grp.add(cg); ox += n + 2.5;
  });
  sc.add(grp);
  life.onEnd(() => { rn.dispose(); rn.forceContextLoss(); });
  life.frame(t => { grp.rotation.y = .6 * Math.sin(t * .0005); rn.render(sc, cam); });
} };

MODS.A9 = { libs: ['d3'], draw(g) {
  const s = svgRoot(g, '0 0 470 172'), R = rng(9);
  [0, .2, .4, .6, .8].forEach((c, i) => {
    const G = s.append('g').attr('transform', 'translate(' + (8 + i * 92) + ',6)');
    G.append('rect').attr('x', 0).attr('y', 30).attr('width', 80).attr('height', 100).attr('fill', '#a3202f').attr('fill-opacity', .06);
    G.append('path').attr('d', 'M0 14V130H80V14').attr('fill', 'none').attr('stroke', '#a3202f').attr('stroke-width', 2);
    d3.range(Math.round(c * 40)).forEach(() => { let x, y; do { x = 6 + R() * 68; y = 36 + R() * 88; } while (Math.hypot(x - 40, y - 84) < 31); CI(G, x, y, 2.3, '#8c1c2b'); });
    G.append('ellipse').attr('cx', 40).attr('cy', 84).attr('rx', 24).attr('ry', 27).attr('fill', '#999').attr('fill-opacity', .25).attr('stroke', '#a3202f').attr('stroke-width', 1.8).attr('stroke-dasharray', '3 2');
    T(G, 40, 88, 'bag ?');
    T(G, 40, 146, c + ' M', { f: 12 });
    T(G, 40, 160, 'sucrose', { f: 9.5 });
  });
} };

MODS.A11 = { libs: ['d3'], draw(g) {
  const s = svgRoot(g, '0 0 470 240');
  s.append('ellipse').attr('cx', 215).attr('cy', 124).attr('rx', 200).attr('ry', 104).attr('fill', '#a3202f').attr('fill-opacity', .04).attr('stroke', '#a3202f').attr('stroke-width', 3);
  CI(s, 215, 6, 5, '#e8c000');
  T(s, 226, 10, 'signal', { a: 'start', f: 10.5 });
  B(s, 206, 18, 18, 38, { r: 5, fill: '#a3202f', fo: .3 });
  T(s, 232, 40, 'receptor', { a: 'start', f: 10.5 });
  [[140, 108, 'A'], [290, 108, 'B']].forEach(k => {
    CI(s, k[0], k[1], 24, '#a3202f', .2).attr('stroke', '#a3202f').attr('stroke-width', 2);
    T(s, k[0], k[1] + 4, 'Kinase ' + k[2], { f: 10.5 });
    AR(s, 'M' + k[0] + ' ' + (k[1] + 24) + 'L' + (k[0] < 200 ? 170 : 260) + ' 168', '4 3');
  });
  AR(s, 'M212 58L162 90', '4 3');
  AR(s, 'M218 58L270 90', '4 3');
  AR(s, 'M166 108H264', '4 3');
  T(s, 215, 100, 'order ?', { f: 10.5 });
  s.append('ellipse').attr('cx', 215).attr('cy', 195).attr('rx', 70).attr('ry', 30).attr('fill', 'none').attr('stroke', '#a3202f').attr('stroke-width', 2);
  B(s, 175, 185, 80, 20, { r: 3, fill: '#a3202f', fo: .2 });
  T(s, 215, 199, 'reporter gene', { f: 10.5 });
  T(s, 215, 236, 'dashed = connections to be inferred;  Δ = deleted;  CA = always active without upstream input', { f: 10 });
} };

MODS.A14 = { libs: ['d3'], draw(g) {
  const s = svgRoot(g, '0 0 470 220'), R = rng(4);
  [['Homogenate', '', 0], ['1,000 g', '10 min', 1], ['10,000 g', '20 min', 2], ['100,000 g', '60 min', 3]].forEach(q => {
    const i = q[2], G = s.append('g').attr('transform', 'translate(' + (28 + i * 112) + ',16)');
    G.append('path').attr('d', 'M0 0V90Q0 110 18 110Q36 110 36 90V0').attr('fill', '#a3202f').attr('fill-opacity', .06).attr('stroke', '#a3202f').attr('stroke-width', 2);
    if (i == 0) {
      d3.range(5).forEach(() => CI(G, 6 + R() * 24, 10 + R() * 80, 5, '#8c1c2b', .55));
      d3.range(7).forEach(() => G.append('ellipse').attr('cx', 6 + R() * 24).attr('cy', 10 + R() * 80).attr('rx', 3.2).attr('ry', 1.8).attr('fill', '#8c1c2b'));
      d3.range(14).forEach(() => CI(G, 5 + R() * 26, 8 + R() * 84, 1, '#8c1c2b'));
    } else {
      const n = [0, 3, 6, 14][i], r = [0, 5, 3.2, 1.2][i];
      d3.range(n).forEach(() => CI(G, 6 + R() * 24, 88 + R() * 14, r, '#8c1c2b', .8));
      T(G, 60, 92, 'pellet ' + i, { a: 'start', f: 10 });
    }
    T(G, 18, 128, q[0], { f: 11 });
    T(G, 18, 142, q[1], { f: 10 });
    if (i < 3) AR(s, 'M' + (70 + i * 112) + ' 40H' + (134 + i * 112));
  });
  T(s, 255, 190, 'supernatant is spun again at the next speed', { f: 10.5 });
  T(s, 400, 196, 'final supernatant', { f: 10.5 });
} };

MODS.A17 = { libs: ['d3'], draw(g) {
  const s = svgRoot(g, '0 0 470 218'), R = rng(6);
  [[8, 'Culture 1: open to air, shaken', 0], [240, 'Culture 2: sealed, flushed with N₂', 1]].forEach(f => {
    const G = s.append('g').attr('transform', 'translate(' + f[0] + ',10)');
    G.append('path').attr('d', 'M70 24V72L20 152Q15 168 32 168H148Q165 168 160 152L110 72V24').attr('fill', '#a3202f').attr('fill-opacity', .05).attr('stroke', '#a3202f').attr('stroke-width', 2.2);
    G.append('path').attr('d', 'M38 126L22 152Q18 165 32 165H148Q162 165 158 152L142 126Z').attr('fill', '#a3202f').attr('fill-opacity', .15);
    d3.range(20).forEach(() => {
      const x = 36 + R() * 112, y = 134 + R() * 26;
      CI(G, x, y, 4.4, '#d9b38c').attr('stroke', '#8c1c2b');
      if (R() < .4) CI(G, x + 5, y - 3, 2.5, '#d9b38c').attr('stroke', '#8c1c2b');
    });
    if (!f[2]) {
      B(G, 66, 8, 48, 16, { r: 4, fill: '#ddd', fo: .7, st: '#999' });
      T(G, 126, 12, 'O₂ in', { a: 'start', f: 10 });
      AR(G, 'M50 150q26-16 52 0', '3 3');
    } else {
      B(G, 66, 8, 48, 16, { r: 4, fill: '#999', fo: .6, st: '#666' });
      G.append('path').attr('d', 'M90 8V-4H175V46').attr('fill', 'none').attr('stroke', '#a3202f').attr('stroke-width', 2);
      B(G, 150, 46, 50, 50, { r: 4, fill: '#a3202f', fo: .1 });
      d3.range(4).forEach(i => CI(G, 162 + i * 9, 84 - (i % 2) * 16, 3, 'none').attr('stroke', '#a3202f'));
      T(G, 175, 110, 'water trap', { f: 10 });
      T(G, 40, 16, 'N₂', { f: 11 });
    }
    T(G, 90, 190, f[1], { f: 11 });
  });
} };

MODS.A18 = { libs: ['d3'], draw(g) {
  const s = svgRoot(g, '0 0 470 215');
  CI(s, 44, 26, 10, '#e8c000');
  d3.range(8).forEach(i => s.append('path').attr('d', 'M' + (44 + 14 * Math.cos(i * .785)) + ' ' + (26 + 14 * Math.sin(i * .785)) + 'l' + (7 * Math.cos(i * .785)) + ' ' + (7 * Math.sin(i * .785))).attr('stroke', '#e8c000').attr('stroke-width', 2));
  T(s, 44, 62, 'lamp switched off at 0 s', { f: 10 });
  B(s, 8, 82, 126, 84, { r: 14, fill: '#2e8b57', fo: .18, st: '#2e8b57' });
  T(s, 71, 110, 'Light reactions', { f: 11 });
  T(s, 71, 126, 'thylakoid membranes', { f: 10 });
  T(s, 71, 142, 'make ATP + NADPH', { f: 10 });
  B(s, 225, 14, 70, 30, { r: 6, fill: '#a3202f', fo: .15 }); T(s, 260, 33, 'RuBP');
  B(s, 380, 84, 70, 30, { r: 6, fill: '#a3202f', fo: .15 }); T(s, 415, 103, '3-PGA');
  B(s, 225, 172, 70, 30, { r: 6, fill: '#a3202f', fo: .15 }); T(s, 260, 191, 'G3P');
  AR(s, 'M295 29Q380 28 408 82'); T(s, 365, 34, 'CO₂ + rubisco', { f: 10 });
  AR(s, 'M412 116Q400 186 297 188'); T(s, 415, 150, 'reduction', { a: 'end', f: 10 });
  AR(s, 'M225 187Q150 110 225 40'); T(s, 175, 118, 'regeneration', { a: 'end', f: 10 });
  AR(s, 'M134 114H196', '4 3'); T(s, 165, 106, 'ATP, NADPH', { f: 10 });
} };

MODS.B9 = { libs: [], draw(g) {
  const c = document.createElement('canvas');
  c.width = 460; c.height = 104; c.style.cssText = 'width:100%;background:#000;border-radius:6px';
  g.appendChild(c);
  const x = c.getContext('2d');
  [[50, .95], [100, .8], [150, .55], [200, .25], [300, -.8]].forEach((d, k) => {
    const cx = 48 + k * 91, cy = 46, rr = 6 + d[0] / 300 * 40;
    for (let i = -rr; i <= rr; i++) for (let j = -rr; j <= rr; j++) {
      const t = Math.hypot(i, j) / rr;
      if (t > 1) continue;
      const v = Math.max(0, 1 - (1 - d[1]) * (1 - t * t));
      x.fillStyle = 'rgb(' + Math.round(40 + 215 * v) + ',' + Math.round(10 + 40 * v) + ',' + Math.round(20 + 40 * v) + ')';
      x.fillRect(cx + i, cy + j, 1.2, 1.2);
    }
    x.fillStyle = '#fff'; x.font = '11px system-ui'; x.textAlign = 'center';
    x.fillText(d[0] + ' µm', cx, 100);
  });
} };

MODS.B8 = { libs: ['d3'], draw(g) {
  const s = svgRoot(g, '0 0 480 204'), R = rng(11);
  const vesicle = (cx, cy, r, hin, hout, flow) => {
    const G = s.append('g');
    d3.range(34).forEach(i => {
      const a = i * Math.PI * 2 / 34, ux = Math.cos(a), uy = Math.sin(a);
      [r + 3, r - 4].forEach(q => CI(G, cx + ux * q, cy + uy * q, 2.1, '#a3202f'));
      G.append('path').attr('d', 'M' + (cx + ux * (r + 1)) + ' ' + (cy + uy * (r + 1)) + 'L' + (cx + ux * (r - 1)) + ' ' + (cy + uy * (r - 1))).attr('stroke', '#a3202f');
    });
    [.7, 2.4, 4.1, 5.5].forEach(a => {
      const ux = Math.cos(a), uy = Math.sin(a);
      G.append('path').attr('d', 'M' + (cx + ux * (r + 5)) + ' ' + (cy + uy * (r + 5)) + 'L' + (cx + ux * (r + 10)) + ' ' + (cy + uy * (r + 10))).attr('stroke', '#a3202f').attr('stroke-width', 2);
      CI(G, cx + ux * (r + 15), cy + uy * (r + 15), 6, '#a3202f', .25).attr('stroke', '#a3202f');
      if (flow) AR(G, 'M' + (cx + ux * (r - 14)) + ' ' + (cy + uy * (r - 14)) + 'L' + (cx + ux * (r + 24)) + ' ' + (cy + uy * (r + 24)), '2 2');
    });
    d3.range(hin).forEach(() => { const a = R() * 6.28, d = Math.sqrt(R()) * (r - 10); CI(G, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.7, '#8c1c2b'); });
    d3.range(hout).forEach(() => { let x, y; do { x = cx - 64 + R() * 128; y = cy - 64 + R() * 128; } while (Math.hypot(x - cx, y - cy) < r + 25); CI(G, x, y, 1.7, '#8c1c2b'); });
  };
  [[80, 30, 30, 0, '1: equilibrate in pH 4 buffer', '(dark, 1 h)'], [238, 30, 3, 0, '2: mix into pH 8 buffer', '+ ADP + Pᵢ'], [396, 30, 3, 1, '3: after 15 s, stop', 'and measure ATP']].forEach((q, i) => {
    B(s, 6 + i * 158, 6, 148, 166, { r: 8, sw: 1.2 });
    vesicle(q[0], 86, 32, q[1], q[2], q[3]);
    T(s, q[0], 150, q[4], { f: 10.5 });
    T(s, q[0], 164, q[5], { f: 10.5 });
  });
  T(s, 8, 196, 'Each dot = H⁺ (denser = more acidic). Thylakoid vesicle: bilayer with ATP synthase (F₁ knob outside). Dashed arrows = possible H⁺ flow.', { a: 'start', f: 10 });
} };

MODS.B5 = { libs: ['d3'], draw(g) {
  const s = svgRoot(g, '0 0 470 178');
  ['H₂O', 'PSII', 'PQ', 'cyt b₆f', 'PC', 'PSI', 'Fd', 'NADPH'].forEach((t, i) => {
    const x = 6 + i * 58;
    B(s, x, 70, 50, 26, { r: 6, fill: '#a3202f', fo: .1 });
    T(s, x + 25, 87, t, { f: 10 });
    if (i < 7) AR(s, 'M' + (x + 50) + ' 83H' + (x + 57));
  });
  AR(s, 'M' + (6 + 6 * 58 + 25) + ' 70Q' + (6 + 4 * 58) + ' 8 ' + (6 + 2 * 58 + 25) + ' 68', '4 3');
  T(s, 6 + 4 * 58, 24, 'cyclic path around PSI (pumps H⁺; makes no NADPH or O₂)', { f: 10 });
  AR(s, 'M' + (6 + 3 * 58 + 25) + ' 98V128', '2 2');
  T(s, 6 + 3 * 58 + 36, 118, 'H⁺ to lumen', { a: 'start', f: 10 });
  B(s, 6 + 2 * 58, 130, 150, 30, { r: 6, fill: '#a3202f', fo: .15 });
  T(s, 6 + 2 * 58 + 75, 149, 'ATP synthase → ATP', { f: 10.5 });
  T(s, 6, 174, 'Thylakoid membrane; solid arrows = linear electron flow.', { a: 'start', f: 9.5 });
} };

MODS.B7 = { libs: ['d3'], draw(g) {
  const s = svgRoot(g, '0 0 470 124');
  AR(s, 'M10 98H462');
  T(s, 462, 116, 'time', { a: 'end', f: 10 });
  B(s, 10, 28, 140, 22, { r: 4, fill: '#a3202f', fo: .2 });
  T(s, 80, 43, 'GF pulse (0–12 h)', { f: 10.5 });
  B(s, 10, 58, 140, 22, { r: 4, fill: '#999', fo: .2, st: '#666' });
  T(s, 80, 73, '+ cycloheximide (group 2)', { f: 10.5 });
  CI(s, 10, 98, 4, '#a3202f');
  T(s, 16, 116, '0 h', { a: 'start', f: 10 });
  CI(s, 150, 98, 4, '#a3202f');
  T(s, 150, 116, 'GF washed out', { f: 10 });
  CI(s, 460, 98, 4, '#a3202f');
  T(s, 462, 90, '24 h: count S-phase cells', { a: 'end', f: 10 });
} };

MODS.fl = { libs: [], draw(g, life, fig) { fluo2(g, fig.data || []); } };

MODS.df = { libs: [], draw(g, life, fig) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  g.append(wrap);
  (fig.data || []).forEach(n => {
    const cell = document.createElement('div');
    cell.style.flex = '1 1 280px';
    wrap.append(cell);
    diffusion(cell, life, n);
  });
} };

const panelSet = panels => ({ libs: [], draw(g) {
  fluo2(g, panels);
  g.querySelectorAll('canvas').forEach(c => c.style.width = '24%');
} });
MODS.F2fl = panelSet(FL2);
MODS.O1fl = panelSet(FLO);

export default {
  async mount(host, fig, card) {
    const mod = MODS[fig.id];
    if (!mod) throw new Error('Unknown figure ' + fig.id);
    await Promise.all(mod.libs.map(loadLib));
    const life = lifecycle(host);
    try {
      mod.draw(host, life, fig, card);
    } catch (e) {
      life.stop();
      host.replaceChildren();
      throw e;
    }
  }
};
