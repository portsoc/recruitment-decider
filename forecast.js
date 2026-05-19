// Shared forecast math + data-model defaults.
// Consumed by index.html (via <script src="forecast.js">) and verify_math.js (via require).
// Uses a UMD-style wrapper so the same file works in both environments.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RecruitmentForecast = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const SCHOOLS = ['DHCP', 'ELS', 'PSHS', 'SMPBS'];
  const INTAKE_MONTHS = ['September', 'January', 'April', 'June', 'Other'];

  const DEFAULT_CURVE = [
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

  const DEFAULT_SETTINGS = {
    safetyBuffer: 0.05,
    submitThreshold: 0.70,
    marginalThreshold: 0.40,
    minWeeksWindow: 2,
    uncertaintyAmplifier: 1.5,
    fullConfidencePhi: 0.40,
  };

  function newProfile(name = 'New course') {
    return {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'p_' + Math.random().toString(36).slice(2),
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
    };
  }

  function migrateProfile(p) {
    const d = newProfile();
    return { ...d, ...p,
      code: p.code ?? '',
      school: p.school ?? SCHOOLS[0],
      placementCourse: p.placementCourse ?? false,
      repeatsImpactPlacement: p.repeatsImpactPlacement ?? 0,
      expectedRepeats: p.expectedRepeats ?? (p.repeats ?? 4),
      expectedPostEnrolWithdrawal: p.expectedPostEnrolWithdrawal ?? 0.05,
    };
  }

  function normalCDF(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + p * ax);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return 0.5 * (1 + sign * y);
  }

  function normalPDF(x, mu, sigma) {
    return Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
  }

  function curveLookup(curve, weeksToStart) {
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

  function forecast(profile, inputs, settings) {
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

  function recommend(f, inputs, settings) {
    const weeksToStart = +inputs.weeksToStart || 0;
    if (weeksToStart < settings.minWeeksWindow) {
      return { zone: 'too_late', label: "Don't ask — too late",
        detail: `You're inside the ${settings.minWeeksWindow}-week cutoff to the course start. Suspending applications now would have minimal effect on final enrolment, and the DvC will see the request as moot.`,
        color: 'slate' };
    }
    const floorDrivesSubmit = f.pFloorOvershoot >= settings.submitThreshold;
    const earlyCycleNote = f.cycleConfidence < 0.99
      ? ` Cycle confidence is ${Math.round(f.cycleConfidence * 100)}% — only ${Math.round(f.phi * 100)}% of the application curve has played out, so the curve-based projection is discounted accordingly.`
      : '';
    if (floorDrivesSubmit) {
      return { zone: 'submit', label: 'Submit the request',
        detail: `Even if you stopped accepting new applications today, the pipeline already in hand (firms, pending offers, ICP/Foundation transfers) projects to ${f.floorIntake.toFixed(0)} enrolees — above cap × ${(1+settings.safetyBuffer).toFixed(2)} (${f.targetWithBuffer.toFixed(0)}). The DvC will see this as a clear case.`,
        color: 'emerald' };
    }
    if (f.gatedPOvershoot >= settings.submitThreshold) {
      return { zone: 'submit', label: 'Submit the request',
        detail: `${Math.round(f.pOvershoot * 100)}% probability of exceeding cap by ${Math.round(settings.safetyBuffer * 100)}% or more.${earlyCycleNote} This is the kind of evidence the DvC wants to see before approving a suspension.`,
        color: 'emerald' };
    }
    if (f.effectivePOvershoot >= settings.marginalThreshold) {
      return { zone: 'marginal', label: 'Marginal — your call',
        detail: `${Math.round(f.pOvershoot * 100)}% raw probability of meaningful overshoot, discounted to ${Math.round(f.gatedPOvershoot * 100)}% once cycle completeness is factored in (floor analysis: ${Math.round(f.pFloorOvershoot*100)}%).${earlyCycleNote} The DvC may push back that the forecast is not yet conclusive — consider waiting unless you have qualitative reasons to act now.`,
        color: 'amber' };
    }
    if (f.pOvershoot > 0.6 && f.cycleConfidence < 0.5) {
      return { zone: 'dont_ask', label: "Too early to ask",
        detail: `The raw curve-based projection suggests ${Math.round(f.pOvershoot * 100)}% chance of overshoot, but only ${Math.round(f.phi * 100)}% of the application curve has played out and the pipeline already in hand isn't yet over cap. The DvC won't act on this little of the cycle.`,
        color: 'slate' };
    }
    return { zone: 'dont_ask', label: "Don't ask yet",
      detail: `Only ${Math.round(f.pOvershoot * 100)}% probability of meaningful overshoot. The DvC will worry that suspending now risks the course not even hitting cap.`,
      color: 'slate' };
  }

  return {
    SCHOOLS, INTAKE_MONTHS, DEFAULT_CURVE, DEFAULT_SETTINGS,
    newProfile, migrateProfile,
    normalCDF, normalPDF, curveLookup,
    forecast, recommend,
  };
}));
