// One PDF of the completed contract: the cancellation sentence, in bold, once,
// directly above a single signature block, then the Notice of Cancellation twice.
// Standard Helvetica with WinAnsiEncoding so § and other Latin-1 characters render.
import crypto from 'node:crypto';
import { UNSIGNED_CANCEL_DEADLINE } from './croa-docs.js';

const FONT = 10;
const LEADING = 15;
const LEFT = 54;
const TOP = 740;
const BOTTOM = 54;
const MAX_CHARS = 82;

export const CANCEL_SENTENCE = 'You may cancel this contract without penalty or obligation at any time before midnight of the 3rd business day after the date on which you signed the contract. See the attached notice of cancellation form for an explanation of this right.';

const WINANSI = {
  '\u00A7': '\\247',
  '\u2014': '\\227',
  '\u2013': '\\226',
  '\u2018': '\\221',
  '\u2019': '\\222',
  '\u201C': '\\223',
  '\u201D': '\\224',
  '\u2026': '\\205',
  '\u2022': '\\225',
  '\u00A0': ' ',
  '\u00B7': '\\267'
};

export function pdfStr(s) {
  let out = '';
  for (const ch of String(s || '')) {
    if (WINANSI[ch]) { out += WINANSI[ch]; continue; }
    const cp = ch.codePointAt(0);
    if (cp === 92 || cp === 40 || cp === 41) { out += '\\' + ch; continue; }
    if (cp >= 32 && cp <= 126) { out += ch; continue; }
    if (cp >= 160 && cp <= 255) { out += '\\' + cp.toString(8).padStart(3, '0'); continue; }
    out += '?';
  }
  return out;
}

function breakToken(token, width) {
  if (token.length <= width) return [token];
  const parts = [];
  for (let i = 0; i < token.length; i += width) parts.push(token.slice(i, i + width));
  return parts;
}

function wrapParagraph(para, bold) {
  const clean = String(para || '').replace(/\*\*/g, '').trim();
  if (!clean) return [{ text: '', bold: false }];
  const lines = [];
  let line = '';
  const push = (value) => { if (value) lines.push({ text: value, bold }); };
  clean.split(/\s+/).forEach(word => {
    breakToken(word, MAX_CHARS).forEach(piece => {
      const next = (line + ' ' + piece).trim();
      if (next.length > MAX_CHARS) { push(line); line = piece; }
      else line = next;
    });
  });
  push(line);
  return lines.length ? lines : [{ text: '', bold: false }];
}

function wrapBlocks(blocks) {
  const lines = [];
  blocks.forEach(block => {
    String(block.text || '').split('\n').forEach(para => {
      wrapParagraph(para, !!block.bold).forEach(line => lines.push(line));
    });
  });
  return lines;
}

function paginate(lines) {
  const pages = [];
  let page = [];
  let y = TOP;
  lines.forEach(line => {
    if (y < BOTTOM) { pages.push(page); page = []; y = TOP; }
    page.push({ text: line.text, bold: line.bold, y });
    y -= LEADING;
  });
  if (page.length || !pages.length) pages.push(page);
  return pages;
}

function pageStream(lines) {
  return lines.filter(line => line.text).map(line => {
    const font = line.bold ? 'F2' : 'F1';
    return `BT /${font} ${FONT} Tf ${LEFT} ${line.y} Td (${pdfStr(line.text)}) Tj ET`;
  }).join('\n');
}

