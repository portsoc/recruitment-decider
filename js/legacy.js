// Data saved in this browser before sign-in was added, offered for moving into the shared tool.
import { doc, writeBatch } from 'firebase/firestore';
import { DEFAULT_SETTINGS, migrateProfile, isDefaultCurve } from '../forecast.js';
import { LEGACY_STATE_KEY, LEGACY_PROCESSED_KEY } from './config.js';
import { $, plural, flash } from './dom.js';
import { db, state, readJson, savePrefs, isDecider, stamp, profileDoc, writeFailed } from './store.js';

function legacyData() {
  if (state.request || !state.user) return null;
  const old = readJson(LEGACY_STATE_KEY);
  if (!old) return null;
  const known = new Set(state.profiles.map(p => p.id));
  const profiles = (Array.isArray(old.profiles) ? old.profiles : []).map(migrateProfile)
    .filter(p => !known.has(p.id) && !(p.name === 'Example course' && isDefaultCurve(p.curve)));
  const changedSettings = old.settings
    && Object.keys(DEFAULT_SETTINGS).some(k => Number.isFinite(old.settings[k]) && old.settings[k] !== DEFAULT_SETTINGS[k]);
  const settings = isDecider() && !state.settingsStored && changedSettings ? old.settings : null;
  const keyDates = isDecider() && !state.keyDatesStored && Array.isArray(old.keyDates) && old.keyDates.length ? old.keyDates : null;
  const processed = isDecider() ? (readJson(LEGACY_PROCESSED_KEY) || {}) : {};
  if (!profiles.length && !settings && !keyDates) return null;
  return { profiles, settings, keyDates, processed };
}

function clearLegacy() {
  savePrefs();
  localStorage.removeItem(LEGACY_STATE_KEY);
  localStorage.removeItem(LEGACY_PROCESSED_KEY);
  renderLegacyBanner();
}

export function renderLegacyBanner() {
  const legacy = legacyData();
  $('#legacy-banner').hidden = !legacy;
  if (!legacy) return;
  $('#legacy-summary').textContent = [
    legacy.profiles.length && `${plural(legacy.profiles.length, 'course')} (${legacy.profiles.map(p => p.name).join(', ')})`,
    legacy.settings && 'suspension settings',
    legacy.keyDates && plural(legacy.keyDates.length, 'key date'),
  ].filter(Boolean).join(', ');
}

function importLegacy() {
  const legacy = legacyData();
  if (!legacy) return;
  const batch = writeBatch(db);
  legacy.profiles.forEach(p => batch.set(doc(db, 'profiles', p.id), profileDoc(p)));
  if (legacy.settings) {
    const settings = Object.fromEntries(Object.entries(DEFAULT_SETTINGS)
      .map(([k, d]) => [k, Number.isFinite(legacy.settings[k]) ? legacy.settings[k] : d]));
    batch.set(doc(db, 'shared', 'settings'), { ...settings, ...stamp() });
  }
  if (legacy.keyDates) {
    const items = legacy.keyDates.filter(k => k?.date)
      .map(k => ({ date: String(k.date), intake: k.intake || 'Any', label: String(k.label || '') }));
    batch.set(doc(db, 'shared', 'keyDates'), { items, ...stamp() });
  }
  Object.entries(legacy.processed).forEach(([key, done]) => {
    if (!/^[a-z0-9]+$/.test(key) || !done) return;
    batch.set(doc(db, 'requests', key), {
      decision: String(done.decision || ''), date: String(done.date || ''), course: String(done.course || ''), by: state.user.email,
    });
  });
  batch.commit().then(() => { clearLegacy(); flash('Added to the shared tool'); }, writeFailed);
}

export function initLegacy() {
  $('#legacy-import').addEventListener('click', importLegacy);
  $('#legacy-discard').addEventListener('click', () => {
    if (!confirm('Discard the data saved in this browser before sign-in was added? This cannot be undone.')) return;
    clearLegacy();
  });
}
