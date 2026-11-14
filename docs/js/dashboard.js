import { $, el, esc, requireUser, topbar, T, isAdmin, fmtDate, fmtDur, num, toast, dialog, confirmBox, typeset } from './core.js';
import { KINDS, kindInfo, loadKind, openUrl } from './activities/index.js';
import { renderStim } from './figures.js';
import { viewSub } from './tools/index.js';

requireUser('teacher');
topbar('Dashboard');
const main = $('#main');
const crumb = (...parts) => el('div', { class: 'mut', style: 'margin-bottom:6px' }, ...parts.flatMap((p, i) => [i ? ' / ' : '', p[1] ? el('a', { href: p[1], text: p[0] }) : p[0]]));
const joinLink = code => new URL('index.html?room=' + encodeURIComponent(code), location.href).href;
const download = (name, data) => { const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: name }); a.click(); };

async function route() {
  main.innerHTML = '<p class="mut">Loading…</p>';
  try {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('att')) await attempt(h.get('att'));
    else if (h.get('act')) await activity(h.get('act'), h.get('tab') || 'sets');
    else if (h.get('room')) await room(h.get('room'));
    else if (h.has('settings')) await settings();
    else await rooms();
  } catch (e) {
    main.innerHTML = '';
    main.append(el('p', { class: 'err', text: e.message }));
    if (/password|auth|access code/i.test(e.message)) main.append(el('a', { class: 'btn', href: 'index.html?teacher', text: 'Sign in again' }));
  }
  typeset(main);
}

async function rooms() {
  const rs = await T('rooms');
  main.innerHTML = '';
  main.append(el('div', { class: 'row' }, el('h1', { text: 'Rooms' }), el('span', { class: 'sp' }), el('a', { class: 'btn', href: '#settings', text: 'Settings' }), el('button', { text: 'Copy a room', onclick: () => copyRoom('') }), el('button', { class: 'pri', text: 'New room', onclick: newRoom })));
  if (!rs.length) main.append(el('div', { class: 'card', text: 'Create a room, then add exams from the library, movie nights, DJ sessions and other activities. Students join free with the room code. To reuse a room someone else set up, use Copy a room with its room code.' }));
  const g = el('div', { class: 'grid' });
  rs.forEach(r => g.append(el('div', { class: 'card' },
    r.slug === 'library'
      ? el('div', { class: 'row' }, el('span', { class: 'chip', text: 'Exam library' }), el('span', { class: 'chip', text: 'Every teacher can add these' }))
      : el('div', { class: 'row' }, el('span', { class: 'chip', text: r.active ? 'Open' : 'Closed' }), el('span', { class: 'chip', text: 'Code ' + r.code }), r.owner && isAdmin() ? el('span', { class: 'chip', text: 'Teacher ' + r.owner.slice(0, 4) + '…' }) : null),
    el('h3', { text: r.title, style: 'margin:4px 0 0' }),
    el('div', { class: 'mut', text: `${r.n} activit${r.n === 1 ? 'y' : 'ies'} · ${r.students} student(s)` }),
    el('span', { class: 'sp' }),
    el('div', { class: 'row' }, el('a', { class: 'btn pri', href: '#room=' + r.slug, text: 'Open room' })))));
  main.append(g);
}

async function newRoom() {
  const title = await dialog({ title: 'New room', body: 'Room name (students see this).', input: '', ok: 'Next' });
  if (!title) return;
  const code = await dialog({ title: 'Room code', body: 'Students type this to join. Use something hard to guess.', input: Math.random().toString(36).slice(2, 8), ok: 'Create room' });
  if (!code) return;
  try { location.hash = 'room=' + await T('room_create', title.trim(), code.trim()); }
  catch (e) { toast(e.message); }
}