export function buildPdf(pageLines) {
  const streams = pageLines.map(pageStream);
  const n = streams.length;
  const font1Id = 3 + n * 2;
  const font2Id = font1Id + 1;
  const kids = [];
  for (let i = 0; i < n; i++) kids.push(`${4 + i * 2} 0 R`);
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`);
  streams.forEach((stream, i) => {
    const contentId = 3 + i * 2;
    const body = stream || 'BT ET';
    objs.push(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >> >> /Contents ${contentId} 0 R >>`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function paginateKeeping(bodyLines, closingLines) {
  const pages = [];
  let page = [];
  let y = TOP;
  const pushPage = () => { if (page.length) pages.push(page); page = []; y = TOP; };
  bodyLines.forEach(line => {
    if (y < BOTTOM) pushPage();
    page.push({ text: line.text, bold: line.bold, y });
    y -= LEADING;
  });
  const lastY = y - Math.max(0, closingLines.length - 1) * LEADING;
  if (page.length && lastY < BOTTOM) pushPage();
  closingLines.forEach(line => {
    if (y < BOTTOM) pushPage();
    page.push({ text: line.text, bold: line.bold, y });
    y -= LEADING;
  });
  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}

function layout(blocks) {
  return paginate(wrapBlocks(blocks));
}

export function contractBodyWithoutSignature(contract) {
  const text = String(contract || '');
  const at = text.indexOf('You may cancel this contract without penalty or obligation');
  if (at >= 0) {
    const start = text.slice(Math.max(0, at - 2), at) === '**' ? at - 2 : at;
    return text.slice(0, start).trimEnd();
  }
  return text.replace(/\n*Client typed name \(signature\):[\s\S]*$/, '').trimEnd();
}

function fillNotice(notice, { deadlineLabel }) {
  const label = deadlineLabel || '';
  return String(notice || '').replace(/\[DATE:[^\]]*\]/g, label).replaceAll(UNSIGNED_CANCEL_DEADLINE, label);
}

export function buildContractPackagePdf({ contract, notice, clientName, signedLabel, deadlineLabel }) {
  const body = contractBodyWithoutSignature(contract);
  const signature = `Client typed name (signature): ${clientName}\nDate signed: ${signedLabel}`;
  const closingLines = wrapBlocks([
    { text: '', bold: false },
    { text: CANCEL_SENTENCE, bold: true },
    { text: '', bold: false },
    { text: signature, bold: false }
  ]);
  const contractPages = paginateKeeping(wrapBlocks([{ text: body, bold: false }]), closingLines);
  const filled = fillNotice(notice, { deadlineLabel });
  const noticePages = layout([{ text: filled, bold: true }]);
  const pdf = buildPdf([...contractPages, ...noticePages, ...noticePages]);
  return { pdf, sha256: crypto.createHash('sha256').update(pdf).digest('hex') };
}

export function buildSamplePdf(code) {
  const pages = layout([{ text: `Credit Ledger sample document\n\nYour code is ${code}\n\nIf you can read this code, you can open the PDF copies of your records.`, bold: false }]);
  const pdf = buildPdf(pages);
  return { pdf, code };
}

function decodePdfLiteral(raw) {
  return raw.replace(/\\([0-7]{1,3})|\\(.)/g, (all, oct, esc) => {
    if (oct) return String.fromCharCode(parseInt(oct, 8));
    if (esc === 'n') return '\n';
    if (esc === 'r') return '\r';
    if (esc === 't') return '\t';
    return esc || '';
  });
}

/** Pull drawn text and y positions out of a PDF this module wrote. */
export function readPdfPages(pdf) {
  const src = Buffer.isBuffer(pdf) ? pdf.toString('latin1') : String(pdf);
  const pages = [];
  const streams = src.split(/endstream/);
  streams.forEach(chunk => {
    const start = chunk.lastIndexOf('stream\n');
    if (start < 0) return;
    const body = chunk.slice(start + 7);
    const lines = [];
    const re = /\/(F[12])\s+\d+\s+Tf\s+\d+\s+(\d+)\s+Td\s+\(((?:\\[0-7]{1,3}|\\.|[^\\)])*)\)\s*Tj/g;
    let m;
    while ((m = re.exec(body))) lines.push({ font: m[1], y: Number(m[2]), text: decodePdfLiteral(m[3]) });
    if (lines.length) pages.push(lines);
  });
  return pages;
}

export function extractPdfText(pdf) {
  return readPdfPages(pdf).flat().map(line => line.text).join('\n');
}
