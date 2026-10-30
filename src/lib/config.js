export const WELCOME_URL =
  'https://anastasialekasova-hub.github.io/dwg-viewer-pages/welcome/';
export const UNINSTALL_URL =
  'https://anastasialekasova-hub.github.io/dwg-viewer-pages/uninstall/';
export const FEEDBACK_URL =
  'https://anastasialekasova-hub.github.io/dwg-viewer-pages/feedback/';
export const STORE_REVIEWS_URL = (id = chrome.runtime.id) =>
  `https://chromewebstore.google.com/detail/${id}/reviews`;
export const PRIVACY_URL = 'https://pinwisp.com/dwg-viewer/privacy/';
export const SOURCE_URL = 'https://github.com/anastasialekasova-hub/dwg-viewer';
export const OPEN_TIME_LIMIT_S = 60;
// Ana's E1 decision (30.10): 20 MB until the font remeasure (4.2.9).
export const LINK_LIMIT_MB = 20;
export const REVIEW_MIN_USEFUL_DAYS = 5;
export const REVIEW_MIN_SECONDS = 60;
export const REVIEW_SNOOZE_DAYS = 30;
