#!/usr/bin/env node
// Publishes firestore.rules and the tool to Firebase Hosting using the signed-in gcloud account.
// Usage: node deploy.js
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PROJECT = 'uop-recruitment-decider';
const SITE = 'uop-recruitment-decider';
// Only these files are published; tests and tooling stay out of the site.
const FILES = ['index.html', 'forecast.js'];

const API = 'https://firebasehosting.googleapis.com/v1beta1';
const RULES_API = 'https://firebaserules.googleapis.com/v1';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const auth = { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT };

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

// Rules go first: a ruleset that fails to compile stops the release before the site changes.
async function publishRules() {
  const ruleset = await call('POST', `${RULES_API}/projects/${PROJECT}/rulesets`, {
    source: { files: [{ name: 'firestore.rules', content: fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8') }] },
  });
  const release = `projects/${PROJECT}/releases/cloud.firestore`;
  await call('PATCH', `${RULES_API}/${release}`, { release: { name: release, rulesetName: ruleset.name } });
  console.log(`Published firestore.rules as ${ruleset.name}`);
}

(async () => {
  await publishRules();

  const version = await call('POST', `${API}/sites/${SITE}/versions`, {
    config: {
      headers: [{
        glob: '**',
        headers: {
          'Cache-Control': 'no-cache',
          'X-Robots-Tag': 'noindex, nofollow',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        },
      }],
    },
  });

  const gzipped = {};
  const hashes = {};
  for (const f of FILES) {
    const gz = zlib.gzipSync(fs.readFileSync(path.join(__dirname, f)));
    const hash = crypto.createHash('sha256').update(gz).digest('hex');
    gzipped[hash] = gz;
    hashes['/' + f] = hash;
  }

  const populated = await call('POST', `${API}/${version.name}:populateFiles`, { files: hashes });
  for (const hash of populated.uploadRequiredHashes || []) {
    const res = await fetch(`${populated.uploadUrl}/${hash}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      body: gzipped[hash],
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
  }

  await call('PATCH', `${API}/${version.name}?update_mask=status`, { status: 'FINALIZED' });
  await call('POST', `${API}/sites/${SITE}/releases?versionName=${version.name}`, {});
  console.log(`Published ${FILES.length} files to https://${SITE}.web.app`);
})().catch(e => { console.error(e.message); process.exit(1); });
