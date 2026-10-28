export const SETTINGS_VERSION = 1;

export const SETTINGS_DEFAULTS = {
  version: 1,
  interceptLinks: true,
  background: 'dark',
  hintSeen: false,
  linkNoticeSeen: false,
};

export function migrateSettings(raw) {
  const out = { ...SETTINGS_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.interceptLinks === 'boolean') out.interceptLinks = raw.interceptLinks;
  if (raw.background === 'dark' || raw.background === 'light') out.background = raw.background;
  if (typeof raw.hintSeen === 'boolean') out.hintSeen = raw.hintSeen;
  if (typeof raw.linkNoticeSeen === 'boolean') out.linkNoticeSeen = raw.linkNoticeSeen;
  return out;
}

export async function loadSettings() {
  const raw = await chrome.storage.local.get(null);
  return migrateSettings(raw);
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = migrateSettings({ ...current, ...patch });
  await chrome.storage.local.set(next);
  return next;
}
