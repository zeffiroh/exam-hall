import { $, el, esc, requireUser, topbar, S, fmtDate, fmtDur, num, typeset, toast } from './core.js';
import { kindInfo, openUrl } from './activities/index.js';
import { renderStim } from './figures.js';
import { viewSub } from './tools/index.js';
import { renderProgress } from './progress.js';

const u = requireUser('student');
const main = $('#main');
let ROOM = null;

async function route() {
  const h = location.hash;
  document.querySelector('header.top')?.remove();
  topbar(h.startsWith('#attempts') || h.startsWith('#r=') ? 'My results' : h.startsWith('#progress') ? 'Progress' : 'Room');
  main.innerHTML = '<p class="mut">Loading…</p>';
  try {
    if (!ROOM) ROOM = await S.join(u.code);
    if (h.startsWith('#r=')) await report(h.slice(3));
    else if (h.startsWith('#lb=')) await board(decodeURIComponent(h.slice(4)));
    else if (h.startsWith('#attempts')) await results();
    else if (h.startsWith('#progress')) await renderProgress(main, u, ROOM);
    else await home();
  } catch (e) {
    main.innerHTML = '';
    main.append(el('p', { class: 'err', text: e.message }), el('a', { class: 'btn', href: 'index.html', text: 'Sign in again', onclick: () => localStorage.removeItem('apu') }));
  }
  window.scrollTo(0, 0);
}

async function home() {
  const atts = await S.attempts(u);
  main.innerHTML = '';
  main.append(el('p', { class: 'mut', text: 'Room' }), el('h1', { text: ROOM.room.title }));
  if (!ROOM.activities.length) { main.append(el('div', { class: 'card', text: 'Your teacher has not added anything to this room yet.' })); return; }
  const grid = el('div', { class: 'grid' });
  for (const a of ROOM.activities) {
    const k = kindInfo(a.kind);
    const mine = atts.filter(x => x.activity === a.slug);
    const open = mine.find(x => x.status === 'in_progress'), fin = mine.filter(x => x.status === 'finished');
    const status = a.kind !== 'exam' ? '' : open ? 'In progress' : fin.length ? `Submitted ${fin.length}×` : 'Not started';
    const shut = a.open === false && !open, win = windowText(a.settings);
    grid.append(el('div', { class: 'card' },
      el('div', { class: 'row' }, el('span', { text: k.icon, style: 'font-size:22px', 'aria-hidden': 'true' }), el('span', { class: 'chip', text: k.label }), status ? el('span', { class: 'chip', text: status }) : null),
      el('h3', { text: a.title, style: 'margin:4px 0 0' }),
      a.subtitle ? el('div', { class: 'mut', text: a.subtitle }) : null,
      a.kind === 'exam' ? el('div', { class: 'mut', text: (a.settings.sections || []).map(s => s.minutes).reduce((x, y) => x + y, 0) + ' minutes' + (a.sets.length > 1 ? ' · ' + a.sets.length + ' versions' : '') }) : el('div', { class: 'mut', text: k.blurb }),
      win ? el('div', { class: 'mut', text: win }) : null,
      el('span', { class: 'sp' }),
      el('div', { class: 'row' },
        shut ? el('span', { class: 'chip', text: a.settings.open_at && Date.now() < Date.parse(a.settings.open_at) ? 'Not open yet' : 'Closed' })
        : a.kind === 'exam' && !a.sets.length ? el('span', { class: 'mut', text: 'No questions yet' })
          : el('a', { class: 'btn pri', href: openUrl(a), text: a.kind === 'exam' ? (open ? 'Resume' : fin.length ? 'Take again' : 'Start') : 'Open' }),
        a.kind === 'exam' && fin.length ? el('a', { class: 'btn', href: '#lb=' + encodeURIComponent(a.slug), text: 'Leaderboard' }) : null)));
  }
  main.append(grid);
}

function windowText(s) {
  const f = d => new Date(d).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (!s?.open_at && !s?.close_at) return '';
  if (s.open_at && s.close_at) return 'Available ' + f(s.open_at) + ' – ' + f(s.close_at);
  return s.open_at ? 'Opens ' + f(s.open_at) : 'Closes ' + f(s.close_at);
}

async function results() {
  const atts = await S.attempts(u);
  main.innerHTML = '';
  main.append(el('h1', { text: 'My results' }));
  if (!atts.length) { main.append(el('p', { class: 'mut', text: 'You have not taken anything yet.' })); return; }
  const t = el('table', null, el('tr', null, ['Activity', 'Version', 'Started', 'Status', 'Auto-marked', 'Teacher-marked', ''].map(x => el('th', { text: x }))));
  for (const a of atts) t.append(el('tr', null,
    el('td', { text: a.title }), el('td', { text: a.set }), el('td', { text: fmtDate(a.started_at) }),
    el('td', { text: a.status === 'finished' ? 'Submitted' : 'In progress' }),
    el('td', { text: a.auto_max ? num(a.auto_score) + ' / ' + num(a.auto_max) : '–' }),
    el('td', { text: a.released ? num(a.manual_score) + ' / ' + num(a.manual_max) : a.status === 'finished' ? 'Awaiting marking' : '–' }),
    el('td', null, a.status === 'finished' ? el('a', { class: 'btn', href: '#r=' + a.id, text: 'Report' }) : el('a', { class: 'btn', href: 'exam.html?a=' + encodeURIComponent(a.activity), text: 'Resume' }))));
  main.append(el('div', { style: 'overflow-x:auto' }, t));
}

