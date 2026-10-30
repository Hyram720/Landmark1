"""Frame-exact export of HTML boards to MP4, adapted from tools/export.py in sirioberati/YouTube-AI-Motion-Graphics (MIT).

Chrome opens each board, every animation is paused and moved to the exact time of each frame (a virtual clock, so no
frame is dropped the way a screen recording drops them), each frame is screenshotted, parts are encoded as MKV (a
stopped MKV can still be opened and resumed), then FFmpeg joins the parts with the voice and the frame count is checked.
"""
import json, os, shutil, subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import paths

W, H = 1920, 1080
SEEK = """t => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
  if (window.seek) window.seek(t);
  if (window.gsap) { gsap.globalTimeline.pause(); gsap.globalTimeline.seek(t, false); }
  document.querySelectorAll('video').forEach(v => { v.pause(); if (v.duration) v.currentTime = t % v.duration; }); }"""


def _launch(p):
    exe = os.environ.get("EXPLAINER_CHROMIUM")
    return p.chromium.launch(**({"executable_path": exe} if exe else {}), args=["--no-sandbox"])


def _open(pg, board: Path):
    pg.goto(board.as_uri())
    pg.wait_for_load_state("networkidle")
    pg.evaluate("document.fonts.ready")


def resolve_timeline(entries: list[dict], base: Path) -> list[tuple[Path, float, float]]:
    """Check a timeline and turn every board reference into a file path."""
    out, last_end = [], 0.0
    for i, k in enumerate(entries):
        ref, s, e = k["board"], float(k["start"]), float(k["end"])
        if e <= s:
            raise ValueError(f"entry {i} ({ref}): end {e} must be after start {s}")
        if s < last_end - 1e-6:
            raise ValueError(f"entry {i} ({ref}) starts at {s}, before the previous board ends at {last_end}")
        try:
            p = paths.board_path(ref)
        except FileNotFoundError:
            p = paths.user_path(str(base / ref), must_exist=True)
        out.append((p, s, e))
        last_end = e
    return out


def plan(src: Path | list, seconds: float, fps: int, base: Path | None = None) -> list[tuple[Path, float]]:
    """Every frame of the output as (board, time on that board's own clock)."""
    if isinstance(src, list):
        frames = []
        for p, s, e in resolve_timeline(src, base or paths.workdir()):
            frames += [(p, f / fps - s) for f in range(round(s * fps), round(e * fps))]  # rounded globally: no drift
        return frames
    return [(src, f / fps) for f in range(round(seconds * fps))]


def preview(board: Path, t: float) -> bytes:
    """One PNG frame of a board at time t seconds."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = _launch(p)
        pg = b.new_page(viewport={"width": W, "height": H})
        _open(pg, board)
        pg.evaluate(SEEK, max(0.0, t))
        pg.wait_for_timeout(30)
        png = pg.screenshot()
        b.close()
    return png


def _part(job):
    from playwright.sync_api import sync_playwright
    idx, frames, fps, tmp, done = job
    out = tmp / f"part{idx:03d}.mkv"
    if out.exists():
        return out                                           # resume: finished parts are kept
    fdir = tmp / f"f{idx:03d}"
    fdir.mkdir(exist_ok=True)
    with sync_playwright() as p:
        b = _launch(p)
        pg = b.new_page(viewport={"width": W, "height": H})
        cur = None
        for i, (board, t) in enumerate(frames):
            if board != cur:
                _open(pg, board)
                cur = board
            pg.evaluate(SEEK, max(0.0, t))
            pg.wait_for_timeout(5)
            pg.screenshot(path=str(fdir / f"{i:06d}.png"))
        b.close()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-i", str(fdir / "%06d.png"),
                    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-g", "15",
                    "-r", str(fps), str(out)], check=True)
    shutil.rmtree(fdir)
    done(len(frames))
    return out


def render(frames: list, out: Path, audio: Path | None = None, fps: int = 30, workers: int = 4,
           part_seconds: float = 20, progress=lambda n: None) -> dict:
    """Render planned frames to out (.mp4). Returns the frame check."""
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.stem + "-parts")
    tmp.mkdir(exist_ok=True)
    n = max(1, round(part_seconds * fps))
    jobs = [(i, frames[s:s + n], fps, tmp, progress) for i, s in enumerate(range(0, len(frames), n))]
    with ThreadPoolExecutor(workers) as ex:
        parts = list(ex.map(_part, jobs))

    lst = tmp / "list.txt"
    lst.write_text("".join(f"file '{p.resolve()}'\n" for p in parts))
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst)]
    if audio:
        cmd += ["-i", str(audio), "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "256k", "-shortest"]
    subprocess.run(cmd + ["-c:v", "copy", "-movflags", "+faststart", str(out)], check=True)

    got = int(subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries",
                              "stream=nb_read_packets", "-of", "csv=p=0", str(out)],
                             capture_output=True, text=True).stdout.strip() or 0)
    ok = got == len(frames) or (audio is not None and 0 < got <= len(frames))
    if ok:
        shutil.rmtree(tmp)
    return {"ok": ok, "frames_written": got, "frames_planned": len(frames), "seconds": len(frames) / fps,
            "out": str(out), "parts_kept_for_resume": None if ok else str(tmp)}


def load_timeline(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))
