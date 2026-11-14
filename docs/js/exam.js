import { $, $$, el, esc, user, S, toggleTheme, typeset, toast, dialog } from './core.js';
import { renderStim } from './figures.js';
import { mountSub, subAnswered } from './tools/index.js';

const params = new URLSearchParams(location.search);
const PREVIEW = params.has('preview');
const ACT = params.get('a');
const me = PREVIEW ? { name: 'Preview', email: 'preview@local' } : user();
if (!PREVIEW && (!me || me.role !== 'student' || !ACT)) location.href = 'index.html';

let A = null, CARDS = [], SECS = [], SET = null, AID = null, pack = null;
let ST = { ans: {}, t: {}, ev: [], note: {}, hl: {}, flag: {}, x: {}, xm: false, done: false, sec: 0, s: {}, cur: {} };
let cur = 0, dirty = false, live = false, charts = [], warned = {}, MULT = 1, OPTS = [];
const ZOOM = [0.9, 1, 1.15, 1.3, 1.5, 1.75];
let zi = 1;
try { zi = Math.max(0, Math.min(ZOOM.length - 1, +(localStorage.ez ?? 1))); } catch {}

const sec = () => SECS[ST.sec];
const inSec = () => CARDS.filter(c => c.sec === sec().id);
const label = c => c.title || c.id;
const log = t => { if (live && !ST.done && ST.ev.length < 1000) { ST.ev.push([Math.round((Date.now() - (ST.s[SECS[0].id] || Date.now())) / 1000), t]); dirty = true; } };
const touch = () => { dirty = true; drawNav(); };

function done(c) {
  if (c.type === 'free') return (c.subs || []).some(s => subAnswered(c, s, ST.ans));
  const v = ST.ans[c.id];
  return v !== undefined && v !== null && String(v).trim() !== '';
}

async function load() {
  try {
    if (PREVIEW) {
      const p = JSON.parse(sessionStorage.preview || 'null');
      if (!p) throw new Error('Nothing to preview. Open a set from the dashboard.');
      A = p.activity; SET = { set_id: p.set || 'preview', label: p.label || 'Preview', body: p.body };
    } else {
      const room = await S.join(me.code);
      A = room.activities.find(a => a.slug === ACT);
      if (!A) throw new Error('This exam is not available in your room.');
      $('#iroom').textContent = room.room.title;
    }
    const st = A.settings || {};
    SECS = (st.sections && st.sections.length) ? st.sections : [{ id: 's1', title: 'Questions', minutes: 60 }];
    pack = st.pack || null;
    document.title = A.title + ' · Exam Hall';
    $('#ititle').textContent = A.title;
    $('#isub').textContent = A.subtitle || '';
    $('#ibody').innerHTML = st.intro || '';
    const lead = $('#ibody').firstElementChild;
    if (lead && /^H[1-3]$/.test(lead.tagName) && lead.textContent.trim() === A.title.trim()) lead.remove();
    const tools = [st.tools?.calc ? 'calculator' : null, st.tools?.notes !== false ? 'notes' : null, st.tools?.highlight !== false ? 'highlighter' : null].filter(Boolean);
    $('#ifacts').innerHTML =
      '<b>Sections</b><ul>' + SECS.map(s => `<li>${esc(s.title)} · ${s.minutes} minutes</li>`).join('') + '</ul>' +
      (st.lockSections !== false && SECS.length > 1 ? '<p>Once you move on to the next section you cannot return to the previous one.</p>' : '') +
      (st.proctor ? '<p>The exam runs in full screen. Leaving full screen or switching tabs is recorded for your teacher.</p>' : '') +
      '<p>Answers save automatically. ' + (tools.length ? 'Tools: ' + tools.join(', ') + '.' : '') + '</p>' +
      '<p class="mut">Keyboard: A–E choose an answer · Shift+A–E cross one out · ← → move between questions · F flag for review.</p>' +
      (A.open === false ? '<p class="err">' + esc(winText(st) || 'This exam is not open right now.') + ' You can resume an exam you already started.</p>' : '') +
      (A.sets && A.sets.length > 1 ? `<p>This exam has ${A.sets.length} versions; you will be given one of them.</p>` : '');
    await typeset($('#intro'));
    $('#go').disabled = false;
    $('#go').textContent = 'Begin';
  } catch (e) { $('#ierr').textContent = e.message; }
}

