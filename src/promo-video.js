// The approved 51s infomercial. It's rendered on Higgsfield's CDN; on startup we keep a copy on the
// volume so the site doesn't depend on a third-party URL staying up. Until the copy exists (or if
// the download fails), /media/infomercial.mp4 redirects to the CDN.
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

export const PROMO_VIDEO_SOURCE =
  process.env.PROMO_VIDEO_URL ||
  'https://d2ol7oe51mr4n9.cloudfront.net/user_391qpEAynVndVvvLA4RZWiHERjU/83709c18-dc5a-4202-9493-89e04125aa2b.mp4';

const dir = path.join(config.dataDir, 'media');
export const promoVideoPath = path.join(dir, `infomercial-${path.basename(new URL(PROMO_VIDEO_SOURCE).pathname)}`);

export const promoVideoCached = () => fs.existsSync(promoVideoPath);

export async function cachePromoVideo() {
  if (!PROMO_VIDEO_SOURCE || promoVideoCached()) return;
  const res = await fetch(PROMO_VIDEO_SOURCE);
  if (!res.ok) throw new Error(`promo video download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${promoVideoPath}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, promoVideoPath);
  console.log(`Promo video cached (${(buf.length / 1e6).toFixed(1)} MB)`);
}
