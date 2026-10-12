// Generates a ready-to-schedule marketing calendar:
//   marketing/social-calendar.csv  — 30 days of TikTok/Reels/Shorts posts (hook, script, caption, hashtags)
//   marketing/pinterest-pins.csv   — one pin per breed x style, linking to that breed's SEO page
//   marketing/meta-ads.csv         — ad copy variants for Meta (Facebook/Instagram) ad testing
// Upload the CSVs to a scheduler (Meta Business Suite, Buffer, Pinterest bulk upload, Zapier).
// Usage: BASE_URL=https://yourdomain.com node scripts/content-engine.js [days]
import fs from 'node:fs';
import { BREEDS, OCCASIONS } from '../src/seo.js';
import { STYLES } from '../src/config.js';

const base = (process.env.BASE_URL || 'https://example.com').replace(/\/$/, '');
const days = Number(process.argv[2] || 30);
const outDir = new URL('../marketing', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });

const csv = (rows) =>
  rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';

// Hooks reverse-engineered from top-performing pet-portrait short videos: reveal, reaction, transformation.
const HOOKS = [
  ['I turned my {breed} into royalty and he is NOT okay with it', 'Before photo (dog looking goofy) → slow zoom reveal of the {style} portrait → cut to dog staring at it.'],
  ['POV: your {breed} finally gets the portrait they deserve', 'Phone photo on screen → swipe → {style} portrait fills the frame. Text: "4 versions, delivered in minutes."'],
  ['Rating AI pet portraits of my {breed} 1–10', 'Show all 4 versions one by one with a score sticker. End on the best one on a canvas on the wall.'],
  ['Gift idea for the dog mom who has everything', 'Show the {breed} photo → {style} portrait → unboxing the canvas. Text: "order link in bio".'],
  ["My grandma cried when she saw her {breed}'s portrait", 'Reaction-style: hand her the canvas, capture the moment. Close on the portrait.'],
  ['This is what your {breed} thinks they look like', 'Funny photo of the pet sleeping upside down → {style} portrait. Trending audio.'],
  ['Making a memorial portrait for my late {breed}', 'Soft music. Old photo → watercolor portrait. Caption about keeping them close. (No hard sell.)'],
  ['Which style suits a {breed} best?', 'Same pet in 3 styles side by side. Ask viewers to comment 1, 2 or 3 (drives comments).'],
];

const TAGS = {
  dog: '#dogsoftiktok #dogmom #petportrait #customgift #dogportrait',
  cat: '#catsoftiktok #catmom #petportrait #customgift #catportrait',
};

// Rotate seasonal angles automatically based on the calendar date.
function seasonalOccasion(date) {
  const m = date.getMonth() + 1, d = date.getDate();
  if ((m === 11) || (m === 12 && d <= 20)) return OCCASIONS.find((o) => o.slug === 'christmas-gift');
  if (m === 4 || (m === 5 && d <= 10)) return OCCASIONS.find((o) => o.slug === 'mothers-day-gift');
  if (m === 6 && d <= 18) return OCCASIONS.find((o) => o.slug === 'fathers-day-gift');
  return null;
}

const social = [['date', 'platforms', 'breed', 'style', 'hook (on-screen text)', 'shot list', 'caption', 'link']];
const start = new Date();
for (let i = 0; i < days; i++) {
  const date = new Date(start.getTime() + i * 86400_000);
  const breed = BREEDS[(i * 7) % BREEDS.length];
  const styleKey = i % 3 === 0 ? breed.style : Object.keys(STYLES)[i % Object.keys(STYLES).length];
  const style = STYLES[styleKey].name.replace(/^The /, '');
  const [hook, shots] = HOOKS[i % HOOKS.length];
  const occ = seasonalOccasion(date);
  const fill = (s) => s.replaceAll('{breed}', breed.name).replaceAll('{style}', style);
  const link = occ ? `${base}/gifts/${occ.slug}?utm_source=social&utm_campaign=organic` : `${base}/portraits/${breed.slug}?utm_source=social&utm_campaign=organic`;
  const caption = `${fill(hook)} 👑 ${occ ? occ.h1 + '. ' : ''}Upload a photo, get 4 portraits in minutes. Link in bio. ${TAGS[breed.kind]}`;
  social.push([date.toISOString().slice(0, 10), 'TikTok, IG Reels, YT Shorts, FB Reels', breed.name, style, fill(hook), fill(shots), caption, link]);
}

const pins = [['title', 'description', 'link', 'board', 'image_brief']];
for (const b of BREEDS) {
  for (const [key, s] of Object.entries(STYLES)) {
    pins.push([
      `${b.name} ${s.name} Portrait — Custom Pet Portrait from Photo`,
      `Turn your ${b.name} into a ${s.name.toLowerCase()} masterpiece. ${b.hook[0].toUpperCase() + b.hook.slice(1)}, painted like nobility. Perfect gift for ${b.kind} lovers. Delivered in minutes.`,
      `${base}/portraits/${b.slug}?utm_source=pinterest&utm_campaign=${key}`,
      `${b.kind === 'dog' ? 'Dog' : 'Cat'} Portraits`,
      `2:3 vertical. A ${b.name} in the ${s.name} style (use a real customer result or a demo render). Text overlay: "Your ${b.name}, painted like royalty".`,
    ]);
  }
}

const ADS = [
  ['Your pet, painted like royalty 👑', 'Upload one photo. Get 4 museum-style portraits in minutes. Add a canvas and we ship it.', 'Shop now'],
  ['The gift they will actually hang up', 'Turn their dog or cat into a regal oil portrait. Instant digital delivery, canvas prints shipped.', 'Order now'],
  ['Dog moms, this one is for you', "Your fur baby as a duchess, an admiral or an astronaut. 4 versions per order. Free repaint if you don't love it.", 'Shop now'],
  ['Last-minute gift? Delivered in minutes.', 'No shipping stress: digital portraits land in your inbox minutes after checkout.', 'Get yours'],
  ['Keep them close forever 🤍', 'A gentle memorial portrait from your favorite photo of a pet you miss.', 'Learn more'],
];
const ads = [['campaign', 'headline', 'primary text', 'cta', 'landing page']];
for (const [h, t, cta] of ADS) {
  const memorial = h.includes('Keep them close');
  ads.push([memorial ? 'Memorial' : 'Prospecting', h, t, cta, `${base}${memorial ? '/gifts/pet-memorial' : '/'}?utm_source=meta&utm_campaign=${memorial ? 'memorial' : 'prospecting'}`]);
}

fs.writeFileSync(`${outDir}/social-calendar.csv`, csv(social));
fs.writeFileSync(`${outDir}/pinterest-pins.csv`, csv(pins));
fs.writeFileSync(`${outDir}/meta-ads.csv`, csv(ads));
console.log(`Wrote ${social.length - 1} social posts, ${pins.length - 1} pins, ${ads.length - 1} ad variants to marketing/`);
