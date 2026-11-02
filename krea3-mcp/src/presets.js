// Ready-made Krea 3 recipes. Prompts follow Krea's guidance: lead with the change,
// refer to images by what they show, end with one preservation sentence.

const KEEP_PET =
  'Keep the exact same animal from the photos: identical breed, fur colors, markings, eye color and face shape.';
const NO_TEXT = 'No text, letters, signatures or logos anywhere in the image.';

export const PET_STYLES = {
  royal: {
    name: 'The Royal',
    prompt:
      'Turn the pet into a regal Renaissance oil painting: an ornate royal robe with ermine trim, a jeweled gold crown and a medallion necklace, seated on a red velvet throne. Warm golden light on the face, deep red and gold background, visible brushstrokes, museum-quality classical portrait.',
  },
  admiral: {
    name: 'The Admiral',
    prompt:
      'Turn the pet into an 18th-century naval admiral oil portrait: navy coat with gold epaulettes, brass buttons and medals, a stormy sea and tall ship behind. Old-master oil painting, warm luminous tones.',
  },
  duchess: {
    name: 'The Duchess',
    prompt:
      'Turn the pet into an elegant 18th-century duchess oil portrait: silk gown with a lace collar, pearl necklace and tiara, soft pastel palace drapery behind. Rococo oil painting, delicate light.',
  },
  general: {
    name: 'The General',
    prompt:
      'Turn the pet into a Napoleonic general oil portrait: dark military coat with gold braid, a sash and medals, a bicorne hat, a dramatic battlefield sky behind. Heroic old-master oil painting.',
  },
  astronaut: {
    name: 'The Astronaut',
    prompt:
      'Turn the pet into a heroic astronaut portrait: a detailed white space suit with fictional mission patches (no real agency logos or flags), helmet visor open, Earth and stars glowing behind. Cinematic digital painting.',
  },
  watercolor: {
    name: 'Watercolor Classic',
    prompt:
      'Repaint the pet as a soft watercolor portrait: loose wet-on-wet washes, fine ink detail on the eyes and nose, clean white paper background with gentle color bleeds. Fine-art print quality.',
  },
  holiday: {
    name: 'Holiday Edition',
    prompt:
      'Turn the pet into a cozy Christmas oil portrait: a red velvet cape with white fur trim, beside a decorated tree with warm glowing lights and wrapped gifts. Nostalgic oil painting.',
  },
  halloween: {
    name: 'Spooky Season',
    prompt:
      'Turn the pet into a playful Halloween portrait: a velvet vampire cape with a high collar, glowing jack-o-lanterns and a full moon behind. Rich storybook oil painting, cute rather than scary.',
  },
  pop_art: {
    name: 'Pop Art',
    prompt:
      'Repaint the pet as bold 1960s pop art: flat saturated color blocks, thick black outlines, Ben-Day halftone dots, a bright solid background.',
  },
  retro_arcade: {
    name: '16-Bit Arcade',
    prompt:
      'Repaint the pet as crisp 16-bit pixel art: a limited retro console palette, clean pixel edges, a simple arcade-style background with pixel stars.',
  },
  anime: {
    name: 'Anime Hero',
    prompt:
      'Repaint the pet as a hand-drawn anime character portrait: clean line art, cel shading, big expressive eyes that keep the real eye color, a soft sunset sky behind.',
  },
  memorial: {
    name: 'Rainbow Bridge Memorial',
    prompt:
      'Paint a gentle memorial portrait of the pet resting on soft clouds at golden hour, a faint rainbow behind, warm peaceful light, soft oil painting.',
  },
  line_art: {
    name: 'Minimal Line Art',
    prompt:
      'Redraw the pet as elegant single-weight black line art on a plain white background, minimal and clean, suitable for printing on apparel.',
  },
};

