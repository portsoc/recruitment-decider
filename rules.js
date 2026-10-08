// Builds the Firestore rules source, filling the account lists in from js/config.js (ADS and
// admin) and AHS_EMAILS below. Used by deploy.js and test_rules.js. This file is never published,
// so the full list of who has access stays off the site.
import fs from 'node:fs';
import path from 'node:path';
import { ADS_EMAIL, ADMIN_EMAIL } from './js/config.js';

// Associate Heads (Students): may raise suspension requests and edit courses.
export const AHS_EMAILS = [
  'tracy.wallis@port.ac.uk',
  'roger.moore@port.ac.uk',
  'simon.archer@port.ac.uk',
  'fiona.myers@port.ac.uk',
];

const list = emails => `[${emails.map(e => `'${e}'`).join(', ')}]`;

export function rulesSource() {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'firestore.rules'), 'utf8')
    .replaceAll('__DECIDER_EMAILS__', list([ADS_EMAIL, ADMIN_EMAIL]))
    .replaceAll('__AHS_EMAILS__', list(AHS_EMAILS));
  if (source.includes('__')) throw new Error('firestore.rules has a placeholder that rules.js does not fill');
  return source;
}
