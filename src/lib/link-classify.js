// Card 4 classification (ТЗ 7.5): a link response is either the drawing, a
// sign-in page (auth), an oversized body (size), or something else (generic).
import { LINK_LIMIT_MB } from './config.js';

export const LINK_LIMIT_BYTES = LINK_LIMIT_MB * 1e6;

export function classifyLinkStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status >= 200 && status < 300) return null;
  return 'generic';
}

export function isHtmlContentType(ct) {
  return `${ct ?? ''}`.toLowerCase().includes('text/html');
}

// The sign-in phrase fits when the site answered HTML to a file request — but
// a 404 page is HTML too on GitHub and many sites, and then the file simply
// does not exist (live review 30.10, shots/27-dead-in-viewer.png). The 404
// takes the generic branch: no "The site may need you to sign in."
export function isAuthHtml(status, ct) {
  return status !== 404 && isHtmlContentType(ct);
}

export function looksLikeHtml(headBytes) {
  const head = new TextDecoder('latin1')
    .decode(headBytes.subarray(0, 64))
    .trimStart()
    .toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

export function isOverLinkLimit(totalBytes) {
  return totalBytes > LINK_LIMIT_BYTES;
}
