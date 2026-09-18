#!/usr/bin/env python3
"""
Write a job file for one internship opening, with its domain's hero already in it.

The poster's hero panel was being filled by hand, which is how a Cyber Security
opening ends up carrying the Python plate: nobody notices until it is live. The
domain is the one fact every opening has, and it is enough to choose the
artwork, so it does — and a domain the mapping has no plate for falls back to
the dark panel rather than to whichever plate happened to be there before.

    python poster-kit/make_job.py "Cyber Security" \
        --role "Cyber Security Intern" --batch "October 2026" --openings 15 \
        --mode Online --duration "3 Months" --stipend "Rs 5,000 / mo" \
        -o poster-kit/jobs/cyber.json

Everything not supplied is left out of the poster entirely. There is no default
stipend and no default deadline on purpose: a plausible figure nobody stated
reads as a commitment to every fresher who sees it.
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HEROES = HERE / "heroes"

BRAND = {
    "primary": "#D4AF37",
    "accent": "#F5C542",
    "logo": None,
    "logo_text": "TEN",
    "tagline": ["Virtual", "Internships", "Real Projects", "Reviewed Weekly"],
}

# Which icon suits which fact. Spelling counts — the template falls back to a
# briefcase for anything it does not recognise.
ICONS = {
    "Company": "building", "Domain": "briefcase", "Mode": "globe",
    "Openings": "users", "Duration": "clock", "Batch": "calendar",
    "Location": "pin", "Skills": "bulb", "Apply By": "target",
}

# The design targets six fact columns; past that they become slivers. These are
# in the order they earn their place on a hiring poster.
FACT_ORDER = ["Company", "Domain", "Mode", "Openings", "Duration", "Batch", "Location", "Skills", "Apply By"]


def load_domains():
    path = HEROES / "domains.json"
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def hero_for(domain):
    """The plate for this domain, as a path relative to the job file, or None.

    Matching is case-insensitive and tolerant of the shorthand people type —
    "cyber" finds "Cyber Security" — but never guesses between two domains that
    both contain the fragment. An unmatched domain returns None and the poster
    uses its dark panel, which is a poster that still reads correctly.
    """
    domains = load_domains()
    if not domain:
        return None, None, None

    want = domain.strip().lower()
    exact = [k for k in domains if k.lower() == want]
    partial = [k for k in domains if want in k.lower()] if not exact else []
    hits = exact or partial
    if len(hits) != 1:
        return None, None, (f"{len(hits)} domains match {domain!r}" if hits else f"no domain matches {domain!r}")

    entry = domains[hits[0]]
    plate = entry.get("plate")
    if not plate:
        return None, hits[0], entry.get("note") or "no plate for this domain yet"

    path = HEROES / f"{plate}.jpg"
    if not path.exists():
        return None, hits[0], f"plate file missing: {path.name}"
    return path, hits[0], None


def main():
    ap = argparse.ArgumentParser(description="Build a poster job file for one opening.")
    ap.add_argument("domain", help="internship domain, e.g. 'Cyber Security'")
    ap.add_argument("--role")
    ap.add_argument("--org", default="The Entrepreneurship Network")
    ap.add_argument("--batch")
    ap.add_argument("--openings")
    ap.add_argument("--mode", help="Online, Offline or Hybrid")
    ap.add_argument("--location")
    ap.add_argument("--duration")
    ap.add_argument("--stipend")
    ap.add_argument("--skills")
    ap.add_argument("--apply-by", dest="apply_by")
    ap.add_argument("--eligibility", default="B.E. | B.Tech | BCA | MCA | B.Sc | M.Sc | Any Bachelor's | Any Master's")
    ap.add_argument("-o", "--out", default="job.json")
    args = ap.parse_args()

    hero_path, matched, why = hero_for(args.domain)
    domain_name = matched or args.domain
    role = args.role or f"{domain_name} Intern"

    values = {
        "Company": args.org, "Domain": domain_name, "Mode": args.mode,
        "Openings": args.openings, "Duration": args.duration, "Batch": args.batch,
        "Location": args.location, "Skills": args.skills, "Apply By": args.apply_by,
    }
    facts = [
        {"icon": ICONS[k], "label": k, "value": values[k]}
        for k in FACT_ORDER if values.get(k)
    ][:6]

    out = Path(args.out).resolve()
    job = {
        "size": {"w": 1080, "h": 1350},
        "brand": dict(BRAND),
        "headline": {
            "company_display": args.org,
            "lead": f"{'TEN' if args.org == BRAND['logo_text'] or 'Entrepreneurship' in args.org else args.org} IS",
            "verb": "HIRING!",
            "role": role,
            "blurb": "Build something real with a coordinator reviewing your work every week, and finish with a portfolio you can <em>walk an interviewer through</em>.",
        },
        "hero": {
            # Relative to the job file, which is how render_poster.py resolves it.
            "image": None if not hero_path else _rel(hero_path, out.parent),
            "caption": "Project work, not <em>shadowing.</em>",
            "accent_note": "Freshers\nAre Welcome",
        },
        "facts": facts,
        "eligibility": {"heading": "ELIGIBILITY", "text": args.eligibility},
        "cta": {
            "kicker": "COMMENT",
            "quote": "INTERESTED",
            "tail": "AND WE WILL REPLY.",
            "sub": "WE WILL SEND YOU THE OFFICIAL APPLICATION LINK.",
            "accent_note": "No Prior\nSkill Needed",
        },
        "footer": {
            "left": "We run <b>virtual internships</b> and <b>early-career projects</b> across every domain we teach.",
            "follow_label": "APPLY AT",
            "follow_name": "TEN",
            "follow_sub": "VIRTUALINTERNSHIPS.ENTREPRENEURSHIPNETWORK.NET",
        },
    }
    if args.stipend:
        job["salary"] = {"label": "STIPEND", "value": args.stipend, "note": "(As stated by the team)"}

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(job, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"{out}  domain={domain_name}  facts={len(facts)}")
    if why:
        print(f"  note: {why} — the hero falls back to the dark panel", file=sys.stderr)


def _rel(target, start):
    try:
        return str(Path(target).relative_to(start)).replace("\\", "/")
    except ValueError:
        import os
        return os.path.relpath(target, start).replace("\\", "/")


if __name__ == "__main__":
    main()
