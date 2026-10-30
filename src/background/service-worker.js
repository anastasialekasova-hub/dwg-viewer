import { WELCOME_URL, UNINSTALL_URL } from '../lib/config.js';
import { isDrawingUrl } from '../lib/links-match.js';

const DNR_RULE_ID = 1;
const DNR_ALLOW_ID = 2;
const ALLOW_MS = 60_000;

const VIEWER_PAGE = chrome.runtime.getURL('src/viewer/viewer.html');

// F-26: the uninstall page is re-armed on every service-worker start, not
// only on install/update events (the worker restarts often; MV3 forgets).
chrome.runtime.setUninstallURL(UNINSTALL_URL);

function viewerUrlFor(url, hashKey) {
  return VIEWER_PAGE + `#${hashKey}=${encodeURIComponent(url)}`;
}

async function openViewerTab(url, background, sender) {
  const createProps = { url: viewerUrlFor(url, 'src'), active: background !== true };
  if (sender?.tab?.index !== undefined) createProps.index = sender.tab.index + 1;
  await chrome.tabs.create(createProps);
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: WELCOME_URL });
  injectIntoOpenTabs();
  setupMenu();
  syncDnrRules();
});

// F-18 / F-22: link interception is on by default and the settings toggle
// turns the DNR navigation rule off (and back on) live, in every tab.
async function syncDnrRules() {
  const on = (await chrome.storage.local.get('interceptLinks')).interceptLinks !== false;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [DNR_RULE_ID],
    addRules: on ? [dnrRule()] : [],
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'interceptLinks' in changes) syncDnrRules().catch(() => {});
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
  openViewerTab(url, false, tab);
});

function dnrRule() {
  return {
    id: DNR_RULE_ID,
    priority: 1,
    condition: {
      regexFilter: '^https?://[^?#]*\\.(dwg|dxf)([?#].*)?',
      isUrlFilterCaseSensitive: false,
      resourceTypes: ['main_frame'],
    },
    action: {
      type: 'redirect',
      redirect: { regexSubstitution: VIEWER_PAGE + '#raw=\\0' },
    },
  };
}

async function allowDownloadOnce(url, tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [DNR_ALLOW_ID],
    addRules: [
      {
        id: DNR_ALLOW_ID,
        priority: 2,
        condition: { urlFilter: url, resourceTypes: ['main_frame'] },
        action: { type: 'allow' },
      },
    ],
  });
  setTimeout(() => {
    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [DNR_ALLOW_ID] }).catch(() => {});
  }, ALLOW_MS);
  if (tabId !== undefined) await chrome.tabs.update(tabId, { url });
  else await chrome.tabs.create({ url });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.type === 'open-link') {
    if (typeof msg.url === 'string' && isDrawingUrl(msg.url)) {
      openViewerTab(msg.url, msg.background === true, sender);
    }
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'download-instead') {
    if (typeof msg.url === 'string' && isDrawingUrl(msg.url)) {
      allowDownloadOnce(msg.url, sender.tab?.id);
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
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
      if (ctx && typeof ctx.tabId === 'number' && (ctx.url || '').startsWith(VIEWER_PAGE)) {
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
