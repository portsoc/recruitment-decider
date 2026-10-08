// Fixed configuration for the tool.

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB8RUWwassFKOxBRXtpDFT5oxE0x7gNpLI',
  authDomain: 'uop-recruitment-decider.firebaseapp.com',
  projectId: 'uop-recruitment-decider',
  appId: '1:908326156017:web:a7b396138f262d37735b50',
};

// Who the suspension workflow runs between. The AHS raises a request; the ADS decides.
// Keep these in step with firestore.rules, which is what actually enforces access.
export const ADS_EMAIL = 'kirsten.farrell@port.ac.uk';
export const AHS_EMAILS = [
  'tracy.wallis@port.ac.uk',
  'roger.moore@port.ac.uk',
  'simon.archer@port.ac.uk',
  'fiona.myers@port.ac.uk',
];
export const ADMIN_EMAIL = 'matt.dennis@port.ac.uk';
export const DECIDER_EMAILS = [ADS_EMAIL, ADMIN_EMAIL];
export const MEMBER_EMAILS = [...DECIDER_EMAILS, ...AHS_EMAILS];

export const PREFS_KEY = 'recruitment-decider-prefs-v1';
// Where courses, settings and done marks were kept before sign-in was added. Read only to offer moving them across.
export const LEGACY_STATE_KEY = 'recruitment-decider-state-v1';
export const LEGACY_PROCESSED_KEY = 'recruitment-decider-processed-v1';

export const REQUEST_PARAM = 'req';
