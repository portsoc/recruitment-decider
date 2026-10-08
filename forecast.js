// Shared forecast math + data-model defaults.
// An ES module imported by the browser app (js/*.js) and by verify_math.js.

export const SCHOOLS = ['DHCP', 'ELS', 'PSHS', 'SMPBS'];
export const INTAKE_MONTHS = ['September', 'January', 'April', 'June', 'Other'];

export const DEFAULT_CURVE = [
  { w: 32, p: 0.02 },
  { w: 26, p: 0.06 },
  { w: 20, p: 0.16 },
  { w: 16, p: 0.30 },
  { w: 12, p: 0.50 },
  { w: 8,  p: 0.72 },
  { w: 4,  p: 0.88 },
  { w: 2,  p: 0.96 },
  { w: 0,  p: 1.00 },
];

export const DEFAULT_SETTINGS = {
  safetyBuffer: 0.05,
  submitThreshold: 0.70,
  marginalThreshold: 0.40,
  minWeeksWindow: 2,
  uncertaintyAmplifier: 1.5,
  fullConfidencePhi: 0.40,
};

export function newProfile(name = 'New course') {
  return {
    id: crypto.randomUUID(),
    name,
    code: '',
    school: SCHOOLS[0],
    cap: 30,
    placementCourse: false,
    repeatsImpactPlacement: 0,
    expectedRepeats: 4,
    expectedPostEnrolWithdrawal: 0.05,
    curve: DEFAULT_CURVE.map(r => ({ ...r })),
    appToOffer: 0.75,
    offerToFirm: 0.35,
    firmToEnrolled: 0.88,
    baseCV: 0.08,
    startDates: {},  // intake month -> 'YYYY-MM-DD' course start date
  };
}

// True while a profile still carries the placeholder curve rather than the course's own history.
export function isDefaultCurve(curve) {
  return Array.isArray(curve) && curve.length === DEFAULT_CURVE.length
    && curve.every((r, i) => +r.w === DEFAULT_CURVE[i].w && +r.p === DEFAULT_CURVE[i].p);
}

// Whole weeks from today to a 'YYYY-MM-DD' date, or null if the date is missing, invalid or past.
export function weeksUntil(dateStr, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (!m) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const from = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (!Number.isFinite(target) || target < from) return null;
  return Math.round((target - from) / (7 * 86400000));
}

// Coefficient of variation (sample sd ÷ mean) of past years' final new intake.
export function cvFromHistory(values) {
  const xs = (values || []).map(Number).filter(v => Number.isFinite(v) && v > 0);
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance) / mean;
}

export function migrateProfile(p) {
  const d = newProfile();
  return { ...d, ...p,
    startDates: { ...(p.startDates || {}) },
    code: p.code ?? '',
    school: p.school ?? SCHOOLS[0],
    placementCourse: p.placementCourse ?? false,
    repeatsImpactPlacement: p.repeatsImpactPlacement ?? 0,
    expectedRepeats: p.expectedRepeats ?? (p.repeats ?? 4),
    expectedPostEnrolWithdrawal: p.expectedPostEnrolWithdrawal ?? 0.05,
  };
}

export function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export function normalPDF(x, mu, sigma) {
  return Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
}

export function curveLookup(curve, weeksToStart) {
  if (!curve.length) return 1.0;
  const sorted = [...curve].sort((a, b) => b.w - a.w); // earliest week first
  if (weeksToStart >= sorted[0].w) return sorted[0].p;
  if (weeksToStart <= sorted[sorted.length - 1].w) return sorted[sorted.length - 1].p;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (weeksToStart <= a.w && weeksToStart >= b.w) {
      const t = (a.w - weeksToStart) / (a.w - b.w);
      return a.p + t * (b.p - a.p);
    }
  }
  return 1.0;
}

