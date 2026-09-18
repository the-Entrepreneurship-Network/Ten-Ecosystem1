#!/usr/bin/env python3
"""
Write manifest.json — the caption and alt text — from the same job file the
poster was rendered from.

The skill names one failure as the most common way this pipeline embarrasses
whoever posted: two different stipends, one baked into the image and one typed
into the caption underneath it. That happens because the caption gets written
by hand, later, from memory. So it is not written by hand here. Every figure in
the caption is read out of the job JSON, which means the only way for the two
to disagree is to render the poster from a different file than this was run on.

Alt text is not filler either. A poster is text baked into an image, so without
it the post is unreadable to anyone using a screen reader — and it describes
the opening, not the artwork: what the job is, where, how long, what it pays.

    python poster-kit/make_manifest.py poster-kit/ten-python.json \
        --image poster-kit/out/ten-python.png -o poster-kit/out/manifest.json
"""
import argparse, json, re, sys
from pathlib import Path

MARKERS = [
    ("Company", "\U0001F3E2"), ("Position", "\U0001F4BC"), ("Domain", "\U0001F9ED"),
    ("Batch", "\U0001F4C5"), ("Openings", "\U0001F465"), ("Mode", "\U0001F4BB"),
    ("Location", "\U0001F4CD"), ("Duration", "\U0001F552"), ("Stipend", "\U0001F4B0"),
]


def strip_tags(s):
    """The JSON carries <em>/<b> for the poster's own highlighting; a caption is
    plain text and must not show the markup."""
    return re.sub(r"<[^>]+>", "", str(s or "")).strip()


def flat(s):
    """Fact values use \\n to break a column on the poster. A caption is one
    line per fact, so those breaks become spaces rather than line breaks."""
    return " ".join(strip_tags(s).split())


def main():
    ap = argparse.ArgumentParser(description="Derive caption and alt text from a job file.")
    ap.add_argument("job")
    ap.add_argument("--image", default="poster.png")
    ap.add_argument("-o", "--out", default="manifest.json")
    ap.add_argument("--hashtags", default="")
    args = ap.parse_args()

    job = json.loads(Path(args.job).read_text(encoding="utf-8"))
    facts = {flat(f.get("label")): flat(f.get("value")) for f in job.get("facts", [])}
    head = job.get("headline", {})
    sal = job.get("salary", {})
    elig = job.get("eligibility", {})
    cta = job.get("cta", {})

    org = facts.get("Company") or flat(head.get("company_display"))
    role = flat(head.get("role"))

    lines = [f"{org} is hiring — {role}", ""]
    for label, marker in MARKERS:
        value = facts.get(label)
        if label == "Stipend":
            value = flat(sal.get("value"))
            note = flat(sal.get("note"))
            if value and note:
                value = f"{value} {note}"
        if label == "Company":
            value = org
        if label == "Position":
            value = role
        if value:
            lines.append(f"{marker} {label}: {value}")

    items = elig.get("items")
    elig_text = " | ".join(flat(i) for i in items) if items else flat(elig.get("text"))
    if elig_text:
        lines += ["", f"\U0001F393 Eligibility: {elig_text}"]

    quote = flat(cta.get("quote")) or "INTERESTED"
    tail = flat(cta.get("tail"))
    sub = flat(cta.get("sub"))
    lines += ["", f'Comment "{quote}" {tail}'.strip()]
    if sub:
        lines.append(sub[0].upper() + sub[1:].lower() if sub.isupper() else sub)

    tags = args.hashtags.split() if args.hashtags else [
        "#TheEntrepreneurshipNetwork", "#TEN", "#Internships", "#Hiring", "#Freshers",
    ]
    lines += ["", " ".join(tags)]

    alt_bits = [b for b in [
        f"Hiring poster: {org}", role, facts.get("Mode"), facts.get("Location"),
        facts.get("Duration"), flat(sal.get("value")), facts.get("Batch"),
    ] if b]
    manifest = {
        "image": args.image,
        "caption": "\n".join(lines).strip(),
        "alt_text": ", ".join(alt_bits) + ".",
        "dimensions": f"{job.get('size', {}).get('w', 1080)}x{job.get('size', {}).get('h', 1350)}",
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{out}  ({len(manifest['caption'])} char caption)")


if __name__ == "__main__":
    main()