function winText(st) {
  const f = d => new Date(d).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (st.open_at && Date.now() < Date.parse(st.open_at)) return 'Opens ' + f(st.open_at) + '.';
  if (st.close_at && Date.now() >= Date.parse(st.close_at)) return 'Closed ' + f(st.close_at) + '.';
  return '';
}

async function begin() {
  $('#go').disabled = true; $('#ierr').textContent = '';
  try {
    if (!PREVIEW) {
      const a = await S.start(me, ACT, null);
      AID = a.id;
      MULT = +a.state?.mult || Math.max(1, +a.mult || 1, +$('#imult').value || 1);
      const got = await S.getSet(me, ACT, a.set);
      SET = got.set;
      Object.assign(ST, a.state || {});
      if (Array.isArray(ST.s)) { const old = ST.s; ST.s = {}; SECS.forEach((x, i) => { if (old[i]) ST.s[x.id] = old[i]; }); ST.sec = Math.max(0, (ST.sec || 1) - 1); }
      ST.ans = ST.ans || {}; ST.s = ST.s || {}; ST.cur = ST.cur || {}; ST.x = ST.x || {};
    }
    CARDS = SET.body.cards || [];
    CARDS.forEach(c => { if (!c.sec) c.sec = SECS[0].id; });
    if (ST.done) { showDone(); return; }
    ST.name = me.name; ST.email = me.email; ST.set = SET.set_id;
    if (PREVIEW) MULT = Math.max(1, +$('#imult').value || 1);
    ST.mult = MULT;
    if (typeof ST.sec !== 'number' || !SECS[ST.sec]) ST.sec = 0;
    while (ST.sec < SECS.length - 1 && !inSec().length) ST.sec++;
    if (!ST.s[sec().id]) ST.s[sec().id] = Date.now();
    live = true;
    $('#intro').hidden = true;
    $('#xt').textContent = A.title + (SET.label && !PREVIEW ? ' · ' + SET.label : PREVIEW ? ' · Preview' : '');
    $('#who').textContent = me.name;
    $('#bCalc').hidden = !(A.settings?.tools?.calc);
    $('#bNotes').hidden = A.settings?.tools?.notes === false;
    $('#bRef').hidden = !A.settings?.reference;
    paintTimer(); zoom(0);
    if (MULT > 1) toast('Extra time applied: ' + MULT + '× on every section');
    if (A.settings?.proctor && !PREVIEW) document.documentElement.requestFullscreen?.().catch(() => {});
    drawSecs();
    show(Math.max(0, CARDS.indexOf(inSec().find(c => c.id === ST.cur[sec().id]) || inSec()[0])));
    setInterval(tick, 1000); tick();
    setInterval(() => { if (dirty) save(); }, 8000);
    log('start');
  } catch (e) { $('#ierr').textContent = e.message; $('#go').disabled = false; }
}

function drawSecs() {
  const lock = A.settings?.lockSections !== false;
  $('#secs').innerHTML = '';
  SECS.forEach((s, i) => {
    const can = i === ST.sec || (!lock && ST.s[s.id]) || (!lock && i <= ST.sec + 1);
    $('#secs').append(el('button', { text: s.title, class: i === ST.sec ? 'on' : '', disabled: !can || (lock && i !== ST.sec), onclick: () => goSec(i) }));
  });
}

async function goSec(i, auto = false) {
  if (i === ST.sec) return;
  const lock = A.settings?.lockSections !== false;
  if (!auto && lock && i > ST.sec) {
    const left = inSec().filter(c => !done(c)).length;
    const ok = await dialog({ title: 'Finish ' + sec().title + '?', body: (left ? `<b>${left}</b> question(s) are unanswered. ` : '') + 'You cannot come back to this section.', ok: 'Move on' });
    if (!ok) return;
  }
  ST.sec = i;
  if (!ST.s[sec().id]) ST.s[sec().id] = Date.now();
  log('section-' + sec().id);
  dirty = true; save();
  drawSecs();
  const first = inSec()[0];
  if (first) show(CARDS.indexOf(first)); else if (ST.sec < SECS.length - 1) goSec(ST.sec + 1, true);
}

