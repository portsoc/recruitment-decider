// Predict screen: the figures entered, the recommendation, the forecast and its breakdown,
// and (for a request opened from a link) the draft for the central suspension form.
import { INTAKE_MONTHS, forecast, recommend, isDefaultCurve, weeksUntil } from '../forecast.js';
import { $, fromTemplate, fillFields, setOptions, formatDate, percent, plural, copyText } from './dom.js';
import { state, savePrefs, activeProfile, activeSettings } from './store.js';
import { renderDonePanel, courseName } from './request.js';
import { drawChart } from './chart.js';

const DEFAULT_INPUTS = {
  weeksToStart: 16, currentApps: 60, currentOffers: 40, currentFirms: 20,
  icpTransfers: 0, foundationTransfers: 0, intakeMonth: 'September', academicYear: '',
};
const TEXT_INPUTS = ['intakeMonth', 'academicYear'];

const form = () => $('#predict-inputs');

export function readInputs() {
  const values = Object.fromEntries(new FormData(form()));
  Object.keys(values).forEach(k => { if (!TEXT_INPUTS.includes(k)) values[k] = +values[k]; });
  return values;
}

function writeInputs(inputs) {
  Object.entries({ ...DEFAULT_INPUTS, ...inputs }).forEach(([name, value]) => {
    const field = $(`[name="${name}"]`, form());
    if (field) field.value = value;
  });
}

export function renderPredict() {
  const hasCourse = !!state.request || state.profiles.length > 0;
  $('#predict-main').hidden = !hasCourse;
  $('#predict-noprofile').hidden = hasCourse;
  if (!hasCourse) return;

  const select = $('#predict-profile');
  select.replaceChildren(...state.profiles.map(p =>
    new Option(`${p.name} (cap ${p.cap})`, p.id, false, p.id === state.currentProfileId)));

  writeInputs(state.request ? state.request.inputs : state.currentInputs);
  updatePredict();
}

// Fills "weeks until course start" from the start date in the course profile, where there is one.
// A request opened from a link keeps the weeks as they were sent.
function applyAutoWeeks(profile) {
  const input = $('#in-weeks');
  const hint = $('#weeks-hint');
  if (state.request) { input.readOnly = false; hint.textContent = ''; return; }
  const intake = $('#in-intake').value;
  const date = profile.startDates?.[intake];
  const weeks = weeksUntil(date);
  input.readOnly = weeks !== null;
  if (weeks !== null) {
    input.value = weeks;
    state.currentInputs.weeksToStart = weeks;
    hint.textContent = `Worked out from the ${intake} start date in the course profile (${formatDate(date)}).`;
  } else if (date) {
    hint.textContent = `The ${intake} start date in the course profile (${formatDate(date)}) has passed. Update it there, or enter the weeks here.`;
  } else {
    hint.textContent = `Add a ${intake} start date to the course profile to have this filled in for you.`;
  }
}

function renderKeyDateNote(intake) {
  const note = $('#key-date-note');
  const next = state.keyDates
    .filter(k => (k.intake === 'Any' || k.intake === intake) && weeksUntil(k.date) !== null)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  note.hidden = !next || !!state.request;
  if (note.hidden) return;
  const days = Math.round((new Date(`${next.date}T00:00:00`) - new Date(new Date().toDateString())) / 86400000);
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  $('time', note).dateTime = next.date;
  fillFields(note, { date: formatDate(next.date), when, label: next.label ? ` — ${next.label}` : '' });
}

function renderRecommendation(f, r, settings) {
  $('#recommendation-card').dataset.tone = r.color;
  $('#rec-label').textContent = r.label;
  $('#rec-detail').textContent = r.detail;
  $('#rec-buffer-factor').textContent = (1 + settings.safetyBuffer).toFixed(2);
  $('#rec-p-meet').textContent = percent(f.pMeetCap);
  $('#rec-p-over').textContent = percent(f.pOvershoot);
  $('#rec-confidence').textContent = percent(f.cycleConfidence);
  $('#rec-p-gated').textContent = percent(f.gatedPOvershoot);
  // Only the AHS raises requests, and only when the forecast says one may be worth making.
  $('#notify-panel').hidden = !!state.request || !['submit', 'marginal'].includes(r.zone);
}

function renderSummary(f, profile) {
  const cap = profile.placementCourse && profile.repeatsImpactPlacement > 0
    ? `${profile.cap} (effective ${f.effectiveCap} after ${profile.repeatsImpactPlacement} placement-occupying repeats)`
    : `${profile.cap}`;
  $('#forecast-summary').textContent =
    `Forecast: ${f.meanNewIntake.toFixed(0)} new intake at first census (±${f.sd.toFixed(0)} sd). Cap ${cap}. Buffer threshold ${f.targetWithBuffer.toFixed(0)}. Application curve ${percent(f.phi)} complete.`;
}

