#!/usr/bin/env python3
"""Find clips for a hype edit: mine the user's own footage, or search free-licensed sources.

  find_clips.py scan PATH... [--top 15] [--sheets DIR] [--out shortlist.json]
      Recursively finds every video under the given files/folders, scores play windows
      (motion + crowd/contact audio, minus broadcast-cut penalty), ranks them across the
      whole library and writes a 6-frame preview sheet per pick.

  find_clips.py search "basketball dunk" [--sources commons,archive,pexels,pixabay]
                [--limit 10] [--min-sec 3] [--max-sec 120] [--orientation portrait|landscape]
                [--out results.json]
      Searches sources whose licenses allow reuse in an edit. Only results with a reusable
      license are returned (CC0 / public domain / CC BY / CC BY-SA, Pexels or Pixabay license).
      Pexels and Pixabay need PEXELS_API_KEY / PIXABAY_API_KEY (free keys); Commons and the
      Internet Archive need no key.

  find_clips.py fetch ID [ID...] --from results.json --outdir clips/
      Downloads chosen results and appends license + attribution to clips/CREDITS.json.

Never use this for league/network broadcast footage (NBA, NFL, NCAA TV, PPV): those aren't
reusable, and no source here serves them.
"""
import argparse
import json
import os
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import analyze  # noqa: E402  (same directory)

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mts", ".m2ts", ".3gp", ".mpg", ".mpeg", ".wmv"}
UA = "pro-sports-hype-editor/1.0 (clip finder; ffmpeg)"
REUSABLE = ("cc0", "cc-zero", "public domain", "pd", "cc by", "cc-by", "cc by-sa", "cc-by-sa",
            "creativecommons.org/licenses/by/", "creativecommons.org/licenses/by-sa/",
            "creativecommons.org/publicdomain/")
NON_REUSABLE_HINTS = ("-nc", " nc", "noncommercial", "-nd", " nd", "noderivs")


# ---------------------------------------------------------------- scan (offline)

def find_videos(paths):
    out = []
    for p in paths:
        if os.path.isfile(p):
            out.append(p)
        else:
            for root, dirs, files in os.walk(p):
                dirs[:] = [d for d in dirs if not d.startswith(".") and not d.endswith("_work")]
                out += [os.path.join(root, f) for f in files if os.path.splitext(f)[1].lower() in VIDEO_EXT]
    return sorted(set(out))


def sheet(path, start, end, dst):
    step = max(0.1, (end - start) / 6)
    sel = "+".join(f"between(t,{start + i * step:.2f},{start + i * step + 0.05:.2f})" for i in range(6))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0, start - 0.5):.2f}", "-t", f"{end - start + 1:.2f}",
                    "-i", path, "-vf", f"setpts=PTS+{max(0, start - 0.5):.2f}/TB,select='{sel}',scale=320:-2,tile=6x1",
                    "-frames:v", "1", "-fps_mode", "vfr", dst], capture_output=True)
    return dst if os.path.exists(dst) else None


def cmd_scan(a):
    vids = find_videos(a.paths)
    if not vids:
        sys.exit("no video files found under: " + ", ".join(a.paths))
    allc, inventory = [], []
    for v in vids:
        try:
            info = analyze.probe(v)
        except SystemExit:
            print(f"  skip (unreadable): {v}", file=sys.stderr)
            continue
        if "video" not in info or info["duration"] < a.min_dur:
            continue
        inventory.append({"file": v, "duration": round(info["duration"], 1),
                          "res": f"{info['video']['width']}x{info['video']['height']}",
                          "fps": info["video"]["fps"], "audio": "audio" in info})
        print(f"  scanning {v} ({info['duration']:.0f}s)", file=sys.stderr, flush=True)
        ns = argparse.Namespace(file=v, out=None, top=max(5, a.top), window=a.window, step=a.window / 4)
        res = plays_quiet(ns)
        for c in res:
            c["file"] = v
        allc += res
    allc.sort(key=lambda c: -c["score"])
    picks = allc[: a.top]
    if a.sheets:
        os.makedirs(a.sheets, exist_ok=True)
        for i, c in enumerate(picks):
            name = f"{i + 1:02d}_{os.path.splitext(os.path.basename(c['file']))[0][:40]}_{c['start']:.0f}s.jpg"
            c["sheet"] = sheet(c["file"], c["start"], c["end"], os.path.join(a.sheets, name))
    out = {"library": inventory, "picks": picks}
    if a.out:
        json.dump(out, open(a.out, "w"), indent=2)
    print(json.dumps({"files_scanned": len(inventory),
                      "picks": [{k: c.get(k) for k in ("file", "start", "end", "impact_guess", "score", "sheet")}
                                for c in picks]}, indent=2))


def plays_quiet(ns):
    """Run analyze.cmd_plays without its stdout dump; return its ranked candidates."""
    import contextlib
    import io
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        analyze.cmd_plays(ns)
    return json.loads(buf.getvalue())


# ---------------------------------------------------------------- network helpers