async function show(i) {
  cur = i;
  const c = CARDS[i];
  ST.cur[sec().id] = c.id;
  charts.forEach(x => x.destroy()); charts = [];
  const L = $('#L'), R = $('#R');
  const hasL = !!(c.stim || (c.figs && c.figs.length));
  $('#app').classList.toggle('one', !hasL);
  R.innerHTML = '';
  L.innerHTML = '';
  if (hasL) renderStim(L, c, { pack, charts }).then(applyHl);
  R.append(el('h2', { text: label(c), style: 'margin-top:0' }));
  if (c.stem) R.append(el('div', { class: 'stem', html: c.stem }));
  R.classList.toggle('xm', !!ST.xm);
  OPTS = [];
  if (c.type === 'mcq') {
    const xs = new Set(ST.x[c.id] || []);
    const keepX = () => { if (xs.size) ST.x[c.id] = [...xs].sort((p, q) => p - q); else delete ST.x[c.id]; dirty = true; };
    const tog = el('button', { type: 'button', class: 'xtog' + (ST.xm ? ' on' : ''), title: 'Cross out answer choices', 'aria-pressed': String(!!ST.xm), 'aria-label': 'Answer eliminator' }, el('s', { text: 'ABC' }));
    tog.onclick = () => { ST.xm = !ST.xm; dirty = true; tog.classList.toggle('on', ST.xm); tog.setAttribute('aria-pressed', String(ST.xm)); R.classList.toggle('xm', ST.xm); };
    R.append(el('div', { class: 'xbar' }, tog));
    (c.opts || []).forEach((o, j) => {
      const letter = String.fromCharCode(65 + j);
      const lab = el('label', { class: 'op' });
      const xb = el('button', { type: 'button', class: 'xo' });
      const paint = () => {
        const on = xs.has(j);
        lab.classList.toggle('x', on);
        xb.replaceChildren(on ? 'Undo' : el('s', { text: letter }));
        xb.setAttribute('aria-label', (on ? 'Undo cross out of option ' : 'Cross out option ') + letter);
      };
      const r = el('input', { type: 'radio', name: 'opt', checked: ST.ans[c.id] === j || ST.ans[c.id] === String(j), onchange: () => {
        ST.ans[c.id] = j;
        if (xs.has(j)) { xs.delete(j); paint(); keepX(); }
        touch();
      } });
      xb.onclick = () => {
        if (xs.has(j)) xs.delete(j);
        else {
          xs.add(j);
          if (r.checked) { r.checked = false; delete ST.ans[c.id]; touch(); }
        }
        paint(); keepX();
      };
      lab.append(r, el('span', { html: o }));
      paint();
      OPTS.push({ pick: () => { if (!r.checked) { r.checked = true; r.dispatchEvent(new Event('change')); } }, cross: () => { if (!ST.xm) tog.click(); xb.click(); } });
      R.append(el('div', { class: 'oprow' }, lab, xb));
    });
  } else if (c.type === 'num' || c.type === 'short') {
    const inp = el('input', { class: 'single', type: 'text', inputmode: c.type === 'num' ? 'decimal' : 'text', value: ST.ans[c.id] ?? '', placeholder: c.type === 'num' ? 'Enter a number' : 'Your answer', 'aria-label': 'Answer' });
    inp.oninput = () => { if (inp.value.trim()) ST.ans[c.id] = inp.value.trim(); else delete ST.ans[c.id]; touch(); };
    R.append(inp);
  } else {
    (c.subs || []).forEach(s => {
      const box = el('div', { class: 'sub' }, el('div', { class: 'lab' }, s.pts ? el('span', { class: 'pts', text: s.pts + (s.pts == 1 ? ' pt' : ' pts') }) : null, el('span', { html: s.html || '' })));
      mountSub(box, c, s, ST.ans, () => touch());
      R.append(box);
    });
  }
  $('#nt').value = ST.note[c.id] || '';
  drawNav();
  L.scrollTop = R.scrollTop = 0;
  typeset(R);
}

