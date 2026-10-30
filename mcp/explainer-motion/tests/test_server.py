import asyncio, json, os, shutil, subprocess

import pytest

from explainer_motion import auth, catalog, paths, render, server


@pytest.fixture(autouse=True)
def work(tmp_path, monkeypatch):
    checks = tmp_path / "checks.md"
    shutil.copy(paths.BUNDLED / "checks.md", checks)
    monkeypatch.setenv("EXPLAINER_WORKDIR", str(tmp_path))
    monkeypatch.setenv("EXPLAINER_CHECKS", str(checks))
    return tmp_path


def test_catalog_has_every_board_and_files_exist():
    boards, notes = catalog.load()
    assert len(boards) == 74 and notes
    for b in boards:
        assert (paths.library() / "boards" / b.file).exists(), b.file
        assert b.say_when


@pytest.mark.parametrize("line, want", [
    ("it went from 10 to 40 percent before and after the fix", "C111Slope.html"),
    ("people think this, but everyone thinks wrong", "H144MythFact.html"),
    ("step one, step two", "D53Steps.html"),
    ("where these overlap", "D50Venn.html"),
])
def test_search_finds_the_board_for_a_spoken_line(line, want):
    assert want in [b["file"] for b in catalog.search(line, limit=3)]


def test_match_script_and_group_filter():
    out = server.match_script(["the total is made of three parts", "hello"])
    assert out[0]["boards"] and out[0]["boards"][0]["file"] == "C109Stacked.html"
    assert all(b["group"] == "Charts" for b in server.search_boards("compared", group="charts", limit=10))


def test_board_and_guides_load():
    assert "<html" in server.get_board("D44Line").lower()
    for topic in server.GUIDES:
        assert server.get_guide(topic)
    with pytest.raises(ValueError):
        server.get_guide("nope")


def test_paths_stay_inside_workdir(work):
    with pytest.raises(ValueError):
        paths.user_path("/etc/passwd")
    with pytest.raises(ValueError):
        paths.user_path("../../outside.txt")
    assert paths.user_path("a/b.json") == work / "a" / "b.json"
    with pytest.raises(ValueError):
        server.save_board("../evil.html", "<html></html>")


def test_add_check_appends_rule():
    server.add_check("keep chart labels at 32 px", "dont", "D43Bars")
    assert server.get_checks().rstrip().endswith("- DON'T: keep chart labels at 32 px (D43Bars)")
    with pytest.raises(ValueError):
        server.add_check("x", "MAYBE")


def test_write_timeline_validates(work):
    res = server.write_timeline([{"board": "D44Line", "start": 0, "end": 4},
                                 {"board": "C111Slope", "start": 5, "end": 30}])
    assert json.loads((work / "timeline.json").read_text())[1]["board"] == "C111Slope"
    assert res["gaps"][0]["gap_seconds"] == 1 and res["long_boards_check_nothing_sits_still"]
    with pytest.raises(ValueError):
        server.write_timeline([{"board": "D44Line", "start": 0, "end": 4}, {"board": "D50Venn", "start": 3, "end": 6}])
    with pytest.raises(FileNotFoundError):
        server.write_timeline([{"board": "missing.html", "start": 0, "end": 1}])


def test_plan_frames_have_no_drift():
    frames = render.plan([{"board": "D44Line", "start": 0, "end": 1.01}, {"board": "D50Venn", "start": 1.01, "end": 2}],
                         0, 30, paths.workdir())
    assert len(frames) == 60 and frames[29][0].name == "D44Line.html" and frames[30][0].name == "D50Venn.html"
    assert abs(frames[30][1] - (30 / 30 - 1.01)) < 1e-9          # the next board's clock starts at its own start


def test_auth_rejects_without_token():
    seen = []

    async def app(scope, receive, send):
        seen.append(scope["path"])

    async def call(header):
        sent = []
        async def send(m): sent.append(m)
        scope = {"type": "http", "path": "/mcp", "headers": [(b"authorization", header)] if header else []}
        await auth.require_token(app, {"s3cret"})(scope, None, send)
        return sent

    assert asyncio.run(call(None))[0]["status"] == 401
    assert asyncio.run(call(b"Bearer wrong"))[0]["status"] == 401
    assert asyncio.run(call(b"Bearer s3cret")) == [] and seen == ["/mcp"]


chromium = pytest.mark.skipif(not os.environ.get("EXPLAINER_CHROMIUM") and not shutil.which("chromium"),
                              reason="set EXPLAINER_CHROMIUM to run browser tests")


@chromium
def test_preview_and_render(work):
    png = render.preview(paths.board_path("D44Line"), 2.0)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    res = render.render(render.plan(paths.board_path("D50Venn"), 1.0, 30), work / "venn.mp4", workers=2,
                        part_seconds=0.5)
    assert res["ok"] and res["frames_written"] == 30
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                          str(work / "venn.mp4")], capture_output=True, text=True).stdout
    assert abs(float(dur) - 1.0) < 0.05
