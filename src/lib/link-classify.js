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