// Each row is { label, value, explainer, warning?, total? }.
function breakdownRows(f, profile, inputs, settings) {
  const b = f.components;
  const pct = v => `${+(v * 100).toFixed(1)}%`;
  const a2o = `${pct(profile.appToOffer)} application → offer`;
  const o2f = `${pct(profile.offerToFirm)} offer → firm`;
  const f2e = `${pct(profile.firmToEnrolled)} firm → enrolled`;
  const apps = Math.max(0, inputs.currentApps || 0);
  const offers = Math.max(0, inputs.currentOffers || 0);
  const firms = Math.max(0, inputs.currentFirms || 0);
  const wd = profile.expectedPostEnrolWithdrawal;
  const atStart = target => (target / (1 - Math.min(wd, 0.99))).toFixed(0);

  return [
    { label: 'Application curve completion', value: percent(f.phi), warning: isDefaultCurve(profile.curve),
      explainer: `The share of the year's final application total that has normally arrived by ${inputs.weeksToStart || 0} weeks before start. Read from the application curve in the course profile.` },
    { label: 'Projected final applications', value: f.projectedFinalApps.toFixed(0),
      explainer: `${apps} applications received ÷ ${percent(f.phi)} curve completion. Where applications are expected to end up if this year follows the usual curve.` },
    { label: 'From confirmed firms', value: b.fromFirms.toFixed(1),
      explainer: `${firms} firms × ${f2e}. Applicants who have accepted their offer, less those who typically never enrol.` },
    { label: `From offers awaiting firm (${b.offersWaiting})`, value: b.fromOffersWaiting.toFixed(1),
      explainer: `${offers} offers − ${firms} firms = ${b.offersWaiting} offers not yet accepted, × ${o2f} × ${f2e}.` },
    { label: `From apps awaiting offer (${b.appsWaiting})`, value: b.fromAppsWaiting.toFixed(1),
      explainer: `${apps} applications − ${offers} offers = ${b.appsWaiting} applications without an offer yet, × ${a2o} × ${o2f} × ${f2e}.` },
    { label: `From future apps (${b.futureApps.toFixed(0)})`, value: b.fromFutureApps.toFixed(1),
      explainer: `${f.projectedFinalApps.toFixed(0)} projected − ${apps} received = ${b.futureApps.toFixed(0)} applications still expected, × ${a2o} × ${o2f} × ${f2e}. The least certain line: none of these applications exist yet.` },
    { label: 'ICP transfers', value: b.fromICP.toFixed(1),
      explainer: 'The number you entered above, counted in full with no conversion rate applied.' },
    { label: 'Foundation transfers', value: b.fromFoundation.toFixed(1),
      explainer: 'The number you entered above, counted in full with no conversion rate applied.' },
    wd > 0 && { label: `Less typical post-enrol withdrawals (${Math.round(wd * 100)}%)`,
      value: `−${(f.meanNewIntakePreWithdrawal - f.meanNewIntake).toFixed(1)}`,
      explainer: `${pct(wd)} of the ${f.meanNewIntakePreWithdrawal.toFixed(1)} subtotal above. Students who enrol but leave before first census, using the typical Sept–Dec withdrawal rate in the course profile.` },
    { label: 'Expected new intake at first census', value: f.meanNewIntake.toFixed(1), total: true,
      explainer: 'The "From…" and transfer lines added together, less withdrawals. This is the centre of the forecast curve above.' },
    { label: 'Compared against', value: f.targetWithBuffer.toFixed(1),
      explainer: `Cap ${f.effectiveCap} × ${(1 + settings.safetyBuffer).toFixed(2)} (the ${pct(settings.safetyBuffer)} safety buffer from Suspension settings). Because withdrawals are already taken off the forecast, about ${atStart(f.effectiveCap)} students could enrol at the start and still land on the cap of ${f.effectiveCap} at first census; with the buffer that rises to about ${atStart(f.targetWithBuffer)}.` },
    { label: 'Spread of the forecast (±)', value: f.sd.toFixed(1),
      explainer: `How far either side of ${f.meanNewIntake.toFixed(1)} the final figure could reasonably land. Based on the course's year-to-year variability (${pct(profile.baseCV)} in the course profile), widened when little of the application curve has played out.` },
  ].filter(Boolean);
}