export const PRODUCT_MOCKUPS = {
  tshirt: {
    name: 'T-shirt (flat lay or on model)',
    prompt:
      'Print the artwork from the first image on the chest of a {color} crew-neck cotton t-shirt, {scene}. The print follows the fabric folds and keeps the artwork exactly as designed.',
    default_scene: 'laid flat on a light oak table with soft daylight',
    default_color: 'heather gray',
  },
  hoodie: {
    name: 'Hoodie',
    prompt:
      'Print the artwork from the first image on the front of a {color} pullover hoodie, {scene}. The print follows the fabric and keeps the artwork exactly as designed.',
    default_scene: 'worn by a smiling adult on a city sidewalk at golden hour',
    default_color: 'black',
  },
  throw_blanket: {
    name: 'Throw blanket 50x60',
    prompt:
      'Print the artwork from the first image across a soft fleece throw blanket draped over a {color} sofa, {scene}. The artwork stays exactly as designed and follows the folds.',
    default_scene: 'in a cozy living room with warm lamp light',
    default_color: 'cream',
  },
  canvas_wall: {
    name: 'Canvas on a wall',
    prompt:
      'Hang the artwork from the first image as a gallery-wrapped canvas on a {color} wall, {scene}. The artwork stays exactly as designed.',
    default_scene: 'above a styled console table with a plant, soft natural light',
    default_color: 'warm white',
  },
  mug: {
    name: 'Ceramic mug',
    prompt:
      'Print the artwork from the first image on a {color} 11oz ceramic mug, {scene}. The print wraps with the curve of the mug and keeps the artwork exactly as designed.',
    default_scene: 'on a kitchen counter next to a coffee bag, morning light',
    default_color: 'white',
  },
  phone_case: {
    name: 'Phone case',
    prompt:
      'Print the artwork from the first image on a {color} phone case, {scene}. The artwork stays exactly as designed.',
    default_scene: 'held in a hand outdoors with a blurred park behind',
    default_color: 'glossy clear',
  },
  tote_bag: {
    name: 'Tote bag',
    prompt:
      'Print the artwork from the first image on a {color} canvas tote bag, {scene}. The artwork stays exactly as designed.',
    default_scene: 'carried over a shoulder at a farmers market',
    default_color: 'natural',
  },
  poster_frame: {
    name: 'Framed poster',
    prompt:
      'Put the artwork from the first image in a thin {color} frame with a white mat, {scene}. The artwork stays exactly as designed.',
    default_scene: 'leaning on a shelf in a bright modern room',
    default_color: 'black',
  },
};

export const AD_FORMATS = {
  instagram_feed: { name: 'Instagram feed', aspect_ratio: '4:5' },
  instagram_story: { name: 'Story / Reel / TikTok', aspect_ratio: '9:16' },
  facebook_feed: { name: 'Facebook feed', aspect_ratio: '1:1' },
  pinterest_pin: { name: 'Pinterest pin', aspect_ratio: '2:3' },
  etsy_listing: { name: 'Etsy listing photo', aspect_ratio: '4:3' },
  web_banner: { name: 'Website hero banner', aspect_ratio: '21:9' },
  youtube_thumbnail: { name: 'YouTube thumbnail', aspect_ratio: '16:9' },
};

export function petPortraitPrompt(styleKey, { photoCount = 1, companion, extra } = {}) {
  const s = PET_STYLES[styleKey];
  if (!s) throw new Error(`Unknown style "${styleKey}". Options: ${Object.keys(PET_STYLES).join(', ')}`);
  const photos = photoCount > 1 ? `The first ${photoCount} images all show the same pet from different angles. ` : '';
  const comp = companion
    ? ` Include ${companion} from the last image in the same portrait, painted in the same style and keeping their exact appearance.`
    : '';
  return `${photos}${s.prompt}${comp}${extra ? ` ${extra}` : ''} Vertical composition, bright even light on the face, sharp focus on the eyes. ${NO_TEXT} ${KEEP_PET}`;
}

export function mockupPrompt(productKey, { color, scene, extra } = {}) {
  const p = PRODUCT_MOCKUPS[productKey];
  if (!p) throw new Error(`Unknown product "${productKey}". Options: ${Object.keys(PRODUCT_MOCKUPS).join(', ')}`);
  return (
    p.prompt.replace('{color}', color || p.default_color).replace('{scene}', scene || p.default_scene) +
    (extra ? ` ${extra}` : '') +
    ' Photorealistic product photography. Do not change, crop or redraw the artwork.'
  );
}

export function listPresets() {
  const pick = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
  return {
    pet_styles: pick(PET_STYLES, (v) => v.name),
    product_mockups: pick(PRODUCT_MOCKUPS, (v) => `${v.name} (default: ${v.default_color}, ${v.default_scene})`),
    ad_formats: pick(AD_FORMATS, (v) => `${v.name}, ${v.aspect_ratio}`),
  };
}
