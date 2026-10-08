// Builds the Firestore rules source, filling the account lists in from members.json so they
// are kept in one place. Used by deploy.js and test_rules.js.
import fs from 'node:fs';
import path from 'node:path';
import members from './members.json' with { type: 'json' };

const list = emails => `[${emails.map(e => `'${e}'`).join(', ')}]`;

export function rulesSource() {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'firestore.rules'), 'utf8')
    .replaceAll('__DECIDER_EMAILS__', list([members.ads, members.admin]))
    .replaceAll('__AHS_EMAILS__', list(members.ahs));
  if (source.includes('__')) throw new Error('firestore.rules has a placeholder that rules.js does not fill');
  return source;
}
