// Rating widget logic (F-27, ТЗ 7.6): pure functions over the `review` record
// in chrome.storage.local. Unit-tested in tools/test.js (ТЗ 10.2).
import {
  FEEDBACK_URL,
  STORE_REVIEWS_URL,
  REVIEW_MIN_USEFUL_DAYS,
  REVIEW_MIN_SECONDS,
  REVIEW_SNOOZE_DAYS,
} from './config.js';

export const REVIEW_DEFAULTS = {
  version: 1,
  usefulDays: 0, // local days with at least one drawing drawn without an error card
  lastUsefulDay: '', // 'YYYY-MM-DD' local
  answered: false, // any star click → true, forever
  dismissals: 0, // «Not now» count; 2 → never again
  snoozeUntil: 0, // ms epoch; first «Not now» → now + 30 days
};

// Strict like migrateSettings: unknown fields dropped, wrong types → defaults.
export function migrateReview(raw) {
  const out = { ...REVIEW_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.usefulDays === 'number' && Number.isFinite(raw.usefulDays) && raw.usefulDays >= 0) {
    out.usefulDays = Math.floor(raw.usefulDays);
  }
  if (typeof raw.lastUsefulDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastUsefulDay)) {
    out.lastUsefulDay = raw.lastUsefulDay;
  }
  if (typeof raw.answered === 'boolean') out.answered = raw.answered;
  if (typeof raw.dismissals === 'number' && Number.isFinite(raw.dismissals) && raw.dismissals >= 0) {
    out.dismissals = Math.floor(raw.dismissals);
  }
  if (typeof raw.snoozeUntil === 'number' && Number.isFinite(raw.snoozeUntil) && raw.snoozeUntil >= 0) {
    out.snoozeUntil = raw.snoozeUntil;
  }
  return out;
}

function localDay(now = new Date()) {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

// A useful day: at least one drawing reached the view without an error card.
// Counted once per local day — two drawings on the same day add +1 total.
export function recordUsefulDay(review, now = new Date()) {
  const r = migrateReview(review);
  const day = localDay(now);
  if (r.lastUsefulDay === day) return r;
  return { ...r, usefulDays: r.usefulDays + 1, lastUsefulDay: day };
}

// Every F-27 condition at once (ТЗ 10.2 tests each separately and together).
export function shouldShow(review, { now = Date.now(), fullyDrawn = true, msSinceOpen = 0, screen = 'view' } = {}) {
  const r = migrateReview(review);
  if (screen !== 'view') return false;
  if (r.answered) return false;
  if (r.dismissals >= 2) return false;
  if (now < r.snoozeUntil) return false;
  if (r.usefulDays < REVIEW_MIN_USEFUL_DAYS) return false;
  if (!fullyDrawn) return false;
  if (msSinceOpen < REVIEW_MIN_SECONDS * 1000) return false;
  return true;
}

// 4–5 stars → the store listing reviews; 1–3 → the private feedback page.
export function urlForStars(stars, runtimeId = chrome?.runtime?.id) {
  return stars >= 4 ? STORE_REVIEWS_URL(runtimeId) : FEEDBACK_URL;
}

export function applyStars(review) {
  return { ...migrateReview(review), answered: true };
}

export function applyNotNow(review, now = Date.now()) {
  const r = migrateReview(review);
  const dismissals = r.dismissals + 1;
  return {
    ...r,
    dismissals,
    snoozeUntil: dismissals >= 2 ? 0 : now + REVIEW_SNOOZE_DAYS * 86_400_000,
  };
}