function step(d) {
  const list = inSec(), q = list[list.indexOf(CARDS[cur]) + d];
  if (q) show(CARDS.indexOf(q));
}

function drawNav() {
  const n = $('#nav'), list = inSec(), p = list.indexOf(CARDS[cur]);
  n.innerHTML = '';
  const b = (t, f, cls) => el('button', { text: t, onclick: f, class: cls || '' });
  n.append(
    b('◀ Back', () => step(-1)),
    b(`Question ${p + 1} of ${list.length} ▾`, () => { $('#nv').hidden = !$('#nv').hidden; drawGrid(); }),
    b('Next ▶', () => step(1)),
    el('label', { class: 'mut' }, el('input', { type: 'checkbox', checked: !!ST.flag[CARDS[cur].id], onchange: e => { ST.flag[CARDS[cur].id] = e.target.checked; touch(); } }), ' Flag for review'),
    el('span', { class: 'sp' }),
    el('span', { class: 'mut', text: list.filter(done).length + '/' + list.length + ' answered' }),
    ST.sec < SECS.length - 1 ? b('Next section ▶', () => goSec(ST.sec + 1)) : b('Submit exam', () => finish(false), 'pri'));
  if (!$('#nv').hidden) drawGrid();
}

function drawGrid() {
  const v = $('#nv'); v.innerHTML = '';
  v.append(el('h4', { text: sec().title }));
  const gp = el('div', { class: 'gp' });
  inSec().forEach((c, i) => gp.append(el('button', {
    text: c.type === 'mcq' ? String(i + 1) : label(c),
    class: [done(c) ? 'done' : '', CARDS[cur] === c ? 'cur' : '', ST.flag[c.id] ? 'fl' : ''].join(' '),
    onclick: () => { v.hidden = true; show(CARDS.indexOf(c)); }
  })));
  v.append(gp, el('p', { class: 'mut', text: 'Shaded = answered · ⚑ = flagged' }));
}

function tick() {
  if (ST.done || !live) return;
  const c = CARDS[cur];
  if (c && !document.hidden) ST.t[c.id] = (ST.t[c.id] || 0) + 1;
  const s = sec(), mins = s.minutes * MULT, left = Math.round(mins * 60) - Math.floor((Date.now() - ST.s[s.id]) / 1000);
  const m = Math.max(0, left);
  $('#tm').textContent = 'Time left ' + Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  for (const w of [30, 10, 5, 1]) if (left <= w * 60 && left > w * 60 - 2 && !warned[s.id + w] && mins > w) {
    warned[s.id + w] = 1;
    if (w === 5 && ST.hideT) { ST.hideT = false; dirty = true; paintTimer(); }
    toast(w + (w === 1 ? ' minute' : ' minutes') + ' left in this section');
  }
  if (left <= 0) { if (ST.sec < SECS.length - 1) { toast('Time is up for ' + s.title); goSec(ST.sec + 1, true); } else finish(true); }
}