async function copyRoom(from) {
  if (!from) from = await dialog({ title: 'Copy a room', body: 'Enter the room code of the room to copy. Its activities, question sets and answer keys are copied into a new room of yours. Students and results are not copied.', input: '', ok: 'Next' });
  if (!from) return;
  const title = await dialog({ title: 'Name the copy', body: 'Leave blank to reuse the original name.', input: '', ok: 'Next' });
  if (title == null) return;
  const code = await dialog({ title: 'Room code for the copy', body: 'Students type this to join. Use something hard to guess.', input: Math.random().toString(36).slice(2, 8), ok: 'Copy room' });
  if (!code) return;
  try { location.hash = 'room=' + await T('room_copy', from.trim(), title.trim(), code.trim()); toast('Room copied'); }
  catch (e) { toast(e.message); }
}

async function room(slug) {
  const { room: r, activities: acts } = await T('room', slug);
  const lib = slug === 'library';
  main.innerHTML = '';
  main.append(crumb(['Rooms', '#'], [r.title]),
    el('div', { class: 'row' }, el('h1', { text: r.title }), el('span', { class: 'sp' }),
      el('button', { text: 'Rename', onclick: async () => { const t = await dialog({ title: 'Rename room', body: '', input: r.title, ok: 'Save' }); if (t) { await T('room_update', slug, { title: t }); route(); } } }),
      lib ? null : el('button', { text: 'Duplicate', onclick: () => copyRoom(slug) }),
      lib ? null : el('button', { text: r.active ? 'Close room' : 'Open room', onclick: async () => { await T('room_update', slug, { active: !r.active }); route(); } }),
      lib ? null : el('button', { class: 'danger', text: 'Delete', onclick: async () => { if (await confirmBox('Delete this room?', 'All its activities, question sets, attempts and grades are deleted permanently.', 'Delete room', true)) { await T('room_delete', slug); location.hash = ''; } } })),
    lib ? el('div', { class: 'card', text: 'Exams here are published with python publish.py. Every teacher can add them to their rooms, and new sets published here reach their copies too. Students cannot join this room.' }) : el('div', { class: 'card row' },
      el('div', null, el('div', { class: 'mut', text: 'Room code' }), el('b', { text: r.code, style: 'font-size:20px;font-family:ui-monospace,monospace' })),
      el('button', { text: 'Change code', onclick: async () => { const c = await dialog({ title: 'New room code', body: 'Students already signed in will need the new code.', input: r.code, ok: 'Save' }); if (c) { try { await T('room_update', slug, { code: c.trim() }); route(); } catch (e) { toast(e.message); } } } }),
      el('span', { class: 'sp' }),
      el('button', { text: 'Copy join link', onclick: () => navigator.clipboard.writeText(joinLink(r.code)).then(() => toast('Join link copied')) })),
    el('div', { class: 'row' }, el('h2', { text: 'Activities' }), el('span', { class: 'sp' }), lib ? null : el('button', { text: 'Add exam from library', onclick: () => addFromLibrary(slug) }), el('button', { class: 'pri', text: 'Add activity', onclick: () => addActivity(slug) })));
  if (!acts.length) main.append(el('div', { class: 'card', text: 'Nothing here yet. Add an exam from the library, a movie night, a DJ session or any other activity.' }));
  acts.forEach((a, i) => {
    const k = kindInfo(a.kind);
    main.append(el('div', { class: 'card row' },
      el('span', { text: k.icon, style: 'font-size:24px', 'aria-hidden': 'true' }),
      el('div', { style: 'flex:1;min-width:200px' }, el('b', { text: a.title }), el('div', { class: 'mut', text: k.label + (a.kind === 'exam' ? ` · ${a.nsets} set(s) · ${a.natt} attempt(s)` + (a.pending ? ` · ${a.pending} to mark` : '') : '') + (a.active ? '' : ' · hidden') })),
      el('button', { text: '↑', title: 'Move up', disabled: i === 0, onclick: () => move(acts, i, -1) }),
      el('button', { text: '↓', title: 'Move down', disabled: i === acts.length - 1, onclick: () => move(acts, i, 1) }),
      el('button', { text: a.active ? 'Hide' : 'Show', onclick: async () => { await T('act_update', a.slug, { active: !a.active }); route(); } }),
      a.kind !== 'exam' ? el('a', { class: 'btn', href: openUrl(a, true), text: 'Host' }) : null,
      el('a', { class: 'btn pri', href: '#act=' + a.slug, text: 'Manage' })));
  });
}

