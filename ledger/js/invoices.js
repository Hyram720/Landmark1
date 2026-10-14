/*
 * Invoice documents: a numbered invoice as a real PDF file (no libraries — a small PDF writer
 * using the built-in Helvetica fonts), plus the plain-text version used in emails.
 * Works in the browser and on the server.
 */
(function (root) {
  'use strict';

  const money = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = d => { if (!d) return ''; const x = new Date(String(d).slice(0, 10) + 'T00:00:00'); return isNaN(x) ? String(d) : x.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); };

  /** Stable human-readable invoice number, e.g. INV-20261014-4F2A. */
  function number(inv) {
    if (inv.number) return inv.number;
    const d = String(inv.issuedAt || '').replace(/-/g, '').slice(0, 8) || '00000000';
    return `INV-${d}-${String(inv.id || '').replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase()}`;
  }

  function lines(inv) {
    if (Array.isArray(inv.lines) && inv.lines.length) return inv.lines;
    return [{ description: inv.description, amount: Number(inv.amount) || 0 }];
  }

  function payUrl(inv, origin) { return inv.payToken && origin ? `${origin}/pay/${inv.payToken}` : ''; }

  /** Plain-text invoice (email body / fallback). */
  function text(ws, inv, opts) {
    opts = opts || {};
    const co = ws.settings.company || {};
    const c = ws.clients.find(x => x.id === inv.clientId) || {};
    const pay = opts.payLink || payUrl(inv, opts.origin);
    return [
      `${co.name || ''}`, co.address || '', [co.phone, co.email].filter(Boolean).join(' · '), '',
      `INVOICE ${number(inv)}`, `Issued: ${fmtDate(inv.issuedAt)}`, inv.dueAt ? `Due: ${fmtDate(inv.dueAt)}` : '', `Status: ${inv.status === 'paid' ? 'PAID ' + fmtDate(inv.paidAt) : inv.status}`, '',
      `Bill to: ${c.name || ''}`, '',
      ...lines(inv).map(l => `${l.description} — ${money(l.amount)}`),
      `Service completed: ${fmtDate(inv.serviceCompletedAt)}`, '', `TOTAL: ${money(inv.amount)}`, '',
      pay && inv.status !== 'paid' ? `Pay online: ${pay}` : '',
      'This invoice is for services already performed. No fees are charged in advance of services (15 U.S.C. § 1679b(b)).'
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  }

  // ---------- minimal PDF writer ----------
  const WIN = { '’': '\x92', '‘': '\x91', '“': '\x93', '”': '\x94', '—': '\x97', '–': '\x96', '•': '\x95', '…': '\x85' };
  function pdfStr(s) {
    return String(s).replace(/[‘’“”–—•…]/g, ch => WIN[ch]).replace(/[^\x00-\xFF]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
  function wrap(s, max) {
    const out = [];
    String(s || '').split('\n').forEach(par => {
      let line = '';
      par.split(/\s+/).forEach(w => { if ((line + ' ' + w).trim().length > max) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim(); });
      out.push(line);
    });
    return out;
  }
  /** Approximate Helvetica width (points) for right-aligning numbers. */
  const width = (s, size) => String(s).length * size * 0.53;

  /** Returns the PDF as a binary string (each char = one byte). */
  function pdf(ws, inv, opts) {
    opts = opts || {};
    const co = ws.settings.company || {};
    const c = ws.clients.find(x => x.id === inv.clientId) || {};
    const ops = [];
    const t = (x, y, s, size, bold, gray) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${gray ? '0.4 g' : '0 g'} ${x} ${y} Td (${pdfStr(s)}) Tj ET`);
    const rect = (x, y, w, h, g) => ops.push(`${g} g ${x} ${y} ${w} ${h} re f 0 g`);
    const line = (x1, y1, x2, y2) => ops.push(`0.8 G 0.75 w ${x1} ${y1} m ${x2} ${y2} l S 0 G`);
    const L = 56, R = 556;
    let y = 740;
    t(L, y, co.name || 'Invoice', 18, true);
    t(R - width('INVOICE', 20) - 6, y, 'INVOICE', 20, true);
    y -= 18;
    String(co.address || '').split('\n').filter(Boolean).forEach(a => { t(L, y, a, 10, false, true); y -= 13; });
    [co.phone, co.email, co.website].filter(Boolean).forEach(a => { t(L, y, a, 10, false, true); y -= 13; });
    const meta = [['Invoice #', number(inv)], ['Issued', fmtDate(inv.issuedAt)], ['Due', fmtDate(inv.dueAt) || 'On receipt'], ['Status', inv.status === 'paid' ? 'PAID' : inv.status === 'void' ? 'VOID' : 'Due']];
    let my = 722;
    meta.forEach(([k, v]) => { t(380, my, k, 9, false, true); t(450, my, v, 10, k === 'Status'); my -= 15; });
    y = Math.min(y, my) - 18;
    line(L, y, R, y); y -= 22;
    t(L, y, 'BILL TO', 9, true, true); y -= 15;
    t(L, y, c.name || '', 11, true); y -= 14;
    [c.address, [c.city, c.state].filter(Boolean).join(', ') + (c.zip ? ' ' + c.zip : ''), c.email].filter(x => x && x.trim()).forEach(a => { t(L, y, a, 10); y -= 13; });
    y -= 16;
    rect(L, y - 6, R - L, 22, 0.94);
    t(L + 8, y, 'DESCRIPTION', 9, true, true); t(360, y, 'SERVICE COMPLETED', 9, true, true); t(R - 8 - width('AMOUNT', 9) * 1.3, y, 'AMOUNT', 9, true, true);
    y -= 26;
    lines(inv).forEach(l => {
      const ws_ = wrap(l.description, 52);
      ws_.forEach((s, i) => { t(L + 8, y - i * 13, s, 10); });
      t(360, y, fmtDate(inv.serviceCompletedAt), 10);
      const amt = money(l.amount);
      t(R - 8 - width(amt, 10), y, amt, 10);
      y -= 13 * ws_.length + 10;
      line(L, y + 4, R, y + 4);
      y -= 10;
    });
    const total = money(inv.amount);
    t(360, y, 'Total', 11, true); t(R - 8 - width(total, 12), y, total, 12, true);
    y -= 34;
    const pay = opts.payLink || payUrl(inv, opts.origin);
    if (inv.status === 'paid') { t(L, y, `Paid ${fmtDate(inv.paidAt)}${inv.transId ? ' (transaction ' + inv.transId + ')' : ''}. Thank you!`, 11, true); y -= 24; }
    else if (pay) { t(L, y, 'Pay online:', 10, true); t(L + 62, y, pay, 10); y -= 24; }
    if (inv.notes) { wrap(inv.notes, 95).forEach(s => { t(L, y, s, 9.5); y -= 12.5; }); y -= 10; }
    wrap('This invoice is for services already performed. No fees are charged in advance of services (15 U.S.C. § 1679b(b)). You may contact us with any question about this invoice.', 118).forEach(s => { t(L, y, s, 8.5, false, true); y -= 11; });
    if (co.registration || co.bondNumber) t(L, 40, [co.registration && 'Registration ' + co.registration, co.bondNumber && 'Bond ' + co.bondNumber].filter(Boolean).join(' · '), 8, false, true);

    const content = ops.join('\n');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      `<< /Title (${pdfStr('Invoice ' + number(inv))}) /Producer (Ledger) >>`
    ];
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return out;
  }

  /** PDF as bytes (Uint8Array). */
  function pdfBytes(ws, inv, opts) {
    const s = pdf(ws, inv, opts);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  }

  const filename = (ws, inv) => { const c = ws.clients.find(x => x.id === inv.clientId) || {}; return `${number(inv)}-${String(c.name || 'client').replace(/[^A-Za-z0-9]+/g, '-')}.pdf`; };

  const api = { number, text, pdf, pdfBytes, filename, money, payUrl };
  root.Invoices = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
