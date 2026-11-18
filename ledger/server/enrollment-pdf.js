// One PDF of the completed contract: bold cancellation sentence above the signature,
// then the Notice of Cancellation twice. No third-party PDF library.
import crypto from 'node:crypto';

function pdfStr(s) {
  return String(s || '').replace(/[^\x20-\x7E]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(text, width) {
  const lines = [];
  String(text || '').split('\n').forEach(para => {
    const clean = para.replace(/\*\*/g, '');
    if (!clean.trim()) { lines.push(''); return; }
    let line = '';
    clean.split(/\s+/).forEach(word => {
      const next = (line + ' ' + word).trim();
      if (next.length > width) { if (line) lines.push(line); line = word; }
      else line = next;
    });
    if (line) lines.push(line);
  });
  return lines;
}

function pageStream(lines, { boldAll = false } = {}) {
  const ops = [];
  let y = 740;
  lines.forEach(line => {
    const bold = boldAll || /You may cancel this contract without penalty/.test(line) || /Notice of Cancellation/.test(line);
    const text = line.replace(/\*\*/g, '');
    const font = bold ? 'F2' : 'F1';
    ops.push(`BT /${font} 10 Tf 56 ${y} Td (${pdfStr(text)}) Tj ET`);
    y -= 14;
    if (y < 56) y = 740;
  });
  return ops.join('\n');
}

export function buildPdf(pagesText) {
  const streams = pagesText.map(text => {
    return pageStream(wrap(text, 90), { boldAll: text.includes('Notice of Cancellation') });
  });
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
    objs.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >> >> /Contents ${contentId} 0 R >>`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function fillNotice(notice, { clientName, signedLabel, deadlineLabel }) {
  return String(notice || '')
    .replace(/\[DATE:[^\]]*\]/g, deadlineLabel)
    .replace(/\[date\]/gi, signedLabel)
    .replace(/\[purchaser's signature\]/gi, clientName)
    .replace(/\[CLIENT FULL NAME\]/g, clientName);
}

export function buildContractPackagePdf({ contract, notice, clientName, signedLabel, deadlineLabel }) {
  const boldLine = 'You may cancel this contract without penalty or obligation at any time before midnight of the 3rd business day after the date on which you signed the contract. See the attached notice of cancellation form for an explanation of this right.';
  const contractPage = `${contract}\n\n${boldLine}\n\nClient typed name: ${clientName}\nDate signed: ${signedLabel}\nCancel by: ${deadlineLabel}`;
  const filled = fillNotice(notice, { clientName, signedLabel, deadlineLabel });
  const pdf = buildPdf([contractPage, filled, filled]);
  return { pdf, sha256: crypto.createHash('sha256').update(pdf).digest('hex') };
}

export function buildSamplePdf(code) {
  const pdf = buildPdf([`Credit Ledger sample document\n\nYour code is ${code}\n\nIf you can read this code, you can open the PDF copies of your records.`]);
  return { pdf, code };
}
