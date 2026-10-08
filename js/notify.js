// The AHS asking the ADS to decide: stores the request, then emails or copies a link to it.
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { encodeRequest } from '../forecast.js';
import { ADS_EMAIL, REQUEST_PARAM } from './config.js';
import { $, flash } from './dom.js';
import { db, state, activeProfile, writeFailed } from './store.js';
import { courseName } from './request.js';
import { readInputs } from './predict.js';

// The request last stored from this screen, so the three buttons share one request while
// the course, figures and note are unchanged: { payload, id }.
let storedRequest = null;

async function storeRequest(payload, from, course) {
  if (storedRequest?.payload === payload) return storedRequest.id;
  const ref = doc(collection(db, 'requestDetails'));
  flash('Saving the request…');
  await setDoc(ref, { payload, from, course: course.slice(0, 190), createdAt: serverTimestamp() });
  storedRequest = { payload, id: ref.id };
  return ref.id;
}

// Stores the current course and figures as a request, then resolves to { link, subject, body }.
// The link carries only the request's id. The sender is the signed-in account.
async function buildNotification() {
  const profile = activeProfile();
  if (!profile || !state.user) throw new Error('Nothing to send');
  const from = state.user.email;
  const note = $('#notify-note').value.trim();
  const course = courseName(profile);
  const payload = encodeRequest(profile, readInputs(), state.settings, { from, note });
  const id = await storeRequest(payload, from, course);

  const link = `${window.location.origin}${window.location.pathname}?${REQUEST_PARAM}=${id}`;
  const body = [
    `The recruitment forecast for ${course} suggests a suspension request may be worth making. Please review and decide.`,
    note && `Note: ${note}`,
    `Open the forecast with this course and its figures filled in (you will be asked to sign in):\n${link}`,
    `Sent by ${from}`,
  ].filter(Boolean).join('\n\n');
  return { link, subject: `Recruitment suspension — ${course}`, body };
}

export function initNotify() {
  $('#notify-ads').addEventListener('click', async () => {
    try {
      const n = await buildNotification();
      window.location.href = `mailto:${ADS_EMAIL}?subject=${encodeURIComponent(n.subject)}&body=${encodeURIComponent(n.body)}`;
    } catch (e) { writeFailed(e); }
  });

  $('#notify-gmail').addEventListener('click', async () => {
    // Opened before the request is stored, or the browser would block it as a pop-up.
    const win = window.open('', '_blank');
    try {
      const n = await buildNotification();
      const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(ADS_EMAIL)}&su=${encodeURIComponent(n.subject)}&body=${encodeURIComponent(n.body)}`;
      if (!win) { window.location.href = url; return; }
      win.opener = null;
      win.location.href = url;
    } catch (e) {
      win?.close();
      writeFailed(e);
    }
  });

  $('#notify-copy').addEventListener('click', async () => {
    let n;
    try { n = await buildNotification(); } catch (e) { writeFailed(e); return; }
    try {
      await navigator.clipboard.writeText(n.link);
      flash('Link copied');
    } catch {
      // Some browsers refuse to copy once the save has finished. The request is stored, so a second click copies at once.
      flash('Request saved. Click Copy link again to copy it');
    }
  });
}
