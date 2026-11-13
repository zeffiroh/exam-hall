#!/usr/bin/env python3
"""Exam Hall publisher.

  python publish.py              file new drops, check everything, upload what changed
  python publish.py --check      check only, change nothing
  python publish.py --offline    file drops and rebuild the catalog, skip the database
  python publish.py --all        upload every set, even unchanged ones
  python publish.py --room CODE  publish into another room (slug or room code)
  python publish.py --mint 25    add 25 sellable access codes to the room
  python publish.py --codes      list access codes and who claimed them
  python publish.py --revoke CODE
"""
import argparse
import hashlib
import json
import re
import secrets
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "content"
DROP = ROOT / "drop"
DONE = DROP / "done"
CATALOG = ROOT / "docs" / "catalog.json"
STATE = ROOT / ".publish-state.json"
TYPES = {"mcq", "num", "short", "free"}
TOOLS = {"text", "math", "geo", "iso", "draw", "graph", "table"}
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,48}$")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

OK, WARN, BAD = "\033[32m✓\033[0m", "\033[33m!\033[0m", "\033[31m✗\033[0m"


def say(mark, msg):
    print(f" {mark} {msg}")


def read_json(p):
    with open(p, encoding="utf-8-sig") as f:
        return json.load(f)


def write_json(p, data):
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")


def load_env():
    env = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# ---------------------------------------------------------------- database

