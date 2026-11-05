// Focused F-25 removal regressions. Optional root supports an isolated copy of
// the real pre-patch manifest/worker; never mutate or stash the working tree.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { isDrawingUrl } from '../src/lib/links-match.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function testNavigation(root = ROOT) {
  const failed = [];
  let total = 0;
  const test = async (name, fn) => {
    total++;
    try { await fn(); console.log(`PASS navigation: ${name}`); }
    catch (e) { failed.push(`navigation: ${name}: ${e.message}`); console.log(`FAIL ${failed.at(-1)}`); }
  };
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  await test('exact storage/contextMenus/scripting and http(s) permissions', () => {
    assert.deepEqual([...manifest.permissions].sort(), ['contextMenus', 'scripting', 'storage']);
    assert.deepEqual([...manifest.host_permissions].sort(), ['http://*/*', 'https://*/*']);
  });
  await test('viewer is not exposed as a web-accessible redirect target', () => {
    assert.ok(!manifest.web_accessible_resources?.length);
  });

  const listeners = {}, created = [], updated = [], menus = [], dnrCalls = [];
  const contexts = [], focused = [], session = {};
  const event = (key) => ({ addListener: (fn) => (listeners[key] ??= []).push(fn) });
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://test/${p}`, setUninstallURL() {}, onInstalled: event('install'), onMessage: event('message'),
      getContexts: async (filter) => contexts.filter((c) => (!filter.tabIds || filter.tabIds.includes(c.tabId)) && (!filter.contextTypes || filter.contextTypes.includes(c.contextType))) },
    tabs: { create: async (p) => { created.push(p); return {id: 99}; }, update: async (id, p) => updated.push({id, ...p}), query: async () => [], get: async (id) => ({id, windowId: 7}) },
    windows: { update: async (id, p) => focused.push({id, ...p}) },
    storage: { local: { get: async () => ({interceptLinks: false}) }, onChanged: event('storage'), session: {
      get: async () => ({...session}), set: async (data) => Object.assign(session, data),
    } },
    scripting: { executeScript: async () => {} },
    contextMenus: { removeAll: (cb) => cb(), create: (p) => menus.push(p), onClicked: event('menu') },
    i18n: {getMessage: () => ''}, action: {onClicked: event('action')},
    declarativeNetRequest: {
      updateDynamicRules: async (p) => dnrCalls.push(p),
      updateSessionRules: async (p) => dnrCalls.push(p),
    },
  };
  const worker = fs.readFileSync(path.join(root, 'src/background/service-worker.js'), 'utf8');
  vm.runInNewContext(worker.replace(/^import .*;\n/gm, ''), {
    chrome, isDrawingUrl, WELCOME_URL: 'https://test/welcome', UNINSTALL_URL: 'https://test/uninstall',
    setTimeout: () => 0,
  });
  await test('install/update and settings never register request rules', async () => {
    for (const fn of listeners.install ?? []) fn({reason: 'update'});
    await new Promise((r) => setImmediate(r));
    for (const fn of listeners.storage ?? []) fn({interceptLinks: {newValue: true}}, 'local');
    await new Promise((r) => setImmediate(r));
    assert.equal(dnrCalls.length, 0);
    assert.equal((listeners.storage ?? []).length, 0);
    assert.equal(menus[0]?.id, 'open-in-viewer');
    assert.ok(!/\bdeclarativeNetRequest\b/.test(worker), 'worker must not reference request API');
  });
  const sender = {tab: {id: 12, index: 3, windowId: 7}};
  const dispatch = async (type, url, extra = {}) => {
    let response;
    listeners.message[0]({type, url, ...extra}, sender, (r) => {response = r;});
    await new Promise((r) => setImmediate(r));
    return response;
  };
  const url = 'https://test/plan.dwg?token=a%26b#view';
  await test('ordinary and background opens preserve adjacent sender window', async () => {
    created.length = 0;
    assert.equal((await dispatch('open-link', url)).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(created[0])), {
      url: `chrome-extension://test/src/viewer/viewer.html#src=${encodeURIComponent(url)}`, active: true, index: 4, windowId: 7,
    });
    await dispatch('open-link', url, {background: true});
    assert.equal(created[1].active, false);
  });
  await test('context menu works with interception off and stays adjacent', async () => {
    created.length = 0;
    listeners.menu[0]({menuItemId: 'open-in-viewer', linkUrl: url}, sender.tab);
    await new Promise((r) => setImmediate(r));
    assert.equal(created.length, 1);
    assert.equal(created[0].index, 4);
    assert.equal(created[0].windowId, 7);
  });
  await test('Download instead updates sender, no new tab and no bypass rules', async () => {
    created.length = 0; updated.length = 0; dnrCalls.length = 0;
    assert.equal((await dispatch('download-instead', url)).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(updated)), [{id: 12, url}]);
    assert.equal(created.length, 0);
    assert.equal(dnrCalls.length, 0);
  });
  await test('message boundary rejects non-http(s), malformed and non-drawing URLs', async () => {
    created.length = 0; updated.length = 0;
    for (const bad of ['file:///plan.dwg', 'ftp://test/plan.dxf', 'javascript:alert(1)', 'https://test/plan.pdf', 'broken', null]) {
      for (const type of ['open-link', 'download-instead']) {
        assert.equal((await dispatch(type, bad)).ok, false, `${type}: ${bad}`);
      }
    }
    assert.equal(created.length + updated.length, 0);
  });
  await test('icon reuses session tab using ExtensionContext.documentUrl', async () => {
    created.length = 0; updated.length = 0; focused.length = 0;
    session.iconTabId = 44;
    // Chrome ExtensionContext has documentUrl, not url (runtime API schema).
    contexts.splice(0, contexts.length, {contextType: 'TAB', tabId: 44, documentUrl: chrome.runtime.getURL('src/viewer/viewer.html')});
    await listeners.action[0](sender.tab);
    assert.equal(created.length, 0, 'A live icon tab must be focused, not replaced by a duplicate');
    assert.deepEqual(JSON.parse(JSON.stringify(updated)), [{id: 44, active: true}]);
    assert.deepEqual(JSON.parse(JSON.stringify(focused)), [{id: 7, focused: true}]);
  });
  await test('closed icon context opens a fresh adjacent viewer and saves its id', async () => {
    created.length = 0; updated.length = 0; focused.length = 0; contexts.length = 0;
    session.iconTabId = 44;
    await listeners.action[0](sender.tab);
    assert.equal(created.length, 1);
    assert.equal(created[0].index, sender.tab.index + 1);
    assert.equal(session.iconTabId, 99);
    assert.equal(updated.length + focused.length, 0);
  });
  await test('link viewer never takes over the icon tab session memory', async () => {
    created.length = 0; updated.length = 0; focused.length = 0;
    session.iconTabId = 44;
    contexts.splice(0, contexts.length, {contextType: 'TAB', tabId: 44, documentUrl: chrome.runtime.getURL('src/viewer/viewer.html')});
    await dispatch('open-link', url);
    assert.equal(session.iconTabId, 44);
    await listeners.action[0](sender.tab);
    assert.equal(created.length, 1, 'Only the link viewer should have been created');
    assert.equal(session.iconTabId, 44);
    assert.deepEqual(JSON.parse(JSON.stringify(updated)), [{id: 44, active: true}]);
  });
  await test('tabs.create rejection → ok:false → content native fallback', async () => {
    // Always use the current worker for its new rejection response. The input
    // content script comes from root, so the real old callback is the negative
    // control without inducing an unrelated unhandled rejection in the old SW.
    let messageHandler;
    const handlers = {}, native = [];
    const fallbackChrome = {
      ...chrome,
      tabs: {...chrome.tabs, create: async () => {throw new Error('Target window was closed');}},
      runtime: {...chrome.runtime, onMessage: {addListener: (fn) => {messageHandler = fn;}}},
      storage: {...chrome.storage, local: {get: (_key, cb) => cb({interceptLinks: true})}},
    };
    const currentWorker = fs.readFileSync(path.join(ROOT, 'src/background/service-worker.js'), 'utf8');
    vm.runInNewContext(currentWorker.replace(/^import .*;\n/gm, ''), {
      chrome: fallbackChrome, isDrawingUrl, WELCOME_URL: 'https://test/welcome', UNINSTALL_URL: 'https://test/uninstall',
    });
    fallbackChrome.runtime.sendMessage = (msg, callback) => messageHandler(msg, sender, callback);
    class Element {
      constructor() {this.attributes = new Set(); this.tagName = 'A';}
      hasAttribute(name) {return this.attributes.has(name);}
      setAttribute(name) {this.attributes.add(name);}
      click() {native.push({href: this.href, bypass: this.hasAttribute('data-dwg-viewer-bypass')});}
      remove() {}
    }
    const window = {addEventListener: (type, fn) => {handlers[type] = fn;}, removeEventListener() {}};
    const document = {createElement: () => new Element(), documentElement: {appendChild() {}}};
    const content = fs.readFileSync(path.join(root, 'src/content/links.js'), 'utf8');
    vm.runInNewContext(content, {chrome: fallbackChrome, window, document, Element, URL});
    const anchor = new Element(); anchor.href = url;
    let prevented = false;
    handlers.click({type: 'click', button: 0, composedPath: () => [anchor],
      preventDefault: () => {prevented = true;}, stopPropagation() {}});
    assert.equal(prevented, true);
    assert.equal(native.length, 0, 'fallback must follow the async worker rejection');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(native, [{href: url, bypass: true}]);
  });
  return {total, failed};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {total, failed} = await testNavigation(process.argv[2] ? path.resolve(process.argv[2]) : ROOT);
  console.log(`navigation: ${total - failed.length}/${total} passed`);
  process.exitCode = failed.length ? 1 : 0;
}
