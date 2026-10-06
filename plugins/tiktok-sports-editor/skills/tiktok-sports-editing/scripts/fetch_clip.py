#!/usr/bin/env python3
"""Download a sports clip you're allowed to use and log its source + license.

For direct media file URLs from sources whose license allows reuse (Pexels,
Pixabay, Wikimedia Commons, Creative Commons uploads), or links to footage you
own or have written permission for. Every download is recorded in CREDITS.json
next to the clip so attribution and permission are never lost.

Usage:
  fetch_clip.py URL --license pexels --source-page https://www.pexels.com/video/... \
      [--creator "Name"] [--sport boxing] [--dir clips]

Licenses: own, permission, cc0, cc-by, cc-by-sa, pexels, pixabay, licensed
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.parse
import urllib.error
import urllib.request

LICENSES = {
    "own": "Filmed by the account owner",
    "permission": "Used with written permission from the rights holder",
    "cc0": "CC0 / public domain",
    "cc-by": "CC BY: credit the creator in the post caption",
    "cc-by-sa": "CC BY-SA: credit the creator; the edit must use the same license",
    "pexels": "Pexels License: free to use and modify, attribution appreciated",
    "pixabay": "Pixabay Content License: free to use and modify",
    "licensed": "Paid / editorial license on file",
}
NEEDS_CREDIT = {"cc-by", "cc-by-sa"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("--license", required=True, choices=sorted(LICENSES))
    ap.add_argument("--source-page", required=True, help="page where the license/permission is shown")
    ap.add_argument("--creator", default="")
    ap.add_argument("--sport", default="")
    ap.add_argument("--dir", default="clips")
    ap.add_argument("--name", help="output filename (default: derived from URL)")
    args = ap.parse_args()

    if args.license in NEEDS_CREDIT and not args.creator:
        sys.exit(f"error: --creator is required for {args.license} (the post must credit them)")

    os.makedirs(args.dir, exist_ok=True)
    name = args.name or os.path.basename(urllib.parse.urlparse(args.url).path) or "clip.mp4"
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    if not os.path.splitext(name)[1]:
        name += ".mp4"
    dest = os.path.join(args.dir, name)

    req = urllib.request.Request(args.url, headers={"User-Agent": "Mozilla/5.0 (tiktok-sports-editor)"})
    try:
        resp = urllib.request.urlopen(req, timeout=120)
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f"error: download failed ({e}). Check the link, or download it in a browser and pass it as file:///full/path/to/clip.mp4.")
    with resp:
        ctype = resp.headers.get("Content-Type", "")
        if "text/html" in ctype:
            sys.exit("error: URL returned a web page, not a video file. Use the direct download link "
                     "(e.g. the .mp4 link from the site's Download button).")
        with open(dest, "wb") as f:
            while chunk := resp.read(1 << 20):
                f.write(chunk)

    credits_path = os.path.join(args.dir, "CREDITS.json")
    credits = []
    if os.path.exists(credits_path):
        with open(credits_path) as f:
            credits = json.load(f)
    entry = {
        "file": name,
        "url": args.url,
        "source_page": args.source_page,
        "license": args.license,
        "license_terms": LICENSES[args.license],
        "creator": args.creator,
        "sport": args.sport,
        "downloaded": datetime.date.today().isoformat(),
    }
    credits = [c for c in credits if c.get("file") != name] + [entry]
    with open(credits_path, "w") as f:
        json.dump(credits, f, indent=2)

    size_mb = os.path.getsize(dest) / 1e6
    print(json.dumps({"saved": dest, "size_mb": round(size_mb, 1), **entry,
                      "caption_credit": f"🎥 {args.creator}" if args.creator else ""}, indent=2))


if __name__ == "__main__":
    main()
