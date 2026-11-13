import { el } from '../core.js';
import { mountGeo, viewGeo } from './geo.js';
import { mountIso, viewIso } from './iso.js';
import { mountMath, viewMath } from './math.js';
import { mountText, viewText, mountDraw, viewDraw, mountTable, viewTable, mountGraph, viewGraph } from './basic.js';

export const TOOL_LABELS = { text: 'Written answer', math: 'Math (LaTeX)', geo: 'Geometry canvas', iso: 'Isometric grid', draw: 'Drawing pad', graph: 'Graph', table: 'Table' };
const MOUNT = { text: mountText, math: mountMath, geo: mountGeo, iso: mountIso, draw: mountDraw, graph: mountGraph, table: mountTable };
const VIEW = { text: viewText, math: viewMath, geo: viewGeo, iso: viewIso, draw: viewDraw, graph: viewGraph, table: viewTable };

export const answerKey = (cardId, k, tool, i) => i === 0 ? cardId + '.' + k : cardId + '.' + k + '.' + tool;

export function mountSub(host, card, sub, ans, onChange) {
  const tools = sub.tools && sub.tools.length ? sub.tools : ['text'];
  const multi = tools.length > 1;
  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  const panes = [];
  tools.forEach((tool, i) => {
    const id = answerKey(card.id, sub.k, tool, i);
    const pane = el('div', { role: 'tabpanel' });
    const ctx = { id, get: () => ans[id], set: v => { if (v === '' || v == null) delete ans[id]; else ans[id] = v; onChange(id); } };
    (MOUNT[tool] || mountText)(pane, ctx, sub);
    panes.push(pane);
    if (multi) {
      const has = ans[id] && String(ans[id]).length > 2;
      tabs.append(el('button', { type: 'button', role: 'tab', text: (TOOL_LABELS[tool] || tool) + (has ? ' ✓' : ''), class: i === 0 ? 'on' : '', onclick: e => {
        tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget));
        panes.forEach((p, j) => { p.hidden = j !== i; });
      } }));
      if (i) pane.hidden = true;
    }
  });
  if (multi) host.append(tabs);
  host.append(...panes);
}

export function viewSub(card, sub, ans) {
  const tools = sub.tools && sub.tools.length ? sub.tools : ['text'];
  const wrap = el('div');
  tools.forEach((tool, i) => {
    const v = ans[answerKey(card.id, sub.k, tool, i)];
    if (v == null || v === '') { if (i === 0) wrap.append(el('div', { class: 'mut', text: 'No answer' })); return; }
    if (tools.length > 1) wrap.append(el('div', { class: 'mut', text: TOOL_LABELS[tool] || tool }));
    wrap.append((VIEW[tool] || viewText)(v, sub));
  });
  return wrap;
}

export function subAnswered(card, sub, ans) {
  const tools = sub.tools && sub.tools.length ? sub.tools : ['text'];
  return tools.some((tool, i) => { const v = ans[answerKey(card.id, sub.k, tool, i)]; return v != null && String(v).replace(/<[^>]*>/g, '').trim().length > 0 && v !== '[]'; });
}
