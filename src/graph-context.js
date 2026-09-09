export function graphName(host) {
  const name = host?.roamAlphaAPI?.graph?.name;
  if (typeof name === 'string' && name) return name;
  const match = String(host?.location?.hash || '').match(/^#\/app\/([^/?#]+)/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch (_error) { return ''; }
}
