#!/usr/bin/env python3
"""
Turn the supplied domain artwork into hero plates the poster can actually use.

Three things are wrong with the images as delivered, and none of them is a
criticism of the art:

  * They are landscape or square. The poster's hero is a tall panel cut by a
    diagonal, roughly 560x650 on a 1080x1350 card, so a wide image dropped in
    as-is loses its subject to the crop.
  * They are five to nine megabytes each. Twenty openings sharing a folder of
    those is 130 MB in the repository and a slow render every time.
  * They are named Gemini_Generated_Image_kaklugkaklugkakl.png, which tells
    nobody which domain it belongs to.

So each one is cover-cropped to 3:4 around its centre, resized to 900x1200 —
comfortably above the slot's pixel density at 1x — and written out under the
domain's own slug at a sane file size.

The crop is centred rather than clever. Every one of these images puts its
subject in the middle, and a saliency guess that is right eleven times out of
fourteen is worse than a rule that is predictable: a poster that crops a logo
in half is obvious, and obvious is fixable by hand.
"""
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("error: Pillow is required.  pip install pillow")

HERE = Path(__file__).resolve().parent
OUT = HERE / "heroes"
SRC_DIR = Path("C:/Users/KIIT/Downloads")

TARGET = (900, 1200)  # 3:4, the aspect the hero slot wants

# The fragment of each supplied filename that identifies it, mapped to the
# slug we file it under. Matching on a fragment rather than the whole name
# because the delivered names repeat their own hash three times over.
PLATES = {
    "rhelkerh": ("gears",        "Interlocking cybernetic gears, teal glow"),
    "kaklugka": ("spark",        "Four-point magenta spark on a dark ground"),
    "m0wijmm0": ("growth-chart", "Glass bar chart with a rising arrow"),
    "5jve4g5j": ("cloud",        "Neon cloud outline over server racks"),
    "o73yhqo7": ("shield-lock",  "Steel shield with a glowing padlock"),
    "lfnlmtlf": ("gold-bars",    "Rising gold bars with a gold arrow"),
    "uyihjtuy": ("rocket",       "Rocket with neon exhaust in deep space"),
    "dqrq1fdq": ("briefcase",    "Leather and brass case with a gold arrow"),
    "c9wkyjc9": ("chip",         "Processor on a circuit board, amber traces"),
    "xnoczwxn": ("html5",        "Orange HTML5 shield badge"),
    "l6va91l6": ("python",       "Python logo in three dimensions"),
    "yp1uytyp": ("react",        "React atom with orbiting framework marks"),
    "aigw8hai": ("crown",        "Crystal crown beside a brass-cornered case"),
    "jgesq8jg": ("flutter",      "Flutter mark on a circuit-etched shield"),
}


def cover_crop(im, target):
    """Scale to cover the target box, then take the middle."""
    tw, th = target
    scale = max(tw / im.width, th / im.height)
    resized = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left = (resized.width - tw) // 2
    top = (resized.height - th) // 2
    return resized.crop((left, top, left + tw, top + th))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sources = sorted(SRC_DIR.glob("Gemini_Generated_Image_*.png"))
    if not sources:
        sys.exit(f"error: no Gemini_Generated_Image_*.png under {SRC_DIR}")

    written, unknown = {}, []
    for path in sources:
        key = next((k for k in PLATES if k in path.name), None)
        if not key:
            unknown.append(path.name)
            continue
        slug, alt = PLATES[key]
        im = Image.open(path).convert("RGB")
        plate = cover_crop(im, TARGET)
        dest = OUT / f"{slug}.jpg"
        # JPEG at 82 keeps these photographic plates under ~200 KB with no
        # visible loss at the size they are shown; PNG kept them near 2 MB.
        plate.save(dest, "JPEG", quality=82, optimize=True, progressive=True)
        written[slug] = {"file": dest.name, "alt": alt, "kb": dest.stat().st_size // 1024}
        print(f"{slug:13s} {dest.stat().st_size // 1024:4d} KB  <- {path.name[:40]}")

    (OUT / "plates.json").write_text(
        json.dumps(written, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"\n{len(written)} plates -> {OUT}")
    if unknown:
        print(f"unmatched (left alone): {', '.join(unknown)}")
    missing = sorted(set(s for s, _ in PLATES.values()) - set(written))
    if missing:
        print(f"expected but not found: {', '.join(missing)}")


if __name__ == "__main__":
    main()
