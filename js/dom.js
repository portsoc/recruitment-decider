// Small DOM and formatting helpers shared by every screen.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Clones a <template> and returns its single top-level element.
export function fromTemplate(selector) {
  return $(selector).content.firstElementChild.cloneNode(true);
}

// Writes plain text into every [data-field] named in values, inside root.
export function fillFields(root, values) {
  Object.entries(values).forEach(([field, value]) => {
    $$(`[data-field="${field}"]`, root).forEach(el => { el.textContent = value; });
  });
}

// Fills a <select> with options whose value and text are the same.
export function setOptions(select, values, selected) {
  select.replaceChildren(...values.map(v => new Option(v, v, false, v === selected)));
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// The number in an <input type="number">, held to its own min and max attributes and
// rounded when its step is 1. An empty or invalid entry gives its min (or 0).
export function numberFrom(input) {
  const lo = input.min === '' ? -Infinity : +input.min;
  const hi = input.max === '' ? Infinity : +input.max;
  const v = input.step === '1' ? Math.round(input.valueAsNumber) : input.valueAsNumber;
  return clamp(Number.isFinite(v) ? v : Math.max(lo, 0), lo, hi);
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const percent = (v, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const today = () => new Date().toISOString().slice(0, 10);

export function formatDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return dateStr || '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

let flashTimer;
export function flash(message) {
  const el = $('#flash');
  el.textContent = message;
  el.dataset.visible = '';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { delete el.dataset.visible; }, 1400);
}

export async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    flash(message);
  } catch {
    flash('Could not copy. Select the text and copy it yourself');
  }
}