async function move(acts, i, d) {
  const list = [...acts]; const [x] = list.splice(i, 1); list.splice(i + d, 0, x);
  await T('act_order', list[0].room, list.map(x => x.slug));
  route();
}

async function addFromLibrary(roomSlug) {
  const items = (await T('library')).filter(x => x.kind === 'exam');
  if (!items.length) { toast('The library has no exams yet.'); return; }
  const box = el('div', { class: 'grid', style: 'grid-template-columns:1fr' });
  const pick = await new Promise(res => {
    items.forEach(x => box.append(el('button', { type: 'button', style: 'text-align:left;justify-content:flex-start;padding:10px', onclick: () => { document.querySelector('.modal').remove(); res(x.slug); } },
      el('span', { text: '📝', style: 'font-size:22px' }), el('span', null, el('b', { text: x.title }), el('br'), el('span', { class: 'mut', text: (x.subtitle ? x.subtitle + ' · ' : '') + x.sets + ' set(s)' })))));
    dialog({ title: 'Add an exam from the library', body: box, ok: 'Cancel', cancel: null }).then(() => res(null));
  });
  if (!pick) return;
  try { await T('add_library', roomSlug, pick); toast('Exam added'); route(); } catch (e) { toast(e.message); }
}

async function addActivity(roomSlug) {
  const pickBox = el('div', { class: 'grid', style: 'grid-template-columns:1fr' });
  const kind = await new Promise(res => {
    Object.entries(KINDS).forEach(([k, v]) => pickBox.append(el('button', { type: 'button', style: 'text-align:left;justify-content:flex-start;padding:10px', onclick: () => { document.querySelector('.modal').remove(); res(k); } },
      el('span', { text: v.icon, style: 'font-size:22px' }), el('span', null, el('b', { text: v.label }), el('br'), el('span', { class: 'mut', text: v.blurb })))));
    dialog({ title: 'Add to room', body: pickBox, ok: 'Cancel', cancel: null }).then(() => res(null));
  });
  if (!kind) return;
  const title = await dialog({ title: 'Name this ' + kindInfo(kind).label.toLowerCase(), body: '', input: kindInfo(kind).label, ok: 'Add' });
  if (!title) return;
  let defaults = {};
  try { defaults = (await loadKind(kind)).defaults?.() || {}; } catch {}
  const slug = await T('act_create', roomSlug, kind, title.trim(), defaults);
  location.hash = 'act=' + slug + '&tab=settings';
}

async function activity(slug, tab) {
  const a = await T('act', slug);
  const k = kindInfo(a.kind);
  main.innerHTML = '';
  const tabs = a.kind === 'exam' ? [['sets', 'Question sets'], ['attempts', 'Attempts'], ['summary', 'Class summary'], ['settings', 'Settings']] : [['settings', 'Settings']];
  if (a.kind !== 'exam' && tab !== 'settings') tab = 'settings';
  main.append(crumb(['Rooms', '#'], [a.room_title, '#room=' + a.room], [a.title]),
    el('div', { class: 'row' }, el('h1', { text: k.icon + ' ' + a.title }), el('span', { class: 'sp' }),
      a.kind !== 'exam' ? el('a', { class: 'btn pri', href: openUrl(a, true), text: 'Open host controls' }) : null),
    el('div', { class: 'tabs' }, tabs.map(([t, l]) => el('a', { class: 'btn' + (t === tab ? ' on' : ''), href: `#act=${slug}&tab=${t}`, text: l }))));
  const body = el('div'); main.append(body);
  if (tab === 'sets') await setsTab(a, body);
  if (tab === 'attempts') await attemptsTab(a, body);
  if (tab === 'summary') await summaryTab(a, body);
  if (tab === 'settings') await settingsTab(a, body);
}