export function forecast(profile, inputs, settings) {
  const { cap, appToOffer, offerToFirm, firmToEnrolled, baseCV, curve,
          placementCourse, repeatsImpactPlacement, expectedPostEnrolWithdrawal } = profile;
  const weeksToStart = Math.max(0, +inputs.weeksToStart || 0);
  const currentApps = Math.max(0, +inputs.currentApps || 0);
  const currentOffers = Math.max(0, +inputs.currentOffers || 0);
  const currentFirms = Math.max(0, +inputs.currentFirms || 0);
  const icp = Math.max(0, +inputs.icpTransfers || 0);
  const foundation = Math.max(0, +inputs.foundationTransfers || 0);

  const phi = Math.max(0.01, Math.min(1.0, curveLookup(curve, weeksToStart)));
  const projectedFinalApps = currentApps > 0 ? currentApps / phi : 0;

  const fromFirms = currentFirms * firmToEnrolled;
  const offersWaiting = Math.max(0, currentOffers - currentFirms);
  const fromOffersWaiting = offersWaiting * offerToFirm * firmToEnrolled;
  const appsWaiting = Math.max(0, currentApps - currentOffers);
  const fromAppsWaiting = appsWaiting * appToOffer * offerToFirm * firmToEnrolled;
  const futureApps = Math.max(0, projectedFinalApps - currentApps);
  const fromFutureApps = futureApps * appToOffer * offerToFirm * firmToEnrolled;

  const meanNewIntakePreWithdrawal =
      fromFirms + fromOffersWaiting + fromAppsWaiting + fromFutureApps + icp + foundation;
  const meanNewIntake = meanNewIntakePreWithdrawal * (1 - expectedPostEnrolWithdrawal);

  // Floor intake: what we'd get if we suspended applications *today* and only processed
  // what's already in the pipeline. No future apps.
  const floorIntakePreWithdrawal = fromFirms + fromOffersWaiting + fromAppsWaiting + icp + foundation;
  const floorIntake = floorIntakePreWithdrawal * (1 - expectedPostEnrolWithdrawal);

  const effectiveCap = placementCourse ? Math.max(1, cap - repeatsImpactPlacement) : cap;

  const appDrivenMean = Math.max(0, meanNewIntake - (icp + foundation) * (1 - expectedPostEnrolWithdrawal));
  const sd = Math.max(1, appDrivenMean * baseCV * (1 + (1 - phi) * settings.uncertaintyAmplifier));
  const sdFloor = Math.max(0.5, floorIntake * baseCV);

  const pMeetCap = 1 - normalCDF((effectiveCap - meanNewIntake) / sd);
  const targetWithBuffer = effectiveCap * (1 + settings.safetyBuffer);
  const pOvershoot = 1 - normalCDF((targetWithBuffer - meanNewIntake) / sd);
  const pFloorOvershoot = 1 - normalCDF((targetWithBuffer - floorIntake) / sdFloor);

  const cycleConfidence = Math.min(1, phi / Math.max(0.05, settings.fullConfidencePhi));
  const gatedPOvershoot = pOvershoot * cycleConfidence;
  const effectivePOvershoot = Math.max(gatedPOvershoot, pFloorOvershoot);

  return {
    phi, projectedFinalApps, meanNewIntake, meanNewIntakePreWithdrawal, sd,
    floorIntake, sdFloor, pFloorOvershoot,
    pMeetCap, pOvershoot, gatedPOvershoot, effectivePOvershoot, cycleConfidence,
    targetWithBuffer, effectiveCap,
    components: { fromFirms, fromOffersWaiting, fromAppsWaiting, fromFutureApps, fromICP: icp, fromFoundation: foundation, futureApps, appsWaiting, offersWaiting },
  };
}

export function recommend(f, inputs, settings) {
  const weeksToStart = +inputs.weeksToStart || 0;
  if (weeksToStart < settings.minWeeksWindow) {
    return { zone: 'too_late', label: "Don't ask — too late",
      detail: `You're inside the ${settings.minWeeksWindow}-week cutoff to the course start. Suspending applications now would have minimal effect on final enrolment, so a request is unlikely to be worthwhile.`,
      color: 'slate' };
  }
  const floorDrivesSubmit = f.pFloorOvershoot >= settings.submitThreshold;
  const earlyCycleNote = f.cycleConfidence < 0.99
    ? ` Cycle confidence is ${Math.round(f.cycleConfidence * 100)}% — only ${Math.round(f.phi * 100)}% of the application curve has played out, so the curve-based projection is discounted accordingly.`
    : '';
  if (floorDrivesSubmit) {
    return { zone: 'submit', label: 'Submit the request',
      detail: `Even if you stopped accepting new applications today, the pipeline already in hand (firms, pending offers, ICP/Foundation transfers) projects to ${f.floorIntake.toFixed(0)} enrolees — above cap × ${(1+settings.safetyBuffer).toFixed(2)} (${f.targetWithBuffer.toFixed(0)}). This is a clear case for suspension.`,
      color: 'emerald' };
  }
  if (f.gatedPOvershoot >= settings.submitThreshold) {
    return { zone: 'submit', label: 'Submit the request',
      detail: `${Math.round(f.pOvershoot * 100)}% probability of exceeding cap by ${Math.round(settings.safetyBuffer * 100)}% or more.${earlyCycleNote} This is strong evidence to support a suspension request.`,
      color: 'emerald' };
  }
  if (f.effectivePOvershoot >= settings.marginalThreshold) {
    return { zone: 'marginal', label: 'Marginal — your call',
      detail: `${Math.round(f.pOvershoot * 100)}% raw probability of meaningful overshoot, discounted to ${Math.round(f.gatedPOvershoot * 100)}% once cycle completeness is factored in (floor analysis: ${Math.round(f.pFloorOvershoot*100)}%).${earlyCycleNote} The forecast is not yet conclusive — consider waiting unless you have qualitative reasons to act now.`,
      color: 'amber' };
  }
  if (f.pOvershoot > 0.6 && f.cycleConfidence < 0.5) {
    return { zone: 'dont_ask', label: "Too early to ask",
      detail: `The raw curve-based projection suggests ${Math.round(f.pOvershoot * 100)}% chance of overshoot, but only ${Math.round(f.phi * 100)}% of the application curve has played out and the pipeline already in hand isn't yet over cap. That is too little of the cycle to justify a suspension request.`,
      color: 'slate' };
  }
  return { zone: 'dont_ask', label: "Don't ask yet",
    detail: `Only ${Math.round(f.pOvershoot * 100)}% probability of meaningful overshoot. Suspending now risks the course not even hitting cap.`,
    color: 'slate' };
}

