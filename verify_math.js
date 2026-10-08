// Hand-checked verification scenarios for the forecast / recommendation math.
// Imports the same module the browser app uses, so the tests stay honest.
//
// Run: node verify_math.js

import {
  DEFAULT_CURVE, DEFAULT_SETTINGS, forecast, recommend,
  encodeRequest, decodeRequest, weeksUntil, cvFromHistory, isDefaultCurve, newProfile,
} from './forecast.js';

function baseProfile(overrides = {}) {
  return {
    name: 'Test course',
    cap: 100,
    placementCourse: false,
    repeatsImpactPlacement: 0,
    expectedRepeats: 5,
    expectedPostEnrolWithdrawal: 0.05,
    curve: DEFAULT_CURVE,
    appToOffer: 0.75,
    offerToFirm: 0.35,
    firmToEnrolled: 0.88,
    baseCV: 0.08,
    ...overrides,
  };
}

function zoneOf(f, inputs, settings) {
  // recommend() returns the full UI-friendly object; for tests we just care about the zone.
  return recommend(f, inputs, settings).zone.toUpperCase();
}

function run(name, profile, inputs, expected) {
  const f = forecast(profile, inputs, DEFAULT_SETTINGS);
  const got = zoneOf(f, inputs, DEFAULT_SETTINGS);
  const pass = got === expected;
  console.log(`${pass ? '✓' : '✗'} ${name}`);
  console.log(`    weeks=${inputs.weeksToStart} apps=${inputs.currentApps} offers=${inputs.currentOffers} firms=${inputs.currentFirms} icp=${inputs.icpTransfers||0} found=${inputs.foundationTransfers||0}`);
  console.log(`    curve %: ${(f.phi*100).toFixed(0)}, mean intake: ${f.meanNewIntake.toFixed(1)} ±${f.sd.toFixed(1)}, floor intake: ${f.floorIntake.toFixed(1)} ±${f.sdFloor.toFixed(1)}, effective cap: ${f.effectiveCap}`);
  console.log(`    P(meet cap)=${(f.pMeetCap*100).toFixed(0)}% P(overshoot)=${(f.pOvershoot*100).toFixed(0)}% gated=${(f.gatedPOvershoot*100).toFixed(0)}% floor=${(f.pFloorOvershoot*100).toFixed(0)}% (conf ${(f.cycleConfidence*100).toFixed(0)}%)`);
  console.log(`    => ${got} (expected ${expected})\n`);
  return pass;
}

console.log('Default profile: cap 100, regular course\n');
const def = baseProfile();

let allPass = true;
allPass &= run('1. EARLY cycle, looks strong but curve barely played out', def,
  { weeksToStart: 24, currentApps: 50, currentOffers: 20, currentFirms: 5 }, 'DONT_ASK');

allPass &= run('2. MID cycle, on track for cap exactly', def,
  { weeksToStart: 12, currentApps: 150, currentOffers: 100, currentFirms: 35 }, 'DONT_ASK');

allPass &= run('3. MID cycle, strongly overperforming', def,
  { weeksToStart: 12, currentApps: 220, currentOffers: 160, currentFirms: 75 }, 'SUBMIT');

allPass &= run('4. LATE cycle (1 week), well over cap already', def,
  { weeksToStart: 1, currentApps: 280, currentOffers: 250, currentFirms: 120 }, 'TOO_LATE');

allPass &= run('5. MID cycle, underperforming', def,
  { weeksToStart: 12, currentApps: 90, currentOffers: 60, currentFirms: 20 }, 'DONT_ASK');

allPass &= run('6. LATE cycle (4 weeks), clearly overshooting', def,
  { weeksToStart: 4, currentApps: 320, currentOffers: 280, currentFirms: 130 }, 'SUBMIT');

allPass &= run('7. EARLY cycle, exceptionally hot — still too early', def,
  { weeksToStart: 24, currentApps: 200, currentOffers: 100, currentFirms: 30 }, 'DONT_ASK');

// Real-world calibration: Dental Hygiene example from the uploaded Microsoft Form.
// Cap 30, 20 firm, 50 offers, 2 ICP; "still interviewing this week and next" so ~6 weeks to start.
// That form was filled out *at the point of deciding to submit*, so we expect SUBMIT.
console.log('\n--- Real-world calibration: Dental Hygiene (from uploaded form) ---\n');
const dhProfile = baseProfile({
  cap: 30, placementCourse: true, repeatsImpactPlacement: 0,
  expectedPostEnrolWithdrawal: 0.05,
  // Interview-based courses tend to convert offers→firms higher than UCAS averages.
  appToOffer: 0.65, offerToFirm: 0.45, firmToEnrolled: 0.90,
});
allPass &= run('8. Dental Hygiene from form (cap 30, 20 firm, 50 offers, 2 ICP, mid-cycle)', dhProfile,
  { weeksToStart: 6, currentApps: 110, currentOffers: 50, currentFirms: 20, icpTransfers: 2, foundationTransfers: 0 },
  'SUBMIT');

