---
name: multi-provider-blending
description: Choose between and chain Krea 3, Higgsfield and Kie.ai through the krea3-studio MCP server: compare models side by side, route each job to the best or cheapest provider, and build pipelines such as Krea still to Higgsfield video. Use when the user asks which model is best, wants to compare, wants video from an image, mentions Higgsfield, Kie, Nano Banana, Kling, Seedance, Soul or Qwen, or wants to cut cost.
---

# Blending Krea 3, Higgsfield and Kie.ai

Tools: `list_providers`, `generate_image`, `compare_providers`, `animate_image`, `get_job`, `upload_image`.

Always start with `list_providers` to see which keys are set. Never pick a provider that is not configured.

## Who does what

| Job | First choice | Why |
|---|---|---|
| Precise edits, product kept intact, recolors, removals, multi-reference composites | **Krea 3** (`krea3_edit`, or `generate_image` with provider `krea`) | Fastest (<8s), cheapest ($0.03-0.06), changes only what you ask |
| Photoreal people / fashion editorial from text | **Higgsfield** Soul (`higgsfield-ai/soul/v2/standard`) | Strong photographic look |
| Alternative editor for a second opinion | Higgsfield Qwen Image 3 edit (`alibaba/qwen-image-3/edit`), Kie `nano-banana-pro` | Different model families fail differently |
| Long prompts, dense text, infographics | Kie `nano-banana-pro` | Good text rendering |
| Image to video | **Higgsfield** (`kling-video/o3/image-reference` default) or a Kie video model | Krea 3 does not make video |

Higgsfield and Kie host many more models. Any documented endpoint path (Higgsfield) or market model id (Kie) works through the `model` field, with model-specific fields in `extra`.

## Compare once, then commit

`compare_providers` runs the same prompt and images on every configured provider in parallel. Use it once per new style or campaign, rank the results (likeness, detail, prompt-following, artifacts), tell the user which won and why, then run the rest of the batch on the winner only. Comparing every image triples the cost.

## Pipelines

- **Still to video:** make the still with Krea 3 → pass its URL to `animate_image` with a motion prompt.
- **Generate then fix:** create with Higgsfield Soul or Kie → fix details with `krea3_edit` + `regional_edit: true`.
- **One upload, many models:** `upload_image` once (hosted on Krea or Higgsfield) and reuse the URL everywhere. Kie has no upload API here, so local files and attachments for Kie are hosted through Krea or Higgsfield automatically.

## Field differences the tools handle for you

- Krea: `image_urls`, `resolution` 1K/2K/4K, `thinking_mode`, `regional_edit`, `regions`.
- Higgsfield: `image_urls` (edits) or `image_url` (single-image video models: set `image_field: "image_url"`), resolution like `1k` or `720p`/`1080p`.
- Kie: `{model, input}`; Nano Banana Pro uses `image_input`, `aspect_ratio`, `resolution`.

If a provider returns a validation error, read the message, fix the field in `extra`, and retry once.

## Jobs and billing

- Long jobs (video, Krea `ultra`) may return `status: pending` with a `job_id`. Call `get_job` with the same `provider`; do not resubmit.
- Each provider bills separately: Krea per image, Higgsfield and Kie in credits per model (video per second). `estimate_cost` covers Krea only; tell the user to check Higgsfield and Kie prices in their dashboards for big batches.
