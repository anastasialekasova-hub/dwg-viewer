import { WELCOME_URL, UNINSTALL_URL } from '../lib/config.js';
import { isDrawingUrl } from '../lib/links-match.js';

const DNR_RULE_ID = 1;
const DNR_ALLOW_ID = 2;
const ALLOW_MS = 60_000;

const VIEWER_PAGE = chrome.runtime.getURL('src/viewer/viewer.html');

function viewerUrlFor(url, hashKey) {
  return VIEWER_PAGE + `#${hashKey}=${encodeURIComponent(url)}`;
}

async function openViewerTab(url, background, sender) {
  const createProps = { url: viewerUrlFor(url, 'src'), active: background !== true };
  if (sender?.tab?.index !== undefined) createProps.index = sender.tab.index + 1;
  await chrome.tabs.create(createProps);
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.runtime.setUninstallURL(UNINSTALL_URL);
  if (reason === 'install') chrome.tabs.create({ url: WELCOME_URL });
  injectIntoOpenTabs();
  setupMenu();
  installDnrRules();
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

async function installDnrRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [DNR_RULE_ID],
    addRules: [
      {
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
      },
    ],
  });
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

chrome.action.onClicked.addListener((tab) => {
  if (tab?.id !== undefined && typeof tab.url === 'string' && tab.url.startsWith(VIEWER_PAGE)) {
    chrome.tabs.sendMessage(tab.id, { type: 'focus-open' }, () => void chrome.runtime.lastError);
    return;
  }
  const createProps = { url: VIEWER_PAGE, active: true };
  if (tab?.index !== undefined) createProps.index = tab.index + 1;
  chrome.tabs.create(createProps);
});