async function settingsTab(a, body) {
  const s = JSON.parse(JSON.stringify(a.settings || {}));
  let title = a.title, sub = a.subtitle || '', assign = a.assign, dirty = false;
  const saveBtn = el('button', { class: 'pri', text: 'Save changes', disabled: true });
  const mark = () => { dirty = true; saveBtn.disabled = false; };
  body.append(
    el('label', { class: 'field' }, 'Title', el('input', { value: title, oninput: e => { title = e.target.value; mark(); } })),
    el('label', { class: 'field' }, 'Subtitle', el('input', { value: sub, oninput: e => { sub = e.target.value; mark(); } })));
  if (a.kind === 'exam') body.append(el('label', { class: 'field' }, 'How students get a question set', el('select', { onchange: e => { assign = e.target.value; mark(); } },
    el('option', { value: 'random', text: 'Random set for each student', selected: assign === 'random' }),
    el('option', { value: 'rotate', text: 'Rotate so sets are used evenly', selected: assign === 'rotate' }))));
  const ed = el('div', { class: 'card' });
  body.append(ed);
  try { const mod = await loadKind(a.kind); if (mod.editor) mod.editor(ed, s, mark); else ed.append(el('p', { class: 'mut', text: 'No settings for this activity.' })); }
  catch { ed.append(el('p', { class: 'mut', text: 'This activity type is not installed on this site.' })); }
  body.append(el('div', { class: 'row' }, saveBtn,
    el('button', { class: 'danger', text: 'Delete activity', onclick: async () => { if (await confirmBox('Delete ' + a.title + '?', 'Its question sets, attempts and grades are deleted permanently.', 'Delete', true)) { await T('act_delete', a.slug); location.hash = 'room=' + a.room; } } })));
  saveBtn.onclick = async () => {
    await T('act_update', a.slug, { title: title.trim() || a.title, subtitle: sub.trim(), assign, settings: s });
    dirty = false; saveBtn.disabled = true; toast('Saved');
  };
  window.onbeforeunload = () => dirty ? true : undefined;
}

async function setsTab(a, body) {
  const sets = await T('sets', a.slug);
  body.append(el('p', { class: 'mut', text: 'Students get one live set each.' + (a.source ? ' This exam came from the library; new sets published there are added here automatically.' : '') + ' You can also import your own set below.' }));
  if (!sets.length) body.append(el('div', { class: 'card', text: 'No question sets yet. Import one below.' }));
  else {
    const t = el('table', null, el('tr', null, ['Set', 'Label', 'Questions', 'Keys', 'Attempts', 'Status', ''].map(x => el('th', { text: x }))));
    sets.forEach(s => t.append(el('tr', null, el('td', { text: s.set_id }), el('td', { text: s.label }), el('td', { text: s.n }), el('td', { text: s.keys }), el('td', { text: s.att }), el('td', { text: s.active ? 'Live' : 'Hidden' }),
      el('td', { class: 'row' },
        el('button', { text: 'Preview', onclick: () => preview(a, s.set_id) }),
        el('button', { text: s.active ? 'Hide' : 'Make live', onclick: async () => { await T('set_update', a.slug, s.set_id, !s.active); route(); } }),
        el('button', { text: 'Export', onclick: () => exportSet(a, s.set_id) }),
        el('button', { class: 'danger', text: 'Delete', onclick: async () => { if (await confirmBox('Delete set ' + s.label + '?', s.att ? `${s.att} attempt(s) used this set; their answers stay, but reports will no longer show the questions.` : 'This cannot be undone.', 'Delete', true)) { await T('set_delete', a.slug, s.set_id); route(); } } })))));
    body.append(el('div', { style: 'overflow-x:auto' }, t));
  }
  const file = el('input', { type: 'file', accept: '.json,application/json', id: 'setfile' });
  const sid = el('input', { value: String(sets.length + 1), style: 'width:90px', 'aria-label': 'Set id' });
  const lab = el('input', { value: 'Set ' + (sets.length + 1), 'aria-label': 'Label' });
  const ta = el('textarea', { rows: 6, placeholder: 'Or paste the set JSON here', style: 'width:100%;font:13px ui-monospace,monospace' });
  const msg = el('p', { class: 'err' });
  file.onchange = async () => { const f = file.files[0]; if (!f) return; ta.value = await f.text(); const m = f.name.match(/set-?(\w+)\.json$/i); if (m) { sid.value = m[1]; lab.value = 'Set ' + m[1]; } };
  body.append(el('div', { class: 'card' }, el('h3', { text: 'Import a question set', style: 'margin-top:0' }),
    el('div', { class: 'row' }, el('label', { class: 'field' }, 'Set id', sid), el('label', { class: 'field', style: 'flex:1' }, 'Label', lab), el('label', { class: 'field' }, 'JSON file', file)),
    ta, msg,
    el('div', { class: 'row' }, el('button', { class: 'pri', text: 'Import', onclick: async () => {
      msg.textContent = '';
      let body2; try { body2 = JSON.parse(ta.value); } catch (e) { msg.textContent = 'Not valid JSON: ' + e.message; return; }
      const err = validateSet(body2, a.settings); if (err) { msg.textContent = err; return; }
      try {
        const r = await T('import_set', a.slug, sid.value.trim(), lab.value.trim(), body2);
        toast(`Imported ${r.cards} questions and ${r.keys} answer keys` + (r.copies ? ` · added to ${r.copies} teacher cop${r.copies === 1 ? 'y' : 'ies'}` : '')); route();
      } catch (e) { msg.textContent = e.message; }
    } }), el('button', { text: 'Preview without importing', onclick: () => { try { const b = JSON.parse(ta.value); sessionStorage.preview = JSON.stringify({ activity: { title: a.title, subtitle: a.subtitle, settings: a.settings }, label: lab.value, body: b }); window.open('exam.html?preview=1'); } catch (e) { msg.textContent = 'Not valid JSON: ' + e.message; } } }))));
}

