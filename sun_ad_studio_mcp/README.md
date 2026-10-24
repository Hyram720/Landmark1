# Sun Ad Studio MCP (`v0.4.1`)

A dependency-free Python Model Context Protocol (MCP) server for **Sun Marketing Enterprises LLC** (`SunCustomDesigns`, `LegacyReady Family`, `Hustle Vault`, `Credit Ledger`, and `Landmark Agency Group`).

## Core Modules (`39` MCP Tools Total)

1. **Brand Fact Extraction, Copy Revisions & Higgsfield Render Lifecycle (`20` tools from `v0.2.0`)**
   - `studio_status`, `save_brand`, `list_brands`, `extract_website_facts`, `create_project`, `list_projects`, `get_project`, `creative_brief`, `save_copy`, `approve_start_image`, `prepare_render_handoff`, `submit_render_job`, `check_render_job`, `save_hook_seed`, `pull_hook_seeds`, `vibe_direct_brief`, `queue_batch_handoffs`, `record_winner_feedback`, `render_static_svg`, `export_project`.
2. **One-Shot Multi-Clip Video & Still-Image Assembler (`assemble_video_clips`)**
   - Chains variable-length video clips (`10s + 10s + 10s` or mixed lengths) and still images (`.png`, `.jpg`, `.webp` with default or per-item hold durations) in **`all_video`**, **`all_image`**, or **`mixed_image_and_video`** order into one unified MP4 with per-scene professional camera motion FFmpeg filters and smooth `xfade` / `acrossfade` transitions.
3. **Pixar-Style Character Problem-and-Solution Short Script Creator (`create_pixar_problem_solution_script`)**
   - Generates 4-act expressive character scripts (`Problem Hook` -> `Escalation` -> `Hero Solution` -> `Joyful Transformation & CTA`) with Subject Lock registration and Higgsfield clip prompts.
4. **Storytelling Short Films Module (`create_short_film`, `list_short_films`, `assemble_short_film`)**
   - Dedicated section for 1-to-5-minute (`60s–300s`) narrative short films with multi-act scene breakdown, shot lists, dialogue/narration, persistent character locks across scenes, `.srt`/`.vtt` captions, and single-shot film assembly.
5. **Marketing Short Films Module (`create_marketing_short_film`, `list_marketing_short_films`, `assemble_marketing_short_film`)**
   - Separate module for marketing-focused short films (`30s–180s` / 30-second to 3-minute ad-style narrative spots, brand stories, product promos, and campaign films) featuring hook-first scene ordering, configurable CTA placement (`hook_mid_and_end`, `mid_and_end`, `end_card_only`, `persistent_lower_third`), brand voice and tone controls, audience targeting notes, and platform-native cuts (`9:16` vertical social, `16:9` horizontal web, `1:1` square, `4:5` portrait).
6. **Mirroring Masterpieces Module (`register_reference_masterpiece`, `list_reference_masterpieces`, `create_mirroring_masterpiece_screenplay`, `list_mirroring_masterpiece_screenplays`, `assemble_mirroring_masterpiece_scenes`)**
   - Official module for cinema-style full-length narrative movie screenplays mirroring the storytelling DNA of critically acclaimed and commercially successful films (built-in catalog includes *The Godfather*, *The Dark Knight*, *Toy Story*, *Inception*, *Parasite*, *Spider-Man: Into the Spider-Verse*, *Whiplash*, and *The Social Network*, plus custom reference registration) without copying protected expression.
   - Features industry-standard screenplay formatting (`INT./EXT.` sluglines, action lines, centered character names, parentheticals, dialogue, transitions `CUT TO:` / `MATCH CUT TO:` / `SMASH CUT TO:` / `DISSOLVE TO:` / `FADE OUT.`, exported to `.fountain`), multi-act structure (`three_act_feature`, `five_act_dramatic`, `eight_sequence_cinema`), character development arcs, world-building notes, and **19 professional cinematography camera motions per scene** (`dolly_zoom`, `tracking_shot`, `crane_reveal`, `handheld_tension`, `locked_off_static`, `whip_pan`, `steadicam_oner`, `rack_focus`, `push_in`, `pull_back`, `orbit_shot`, `parallax_glide`, `dutch_angle`, `over_the_shoulder`, `point_of_view`, `aerial_drone`, `time_lapse`, `slow_motion`, `speed_ramp`) that carry directly into `assemble_video_clips`.
7. **12-Platform Competitive Parity Tools (`register_subject_ingredient`, `list_subject_ingredients`, `build_storyboard_timeline`, `generate_captions_and_vo_timing`, `plan_multiratio_safe_zones`, `compare_video_engines`)**

## Running Tests

```bash
python3 -m unittest discover -s sun_ad_studio_mcp/tests -p "test_*.py" -v
```

Run from the repository root. All **21/21 unit tests** pass offline with `$0.00` paid API spend (requires `ffmpeg` with libass on `PATH`).
