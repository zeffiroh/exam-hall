#!/usr/bin/env python3
"""Email teacher access codes to new Razorpay buyers.

Runs on a schedule in GitHub Actions (.github/workflows/mail-codes.yml), or by hand:
  python mail_codes.py            claim and email codes for recent captured payments
  python mail_codes.py --dry-run  show what would be sent

Environment (GitHub secrets, or .env when run locally):
  TEACHER_PASSWORD, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
  SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, SMTP_PASS, MAIL_FROM, SITE_URL,
  LOOKBACK_HOURS (optional, default 72)
"""
import argparse
import base64
import json
import os
import smtplib
import ssl
import sys
import time
import urllib.request
from email.message import EmailMessage

from publish import DB, load_env


def env(name, default=None):
    v = os.environ.get(name) or ENV.get(name) or default
    if v is None:
        sys.exit(f"Missing {name}")
    return v


def payments(key, secret, since):
    auth = base64.b64encode(f"{key}:{secret}".encode()).decode()
    out, skip = [], 0
    while True:
        req = urllib.request.Request(f"https://api.razorpay.com/v1/payments?from={since}&count=100&skip={skip}", headers={"Authorization": "Basic " + auth})
        with urllib.request.urlopen(req, timeout=60) as r:
            items = json.load(r).get("items", [])
        out += items
        if len(items) < 100:
            return out
        skip += 100


def send(smtp, msg):
    host, port = env("SMTP_HOST"), int(env("SMTP_PORT", "465"))
    if smtp is None:
        smtp = smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=60) if port == 465 else smtplib.SMTP(host, port, timeout=60)
        if port != 465:
            smtp.starttls(context=ssl.create_default_context())
        smtp.login(env("SMTP_USER"), env("SMTP_PASS"))
    smtp.send_message(msg)
    return smtp


def letter(to, code, pay_id):
    site = env("SITE_URL").rstrip("/")
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = env("MAIL_FROM"), to, "Your Exam Hall teacher access code"
    m.set_content(f"""Thank you for your support.

Your teacher access code: {code}

Sign in on the Teacher tab at {site}/index.html?teacher, create a room, add exams from the library and give your students the room code. Students join free.

Keep this code private: it is your teacher login. If you lose it, enter your payment ID ({pay_id}) at {site}/unlock.html to see it again.
""")
    return m


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    db = DB(env("TEACHER_PASSWORD"))
    since = int(time.time()) - int(env("LOOKBACK_HOURS", "72")) * 3600
    paid = [p for p in payments(env("RAZORPAY_KEY_ID"), env("RAZORPAY_KEY_SECRET"), since) if p.get("status") == "captured" and p.get("email")]
    smtp, sent = None, 0
    for p in paid:
        row = db.q("select code, mailed_at, revoked from exam.access_codes where session=$1", p["id"])
        if row and (row[0]["mailed_at"] or row[0]["revoked"]):
            continue
        if a.dry_run:
            print(f"would email {p['email']} for {p['id']}")
            continue
        try:
            code = db.q("select exam.claim_code($1,$2) r", p["id"], p["email"])[0]["r"]["code"]
        except RuntimeError as e:
            print(f"! {p['id']}: {e}")
            continue
        smtp = send(smtp, letter(p["email"], code, p["id"]))
        db.q("update exam.access_codes set mailed_at=now(), email=coalesce(email,lower($2)) where session=$1", p["id"], p["email"])
        sent += 1
        print(f"emailed a code for {p['id']}")
    if smtp:
        smtp.quit()
    print(f"{len(paid)} captured payment(s) checked · {sent} email(s) sent")


ENV = load_env()
if __name__ == "__main__":
    main()
