"""The board catalog: parse board-catalog.md and find the right board for a spoken line."""
import re
from dataclasses import dataclass, asdict

from . import paths

CATALOG = "skills/explainer-board-system/references/board-catalog.md"
LINE = re.compile(r"^- `(?P<file>[^`]+\.html)` · \*\*(?P<name>[^*]+)\*\* · (?P<rest>.*)$")
STOP = set("a an the and or but of to in on for is it its this that these those with as at by be are was were "
           "i you we they he she my your our their me us so if then than just very really do does did not no "
           "from into out up how what which who when where why can will would should could have has had there "
           "here one".split())


@dataclass
class Board:
    file: str
    name: str
    group: str
    about: str
    say_when: str

    def dict(self):
        return asdict(self)


def words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9%$]+", text.lower()) if w not in STOP]


def load() -> tuple[list[Board], list[str]]:
    """Return (boards, 'same job' notes) from the library's catalog."""
    boards, notes, group = [], [], ""
    for raw in (paths.library() / CATALOG).read_text(encoding="utf-8").splitlines():
        if raw.startswith("## "):
            group = raw[3:].strip()
        elif m := LINE.match(raw):
            about, _, say = m["rest"].partition("say it when:")
            boards.append(Board(m["file"], m["name"].strip(), group, about.strip(" ·"), say.strip()))
        elif group == "Two boards, same job" and raw.startswith("- "):
            notes.append(raw[2:].strip())
    return boards, notes


def search(query: str, group: str | None = None, limit: int = 5) -> list[dict]:
    """Rank boards by how well their 'say it when' tags, name and description match the query."""
    boards, _ = load()
    q = set(words(query))
    phrase = query.lower()
    out = []
    for b in boards:
        if group and group.lower() not in b.group.lower():
            continue
        tags = re.findall(r"'([^']+)'", b.say_when)
        score = (3 * len(q & set(words(b.say_when))) + 2 * len(q & set(words(b.name)))
                 + len(q & set(words(b.about))))
        score += sum(4 for t in tags if t.lower().strip(".… ") and t.lower().strip(".… ") in phrase)
        if score:
            out.append((score, b))
    out.sort(key=lambda x: -x[0])
    return [dict(b.dict(), score=s) for s, b in out[:limit]]
