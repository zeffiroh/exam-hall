export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}

export const CFG = window.CFG || {};

const root = document.documentElement;
try { root.dataset.t = localStorage.th || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch { root.dataset.t = 'light'; }
export function toggleTheme() {
  root.dataset.t = root.dataset.t === 'dark' ? 'light' : 'dark';
  try { localStorage.th = root.dataset.t; } catch {}
  document.dispatchEvent(new Event('themechange'));
}
export const isDark = () => root.dataset.t === 'dark';
export const css = n => getComputedStyle(root).getPropertyValue(n).trim();

export const user = () => { try { return JSON.parse(localStorage.apu); } catch { return null; } };
export const setUser = u => { localStorage.apu = JSON.stringify(u); };
export function signOut() {
  localStorage.removeItem('apu');
  try { sessionStorage.removeItem('apc'); } catch {}
  location.href = 'index.html';
}
export function requireUser(role) {
  const u = user();
  if (!u || u.role !== role || (role === 'teacher' && !sessionStorage.apc)) { location.href = 'index.html'; throw new Error('auth'); }
  return u;
}

const clients = {};
async function client(conn) {
  if (!clients[conn]) {
    const mod = await import('https://cdn.jsdelivr.net/npm/@neondatabase/serverless@0.10.4/+esm');
    clients[conn] = mod.neon(conn);
  }
  return clients[conn];
}
const first = async p => { const r = await p; return r.length ? Object.values(r[0])[0] : null; };

export async function studentSql() { return client(CFG.studentConn); }
export async function teacherSql() {
  if (!sessionStorage.apc) throw new Error('auth');
  return client(sessionStorage.apc);
}
export function teacherConnFor(password) {
  const u = new URL(CFG.studentConn);
  return 'postgresql://exam_teacher:' + encodeURIComponent(password) + '@' + u.host + u.pathname + '?sslmode=require';
}

export const S = {
  async join(code) { const q = await studentSql(); return first(q`select exam.join_room(${code})`); },
  async getSet(u, act, set) { const q = await studentSql(); return first(q`select exam.get_set(${u.code}, ${act}, ${set})`); },
  async start(u, act, set) { const q = await studentSql(); return first(q`select exam.start_attempt(${u.email}, ${u.name}, ${u.code}, ${act}, ${set || null})`); },
  async save(u, id, state) { const q = await studentSql(); await q`select exam.save_attempt(${id}::uuid, ${u.email}, ${u.code}, ${JSON.stringify(state)}::jsonb)`; },
  async finish(u, id, state) { const q = await studentSql(); return first(q`select exam.finish_attempt(${id}::uuid, ${u.email}, ${u.code}, ${JSON.stringify(state)}::jsonb)`); },
  async attempts(u) { const q = await studentSql(); return first(q`select exam.my_attempts(${u.email}, ${u.code})`); },
  async report(u, id) { const q = await studentSql(); return first(q`select exam.my_report(${id}::uuid, ${u.email}, ${u.code})`); },
  async leaderboard(u, act) { const q = await studentSql(); return first(q`select exam.leaderboard(${u.email}, ${u.code}, ${act})`); },
  async liveGet(u, act) { const q = await studentSql(); return first(q`select exam.live_get(${u.code}, ${act})`); },
  async livePost(u, act, msg) { const q = await studentSql(); return first(q`select exam.live_post(${u.code}, ${act}, ${u.name}, ${JSON.stringify(msg)}::jsonb)`); },
  async liveEvents(u, act, since) { const q = await studentSql(); return first(q`select exam.live_events(${u.code}, ${act}, ${since || 0})`); }
};

let mathReady;
export function loadMath() {
  if (mathReady) return mathReady;
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/';
  const script = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.append(s); });
  document.head.append(el('link', { rel: 'stylesheet', href: base + 'katex.min.css' }));
  mathReady = script(base + 'katex.min.js').then(() => script(base + 'contrib/auto-render.min.js')).catch(() => null);
  return mathReady;
}
const DELIMS = [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }];
export async function typeset(node) {
  await loadMath();
  if (window.renderMathInElement && node) {
    window.renderMathInElement(node, { delimiters: DELIMS, throwOnError: false, ignoredTags: ['script', 'style', 'textarea', 'pre', 'code'] });
  }
}
export function mathToHtml(text) {
  const d = el('div', { html: esc(text).replace(/\n/g, '<br>') });
  d.dataset.raw = '1';
  return d;
}