async function report(id) {
  const r = await S.report(u, id);
  const at = r.attempt, act = ROOM.activities.find(a => a.slug === at.activity);
  const got = await S.getSet(u, at.activity, at.set_id);
  const cards = got.set.body.cards, keys = Object.fromEntries(r.keys.map(k => [k.qid, k])), grades = Object.fromEntries(r.grades.map(g => [g.q, g]));
  const ans = r.state.ans || {}, times = r.state.t || {};
  main.innerHTML = '';
  const manual = r.grades.reduce((s, g) => [s[0] + +g.score, s[1] + +g.max], [0, 0]);
  main.append(
    el('a', { href: '#attempts', text: '← My results' }),
    el('h1', { text: (act?.title || at.activity) + ' · ' + (got.set.label || at.set_id) }),
    el('div', { class: 'row' },
      at.auto_max ? el('div', { class: 'card', style: 'margin:0' }, el('div', { class: 'mut', text: 'Auto-marked' }), el('h2', { style: 'margin:0', text: num(at.auto_score) + ' / ' + num(at.auto_max) })) : null,
      el('div', { class: 'card', style: 'margin:0' }, el('div', { class: 'mut', text: 'Teacher-marked' }), el('h2', { style: 'margin:0', text: at.released ? num(manual[0]) + ' / ' + num(manual[1]) : 'Pending' })),
      el('div', { class: 'card', style: 'margin:0' }, el('div', { class: 'mut', text: 'Submitted' }), el('div', { text: fmtDate(at.finished_at) }))),
    at.released ? null : el('p', { class: 'mut', text: 'Written answers, model solutions and comments appear here once your teacher releases them.' }));
  for (const c of cards) {
    const box = el('div', { class: 'card rev' });
    box.append(el('div', { class: 'row' }, el('h3', { text: c.title || c.id, style: 'margin:0' }), el('span', { class: 'sp' }), times[c.id] ? el('span', { class: 'mut', text: 'Time ' + fmtDur(times[c.id]) }) : null));
    if (c.stim || (c.figs || []).length) { const d = el('details', null, el('summary', { text: 'Show source material' })); const s = el('div'); d.append(s); box.append(d); d.addEventListener('toggle', () => { if (d.open && !s.childNodes.length) renderStim(s, c, { pack: act?.settings?.pack }); }, { once: false }); }
    if (c.stem) box.append(el('div', { html: c.stem }));
    const k = keys[c.id];
    if (c.type === 'mcq') {
      const chosen = ans[c.id] == null ? null : +ans[c.id];
      (c.opts || []).forEach((o, j) => {
        const L = String.fromCharCode(65 + j), right = k && k.ans === L;
        box.append(el('div', { class: 'opt' + (right ? ' cor' : chosen === j ? ' wr' : '') }, el('span', { html: o }), chosen === j ? el('b', { text: '  ← your answer' }) : null,
          k && k.dx && k.dx[j] ? el('div', { class: 'mut', text: k.dx[j] }) : null));
      });
      if (chosen == null) box.append(el('p', { class: 'bad', text: 'Not answered' }));
      if (k?.rationale) box.append(el('p', { html: '<b>Explanation.</b> ' + k.rationale }));
    } else if (c.type === 'num' || c.type === 'short') {
      const ok = r.auto && r.auto[c.id] && r.auto[c.id].ok;
      box.append(el('p', null, 'Your answer: ', el('b', { text: ans[c.id] ?? '—', class: ok ? 'ok' : 'bad' })));
      if (k) box.append(el('p', { html: 'Correct answer: <b>' + esc(k.ans.split('|')[0]) + '</b>' + (k.rationale ? '<br>' + k.rationale : '') }));
    } else {
      for (const s of c.subs || []) {
        const q = c.id + '.' + s.k, g = grades[q], sk = keys[q];
        const sb = el('div', { class: 'sub' }, el('div', { class: 'lab' }, el('span', { class: 'pts', text: g ? num(g.score) + ' / ' + num(g.max) : (s.pts ? s.pts + ' pts' : '') }), el('span', { html: s.html || '' })));
        sb.append(viewSub(c, s, ans));
        if (g?.comment) sb.append(el('p', { html: '<b>Teacher comment.</b> ' + esc(g.comment) }));
        if (sk?.rationale) sb.append(el('details', null, el('summary', { text: 'Model solution' }), el('div', { html: sk.rationale })));
        if (sk?.rubric?.length) sb.append(el('details', null, el('summary', { text: 'Marking scheme' }), el('ul', null, sk.rubric.map(x => el('li', { html: `<b>${x.pts}</b> · ${x.desc}` })))));
        box.append(sb);
      }
    }
    main.append(box);
  }
  typeset(main);
}

async function board(slug) {
  const a = ROOM.activities.find(x => x.slug === slug);
  const lb = await S.leaderboard(u, slug);
  main.innerHTML = '';
  main.append(el('a', { href: '#', text: '← Room' }), el('h1', { text: 'Leaderboard · ' + (a?.title || slug) }), el('p', { class: 'mut', text: lb.n + ' student(s). Best attempt per student; teacher marks count once released.' }));
  const t = el('table', null, el('tr', null, ['Rank', 'Student', 'Total', 'Auto-marked', 'Attempts'].map(x => el('th', { text: x }))));
  lb.rows.forEach(r => t.append(el('tr', { style: r.me ? 'font-weight:700;background:var(--pn)' : '' }, el('td', { text: r.rank }), el('td', { text: r.name + (r.me ? ' (you)' : '') }), el('td', { text: num(r.total) }), el('td', { text: num(r.auto) }), el('td', { text: r.attempts }))));
  main.append(t);
}

window.addEventListener('hashchange', route);
route().catch(e => toast(e.message));
