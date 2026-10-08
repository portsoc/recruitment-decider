// Fixed configuration for the tool.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB8RUWwassFKOxBRXtpDFT5oxE0x7gNpLI',
  authDomain: 'uop-recruitment-decider.firebaseapp.com',
  projectId: 'uop-recruitment-decider',
  appId: '1:908326156017:web:a7b396138f262d37735b50',
};

// Who the suspension workflow runs between. The AHS raises a request; the ADS decides.
// The page needs these two to address emails and name a contact; rules.js reads them from here
// too. The AHS accounts are kept in rules.js, which only feeds firestore.rules and is never
// published, so the full list of who has access stays off the site.
export const ADS_EMAIL = 'kirsten.farrell@port.ac.uk';
export const ADMIN_EMAIL = 'matt.dennis@port.ac.uk';

export const PREFS_KEY = 'recruitment-decider-prefs-v1';
// Where courses, settings and done marks were kept before sign-in was added. Read only to offer moving them across.
export const LEGACY_STATE_KEY = 'recruitment-decider-state-v1';
export const LEGACY_PROCESSED_KEY = 'recruitment-decider-processed-v1';

export const REQUEST_PARAM = 'req';
