"""Build "The Shoebox", a 60-second animated short for LegacyReady Family, with Sun Ad Studio MCP.

Usage: python3 build.py WORK_DIR OUTPUT_MP4

Draws the eight keyframes (scenes.py), saves the film with create_short_film, writes captions
timed to each shot, and renders a 1920x1080 MP4 with assemble_video_clips. Runs locally at $0.00:
no paid render APIs are called.
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'sun_ad_studio_mcp'))
sys.path.insert(0, str(HERE))
from server import Studio, assembled_duration  # noqa: E402
import scenes  # noqa: E402

TRANSITION = 0.5
# (act, shot type, camera motion, seconds, visual prompt, captions as (start, end, text) relative to the shot)
SHOTS = [
    ('Act I: The Shoebox', 'Attic wide', 'crane_reveal', 7.5,
     'Dusty attic, a shaft of window light, a girl lifts a sepia photo from an open shoebox.',
     [(0.6, 6.8, 'Maya: “Grandma… who’s this?”')]),
    ('Act I: The Fuzzy Memory', 'Medium close-up', 'push_in', 8.0,
     'Grandma Rose squints at the photo; a thought bubble of half-remembered names.',
     [(0.6, 4.0, 'Grandma Rose: “That’s your great-great-grandpa…”'),
      (4.1, 7.4, '“Elijah? Or was it Eli?”')]),
    ('Act II: The Story Fades', 'Insert, magical', 'dolly_zoom', 7.5,
     'The photo fades at one edge; letters of his name drift away like dust.',
     [(0.6, 3.9, 'When nobody writes it down…'), (4.0, 6.9, '…the story starts to fade.')]),
    ('Act II: The Search', 'Over the shoulder', 'over_the_shoulder', 8.5,
     'Maya and Grandma at a glowing tablet: LegacyReady ancestry search with name, place, and years.',
     [(0.6, 4.3, 'Maya: “Let’s search for him.”'),
      (4.4, 7.9, '“Name, place, years… Charleston, 1870 to 1920.”')]),
    ('Act III: The Leads', 'Wide, magical', 'parallax_glide', 8.5,
     'A newspaper clipping, a photo, and a land-patent map rise out of the tablet, each tagged with its source.',
     [(0.6, 4.1, 'Grandma Rose: “That’s his land!”'),
      (4.2, 7.9, 'Maya: “It’s a lead. Let’s save it with the source.”')]),
    ('Act III: The Timeline', 'Tracking wide', 'tracking_shot', 8.0,
     'A string of lights becomes a family timeline: born, land patent, married, moved north. A private lock badge.',
     [(0.6, 4.1, 'Relatives, milestones, sources, and stories…'),
      (4.2, 7.4, '…saved together in one private place.')]),
    ('Act IV: The Family Table', 'Wide, warm', 'pull_back', 7.5,
     'Family dinner under Elijah’s portrait, now in colour; a booklet titled The Story of Elijah Carter.',
     [(0.6, 3.9, 'Maya: “Now everyone knows who he was.”'),
      (4.0, 6.9, 'Grandma Rose: “And nobody has to guess again.”')]),
    ('End Card', 'Title card', 'locked_off_static', 8.0,
     'LegacyReady Family. Search for your ancestors. Preserve your family’s story. Start free, no credit card.',
     []),
]


def srt_time(t):
    ms = round(t * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def main(work, output):
    work.mkdir(parents=True, exist_ok=True)
    frames = work / 'frames'
    frames.mkdir(exist_ok=True)
    for i, draw in enumerate(scenes.SCENES, 1):
        svg = frames / f'scene_{i}.svg'
        svg.write_text(draw(), encoding='utf-8')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(svg), '-frames:v', '1', str(frames / f'scene_{i}.png')],
                       check=True)

    studio = Studio(work / 'studio.sqlite3')
    brand = studio.call('save_brand', dict(
        name='LegacyReady Family',
        facts=('Free private ancestry search of Library of Congress newspapers, photographs, maps, and manuscripts, '
               'plus a guided BLM land-record worksheet. Save finds with citations in a private Family History '
               'Center: relatives, timeline, sources, and family stories. Free account, no credit card required.'),
        audience='Families who want to learn about and preserve their ancestors’ stories',
    ))
    project = studio.call('create_project', dict(
        brand_id=brand['id'], offer='Start your ancestry search free', format='video',
        destination='https://www.legacyreadyfamily.com', request_key='the-shoebox',
    ))
    film = studio.call('create_short_film', dict(
        project_id=project['id'],
        title='The Shoebox',
        logline='A girl finds an unnamed photo in Grandma’s attic, and together they search for the ancestor before his story fades.',
        genre='Animated family short',
        target_duration_seconds=60.0,
        aspect_ratio='16:9',
        product_or_theme_integration='LegacyReady Family ancestry search and Family History Center',
        characters=[
            {'name': 'Maya', 'role': 'protagonist',
             'visual_dna': 'Curious 10-year-old Black girl, two big hair puffs, bright yellow shirt, blue jeans'},
            {'name': 'Grandma Rose', 'role': 'co-star',
             'visual_dna': 'Warm Black grandmother, silver bun, round gold glasses, teal cardigan, pearl necklace'},
        ],
        acts=[{
            'act': act, 'shot_type': shot_type, 'camera_motion': motion, 'duration_seconds': seconds,
            'media_type': 'image', 'media_path': str(frames / f'scene_{i}.png'), 'visual_prompt': prompt,
            'dialogue_or_narration': ' '.join(c[2] for c in cues) or 'LegacyReady Family. Start free.',
            'transition_out': 'none' if i == len(SHOTS) else ('fade' if i == len(SHOTS) - 1 else 'dissolve'),
        } for i, (act, shot_type, motion, seconds, prompt, cues) in enumerate(SHOTS, 1)],
    ))

    # Each shot starts where the previous one ends, minus the transition overlap.
    lines, start, n = [], 0.0, 1
    for _, _, _, seconds, _, cues in SHOTS:
        for a, b, words in cues:
            lines += [str(n), f'{srt_time(start + a)} --> {srt_time(start + b)}', words, '']
            n += 1
        start += seconds - TRANSITION
    srt = work / 'the_shoebox.srt'
    srt.write_text('\n'.join(lines), encoding='utf-8')

    assembly = studio.call('assemble_video_clips', dict(
        project_id=project['id'], clips=film['assembly_clips_spec'], aspect_ratio='16:9', transition_type='dissolve',
        transition_duration_seconds=TRANSITION, srt_caption_path=str(srt), full_resolution=True,
        execute_render=True,
    ))
    expected = assembled_duration([s[3] for s in SHOTS], TRANSITION)
    print(f"rendered {assembly['resolution']} {assembly['total_output_duration_seconds']}s (expected {expected}s), "
          f"captions burned in: {assembly['captions_burned_in']}, placeholders: {assembly['placeholder_clip_count']}, "
          f"camera moves: {', '.join(assembly['camera_motions_applied'])}")
    # The assembler encodes for speed; re-encode once for a small, web-ready file.
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', assembly['output_mp4_path'], '-c:v', 'libx264',
                    '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
                    '-movflags', '+faststart', str(output)], check=True)
    shutil.copyfile(srt, output.with_suffix('.srt'))
    print(f'film saved to {output}')


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