def ssl_ctx():
    for f in (os.environ.get("SSL_CERT_FILE"), os.environ.get("REQUESTS_CA_BUNDLE"), "/root/.ccr/ca-bundle.crt"):
        if f and os.path.exists(f):
            return ssl.create_default_context(cafile=f)
    return ssl.create_default_context()


class Blocked(Exception):
    pass


def get_json(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30, context=ssl_ctx()) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403) and "api" in url:
            raise Blocked(f"{urllib.parse.urlparse(url).hostname}: HTTP {e.code} (bad/missing API key?)")
        raise Blocked(f"{urllib.parse.urlparse(url).hostname}: HTTP {e.code}")
    except (urllib.error.URLError, OSError) as e:
        raise Blocked(f"{urllib.parse.urlparse(url).hostname}: {getattr(e, 'reason', e)} "
                      "(if 'Tunnel connection failed: 403', the environment's network policy blocks this host; "
                      "add it under Allowed domains in the environment settings)")


def reusable(lic):
    l = (lic or "").lower()
    return any(k in l for k in REUSABLE) and not any(k in l for k in NON_REUSABLE_HINTS)


# ---------------------------------------------------------------- sources

def src_commons(q, a):
    params = {"action": "query", "format": "json", "generator": "search", "gsrnamespace": "6",
              "gsrsearch": f"{q} filetype:video", "gsrlimit": str(min(50, a.limit * 3)),
              "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata|mediatype"}
    d = get_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params))
    out = []
    for p in (d.get("query", {}).get("pages", {}) or {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        md = ii.get("extmetadata", {})
        lic = md.get("LicenseShortName", {}).get("value", "")
        if not reusable(lic + " " + md.get("LicenseUrl", {}).get("value", "")):
            continue
        out.append({"source": "commons", "id": f"commons:{p['pageid']}", "title": p.get("title", "")[5:],
                    "page": ii.get("descriptionurl"), "url": ii.get("url"),
                    "width": ii.get("width"), "height": ii.get("height"),
                    "duration": ii.get("duration"), "license": lic,
                    "license_url": md.get("LicenseUrl", {}).get("value"),
                    "author": strip_html(md.get("Artist", {}).get("value", "")),
                    "attribution_required": "by" in lic.lower()})
    return out


def src_archive(q, a):
    params = {"q": f"({q}) AND mediatype:movies AND licenseurl:*creativecommons*",
              "fl[]": ["identifier", "title", "creator", "licenseurl"], "rows": str(a.limit * 2), "output": "json"}
    d = get_json("https://archive.org/advancedsearch.php?" + urllib.parse.urlencode(params, doseq=True))
    out = []
    for doc in d.get("response", {}).get("docs", []):
        lic = doc.get("licenseurl", "")
        if not reusable(lic):
            continue
        ident = doc["identifier"]
        try:
            meta = get_json(f"https://archive.org/metadata/{urllib.parse.quote(ident)}")
        except Blocked:
            continue
        files = [f for f in meta.get("files", []) if f.get("name", "").lower().endswith(".mp4")]
        if not files:
            continue
        f = max(files, key=lambda f: int(f.get("size", 0) or 0))
        dur = float(f.get("length", 0) or 0) if str(f.get("length", "")).replace(".", "", 1).isdigit() else None
        out.append({"source": "archive", "id": f"archive:{ident}", "title": doc.get("title", ident),
                    "page": f"https://archive.org/details/{ident}",
                    "url": f"https://archive.org/download/{urllib.parse.quote(ident)}/{urllib.parse.quote(f['name'])}",
                    "width": int(f.get("width", 0) or 0) or None, "height": int(f.get("height", 0) or 0) or None,
                    "duration": dur, "license": lic, "license_url": lic,
                    "author": doc.get("creator") if isinstance(doc.get("creator"), str) else ", ".join(doc.get("creator", []) or []),
                    "attribution_required": "/by" in lic})
    return out


def src_pexels(q, a):
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        raise Blocked("pexels: set PEXELS_API_KEY (free at pexels.com/api)")
    params = {"query": q, "per_page": str(min(80, a.limit * 2))}
    if a.orientation:
        params["orientation"] = a.orientation
    d = get_json("https://api.pexels.com/videos/search?" + urllib.parse.urlencode(params), {"Authorization": key})
    out = []
    for v in d.get("videos", []):
        files = [f for f in v.get("video_files", []) if f.get("file_type") == "video/mp4" and f.get("link")]
        if not files:
            continue
        f = max(files, key=lambda f: (f.get("width") or 0) * (f.get("height") or 0))
        out.append({"source": "pexels", "id": f"pexels:{v['id']}", "title": v.get("url", "").rstrip("/").split("/")[-1],
                    "page": v.get("url"), "url": f["link"], "width": f.get("width"), "height": f.get("height"),
                    "duration": v.get("duration"), "license": "Pexels License", "license_url": "https://www.pexels.com/license/",
                    "author": (v.get("user") or {}).get("name"), "attribution_required": False})
    return out


def src_pixabay(q, a):
    key = os.environ.get("PIXABAY_API_KEY")
    if not key:
        raise Blocked("pixabay: set PIXABAY_API_KEY (free at pixabay.com/api/docs)")
    params = {"key": key, "q": q, "per_page": str(max(3, min(200, a.limit * 2))), "safesearch": "true"}
    d = get_json("https://pixabay.com/api/videos/?" + urllib.parse.urlencode(params))
    out = []
    for h in d.get("hits", []):
        vids = h.get("videos", {})
        f = next((vids[k] for k in ("large", "medium", "small") if vids.get(k, {}).get("url")), None)
        if not f:
            continue
        out.append({"source": "pixabay", "id": f"pixabay:{h['id']}", "title": h.get("tags", ""),
                    "page": h.get("pageURL"), "url": f["url"], "width": f.get("width"), "height": f.get("height"),
                    "duration": h.get("duration"), "license": "Pixabay Content License",
                    "license_url": "https://pixabay.com/service/license-summary/",
                    "author": h.get("user"), "attribution_required": False})
    return out


SOURCES = {"commons": src_commons, "archive": src_archive, "pexels": src_pexels, "pixabay": src_pixabay}


def strip_html(s):
    import re
    return re.sub(r"<[^>]+>", "", s or "").strip()


def cmd_search(a):
    results, errors = [], {}
    for name in a.sources.split(","):
        try:
            results += SOURCES[name.strip()](a.query, a)
        except Blocked as e:
            errors[name] = str(e)
        except KeyError:
            errors[name] = "unknown source"
    def keep(r):
        d = r.get("duration")
        if d is not None and not (a.min_sec <= float(d) <= a.max_sec):
            return False
        if a.orientation and r.get("width") and r.get("height"):
            portrait = r["height"] > r["width"]
            if portrait != (a.orientation == "portrait"):
                return False
        return bool(r.get("url"))
    results = [r for r in results if keep(r)]
    # prefer HD, then shorter (more likely to be all action)
    results.sort(key=lambda r: (-(min(r.get("width") or 0, r.get("height") or 0) >= 720), r.get("duration") or 999))
    results = results[: a.limit * len(a.sources.split(","))]
    out = {"query": a.query, "results": results, "errors": errors}
    if a.out:
        json.dump(out, open(a.out, "w"), indent=2)
    print(json.dumps({"n": len(results), "errors": errors,
                      "results": [{k: r.get(k) for k in ("id", "title", "duration", "width", "height", "license", "author", "page")}
                                  for r in results]}, indent=2))
    if not results and errors:
        sys.exit(2)


def cmd_fetch(a):
    res = {r["id"]: r for r in json.load(open(a.from_))["results"]}
    os.makedirs(a.outdir, exist_ok=True)
    cred_path = os.path.join(a.outdir, "CREDITS.json")
    credits = json.load(open(cred_path)) if os.path.exists(cred_path) else []
    for cid in a.ids:
        r = res.get(cid)
        if not r:
            print(f"  unknown id {cid}", file=sys.stderr)
            continue
        ext = os.path.splitext(urllib.parse.urlparse(r["url"]).path)[1] or ".mp4"
        dst = os.path.join(a.outdir, cid.replace(":", "_") + ext)
        req = urllib.request.Request(r["url"], headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=120, context=ssl_ctx()) as resp, open(dst, "wb") as fh:
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    fh.write(chunk)
        except (urllib.error.URLError, OSError) as e:
            print(f"  download failed for {cid}: {getattr(e, 'reason', e)}", file=sys.stderr)
            continue
        attribution = (f"\"{r['title']}\" by {r.get('author') or 'unknown'} ({r['license']}), {r['page']}")
        credits = [c for c in credits if c["id"] != cid] + [{**{k: r.get(k) for k in (
            "id", "source", "title", "page", "url", "license", "license_url", "author", "attribution_required")},
            "file": dst, "attribution": attribution}]
        print(f"  {cid} -> {dst}")
    json.dump(credits, open(cred_path, "w"), indent=2)
    need = [c["attribution"] for c in credits if c.get("attribution_required")]
    if need:
        print("Attribution required in the post caption/description:\n  " + "\n  ".join(need))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("scan"); p.add_argument("paths", nargs="+")
    p.add_argument("--top", type=int, default=15); p.add_argument("--window", type=float, default=4.0)
    p.add_argument("--min-dur", type=float, default=2.0); p.add_argument("--sheets"); p.add_argument("--out")
    p.set_defaults(fn=cmd_scan)
    p = sub.add_parser("search"); p.add_argument("query")
    p.add_argument("--sources", default="commons,archive,pexels,pixabay")
    p.add_argument("--limit", type=int, default=10); p.add_argument("--min-sec", type=float, default=2)
    p.add_argument("--max-sec", type=float, default=180); p.add_argument("--orientation", choices=["portrait", "landscape"])
    p.add_argument("--out"); p.set_defaults(fn=cmd_search)
    p = sub.add_parser("fetch"); p.add_argument("ids", nargs="+"); p.add_argument("--from", dest="from_", required=True)
    p.add_argument("--outdir", required=True); p.set_defaults(fn=cmd_fetch)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
