# Exam Hall formats

## Concepts
- **Room**: created by a teacher, joined by students with a room code.
- **Activity**: anything dropped into a room. `kind` selects a module in `docs/js/activities/<kind>.js`. Built-in kinds: `exam`, `movie`, `dj`.
- **Set**: an exam activity can hold many question sets (Set 1, Set 2, ...). A student gets one (random or rotated).

## Activity module interface (`docs/js/activities/<kind>.js`)
```js
export default {
  kind: 'movie', label: 'Movie night', blurb: 'Watch a video together in sync',
  defaults() { return {...settings} },
  editor(host, settings, onChange) {},
  join(host, ctx) {},
  host(host, ctx) {}
}
```
`ctx = { user, activity: {slug, kind, title, subtitle, settings}, room, S, teacherSql, isHost }`.
Live state is stored in `exam.live`; participant messages in `exam.live_events` (`S.livePost`, `S.liveEvents`).

## Question-set JSON (imported with `exam.import_set(activity, set_id, label, body)`)
```json
{ "cards": [ Card, ... ] }
```
Card:
- `id` string, unique in set (e.g. "A1", "P1").
- `sec` section id from the activity settings (e.g. "s1").
- `type`: `mcq` | `num` | `short` | `free`.
- `title` short label shown in navigation and heading.
- `stim` HTML shown in the left pane (may be empty). LaTeX allowed: `$...$`, `$$...$$`, `\(...\)`, `\[...\]`.
- `figs` array of Figure. A figure is placed where the stim contains `<div data-fig="N"></div>` (N = index); otherwise appended after the stim.
- `stem` HTML question text in the right pane.
- `opts` array of option strings (mcq; shown with a radio button each, include the "A. " prefix in the text).
- `subs` array of Sub (free). A free card always has at least one sub.
- `key` (stripped from the student copy on import):
  - mcq `{ "kind":"mcq", "ans":"B", "rationale":"...", "dx":["why A wrong", ...], "unit":"...", "sp":"...", "lvl":"Medium", "max":1 }`
  - num `{ "kind":"num", "ans":"42", "tol":0, "rationale":"..." }`
  - short `{ "kind":"short", "ans":"accepted|also accepted", "rationale":"..." }`

Sub: `{ "k":"a", "html":"(a) ...", "pts":3, "tools":["math"], "table":{"rows":[],"cols":[]}, "key":{ "kind":"manual", "max":3, "rationale":"model solution (HTML + LaTeX)", "rubric":[{"pts":1,"desc":"..."}] } }`
Answer tools: `text` (rich text), `math` (prose with LaTeX, live preview, symbol palette), `geo` (geometry construction canvas), `iso` (isometric dot grid with cube stacking), `draw` (freehand), `graph` (plot points on axes), `table` (fill-in table; needs `table`).
Answer storage keys in attempt state `ans`: mcq/num/short → `ans[card.id]`; sub first tool → `ans[card.id + '.' + k]`; extra tools → `ans[card.id + '.' + k + '.' + tool]`. Grade/qkey id of a sub = `card.id + '.' + k`.

Figure:
- `{ "t":"svg", "svg":"<svg ...>", "cap":"..." }` inline SVG; use `currentColor` for ink so dark mode works.
- `{ "t":"geo", "w":360, "h":280, "pts":{"A":[0,4],"B":[-3,0]}, "items":[...], "labels":{"A":"n"}, "cap":"..." }` geometry diagram, math coordinates (y up), auto-fit. Items:
  `["seg",P,Q]` `["dashed",P,Q]` `["line",P,Q]` `["ray",P,Q]` `["poly",P,Q,R,...]` `["circle",O,P]` `["circleR",O,r]` `["circum",A,B,C]` `["incircle",A,B,C]` `["angle",A,B,C,"label"]` `["right",A,B,C]` `["tick",P,Q,n]` `["dot",P]` `["text",x,y,"label"]`. Point labels default to outward placement; override with `labels` (n,s,e,w,ne,nw,se,sw, or "none").
- `{ "t":"iso", "cubes":[[x,y,z],...], "lines":[[a1,b1,a2,b2],...], "dots":true, "cap":"..." }` isometric figure (x right-down, y left-down, z up; lines in lattice coordinates).
- `{ "t":"table", "head":["", "WT"], "rows":[["O2", "12"]], "cap":"..." }`
- `{ "t":"chart", "cfg":{ Chart.js 4 config; datasets may carry "err":[...] for symmetric error bars } }`
- `{ "t":"img", "src":"https://... or data:", "alt":"...", "cap":"..." }`
- `{ "t":"html", "html":"..." }`
- `{ "t":"mod", "id":"A12", "data":{...} }` rendered by the activity's pack (`settings.pack` → `docs/packs/<pack>.js`, default export `{ mount(host, fig, card) }`).

## Exam activity settings
```json
{ "sections":[{"id":"s1","title":"Section I · Multiple choice","minutes":90}],
  "tools":{"calc":"both"|"sci"|false,"notes":true,"highlight":true},
  "proctor":true, "lockSections":true, "pack":"apbio", "intro":"HTML shown before starting" }
```
