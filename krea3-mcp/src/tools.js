// MCP tools, prompts and resources for Krea 3, blended with Higgsfield and Kie.ai.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchInline, saveAll, waitFor } from './providers/common.js';
import {
  HIGGSFIELD_DEFAULT_IMAGE,
  HIGGSFIELD_DEFAULT_TEXT_IMAGE,
  HIGGSFIELD_DEFAULT_VIDEO,
  HIGGSFIELD_MODELS,
  higgsfieldImageInput,
} from './providers/higgsfield.js';
import { getProvider, PROVIDER_NAMES, providerStatus, resolveImages } from './providers/index.js';
import { KIE_DEFAULT_IMAGE, KIE_MODELS, kieImageInput } from './providers/kie.js';
import { estimateKreaCost, KREA_DEFAULT_MODEL, kreaInput } from './providers/krea.js';
import { AD_FORMATS, listPresets, mockupPrompt, PET_STYLES, petPortraitPrompt, PRODUCT_MOCKUPS } from './presets.js';

export const VERSION = '1.1.0';
const ASPECTS = ['1:1', '4:5', '3:4', '2:3', '9:16', '5:4', '4:3', '3:2', '16:9', '21:9'];
const MAX_INLINE = 4;

const json = (obj) => ({ type: 'text', text: JSON.stringify(obj, null, 2) });
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const keysOf = (o) => /** @type {[string, ...string[]]} */ (Object.keys(o));

/** Builds { model, input } for a provider from the shared options. */
function buildImageRequest(providerName, o) {
  if (providerName === 'krea') return { model: o.model || KREA_DEFAULT_MODEL, input: { ...kreaInput(o), ...(o.extra || {}) } };
  if (providerName === 'higgsfield') {
    const model = o.model || (o.image_urls?.length ? HIGGSFIELD_DEFAULT_IMAGE : HIGGSFIELD_DEFAULT_TEXT_IMAGE);
    return { model, input: { ...higgsfieldImageInput({ ...o, model }), ...(o.extra || {}) } };
  }
  const model = o.model || KIE_DEFAULT_IMAGE;
  return { model, input: { ...kieImageInput({ ...o, model }), ...(o.extra || {}) } };
}

/**
 * Submits one job, optionally waits, and returns a plain result object.
 * Never throws: failures come back as { ok: false, error }.
 */
async function runJob(providerName, { model, input, zeroDataRetention }, { waitMs, label }) {
  const provider = getProvider(providerName);
  try {
    const id = await provider.submit({ model, input, zeroDataRetention });
    if (!waitMs) return { ok: true, label, provider: providerName, model, job_id: id, status: 'submitted' };
    const st = await waitFor(provider, id, { timeoutMs: waitMs });
    if (st.state === 'completed') return { ok: true, label, provider: providerName, model, job_id: id, status: 'completed', urls: st.urls };
    if (st.state === 'pending') return { ok: true, label, provider: providerName, model, job_id: id, status: st.detail || 'pending', note: 'Still running: call get_job later.' };
    return { ok: false, label, provider: providerName, model, job_id: id, status: st.detail || 'failed', error: String(st.error) };
  } catch (err) {
    return { ok: false, label, provider: providerName, model, error: err.message };
  }
}

/** Turns job results into MCP content: a JSON summary plus inline images, and optional local saves. */
async function present(results, { showImage = true, saveDir, extra = {} } = {}) {
  const list = Array.isArray(results) ? results : [results];
  if (saveDir) {
    for (const r of list) {
      if (r.urls?.length) {
        try {
          r.saved_to = await saveAll(r.urls, saveDir, `${r.provider}-${(r.label || 'image').replace(/\W+/g, '-')}`);
        } catch (err) {
          r.save_error = err.message;
        }
      }
    }
  }
  const summary = Array.isArray(results) ? { results: list, ...extra } : { ...list[0], ...extra };
  const content = [json(summary)];
  if (showImage) {
    let shown = 0;
    for (const r of list) {
      for (const url of r.urls || []) {
        if (shown >= MAX_INLINE) break;
        const img = await fetchInline(url);
        if (img) {
          content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
          shown++;
        }
      }
    }
  }
  const allFailed = list.every((r) => !r.ok);
  return allFailed ? { isError: true, content } : { content };
}