function validateSet(b, st) {
  if (!b || !Array.isArray(b.cards) || !b.cards.length) return 'The JSON needs a non-empty "cards" array.';
  const ids = new Set(), secs = new Set((st.sections || []).map(s => s.id));
  for (const c of b.cards) {
    if (!c.id) return 'Every card needs an "id".';
    if (ids.has(c.id)) return 'Duplicate card id ' + c.id;
    ids.add(c.id);
    if (!['mcq', 'num', 'short', 'free'].includes(c.type)) return `Card ${c.id}: "type" must be mcq, num, short or free.`;
    if (c.sec && secs.size && !secs.has(c.sec)) return `Card ${c.id}: section "${c.sec}" is not defined in the activity settings.`;
    if (c.type === 'mcq' && !(c.opts || []).length) return `Card ${c.id}: multiple choice needs "opts".`;
    if (c.type === 'free' && !(c.subs || []).length) return `Card ${c.id}: free response needs at least one sub-part in "subs".`;
  }
  return '';
}

async function preview(a, set) {
  const s = await T('set_get', a.slug, set);
  sessionStorage.preview = JSON.stringify({ activity: { title: a.title, subtitle: a.subtitle, settings: a.settings }, set, label: s.label, body: s.body });
  window.open('exam.html?preview=1');
}

async function exportSet(a, set) {
  const s = await T('set_get', a.slug, set), keys = s.keys;
  const K = Object.fromEntries(keys.map(k => [k.qid, k]));
  const strip = k => { const o = { kind: k.kind, ans: k.ans, tol: k.tol, rationale: k.rationale, dx: k.dx, unit: k.unit, sp: k.sp, lvl: k.lvl, max: +k.max, rubric: k.rubric }; Object.keys(o).forEach(x => o[x] == null && delete o[x]); return o; };
  const body = JSON.parse(JSON.stringify(s.body));
  body.cards.forEach(c => { if (K[c.id]) c.key = strip(K[c.id]); (c.subs || []).forEach(sb => { if (K[c.id + '.' + sb.k]) sb.key = strip(K[c.id + '.' + sb.k]); }); });
  download(`${a.slug}-set-${set}.json`, body);
}