function renderBreakdown(rows) {
  $('#breakdown').replaceChildren(...rows.map(({ label, value, explainer, warning, total }) => {
    const el = fromTemplate('#tpl-breakdown-row');
    fillFields(el, { label, value, explainer });
    $('.breakdown-warning', el).hidden = !warning;
    el.toggleAttribute('data-total', !!total);
    return el;
  }));
}

function rationale(profile, inputs, f, r, settings) {
  const course = courseName(profile);
  const intake = inputs.intakeMonth || 'September';
  const year = inputs.academicYear || '(set academic year)';
  const transfers = [
    inputs.icpTransfers && ` ${plural(inputs.icpTransfers, 'ICP transfer')} expected on top of this.`,
    inputs.foundationTransfers && ` ${plural(inputs.foundationTransfers, 'Foundation transfer')} also expected.`,
  ].filter(Boolean).join('');
  const closing = {
    submit: 'We are at the point where continued offer-making creates real over-enrolment risk. We are therefore requesting suspension of applications for this intake.',
    marginal: 'We are approaching the point where continued offer-making may create over-enrolment risk and are requesting suspension to safeguard placement/teaching capacity.',
  }[r.zone] ?? `(Note: the predictor currently rates this case as "${r.label}" — the rationale below is provided in case you decide to submit anyway.)`;

  return [
    `${course} has a cap of ${profile.cap}.`,
    `Current position: ${plural(inputs.currentFirms, 'firm')}, ${inputs.currentOffers} offers issued, ${inputs.currentApps} applications received with ${plural(inputs.weeksToStart, 'week')} until ${intake} ${year} start.${transfers}`,
    `Forecast new intake at first census: ${f.meanNewIntake.toFixed(0)} (±${f.sd.toFixed(0)}), giving a ${Math.round(f.pOvershoot * 100)}% probability of exceeding cap by ${Math.round(settings.safetyBuffer * 100)}% or more.`,
    profile.placementCourse && profile.repeatsImpactPlacement > 0
      && `Placement capacity is further constrained by ${profile.repeatsImpactPlacement} repeating students occupying placement slots, reducing effective cap to ${f.effectiveCap}.`,
    closing,
  ].filter(Boolean).join('\n\n');
}

function renderFormDraft(profile, inputs, f, r, settings) {
  const wd = profile.expectedPostEnrolWithdrawal;
  const placementRepeats = profile.placementCourse && profile.repeatsImpactPlacement
    ? ` (${profile.repeatsImpactPlacement} impacting placement)` : '';
  fillFields($('#form-draft'), {
    school: profile.school || '—',
    course: `${profile.name} ${profile.code || ''}`.trim(),
    year: inputs.academicYear || '(set academic year)',
    intake: inputs.intakeMonth || 'September',
    placement: profile.placementCourse ? 'Yes' : 'No',
    placementCap: profile.placementCourse ? profile.cap : '—',
    withdrawals: `${Math.round(wd * profile.cap)} (${Math.round(wd * 100)}% of cap)`,
    icp: inputs.icpTransfers || 0,
    foundation: inputs.foundationTransfers || 0,
    repeats: `${profile.expectedRepeats}${placementRepeats}`,
  });
  $('#rationale').value = rationale(profile, inputs, f, r, settings);
}

export function updatePredict() {
  const profile = activeProfile();
  if (!profile) return;
  const settings = activeSettings();
  applyAutoWeeks(profile);
  const inputs = readInputs();
  renderKeyDateNote(inputs.intakeMonth);
  const f = forecast(profile, inputs, settings);
  const r = recommend(f, inputs, settings);

  renderRecommendation(f, r, settings);
  renderSummary(f, profile);
  renderBreakdown(breakdownRows(f, profile, inputs, settings));
  drawChart(f, profile.cap, settings.safetyBuffer);
  if (state.request) {
    renderFormDraft(profile, inputs, f, r, settings);
    renderDonePanel();
  }
}

export function initPredict() {
  setOptions($('#in-intake'), INTAKE_MONTHS, DEFAULT_INPUTS.intakeMonth);

  $('#predict-profile').addEventListener('change', e => {
    state.currentProfileId = e.target.value;
    savePrefs();
    updatePredict();
  });

  // One listener covers every field, the intake <select> included.
  const onEdit = () => {
    if (state.request) state.request.inputs = readInputs();
    else state.currentInputs = readInputs();
    savePrefs();
    updatePredict();
  };
  form().addEventListener('input', onEdit);
  form().addEventListener('submit', e => e.preventDefault());

  $('#copy-rationale').addEventListener('click', () => copyText($('#rationale').value, 'Rationale copied'));
}

