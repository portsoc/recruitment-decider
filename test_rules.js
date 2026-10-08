#!/usr/bin/env node
// Checks firestore.rules against who may do what, using the Firebase Rules test API.
// Nothing is published. Needs a signed-in gcloud account. Usage: node test_rules.js
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = 'uop-recruitment-decider';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();

const AHS = 'tracy.wallis@port.ac.uk';
const ADS = 'kirsten.farrell@port.ac.uk';
const ADMIN = 'matt.dennis@port.ac.uk';
const NOW = '2026-10-01T10:00:00Z';
const stamp = email => ({ name: 'Course', updatedBy: email, updatedAt: NOW });
const request = (from, createdAt = NOW) => ({ payload: 'p', from, course: 'Course', createdAt });
const outcome = by => ({ decision: 'Suspend', date: '2026-10-01', course: 'Course', by });

// [description, ALLOW or DENY, method, document path, signed-in email, data written]
const CASES = [
  ['AHS saves a course in their own name', 'ALLOW', 'create', 'profiles/p1', AHS, stamp(AHS)],
  ['AHS saves a course in someone else\'s name', 'DENY', 'update', 'profiles/p1', AHS, stamp(ADS)],
  ['AHS saves a course without a stamp', 'DENY', 'create', 'profiles/p1', AHS, { name: 'Course' }],
  ['AHS deletes a course', 'ALLOW', 'delete', 'profiles/p1', AHS],
  ['Someone off the list reads a course', 'DENY', 'get', 'profiles/p1', 'someone@port.ac.uk'],
  ['Outside account reads a course', 'DENY', 'get', 'profiles/p1', 'someone@gmail.com'],
  ['AHS reads settings', 'ALLOW', 'get', 'shared/settings', AHS],
  ['ADS saves settings', 'ALLOW', 'update', 'shared/settings', ADS, stamp(ADS)],
  ['Admin saves key dates', 'ALLOW', 'update', 'shared/keyDates', ADMIN, stamp(ADMIN)],
  ['AHS saves settings', 'DENY', 'update', 'shared/settings', AHS, stamp(AHS)],
  ['AHS raises a request', 'ALLOW', 'create', 'requestDetails/r1', AHS, request(AHS)],
  ['AHS raises a request as ADS', 'DENY', 'create', 'requestDetails/r1', AHS, request(ADS)],
  ['AHS backdates a request', 'DENY', 'create', 'requestDetails/r1', AHS, request(AHS, '2020-01-01T00:00:00Z')],
  ['AHS alters a raised request', 'DENY', 'update', 'requestDetails/r1', AHS, request(AHS)],
  ['ADS records an outcome', 'ALLOW', 'create', 'requests/k1', ADS, outcome(ADS)],
  ['ADS records an outcome as admin', 'DENY', 'create', 'requests/k1', ADS, outcome(ADMIN)],
  ['ADS undoes an outcome', 'ALLOW', 'delete', 'requests/k1', ADS],
  ['AHS records an outcome', 'DENY', 'create', 'requests/k1', AHS, outcome(AHS)],
  ['ADS writes an unknown collection', 'DENY', 'create', 'other/x', ADS, {}],
];

const testCases = CASES.map(([, expectation, method, doc, email, data]) => ({
  expectation,
  request: {
    method,
    path: `/databases/(default)/documents/${doc}`,
    time: NOW,
    auth: { uid: 'test', token: { email, email_verified: true, firebase: { sign_in_provider: 'google.com' } } },
    ...(data && { resource: { data } }),
  },
}));

(async () => {
  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: { files: [{ name: 'firestore.rules', content: fs.readFileSync(path.join(import.meta.dirname, 'firestore.rules'), 'utf8') }] },
      testSuite: { testCases },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Rules test failed (${res.status}): ${JSON.stringify(body)}`);
  if (body.issues) throw new Error(`firestore.rules does not compile: ${JSON.stringify(body.issues)}`);
  let failed = 0;
  body.testResults.forEach((r, i) => {
    const ok = r.state === 'SUCCESS';
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${CASES[i][1].padEnd(5)} ${CASES[i][0]}`);
  });
  console.log(`\n${CASES.length - failed}/${CASES.length} rules checks passed`);
  if (failed) process.exit(1);
})().catch(e => { console.error(e.message); process.exit(1); });
