"""Explainer Motion MCP server: animated explainer boards for YouTube, synced to your voice.

Tools find the right board for a spoken line, hand Claude the design rules and the board HTML to adapt, preview frames,
transcribe the voice word by word, write the timeline, and render a frame-exact MP4.
"""
import json, threading, time, uuid
from pathlib import Path

import anyio

try:                                                        # mcp >= 2
    from mcp.server.mcpserver import MCPServer as Server, Image
except ImportError:                                         # mcp 1.x
    from mcp.server.fastmcp import FastMCP as Server, Image

from . import catalog, paths, render

SYS = "skills/explainer-board-system"
GUIDES = {
    "overview": f"{SYS}/SKILL.md",
    "tokens": f"{SYS}/references/tokens.md",
    "layout": f"{SYS}/references/layout.md",
    "components": f"{SYS}/references/components.md",
    "charts": f"{SYS}/references/charts.md",
    "motion": f"{SYS}/references/motion.md",
    "do-dont": f"{SYS}/references/do-dont.md",
    "qa": f"{SYS}/references/qa-handoff.md",
    "catalog": catalog.CATALOG,
    "css": f"{SYS}/assets/brand.css",
    "brief": "skills/explainer-board-brief/SKILL.md",
    "brief-template": "skills/explainer-board-brief/references/brief-template.md",
    "board-types": "skills/explainer-board-brief/references/board-types.md",
    "brief-example": "skills/explainer-board-brief/references/worked-example.md",
    "sync": "skills/board-sync/SKILL.md",
    "sync-rules": "skills/board-sync/references/rules.md",
    "troubleshooting": "skills/board-sync/references/troubleshooting.md",
}

mcp = Server(
    "explainer-motion",
    instructions=(
        "Animated explainer boards (1920x1080 HTML + CSS/GSAP) for YouTube videos, synced to the voice. "
        "Workflow: transcribe the voice -> plan which lines need a board (get_guide 'brief') -> search_boards for each "
        "line -> get_board and adapt it using get_guide 'tokens'/'motion' and get_checks -> preview_frame to check it "
        "-> write_timeline -> render_video (check the first 60 s before the full render). Rules: keep the bottom-right "
        "camera box empty, every readable word >= 28 px, one idea per board, never invent data, nothing still for more "
        "than 5 s. When the user corrects a board, call add_check so the fix is never repeated."),
)

_jobs: dict[str, dict] = {}


def _read(rel: str) -> str:
    return (paths.library() / rel).read_text(encoding="utf-8")


@mcp.tool()
def search_boards(query: str, group: str | None = None, limit: int = 5) -> list[dict]:
    """Find the board template that fits a spoken line, e.g. 'it went from 10 to 40 percent' or 'X vs Y and the
    winner is'. Matches the catalog's 'say it when' tags. group narrows to one of: Diagrams, Charts, Component motion,
    Premium motion, Workflows and code, Story and comparisons."""
    return catalog.search(query, group, limit)


@mcp.tool()
def match_script(lines: list[str], per_line: int = 3) -> list[dict]:
    """Suggest boards for each line of a script or transcript at once. Use it while planning the board brief;
    lines with no match usually do not need a board (the voice alone carries them)."""
    return [{"line": l, "boards": [{k: b[k] for k in ("file", "name", "score")} for b in catalog.search(l, None, per_line)]}
            for l in lines]


@mcp.tool()
def list_boards(group: str | None = None) -> dict:
    """Every board in the library with what it is for, plus notes on which to keep when two do the same job."""
    boards, notes = catalog.load()
    return {"boards": [b.dict() for b in boards if not group or group.lower() in b.group.lower()],
            "same_job": notes}


@mcp.tool()
def get_board(board: str) -> str:
    """The HTML source of a board template (e.g. 'D44Line'), to adapt for a new line: keep the layout and motion,
    change the words and data. Assets are referenced as assets/<file> next to the board."""
    return paths.board_path(board).read_text(encoding="utf-8")


