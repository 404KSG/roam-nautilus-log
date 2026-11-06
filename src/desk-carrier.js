/* Read-only recognition for native Desk block-embed carriers. */
const UID = '[A-Za-z0-9_-]{6,255}';
const CARRIER_SOURCE = String.raw`\{\{\s*(?:embed-path|embed|\[\[\s*(?:embed-path|embed)\s*\]\])\s*:\s*\(\((${UID})\)\)(?:\s+closed)?\s*\}\}`;
const carrierToken = () => new RegExp(CARRIER_SOURCE, 'g');
const carrierExact = () => new RegExp(String.raw`^\s*${CARRIER_SOURCE}\s*$`);

function deskCodeSegments(value, prose, code = part => part) {
  const source = String(value || ''); let output = '', cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('`', cursor);
    if (start < 0) return output + prose(source.slice(cursor));
    output += prose(source.slice(cursor, start));
    let tickEnd = start; while (source[tickEnd] === '`') tickEnd++;
    const ticks = source.slice(start, tickEnd); let close = source.indexOf(ticks, tickEnd);
    while (close >= 0 && (source[close - 1] === '`' || source[close + ticks.length] === '`')) close = source.indexOf(ticks, close + ticks.length);
    if (close < 0) return output + code(source.slice(start));
    output += code(source.slice(start, close + ticks.length)); cursor = close + ticks.length;
  }
  return output;
}

function deskCarrierUid(value) {
  if (typeof value !== 'string' || value.includes('`')) return null;
  return carrierExact().exec(value)?.[1] || null;
}

function replaceDeskCarriers(value, replace) {
  return deskCodeSegments(value, prose => prose.replace(carrierToken(), (token, uid) => replace(token, uid)));
}

module.exports = { CARRIER_SOURCE, carrierToken, deskCarrierUid, replaceDeskCarriers, deskCodeSegments };