const LEAVES = ['blur', 'hidden', 'fs-exit'];
async function attemptsTab(a, body) {
  const rows = await T('attempts', a.slug);
  if (!rows.length) { body.append(el('p', { class: 'mut', text: 'No attempts yet.' })); return; }
  const fin = rows.filter(r => r.status === 'finished');
  body.append(el('div', { class: 'row' },
    el('span', { class: 'mut', text: `${rows.length} attempt(s) · ${fin.length} submitted · ${fin.filter(r => !r.released).length} not released` }),
    el('span', { class: 'sp' }),
    el('button', { text: 'Release all marked', onclick: async () => { await T('release_marked', a.slug); route(); } }),
    el('button', { text: 'Export CSV', onclick: () => {
      const csv = [['name', 'email', 'set', 'status', 'started', 'finished', 'auto', 'auto_max', 'teacher', 'released', 'focus_losses'], ...rows.map(r => [r.name, r.email, r.set_id, r.status, r.started_at, r.finished_at, r.auto_score, r.auto_max, r.manual, r.released, r.leaves])]
        .map(r => r.map(x => '"' + String(x ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
      el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: a.slug + '-attempts.csv' }).click();
    } })));
  const t = el('table', null, el('tr', null, ['Student', 'Set', 'Started', 'Status', 'Auto', 'Teacher', 'Focus losses', ''].map(x => el('th', { text: x }))));
  rows.forEach(r => t.append(el('tr', { class: 'c', onclick: () => { location.hash = 'att=' + r.id; } },
    el('td', null, el('b', { text: r.name || '' }), el('br'), el('span', { class: 'mut', text: r.email })),
    el('td', { text: r.set_id }), el('td', { text: fmtDate(r.started_at) }),
    el('td', { text: r.status === 'finished' ? (r.released ? 'Released' : 'Submitted') : 'In progress' }),
    el('td', { text: r.auto_max ? num(r.auto_score) + '/' + num(r.auto_max) : '–' }),
    el('td', { text: r.to_grade ? `${r.graded}/${r.to_grade} marked · ${num(r.manual)}` : '–' }),
    el('td', { text: r.leaves, class: r.leaves > 3 ? 'bad' : '' }),
    el('td', null, el('a', { class: 'btn', href: '#att=' + r.id, text: r.status === 'finished' ? 'Mark' : 'View' })))));
  body.append(el('div', { style: 'overflow-x:auto' }, t));
}

async function summaryTab(a, body) {
  const { atts, keys, grades } = await T('summary', a.slug);
  if (!atts.length) { body.append(el('p', { class: 'mut', text: 'No submitted attempts yet.' })); return; }
  const pct = atts.filter(x => x.auto_max > 0).map(x => 100 * x.auto_score / x.auto_max);
  if (pct.length) {
    const bins = Array(10).fill(0); pct.forEach(p => bins[Math.min(9, Math.floor(p / 10))]++);
    const mx = Math.max(...bins), avg = pct.reduce((s, x) => s + x, 0) / pct.length;
    body.append(el('h3', { text: `Auto-marked scores · mean ${avg.toFixed(1)}% · n = ${pct.length}` }),
      el('div', { class: 'card' }, bins.map((b, i) => el('div', { class: 'row', style: 'gap:8px;margin:2px 0' }, el('span', { class: 'mut', style: 'width:64px', text: i * 10 + '–' + (i * 10 + 10) + '%' }), el('div', { class: 'bar', style: `width:${mx ? b / mx * 70 : 0}%;min-width:${b ? 4 : 0}px` }), el('span', { class: 'mut', text: b })))));
  }
  const auto = keys.filter(k => k.kind !== 'manual');
  if (auto.length) {
    body.append(el('h3', { text: 'Item analysis' }));
    const t = el('table', null, el('tr', null, ['Set', 'Question', 'Topic', 'Answer', '% correct', 'Median time'].map(x => el('th', { text: x }))));
    auto.forEach(k => {
      const rel = atts.filter(x => x.set_id === k.set_id);
      const ok = rel.filter(x => x.auto?.[k.qid]?.ok).length;
      const times = rel.map(x => +(x.t?.[k.qid] || 0)).filter(Boolean).sort((p, r) => p - r);
      const p = rel.length ? 100 * ok / rel.length : 0;
      t.append(el('tr', null, el('td', { text: k.set_id }), el('td', { text: k.qid }), el('td', { text: k.unit || '' }), el('td', { text: k.ans }), el('td', { text: p.toFixed(0) + '%', class: p < 40 ? 'bad' : p > 80 ? 'ok' : '' }), el('td', { text: times.length ? fmtDur(times[times.length >> 1]) : '–' })));
    });
    body.append(el('div', { style: 'overflow-x:auto' }, t));
  }
  const man = keys.filter(k => k.kind === 'manual');
  if (man.length) {
    body.append(el('h3', { text: 'Teacher-marked parts · average' }));
    const t = el('table', null, el('tr', null, ['Set', 'Part', 'Marked', 'Average'].map(x => el('th', { text: x }))));
    man.forEach(k => { const g = grades.filter(x => x.q === k.qid && x.set_id === k.set_id); const av = g.length ? g.reduce((s, x) => s + +x.score, 0) / g.length : null; t.append(el('tr', null, el('td', { text: k.set_id }), el('td', { text: k.qid }), el('td', { text: g.length }), el('td', { text: av == null ? '–' : av.toFixed(2) + ' / ' + num(k.max) }))); });
    body.append(el('div', { style: 'overflow-x:auto' }, t));
  }
}

async function attempt(id) {
  const { t, set: s, keys, grades } = await T('attempt', id);
  const K = Object.fromEntries(keys.map(k => [k.qid, k])), G = Object.fromEntries(grades.map(g => [g.q, g]));
  const st = t.state || {}, ans = st.ans || {}, ev = st.ev || [];
  main.innerHTML = '';
  const leaves = ev.filter(e => LEAVES.includes(e[1])).length;
  main.append(crumb(['Rooms', '#'], [t.room_title, '#room=' + t.room], [t.title, '#act=' + t.activity + '&tab=attempts'], [t.name || t.email]),
    el('div', { class: 'row' }, el('h1', { text: t.name || t.email }), el('span', { class: 'sp' }),
      el('label', { class: 'row', style: 'gap:6px' }, el('input', { type: 'checkbox', checked: t.released, onchange: async e => { await T('attempt_release', id, e.target.checked); toast(e.target.checked ? 'Released to the student' : 'Hidden from the student'); } }), 'Released to student')),
    el('p', { class: 'mut', text: `${t.email} · Set ${t.set_id} · started ${fmtDate(t.started_at)} · ${t.status === 'finished' ? 'submitted ' + fmtDate(t.finished_at) : 'in progress'} · auto-marked ${t.auto_max ? num(t.auto_score) + '/' + num(t.auto_max) : '–'}` }),
    el('details', { class: 'card' }, el('summary', { text: `Proctoring log · ${leaves} focus loss(es), ${ev.length} events` }),
      el('div', { class: 'mut', style: 'max-height:200px;overflow:auto' }, ev.map(e => el('div', { text: fmtDur(e[0]) + ' · ' + e[1] })))));
  if (!s) { main.append(el('p', { class: 'err', text: 'The question set for this attempt was deleted.' })); return; }
  for (const c of s.body.cards) {
    const box = el('div', { class: 'card rev' }, el('div', { class: 'row' }, el('h3', { text: c.title || c.id, style: 'margin:0' }), el('span', { class: 'sp' }), st.t?.[c.id] ? el('span', { class: 'mut', text: 'Time ' + fmtDur(st.t[c.id]) }) : null, st.flag?.[c.id] ? el('span', { class: 'chip', text: '⚑ flagged' }) : null));
    if (c.stim || (c.figs || []).length) { const d = el('details', null, el('summary', { text: 'Source material' })); const sbox = el('div'); d.append(sbox); d.addEventListener('toggle', () => { if (d.open && !sbox.childNodes.length) renderStim(sbox, c, { pack: t.settings?.pack }); }); box.append(d); }
    if (c.stem) box.append(el('div', { html: c.stem }));
    if (c.type === 'mcq') {
      const ch = ans[c.id] == null ? null : +ans[c.id], k = K[c.id];
      (c.opts || []).forEach((o, j) => box.append(el('div', { class: 'opt' + (k && k.ans === String.fromCharCode(65 + j) ? ' cor' : ch === j ? ' wr' : '') }, el('span', { html: o }), ch === j ? el('b', { text: '  ← chosen' }) : null)));
    } else if (c.type !== 'free') {
      box.append(el('p', { html: `Answer: <b>${esc(ans[c.id] ?? '—')}</b>` + (K[c.id] ? ` · key <b>${esc(K[c.id].ans)}</b>` : '') }));
    } else {
      for (const sb of c.subs || []) {
        const qid = c.id + '.' + sb.k, k = K[qid], g = G[qid] || {};
        const max = k ? +k.max : (sb.pts || 1);
        const score = el('input', { type: 'number', min: 0, max, step: 0.5, value: g.score ?? '', style: 'width:80px', 'aria-label': 'Score' });
        const com = el('textarea', { rows: 2, style: 'width:100%', placeholder: 'Comment for the student', text: g.comment || '' });
        const stat = el('span', { class: 'mut', text: g.score != null ? 'Saved' : 'Not marked' });
        const save = async () => {
          if (score.value === '') return;
          const v = Math.max(0, Math.min(max, +score.value));
          await T('grade', id, qid, v, max, com.value);
          stat.textContent = 'Saved'; stat.className = 'ok';
        };
        score.onchange = save; com.onchange = save;
        const rub = k?.rubric?.length ? el('div', null, el('div', { class: 'mut', text: 'Marking scheme (click to add)' }), k.rubric.map(x => el('label', { class: 'row', style: 'gap:6px;margin:2px 0;align-items:flex-start' },
          el('input', { type: 'checkbox', onchange: e => { score.value = Math.max(0, Math.min(max, (+score.value || 0) + (e.target.checked ? 1 : -1) * x.pts)); save(); } }), el('span', { html: `<b>${x.pts}</b> · ${x.desc}` })))) : null;
        box.append(el('div', { class: 'sub' }, el('div', { class: 'lab', html: sb.html || '' }), viewSub(c, sb, ans),
          k?.rationale ? el('details', null, el('summary', { text: 'Model solution' }), el('div', { html: k.rationale })) : null, rub,
          el('div', { class: 'row', style: 'margin-top:6px' }, el('b', { text: 'Score' }), score, el('span', { text: '/ ' + num(max) }), stat), com));
      }
    }
    main.append(box);
  }
}

async function settings() {
  const cfg = isAdmin() ? await T('config') : null;
  main.innerHTML = '';
  main.append(crumb(['Rooms', '#'], ['Settings']), el('h1', { text: 'Settings' }),
    cfg ? el('div', { class: 'card' },
      el('label', { class: 'row', style: 'gap:6px' }, el('input', { type: 'checkbox', checked: cfg.lb_names === 'true', onchange: async e => { await T('config_set', 'lb_names', String(e.target.checked)); toast('Saved'); } }), 'Show full names on leaderboards (otherwise initials)')) : null,
    el('div', { class: 'card' }, el('h3', { text: 'Backup', style: 'margin-top:0' }), el('p', { class: 'mut', text: 'Download your rooms, activities, question sets, answer keys, attempts and grades as JSON.' }),
      el('button', { text: 'Download backup', onclick: async () => download('exam-hall-backup-' + new Date().toISOString().slice(0, 10) + '.json', await T('backup')) })));
}

window.addEventListener('hashchange', () => { window.onbeforeunload = null; route(); });
route();
