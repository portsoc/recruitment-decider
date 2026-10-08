// Entry point: sign-in, live sync of the shared data, and the tabs.
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { DEFAULT_SETTINGS, migrateProfile } from '../forecast.js';
import { ADMIN_EMAIL } from './config.js';
import { $, $$ } from './dom.js';
import { auth, db, state } from './store.js';
import { loadRequestFromLink, fetchRequest, renderDonePanel, initDonePanel } from './request.js';
import { renderPredict, initPredict } from './predict.js';
import { renderProfiles, initProfiles } from './profiles.js';
import { renderSettings, initSettings } from './settings.js';
import { renderLegacyBanner, initLegacy } from './legacy.js';
import { initNotify } from './notify.js';

const SIGN_IN_MESSAGE = 'Sign in with your University of Portsmouth Google account to continue.';
const RENDER_TAB = { predict: renderPredict, profiles: renderProfiles, settings: renderSettings };
let currentTab = 'predict';
let unsubscribe = [];

/* ===================== TABS ===================== */
function switchTab(name) {
  currentTab = name;
  $$('[role="tab"]').forEach(tab => {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
  });
  RENDER_TAB[name]();
}

// Arrow keys, Home and End move between tabs, as the ARIA tabs pattern expects.
function onTabKey(e) {
  const tabs = $$('[role="tab"]');
  const i = tabs.indexOf(e.target);
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const tab = tabs[(next + tabs.length) % tabs.length];
  tab.focus();
  switchTab(tab.dataset.tab);
}

/* ===================== SIGN-IN ===================== */
function showAuthScreen(message, { signIn = false, signOut = false, error = '' } = {}) {
  $('#app').hidden = true;
  $('#auth-screen').hidden = false;
  $('#auth-message').textContent = message;
  $('#auth-error').textContent = error;
  $('#auth-error').hidden = !error;
  $('#auth-signin').hidden = !signIn;
  $('#auth-signout').hidden = !signOut;
}

async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: 'port.ac.uk', prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    const error = e.code === 'auth/popup-blocked'
      ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'
      : `Sign-in did not complete (${e.code || 'unknown error'}). Try again.`;
    showAuthScreen(SIGN_IN_MESSAGE, { signIn: true, error });
  }
}

// firestore.rules lets an account read access/<role> only if it holds that role, so the page
// learns what the account may do without carrying the list of who is on it.
async function hasRole(role) {
  try {
    await getDoc(doc(db, 'access', role));
    return true;
  } catch (e) {
    if (e.code === 'permission-denied') return false;
    throw e;
  }
}

async function onAuthChanged(u) {
  unsubscribe.forEach(stop => stop());
  unsubscribe = [];
  state.user = null;
  if (!u) {
    showAuthScreen(SIGN_IN_MESSAGE, { signIn: true });
    return;
  }
  const email = (u.email || '').toLowerCase();
  showAuthScreen('Checking access…');
  let member, decider;
  try {
    [member, decider] = await Promise.all([hasRole('member'), hasRole('decider')]);
  } catch (e) {
    console.warn(e);
    showAuthScreen('', { signOut: true, error: 'Access could not be checked. Check your connection and reload the page.' });
    return;
  }
  // A different account may have signed in while the checks were running.
  if (auth.currentUser !== u) return;
  if (!member) {
    showAuthScreen(`${email || 'This account'} does not have access to this tool.`, { signOut: true });
    return;
  }
  state.user = { email, decider };
  $('#user-email').textContent = email;
  $('#notify-from').textContent = email;
  showAuthScreen('Loading…');
  startSync();
}

/* ===================== SHARED DATA ===================== */
// Listens to the shared data. The tool opens once everything has arrived; later changes,
// including other people's, redraw whatever is on screen.
async function startSync() {
  if (state.requestId && !state.request) await fetchRequest();

  const pending = new Set(state.request ? ['request'] : ['profiles', 'settings', 'keyDates']);
  const arrived = (name, redraw) => {
    const first = pending.delete(name);
    if (pending.size) return;
    if (first) startApp(); else redraw();
  };
  const failed = e => {
    console.warn(e);
    showAuthScreen('', { signOut: true, error: e.code === 'permission-denied'
      ? 'This account is not allowed to read the shared data.'
      : 'The shared data could not be loaded. Check your connection and reload the page.' });
  };
  const listen = (ref, onData) => unsubscribe.push(onSnapshot(ref, onData, failed));

  if (state.request) {
    listen(doc(db, 'requests', state.request.key), snap => {
      state.requestOutcome = snap.exists() ? snap.data() : null;
      arrived('request', renderDonePanel);
    });
    return;
  }

  listen(collection(db, 'profiles'), snap => {
    state.profiles = snap.docs
      .map(d => migrateProfile({ ...d.data(), id: d.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!state.profiles.some(p => p.id === state.currentProfileId)) state.currentProfileId = state.profiles[0]?.id ?? null;
    arrived('profiles', refreshView);
  });

  listen(doc(db, 'shared', 'settings'), snap => {
    state.settingsStored = snap.exists();
    const stored = snap.exists() ? snap.data() : {};
    state.settings = Object.fromEntries(Object.entries(DEFAULT_SETTINGS)
      .map(([k, d]) => [k, Number.isFinite(stored[k]) ? stored[k] : d]));
    arrived('settings', refreshView);
  });

  listen(doc(db, 'shared', 'keyDates'), snap => {
    state.keyDatesStored = snap.exists();
    const items = snap.exists() ? snap.data().items : [];
    state.keyDates = (Array.isArray(items) ? items : [])
      .filter(k => typeof k?.date === 'string')
      .map(k => ({ date: k.date, intake: k.intake || 'Any', label: k.label || '' }));
    arrived('keyDates', refreshView);
  });
}

function startApp() {
  $('#auth-screen').hidden = true;
  $('#app').hidden = false;
  renderLegacyBanner();
  switchTab(currentTab);
}

function refreshView() {
  renderLegacyBanner();
  if (currentTab === 'predict') renderPredict();
  if (currentTab === 'profiles') renderProfiles(state.dirty.profiles);
  if (currentTab === 'settings' && !state.dirty.settings) renderSettings();
}

/* ===================== INIT ===================== */
$$('[data-admin-contact]').forEach(a => {
  a.textContent = ADMIN_EMAIL;
  a.href = `mailto:${ADMIN_EMAIL}`;
});
$$('[role="tab"]').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  tab.addEventListener('keydown', onTabKey);
});
$$('[data-goto-tab]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.gotoTab)));
$('#auth-signin').addEventListener('click', signIn);
$('#auth-signout').addEventListener('click', () => signOut(auth));
$('#sign-out').addEventListener('click', () => signOut(auth));

initPredict();
initProfiles();
initSettings();
initLegacy();
initNotify();
initDonePanel();
loadRequestFromLink();
// The tool opens from here, once a permitted account is signed in and the shared data has loaded.
onAuthStateChanged(auth, onAuthChanged);