class DB:
    def __init__(self, password):
        cfg = (ROOT / "docs" / "js" / "config.js").read_text(encoding="utf-8")
        m = re.search(r'studentConn:\s*"([^"]+)"', cfg)
        if not m:
            raise SystemExit("Could not find studentConn in docs/js/config.js")
        u = urllib.parse.urlparse(m.group(1))
        self.host = u.hostname
        self.conn = f"postgresql://exam_teacher:{urllib.parse.quote(password, safe='')}@{u.netloc.split('@')[-1]}{u.path}?sslmode=require"

    def q(self, sql, *params):
        body = json.dumps({"query": sql, "params": [p if p is None or isinstance(p, str) else json.dumps(p) if isinstance(p, (dict, list)) else str(p) for p in params]}).encode()
        req = urllib.request.Request(f"https://{self.host}/sql", data=body, headers={"Neon-Connection-String": self.conn, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)["rows"]
        except urllib.error.HTTPError as e:
            try:
                msg = json.load(e)["message"]
            except Exception:
                msg = str(e)
            if "password" in msg.lower():
                msg = "Wrong TEACHER_PASSWORD in .env"
            raise RuntimeError(msg) from None


def room_of(db, ref):
    rows = db.q("select slug, title, code from exam.rooms where slug=$1 or lower(code)=lower($1) limit 1", ref)
    if not rows:
        raise SystemExit(f"No room matches '{ref}'. Create it in the dashboard first.")
    return rows[0]


# ---------------------------------------------------------------- drops

def file_drops():
    if not DROP.exists():
        DROP.mkdir()
        return []
    filed = []
    for p in sorted(DROP.glob("*.json")):
        try:
            d = read_json(p)
        except Exception as e:
            say(BAD, f"drop/{p.name}: not valid JSON ({e})")
            continue
        exam = d.get("exam") or {}
        slug = str(exam.get("slug", "")).strip().lower()
        if not SLUG.match(slug):
            say(BAD, f"drop/{p.name}: exam.slug must be lowercase letters, digits and dashes")
            continue
        if not isinstance(d.get("cards"), list):
            say(BAD, f"drop/{p.name}: missing \"cards\" array")
            continue
        folder = CONTENT / slug
        manifest = folder / "exam.json"
        if not manifest.exists():
            meta = {k: exam[k] for k in ("slug", "title", "subtitle", "subject", "icon", "assign") if k in exam}
            meta.setdefault("title", slug.replace("-", " ").title())
            meta.setdefault("assign", "random")
            meta["settings"] = exam.get("settings") or {}
            write_json(manifest, meta)
            say(OK, f"new exam '{meta['title']}' → content/{slug}/")
        st = d.get("set") or {}
        sid = re.sub(r"[^A-Za-z0-9-]", "", str(st.get("id", ""))) or str(len(list(folder.glob("set-*.json"))) + 1)
        target = folder / f"set-{sid}.json"
        cards = d["cards"]
        verb = "replaced" if target.exists() else "added"
        if st.get("merge") and target.exists():
            ids = {c.get("id") for c in cards}
            cards = [c for c in read_json(target).get("cards", []) if c.get("id") not in ids] + cards
            verb = "merged into"
        out = {"label": st.get("label") or f"Set {sid}", "cards": cards}
        write_json(target, out)
        DONE.mkdir(parents=True, exist_ok=True)
        shutil.move(str(p), str(DONE / p.name))
        say(OK, f"{verb} content/{slug}/set-{sid}.json ({len(cards)} questions)")
        filed.append(target)
    return filed


# ---------------------------------------------------------------- checks

def check_set(cards, settings, where):
    errs, warns = [], []
    if not isinstance(cards, list) or not cards:
        return ["no questions in \"cards\""], warns
    secs = {s.get("id") for s in settings.get("sections", [])}
    ids = set()
    for i, c in enumerate(cards):
        cid = c.get("id") or f"#{i + 1}"
        tag = f"{where} {cid}"
        if not c.get("id"):
            errs.append(f"{tag}: needs an \"id\"")
        elif c["id"] in ids:
            errs.append(f"{tag}: duplicate id")
        ids.add(c.get("id"))
        t = c.get("type")
        if t not in TYPES:
            errs.append(f"{tag}: type must be one of {', '.join(sorted(TYPES))}")
            continue
        if secs and c.get("sec") not in secs:
            errs.append(f"{tag}: section \"{c.get('sec')}\" is not in exam.json settings.sections")
        if not (c.get("stem") or c.get("stim")):
            errs.append(f"{tag}: has no question text (stem)")
        k = c.get("key")
        if t == "mcq":
            opts = c.get("opts") or []
            if len(opts) < 2:
                errs.append(f"{tag}: multiple choice needs at least 2 opts")
            if not k or not re.fullmatch(r"[A-Z]", str(k.get("ans", ""))):
                errs.append(f"{tag}: key.ans must be a letter like \"B\"")
            elif ord(k["ans"]) - 65 >= len(opts):
                errs.append(f"{tag}: key.ans {k['ans']} is past the last option")
            if k and k.get("dx") and len(k["dx"]) != len(opts):
                warns.append(f"{tag}: key.dx should have one entry per option")
        elif t == "num":
            try:
                float(str((k or {}).get("ans", "")))
            except ValueError:
                errs.append(f"{tag}: numeric key.ans must be a number")
        elif t == "short":
            if not (k or {}).get("ans"):
                errs.append(f"{tag}: short answer needs key.ans (use | between accepted answers)")
        elif t == "free":
            subs = c.get("subs") or []
            if not subs:
                errs.append(f"{tag}: free response needs at least one sub-part in \"subs\"")
            for s in subs:
                if not s.get("k"):
                    errs.append(f"{tag}: every sub-part needs \"k\"")
                bad = set(s.get("tools") or ["text"]) - TOOLS
                if bad:
                    errs.append(f"{tag}.{s.get('k')}: unknown tools {sorted(bad)}")
                if "table" in (s.get("tools") or []) and not s.get("table"):
                    errs.append(f"{tag}.{s.get('k')}: table tool needs a \"table\" with rows and cols")
                sk = s.get("key")
                if not sk:
                    warns.append(f"{tag}.{s.get('k')}: no marking key")
        if t != "free" and k and not k.get("unit"):
            warns.append(f"{tag}: key.unit missing (progress charts group by unit)")
    return errs, warns


def load_library():
    exams = []
    for folder in sorted(p for p in CONTENT.iterdir() if p.is_dir()):
        manifest = folder / "exam.json"
        if not manifest.exists():
            say(WARN, f"content/{folder.name}/ has no exam.json, skipped")
            continue
        meta = read_json(manifest)
        meta.setdefault("slug", folder.name)
        sets = []
        for p in sorted(folder.glob("set-*.json"), key=lambda p: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", p.stem)]):
            body = read_json(p)
            sid = p.stem[4:]
            sets.append({"id": sid, "label": body.get("label") or f"Set {sid}", "cards": body.get("cards"), "path": p})
        exams.append({"meta": meta, "sets": sets, "folder": folder})
    return exams


def digest(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


# ---------------------------------------------------------------- catalog

def build_catalog(exams):
    out = []
    for e in exams:
        m, st = e["meta"], e["meta"].get("settings", {})
        cards = [c for s in e["sets"] for c in (s["cards"] or [])]
        types = {}
        units = {}
        for c in cards:
            types[c.get("type")] = types.get(c.get("type"), 0) + 1
            keys = [c.get("key")] + [s.get("key") for s in c.get("subs") or []]
            for k in keys:
                u = ((k or {}).get("unit") or "").split("·")[0].strip()
                if u and len(u) <= 32 and c.get("type") != "free":
                    units[u] = units.get(u, 0) + 1
        out.append({
            "slug": m["slug"], "title": m.get("title", m["slug"]), "subtitle": m.get("subtitle", ""),
            "subject": m.get("subject", ""), "icon": m.get("icon", "📝"),
            "sets": len(e["sets"]), "questions": len(cards),
            "perSet": round(len(cards) / max(1, len(e["sets"]))),
            "minutes": sum(s.get("minutes", 0) for s in st.get("sections", [])),
            "types": types, "units": [u for u, _ in sorted(units.items(), key=lambda x: -x[1])[:8]],
        })
    write_json(CATALOG, {"exams": out, "totals": {"exams": len(out), "sets": sum(x["sets"] for x in out), "questions": sum(x["questions"] for x in out)}})
    say(OK, f"docs/catalog.json · {len(out)} exams · {sum(x['questions'] for x in out)} questions")


# ---------------------------------------------------------------- codes

def gen_code():
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3))


def mint(db, room, n):
    codes = [gen_code() for _ in range(n)]
    db.q("insert into exam.access_codes(code, room) select unnest($1::text[]), $2 on conflict do nothing", "{" + ",".join(codes) + "}", room["slug"])
    left = db.q("select count(*)::int n from exam.access_codes where room=$1 and session is null and not revoked", room["slug"])[0]["n"]
    say(OK, f"added {n} codes to '{room['title']}' · {left} unclaimed")


def list_codes(db, room):
    rows = db.q("select code, session, email, claimed_at, revoked from exam.access_codes where room=$1 order by claimed_at nulls last, created_at", room["slug"])
    if not rows:
        print("   No codes yet. Run: python publish.py --mint 25")
        return
    claimed = [r for r in rows if r["session"]]
    print(f"   {len(rows)} codes · {len(claimed)} claimed · {sum(r['revoked'] for r in rows)} revoked\n")
    for r in rows:
        state = "revoked" if r["revoked"] else "claimed " + str(r["claimed_at"])[:16] if r["session"] else "unclaimed"
        print(f"   {r['code']}  {state:28} {r['email'] or '':28} {r['session'] or ''}")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Publish exams in content/ to Exam Hall.")
    ap.add_argument("--check", action="store_true", help="check only, change nothing")
    ap.add_argument("--offline", action="store_true", help="skip the database")
    ap.add_argument("--all", action="store_true", help="upload every set, even unchanged ones")
    ap.add_argument("--room", help="room slug or code (default: PUBLISH_ROOM in .env, else 'main')")
    ap.add_argument("--mint", type=int, metavar="N", help="add N access codes for sale")
    ap.add_argument("--codes", action="store_true", help="list access codes")
    ap.add_argument("--revoke", metavar="CODE", help="revoke an access code")
    a = ap.parse_args()
    env = load_env()

    if a.mint or a.codes or a.revoke:
        db = DB(env.get("TEACHER_PASSWORD") or sys.exit("Set TEACHER_PASSWORD in .env"))
        room = room_of(db, a.room or env.get("PUBLISH_ROOM") or "main")
        if a.mint:
            mint(db, room, a.mint)
        if a.revoke:
            n = db.q("update exam.access_codes set revoked=true where upper(code)=upper($1) returning code", a.revoke)
            say(OK if n else BAD, f"revoked {a.revoke}" if n else f"no code {a.revoke}")
        if a.codes:
            list_codes(db, room)
        return

    print("\nExam Hall · publish\n")
    if not a.check:
        file_drops()
    elif DROP.exists() and list(DROP.glob("*.json")):
        say(WARN, f"{len(list(DROP.glob('*.json')))} file(s) waiting in drop/ (run without --check to file them)")

    exams = load_library()
    failed = False
    for e in exams:
        m = e["meta"]
        st = m.get("settings", {})
        if not SLUG.match(m["slug"]):
            say(BAD, f"{e['folder'].name}: bad slug '{m['slug']}'")
            failed = True
        if not st.get("sections"):
            say(BAD, f"{m['slug']}: settings.sections is empty")
            failed = True
        for s in e["sets"]:
            errs, warns = check_set(s["cards"], st, f"{m['slug']}/set-{s['id']}")
            for w in warns[:5]:
                say(WARN, w)
            if len(warns) > 5:
                say(WARN, f"{m['slug']}/set-{s['id']}: …and {len(warns) - 5} more notes")
            for x in errs:
                say(BAD, x)
            s["ok"] = not errs
            failed |= bool(errs)
        good = sum(s["ok"] for s in e["sets"])
        say(OK if good == len(e["sets"]) else WARN, f"{m.get('title', m['slug'])}: {good}/{len(e['sets'])} sets ready")

    if a.check:
        print("\n Check finished." + (" Fix the ✗ lines above." if failed else " Everything is ready to publish."))
        sys.exit(1 if failed else 0)

    build_catalog(exams)
    if a.offline:
        print("\n Done (offline). Run without --offline to upload.\n")
        return

    pw = env.get("TEACHER_PASSWORD")
    if not pw:
        sys.exit("\n Set TEACHER_PASSWORD in .env to upload (or use --offline).")
    db = DB(pw)
    room = room_of(db, a.room or env.get("PUBLISH_ROOM") or "main")
    print(f"\n Uploading to room '{room['title']}' (code {room['code']})\n")
    state = read_json(STATE) if STATE.exists() else {}
    pushed = 0
    for e in exams:
        m = e["meta"]
        settings = m.get("settings", {})
        db.q("""insert into exam.activities(slug, room, kind, title, subtitle, settings, assign, position)
                values($1, $2, 'exam', $3, $4, $5::jsonb, $6, (select coalesce(max(position), 0) + 1 from exam.activities where room=$2))
                on conflict(slug) do update set title=excluded.title, subtitle=excluded.subtitle, settings=excluded.settings, assign=excluded.assign""",
             m["slug"], room["slug"], m.get("title", m["slug"]), m.get("subtitle"), settings, m.get("assign", "random"))
        for s in e["sets"]:
            if not s["ok"]:
                say(BAD, f"{m['slug']} {s['label']}: skipped (fix errors first)")
                continue
            key = f"{room['slug']}/{m['slug']}/{s['id']}"
            h = digest({"label": s["label"], "cards": s["cards"]})
            if state.get(key) == h and not a.all:
                continue
            r = db.q("select exam.import_set($1, $2, $3, $4::jsonb) r", m["slug"], s["id"], s["label"], {"cards": s["cards"]})[0]["r"]
            state[key] = h
            pushed += 1
            say(OK, f"{m.get('title')} · {s['label']}: {r['cards']} questions, {r['keys']} answer keys")
    write_json(STATE, state)
    print(f"\n Done. {pushed} set(s) uploaded" + ("" if pushed else " (nothing changed)") + f". Students join with code {room['code']}.\n")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        sys.exit(f"\n {BAD} {e}\n")