async function save() {
  if (PREVIEW) { dirty = false; $('#saved').textContent = 'Preview · not saved'; return; }
  dirty = false;
  ST.upd = Date.now();
  try { await S.save(me, AID, ST); $('#saved').textContent = 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch (e) { dirty = true; $('#saved').textContent = 'Not saved – retrying'; }
}

let finishing = false;
async function finish(auto) {
  if (finishing || ST.done) return;
  if (!auto) {
    const left = CARDS.filter(c => !done(c)).length;
    if (!(await dialog({ title: 'Submit the exam?', body: (left ? `<b>${left}</b> question(s) are unanswered. ` : '') + 'You cannot change your answers afterwards.', ok: 'Submit' }))) return;
  }
  finishing = true;
  ST.done = true; ST.end = Date.now(); log(auto ? 'auto-submit' : 'submit');
  if (PREVIEW) { showDone(); return; }
  for (let i = 0; i < 4; i++) {
    try { const r = await S.finish(me, AID, ST); showDone(r); return; }
    catch (e) { if (/not open/i.test(e.message)) { showDone(); return; } await new Promise(r => setTimeout(r, 2000)); }
  }
  ST.done = false; finishing = false;
  toast('Could not submit. Check your connection and press Submit again.', 9000);
}

function showDone(r) {
  live = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $('#intro').hidden = true; $('#done').hidden = false;
  if (r && r.auto_max > 0) $('#dmsg').textContent = `Auto-marked score: ${r.auto_score} / ${r.auto_max}. Written answers are marked by your teacher.`;
  if (AID) $('#drep').href = 'student.html#r=' + AID;
}

const L = $('#L');
L.addEventListener('mouseup', () => {
  if (A?.settings?.tools?.highlight === false) return;
  const s = getSelection(), hb = $('#hb');
  if (s.isCollapsed || !L.contains(s.anchorNode)) { hb.hidden = true; return; }
  const r = s.getRangeAt(0).getBoundingClientRect();
  hb.style.left = Math.max(8, r.left) + 'px'; hb.style.top = Math.max(8, r.top - 40) + 'px'; hb.hidden = false; hb._r = s.getRangeAt(0).cloneRange();
});
$('#h1').onclick = () => {
  const r = $('#hb')._r, t = r.toString().trim();
  if (t) { (ST.hl[CARDS[cur].id] = ST.hl[CARDS[cur].id] || []).push(t); dirty = true; applyHl(); }
  $('#hb').hidden = true; getSelection().removeAllRanges();
};
$('#h2').onclick = () => {
  const t = $('#hb')._r.toString().trim(), n = $('#nt');
  n.value += (n.value ? '\n' : '') + '“' + t + '” — '; n.dispatchEvent(new Event('input'));
  $('#notes').hidden = false; $('#hb').hidden = true; n.focus();
};
$('#h3').onclick = () => { ST.hl[CARDS[cur].id] = []; dirty = true; $('#hb').hidden = true; show(cur); };
function applyHl() {
  for (const t of ST.hl[CARDS[cur]?.id] || []) {
    const w = document.createTreeWalker(L, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.parentNode.closest('mark,.katex,svg')) continue;
      const i = n.data.indexOf(t);
      if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length); r.surroundContents(el('mark')); break; }
    }
  }
}

function paintTimer() {
  $('#tm').classList.toggle('off', !!ST.hideT);
  $('#bTm').textContent = ST.hideT ? 'Show timer' : 'Hide timer';
  $('#bTm').setAttribute('aria-pressed', String(!!ST.hideT));
}
$('#bTm').onclick = () => { ST.hideT = !ST.hideT; dirty = true; paintTimer(); };

function zoom(d) {
  zi = Math.max(0, Math.min(ZOOM.length - 1, zi + d));
  $('#app').style.setProperty('--z', ZOOM[zi]);
  $('#bZo').disabled = zi === 0; $('#bZi').disabled = zi === ZOOM.length - 1;
  try { localStorage.ez = zi; } catch {}
  if (lrOn) $('#lr').hidden = true;
}
$('#bZo').onclick = () => zoom(-1);
$('#bZi').onclick = () => zoom(1);

let lrOn = false;
$('#bLr').onclick = () => {
  lrOn = !lrOn;
  $('#bLr').classList.toggle('on', lrOn); $('#bLr').setAttribute('aria-pressed', String(lrOn));
  if (!lrOn) $('#lr').hidden = true;
};
$('#app').addEventListener('mousemove', e => {
  if (!lrOn) return;
  const s = e.target.closest?.('#app>section'); if (!s) return;
  const r = s.getBoundingClientRect(), h = 2.4 * 15 * ZOOM[zi], lr = $('#lr');
  Object.assign(lr.style, { left: r.left + 'px', width: r.width + 'px', height: h + 'px', top: Math.max(r.top, Math.min(r.bottom - h, e.clientY - h / 2)) + 'px' });
  lr.hidden = false;
});
$('#app').addEventListener('mouseleave', () => { $('#lr').hidden = true; });

