// A suspension request opened from an AHS link, and the outcome the ADS records against it.
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { decodeRequest } from '../forecast.js';
import { REQUEST_PARAM } from './config.js';
import { $, fillFields, flash, today } from './dom.js';
import { db, state, isDecider, writeFailed } from './store.js';

export const courseName = p => `${p.name}${p.code ? ` (${p.code})` : ''}`;

// Old links carry the figures themselves; they are keyed by a hash of the link.
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const showLinkError = () => { $('#link-error').hidden = false; };

// Reads the request id from the link. The link carries only the id of a stored request,
// so the figures cannot be read without signing in.
export function loadRequestFromLink() {
  const param = new URLSearchParams(window.location.search).get(REQUEST_PARAM);
  if (!param) return;
  if (/^[A-Za-z0-9]{20}$/.test(param)) {
    state.requestId = param;  // fetched after sign-in, by fetchRequest()
    return;
  }
  // Links sent before requests were stored carry the figures themselves. They still open.
  const decoded = decodeRequest(param);
  if (!decoded) { showLinkError(); return; }
  state.request = { ...decoded, key: hashString(param) };
  showRequest();
}

// Resolves once the stored request has loaded. If it cannot be, the full tool opens with an error shown.
export async function fetchRequest() {
  try {
    const snap = await getDoc(doc(db, 'requestDetails', state.requestId));
    const data = snap.exists() ? snap.data() : null;
    const decoded = data && decodeRequest(data.payload);
    if (!decoded) throw new Error('Request not found');
    // The sender is the account that stored the request, which the access rules enforce.
    state.request = { ...decoded, from: String(data.from || ''), key: state.requestId };
    showRequest();
  } catch (e) {
    console.warn(e);
    showLinkError();
  } finally {
    state.requestId = null;
  }
}

function showRequest() {
  const { request } = state;
  const banner = $('#request-banner');
  fillFields(banner, {
    course: courseName(request.profile),
    from: request.from || 'an unnamed sender',
    date: request.date ? ` on ${request.date}` : '',
    note: request.note,
  });
  $('#request-note').hidden = !request.note;
  $('#request-full-tool').href = window.location.pathname;
  banner.hidden = false;
  $('#form-draft-card').hidden = false;
  $('#main-nav').hidden = true;
  $('#predict-course').hidden = true;
}

// The outcome is stored against the request, so the sender and the rest of the team see it
// when they open the same link. Only the ADS and admin can record or undo it.
export function renderDonePanel() {
  if (!state.request || !state.user) return;
  const done = state.requestOutcome;
  const canDecide = isDecider();
  $('#done-recorded').hidden = !done;
  $('#done-waiting').hidden = !!done || canDecide;
  $('#done-form').hidden = !!done || !canDecide;
  if (!done) return;
  fillFields($('#done-recorded'), {
    decision: done.decision,
    date: done.date,
    by: done.by ? ` by ${done.by}` : '',
  });
  $('#done-actions').hidden = !canDecide;
  $('#done-email').hidden = !state.request.from;
}

const outcomeRef = () => doc(db, 'requests', state.request.key);

export function initDonePanel() {
  $('#done-form').addEventListener('submit', e => {
    e.preventDefault();
    setDoc(outcomeRef(), {
      decision: $('#done-decision').value,
      date: today(),
      course: state.request.profile.name,
      by: state.user.email,
    }).then(() => flash('Marked as done'), writeFailed);
  });
  $('#done-undo').addEventListener('click', () => { deleteDoc(outcomeRef()).catch(writeFailed); });
  $('#done-email').addEventListener('click', () => {
    const course = courseName(state.request.profile);
    const { decision, date } = state.requestOutcome;
    const subject = `Re: Recruitment suspension — ${course}`;
    const body = `Outcome of your suspension request for ${course}:\n\n${decision} (${date}).\n`;
    window.location.href = `mailto:${state.request.from}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
}

