# Sun Ad Studio MCP — Claude Quick-Start & Handoff (`v0.4.0`)

## Server Summary
- **Path:** `/workspace/sun_ad_studio_mcp/server.py`
- **Version:** `0.4.0`
- **Total MCP Tools:** `39`
- **Unit Test Suite:** `16/16` passing (`python3 -m unittest discover -s /workspace/sun_ad_studio_mcp/tests -p "test_*.py" -v`)

## How to Test the New Modules in Claude

### 1. Mirroring Masterpieces Module (Cinema Movie Screenplays + Reference Film DNA + 19 Professional Camera Motions)
- **`list_reference_masterpieces`**: Inspect the 8 built-in reference masterpieces (*The Godfather*, *The Dark Knight*, *Toy Story*, *Inception*, *Parasite*, *Into the Spider-Verse*, *Whiplash*, *The Social Network*), any custom registered films, and all 19 professional cinematography camera moves.
- **`register_reference_masterpiece`**: Add any film title Fred wants to emulate (stores structural DNA, pacing cadence, character arc model, dialogue mechanics, thematic techniques, and signature camera motions with strict non-infringement guardrails).
- **`create_mirroring_masterpiece_screenplay`**: Generate a full cinema screenplay (`three_act_feature`, `five_act_dramatic`, or `eight_sequence_cinema`) with `INT./EXT.` scene headings, action lines, character cues, parentheticals, dialogue, transitions, character development arcs, world-building notes, and per-scene professional camera motions (`dolly_zoom`, `tracking_shot`, `crane_reveal`, `handheld_tension`, `locked_off_static`, `whip_pan`, `steadicam_oner`, `rack_focus`, `push_in`, `pull_back`, `orbit_shot`, `parallax_glide`, `dutch_angle`, `over_the_shoulder`, `point_of_view`, `aerial_drone`, `time_lapse`, `slow_motion`, `speed_ramp`). Writes a `.fountain` screenplay file to `data/screenplays/{project_id}/`.
- **`list_mirroring_masterpiece_screenplays`**: List saved screenplays for a project.
- **`assemble_mirroring_masterpiece_scenes`**: Break the screenplay (all scenes or specific `scene_numbers`) into video/image shots carrying each scene's `camera_motion` and `.srt` dialogue subtitles directly into `assemble_video_clips` to render an MP4 film.

### 2. Marketing Short Films Module (`30s–180s` Ad Spots, Brand Stories, Product Promos & Campaign Films)
- **`create_marketing_short_film`**: Build a 30-second to 3-minute marketing film with `hook_first_ordering`, `cta_placement` (`hook_mid_and_end`, `mid_and_end`, `end_card_only`, `persistent_lower_third`), `brand_voice`, `tone_controls`, `audience_targeting_notes`, and `platform_native_cuts` (`9:16` vertical social, `16:9` horizontal web, `1:1` square, `4:5` portrait).
- **`list_marketing_short_films`**: List saved marketing short films.
- **`assemble_marketing_short_film`**: Render any platform cut (`cut_aspect_ratio='9:16'` for vertical social or `'16:9'` for horizontal web) into an MP4 with captions and camera motion filters via `assemble_video_clips`.

### 3. Storytelling Short Films Module (`60s–300s` Narrative Shorts)
- **`create_short_film`**, **`list_short_films`**, **`assemble_short_film`**.

### 4. Multi-Clip Video & Still-Image Assembler + Pixar Problem-Solution Script Creator
- **`assemble_video_clips`**: Chains any mix of video clips and still images (`all_video`, `all_image`, or `mixed_image_and_video`) with variable durations, per-clip `camera_motion`, and FFmpeg `xfade`/`acrossfade` transitions.
- **`create_pixar_problem_solution_script`**: 4-act Pixar-style character problem-and-solution script generator.
