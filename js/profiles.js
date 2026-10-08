// Course profiles screen: the course list and the editor for the chosen course.
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { SCHOOLS, INTAKE_MONTHS, newProfile, isDefaultCurve, cvFromHistory } from '../forecast.js';
import { $, $$, fromTemplate, fillFields, setOptions, numberFrom, plural, flash } from './dom.js';
import { db, state, savePrefs, profileDoc, writeFailed } from './store.js';

const START_DATE_INTAKES = INTAKE_MONTHS.filter(m => m !== 'Other');
const NUMBER_FIELDS = ['cap', 'repeatsImpactPlacement', 'expectedRepeats', 'expectedPostEnrolWithdrawal',
  'baseCV', 'appToOffer', 'offerToFirm', 'firmToEnrolled'];

const form = () => $('#profile-form');
const field = name => $(`[name="${name}"]`, form());
const currentProfile = () => state.profiles.find(p => p.id === state.currentProfileId);
const profileRef = id => doc(db, 'profiles', id);

// keepEditor leaves the editor alone, so unsaved edits survive an update from someone else.
export function renderProfiles(keepEditor = false) {
  $('#profile-list-empty').hidden = state.profiles.length > 0;
  $('#profile-list').replaceChildren(...state.profiles.map(p => {
    const item = fromTemplate('#tpl-profile-item');
    const button = $('button', item);
    button.dataset.id = p.id;
    button.setAttribute('aria-current', String(p.id === state.currentProfileId));
    fillFields(item, { name: p.name, meta: `cap ${p.cap} · repeats ${p.expectedRepeats}` });
    return item;
  }));
  if (!keepEditor) renderProfileEditor();
}

function renderProfileEditor() {
  state.dirty.profiles = false;
  const p = currentProfile();
  $('#editor-empty').hidden = !!p;
  form().hidden = !p;
  if (!p) return;

  field('name').value = p.name;
  field('code').value = p.code || '';
  setOptions(field('school'), SCHOOLS, p.school);
  field('placementCourse').checked = p.placementCourse;
  NUMBER_FIELDS.forEach(name => { field(name).value = p[name]; });
  $$('#ed-start-dates input').forEach(input => { input.value = p.startDates?.[input.dataset.intake] || ''; });
  $('#ed-cv-history').value = '';
  $('#ed-cv-result').textContent = 'Enter the final new intake for the last 3 to 5 years, separated by commas.';
  $('#curve-placeholder-note').hidden = !isDefaultCurve(p.curve);
  $('#curve-rows').replaceChildren(...p.curve.map(curveRow));
}

function curveRow({ w, p }) {
  const row = fromTemplate('#tpl-curve-row');
  $('[name="w"]', row).value = w;
  $('[name="p"]', row).value = p;
  return row;
}

// The profile as edited on screen, ready to save.
function readProfileForm(p) {
  const startDates = {};
  $$('#ed-start-dates input').forEach(input => { if (input.value) startDates[input.dataset.intake] = input.value; });
  const curve = $$('#curve-rows tr')
    .map(tr => ({ w: numberFrom($('[name="w"]', tr)), p: numberFrom($('[name="p"]', tr)) }))
    .sort((a, b) => b.w - a.w);
  return {
    ...p,
    name: field('name').value.trim() || 'Untitled course',
    code: field('code').value.trim(),
    school: field('school').value,
    placementCourse: field('placementCourse').checked,
    ...Object.fromEntries(NUMBER_FIELDS.map(name => [name, numberFrom(field(name))])),
    startDates,
    curve,
  };
}

function showCvFromHistory(text) {
  const values = text.split(/[\s,;]+/).filter(Boolean).map(Number);
  const cv = cvFromHistory(values);
  const out = $('#ed-cv-result');
  if (cv === null) { out.textContent = 'Enter at least two years of final new intake, separated by commas.'; return; }
  const rounded = Math.min(1, Math.round(cv * 100) / 100);
  field('baseCV').value = rounded;
  out.textContent = `Variability ${rounded.toFixed(2)}: the spread of those ${plural(values.filter(v => v > 0).length, 'year')} (standard deviation) divided by their average. Filled in on the left; save to keep it.`;
}

export function initProfiles() {
  $('#ed-start-dates').replaceChildren(...START_DATE_INTAKES.map(intake => {
    const item = fromTemplate('#tpl-start-date');
    const input = $('input', item);
    input.id = `ed-start-${intake}`;
    input.dataset.intake = intake;
    $('label', item).htmlFor = input.id;
    fillFields(item, { intake });
    return item;
  }));

  $('#profile-list').addEventListener('click', e => {
    const button = e.target.closest('button[data-id]');
    if (!button) return;
    state.currentProfileId = button.dataset.id;
    savePrefs();
    renderProfiles();
  });

  $('#new-profile').addEventListener('click', () => {
    const p = newProfile(`New course ${state.profiles.length + 1}`);
    state.currentProfileId = p.id;
    savePrefs();
    state.dirty.profiles = false;
    setDoc(profileRef(p.id), profileDoc(p)).catch(writeFailed);
  });

  form().addEventListener('input', () => { state.dirty.profiles = true; });
  $('#ed-cv-history').addEventListener('input', e => showCvFromHistory(e.target.value));

  $('#curve-add').addEventListener('click', () => {
    state.dirty.profiles = true;
    $('#curve-rows').append(curveRow({ w: 0, p: 1 }));
  });
  $('#curve-rows').addEventListener('click', e => {
    if (!e.target.closest('.row-remove')) return;
    state.dirty.profiles = true;
    e.target.closest('tr').remove();
  });

  form().addEventListener('submit', e => {
    e.preventDefault();
    const p = readProfileForm(currentProfile());
    state.dirty.profiles = false;
    setDoc(profileRef(p.id), profileDoc(p)).then(() => flash('Saved'), writeFailed);
  });
  $('#ed-revert').addEventListener('click', renderProfileEditor);
  $('#ed-delete').addEventListener('click', () => {
    const p = currentProfile();
    if (!confirm(`Delete "${p.name}"? It will be removed for everyone who uses the tool.`)) return;
    state.dirty.profiles = false;
    deleteDoc(profileRef(p.id)).then(() => flash('Course deleted'), writeFailed);
  });
}
