// Guards the hand-written PRECACHE list in sw.js. A file missing from it
// would break offline use without any visible error.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

function precacheList() {
  const block = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(block, 'PRECACHE list not found in sw.js');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function walk(dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(rel);
    return entry.name.toLowerCase() === 'readme.md' ? [] : [rel];
  });
}

const APP_SHELL_DIRS = ['css', 'js', 'icons', 'lib', 'data'];
const APP_SHELL_FILES = ['index.html', 'manifest.webmanifest'];

test('every app-shell file is in PRECACHE', () => {
  const listed = new Set(precacheList());
  const expected = [...APP_SHELL_FILES, ...APP_SHELL_DIRS.flatMap(walk)].map((f) => `./${f}`);
  const missing = expected.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `Add these to PRECACHE in sw.js: ${missing.join(', ')}`);
  assert.ok(listed.has('./'), "PRECACHE must contain './' (the start URL)");
});

test('every PRECACHE entry exists and is listed once', () => {
  const list = precacheList();
  assert.equal(new Set(list).size, list.length, 'PRECACHE has duplicates');
  for (const entry of list) {
    if (entry === './') continue;
    assert.ok(entry.startsWith('./'), `${entry} must be a relative ./ path`);
    assert.ok(existsSync(join(root, entry)), `${entry} is in PRECACHE but does not exist`);
  }
  assert.ok(!list.includes('./sw.js'), 'sw.js must not cache itself');
});

test('APP_VERSION is a semantic version defined once', () => {
  const matches = [...sw.matchAll(/const APP_VERSION = '(\d+\.\d+\.\d+)';/g)];
  assert.equal(matches.length, 1);
});