const OK_TAGS = new Set(['B', 'I', 'U', 'SUB', 'SUP', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN', 'MARK', 'STRONG', 'EM']);
export function clean(html) {
  const d = new DOMParser().parseFromString(html || '', 'text/html');
  (function walk(n) {
    [...n.children].forEach(c => {
      if (!OK_TAGS.has(c.tagName)) { c.replaceWith(document.createTextNode(c.textContent)); return; }
      [...c.attributes].forEach(a => { if (!(c.tagName === 'MARK' && a.name === 'title')) c.removeAttribute(a.name); });
      walk(c);
    });
  })(d.body);
  return d.body.innerHTML;
}

export function cleanSvg(markup) {
  const d = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = d.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return '';
  d.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n => n.remove());
  d.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => {
    if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
  }));
  return new XMLSerializer().serializeToString(svg);
}

export function toast(msg, ms = 5000) {
  $$('.toast').forEach(t => t.remove());
  const t = el('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function dialog({ title, body, ok = 'OK', cancel = 'Cancel', danger = false, input = null }) {
  return new Promise(res => {
    const field = input != null ? el('input', { class: 'single', value: input, type: 'text' }) : null;
    const done = v => { m.remove(); res(v); };
    const m = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      el('div', null,
        title ? el('h3', { text: title, style: 'margin-top:0' }) : null,
        typeof body === 'string' ? el('p', { html: body }) : body,
        field,
        el('div', { class: 'row' },
          cancel ? el('button', { text: cancel, onclick: () => done(field ? null : false) }) : null,
          el('button', { class: danger ? 'pri danger' : 'pri', text: ok, onclick: () => done(field ? field.value : true) }))));
    document.body.append(m);
    (field || $('button.pri', m)).focus();
    m.addEventListener('keydown', e => { if (e.key === 'Escape') done(field ? null : false); if (e.key === 'Enter' && field) done(field.value); });
  });
}
export const confirmBox = (title, body, ok = 'Confirm', danger = false) => dialog({ title, body, ok, danger });

export function topbar(active) {
  const u = user();
  const links = !u ? [['pass.html', 'Get access'], ['index.html', 'Sign in']] : u.role === 'teacher'
    ? [['dashboard.html', 'Dashboard']]
    : [['student.html', 'Room'], ['student.html#progress', 'Progress'], ['student.html#attempts', 'My results']];
  const bar = el('header', { class: 'top' },
    el('a', { class: 'brand', href: u ? (u.role === 'teacher' ? 'dashboard.html' : 'student.html') : 'pass.html' },
      el('img', { src: 'assets/icon.svg', alt: '', width: 22, height: 22 }), el('b', { text: CFG.siteName || 'Exam Hall' })),
    el('nav', null, ...links.map(([h, t]) => el('a', { href: h, text: t, class: active === t ? 'cur' : '' }))),
    el('span', { class: 'sp' }),
    u ? el('span', { class: 'mut', text: u.role === 'teacher' ? 'Teacher' : u.name }) : null,
    el('button', { text: 'Light / Dark', onclick: toggleTheme }),
    u ? el('button', { text: 'Sign out', onclick: signOut }) : null);
  document.body.prepend(bar);
  siteFooter();
  return bar;
}

export function siteFooter() {
  if (document.querySelector('footer.site') || document.body.classList.contains('exam')) return;
  const a = CFG.author || {}, c = CFG.community || {};
  const link = (href, text) => href ? el('a', { href, text, target: '_blank', rel: 'noopener' }) : null;
  document.body.append(el('footer', { class: 'site' },
    el('span', null, (CFG.siteName || 'Exam Hall') + ' · made by ', link(a.url || 'https://zeffiroh.github.io', a.name || 'zeffiroh')),
    el('span', { class: 'sp' }),
    link('pass.html', 'Get access'), link(c.reddit, 'Reddit'), link(c.discord, 'Discord')));
}

export const fmtDate = d => d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '–';
export const fmtDur = s => { s = Math.max(0, Math.round(s)); if (s < 60) return s + 's'; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + 'h ' : '') + m + 'm'; };
export const num = v => (v == null || v === '' ? '–' : Math.round(+v * 100) / 100);
