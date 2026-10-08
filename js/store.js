// Firebase handles and the state shared by every screen.
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, serverTimestamp } from 'firebase/firestore';
import { DEFAULT_SETTINGS } from '../forecast.js';
import { FIREBASE_CONFIG, PREFS_KEY, LEGACY_STATE_KEY } from './config.js';
import { flash } from './dom.js';

const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);

export function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

// Courses, settings and key dates are shared and come from Firestore once signed in.
// Only the figures last typed in and the course last chosen are kept in this browser.
const prefs = readJson(PREFS_KEY) || readJson(LEGACY_STATE_KEY) || {};

export const state = {
  profiles: [],
  settings: { ...DEFAULT_SETTINGS },
  keyDates: [],            // [{ date: 'YYYY-MM-DD', intake: 'Any' | intake month, label }]
  currentInputs: prefs.currentInputs || {},
  currentProfileId: prefs.currentProfileId || null,

  user: null,              // { email } of the signed-in, permitted account
  settingsStored: false,   // whether shared settings have ever been saved
  keyDatesStored: false,   // whether shared key dates have ever been saved

  // A suspension request opened from a link: { profile, inputs, settings, from, note, date, key }.
  request: null,
  requestId: null,         // id from the link, until the request has loaded or failed to load
  requestOutcome: null,    // outcome recorded against the open request, if any

  // Unsaved edits on screen, which an update arriving from someone else must not overwrite.
  dirty: { profiles: false, settings: false },
};

// A request opened from a link is never written to storage, so it cannot overwrite the
// figures the reader last typed in for themselves.
export function savePrefs() {
  if (state.request || state.requestId) return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ currentInputs: state.currentInputs, currentProfileId: state.currentProfileId }));
  } catch (e) { console.warn('Could not save to this browser', e); }
}

export const isDecider = () => !!state.user?.decider;
export const activeProfile = () => state.request?.profile ?? state.profiles.find(p => p.id === state.currentProfileId);
export const activeSettings = () => state.request?.settings ?? state.settings;

// Every saved change names its author and the server time; firestore.rules checks both.
export function stamp() {
  return { updatedBy: state.user.email, updatedAt: serverTimestamp() };
}

export function profileDoc(profile) {
  const { id, updatedAt, ...data } = structuredClone(profile);
  return { ...data, ...stamp() };
}

export function writeFailed(e) {
  console.warn(e);
  flash(e?.code === 'permission-denied'
    ? 'Your account is not allowed to change this'
    : 'Could not save. Check your connection and try again');
}