// A suspension request travels from the AHS to the ADS inside a link, so the ADS sees the
// same course profile, inputs and thresholds without sharing any storage. Values are packed
// positionally to keep the link short enough for a mailto: body.
const SETTING_KEYS = ['safetyBuffer', 'submitThreshold', 'marginalThreshold',
                      'minWeeksWindow', 'uncertaintyAmplifier', 'fullConfidencePhi'];

export function encodeRequest(profile, inputs, settings, meta = {}) {
  const payload = {
    v: 1,
    d: meta.date || new Date().toISOString().slice(0, 10),
    f: String(meta.from || '').slice(0, 80),
    n: String(meta.note || '').slice(0, 400),
    p: [profile.name, profile.code || '', profile.school, profile.cap, profile.placementCourse ? 1 : 0,
        profile.repeatsImpactPlacement, profile.expectedRepeats, profile.expectedPostEnrolWithdrawal,
        profile.appToOffer, profile.offerToFirm, profile.firmToEnrolled, profile.baseCV,
        profile.curve.flatMap(r => [r.w, r.p])],
    i: [inputs.weeksToStart, inputs.currentApps, inputs.currentOffers, inputs.currentFirms,
        inputs.icpTransfers, inputs.foundationTransfers, inputs.intakeMonth || 'September', inputs.academicYear || ''],
    s: SETTING_KEYS.map(k => settings[k]),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The link is untrusted input: every value is coerced and clamped before use.
export function decodeRequest(encoded) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded || '')) return null;
    const bin = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    if (!raw || raw.v !== 1 || !Array.isArray(raw.p) || !Array.isArray(raw.i) || !Array.isArray(raw.s)) return null;

    const num = (v, lo, hi, d = 0) => Number.isFinite(+v) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, +v)) : d;
    const str = (v, max) => String(v ?? '').slice(0, max);
    const p = raw.p, i = raw.i;

    const flat = Array.isArray(p[12]) ? p[12].slice(0, 120) : [];
    const curve = [];
    for (let k = 0; k + 1 < flat.length; k += 2) curve.push({ w: num(flat[k], 0, 104), p: num(flat[k + 1], 0, 1) });

    const profile = {
      id: 'request',
      name: str(p[0], 120) || 'Untitled course',
      code: str(p[1], 40),
      school: SCHOOLS.includes(p[2]) ? p[2] : SCHOOLS[0],
      cap: Math.round(num(p[3], 1, 100000, 30)),
      placementCourse: !!p[4],
      repeatsImpactPlacement: Math.round(num(p[5], 0, 100000)),
      expectedRepeats: Math.round(num(p[6], 0, 100000)),
      expectedPostEnrolWithdrawal: num(p[7], 0, 1),
      appToOffer: num(p[8], 0, 1),
      offerToFirm: num(p[9], 0, 1),
      firmToEnrolled: num(p[10], 0, 1),
      baseCV: num(p[11], 0, 1),
      curve: curve.length ? curve : DEFAULT_CURVE.map(r => ({ ...r })),
    };
    const inputs = {
      weeksToStart: num(i[0], 0, 104),
      currentApps: num(i[1], 0, 1e6),
      currentOffers: num(i[2], 0, 1e6),
      currentFirms: num(i[3], 0, 1e6),
      icpTransfers: num(i[4], 0, 1e6),
      foundationTransfers: num(i[5], 0, 1e6),
      intakeMonth: INTAKE_MONTHS.includes(i[6]) ? i[6] : 'September',
      academicYear: str(i[7], 20),
    };
    const settings = { ...DEFAULT_SETTINGS };
    SETTING_KEYS.forEach((k, idx) => { settings[k] = num(raw.s[idx], 0, 100, DEFAULT_SETTINGS[k]); });

    const from = str(raw.f, 80);
    return {
      profile, inputs, settings,
      from: /^[^\s@<>"']+@[^\s@<>"']+$/.test(from) ? from : '',
      note: str(raw.n, 400),
      date: /^\d{4}-\d{2}-\d{2}$/.test(raw.d) ? raw.d : '',
    };
  } catch (e) {
    return null;
  }
}
