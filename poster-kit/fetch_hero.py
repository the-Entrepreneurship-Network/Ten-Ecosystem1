#!/usr/bin/env python3
"""
Generate the poster's hero artwork with Nano Banana, straight off the Gemini REST
API. No Gemini CLI, no extension, no npm - just a key and stdlib.

    export NANOBANANA_API_KEY=...            # or GEMINI_API_KEY
    python fetch_hero.py "modern glass office tower from below, deep blue tones" \
        -o nanobanana-output/hero.png --size 4K --model pro

The hero slot is a tall panel cut by a diagonal, so the default aspect is 3:4 and
prompts should describe a vertical composition with the subject off-centre right.
"no text, no logos" is appended automatically: any lettering the model invents
collides with the headline the poster draws on top of the artwork.

Image generation is a PAID feature. On a key with no billing attached every image
model reports "limit: 0" and returns HTTP 429 - that is a plan problem, not a
transient rate limit, and retrying will not clear it.
"""
import argparse, base64, json, os, sys, urllib.error, urllib.request

MODELS = {
    "pro":   "gemini-3-pro-image",          # Nano Banana Pro - best detail and text
    "2":     "gemini-3.1-flash-image",      # Nano Banana 2 - current default tier
    "lite":  "gemini-3.1-flash-lite-image",
    "v1":    "gemini-2.5-flash-image",
}
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent"
NEGATIVE = ("Absolutely no text, no signage, no lettering, no logos, no brand marks "
            "and no watermarks anywhere in the image.")


def main():
    ap = argparse.ArgumentParser(description="Generate poster hero art via Nano Banana.")
    ap.add_argument("prompt")
    ap.add_argument("-o", "--out", default="nanobanana-output/hero.png")
    ap.add_argument("--model", default="pro", choices=sorted(MODELS))
    ap.add_argument("--size", default="2K", choices=["1K", "2K", "4K"])
    ap.add_argument("--aspect", default="3:4",
                    help="hero slot is portrait; 3:4 or 4:5 suit it best")
    args = ap.parse_args()

    key = os.environ.get("NANOBANANA_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("error: set NANOBANANA_API_KEY (or GEMINI_API_KEY) first.\n"
                 "Get one from https://aistudio.google.com/apikey")

    body = json.dumps({
        "contents": [{"parts": [{"text": f"{args.prompt.rstrip('.')}. {NEGATIVE}"}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": args.aspect, "imageSize": args.size},
        },
    }).encode()

    req = urllib.request.Request(
        ENDPOINT.format(MODELS[args.model]), data=body, method="POST",
        headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")
        msg = ""
        try:
            msg = json.loads(detail).get("error", {}).get("message", "")
        except Exception:
            msg = detail[:400]
        if e.code == 429 and "limit: 0" in msg:
            sys.exit("error: this API key's project has no image-generation quota.\n"
                     "Image models are paid-only - enable billing at "
                     "https://aistudio.google.com/apikey, or use a key from a billed project.\n"
                     "Retrying will not help.")
        sys.exit(f"error: HTTP {e.code} from Gemini: {msg[:500]}")

    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            blob = part.get("inlineData") or part.get("inline_data")
            if blob and blob.get("data"):
                out = args.out
                os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
                with open(out, "wb") as f:
                    f.write(base64.b64decode(blob["data"]))
                print(f"{out}  ({args.model}, {args.size}, {args.aspect})")
                return
            if part.get("text"):
                print(f"model returned text instead of an image: {part['text'][:300]}",
                      file=sys.stderr)
    sys.exit("error: no image in the response. The prompt may have been refused; "
             "simplify it and retry.")


if __name__ == "__main__":
    main()
