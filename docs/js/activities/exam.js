import { el } from '../core.js';

const field = (label, input) => el('label', { class: 'field' }, label, input);

export default {
  kind: 'exam',
  label: 'Exam',
  defaults() {
    return { sections: [{ id: 's1', title: 'Questions', minutes: 60 }], tools: { calc: false, notes: true, highlight: true }, proctor: true, lockSections: true, intro: '' };
  },
  editor(host, s, onChange) {
    s.sections = s.sections || []; s.tools = s.tools || {};
    const secBox = el('div');
    const drawSecs = () => {
      secBox.innerHTML = '';
      s.sections.forEach((x, i) => secBox.append(el('div', { class: 'row', style: 'margin:4px 0' },
        el('input', { value: x.id, style: 'width:70px', 'aria-label': 'Section id', oninput: e => { x.id = e.target.value.trim(); onChange(); } }),
        el('input', { value: x.title, style: 'flex:1;min-width:180px', 'aria-label': 'Section title', oninput: e => { x.title = e.target.value; onChange(); } }),
        el('input', { type: 'number', min: 1, value: x.minutes, style: 'width:80px', 'aria-label': 'Minutes', oninput: e => { x.minutes = +e.target.value || 1; onChange(); } }),
        el('span', { class: 'mut', text: 'min' }),
        el('button', { type: 'button', text: 'Remove', disabled: s.sections.length < 2, onclick: () => { s.sections.splice(i, 1); drawSecs(); onChange(); } }))));
    };
    drawSecs();
    const check = (label, get, set) => el('label', { class: 'row', style: 'gap:6px' }, el('input', { type: 'checkbox', checked: !!get(), onchange: e => { set(e.target.checked); onChange(); } }), label);
    host.append(
      el('h4', { text: 'Sections (id · title · minutes)' }), secBox,
      el('button', { type: 'button', text: 'Add section', onclick: () => { s.sections.push({ id: 's' + (s.sections.length + 1), title: 'Section ' + (s.sections.length + 1), minutes: 45 }); drawSecs(); onChange(); } }),
      el('h4', { text: 'Rules and tools' }),
      field('Calculator', el('select', { onchange: e => { s.tools.calc = e.target.value === 'none' ? false : e.target.value; onChange(); } },
        ['none', 'sci', 'both'].map(v => el('option', { value: v, text: { none: 'Not allowed', sci: 'Scientific', both: 'Scientific and graphing' }[v], selected: (s.tools.calc || 'none') === v })))),
      check('Notes pad', () => s.tools.notes !== false, v => { s.tools.notes = v; }),
      check('Highlighter', () => s.tools.highlight !== false, v => { s.tools.highlight = v; }),
      check('Full-screen proctoring (logs tab switches, blocks copy)', () => s.proctor, v => { s.proctor = v; }),
      check('Lock sections once finished', () => s.lockSections !== false, v => { s.lockSections = v; }),
      field('Instructions shown before starting (HTML, LaTeX allowed)', el('textarea', { rows: 4, oninput: e => { s.intro = e.target.value; onChange(); }, text: s.intro || '' })),
      field('Figure pack (optional, e.g. apbio)', el('input', { value: s.pack || '', oninput: e => { s.pack = e.target.value.trim() || undefined; onChange(); } })));
  }
};
