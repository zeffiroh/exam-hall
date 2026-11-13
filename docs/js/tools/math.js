import { el, esc, typeset } from '../core.js';

const GROUPS = [
  ['Structure', [['$▢$', 'Inline math'], ['$$▢$$', 'Display math'], ['\\frac{▢}{}', 'a/b'], ['^{▢}', 'xⁿ'], ['_{▢}', 'xₙ'], ['\\sqrt{▢}', '√'], ['\\sqrt[▢]{}', 'ⁿ√'], ['\\left(▢\\right)', '( )'], ['\\lfloor ▢ \\rfloor', '⌊ ⌋'], ['\\lceil ▢ \\rceil', '⌈ ⌉'], ['|▢|', '| |'], ['\\binom{▢}{}', 'C(n,k)'], ['\\overline{▢}', 'AB̅']]],
  ['Big operators', [['\\sum_{i=1}^{n} ▢', 'Σ'], ['\\prod_{i=1}^{n} ▢', 'Π'], ['\\max', 'max'], ['\\min', 'min'], ['\\gcd(▢)', 'gcd'], ['\\operatorname{lcm}(▢)', 'lcm']]],
  ['Relations', [['\\le ', '≤'], ['\\ge ', '≥'], ['\\ne ', '≠'], ['\\equiv ', '≡'], ['\\pmod{▢}', 'mod'], ['\\mid ', '∣'], ['\\nmid ', '∤'], ['\\approx ', '≈'], ['\\cdot ', '·'], ['\\times ', '×'], ['\\pm ', '±']]],
  ['Logic & sets', [['\\implies ', '⇒'], ['\\iff ', '⇔'], ['\\forall ', '∀'], ['\\exists ', '∃'], ['\\in ', '∈'], ['\\notin ', '∉'], ['\\subseteq ', '⊆'], ['\\cup ', '∪'], ['\\cap ', '∩'], ['\\emptyset', '∅'], ['\\mathbb{Z}', 'ℤ'], ['\\mathbb{N}', 'ℕ'], ['\\mathbb{R}', 'ℝ'], ['\\mathbb{Q}', 'ℚ']]],
  ['Geometry', [['\\angle ', '∠'], ['\\triangle ', '△'], ['^\\circ', '°'], ['\\parallel ', '∥'], ['\\perp ', '⊥'], ['\\sim ', '∼'], ['\\cong ', '≅'], ['\\overrightarrow{▢}', 'vec']]],
  ['Greek', [['\\alpha ', 'α'], ['\\beta ', 'β'], ['\\gamma ', 'γ'], ['\\delta ', 'δ'], ['\\theta ', 'θ'], ['\\lambda ', 'λ'], ['\\mu ', 'μ'], ['\\pi ', 'π'], ['\\sigma ', 'σ'], ['\\phi ', 'φ'], ['\\omega ', 'ω'], ['\\Delta ', 'Δ'], ['\\Omega ', 'Ω']]],
  ['Layout', [['\\begin{aligned} ▢ &= \\\\ &= \\end{aligned}', 'Aligned'], ['\\begin{cases} ▢ & \\text{if } \\\\ & \\text{otherwise} \\end{cases}', 'Cases'], ['\\text{▢}', 'Text'], ['\\quad ', 'Space'], ['\\square', '∎']]]
];

export function renderMathText(text) {
  const blocks = String(text || '').split(/\n{2,}/);
  return blocks.map(b => '<p>' + esc(b).replace(/\n/g, '<br>') + '</p>').join('');
}

export function mountMath(host, ctx) {
  const ta = el('textarea', { class: 'mathbox', spellcheck: 'false', placeholder: 'Write your solution. Put mathematics between dollar signs, e.g. $a^2+b^2 \\ge 2ab$. Blank line = new paragraph.' });
  ta.value = ctx.get() || '';
  const prev = el('div', { class: 'mprev', 'aria-live': 'polite' });
  const group = el('select', { 'aria-label': 'Symbol group' }, GROUPS.map((g, i) => el('option', { value: i, text: g[0] })));
  const pal = el('div', { class: 'pal' });
  const showGroup = () => {
    pal.innerHTML = '';
    for (const [snip, label] of GROUPS[+group.value][1]) pal.append(el('button', { type: 'button', text: label, 'aria-label': label, title: snip.replace('▢', ''), onclick: () => insert(snip) }));
  };
  group.onchange = showGroup;
  let timer;
  const update = () => {
    ctx.set(ta.value);
    clearTimeout(timer);
    timer = setTimeout(async () => { prev.innerHTML = ta.value.trim() ? renderMathText(ta.value) : ''; await typeset(prev); }, 250);
  };
  function insert(snip) {
    const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
    const inMath = (ta.value.slice(0, s).match(/(?<!\\)\$/g) || []).length % 2 === 1;
    let t = snip;
    if (!inMath && !snip.startsWith('$')) t = '$' + snip + '$';
    const at = t.indexOf('▢');
    t = t.replace('▢', sel);
    ta.setRangeText(t, s, e, 'end');
    if (at >= 0) { const c = s + at + sel.length; ta.setSelectionRange(c, c); }
    ta.focus(); update();
  }
  ta.addEventListener('input', update);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); update(); }
  });
  host.append(el('div', { class: 'tools' }, el('span', { class: 'mut', text: 'Insert' }), group), pal, ta,
    el('div', { class: 'hint', text: 'Live preview' }), prev);
  showGroup();
  if (ta.value) update();
}

export function viewMath(text) {
  const d = el('div', { class: 'ans', html: renderMathText(text) });
  typeset(d);
  return d;
}