/**
 * @param {{ allowLocalFiles: boolean }} opts  Local file reads/writes are only enabled for the stdio transport.
 */
export function createServer({ allowLocalFiles }) {
  const server = new McpServer(
    { name: 'krea3-studio', version: VERSION },
    {
      instructions:
        'Image and video studio built around Krea 3 (fast instruction-following image editing), blended with Higgsfield and Kie.ai. ' +
        'Default to Krea 3 for edits; use compare_providers to pick the best model for a look; use animate_image (Higgsfield/Kie) to turn a still into video. ' +
        'Krea 3 prompts: lead with the change, refer to images by what they show, end with one preservation sentence. ' +
        'Every generating tool spends the user\'s credits. Call estimate_cost before large batches and list_providers to see which keys are set.',
    }
  );

  // Shared input fields --------------------------------------------------------------------------
  const images = {
    image_urls: z.array(z.string()).max(10).optional().describe('Public image URLs, provider asset URLs, or data URIs.'),
    ...(allowLocalFiles ? { image_paths: z.array(z.string()).max(10).optional().describe('Local file paths; uploaded automatically.') } : {}),
    image_base64: z.array(z.string()).max(10).optional().describe('Images as base64 or data URIs (e.g. a chat attachment).'),
  };
  const output = {
    wait_seconds: z.number().int().min(0).max(900).optional().describe('How long to wait for results. 0 = return job ids immediately. Default 100 (images) / 300 (video, ultra).'),
    show_image: z.boolean().default(true).describe('Return images inline so they show in the chat.'),
    ...(allowLocalFiles ? { save_dir: z.string().optional().describe('Also download results into this local folder.') } : {}),
  };
  const kreaOptions = {
    thinking_mode: z.enum(['fast', 'high', 'ultra']).default('fast').describe('fast = default; high = complex/multi-reference; ultra = Max plan, minutes, +$0.20.'),
    resolution: z.enum(['1K', '2K', '4K']).default('2K'),
    aspect_ratio: z.enum(ASPECTS).optional().describe('Omit for automatic framing.'),
  };
  const region = z.object({
    image_idx: z.number().int().min(0).describe('Index into the final image list (image_urls, then image_paths, then image_base64).'),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
    label: z.string().regex(/^\S+$/, 'labels cannot contain whitespace').optional(),
    note: z.string().optional().describe('What to do inside this box.'),
  });
  const imagesFrom = (a) => ({ urls: a.image_urls, paths: a.image_paths, base64: a.image_base64 });
  const countImages = (a) => (a.image_urls?.length || 0) + (a.image_paths?.length || 0) + (a.image_base64?.length || 0);
  const waitMsFor = (a, video = false) => (a.wait_seconds ?? (video || a.thinking_mode === 'ultra' ? 300 : 100)) * 1000;
  const writeHint = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

  // 1. Krea 3 edit (full control) -----------------------------------------------------------------
  server.registerTool(
    'krea3_edit',
    {
      title: 'Edit or generate an image with Krea 3',
      description:
        'Edit images (or generate from text) with Krea 3: up to 8 references, plain-language instructions, regional edits, bounding boxes. ' +
        'Billed per call: $0.03 (1K) / $0.06 (2K), +$0.02-0.07 per reference, +$0.02 high, +$0.20 ultra.',
      inputSchema: {
        prompt: z.string().max(8000).optional().describe('The edit instruction. Optional only if a region has a note.'),
        ...images,
        ...kreaOptions,
        regional_edit: z.boolean().optional().describe('Regenerate only what must change; the rest stays pixel-exact.'),
        regions: z.array(region).max(24).optional(),
        negative_prompt: z.string().max(1024).optional(),
        seed: z.number().int().optional(),
        zero_data_retention: z.boolean().optional().describe('Enterprise only: images are sent inline, nothing is stored.'),
        ...output,
      },
      annotations: writeHint,
    },
    async (a) => {
      const total = countImages(a);
      if (total > 8) return fail(`Krea 3 accepts at most 8 images per edit; got ${total}.`);
      if (!a.prompt && !(a.regions || []).some((r) => r.note)) return fail('Provide a prompt, or at least one region with a note.');
      if (a.regional_edit && !total) return fail('regional_edit needs at least one input image.');
      if ((a.regions || []).some((r) => r.image_idx >= total)) return fail('A region points at an image_idx that does not exist.');
      if (a.thinking_mode === 'ultra' && !total) return fail('ultra needs at least one input image.');
      if (a.thinking_mode === 'ultra' && a.negative_prompt) return fail('negative_prompt is not supported with ultra.');
      try {
        const image_urls = await resolveImages(getProvider('krea'), { ...imagesFrom(a), inlineDataUris: a.zero_data_retention });
        const req = buildImageRequest('krea', { ...a, image_urls });
        const r = await runJob('krea', { ...req, zeroDataRetention: a.zero_data_retention }, { waitMs: waitMsFor(a), label: 'edit' });
        const cost = estimateKreaCost({ resolution: req.input.resolution, thinking_mode: a.thinking_mode, references_1k: image_urls.length });
        return present(r, { showImage: a.show_image, saveDir: a.save_dir, extra: { estimated_usd_min: cost.estimated_usd } });
      } catch (err) {
        return fail(err.message);
      }
    }
  );

  // 2. Any provider, one interface -----------------------------------------------------------------
  server.registerTool(
    'generate_image',
    {
      title: 'Generate or edit an image with Krea, Higgsfield or Kie.ai',
      description:
        'One interface over three providers. krea = Krea 3 (default; fast precise edits). higgsfield = Soul (text-to-image) / Qwen Image 3 edit or any Higgsfield image endpoint. ' +
        'kie = Nano Banana Pro or any Kie market model. Use `model` to pick another endpoint and `extra` for model-specific fields. Billed by the chosen provider.',
      inputSchema: {
        provider: z.enum(PROVIDER_NAMES).default('krea'),
        model: z.string().optional().describe('Provider model id/endpoint path. See list_providers.'),
        prompt: z.string().max(8000),
        ...images,
        aspect_ratio: z.string().optional().describe('e.g. "1:1", "2:3", "16:9". Allowed values vary by model.'),
        resolution: z.enum(['1K', '2K', '4K']).optional(),
        seed: z.number().int().optional(),
        extra: z.record(z.string(), z.any()).optional().describe('Extra model-specific fields merged into the request body.'),
        ...output,
      },
      annotations: writeHint,
    },
    async (a) => {
      try {
        const provider = getProvider(a.provider);
        const image_urls = await resolveImages(provider, imagesFrom(a));
        const req = buildImageRequest(a.provider, { ...a, image_urls, resolution: a.resolution || (a.provider === 'krea' ? '2K' : undefined) });
        const r = await runJob(a.provider, req, { waitMs: waitMsFor(a), label: a.provider });
        return present(r, { showImage: a.show_image, saveDir: a.save_dir });
      } catch (err) {
        return fail(err.message);
      }
    }
  );

  // 3. Side-by-side comparison -------------------------------------------------------------------
  server.registerTool(
    'compare_providers',
    {
      title: 'Run the same image job on several providers',
      description:
        'Runs one prompt (and the same reference images) on Krea 3, Higgsfield and/or Kie.ai in parallel and returns every result side by side, ' +
        'so you can pick the best model for a style. Each provider bills its own run. Unconfigured providers are skipped.',
      inputSchema: {
        prompt: z.string().max(8000),
        ...images,
        providers: z.array(z.enum(PROVIDER_NAMES)).min(1).max(3).optional().describe('Default: every configured provider.'),
        models: z.record(z.string(), z.string()).optional().describe('Optional model per provider, e.g. {"kie":"nano-banana-pro"}.'),
        aspect_ratio: z.string().optional(),
        resolution: z.enum(['1K', '2K', '4K']).optional(),
        ...output,
      },
      annotations: writeHint,
    },
    async (a) => {
      const status = providerStatus();
      const names = (a.providers || PROVIDER_NAMES).filter((n) => status[n].configured);
      const skipped = (a.providers || PROVIDER_NAMES).filter((n) => !status[n].configured);
      if (!names.length) return fail('No requested provider has API keys set. Call list_providers.');
      try {
        // Upload once through a configured host, then share the URLs with everyone.
        const shared = await resolveImages(getProvider(names.includes('krea') ? 'krea' : names[0]), imagesFrom(a));
        const results = await Promise.all(
          names.map((n) =>
            runJob(n, buildImageRequest(n, { ...a, model: a.models?.[n], image_urls: shared, resolution: a.resolution || (n === 'krea' ? '2K' : undefined) }), {
              waitMs: waitMsFor(a),
              label: n,
            })
          )
        );
        return present(results, { showImage: a.show_image, saveDir: a.save_dir, extra: skipped.length ? { skipped_unconfigured: skipped } : {} });
      } catch (err) {
        return fail(err.message);
      }
    }
  );

  // 4. Image to video -----------------------------------------------------------------------------
  server.registerTool(
    'animate_image',
    {
      title: 'Turn images into a video (Higgsfield or Kie.ai)',
      description:
        'Animate a still (for example a Krea 3 result) into a short video. higgsfield default: Kling O3 image-reference (image_urls). ' +
        'Pass `model` for any other documented endpoint (Seedance, Wan, Kling, Veo...) and `extra` for its fields (duration, resolution, generate_audio...). ' +
        'For single-image endpoints set image_field to "image_url". Video is billed per second by the provider.',
      inputSchema: {
        provider: z.enum(['higgsfield', 'kie']).default('higgsfield'),
        model: z.string().optional().describe(`Default higgsfield: ${HIGGSFIELD_DEFAULT_VIDEO}. Required for kie.`),
        prompt: z.string().max(5000).describe('Describe the motion and camera, e.g. "slow push-in, the dog tilts its head, warm light flickers".'),
        ...images,
        image_field: z.enum(['image_urls', 'image_url', 'image_input', 'imageUrls']).default('image_urls').describe('Which field the model expects for input images.'),
        duration: z.number().int().min(1).max(30).optional(),
        extra: z.record(z.string(), z.any()).optional(),
        ...output,
      },
      annotations: writeHint,
    },
    async (a) => {
      try {
        if (a.provider === 'kie' && !a.model) return fail('Pass `model` with a Kie video model id from the Kie docs (Market section).');
        const provider = getProvider(a.provider);
        const urls = await resolveImages(provider, imagesFrom(a));
        if (!urls.length) return fail('Provide at least one image to animate.');
        const model = a.model || HIGGSFIELD_DEFAULT_VIDEO;
        const input = clean({
          prompt: a.prompt,
          [a.image_field]: a.image_field === 'image_url' ? urls[0] : urls,
          duration: a.duration,
          ...(a.extra || {}),
        });
        const r = await runJob(a.provider, { model, input }, { waitMs: waitMsFor(a, true), label: 'video' });
        return present(r, { showImage: false, saveDir: a.save_dir });
      } catch (err) {
        return fail(err.message);
      }
    }
  );

  // 5. Pet portraits ------------------------------------------------------------------------------
  server.registerTool(
    'pet_portrait',
    {
      title: 'Paint a pet portrait in a preset style',
      description:
        `Turns 1-4 photos of a pet into a styled portrait, several variants in parallel. Styles: ${Object.keys(PET_STYLES).join(', ')}. ` +
        'Optional companion image (second pet or owner) is added last. Defaults to Krea 3 at 2:3 for 12x18 / 16x24 canvas prints.',
      inputSchema: {
        style: z.enum(keysOf(PET_STYLES)),
        ...images,
        companion: z.string().optional().describe('Who the LAST image shows, e.g. "the owner" or "the second dog, a beagle".'),
        variants: z.number().int().min(1).max(4).default(2),
        extra_direction: z.string().max(1000).optional().describe('Extra art direction, e.g. "green velvet instead of red".'),
        provider: z.enum(PROVIDER_NAMES).default('krea'),
        thinking_mode: z.enum(['fast', 'high']).default('high').describe('high reads several photos together more carefully (+$0.02).'),
        aspect_ratio: z.enum(ASPECTS).default('2:3'),
        resolution: z.enum(['1K', '2K', '4K']).default('2K'),
        ...output,
      },
      annotations: writeHint,
    },
    async (a) => {
      const total = countImages(a);
      if (!total) return fail('Add at least one photo of the pet.');
      try {
        const provider = getProvider(a.provider);
        const image_urls = await resolveImages(provider, imagesFrom(a));
        const photoCount = a.companion ? total - 1 : total;
        const base = petPortraitPrompt(a.style, { photoCount, companion: a.companion, extra: a.extra_direction });
        const jobs = Array.from({ length: a.variants }, (_, i) => {
          const prompt = a.variants > 1 ? `${base} Variation ${i + 1} of ${a.variants}: vary the pose and background details slightly.` : base;
          return runJob(a.provider, buildImageRequest(a.provider, { ...a, prompt, image_urls }), { waitMs: waitMsFor(a), label: `${a.style}-${i + 1}` });
        });
        const results = await Promise.all(jobs);
        const extra =
          a.provider === 'krea'
            ? { estimated_usd_total: Number((a.variants * estimateKreaCost({ resolution: a.resolution, thinking_mode: a.thinking_mode, references_1k: total }).estimated_usd).toFixed(2)) }
            : {};
        return present(results, { showImage: a.show_image, saveDir: a.save_dir, extra: { style: PET_STYLES[a.style].name, ...extra } });
      } catch (err) {
        return fail(err.message);
      }
    }
  );

  // 6. Product mockups ----------------------------------------------------------------------------
  server.registerTool(
    'product_mockup',
    {
      title: 'Put artwork on a product mockup',
      description:
        `Places a design (first image) on a product photo, one image per colorway, in parallel. Products: ${Object.keys(PRODUCT_MOCKUPS).join(', ')}. ` +
        'Krea 3 keeps the artwork intact; good for Etsy/Shopify listings.',
      inputSchema: {
        product: z.enum(keysOf(PRODUCT_MOCKUPS)),
        ...images,
        colors: z.array(z.string()).min(1).max(8).optional().describe('One mockup per color, e.g. ["washed sage","heather gray"].'),
        scene: z.string().max(500).optional().describe('Where the product is shown. Defaults to the preset scene.'),
        extra_direction: z.string().max(1000).optional(),
        provider: z.enum(PROVIDER_NAMES).default('krea'),
        aspect_ratio: z.enum(ASPECTS).default('4:5'),
        resolution: z.enum(['1K', '2K', '4K']).default('2K'),
        ...output,
      },
      annotations: writeHint,
    },
    async (a) => {
      if (!countImages(a)) return fail('Add the artwork as the first image.');
      try {
        const provider = getProvider(a.provider);
        const image_urls = await resolveImages(provider, imagesFrom(a));
        const colors = a.colors?.length ? a.colors : [undefined];
        const results = await Promise.all(
          colors.map((color) =>
            runJob(
              a.provider,
              buildImageRequest(a.provider, { ...a, thinking_mode: 'fast', image_urls, prompt: mockupPrompt(a.product, { color, scene: a.scene, extra: a.extra_direction }) }),
              { waitMs: waitMsFor(a), label: `${a.product}-${color || PRODUCT_MOCKUPS[a.product].default_color}` }
            )
          )
        );
        return present(results, { showImage: a.show_image, saveDir: a.save_dir });
      } catch (err) {
        return fail(err.message);
      }
    }
  );

  // 7. Ad / social format pack -------------------------------------------------------------------
  server.registerTool(
    'ad_format_pack',
    {
      title: 'Re-frame one image for every ad and social format',
      description:
        `Adapts one hero image to several placements in parallel with Krea 3 (extends or re-frames the scene, keeps the subject). Formats: ${Object.keys(AD_FORMATS).join(', ')}.`,
      inputSchema: {
        ...images,
        formats: z.array(z.enum(keysOf(AD_FORMATS))).min(1).max(7),
        direction: z.string().max(1000).optional().describe('Optional extra change applied to every format, e.g. "add a soft holiday glow".'),
        resolution: z.enum(['1K', '2K']).default('2K'),
        ...output,
      },
      annotations: writeHint,
    },
    async (a) => {
      if (!countImages(a)) return fail('Add the hero image.');
      try {
        const image_urls = await resolveImages(getProvider('krea'), imagesFrom(a));
        const results = await Promise.all(
          a.formats.map((f) => {
            const fmt = AD_FORMATS[f];
            const prompt = `Re-frame the image for a ${fmt.aspect_ratio} ${fmt.name} placement: extend the scene naturally to fill the new frame and keep the main subject fully visible with comfortable margins.${a.direction ? ` ${a.direction}` : ''} Keep the subject, product and any text exactly as they are.`;
            return runJob('krea', buildImageRequest('krea', { prompt, image_urls, aspect_ratio: fmt.aspect_ratio, resolution: a.resolution }), { waitMs: waitMsFor(a), label: f });
          })
        );
        return present(results, { showImage: a.show_image, saveDir: a.save_dir });
      } catch (err) {
        return fail(err.message);
      }
    }
  );

  // 8. Batch -----------------------------------------------------------------------------------------
  server.registerTool(
    'krea3_batch',
    {
      title: 'Run up to 8 Krea 3 edits in parallel',
      description: 'Several different instructions on the same reference images (or text-only), all at once. Good for exploring ideas or catalog variants.',
      inputSchema: {
        prompts: z.array(z.string().max(8000)).min(1).max(8),
        ...images,
        ...kreaOptions,
        regional_edit: z.boolean().optional(),
        ...output,
      },
      annotations: writeHint,
    },
    async (a) => {
      if (countImages(a) > 8) return fail('Krea 3 accepts at most 8 images per edit.');
      try {
        const image_urls = await resolveImages(getProvider('krea'), imagesFrom(a));
        const results = await Promise.all(
          a.prompts.map((prompt, i) => runJob('krea', buildImageRequest('krea', { ...a, prompt, image_urls }), { waitMs: waitMsFor(a), label: `#${i + 1}` }))
        );
        const each = estimateKreaCost({ resolution: a.resolution, thinking_mode: a.thinking_mode, references_1k: image_urls.length }).estimated_usd;
        return present(results, { showImage: a.show_image, saveDir: a.save_dir, extra: { estimated_usd_total: Number((each * a.prompts.length).toFixed(2)) } });
      } catch (err) {
        return fail(err.message);
      }
    }
  );

  // 9. Job status ------------------------------------------------------------------------------------
  server.registerTool(
    'get_job',
    {
      title: 'Check a job on any provider',
      description: 'Status and results of a job started by any tool here. Optionally wait for it.',
      inputSchema: {
        provider: z.enum(PROVIDER_NAMES).default('krea'),
        job_id: z.string(),
        wait_seconds: z.number().int().min(0).max(900).default(0),
        show_image: z.boolean().default(true),
        ...(allowLocalFiles ? { save_dir: z.string().optional() } : {}),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (a) => {
      try {
        const p = getProvider(a.provider);
        const st = a.wait_seconds ? await waitFor(p, a.job_id, { timeoutMs: a.wait_seconds * 1000 }) : await p.status(a.job_id);
        const r = { ok: st.state !== 'failed', provider: a.provider, job_id: a.job_id, status: st.state === 'completed' ? 'completed' : st.detail || st.state, urls: st.urls, error: st.error };
        return present(r, { showImage: a.show_image, saveDir: a.save_dir });
      } catch (err) {
        return fail(err.message);
      }
    }
  );

  // 10. Upload --------------------------------------------------------------------------------------
  server.registerTool(
    'upload_image',
    {
      title: 'Upload an image and get a reusable URL',
      description: 'Hosts an image on Krea (or Higgsfield) and returns a URL usable by every tool and provider. Saves re-sending the same file.',
      inputSchema: {
        ...(allowLocalFiles ? { path: z.string().optional().describe('Local file path.') } : {}),
        base64: z.string().optional().describe('Image as base64 or a data URI.'),
        host: z.enum(['krea', 'higgsfield']).default('krea'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (a) => {
      if (!a.path && !a.base64) return fail(allowLocalFiles ? 'Provide path or base64.' : 'Provide base64.');
      try {
        const host = getProvider(a.host);
        if (!host.configured()) return fail(`${host.label} keys are not set.`);
        const [url] = await resolveImages(host, { paths: a.path ? [a.path] : [], base64: a.base64 ? [a.base64] : [] });
        return { content: [json({ image_url: url, host: a.host })] };
      } catch (err) {
        return fail(err.message);
      }
    }
  );

  // 11. Cost estimate ---------------------------------------------------------------------------------
  server.registerTool(
    'estimate_cost',
    {
      title: 'Estimate Krea 3 cost',
      description:
        'Free, offline estimate of Krea 3 list prices for one or many edits. Higgsfield and Kie price per model/credits and do not publish fixed per-image prices here; check their dashboards.',
      inputSchema: {
        resolution: z.enum(['1K', '2K', '4K']).default('2K'),
        thinking_mode: z.enum(['fast', 'high', 'ultra']).default('fast'),
        references_1k: z.number().int().min(0).max(8).default(1).describe('Reference images around 1 megapixel or smaller.'),
        references_2k: z.number().int().min(0).max(8).default(0).describe('Reference images larger than ~1 megapixel.'),
        count: z.number().int().min(1).max(1_000_000).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ count, ...one }) => {
      const each = estimateKreaCost(one);
      return { content: [json({ ...each, count, estimated_total_usd: Number((each.estimated_usd * count).toFixed(2)) })] };
    }
  );

  // 12. Discovery -------------------------------------------------------------------------------------
  server.registerTool(
    'list_providers',
    {
      title: 'List providers, models and presets',
      description: 'Which providers have keys set, known model ids/endpoints for each, and every preset style, product and ad format.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({
      content: [
        json({
          providers: providerStatus(),
          models: {
            krea: { [KREA_DEFAULT_MODEL]: 'Krea 3 (default). Other Krea models: any path under /generate, e.g. "image/krea/krea-2".' },
            higgsfield: { ...Object.fromEntries(Object.entries(HIGGSFIELD_MODELS).map(([k, v]) => [k, `${v.kind}: ${v.note}`])), more: 'https://docs.higgsfield.ai (any endpoint path works)' },
            kie: { ...Object.fromEntries(Object.entries(KIE_MODELS).map(([k, v]) => [k, `${v.kind}: ${v.note}`])), more: 'https://docs.kie.ai Market (any model id works with `extra`)' },
          },
          presets: listPresets(),
        }),
      ],
    })
  );

  // Prompts (slash-command style templates in clients that support them) --------------------------------
  server.registerPrompt(
    'pet_portrait',
    {
      title: 'Pet portrait',
      description: 'Walk through making a styled pet portrait.',
      argsSchema: { style: z.string().optional().describe(Object.keys(PET_STYLES).join(', ')), pet: z.string().optional().describe('e.g. "my golden retriever Max"') },
    },
    ({ style, pet }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Make a ${style ? PET_STYLES[style]?.name || style : 'classic royal'} portrait of ${pet || 'my pet'}. ` +
              'Ask me for 1-4 clear photos if I have not attached any, then call pet_portrait with 2 variants. ' +
              'Show me the results and offer: another style, a regional fix (krea3_edit with regional_edit), product mockups, or an animated version (animate_image).',
          },
        },
      ],
    })
  );
  server.registerPrompt(
    'product_listing_set',
    {
      title: 'Product listing photo set',
      description: 'Turn one design into a full set of listing photos.',
      argsSchema: { product: z.string().optional().describe(Object.keys(PRODUCT_MOCKUPS).join(', ')), colors: z.string().optional().describe('comma-separated') },
    },
    ({ product, colors }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Create listing photos for my design on a ${product || 'tshirt'}${colors ? ` in ${colors}` : ''}. ` +
              'Use product_mockup (one per color), then ad_format_pack for etsy_listing and pinterest_pin with the best mockup. Estimate the cost first.',
          },
        },
      ],
    })
  );
  server.registerPrompt(
    'model_shootout',
    {
      title: 'Model shoot-out',
      description: 'Compare Krea 3, Higgsfield and Kie on the same brief.',
      argsSchema: { brief: z.string().describe('What to make') },
    },
    ({ brief }) => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Run compare_providers on this brief and rank the results for likeness, detail and prompt-following, then tell me which provider to use going forward: ${brief}` },
        },
      ],
    })
  );

  // Resource: presets as JSON -------------------------------------------------------------------------
  server.registerResource('presets', 'krea3://presets', { title: 'Preset styles, products and ad formats', mimeType: 'application/json' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ pet_styles: PET_STYLES, product_mockups: PRODUCT_MOCKUPS, ad_formats: AD_FORMATS }, null, 2) }],
  }));

  return server;
}