@mcp.tool()
def get_guide(topic: str) -> str:
    """Design-system and workflow guides. Topics: overview, tokens, layout, components, charts, motion, do-dont, qa,
    catalog, css, brief, brief-template, board-types, brief-example, sync, sync-rules, troubleshooting."""
    if topic not in GUIDES:
        raise ValueError(f"unknown topic {topic!r}; pick one of: {', '.join(GUIDES)}")
    return _read(GUIDES[topic])


@mcp.tool()
def get_checks() -> str:
    """The user's checks file: every DO and DON'T learned from past corrections. Read it before building any board
    and check every board against it before export."""
    return paths.checks_file().read_text(encoding="utf-8")


@mcp.tool()
def add_check(rule: str, kind: str = "DO", board: str | None = None) -> str:
    """Save a correction as a permanent rule in the checks file. kind is DO or DON'T; board names the board that
    taught it. Call this every time the user fixes something on a board."""
    kind = kind.upper().replace("DONT", "DON'T")
    if kind not in ("DO", "DON'T"):
        raise ValueError("kind must be DO or DON'T")
    line = f"- {kind}: {rule.strip()}" + (f" ({board})" if board else "") + "\n"
    f = paths.checks_file()
    text = f.read_text(encoding="utf-8")
    f.write_text(text + ("" if text.endswith("\n") else "\n") + line, encoding="utf-8")
    return f"Added to {f.name}: {line.strip()}"


@mcp.tool()
def save_board(path: str, html: str) -> str:
    """Write a new or adapted board HTML into the work folder (e.g. 'boards/01-intro.html'). Copy any assets/ files
    it needs next to it."""
    p = paths.user_path(path)
    if p.suffix != ".html":
        raise ValueError("boards are .html files")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(html, encoding="utf-8")
    return str(p)


@mcp.tool()
async def preview_frame(board: str, t: float = 2.0) -> Image:
    """Render one 1920x1080 frame of a board at t seconds on its own clock, to look at it before rendering video.
    Check the camera box, text size, overlaps and the checks file."""
    p = paths.board_path(board)
    png = await anyio.to_thread.run_sync(render.preview, p, t)
    return Image(data=png, format="png")


@mcp.tool()
async def transcribe(audio: str, out: str | None = None, model: str = "base", language: str | None = None) -> dict:
    """Transcribe the voiceover with faster-whisper, word by word with timestamps, and save it as JSON
    (default <audio>.words.json). Returns the lines; the file also has every word's start and end."""
    from .transcribe import transcribe as run
    a = paths.user_path(audio, must_exist=True)
    o = paths.user_path(out) if out else a.with_suffix(".words.json")
    data = await anyio.to_thread.run_sync(lambda: run(a, o, model, language))
    return {"saved": str(o), "duration": data["duration"], "words": len(data["words"]), "lines": data["lines"]}


@mcp.tool()
def write_timeline(entries: list[dict], out: str = "timeline.json") -> dict:
    """Check and save the board timeline: a list of {"board", "start", "end"} in seconds on the audio. board is a
    library board name or a path in the work folder. Boards must not overlap."""
    p = paths.user_path(out)
    resolved = render.resolve_timeline(entries, p.parent)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(entries, indent=1), encoding="utf-8")
    gaps = [{"after": str(a[0].name), "gap_seconds": round(b[1] - a[2], 3)}
            for a, b in zip(resolved, resolved[1:]) if b[1] - a[2] > 0.05]
    long = [{"board": str(r[0].name), "seconds": round(r[2] - r[1], 2)} for r in resolved if r[2] - r[1] > 20]
    return {"saved": str(p), "boards": len(entries), "ends_at": resolved[-1][2] if resolved else 0,
            "gaps": gaps, "long_boards_check_nothing_sits_still": long}


