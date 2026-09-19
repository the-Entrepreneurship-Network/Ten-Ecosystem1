#!/usr/bin/env python3
"""
Render the fourteen posters the autopilot attaches to its posts.

Run once, commit the output, forget about it. That is the point: the alternative
is a headless browser running on the production box every two hours, at three in
the morning, with nobody watching it fail, to draw a poster whose every word is a
constant. The facts on these are the programme's facts — October 2026 batch,
Remote, 2-6 Months, Unpaid, no prior skill needed — and they do not change
between posts, so the poster does not need to be drawn between posts either.

    python poster-kit/build_domain_posters.py

Output goes to public/assets/linkedin-posters/<slug>.jpg, where <slug> matches
the domain slugs in services/v2/linkedin/domainPost.js. JPEG rather than PNG
because fourteen 1080x1350 PNGs are about 15 MB of repository and the same
fourteen at quality 88 are about 3 MB with nothing visibly lost.

Nothing here invents a number. The batch is the one the team stated; there is no
stipend figure and no opening count, because nobody has stated either — and a
plausible figure nobody approved, printed on a live job ad, is the most
expensive mistake this pipeline could make.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("error: Pillow is required.  pip install pillow")

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
HEROES = HERE / "heroes"
OUT = REPO / "public" / "assets" / "linkedin-posters"

# Domain display name -> (slug, role). The slug is the filename the autopilot
# looks for and must stay in step with DOMAINS in domainPost.js; the pairing is
# asserted at the bottom of this script rather than trusted.
DOMAINS = [
    ("Python Development",     "python",   "Python Development Intern"),
    ("Web Development",        "web",      "Web Development Intern"),
    ("Business Development",   "business", "Business Development Intern"),
    ("MERN Stack Development", "mern",     "MERN Stack Development Intern"),
    ("HR",                     "hr",       "Human Resources Intern"),
    ("Data Science",           "datasci",  "Data Science Intern"),
    ("Java Development",       "java",     "Java Development Intern"),
    ("Space",                  "space",    "Space Technology Intern"),
    ("Cyber Security",         "cyber",    "Cyber Security Intern"),
    ("Venture Capital",        "venture",  "Venture Capital Intern"),
    ("Flutter Development",    "flutter",  "Flutter Development Intern"),
    ("Software Engineering",   "softeng",  "Software Engineering Intern"),
    ("DevOps with AWS",        "devops",   "DevOps (AWS) Intern"),
    ("Vibe Coding",            "vibe",     "Vibe Coding Intern"),
]

ORG = "The Entrepreneurship Network"

BRAND = {
    "primary": "#D4AF37",
    "accent": "#F5C542",
    "logo": None,
    "logo_text": "TEN",
    "tagline": ["Virtual", "Internships", "Real Projects", "Across 14 Domains"],
}

ELIGIBILITY = [
    "B.E.", "B.Tech", "BCA", "MCA", "B.Sc", "M.Sc",
    "Any Bachelor's", "Any Master's", "Freshers welcome",
]


def hero_for(slug):
    """The plate filed against this domain in heroes/domains.json."""
    raw = json.loads((HEROES / "domains.json").read_text(encoding="utf-8"))
    for name, entry in raw.items():
        if name.startswith("_"):
            continue
        if entry.get("icon") == slug:
            plate = HEROES / f"{entry.get('plate')}.jpg"
            return plate if plate.exists() else None
    return None


def job_for(name, slug, role, hero, workdir):
    """The job JSON render_poster.py reads, for one domain."""
    job = {
        "size": {"w": 1080, "h": 1350},
        "brand": dict(BRAND),
        "headline": {
            "company_display": ORG,
            "lead": "TEN IS",
            "verb": "HIRING!",
            "role": role,
            "blurb": "Build something real with a coordinator reviewing your work every week, "
                     "and finish with a portfolio you can "
                     "<em>walk an interviewer through</em>.",
        },
        "hero": {
            # Relative to the job file, which is how render_poster.py resolves it.
            "image": None if hero is None else _rel(hero, workdir),
            "caption": "Project work, not <em>shadowing.</em>",
            "accent_note": "Freshers\nAre Welcome",
        },
        # The five facts on the demo poster the team supplied, in its order and
        # with its values. Nothing added, nothing dropped: the only change
        # asked for on that poster was the stipend, below.
        "facts": [
            {"icon": "building",  "label": "Company",  "value": "The\nEntrepreneurship\nNetwork"},
            {"icon": "briefcase", "label": "Domain",   "value": name.replace(" ", "\n", 1)},
            {"icon": "globe",     "label": "Mode",     "value": "Online"},
            {"icon": "clock",     "label": "Duration", "value": "3 Months"},
            {"icon": "calendar",  "label": "Batch",    "value": "October\n2026"},
        ],
        "eligibility": {"heading": "ELIGIBILITY", "items": list(ELIGIBILITY)},
        # The one change to the supplied poster: the rupee figure is gone and
        # the field reads Stipend: Unpaid. No note under it — a note is where
        # an explanation creeps back in, and the team asked for the word alone.
        "salary": {"label": "STIPEND", "value": "Unpaid"},
        # As supplied. The post carries the application link as well, so a
        # reader has both doors; this is the one the page has been using.
        "cta": {
            "kicker": "COMMENT",
            "quote": "INTERESTED",
            "tail": "AND WE WILL REPLY.",
            "sub": "WE WILL SEND YOU THE OFFICIAL APPLICATION LINK.",
            "accent_note": "No Prior\nSkill Needed",
        },
        "footer": {
            "left": "We run <b>virtual internships</b> and <b>early-career projects</b> across "
                    "every domain we teach.",
            "follow_label": "APPLY AT",
            "follow_name": "TEN",
            "follow_sub": "VIRTUALINTERNSHIPS.ENTREPRENEURSHIPNETWORK.NET",
        },
    }
    return job


def _rel(target, start):
    import os
    try:
        return str(Path(target).relative_to(start)).replace("\\", "/")
    except ValueError:
        return os.path.relpath(target, start).replace("\\", "/")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix="ten-posters-"))
    renderer = HERE / "render_poster.py"

    written, missing_hero, failed = [], [], []
    for name, slug, role in DOMAINS:
        hero = hero_for(slug)
        if hero is None:
            missing_hero.append(slug)

        job_path = workdir / f"{slug}.json"
        job_path.write_text(json.dumps(job_for(name, slug, role, hero, workdir),
                                       indent=2, ensure_ascii=False), encoding="utf-8")

        png = workdir / f"{slug}.png"
        proc = subprocess.run([sys.executable, str(renderer), str(job_path), "-o", str(png)],
                              capture_output=True, text=True)
        if proc.returncode != 0 or not png.exists():
            failed.append((slug, (proc.stderr or proc.stdout or "").strip()[:200]))
            continue

        dest = OUT / f"{slug}.jpg"
        # The poster is flat colour over a photographic hero; 88 holds the type
        # crisp and lands around 200 KB, against ~1.1 MB for the same PNG.
        Image.open(png).convert("RGB").save(dest, "JPEG", quality=88, optimize=True, progressive=True)
        written.append((slug, dest.stat().st_size // 1024))
        print(f"{slug:9s} {dest.stat().st_size // 1024:4d} KB  {dest.name}")

    print(f"\n{len(written)} posters -> {OUT}")
    if missing_hero:
        print(f"no hero plate (dark panel used): {', '.join(missing_hero)}", file=sys.stderr)
    if failed:
        for slug, why in failed:
            print(f"FAILED {slug}: {why}", file=sys.stderr)
        sys.exit(1)

    # The autopilot looks up posters by the slug in domainPost.js. If the two
    # lists ever drift, a domain silently posts without its poster, so the drift
    # is caught here where somebody is watching rather than on a Saturday.
    src = (REPO / "services" / "v2" / "linkedin" / "domainPost.js").read_text(encoding="utf-8")
    import re
    js_slugs = set(re.findall(r"slug:\s*'([a-z]+)'", src))
    ours = {slug for _, slug, _ in DOMAINS}
    if js_slugs != ours:
        print(f"slug mismatch with domainPost.js: only in JS {sorted(js_slugs - ours)}, "
              f"only here {sorted(ours - js_slugs)}", file=sys.stderr)
        sys.exit(1)
    print(f"slugs match domainPost.js ({len(ours)} domains)")


if __name__ == "__main__":
    main()
