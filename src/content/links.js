// Classic script (manifest content_scripts, document_start, all_frames).
// No imports. Intercepts clicks on links to .dwg/.dxf documents and hands
// them to the service worker (open-link). A newer instance takes over from
// an older one via a window marker and a hello broadcast.
(() => {
  'use strict';
  const MARK = Symbol.for('dwg-viewer:content');

  let gate = true;
  let alive = true;

  // Exactly one live handler per frame (ТЗ 6.3): the previous instance is
  // deactivated synchronously here — both instances share the same isolated
  // world and the same window marker, so no broadcast is needed. (A
  // postMessage hello killed every instance including its own sender: the
  // sender heard its own hello and went dead — E2 e2e case 2 caught this.)
  const prev = window[MARK];
  if (prev && typeof prev.deactivate === 'function') prev.deactivate();

  try {
    chrome.storage.local.get('interceptLinks', (v) => {
      if (v && v.interceptLinks === false) gate = false;
    });
  } catch {
    gate = false;
  }
  // F-22: the settings toggle acts on tabs that are already open, without
  // a reload (storage.onChanged reaches isolated worlds). A missing listener
  // surface must not disable interception — the gate above still works.
  try {
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && 'interceptLinks' in changes) {
        gate = changes.interceptLinks.newValue !== false;
      }
    });
  } catch {
    // live toggle-off then requires the tab to reload
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
    chrome.runtime.sendMessage({ type: 'open-link', url: anchor.href, background }, (response) => {
      if (chrome.runtime.lastError || response?.ok === false) nativeFallback(anchor.href, background);
    });
  }

  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);

  window[MARK] = {
    // Diagnostics for the e2e harness (reads only, no behavior).
    state: () => ({ gate, alive }),
    deactivate() {
      alive = false;
      gate = false;
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('auxclick', onClick, true);
    },
  };
})();
