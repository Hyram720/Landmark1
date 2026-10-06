# tiktok-sports-editor

A Claude Code plugin that turns raw sports footage into vertical TikTok clips built for retention, and
writes the post to go with each clip.

## What you get

| Piece | What it does |
|---|---|
| `/sports-clip <video> [angle]` | End-to-end edit: find the moment → hook → 9:16 reframe → slow-mo replay → captions → render → post package |
| `/tiktok-post-plan <clip>` | Hooks, caption, hashtags, sound advice, and posting window for a clip |
| `highlight-scout` agent | Sifts long games or many files and ranks the most TikTok-worthy moments with timestamps |
| `tiktok-sports-editing` skill | The editing playbook plus two ffmpeg scripts (it also triggers automatically when you ask to edit sports clips) |

The scripts:
- `analyze_footage.py`: finds highlight candidates from crowd/commentary audio spikes and scene cuts
- `render_edit.py`: renders a JSON edit plan to a 1080x1920 MP4 with a blurred-background or crop
  reframe, speed ramps, punch-in zooms, hook text, safe-zone captions, an optional music bed, −14 LUFS
  loudness, and a cover frame

## Requirements
`python3` (3.8+) and `ffmpeg`/`ffprobe` built with libass (standard on most distributions and in Homebrew).

## Install
```
/plugin marketplace add hyram720/landmark1
/plugin install tiktok-sports-editor@landmark-plugins
```

## Example
```
/sports-clip ~/Videos/varsity_vs_central.mp4 "#23's fourth-quarter block"
```

## Rights
The plugin is built for footage you filmed or have permission to use. It will not help disguise
copyrighted broadcast footage to get around platform detection.