@mcp.tool()
def render_video(src: str, out: str, audio: str | None = None, seconds: float = 8, first: float | None = None,
                 fps: int = 30, workers: int = 4) -> dict:
    """Start a frame-exact MP4 render in the background and return a job id (poll render_status). src is one board
    (rendered for `seconds`) or a timeline .json; audio is muxed on. Use first=60 to check the first minute before a
    full render. A 20-minute video takes roughly 30 minutes with 6 workers."""
    o = paths.user_path(out)
    a = paths.user_path(audio, must_exist=True) if audio else None
    if src.endswith(".json"):
        tl = paths.user_path(src, must_exist=True)
        frames = render.plan(render.load_timeline(tl), seconds, fps, tl.parent)
    else:
        frames = render.plan(paths.board_path(src), seconds, fps)
    if first:
        frames = frames[:round(first * fps)]
    if not frames:
        raise ValueError("nothing to render")
    job = {"id": uuid.uuid4().hex[:8], "status": "running", "done_frames": 0, "total_frames": len(frames),
           "started": time.time(), "result": None, "error": None}
    lock = threading.Lock()

    def progress(n):
        with lock:
            job["done_frames"] += n

    def run():
        try:
            job["result"] = render.render(frames, o, a, fps, max(1, min(workers, 16)), progress=progress)
            job["status"] = "done" if job["result"]["ok"] else "failed"
        except Exception as e:                              # reported through render_status
            job["status"], job["error"] = "failed", f"{type(e).__name__}: {e}"

    _jobs[job["id"]] = job
    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job["id"], "frames": len(frames), "seconds": len(frames) / fps, "out": str(o)}


@mcp.tool()
def render_status(job_id: str) -> dict:
    """Progress of a render_video job: running, done or failed, frames finished, and the result."""
    j = _jobs.get(job_id)
    if not j:
        raise ValueError(f"no render job {job_id}")
    return {**{k: v for k, v in j.items() if k != "started"}, "elapsed_seconds": round(time.time() - j["started"], 1)}


@mcp.resource("explainer://checks", mime_type="text/markdown")
def checks_resource() -> str:
    """The user's checks file."""
    return paths.checks_file().read_text(encoding="utf-8")


@mcp.resource("explainer://catalog", mime_type="text/markdown")
def catalog_resource() -> str:
    """The board catalog with 'say it when' tags."""
    return _read(catalog.CATALOG)


@mcp.prompt()
def explainer_video(audio: str) -> str:
    """Turn a voiceover into a synced explainer-board video."""
    return (f"Make animated explainer boards for the voiceover at {audio}.\n"
            "1. transcribe it word by word.\n"
            "2. Read get_guide('brief') and plan the boards: for each line ask 'can someone understand this just by "
            "listening?' Numbers, prizes, comparisons and lists of steps need a board. One idea per board. Show me "
            "the brief before building.\n"
            "3. For each board: search_boards with the spoken words, get_board, get_checks, and adapt it with "
            "get_guide('tokens') and get_guide('motion'). Every element enters on the word that names it; nothing "
            "still for more than 5 seconds. save_board it, then preview_frame to check it.\n"
            "4. write_timeline, then render_video with first=60 and show me before the full render.\n"
            "Whenever I correct something, add_check it.")


@mcp.prompt()
def restyle_library(references: str) -> str:
    """Restyle the board library in the user's own look."""
    return (f"Look at my references in {references}. Read get_guide('tokens') and get_guide('css'), then propose "
            "three style directions that combine my references into something that is mine (colours, fonts, shapes, "
            "motion feel). After I pick one, write the new tokens and brand.css, restyle a few boards with save_board "
            "keeping the layout and the motion, preview_frame them, and add every correction I make with add_check.")


def main():
    import argparse, os
    ap = argparse.ArgumentParser(prog="explainer-motion", description=__doc__)
    ap.add_argument("--http", action="store_true", help="serve over streamable HTTP instead of stdio")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    if not a.http:
        mcp.run()
        return
    import uvicorn
    from .auth import require_token
    tokens = {t.strip() for t in os.environ.get("EXPLAINER_MCP_TOKENS", "").split(",") if t.strip()}
    app = mcp.streamable_http_app()
    uvicorn.run(require_token(app, tokens) if tokens else app, host=a.host, port=a.port)


if __name__ == "__main__":
    main()
