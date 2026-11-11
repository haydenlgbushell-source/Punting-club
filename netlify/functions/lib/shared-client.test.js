// Guard against the login bug fixed in PR #130 and PR #135. Run: npm test
//
// Each Netlify function keeps one shared service-role Supabase client. Calling
// a sign-in style auth method on it stores a member's session on that client,
// and every later query from the same warm function then runs as that member
// (Row Level Security blocks it: "User profile not found", failed logins).
// Those calls must go on a throwaway client (sessionClient() in auth.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FUNCTIONS_DIR = path.join(__dirname, '..');
const SESSION_METHODS = [
  'signInWithPassword', 'signInWithOtp', 'signInWithIdToken', 'signInWithOAuth',
  'signInAnonymously', 'signUp', 'refreshSession', 'setSession',
  'verifyOtp', 'exchangeCodeForSession',
];
const pattern = new RegExp(`\\bsupabase\\.auth\\.(${SESSION_METHODS.join('|')})\\b`);

const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
  return e.name.endsWith('.js') && !e.name.endsWith('.test.js') ? [p] : [];
});

test('no function signs a member in on its shared Supabase client', () => {
  const offenders = [];
  for (const file of sourceFiles(FUNCTIONS_DIR)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (pattern.test(line)) offenders.push(`${path.relative(FUNCTIONS_DIR, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `Use a throwaway client (sessionClient()) for these:\n${offenders.join('\n')}`);
});
