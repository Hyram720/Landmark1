// Customer download files must not carry a 300 ppi tag. Print files for Printful keep theirs.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { enhancePortrait, upgradeToMaster, makePrintFile } from '../src/enhance.js';
import { applyNameplate } from '../src/nameplate.js';

const ppi = (png) => {
  const i = png.indexOf(Buffer.from('pHYs'));
  assert.ok(i > 0, 'PNG has a density chunk');
  return Math.round(png.readUInt32BE(i + 4) * 0.0254);
};
const base = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#884422' } }).png().toBuffer();
const master = await enhancePortrait(base);
assert.equal(ppi(master), 72, 'master PNG carries the neutral 72 ppi tag');
assert.equal(ppi(await enhancePortrait(base, { tone: 'light' })), 72);
assert.equal(ppi(await upgradeToMaster(base)), 72);
assert.equal(ppi(await applyNameplate(master, 'Bella')), 72, 'nameplate output carries the neutral tag');
const meta = await sharp(master).metadata();
assert.equal(`${meta.width}x${meta.height}`, '2400x3600');
const print = await sharp(await makePrintFile(master, { w: 12, h: 18 })).metadata();
assert.equal(`${print.width}x${print.height}`, '3600x5400');
console.log('Download density tags are honest (72 ppi); print file sizing for Printful unchanged.');
