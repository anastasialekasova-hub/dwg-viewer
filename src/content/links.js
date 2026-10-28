// Classic script (manifest content_scripts, document_start, all_frames).
// No imports. Intercepts clicks on links to .dwg/.dxf documents and hands
// them to the service worker (open-link). A newer instance takes over from
// an older one via a window marker and a hello broadcast.
(() => {
  'use strict';
  const MARK = Symbol.for('dwg-viewer:content');
  const HELLO = 'dwg-viewer:hello';

  const prev = window[MARK];
  if (prev && typeof prev.deactivate === 'function') prev.deactivate();

  let gate = true;
  let alive = true;

  const onHello = (event) => {
    if (event.source === window && event.data && event.data.type === HELLO) alive = false;
  };
  window.addEventListener('message', onHello);
  window.postMessage({ type: HELLO }, window.location.origin);

  try {
    chrome.storage.local.get('interceptLinks', (v) => {
      if (v && v.interceptLinks === false) gate = false;
    });
  } catch {
    gate = false;
  }

  function isDrawingUrl(url) {
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

  function bypassed(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const node of path) {
      if (node instanceof Element && node.hasAttribute && node.hasAttribute('data-dwg-viewer-bypass')) {
        return true;
      }
    }
    return false;
  }

  function anchorFrom(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path) {
      if (node && node.tagName === 'A' && node.href) {
        if (node.hasAttribute && node.hasAttribute('data-dwg-viewer-bypass')) return null;
        return node;
      }
    }
    return null;
  }

  function nativeFallback(href, background) {
    const a = document.createElement('a');
    a.href = href;
    a.setAttribute('data-dwg-viewer-bypass', '');
    if (background) a.target = '_blank';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
  }

  function onClick(event) {
    if (!gate || !alive) return;
    if (event.altKey || event.defaultPrevented) return;
    if (event.type === 'auxclick' && event.button !== 1) return;
    const anchor = anchorFrom(event);
    if (!anchor || !isDrawingUrl(anchor.href) || bypassed(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const background = event.type === 'auxclick' || event.ctrlKey || event.metaKey;
    chrome.runtime.sendMessage({ type: 'open-link', url: anchor.href, background }, () => {
      if (chrome.runtime.lastError) nativeFallback(anchor.href, background);
    });
  }

  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);

  window[MARK] = {
    deactivate() {
      alive = false;
      gate = false;
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('auxclick', onClick, true);
      window.removeEventListener('message', onHello);
    },
  };
})();