$('#bRef').onclick = () => {
  const p = $('#ref');
  if (p.hidden && !$('#refb').childNodes.length) { $('#refb').innerHTML = A.settings.reference; typeset($('#refb')); }
  p.hidden = !p.hidden; $('#notes').hidden = $('#calc').hidden = true;
};

$('#nt').oninput = e => { ST.note[CARDS[cur].id] = e.target.value; dirty = true; };
$('#bNotes').onclick = () => { $('#notes').hidden = !$('#notes').hidden; $('#calc').hidden = $('#ref').hidden = true; };
$('#bCalc').onclick = () => { $('#calc').hidden = !$('#calc').hidden; $('#notes').hidden = $('#ref').hidden = true; drawG(); };
$('#bTheme').onclick = () => { toggleTheme(); if (live) show(cur); };
$('#go').onclick = begin;
$('#refs').onclick = () => { document.documentElement.requestFullscreen?.().catch(() => {}); $('#fsw').hidden = true; };

const FN = { ln: 'Math.log', log: 'Math.log10', sqrt: 'Math.sqrt', exp: 'Math.exp', sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', asin: 'Math.asin', acos: 'Math.acos', atan: 'Math.atan', abs: 'Math.abs', pi: 'Math.PI', e: 'Math.E' };
const prep = s => {
  s = s.toLowerCase().replace(/\s+/g, '').replace(/\^/g, '**').replace(/π/g, 'pi').replace(/×/g, '*').replace(/÷/g, '/');
  if (/[^0-9a-z+\-*/().,]/.test(s)) throw new Error('bad');
  s = s.replace(/[a-z]+/g, m => { if (m === 'x') return 'x'; if (FN[m]) return FN[m]; throw new Error('bad'); });
  return s.replace(/(\d)(x|Math|\()/g, '$1*$2').replace(/\)(\d|x|\(|Math)/g, ')*$1');
};
const ev = (s, x) => Function('x', '"use strict";return(' + prep(s) + ')')(x);
function calc() { try { const r = ev($('#cd').value); $('#cres').textContent = '= ' + +r.toPrecision(10); } catch { $('#cres').textContent = $('#cd').value ? 'Check the expression' : ''; } }
$('#cd').oninput = calc;
$('#cd').onkeydown = e => { if (e.key === 'Enter') calc(); };
'7 8 9 ( ) 4 5 6 × ÷ 1 2 3 + - 0 . ^ √ π ln log sin cos tan C ⌫ ='.split(' ').forEach(k => $('#kp').append(el('button', { type: 'button', text: k, onclick: () => {
  const d = $('#cd');
  if (k === 'C') d.value = ''; else if (k === '⌫') d.value = d.value.slice(0, -1); else if (k === '=') { calc(); return; }
  else d.value += { '√': 'sqrt(', ln: 'ln(', log: 'log(', sin: 'sin(', cos: 'cos(', tan: 'tan(' }[k] || k;
  calc(); d.focus();
} })));
$('#ct1').onclick = () => { $('#cs').hidden = false; $('#cg').hidden = true; $('#ct1').classList.add('on'); $('#ct2').classList.remove('on'); };
$('#ct2').onclick = () => { $('#cs').hidden = true; $('#cg').hidden = false; $('#ct2').classList.add('on'); $('#ct1').classList.remove('on'); drawG(); };
const V = { x: -10, y: -7, w: 20 }, gcv = $('#gc'), gg = gcv.getContext('2d');
function drawG() {
  const W = gcv.width, H = gcv.height, k = W / V.w, X = x => (x - V.x) * k, Y = y => H - (y - V.y) * k;
  gg.fillStyle = '#fff'; gg.fillRect(0, 0, W, H);
  const st = V.w > 40 ? 10 : V.w > 16 ? 2 : V.w > 6 ? 1 : 0.5;
  gg.strokeStyle = '#eee'; gg.lineWidth = 1; gg.font = '10px system-ui'; gg.fillStyle = '#888';
  for (let x = Math.ceil(V.x / st) * st; x < V.x + V.w; x += st) { gg.beginPath(); gg.moveTo(X(x), 0); gg.lineTo(X(x), H); gg.stroke(); }
  for (let y = Math.ceil(V.y / st) * st; y < V.y + H / k; y += st) { gg.beginPath(); gg.moveTo(0, Y(y)); gg.lineTo(W, Y(y)); gg.stroke(); }
  gg.strokeStyle = '#333'; gg.beginPath(); gg.moveTo(X(0), 0); gg.lineTo(X(0), H); gg.moveTo(0, Y(0)); gg.lineTo(W, Y(0)); gg.stroke();
  ['#c74440', '#2d70b3', '#388c46'].forEach((col, i) => {
    const s = ($$('.ge')[i].value || '').replace(/^\s*y\s*=\s*/i, ''); if (!s.trim()) return;
    gg.strokeStyle = col; gg.lineWidth = 2; gg.beginPath(); let pen = false;
    for (let px = 0; px <= W; px++) {
      let y; try { y = ev(s, V.x + px / k); } catch { return; }
      if (!isFinite(y) || Math.abs(Y(y)) > 4 * H) { pen = false; continue; }
      pen ? gg.lineTo(px, Y(y)) : gg.moveTo(px, Y(y)); pen = true;
    }
    gg.stroke();
  });
}
$$('.ge').forEach(i => i.oninput = drawG);
let dd = null;
gcv.onpointerdown = e => { dd = [e.clientX, e.clientY]; gcv.setPointerCapture(e.pointerId); };
gcv.onpointermove = e => { if (!dd) return; const k = gcv.getBoundingClientRect().width / V.w; V.x -= (e.clientX - dd[0]) / k; V.y += (e.clientY - dd[1]) / k; dd = [e.clientX, e.clientY]; drawG(); };
gcv.onpointerup = () => { dd = null; };
gcv.onwheel = e => { e.preventDefault(); const f = e.deltaY > 0 ? 1.15 : 0.87, cx = V.x + V.w / 2, cy = V.y + V.w * 13 / 36; V.w *= f; V.x = cx - V.w / 2; V.y = cy - V.w * 13 / 36; drawG(); };

window.addEventListener('blur', () => log('blur'));
document.addEventListener('visibilitychange', () => { if (document.hidden) { log('hidden'); if (dirty) save(); } });
document.addEventListener('fullscreenchange', () => {
  if (!live || ST.done || !A?.settings?.proctor || PREVIEW) return;
  if (!document.fullscreenElement) { log('fs-exit'); $('#fsw').hidden = false; } else log('fs-return');
});
['copy', 'cut', 'paste', 'contextmenu'].forEach(t => document.addEventListener(t, e => {
  if (!live || ST.done || !A?.settings?.proctor) return;
  if (t === 'paste' && e.target.closest?.('.ed,.mathbox,input')) return;
  if (t === 'copy' && e.target.closest?.('.mathbox')) return;
  e.preventDefault(); log(t);
}));
document.addEventListener('keydown', e => {
  if (live && !ST.done && A?.settings?.proctor && (e.ctrlKey || e.metaKey) && 'ps'.includes(e.key.toLowerCase())) { e.preventDefault(); log('key-' + e.key.toLowerCase()); }
  if (e.key === 'Escape') { $('#nv').hidden = true; $('#hb').hidden = true; $('#ref').hidden = true; }
  if (!live || ST.done || e.ctrlKey || e.metaKey || e.altKey || e.repeat || document.querySelector('.modal')) return;
  if (e.target.closest?.('input:not([type=radio]):not([type=checkbox]),textarea,select,[contenteditable],.sub,.pop')) return;
  const k = e.key.toLowerCase();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); return; }
  if (k === 'f' && !e.shiftKey) { const id = CARDS[cur].id; ST.flag[id] = !ST.flag[id]; touch(); toast(ST.flag[id] ? 'Flagged for review' : 'Flag removed', 1500); return; }
  const i = 'abcde'.indexOf(k);
  if (k.length === 1 && i >= 0 && OPTS[i]) { e.preventDefault(); e.shiftKey ? OPTS[i].cross() : OPTS[i].pick(); }
});
window.addEventListener('beforeunload', e => { if (live && !ST.done && !PREVIEW) { if (dirty) save(); e.preventDefault(); e.returnValue = ''; } });

load();
