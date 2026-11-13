import { $, el, CFG, user, requireUser, teacherSql, S, toast, topbar } from './core.js';
import { loadKind, kindInfo } from './activities/index.js';

const params = new URLSearchParams(location.search);
const slug = (params.get('a') || '').trim();
const isHost = params.get('host') === '1';
const main = $('#main');

function fail(message, back) {
  main.replaceChildren(el('div', { class: 'card', role: 'alert' },
    el('h1', { text: 'Activity unavailable' }),
    el('p', { text: message }),
    el('p', null, el('a', { class: 'btn', href: back.href, text: back.text }))));
}

async function loadHost() {
  requireUser('teacher');
  topbar('Dashboard');
  const q = await teacherSql();
  const rows = await q`select * from exam.activities where slug=${slug}`;
  if (!rows.length) return null;
  const activity = rows[0];
  if (activity.kind === 'exam') { location.replace('dashboard.html#act=' + encodeURIComponent(slug)); return false; }
  const rooms = await q`select slug, title, code from exam.rooms where slug=${activity.room}`;
  return { u: user(), activity, room: rooms[0] || { slug: activity.room, title: activity.room } };
}

async function loadParticipant() {
  const u = user();
  if (!u || u.role !== 'student' || !u.code) { location.href = 'index.html'; return false; }
  let data;
  try { data = await S.join(u.code); } catch { location.href = 'index.html'; return false; }
  if (!data || !data.room) { location.href = 'index.html'; return false; }
  topbar('Room');
  const activity = (data.activities || []).find(a => a.slug === slug);
  if (!activity) return null;
  if (activity.kind === 'exam') { location.replace('exam.html?a=' + encodeURIComponent(slug)); return false; }
  return { u, activity, room: data.room };
}

function header(activity, room) {
  const info = kindInfo(activity.kind);
  const chips = [el('span', { class: 'chip', text: info.icon + ' ' + info.label })];
  if (room && room.title) chips.push(el('span', { class: 'chip', text: 'Room: ' + room.title }));
  if (isHost) {
    chips.unshift(el('span', { class: 'chip ok', text: 'Host view' }));
    if (room && room.code) chips.push(el('span', { class: 'chip', text: 'Code: ' + room.code }));
  }
  return el('div', { class: 'act-head' },
    el('p', { class: 'mut' }, el('a', { href: isHost ? 'dashboard.html' : 'student.html', text: isHost ? '← Dashboard' : '← Back to room' })),
    el('h1', { text: activity.title || info.label }),
    activity.subtitle ? el('p', { class: 'mut', text: activity.subtitle }) : null,
    el('div', { class: 'row act-chips' }, chips));
}

async function boot() {
  if (!slug) { location.href = isHost ? 'dashboard.html' : 'index.html'; return; }
  const back = isHost ? { href: 'dashboard.html', text: 'Back to dashboard' } : { href: 'student.html', text: 'Back to room' };
  let found;
  try { found = isHost ? await loadHost() : await loadParticipant(); }
  catch (e) {
    if (e && e.message === 'auth') return;
    toast('Could not load the activity: ' + (e && e.message ? e.message : e));
    fail('Something went wrong while loading this activity. Please try again.', back);
    return;
  }
  if (found === false) return;
  if (!found) { fail('This activity does not exist or is not open in your room.', back); return; }
  const { u, activity, room } = found;
  let mod;
  try { mod = await loadKind(activity.kind); }
  catch { fail('This kind of activity is not supported.', back); return; }
  const run = isHost ? mod.host : mod.join;
  if (typeof run !== 'function') { fail('This activity cannot be opened here.', back); return; }
  document.title = (activity.title || kindInfo(activity.kind).label) + ' · ' + (CFG.siteName || 'Exam Hall');
  const settings = { ...(typeof mod.defaults === 'function' ? mod.defaults() : {}), ...(activity.settings || {}) };
  const mount = el('div', { class: 'act-body' });
  main.replaceChildren(header(activity, room), mount);
  const ctx = {
    user: u,
    activity: { slug: activity.slug, kind: activity.kind, title: activity.title, subtitle: activity.subtitle, settings },
    room, S, teacherSql, isHost
  };
  try { await run.call(mod, mount, ctx); }
  catch (e) { toast('The activity failed to start: ' + (e && e.message ? e.message : e)); }
}

boot();
