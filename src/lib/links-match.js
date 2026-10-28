export function isDrawingUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  let path;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    path = parsed.pathname;
  }
  const lower = path.toLowerCase();
  return lower.endsWith('.dwg') || lower.endsWith('.dxf');
}
