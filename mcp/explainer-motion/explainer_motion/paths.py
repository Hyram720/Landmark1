"""Where the board library lives, where the user's files live, and keeping every path inside them.

EXPLAINER_LIBRARY  folder with boards/, skills/, prompts/, checks.md (default: the bundled library/)
EXPLAINER_WORKDIR  folder the tools may read audio from and write timelines/videos to (default: current dir)
EXPLAINER_CHECKS   checks file that add_check writes to (default: <library>/checks.md)
"""
import os
from pathlib import Path

BUNDLED = Path(__file__).resolve().parent.parent / "library"


def library() -> Path:
    return Path(os.environ.get("EXPLAINER_LIBRARY", BUNDLED)).resolve()


def workdir() -> Path:
    return Path(os.environ.get("EXPLAINER_WORKDIR", os.getcwd())).resolve()


def checks_file() -> Path:
    return Path(os.environ.get("EXPLAINER_CHECKS", library() / "checks.md")).resolve()


def _inside(p: Path, root: Path) -> bool:
    return p == root or root in p.parents


def user_path(raw: str, *, must_exist: bool = False) -> Path:
    """Resolve a user-supplied path against the workdir and refuse anything outside the workdir or library."""
    p = Path(raw)
    p = (p if p.is_absolute() else workdir() / p).resolve()
    if not (_inside(p, workdir()) or _inside(p, library())):
        raise ValueError(f"{raw} is outside the work folder ({workdir()}). Set EXPLAINER_WORKDIR to allow it.")
    if must_exist and not p.exists():
        raise FileNotFoundError(f"{raw} does not exist (looked at {p})")
    return p


def board_path(ref: str) -> Path:
    """'D44Line', 'D44Line.html' or 'boards/D44Line.html' -> the library board; anything else -> a user file."""
    name = ref if ref.endswith(".html") else ref + ".html"
    lib = library() / "boards" / Path(name).name
    if lib.exists() and ("/" not in ref or ref.startswith("boards/")):
        return lib
    return user_path(ref, must_exist=True)
