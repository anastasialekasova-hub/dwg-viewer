import { WELCOME_URL, UNINSTALL_URL } from '../lib/config.js';
import { isDrawingUrl } from '../lib/links-match.js';

const VIEWER_PAGE = chrome.runtime.getURL('src/viewer/viewer.html');

// F-26: re-arm on every service-worker start (MV3 restarts frequently).
chrome.runtime.setUninstallURL(UNINSTALL_URL);

async function openViewerTab(url, background, sender) {
  const createProps = { url: VIEWER_PAGE + `#src=${encodeURIComponent(url)}`, active: background !== true };
  if (sender?.tab?.index !== undefined) createProps.index = sender.tab.index + 1;
  if (sender?.tab?.windowId !== undefined) createProps.windowId = sender.tab.windowId;
  await chrome.tabs.create(createProps);
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: WELCOME_URL });
  injectIntoOpenTabs();
  setupMenu();
});

async function injectIntoOpenTabs() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/content/links.js'] })
      .catch(() => {});
  }
}

function setupMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'open-in-viewer',
      title: chrome.i18n.getMessage('menuOpen') || 'Open in DWG Viewer',
      contexts: ['link'],
      targetUrlPatterns: [
        'http://*/*.dwg', 'https://*/*.dwg', 'http://*/*.dxf', 'https://*/*.dxf',
        'http://*/*.dwg?*', 'https://*/*.dwg?*', 'http://*/*.dxf?*', 'https://*/*.dxf?*',
      ],
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'open-in-viewer') return;
  const url = info.linkUrl || info.srcUrl || info.pageUrl;
  if (!url || !isDrawingUrl(url)) return;
  openViewerTab(url, false, { tab });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.type !== 'open-link' && msg.type !== 'download-instead') return false;
  if (typeof msg.url !== 'string' || !isDrawingUrl(msg.url)) {
    sendResponse({ ok: false });
    return false;
  }
  // Keep the worker alive until the tab operation completes. Native navigation
  // does not generate a content-script click and needs no interception bypass.
  const task = msg.type === 'open-link'
    ? openViewerTab(msg.url, msg.background === true, sender)
    : sender.tab?.id !== undefined
      ? chrome.tabs.update(sender.tab.id, { url: msg.url })
      : chrome.tabs.create({ url: msg.url });
  Promise.resolve(task).then(
    () => sendResponse({ ok: true }),
    () => sendResponse({ ok: false }),
  );
  return true;
});

// F-16 / F-17: the icon (and Alt+Shift+D) focuses the viewer tab the icon
// opened last, if it is still alive; otherwise it opens one next to the
// current tab. Tabs opened from links never take over this memory.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id !== undefined && typeof tab.url === 'string' && tab.url.startsWith(VIEWER_PAGE)) {
    chrome.tabs.sendMessage(tab.id, { type: 'focus-open' }, () => void chrome.runtime.lastError);
    return;
  }
  try {
    const { iconTabId } = await chrome.storage.session.get('iconTabId');
    if (typeof iconTabId === 'number') {
      const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], tabIds: [iconTabId] });
      if (ctx && typeof ctx.tabId === 'number' && (ctx.documentUrl || '').startsWith(VIEWER_PAGE)) {
        await chrome.tabs.update(iconTabId, { active: true });
        const t = await chrome.tabs.get(iconTabId).catch(() => null);
        if (t?.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true });
        return;
      }
    }
  } catch {
    // getContexts unavailable or the context list raced a tab close: open fresh
  }
  const createProps = { url: VIEWER_PAGE, active: true };
  if (tab?.index !== undefined) createProps.index = tab.index + 1;
  const t = await chrome.tabs.create(createProps);
  chrome.storage.session.set({ iconTabId: t.id }).catch(() => {});
});
