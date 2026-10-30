"""Word-level transcript with faster-whisper (optional dependency: pip install 'explainer-motion[whisper]')."""
import json
from pathlib import Path


def transcribe(audio: Path, out: Path, model: str = "base", language: str | None = None) -> dict:
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise RuntimeError("faster-whisper is not installed. Run: pip install 'explainer-motion[whisper]'") from e
    segs, info = WhisperModel(model, device="auto", compute_type="auto").transcribe(
        str(audio), word_timestamps=True, language=language, vad_filter=True)
    words, lines = [], []
    for s in segs:
        lines.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()})
        words += [{"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for w in s.words or []]
    data = {"audio": str(audio), "language": info.language, "duration": round(info.duration, 3),
            "lines": lines, "words": words}
    out.write_text(json.dumps(data, indent=1), encoding="utf-8")
    return data
