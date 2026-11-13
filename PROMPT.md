# Make a new exam set

1. Copy the prompt below into Claude (or another AI).
2. Fill in the four lines under **YOUR EXAM**.
3. Save the reply as a `.json` file in the `drop/` folder, for example `drop/ap-chem-set-1.json`.
4. Run `python publish.py`. It files the set under `content/`, checks it, and puts it live.

For a second or third version of the same exam, keep the same `slug`, change the set `id`, and say *"Write Set 2. Use different questions from Set 1."*

---

## The prompt

````text
You are writing a full-length practice exam for the Exam Hall platform. Reply with ONE JSON object and nothing else: no prose and no Markdown fences.

YOUR EXAM
- Exam: <e.g. AP Chemistry>
- Slug: <e.g. ap-chem>            (lowercase letters, digits, dashes; same slug for every set of this exam)
- Set: <e.g. 1>
- Scope: <e.g. Units 1–9 of the 2025 AP Chemistry CED, real exam length and difficulty>

QUALITY BAR
- Match the real exam's structure, timing, question count and difficulty mix (about 25% Easy, 50% Medium, 25% Hard).
- Every question must be original, unambiguous and have exactly one defensible answer. Check every calculation twice.
- Prefer questions built on a stimulus (data table, graph, passage, diagram, experiment) like the real exam.
- Wrong options must be plausible and based on real misconceptions.
- Spread questions across every unit in the scope, weighted like the real exam.

OUTPUT SHAPE
{
  "exam": {
    "slug": "ap-chem",
    "title": "AP Chemistry",
    "subtitle": "Full practice exam · 60 MCQ + 7 FRQ",
    "subject": "Chemistry",
    "icon": "⚗️",
    "assign": "random",
    "settings": {
      "sections": [
        { "id": "s1", "title": "Section I · Multiple choice", "minutes": 90 },
        { "id": "s2", "title": "Section II · Free response", "minutes": 105 }
      ],
      "tools": { "calc": "both", "notes": true, "highlight": true },
      "proctor": true,
      "lockSections": true,
      "intro": "<p>HTML instructions shown before the exam starts: sections, timing, allowed tools, how marks work.</p>"
    }
  },
  "set": { "id": "1", "label": "Set 1" },
  "cards": [ ...questions... ]
}

settings.tools.calc is "both" (scientific + graphing), "sci", or false (no calculator).
Use one section per timed part of the real exam. lockSections true = no going back to an earlier section.

QUESTION TYPES (each item in "cards")

Multiple choice:
{
  "id": "A1", "sec": "s1", "type": "mcq", "title": "Question 1",
  "stim": "<p>Optional shared source material (left pane).</p><div data-fig=\"0\"></div>",
  "figs": [ FIGURE, ... ],
  "stem": "<p>The question.</p>",
  "opts": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "key": {
    "kind": "mcq", "ans": "C",
    "rationale": "<p>Why C is right, step by step.</p>",
    "dx": ["Why A is wrong", "Why B is wrong", "Correct.", "Why D is wrong"],
    "unit": "Unit 3 · Intermolecular forces",
    "sp": "Skill 5.A · Calculate",
    "lvl": "Medium",
    "max": 1
  }
}

Numeric answer: "type": "num", no "opts", key { "kind": "num", "ans": "42.5", "tol": 0.1, "rationale", "unit", "sp", "lvl", "max" }.
Short text answer: "type": "short", key { "kind": "short", "ans": "mitochondria|mitochondrion", ... } (| separates accepted answers; matching ignores case).

Free response (marked by the teacher with a rubric):
{
  "id": "F1", "sec": "s2", "type": "free", "title": "Free response 1",
  "stim": "<p>Scenario and data.</p>", "figs": [],
  "stem": "<p>Overall question.</p>",
  "subs": [
    {
      "k": "a", "html": "(a) Describe ...", "pts": 2, "tools": ["text"],
      "key": {
        "kind": "manual", "max": 2,
        "unit": "Unit 4 · Reaction types", "sp": "Skill 2.B", "lvl": "Medium",
        "rationale": "<p>Model answer.</p>",
        "rubric": [ { "pts": 1, "desc": "Identifies ..." }, { "pts": 1, "desc": "Explains ..." } ]
      }
    }
  ]
}
Answer tools for subs: "text", "math" (LaTeX), "graph" (plot points), "table" (needs "table": {"rows": ["Trial 1","Trial 2"], "cols": ["Mass (g)","Time (s)"]}), "draw", "geo" (geometry construction), "iso" (isometric grid). Use the tool a student would really need.

FIGURES (in "figs"; place one with <div data-fig="N"></div> in stim, otherwise it is added at the end)
- Table:  { "t": "table", "head": ["", "Trial 1"], "rows": [["pH", "7.2"]], "cap": "Table 1. ..." }
- Chart:  { "t": "chart", "cfg": { Chart.js 4 config, type line/bar/scatter, labelled axes with units }, "cap": "..." }
- SVG:    { "t": "svg", "svg": "<svg viewBox=...>...</svg>", "cap": "..." } use currentColor for lines and text
- Geometry diagram: { "t": "geo", "pts": {"A":[0,4],"B":[-3,0],"C":[3,0]}, "items": [["poly","A","B","C"],["angle","B","A","C","θ"]], "cap": "..." }

RULES
- Math and chemistry: LaTeX between $...$ (inline) or $$...$$ (display). Escape backslashes for JSON ("\\frac").
- "unit" always starts with the unit name, then " · " and the subtopic. Use the same unit names in every set; the progress charts group by them.
- "lvl" is exactly Easy, Medium or Hard.
- ids are unique: A1…A60 for multiple choice, F1…F7 for free response.
- Option text starts with its letter: "A. ...".
- The whole reply must be valid JSON and complete on its own.
- "set": { "id": "1", "label": "Set 1", "merge": true } adds these cards to an existing set instead of replacing it (use it for the second half of a long exam).
````

---

## Exams worth adding

| Exam | Slug | Calculator | Sections |
|---|---|---|---|
| AP Chemistry | `ap-chem` | both | 60 MCQ / 90 min · 7 FRQ / 105 min |
| AP Physics 1 | `ap-physics-1` | both | 40 MCQ / 80 min · 4 FRQ / 100 min |
| AP Calculus AB | `ap-calc-ab` | both | 45 MCQ / 105 min · 6 FRQ / 90 min |
| AP Statistics | `ap-stats` | both | 40 MCQ / 90 min · 6 FRQ / 90 min |
| AP Psychology | `ap-psych` | false | 75 MCQ / 90 min · 2 FRQ / 70 min |
| AP US History | `apush` | false | 55 MCQ / 55 min · SAQ + DBQ + LEQ |
| AP Environmental Science | `apes` | sci | 80 MCQ / 90 min · 3 FRQ / 70 min |
| SAT Math | `sat-math` | both | 2 modules × 22 questions / 35 min |
| ACT Science | `act-science` | false | 40 questions / 35 min |
| MCAT Bio/Biochem | `mcat-bb` | false | 59 questions / 95 min |
| IB Biology HL Paper 1 | `ib-bio-hl` | false | 40 MCQ / 60 min |
| AMC 10 | `amc-10` | false | 25 questions / 75 min (use mcq, 5 options) |
| GRE Quant | `gre-quant` | sci | 2 sections × 12 questions |
| USABO Open | `usabo-open` | false | 50 MCQ / 50 min |

Long exams are easier in two halves. Ask for Section I first and save it to `drop/`. Then say *"Now write Section II for the same set, with \"merge\": true in \"set\""* and save that reply to `drop/` too. `publish.py` joins the two halves into one set.
