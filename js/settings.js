// Suspension settings and key decision dates. Shared by everyone; only the ADS and admin can change them.
import { doc, setDoc } from 'firebase/firestore';
import { DEFAULT_SETTINGS, INTAKE_MONTHS } from '../forecast.js';
import { $, $$, fromTemplate, setOptions, numberFrom, flash } from './dom.js';
import { db, state, isDecider, stamp, writeFailed } from './store.js';

const KEY_DATE_INTAKES = ['Any', ...INTAKE_MONTHS.filter(m => m !== 'Other')];
const settingInput = key => $(`#settings-form [name="${key}"]`);

function writeSettings(settings) {
  Object.keys(DEFAULT_SETTINGS).forEach(key => { settingInput(key).value = settings[key]; });
}

function lockSettings() {
  const canEdit = isDecider();
  $$('#tab-settings .settings-readonly').forEach(el => { el.hidden = canEdit; });
  $$('#tab-settings .settings-fields').forEach(el => { el.disabled = !canEdit; });
  $$('#tab-settings .settings-actions').forEach(el => { el.hidden = !canEdit; });
}

export function renderSettings() {
  state.dirty.settings = false;
  writeSettings(state.settings);
  renderKeyDateRows(state.keyDates);
  lockSettings();
}

function keyDateRow({ date = '', intake = 'Any', label = '' } = {}) {
  const row = fromTemplate('#tpl-keydate-row');
  $('[name="date"]', row).value = date;
  setOptions($('[name="intake"]', row), KEY_DATE_INTAKES, intake);
  $('[name="label"]', row).value = label;
  return row;
}

function renderKeyDateRows(rows) {
  $('#keydate-rows').replaceChildren(...rows.map(keyDateRow));
  updateKeyDateEmpty();
}

function updateKeyDateEmpty() {
  $('#keydate-empty').hidden = $$('#keydate-rows tr').length > 0;
}

function readKeyDateRows() {
  return $$('#keydate-rows tr').map(tr => ({
    date: $('[name="date"]', tr).value,
    intake: $('[name="intake"]', tr).value,
    label: $('[name="label"]', tr).value.trim(),
  }));
}

const sharedRef = id => doc(db, 'shared', id);

// Settings and key dates are saved separately, so each save keeps the other's unsaved edits on screen.
export function initSettings() {
  $('#tab-settings').addEventListener('input', () => { state.dirty.settings = true; });

  $('#settings-form').addEventListener('submit', e => {
    e.preventDefault();
    const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, numberFrom(settingInput(key))]));
    setDoc(sharedRef('settings'), { ...settings, ...stamp() }).then(() => flash('Settings saved'), writeFailed);
  });

  $('#reset-settings').addEventListener('click', () => {
    if (!confirm('Reset the suspension settings to their defaults for everyone?')) return;
    setDoc(sharedRef('settings'), { ...DEFAULT_SETTINGS, ...stamp() }).then(() => {
      writeSettings(DEFAULT_SETTINGS);
      flash('Reset');
    }, writeFailed);
  });

  $('#keydate-add').addEventListener('click', () => {
    $('#keydate-rows').append(keyDateRow());
    updateKeyDateEmpty();
    state.dirty.settings = true;
  });
  $('#keydate-rows').addEventListener('click', e => {
    if (!e.target.closest('.row-remove')) return;
    e.target.closest('tr').remove();
    updateKeyDateEmpty();
    state.dirty.settings = true;
  });

  $('#keydates-form').addEventListener('submit', e => {
    e.preventDefault();
    const items = readKeyDateRows().filter(k => k.date).sort((a, b) => a.date.localeCompare(b.date));
    setDoc(sharedRef('keyDates'), { items, ...stamp() }).then(() => flash('Key dates saved'), writeFailed);
  });
}
