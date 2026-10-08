// Fixed configuration for the tool.
import members from '../members.json' with { type: 'json' };

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB8RUWwassFKOxBRXtpDFT5oxE0x7gNpLI',
  authDomain: 'uop-recruitment-decider.firebaseapp.com',
  projectId: 'uop-recruitment-decider',
  appId: '1:908326156017:web:a7b396138f262d37735b50',
};

// Who the suspension workflow runs between. The AHS raises a request; the ADS decides.
// The accounts are listed once, in members.json, which also feeds firestore.rules.
export const ADS_EMAIL = members.ads;
export const ADMIN_EMAIL = members.admin;
export const DECIDER_EMAILS = [members.ads, members.admin];
export const MEMBER_EMAILS = [...DECIDER_EMAILS, ...members.ahs];

export const PREFS_KEY = 'recruitment-decider-prefs-v1';
// Where courses, settings and done marks were kept before sign-in was added. Read only to offer moving them across.
export const LEGACY_STATE_KEY = 'recruitment-decider-state-v1';
export const LEGACY_PROCESSED_KEY = 'recruitment-decider-processed-v1';

export const REQUEST_PARAM = 'req';
