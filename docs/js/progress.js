import { el, esc, S, fmtDate, fmtDur, num, typeset, CFG } from './core.js';
import { renderStim } from './figures.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (t, a, ...kids) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); kids.forEach(k => k && e.append(k)); return e; };
const pct = (a, b) => (b > 0 ? 100 * a / b : null);
const fmtPct = v => (v == null ? '–' : Math.round(v) + '%');
const avg = xs => { const v = xs.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const LEAVES = ['blur', 'hidden', 'fs-exit'];
const LEVELS = ['Easy', 'Medium', 'Hard'];
const shortDate = d => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
const topicOf = unit => String(unit || '').split('·')[0].trim();

/* ------------------------------------------------------------ tooltip */

let tip;
function showTip(e, html) {
  if (!tip) { tip = el('div', { class: 'pg-tip', role: 'tooltip' }); document.body.append(tip); }
  tip.innerHTML = html; tip.hidden = false;
  const x = Math.min(innerWidth - tip.offsetWidth - 8, e.clientX + 12), y = Math.max(8, e.clientY - tip.offsetHeight - 10);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { if (tip) tip.hidden = true; };
function hover(node, html) {
  node.addEventListener('pointerenter', e => showTip(e, html));
  node.addEventListener('pointermove', e => showTip(e, html));
  node.addEventListener('pointerleave', hideTip);
  return node;
}

/* ------------------------------------------------------------ charts */

export function sparkline(points, { w = 180, h = 40, label = '' } = {}) {
  const vals = points.filter(p => p.v != null);
  const svg = sv('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'pg-spark', role: 'img', 'aria-label': label + ': ' + vals.map(p => Math.round(p.v) + '%').join(', ') });
  if (!vals.length) return svg;
  const pad = 6, X = i => vals.length === 1 ? w / 2 : pad + i * (w - 2 * pad) / (vals.length - 1), Y = v => h - pad - (v / 100) * (h - 2 * pad);
  svg.append(sv('line', { x1: pad, x2: w - pad, y1: Y(50), y2: Y(50), class: 'pg-mid' }));
  if (vals.length > 1) svg.append(sv('polyline', { points: vals.map((p, i) => X(i) + ',' + Y(p.v)).join(' '), class: 'pg-line' }));
  vals.forEach((p, i) => {
    const last = i === vals.length - 1;
    svg.append(sv('circle', { cx: X(i), cy: Y(p.v), r: last ? 4 : 2.5, class: last ? 'pg-dot pg-last' : 'pg-dot' }));
    svg.append(hover(sv('circle', { cx: X(i), cy: Y(p.v), r: 10, class: 'pg-hit' }), `<b>${Math.round(p.v)}%</b><br>${esc(p.t || '')}`));
  });
  return svg;
}

function lineChart(points, { label }) {
  const W = 900, H = 230, L = 38, R = 14, T = 14, B = 30;
  const vals = points.map((p, i) => ({ ...p, i })).filter(p => p.v != null);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pg-line-chart', role: 'img', 'aria-label': label + ': ' + vals.map(p => Math.round(p.v) + '%').join(', ') });
  const n = points.length, X = i => n === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1), Y = v => T + (100 - v) / 100 * (H - T - B);
  [0, 25, 50, 75, 100].forEach(v => {
    svg.append(sv('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: v === 0 ? 'pg-axis' : 'pg-grid' }));
    svg.append(sv('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'pg-tick' }, document.createTextNode(v + '%')));
  });
  const every = Math.ceil(n / 8);
  points.forEach((p, i) => { if (i % every === 0 || i === n - 1) svg.append(sv('text', { x: X(i), y: H - 9, 'text-anchor': 'middle', class: 'pg-tick' }, document.createTextNode(p.x))); });
  if (vals.length > 1) {
    const d = vals.map((p, k) => (k ? 'L' : 'M') + X(p.i) + ' ' + Y(p.v)).join(' ');
    svg.append(sv('path', { d: d + ` L${X(vals[vals.length - 1].i)} ${Y(0)} L${X(vals[0].i)} ${Y(0)} Z`, class: 'pg-area' }));
    svg.append(sv('path', { d, class: 'pg-line' }));
  }
  vals.forEach((p, k) => {
    const last = k === vals.length - 1;
    svg.append(sv('circle', { cx: X(p.i), cy: Y(p.v), r: last ? 5 : 4, class: 'pg-dot' }));
    if (last) svg.append(sv('text', { x: X(p.i), y: Y(p.v) - 10, 'text-anchor': 'middle', class: 'pg-lab' }, document.createTextNode(Math.round(p.v) + '%')));
    svg.append(hover(sv('rect', { x: X(p.i) - 16, y: T, width: 32, height: H - T - B, class: 'pg-hit' }), `<b>${Math.round(p.v)}%</b><br>${esc(p.t || '')}`));
  });
  return svg;
}

function donut(segs, { center, sub, label }) {
  const total = segs.reduce((s, x) => s + x.v, 0);
  const size = 150, r = 58, wdt = 20, c = 2 * Math.PI * r;
  const svg = sv('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'pg-donut', role: 'img', 'aria-label': label + ': ' + segs.map(s => s.label + ' ' + s.v).join(', ') });
  svg.append(sv('circle', { cx: size / 2, cy: size / 2, r, class: 'pg-ring' }));
  let off = 0;
  if (total > 0) segs.forEach(s => {
    if (!s.v) return;
    const len = s.v / total * c;
    const arc = sv('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: s.color, 'stroke-width': wdt, 'stroke-dasharray': `${Math.max(0, len - (segs.filter(x => x.v).length > 1 ? 2 : 0))} ${c}`, 'stroke-dashoffset': -off, transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'pg-arc' });
    svg.append(hover(arc, `<b>${esc(s.label)}</b><br>${s.tip || s.v + ' · ' + Math.round(s.v / total * 100) + '%'}`));
    off += len;
  });
  svg.append(sv('text', { x: size / 2, y: size / 2 + 4, 'text-anchor': 'middle', class: 'pg-dc' }, document.createTextNode(center)));
  if (sub) svg.append(sv('text', { x: size / 2, y: size / 2 + 22, 'text-anchor': 'middle', class: 'pg-ds' }, document.createTextNode(sub)));
  const legend = el('ul', { class: 'pg-legend' }, segs.map(s => el('li', null, el('i', { style: 'background:' + s.color }), el('span', { text: s.label }), el('b', { text: s.show ?? String(s.v) }))));
  return el('div', { class: 'pg-donutw' }, svg, legend);
}

function columns(items, { label, unit = '' }) {
  const W = 900, H = 160, B = 22, T = 16;
  const max = Math.max(1, ...items.map(x => x.v));
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pg-cols', role: 'img', 'aria-label': label });
  const bw = W / items.length;
  svg.append(sv('line', { x1: 0, x2: W, y1: H - B, y2: H - B, class: 'pg-axis' }));
  items.forEach((x, i) => {
    const bh = x.v ? Math.max(3, x.v / max * (H - B - T)) : 0, cx = i * bw + bw / 2, w = Math.min(34, bw - 6);
    if (bh) svg.append(sv('path', { d: `M${cx - w / 2} ${H - B} V${H - B - bh + 4} Q${cx - w / 2} ${H - B - bh} ${cx - w / 2 + 4} ${H - B - bh} H${cx + w / 2 - 4} Q${cx + w / 2} ${H - B - bh} ${cx + w / 2} ${H - B - bh + 4} V${H - B} Z`, class: 'pg-col' }));
    if (i % Math.ceil(items.length / 8) === 0 || i === items.length - 1) svg.append(sv('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'pg-tick' }, document.createTextNode(x.label)));
    svg.append(hover(sv('rect', { x: i * bw, y: 0, width: bw, height: H - B, class: 'pg-hit' }), `<b>${x.show || x.v + unit}</b><br>${esc(x.tip || x.label)}`));
  });
  return svg;
}

function hbars(rows) {
  return el('div', { class: 'pg-hbars' }, rows.map(r => el('div', { class: 'pg-hrow' },
    el('span', { class: 'pg-hl', text: r.label }),
    hover(el('div', { class: 'pg-bar' }, el('div', { class: 'pg-fill', style: `width:${r.v == null ? 0 : Math.max(2, r.v)}%` })), `<b>${fmtPct(r.v)}</b><br>${esc(r.tip || '')}`),
    el('b', { class: 'pg-val', text: fmtPct(r.v) }))));
}

function heat(v) {
  if (v == null) return { style: '', cls: 'pg-cell none' };
  const s = Math.round(12 + v * 0.8);
  return { style: `background:color-mix(in srgb,var(--mar) ${s}%,var(--bg))`, cls: 'pg-cell' + (s > 55 ? ' dark' : '') };
}

/* ------------------------------------------------------------ data */

function attemptStats(a, rep, set) {
  const auto = rep.auto || {}, st = rep.state || {}, grades = rep.grades || [];
  let correct = 0, wrong = 0, blank = 0, tc = [], tw = [];
  const t = st.t || {};
  for (const k of rep.keys) {
    if (k.kind === 'manual' || auto[k.qid] === undefined) continue;
    const given = st.ans?.[k.qid];
    if (given == null || given === '') { blank++; continue; }
    if (auto[k.qid].ok) { correct++; if (t[k.qid]) tc.push(+t[k.qid]); }
    else { wrong++; if (t[k.qid]) tw.push(+t[k.qid]); }
  }
  const manual = grades.reduce((s, g) => [s[0] + +g.score, s[1] + +g.max], [0, 0]);
  const total = a.released ? pct(+a.auto_score + manual[0], +a.auto_max + manual[1]) : null;
  const autoP = pct(+a.auto_score, +a.auto_max);
  const time = Object.values(t).reduce((s, x) => s + +x, 0);
  const answered = new Set(Object.keys(st.ans || {}).filter(k => st.ans[k] != null && st.ans[k] !== '').map(k => k.split('.')[0])).size;
  return {
    a, rep, set, correct, wrong, blank, time, answered, ncards: set?.body.cards.length || 0,
    score: total ?? autoP, autoP, total, released: a.released, manual,
    tCorrect: avg(tc), tWrong: avg(tw), focus: (st.ev || []).filter(e => LEAVES.includes(e[1])).length,
    when: a.finished_at, label: 'Set ' + a.set
  };
}

function collect(reports) {
  const topics = new Map(), skills = new Map(), levels = new Map();
  const add = (map, key, ai, earned, max) => {
    if (!key) return;
    const r = map.get(key) || { per: [] };
    r.per[ai] = r.per[ai] || [0, 0];
    r.per[ai][0] += earned; r.per[ai][1] += max;
    map.set(key, r);
  };
  reports.forEach((rep, ai) => {
    const auto = rep.auto || {}, grades = Object.fromEntries((rep.grades || []).map(g => [g.q, g]));
    for (const k of rep.keys) {
      let earned = null, max = +k.max || 1;
      if (k.kind !== 'manual') earned = auto[k.qid]?.ok ? max : 0;
      else if (grades[k.qid]) { earned = +grades[k.qid].score; max = +grades[k.qid].max || max; }
      if (earned == null) continue;
      add(topics, topicOf(k.unit), ai, earned, max);
      String(k.sp || '').split('·').map(s => s.trim()).filter(Boolean).forEach(s => add(skills, s, ai, earned, max));
      if (LEVELS.includes((k.lvl || '').trim())) add(levels, k.lvl.trim(), ai, earned, max);
    }
  });
  for (const map of [topics, skills, levels]) for (const r of map.values()) {
    r.series = reports.map((rep, i) => ({ v: r.per[i] ? pct(r.per[i][0], r.per[i][1]) : null, t: fmtDate(rep.attempt.finished_at) }));
    const seen = r.series.filter(p => p.v != null);
    r.latest = seen.length ? seen[seen.length - 1].v : null;
    r.first = seen.length ? seen[0].v : null;
    r.lost = r.per[reports.length - 1] ? r.per[reports.length - 1][1] - r.per[reports.length - 1][0] : 0;
    r.max = r.per.reduce((s, x) => s + (x ? x[1] : 0), 0);
  }
  return { topics, skills, levels };
}

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/* ------------------------------------------------------------ summaries */

function examSummary(g, stats, br) {
  const s = stats.filter(x => x.score != null);
  if (!s.length) return 'Your score appears here once your attempt is marked.';
  const last = s[s.length - 1], first = s[0], best = s.reduce((m, x) => (x.score > m.score ? x : m), s[0]);
  const parts = [`Your latest score is <b>${fmtPct(last.score)}</b> on ${esc(last.label)} (${shortDate(last.when)}).`];
  if (s.length > 1) {
    const d = Math.round(last.score - first.score);
    parts.push(d > 0 ? `That is <b class="ok">${d} points higher</b> than your first attempt.` : d < 0 ? `That is <b class="bad">${-d} points lower</b> than your first attempt.` : 'That matches your first attempt.');
    if (best !== last) parts.push(`Your best is ${fmtPct(best.score)} on ${shortDate(best.when)}.`);
  }
  const units = [...br.topics.entries()].filter(([, r]) => r.latest != null).sort((a, b) => b[1].latest - a[1].latest);
  if (units.length > 1) {
    parts.push(`Strongest unit: <b>${esc(units[0][0])}</b> (${fmtPct(units[0][1].latest)}).`);
    const weak = units.slice(-2).reverse().filter(u => u[1].latest < 80);
    if (weak.length) parts.push(`Focus next on ${weak.map(u => `<b>${esc(u[0])}</b> (${fmtPct(u[1].latest)})`).join(' and ')}.`);
  }
  if (last.tCorrect != null && last.tWrong != null && last.tWrong > last.tCorrect * 1.3) parts.push(`You spent longer on questions you got wrong (${fmtDur(last.tWrong)} vs ${fmtDur(last.tCorrect)}), so flag and move on sooner.`);
  if (last.blank) parts.push(`You left ${last.blank} question${last.blank > 1 ? 's' : ''} blank last time; a guess costs nothing.`);
  if (last.total == null && (last.set?.body.cards || []).some(c => c.type === 'free')) parts.push('Written answers count once your teacher releases marks.');
  return parts.join(' ');
}

function overallSummary(groups, all) {
  const s = all.filter(x => x.score != null);
  const days = new Set(all.map(x => new Date(x.when).toDateString())).size;
  const time = all.reduce((t, x) => t + x.time, 0);
  const parts = [`You've submitted <b>${all.length}</b> attempt${all.length > 1 ? 's' : ''} across <b>${groups.length}</b> exam${groups.length > 1 ? 's' : ''} on ${days} day${days > 1 ? 's' : ''}, with ${fmtDur(time)} of focused exam time.`];
  if (s.length) parts.push(`Your average score is <b>${fmtPct(avg(s.map(x => x.score)))}</b>.`);
  const moved = groups.map(g => {
    const v = g.stats.filter(x => x.score != null);
    return v.length > 1 ? { t: g.activity.title, d: v[v.length - 1].score - v[0].score } : null;
  }).filter(Boolean).sort((a, b) => b.d - a.d);
  if (moved.length && moved[0].d > 0) parts.push(`Biggest improvement: <b>${esc(moved[0].t)}</b> (+${Math.round(moved[0].d)} points).`);
  const weakest = groups.map(g => ({ t: g.activity.title, v: g.stats.filter(x => x.score != null).pop()?.score })).filter(x => x.v != null).sort((a, b) => a.v - b.v)[0];
  if (groups.length > 1 && weakest) parts.push(`Lowest latest score: <b>${esc(weakest.t)}</b> (${fmtPct(weakest.v)}).`);
  return parts.join(' ');
}

/* ------------------------------------------------------------ sections */

function kpis(items) {
  return el('div', { class: 'pg-kpis' }, items.map(([label, value, extra]) => el('div', { class: 'pg-kpi' }, el('span', { class: 'mut', text: label }), el('b', { text: value }), extra || null)));
}

function delta(series) {
  const v = series.filter(p => p.v != null);
  if (v.length < 2) return el('span', { class: 'mut', text: v.length ? 'First attempt' : '' });
  const d = Math.round(v[v.length - 1].v - v[0].v);
  return el('span', { class: 'pg-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : ''), text: (d > 0 ? '▲ +' : d < 0 ? '▼ ' : '● ') + d + ' pts since first' });
}

function resultDonut(st) {
  const n = st.correct + st.wrong + st.blank;
  if (!n) return null;
  return donut([
    { label: 'Correct', v: st.correct, color: 'var(--ok)' },
    { label: 'Incorrect', v: st.wrong, color: 'var(--bad)' },
    { label: 'Unanswered', v: st.blank, color: 'var(--mut)' }
  ], { center: fmtPct(pct(st.correct, n)), sub: 'auto-marked', label: 'Latest attempt results' });
}

function lostDonut(topics) {
  const rows = [...topics.entries()].map(([k, r]) => ({ k, lost: r.lost })).filter(r => r.lost > 0).sort((a, b) => b.lost - a.lost);
  if (!rows.length) return null;
  const top = rows.slice(0, 5), rest = rows.slice(5).reduce((s, r) => s + r.lost, 0);
  const segs = top.map((r, i) => ({ label: r.k, v: Math.round(r.lost * 10) / 10, color: `var(--c${i + 1})` }));
  if (rest) segs.push({ label: 'Other units', v: Math.round(rest * 10) / 10, color: 'var(--c-other)' });
  const total = segs.reduce((s, x) => s + x.v, 0);
  return donut(segs, { center: String(Math.round(total)), sub: 'marks lost', label: 'Marks lost by unit, latest attempt' });
}

function unitHeatmap(topics, stats) {
  const rows = [...topics.entries()].filter(([, r]) => r.max > 0).sort((a, b) => natural(a[0], b[0]));
  if (!rows.length) return null;
  const start = Math.max(0, stats.length - 10), cols = stats.slice(start);
  const t = el('table', { class: 'pg-heat' },
    el('tr', null, el('th', { text: 'Unit' }), cols.map((s, i) => el('th', { class: 'c', title: fmtDate(s.when), text: '#' + (start + i + 1) })), el('th', { text: 'Trend' }), el('th', { text: 'Change' })));
  for (const [name, r] of rows) {
    const tr = el('tr', null, el('td', { class: 'pg-un', text: name }));
    cols.forEach((s, i) => {
      const v = r.series[start + i]?.v, h = heat(v);
      tr.append(hover(el('td', { class: h.cls, style: h.style, text: v == null ? '' : Math.round(v) }), `<b>${esc(name)}</b><br>Attempt ${start + i + 1} · ${shortDate(s.when)}<br>${v == null ? 'Not tested' : Math.round(v) + '%'}`));
    });
    const ch = r.latest != null && r.first != null && r.series.filter(p => p.v != null).length > 1 ? Math.round(r.latest - r.first) : null;
    tr.append(el('td', null, r.series.filter(p => p.v != null).length > 1 ? sparkline(r.series, { w: 90, h: 24, label: name }) : el('span', { class: 'mut', text: '–' })),
      el('td', { class: 'pg-ch ' + (ch > 0 ? 'ok' : ch < 0 ? 'bad' : 'mut'), text: ch == null ? '–' : (ch > 0 ? '+' : '') + ch }));
    t.append(tr);
  }
  return el('div', { class: 'card' }, el('h3', { text: 'Unit progress across attempts', style: 'margin-top:0' }),
    el('p', { class: 'mut', text: 'Percent of marks earned in each unit, per attempt. Darker is better.' }),
    el('div', { style: 'overflow-x:auto' }, t),
    el('div', { class: 'pg-scale', 'aria-hidden': 'true' }, el('span', { text: '0%' }), el('i'), el('span', { text: '100%' })));
}

function weekly(all) {
  if (!all.length) return null;
  const wk = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const end = wk(new Date()), items = [];
  for (let i = 11; i >= 0; i--) {
    const s = new Date(end); s.setDate(s.getDate() - 7 * i);
    const inWk = all.filter(x => wk(x.when).getTime() === s.getTime());
    const m = Math.round(inWk.reduce((t, x) => t + x.time, 0) / 60);
    items.push({ label: shortDate(s), v: m, show: m + ' min', tip: `Week of ${shortDate(s)} · ${inWk.length} attempt${inWk.length === 1 ? '' : 's'}` });
  }
  return columns(items, { label: 'Exam minutes per week, last 12 weeks', unit: ' min' });
}

function attemptLog(groups) {
  const log = el('table', { class: 'pg-table' }, el('tr', null, ['Exam', 'Version', 'Submitted', 'Score', 'Auto-marked', 'Teacher-marked', 'Answered', 'Time', 'Per question', 'Focus losses'].map(t => el('th', { text: t }))));
  for (const g of groups) for (const s of [...g.stats].reverse()) {
    const a = s.a;
    log.append(el('tr', null, el('td', { text: g.activity.title }), el('td', { text: a.set }), el('td', { text: fmtDate(a.finished_at) }),
      el('td', null, el('b', { text: fmtPct(s.score) })),
      el('td', { text: a.auto_max > 0 ? num(a.auto_score) + ' / ' + num(a.auto_max) : '–' }),
      el('td', { text: a.released ? num(s.manual[0]) + ' / ' + num(s.manual[1]) : 'Pending' }),
      el('td', { text: s.ncards ? s.answered + ' / ' + s.ncards : s.answered }), el('td', { text: fmtDur(s.time) }), el('td', { text: s.answered ? fmtDur(s.time / s.answered) : '–' }),
      el('td', { text: s.focus })));
  }
  return el('div', { class: 'card', style: 'overflow-x:auto' }, log);
}

/* ------------------------------------------------------------ mistakes + flashcards */

function mistakes(groups) {
  const out = [];
  for (const g of groups) {
    const lastSeen = {};
    g.reports.forEach((rep, i) => {
      const auto = rep.auto || {};
      for (const k of rep.keys) if (k.kind !== 'manual' && auto[k.qid] !== undefined) lastSeen[rep.attempt.set_id + '|' + k.qid] = { ok: auto[k.qid].ok, i };
    });
    const seen = new Set();
    for (let i = g.reports.length - 1; i >= 0; i--) {
      const rep = g.reports[i], auto = rep.auto || {}, set = g.sets[rep.attempt.set_id];
      if (!set) continue;
      const cards = Object.fromEntries(set.body.cards.map(c => [c.id, c]));
      for (const k of rep.keys) {
        if (k.kind === 'manual') continue;
        const id = rep.attempt.set_id + '|' + k.qid;
        if (seen.has(id) || !auto[k.qid] || auto[k.qid].ok) continue;
        seen.add(id);
        const c = cards[k.qid]; if (!c) continue;
        out.push({ key: g.activity.slug + '|' + id, act: g.activity, card: c, k, given: rep.state?.ans?.[k.qid], fixed: lastSeen[id]?.ok === true, when: rep.attempt.finished_at });
      }
    }
  }
  return out;
}

const ankiMath = h => String(h || '').replace(/\$\$([\s\S]+?)\$\$/g, '\\[$1\\]').replace(/(^|[^\\])\$([^$\n]+?)\$/g, '$1\\($2\\)');
const noFigs = h => String(h || '').replace(/<div data-fig="\d+"><\/div>/g, '');

function cardParts(m) {
  const c = m.card, k = m.k, ans = String(k.ans || '').split('|')[0];
  const chosen = m.given == null || m.given === '' ? null : c.type === 'mcq' ? +m.given : m.given;
  const stim = noFigs(c.stim).trim();
  const figNote = (c.figs || []).length ? '<p><i>This question has a figure. Open it in Exam Hall to see it.</i></p>' : '';
  let front = (stim ? `<div class="stim">${stim}</div>` : '') + figNote + (c.stem || '');
  if (c.type === 'mcq') front += '<div class="opts">' + (c.opts || []).map(o => `<div>${o}</div>`).join('') + '</div>';
  let back = '';
  if (c.type === 'mcq') {
    const j = ans.charCodeAt(0) - 65;
    back += `<p><b>Answer: ${esc(ans)}</b>${c.opts?.[j] ? ' · ' + c.opts[j].replace(/^[A-Z]\.\s*/, '') : ''}</p>`;
    if (chosen != null && String.fromCharCode(65 + chosen) !== ans) back += `<p><b>You chose ${String.fromCharCode(65 + chosen)}.</b> ${esc(k.dx?.[chosen] || '')}</p>`;
    else if (chosen == null) back += '<p><b>You left this blank.</b></p>';
  } else {
    back += `<p><b>Answer: ${esc(ans)}</b></p><p>You wrote: ${esc(m.given ?? '—')}</p>`;
  }
  if (k.rationale) back += `<div>${k.rationale}</div>`;
  return { front, back, chosen, ans };
}

function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function exportAnki(deck, deckName) {
  const field = s => '"' + ankiMath(s).replace(/[\t\r\n]+/g, ' ').replace(/"/g, '""') + '"';
  const tag = s => String(s || '').trim().replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '');
  const lines = ['#separator:tab', '#html:true', '#notetype:Basic', '#deck:' + deckName.replace(/[\t\n]/g, ' '), '#tags column:3'];
  for (const m of deck) {
    const { front, back } = cardParts(m);
    const head = `<div style="font-size:12px;opacity:.7">${esc(m.act.title)}${m.k.unit ? ' · ' + esc(m.k.unit) : ''}</div>`;
    lines.push([field(head + front), field(back), tag(m.act.slug) + ' ' + tag(topicOf(m.k.unit)) + (m.k.lvl ? ' ' + tag(m.k.lvl) : '')].join('\t'));
  }
  download(deckName.replace(/\W+/g, '-').toLowerCase() + '.txt', lines.join('\n') + '\n', 'text/plain;charset=utf-8');
}

function exportPdf(deck, title) {
  const w = window.open('', '_blank');
  if (!w) { alertBox('Allow pop-ups for this site to export a PDF.'); return; }
  const k = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/';
  const cards = deck.map((m, i) => {
    const { front, back } = cardParts(m);
    return `<section class="fc"><div class="meta">${i + 1} · ${esc(m.act.title)}${m.k.unit ? ' · ' + esc(m.k.unit) : ''}${m.k.lvl ? ' · ' + esc(m.k.lvl) : ''}</div>
      <div class="q">${front}</div><div class="a"><div class="lbl">Answer</div>${back}</div></section>`;
  }).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="stylesheet" href="${k}katex.min.css">
<style>
body{font:14px/1.5 Georgia,serif;color:#1d1d1f;margin:0;padding:28px}
h1{font-size:22px;margin:0 0 4px}.sub{font:12px system-ui,sans-serif;color:#666;margin:0 0 20px}
.fc{border:1px solid #d8c9cb;border-radius:10px;padding:14px 16px;margin:0 0 14px;break-inside:avoid;page-break-inside:avoid}
.meta{font:11px system-ui,sans-serif;color:#8c1c2b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.stim{background:#fbf7f7;border-left:3px solid #d8c9cb;padding:6px 10px;margin-bottom:8px;font-size:13px}
.opts div{padding:2px 0}
.a{border-top:1px dashed #d8c9cb;margin-top:10px;padding-top:8px}
.lbl{font:600 11px system-ui,sans-serif;color:#1d7a46;text-transform:uppercase;letter-spacing:.05em}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 6px}
img,svg{max-width:100%}
.bar{position:sticky;top:0;background:#fff;padding:8px 0 12px;display:flex;gap:8px}
.bar button{font:14px system-ui,sans-serif;padding:7px 14px;border-radius:6px;border:1px solid #8c1c2b;background:#8c1c2b;color:#fff;cursor:pointer}
@media print{.bar{display:none}body{padding:0}}
</style></head><body>
<div class="bar"><button onclick="print()">Save as PDF / Print</button></div>
<h1>${esc(title)}</h1><p class="sub">${deck.length} cards · exported ${new Date().toLocaleDateString()} · ${esc(CFG.siteName || 'Exam Hall')}</p>
${cards}
<script src="${k}katex.min.js"><\/script><script src="${k}contrib/auto-render.min.js"><\/script>
<script>window.onload=function(){try{renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\\\[',right:'\\\\]',display:true},{left:'\\\\(',right:'\\\\)',display:false},{left:'$',right:'$',display:false}],throwOnError:false})}catch(e){}setTimeout(function(){print()},400)}<\/script>
</body></html>`);
  w.document.close();
}
function alertBox(msg) { const t = el('div', { class: 'toast', role: 'status', text: msg }); document.body.append(t); setTimeout(() => t.remove(), 4000); }

function flashcards(list, uid, { showExam = true } = {}) {
  const store = 'fc:' + uid;
  let known = new Set(); try { known = new Set(JSON.parse(localStorage[store] || '[]')); } catch {}
  const saveKnown = () => { try { localStorage[store] = JSON.stringify([...known]); } catch {} };
  const exams = [...new Map(list.map(m => [m.act.slug, m.act.title])).entries()];
  const topics = [...new Set(list.map(m => topicOf(m.k.unit)).filter(Boolean))].sort(natural);
  let deck = [], idx = 0, flipped = false, filt = '', ex = '', showFixed = false, showKnown = false;
  const box = el('div', { class: 'card' });
  const stage = el('div', { class: 'fc-stage', tabindex: 0, 'aria-live': 'polite' });
  const count = el('span', { class: 'mut' });
  const sel = el('select', { 'aria-label': 'Unit', onchange: e => { filt = e.target.value; build(); } }, el('option', { value: '', text: 'All units' }), topics.map(t => el('option', { value: t, text: t })));
  const exSel = showExam && exams.length > 1 ? el('select', { 'aria-label': 'Exam', onchange: e => { ex = e.target.value; build(); } }, el('option', { value: '', text: 'All exams' }), exams.map(([s, t]) => el('option', { value: s, text: t }))) : null;
  const fixedCb = el('input', { type: 'checkbox', onchange: e => { showFixed = e.target.checked; build(); } });
  const knownCb = el('input', { type: 'checkbox', onchange: e => { showKnown = e.target.checked; build(); } });
  const btn = (t, f, cls) => el('button', { type: 'button', text: t, onclick: f, class: cls || '' });
  const deckName = () => 'Exam Hall · ' + (ex ? exams.find(e => e[0] === ex)[1] : exams.length === 1 ? exams[0][1] : 'Mistakes') + (filt ? ' · ' + filt : '');
  const knowBtn = btn('I know this ✓', () => { const m = deck[idx]; if (!m) return; known.has(m.key) ? known.delete(m.key) : known.add(m.key); saveKnown(); if (!showKnown && known.has(m.key)) { deck.splice(idx, 1); if (idx >= deck.length) idx = Math.max(0, deck.length - 1); flipped = false; } draw(); });
  const ankiBtn = btn('⬇ Anki', () => deck.length && exportAnki(deck, deckName()));
  const pdfBtn = btn('⬇ PDF', () => deck.length && exportPdf(deck, deckName()));
  ankiBtn.title = 'Download for Anki: File → Import, then pick this file';
  pdfBtn.title = 'Open a printable page, then choose Save as PDF';
  box.append(el('div', { class: 'row' }, el('h3', { text: 'Mistake flashcards', style: 'margin:0' }), el('span', { class: 'sp' }), count, ankiBtn, pdfBtn),
    el('p', { class: 'mut', text: 'Every question you missed. Space flips, arrow keys move. Export the current deck to Anki or as a PDF.' }),
    el('div', { class: 'row', style: 'margin-bottom:8px' }, exSel, sel, el('label', { class: 'mut' }, fixedCb, ' Include fixed'), el('label', { class: 'mut' }, knownCb, ' Include cards I know')),
    stage,
    el('div', { class: 'row', style: 'margin-top:10px' }, btn('◀ Previous', () => go(-1)), btn('Flip', () => { flipped = !flipped; draw(); }, 'pri'), btn('Next ▶', () => go(1)), el('span', { class: 'sp' }), btn('Shuffle', () => { deck.sort(() => Math.random() - 0.5); idx = 0; flipped = false; draw(); }), knowBtn));
  const go = d => { if (!deck.length) return; idx = (idx + d + deck.length) % deck.length; flipped = false; draw(); };
  stage.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipped = !flipped; draw(); }
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  });
  stage.addEventListener('click', e => { if (!e.target.closest('details,a,button')) { flipped = !flipped; draw(); } });
  function build() {
    deck = list.filter(m => (!ex || m.act.slug === ex) && (!filt || topicOf(m.k.unit) === filt) && (showFixed || !m.fixed) && (showKnown || !known.has(m.key)));
    idx = 0; flipped = false; draw();
  }
  function draw() {
    stage.innerHTML = '';
    count.textContent = deck.length ? `Card ${idx + 1} of ${deck.length}` : '';
    ankiBtn.disabled = pdfBtn.disabled = !deck.length;
    if (!deck.length) { stage.append(el('p', { class: 'mut', text: list.length ? 'No cards match. Change the filters to see more.' : 'No mistakes yet. Take an exam to build your deck.' })); return; }
    const m = deck[idx], c = m.card, k = m.k;
    const chosen = m.given == null || m.given === '' ? null : c.type === 'mcq' ? +m.given : m.given;
    const meta = el('div', { class: 'row', style: 'gap:6px' }, el('span', { class: 'chip', text: m.act.title }), k.unit ? el('span', { class: 'chip', text: k.unit }) : null, k.lvl ? el('span', { class: 'chip', text: k.lvl }) : null, m.fixed ? el('span', { class: 'chip ok', text: 'Fixed on a later attempt' }) : null, known.has(m.key) ? el('span', { class: 'chip', text: 'Known' }) : null);
    const face = el('div', { class: 'fc-face' + (flipped ? ' back' : '') });
    face.append(meta, el('div', { class: 'mut', text: (c.title || c.id) + (flipped ? ' · answer' : ' · question') }));
    if (c.stim || (c.figs || []).length) { const d = el('details', null, el('summary', { text: 'Source material' })); const s = el('div'); d.append(s); d.addEventListener('toggle', () => { if (d.open && !s.childNodes.length) renderStim(s, c, { pack: m.act.settings?.pack }); }); face.append(d); }
    if (c.stem) face.append(el('div', { class: 'fc-stem', html: c.stem }));
    if (c.type === 'mcq') {
      (c.opts || []).forEach((o, j) => {
        const L = String.fromCharCode(65 + j), right = k.ans === L, mine = chosen === j;
        const cls = flipped ? (right ? ' cor' : mine ? ' wr' : '') : '';
        const row = el('div', { class: 'opt' + cls }, el('span', { html: o }), mine ? el('b', { text: '  ← your answer' }) : null);
        if (flipped && k.dx && k.dx[j]) row.append(el('div', { class: 'mut', text: k.dx[j] }));
        face.append(row);
      });
      if (chosen == null) face.append(el('p', { class: 'bad', text: 'You left this unanswered.' }));
    } else {
      face.append(el('p', null, 'Your answer: ', el('b', { text: m.given ?? '—' })));
      if (flipped) face.append(el('p', null, 'Correct: ', el('b', { text: String(k.ans || '').split('|')[0] })));
    }
    if (flipped) {
      const why = el('div', { class: 'fc-why' });
      if (k.rationale) why.append(el('p', { html: '<b>Why the answer is ' + esc(String(k.ans).split('|')[0]) + '.</b> ' + k.rationale }));
      if (c.type === 'mcq' && chosen != null && k.dx && k.dx[chosen] && String.fromCharCode(65 + chosen) !== k.ans) why.append(el('p', { html: '<b>Where your choice went wrong.</b> ' + esc(k.dx[chosen]) }));
      if (k.sp) why.append(el('p', { class: 'mut', text: 'Skill practised: ' + k.sp }));
      face.append(why);
    } else face.append(el('p', { class: 'mut', text: 'Think it through, then flip for the answer and explanation.' }));
    knowBtn.textContent = known.has(m.key) ? 'Unmark known' : 'I know this ✓';
    stage.append(face);
    typeset(stage);
  }
  build();
  return box;
}

/* ------------------------------------------------------------ pages */

function overview(main, groups, u) {
  const all = groups.flatMap(g => g.stats).sort((a, b) => new Date(a.when) - new Date(b.when));
  const scored = all.filter(x => x.score != null);
  const mc = all.reduce((s, x) => [s[0] + x.correct, s[1] + x.correct + x.wrong + x.blank], [0, 0]);
  main.append(el('div', { class: 'card pg-sum', html: overallSummary(groups, all) }),
    kpis([
      ['Attempts', String(all.length)],
      ['Average score', fmtPct(avg(scored.map(x => x.score))), scored.length > 1 ? sparkline(scored.map(x => ({ v: x.score, t: fmtDate(x.when) })), { w: 120, h: 28, label: 'All scores' }) : null],
      ['Best score', fmtPct(scored.length ? Math.max(...scored.map(x => x.score)) : null)],
      ['Multiple-choice accuracy', fmtPct(pct(mc[0], mc[1]))],
      ['Exam time', fmtDur(all.reduce((t, x) => t + x.time, 0))],
      ['Questions answered', String(all.reduce((t, x) => t + x.answered, 0))]
    ]));

  const tiles = el('div', { class: 'grid' });
  for (const g of groups) {
    const series = g.stats.map(s => ({ v: s.score, t: fmtDate(s.when) + ' · ' + s.label }));
    const last = g.stats[g.stats.length - 1];
    tiles.append(el('a', { class: 'card pg-tile', href: '#progress=' + encodeURIComponent(g.activity.slug) },
      el('div', { class: 'row' }, el('b', { text: g.activity.title }), el('span', { class: 'sp' }), el('span', { class: 'chip', text: g.stats.length + ' attempt' + (g.stats.length > 1 ? 's' : '') })),
      el('div', { class: 'row', style: 'align-items:flex-end' }, el('div', { class: 'pg-hero', text: fmtPct(last.score) }), el('span', { class: 'mut', text: 'latest' })),
      sparkline(series, { w: 240, h: 44, label: g.activity.title + ' score history' }),
      el('div', { class: 'row' }, delta(series), el('span', { class: 'sp' }), el('span', { class: 'mut', text: 'Details →' }))));
  }
  main.append(el('h2', { text: 'Your exams' }), tiles);

  const wk = weekly(all);
  if (wk) main.append(el('h2', { text: 'Study activity' }), el('div', { class: 'card' }, el('p', { class: 'mut', text: 'Minutes spent in exams each week.', style: 'margin-top:0' }), wk));
  main.append(el('h2', { text: 'Attempt log' }), attemptLog(groups));
  main.append(el('h2', { text: 'Flashcards' }), flashcards(mistakes(groups), u.email));
}

function examPage(main, g, u) {
  const br = collect(g.reports);
  const stats = g.stats, last = stats[stats.length - 1];
  const scored = stats.filter(x => x.score != null);
  main.append(el('div', { class: 'card pg-sum', html: examSummary(g, stats, br) }),
    kpis([
      ['Latest score', fmtPct(last.score), delta(stats.map(s => ({ v: s.score })))],
      ['Best', fmtPct(scored.length ? Math.max(...scored.map(x => x.score)) : null)],
      ['Average', fmtPct(avg(scored.map(x => x.score)))],
      ['Attempts', String(stats.length)],
      ['Time per question', last.answered ? fmtDur(last.time / last.answered) : '–'],
      ['Focus losses', String(last.focus)]
    ]));

  if (stats.length > 1) main.append(el('div', { class: 'card' }, el('h3', { text: 'Score over time', style: 'margin-top:0' }),
    lineChart(stats.map((s, i) => ({ v: s.score, x: '#' + (i + 1), t: fmtDate(s.when) + ' · ' + s.label + (s.total == null && s.released === false ? ' · auto-marked only' : '') })), { label: g.activity.title + ' score over time' })));

  const pies = [['Latest attempt', resultDonut(last)], ['Where marks were lost', lostDonut(br.topics)]].filter(p => p[1]);
  if (pies.length) main.append(el('div', { class: 'pg-two' },
    ...pies.map(([t, p]) => el('div', { class: 'card' }, el('h3', { text: t, style: 'margin-top:0' }), p))));

  const hm = unitHeatmap(br.topics, stats);
  if (hm) main.append(hm);

  const lv = LEVELS.filter(l => br.levels.has(l)).map(l => ({ label: l, v: br.levels.get(l).latest, tip: 'Latest attempt' }));
  const sk = [...br.skills.entries()].filter(([, r]) => r.latest != null).sort((a, b) => a[1].latest - b[1].latest).map(([k, r]) => ({ label: k, v: r.latest, tip: 'Latest attempt' }));
  const side = [];
  if (lv.length) side.push(el('div', { class: 'card' }, el('h3', { text: 'By difficulty', style: 'margin-top:0' }), hbars(lv)));
  if (last.tCorrect != null || last.tWrong != null) side.push(el('div', { class: 'card' }, el('h3', { text: 'Time per question', style: 'margin-top:0' }),
    kpis([['When correct', last.tCorrect != null ? fmtDur(last.tCorrect) : '–'], ['When wrong', last.tWrong != null ? fmtDur(last.tWrong) : '–'], ['Total', fmtDur(last.time)]])));
  if (side.length) main.append(el('div', { class: 'pg-two' }, ...side));
  if (sk.length) main.append(el('div', { class: 'card' }, el('h3', { text: 'Skills', style: 'margin-top:0' }), hbars(sk)));

  main.append(el('h2', { text: 'Attempts' }), attemptLog([g]));
  main.append(el('h2', { text: 'Flashcards' }), flashcards(mistakes([g]), u.email, { showExam: false }));
}

export async function renderProgress(main, u, room) {
  const all = await S.attempts(u);
  const fin = all.filter(a => a.status === 'finished').sort((a, b) => new Date(a.finished_at) - new Date(b.finished_at));
  main.innerHTML = '';
  main.append(el('h1', { text: 'My progress' }));
  if (!fin.length) { main.append(el('div', { class: 'card', text: 'Submit an exam to see your progress, unit breakdown, charts and mistake flashcards here.' })); return; }
  const byAct = new Map();
  for (const a of fin) { if (!byAct.has(a.activity)) byAct.set(a.activity, []); byAct.get(a.activity).push(a); }
  const groups = [];
  for (const [slug, list] of byAct) {
    const activity = room.activities.find(x => x.slug === slug) || { slug, title: list[0].title, settings: {} };
    const reports = await Promise.all(list.map(a => S.report(u, a.id)));
    const sets = {};
    for (const sid of [...new Set(reports.map(r => r.attempt.set_id))]) { try { sets[sid] = (await S.getSet(u, slug, sid)).set; } catch {} }
    const stats = list.map((a, i) => attemptStats(a, reports[i], sets[a.set]));
    groups.push({ activity, list, reports, sets, stats });
  }
  const want = decodeURIComponent((location.hash.match(/^#progress=(.+)$/) || [])[1] || '');
  const g = groups.find(x => x.activity.slug === want);
  main.append(el('nav', { class: 'tabs pg-tabs', 'aria-label': 'Exams' },
    el('a', { class: 'btn' + (g ? '' : ' on'), href: '#progress', text: 'Overview' }),
    groups.map(x => el('a', { class: 'btn' + (g === x ? ' on' : ''), href: '#progress=' + encodeURIComponent(x.activity.slug), text: x.activity.title }))));
  if (g) examPage(main, g, u);
  else overview(main, groups, u);
  typeset(main);
}
