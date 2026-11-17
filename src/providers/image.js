// IMAGE_PROVIDER selects who edits the customer's pet photo. Default stays openai.
import fs from 'node:fs';
import config from '../config.js';
import { editWithOpenAI } from './openai.js';
import { editWithQwen } from './qwen.js';

export async function editWithMock({ photoPath }) {
  return fs.readFileSync(photoPath);
}

export function editorFor(provider = config.image.provider) {
  if (provider === 'mock') return editWithMock;
  if (provider === 'openai') return editWithOpenAI;
  if (provider === 'qwen') return editWithQwen;
  throw new Error(`unknown image provider ${provider}`);
}

export { editWithOpenAI, editWithQwen };