// Even at 22 weeks out, the pipeline already in hand exceeds cap — the floor analysis
// should fire here and override the cycle confidence gate.
allPass &= run('9. Same Dental Hygiene state but at 22 weeks out (floor analysis overrides gate)', dhProfile,
  { weeksToStart: 22, currentApps: 110, currentOffers: 50, currentFirms: 20, icpTransfers: 2, foundationTransfers: 0 },
  'SUBMIT');

// The AHS → ADS link must reproduce the forecast exactly, and must survive a tampered link.
console.log('\n--- Suspension request link ---\n');

function check(name, pass) {
  console.log(`${pass ? '✓' : '✗'} ${name}`);
  return pass;
}

const linkProfile = { ...dhProfile, name: 'BSc Dental Hygiene & Thérapy', code: 'U2826FTC', school: 'DHCP' };
const linkInputs = { weeksToStart: 6, currentApps: 110, currentOffers: 50, currentFirms: 20,
  icpTransfers: 2, foundationTransfers: 0, intakeMonth: 'September', academicYear: '2026/27' };
const linkSettings = { ...DEFAULT_SETTINGS, safetyBuffer: 0.1 };
const encoded = encodeRequest(linkProfile, linkInputs, linkSettings,
  { from: 'a.person@example.ac.uk', note: 'Interviews finish next week', date: '2026-05-01' });
const decoded = decodeRequest(encoded);

const before = forecast(linkProfile, linkInputs, linkSettings);
const after = decoded && forecast(decoded.profile, decoded.inputs, decoded.settings);
allPass &= check('10. Link round-trip gives the same forecast and recommendation',
  !!decoded && after.meanNewIntake === before.meanNewIntake && after.sd === before.sd
  && after.pOvershoot === before.pOvershoot
  && recommend(after, decoded.inputs, decoded.settings).zone === recommend(before, linkInputs, linkSettings).zone);
allPass &= check('11. Link round-trip keeps course name, sender, note and date',
  !!decoded && decoded.profile.name === linkProfile.name && decoded.from === 'a.person@example.ac.uk'
  && decoded.note === 'Interviews finish next week' && decoded.date === '2026-05-01');
allPass &= check(`12. Link payload is short enough for an email (${encoded.length} chars)`, encoded.length < 700);
allPass &= check('13. Garbage links are rejected',
  decodeRequest('not a link!') === null && decodeRequest('') === null && decodeRequest('e30') === null);

const tampered = Buffer.from(JSON.stringify({ v: 1, d: 'x', f: '<img src=x>', n: 5,
  p: ['<b>x</b>', '', 'NOPE', '<script>', 1, -5, 'a', 9, 9, 9, 9, 9, [1, 2, 'x']],
  i: ['<i>', -1, null, {}, [], 'z', 'Smarch', 7], s: ['x'] })).toString('base64url');
const t = decodeRequest(tampered);
allPass &= check('14. Tampered link values are coerced to safe numbers and known options',
  !!t && t.profile.cap === 30 && t.profile.school === 'DHCP' && t.profile.repeatsImpactPlacement === 0
  && t.profile.appToOffer === 1 && t.inputs.weeksToStart === 0 && t.inputs.currentApps === 0
  && t.inputs.intakeMonth === 'September' && t.from === '' && t.date === ''
  && t.settings.safetyBuffer === DEFAULT_SETTINGS.safetyBuffer
  && Number.isFinite(forecast(t.profile, t.inputs, t.settings).meanNewIntake));

const today = new Date(2026, 8, 29); // 29 Sep 2026
allPass &= check('15. Weeks until start is worked out from the start date',
  weeksUntil('2027-01-19', today) === 16 && weeksUntil('2026-09-29', today) === 0
  && weeksUntil('2026-10-13', today) === 2);
allPass &= check('16. Past, missing or malformed start dates give no automatic weeks',
  weeksUntil('2026-09-28', today) === null && weeksUntil('', today) === null
  && weeksUntil('19/01/2027', today) === null && weeksUntil(undefined, today) === null);
const cv = cvFromHistory([28, 31, 30, 33, 27]);
allPass &= check(`17. Variability from past intakes 28,31,30,33,27 is about 0.08 (${cv.toFixed(3)})`,
  Math.abs(cv - 0.0808) < 0.001 && cvFromHistory([30]) === null && cvFromHistory([]) === null);
allPass &= check('18. Placeholder curve is recognised, an edited curve is not',
  isDefaultCurve(newProfile().curve)
  && !isDefaultCurve(newProfile().curve.map((r, i) => i === 3 ? { ...r, p: 0.35 } : r)));

console.log('');
console.log(allPass ? 'ALL PASS' : 'SOME FAIL — investigate');
process.exit(allPass ? 0 : 1);
