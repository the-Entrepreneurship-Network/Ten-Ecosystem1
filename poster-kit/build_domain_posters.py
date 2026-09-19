#!/usr/bin/env python3
"""
Render the poster plates the LinkedIn section hands out.

Twenty-eight of them: two per domain, the same poster with different artwork in
the hero panel.

    python poster-kit/build_domain_posters.py                 # the fourteen domain plates
    python poster-kit/build_domain_posters.py --variant ten   # the fourteen TEN plates
    python poster-kit/build_domain_posters.py --all           # all twenty-eight

Run once, commit the output, forget about it. Every word on these is a constant
— October 2026 batch, Online, 3 Months, Unpaid, no prior skill needed — so there
is no reason to draw them more than once, and every reason not to draw them on a
server. An image model supplies the artwork and a browser supplies the type,
which is the whole architecture: a model asked to letter a poster will write
MGDE for MODE and five thousand rupees for Unpaid, and it will do it on a live
job advertisement.

Output goes to public/assets/linkedin-posters/<slug>.jpg and <slug>-ten.jpg,
where <slug> matches the domain slugs in services/v2/linkedin/openings.js. JPEG
rather than PNG because twenty-eight 1080x1350 PNGs are about 30 MB of
repository and the same twenty-eight at quality 88 are about 5 MB with nothing
visibly lost.

Nothing here invents a number. The batch is the one the team stated; there is no
stipend figure and no opening count, because nobody has stated either — and a
plausible figure nobody approved, printed on a live job ad, is the most
expensive mistake this pipeline could make.
"""
import argparse
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

# Domain display name -> (slug, role). The slug is the filename the section
# looks for and must stay in step with DOMAINS in openings.js; the pairing is
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


# The two plates every domain gets. They are the same poster; only the artwork
# in the hero panel differs, which is the whole point — a reader who sees both
# on LinkedIn should recognise the second as the same company, not wonder
# whether two organisations are hiring.
#
#   domain  <slug>.jpg      the domain's own mark: the Python logo, a shield, gears
#   ten     <slug>-ten.jpg  the TEN tower with the gold hands, shared by all fourteen
VARIANTS = {
    "domain": {"suffix": "", "hero": None},
    "ten": {"suffix": "-ten", "hero": "ten-building.jpg"},
}


def hero_for(slug, variant="domain"):
    """The plate this domain gets, for this variant."""
    fixed = VARIANTS[variant]["hero"]
    if fixed:
        # One shared plate for every domain. Missing is fatal rather than a
        # dark panel: a TEN-variant poster with no TEN on it is just the domain
        # poster with its logo deleted, and nobody would spot that in a list of
        # fourteen filenames.
        plate = HEROES / fixed
        if not plate.exists():
            sys.exit(f"error: {variant} variant needs heroes/{fixed}, which is not there.")
        return plate

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
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--variant", choices=sorted(VARIANTS), default="domain",
                    help="which plate set to render (default: domain)")
    ap.add_argument("--all", action="store_true",
                    help="render every variant in turn — all twenty-eight plates")
    args = ap.parse_args()

    for variant in (sorted(VARIANTS) if args.all else [args.variant]):
        build(variant)


def build(variant):
    OUT.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix="ten-posters-"))
    renderer = HERE / "render_poster.py"
    suffix = VARIANTS[variant]["suffix"]
    print(f"\n-- {variant} variant --")

    written, missing_hero, failed = [], [], []
    for name, slug, role in DOMAINS:
        hero = hero_for(slug, variant)
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

        dest = OUT / f"{slug}{suffix}.jpg"
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

    # The section looks up posters by the slug in openings.js. If the two lists
    # ever drift, a domain silently shows without its poster, so the drift is
    # caught here where somebody is watching rather than by a student noticing
    # a blank card.
    src = (REPO / "services" / "v2" / "linkedin" / "openings.js").read_text(encoding="utf-8")
    import re
    js_slugs = set(re.findall(r"slug:\s*'([a-z]+)'", src))
    ours = {slug for _, slug, _ in DOMAINS}
    if js_slugs != ours:
        print(f"slug mismatch with openings.js: only in JS {sorted(js_slugs - ours)}, "
              f"only here {sorted(ours - js_slugs)}", file=sys.stderr)
        sys.exit(1)
    print(f"slugs match openings.js ({len(ours)} domains)")


if __name__ == "__main__":
    main()
