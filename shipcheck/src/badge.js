// README badge ("ShipCheck | 92/100"). Every paid customer who adds it advertises us on their repo.
// Badges use their own public id so the private report link is never exposed.
const colorFor = (score) => (score >= 90 ? '#16a34a' : score >= 60 ? '#ca8a04' : '#dc2626');

export function badgeSvg(score) {
  const label = 'ShipCheck';
  const value = score === null ? 'unknown' : `${score}/100`;
  // Rough Verdana 11px widths; good enough for a two-part flat badge.
  const lw = 8 + label.length * 7;
  const vw = 10 + value.length * 7;
  const w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#24292f"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${score === null ? '#6b7280' : colorFor(score)}"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14">${label}</text>
    <text x="${lw + vw / 2}" y="14">${value}</text>
  </g>
</svg>`;
}
