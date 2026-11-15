// End-to-end checks of the app in a real (headless) browser, at phone width.
//
//   node tools/browser/check.mjs
//
// Needs Edge or Chrome and Node 22+. No installs. It starts its own server,
// uses a throwaway browser profile, and changes nothing in the repo.
// Screenshots are written to a temp folder (printed at the end) for a visual
// check of light and dark mode.
//
// The app is opened at http://app.localhost:<port>, not http://localhost:
// sw.js is network-first on "localhost" for development, and any other
// hostname gets the cache-first behaviour the iPhone gets. Checking only on
// "localhost" once let a phone-only bug through.
//
// What a headless desktop browser cannot check: the iOS share sheet, "Save to
// Files", navigator.storage.persist(), safe areas and the status bar. Those
// are tested on the phone.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';
import { createStaticServer } from './server.mjs';
import { mergeExercises, filterExercises } from '../../js/logic/exercises.js';
import { addDays, addMonths, formatDate, formatShortDate, monthGrid, monthLabel, todayStr, weekdayName } from '../../js/logic/dates.js';
import { weekProgress, resolveTargets } from '../../js/logic/volume.js';
import { formatKg } from '../../js/logic/sets.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.CHECK_PORT) || 8765;
const origin = `http://app.localhost:${PORT}`;
const out = mkdtempSync(join(tmpdir(), 'workout-check-'));

const swSource = readFileSync(join(root, 'sw.js'), 'utf8');
const APP_VERSION = /const APP_VERSION = '([^']+)';/.exec(swSource)[1];
const PRECACHE_COUNT = [.../const PRECACHE = \[([\s\S]*?)\];/.exec(swSource)[1].matchAll(/'[^']+'/g)].length;
const fixture = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'backup-v1.json'), 'utf8'));

const dataset = JSON.parse(readFileSync(join(root, 'data', 'exercises.json'), 'utf8'));
// What the library should contain once the fixture backup has been imported.
const fixtureLibrary = mergeExercises(dataset, fixture.stores.customExercises, fixture.stores.exerciseOverrides);
const expectedCount = (filters) => filterExercises(fixtureLibrary, filters).length;

const server = createStaticServer({ root, port: PORT });
let page;
let failures = 0;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

/** Runs one named check. Unexpected console errors during it also fail it. */
async function check(name, fn, { allowErrors = false } = {}) {
  page.errors.length = 0;
  try {
    // Every screenshot and every finished check also looks for stray text.
    await fn();
    await noStrayText();
    if (!allowErrors && page.errors.length) throw new Error(`console errors: ${page.errors.join(' | ')}`);
    console.log(`✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`✗ ${name}\n    ${String(err.message || err).replace(/\n/g, '\n    ')}`);
  }
}

// ----- Small page helpers -----
const js = JSON.stringify;
const text = (selector) => page.eval(`document.querySelector(${js(selector)})?.textContent ?? null`);
const click = (selector) => page.eval(`document.querySelector(${js(selector)}).click()`);
/**
 * Fails when the page shows a bare "null", "undefined", "NaN" or "[object Object]".
 * That is what a missing value looks like when it is put on the page by
 * mistake (e.g. passing null to replaceChildren). It once shipped unnoticed
 * by the other checks and was only seen in a screenshot.
 */
async function noStrayText() {
  const stray = await page.eval(`(() => {
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest('script, style, input, textarea')) continue;
      const text = node.nodeValue.trim();
      if (/^(null|undefined|NaN)$/.test(text) || /\\bundefined\\b|\\bNaN\\b|\\[object Object\\]/.test(text)) found.push(text.slice(0, 60));
    }
    return found;
  })()`);
  expect(!stray.length, `stray text on the page (${await page.eval('location.hash')}): ${stray.join(' | ')}`);
}

async function shot(name) {
  await noStrayText();
  await page.screenshot(join(out, `${name}.png`));
}
const noSidewaysScroll = async () =>
  expect(!(await page.eval(`document.documentElement.scrollWidth > innerWidth`)), 'the page scrolls sideways at 375 px');

const VERSION = `document.querySelector('.row .value')?.textContent`;
const LAST_BACKUP = `document.querySelector('.card .muted')?.textContent`;
const REMINDER = `document.getElementById('reminder-days')?.value`;
const EXPORT_BUTTON = '.card .btn';
const DIALOG = `document.querySelector('dialog[open]')`;

/**
 * Loads the app from scratch at a route such as '#/settings'. Navigating to
 * an address that differs only in its '#…' part does not reload the page, so
 * when the app is already open this sets the route and reloads instead.
 */
async function openApp(hash) {
  const alreadyOpen = (await page.eval(`location.origin + location.pathname`)) === `${origin}/`;
  if (!alreadyOpen) {
    await page.goto(`${origin}/${hash}`);
    return;
  }
  await page.eval(`location.hash = ${js(hash)}`);
  await page.reload();
}

async function openSettings() {
  await openApp('#/settings');
  await page.waitFor(`${REMINDER} !== undefined && ${REMINDER} !== ''`, { what: 'Settings to load' });
}

const setReminder = (value) =>
  page.eval(`(() => { const i = document.getElementById('reminder-days'); i.value = ${js(String(value))}; i.dispatchEvent(new Event('change')); })()`);

const dbCall = (body) => page.eval(`import('./js/db.js').then(async ({ db }) => { ${body} })`);
const dumpStores = () => dbCall(`return JSON.stringify(await db.exportStores());`);

/** Replaces the share sheet. mode: 'ok' | 'cancel' | 'expired' (refuses the first tap, like iOS can). */
const stubShare = (mode) =>
  page.eval(`(() => {
    window.__shared = [];
    window.__refusedOnce = false;
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      if (${js(mode)} === 'cancel') throw new DOMException('cancelled', 'AbortError');
      if (${js(mode)} === 'expired' && !window.__refusedOnce) {
        window.__refusedOnce = true;
        throw new DOMException('expired', 'NotAllowedError');
      }
      const file = data.files[0];
      window.__shared.push({ name: file.name, type: file.type, text: await file.text(), keys: Object.keys(data) });
    };
  })()`);

const dialogText = () =>
  page.eval(`(() => { const d = ${DIALOG}; return d ? [...d.querySelectorAll('h2, p')].map((n) => n.textContent).join(' ') : null; })()`);
const pressInDialog = (label) =>
  page.eval(`[...${DIALOG}.querySelectorAll('button')].find((b) => b.textContent === ${js(label)}).click()`);
async function pickBackup(file) {
  await page.pickFiles('input[type=file]', [file]);
  await page.waitFor(DIALOG, { what: 'a dialog after picking a file' });
}
// A dialog is removed from the page once it has closed, and the app acts on
// the answer right after. Wait for that, not just for the closing to start.
async function dialogClosed() {
  await page.waitFor(`!document.querySelector('dialog')`, { what: 'the dialog to close' });
  await page.sleep(50);
}

// ----- Exercise library helpers -----
const LIST_COUNT = `document.querySelector('main > p.muted')?.textContent`;
const rowTitles = (limit = 5) =>
  page.eval(`[...document.querySelectorAll('.list-title')].slice(0, ${limit}).map((n) => n.textContent)`);
const tapChip = (label) =>
  page.eval(`[...document.querySelectorAll('main .chip')].find((c) => c.textContent === ${js(label)}).click()`);
const tapPicker = (group, label) =>
  page.eval(`[...document.querySelector('[aria-label=${js(group)}]').querySelectorAll('.chip')].find((c) => c.textContent === ${js(label)}).click()`);
const pressButton = (label) =>
  page.eval(`[...document.querySelectorAll('main .btn')].find((b) => b.textContent === ${js(label)}).click()`);
const typeInto = (selector, value) =>
  page.eval(`(() => { const i = document.querySelector(${js(selector)}); i.value = ${js(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const tagTexts = () => page.eval(`[...document.querySelectorAll('.tag')].map((t) => t.textContent)`);
const waitCount = (expected) => page.waitFor(`${LIST_COUNT} === ${js(expected)}`, { what: `the list to say "${expected}"` });
const waitToast = (message) =>
  page.waitFor(`[...document.querySelectorAll('.toast')].some((t) => t.textContent === ${js(message)})`, { what: `the message "${message}"` });
async function openLibrary() {
  await openApp('#/exercises');
  await page.waitFor(`document.querySelectorAll('.list-row').length > 0`, { what: 'the exercise list' });
}
async function goTo(hash, readyExpression, what) {
  await page.eval(`location.hash = ${js(hash)}`);
  await page.waitFor(`location.hash === ${js(hash)} && (${readyExpression})`, { what });
}

function tempFile(name, content) {
  const file = join(out, name);
  writeFileSync(file, content);
  return file;
}

const withoutLastBackup = (stores) => ({ ...stores, settings: stores.settings.filter((r) => r.key !== 'lastBackupAt') });
const sorted = (stores) =>
  Object.fromEntries(
    Object.keys(stores).sort().map((name) => [name, [...stores[name]].sort((a, b) => (js(a) < js(b) ? -1 : 1))])
  );

// ----- The checks -----
async function run() {
  await check('App shell: loads, five tabs switch, unknown routes go to Today', async () => {
    await page.goto(`${origin}/`);
    await page.waitFor(`location.hash === '#/today' && document.querySelector('.card')`, { what: 'the Today screen' });
    for (const tab of ['calendar', 'progress', 'exercises', 'settings', 'today']) {
      await click(`.tabbar a[data-tab="${tab}"]`);
      await page.waitFor(
        `document.querySelector('.tabbar [aria-current]')?.dataset.tab === ${js(tab)} && document.querySelector('main').children.length > 0`,
        { what: `the ${tab} tab` }
      );
      await noSidewaysScroll();
    }
    await page.eval(`location.hash = '#/no-such-screen'`);
    await page.waitFor(`location.hash === '#/today'`, { what: 'the fallback to Today' });
    await shot('today-light');
    await page.dark(true);
    await shot('today-dark');
    await page.dark(false);
  });

  await check('Service worker: installs, caches the whole app shell, no banner on first install', async () => {
    await openSettings();
    await page.waitFor(`${VERSION} === ${js(APP_VERSION)}`, { what: `version ${APP_VERSION} in Settings` });
    expect(await page.eval(`!!navigator.serviceWorker.controller`), 'the page has no service worker controller');
    equal(await page.eval(`caches.keys()`), [`shell-v${APP_VERSION}`], 'cache names');
    equal(
      await page.eval(`caches.open('shell-v${APP_VERSION}').then((c) => c.keys()).then((k) => k.length)`),
      PRECACHE_COUNT,
      'number of cached files'
    );
    expect(!(await page.eval(`!!document.getElementById('update-banner')`)), 'the update banner showed on first install');
  });

  await check('A page that is not cached comes from the network, not replaced by the app shell', async () => {
    await page.goto(`${origin}/tests/browser/`);
    await page.waitFor(`document.title.startsWith('Self-check: ') && !document.title.includes('running')`, {
      what: 'the standalone self-check page to finish',
      timeout: 20000,
    });
    equal(await page.eval(`document.title`), 'Self-check: PASS', 'standalone self-check page');
    expect(!(await page.eval(`!!document.querySelector('.tabbar')`)), 'index.html was served instead of the page');
  });

  await check('Settings: scrolls, and the reminder interval is saved and validated', async () => {
    await openSettings();
    await noSidewaysScroll();
    await page.eval(`window.scrollTo(0, 99999)`);
    expect(
      await page.eval(`(() => { const b = [...document.querySelectorAll('main .btn')].pop().getBoundingClientRect(); return b.bottom <= document.querySelector('.tabbar').getBoundingClientRect().top; })()`),
      'the last button is hidden behind the tab bar when scrolled to the bottom'
    );
    await page.eval(`window.scrollTo(0, 0)`);
    equal(await page.eval(REMINDER), '14', 'default reminder interval');
    await setReminder(30);
    await page.sleep(300);
    await openSettings();
    equal(await page.eval(REMINDER), '30', 'reminder interval after a reload');
    await setReminder('abc');
    await page.waitFor(`document.querySelector('.toast')`, { what: 'a message about the invalid value' });
    equal(await page.eval(REMINDER), '30', 'reminder interval after an invalid entry');
    await shot('settings-light');
    await page.dark(true);
    await shot('settings-dark');
    await page.dark(false);
  });

  await check('Self-check inside the app: all checks pass, back arrow returns to Settings', async () => {
    await openSettings();
    await page.eval(`[...document.querySelectorAll('main a.btn')].find((a) => a.textContent.includes('self-check')).click()`);
    const summary = await page.waitFor(
      `(() => { const s = document.querySelector('.check-summary'); return s && s.textContent !== 'Running…' ? s.textContent : null; })()`,
      { what: 'the self-check to finish', timeout: 20000 }
    );
    await shot('selfcheck');
    const failed = await page.eval(`[...document.querySelectorAll('.check-list li.fail')].map((li) => li.textContent).join(' | ')`);
    expect(/^All \d+ checks passed\.$/.test(summary), `${summary} ${failed}`);
    equal(await page.eval(`location.pathname + location.hash`), '/#/settings/selfcheck', 'address of the self-check');
    expect(!(await page.eval(`document.getElementById('back-button').hidden`)), 'no back arrow on the sub-screen');
    await click('#back-button');
    await page.waitFor(`location.hash === '#/settings' && ${REMINDER} === '30'`, { what: 'Settings after going back' });
    const databases = await page.eval(`indexedDB.databases().then((l) => l.map((d) => d.name))`);
    expect(!databases.some((name) => name.startsWith('selfcheck')), `scratch databases left behind: ${databases}`);
  });

  let exportedFile = null;
  await check('Backup export: cancel, the two-tap fallback, the file and the "Last backup" line', async () => {
    await openSettings();
    equal(await page.eval(LAST_BACKUP), 'Last backup: never', 'line before any backup');

    await stubShare('cancel');
    await click(EXPORT_BUTTON);
    await page.sleep(500);
    equal(await page.eval(LAST_BACKUP), 'Last backup: never', 'line after cancelling the share sheet');

    await stubShare('expired');
    await click(EXPORT_BUTTON);
    await page.waitFor(`document.querySelector(${js(EXPORT_BUTTON)}).textContent === 'Backup ready — tap to save'`, {
      what: 'the "tap to save" fallback',
    });
    equal(await page.eval(LAST_BACKUP), 'Last backup: never', 'line while the file is only prepared');
    await click(EXPORT_BUTTON);
    await page.waitFor(`window.__shared.length === 1`, { what: 'the file to reach the share sheet' });
    await page.waitFor(`${LAST_BACKUP}.startsWith('Last backup: today · ')`, { what: '"Last backup: today"' });

    const [shared] = await page.eval(`window.__shared`);
    expect(/^workout-backup-\d{2}-\d{2}-\d{4}\.json$/.test(shared.name), `filename is ${shared.name}`);
    equal(shared.keys, ['files'], 'what is passed to the share sheet');
    const backup = JSON.parse(shared.text);
    equal([backup.app, backup.schemaVersion, backup.appVersion], ['workout-tracker', fixture.schemaVersion, APP_VERSION], 'backup header');
    equal(Object.keys(backup.stores).sort(), Object.keys(fixture.stores).sort(), 'stores in the backup');
    exportedFile = tempFile(shared.name, shared.text);
  });

  await check('Backup reminder: muted line on Today and a dot on the Settings tab when due', async () => {
    const dot = `document.querySelector('.tabbar a[data-tab="settings"]').classList.contains('has-dot')`;
    expect(!(await page.eval(dot)), 'the dot shows right after a backup');
    await dbCall(`
      await db.setSetting('lastBackupAt', new Date(Date.now() - 40 * 86400000).toISOString());
      window.dispatchEvent(new Event('backup-changed'));`);
    await page.waitFor(dot, { what: 'the dot on the Settings tab' });
    await page.waitFor(`${LAST_BACKUP}.includes('40 days ago')`, { what: 'the "40 days ago" line' });
    await openApp('#/today');
    await page.waitFor(`(() => { const r = document.querySelector('.reminder'); return r && !r.hidden; })()`, { what: 'the reminder on Today' });
    equal(await text('.reminder'), 'Last backup: 40 days ago. Back up in Settings', 'reminder text');
    await shot('today-reminder');
  });

  await check('Backup import: restores an export, and cancelling changes nothing', async () => {
    expect(exportedFile, 'the export check did not produce a file');
    await openSettings();
    await setReminder(45);
    await page.sleep(300);
    const before = await dumpStores();

    await pickBackup(exportedFile);
    expect((await dialogText()).startsWith('Replace all data? This backup is from '), `dialog says: ${await dialogText()}`);
    await shot('import-confirm');
    await pressInDialog('Cancel');
    await dialogClosed();
    equal(await dumpStores(), before, 'data after cancelling');

    await pickBackup(exportedFile);
    await pressInDialog('Replace my data');
    await page.waitFor(`${REMINDER} === '30'`, { what: 'the reminder interval from the backup (30)' });
    await page.waitFor(`${LAST_BACKUP}.startsWith('Last backup: today')`, { what: '"Last backup" to follow the backup' });
  });

  await check('Backup import: refuses files it should not import, and changes nothing', async () => {
    const before = await dumpStores();

    await pickBackup(join(root, 'README.md'));
    expect((await dialogText()).includes('not a backup'), `dialog says: ${await dialogText()}`);
    await pressInDialog('OK');
    await dialogClosed();

    await pickBackup(tempFile('newer.json', js({ ...fixture, schemaVersion: fixture.schemaVersion + 1000 })));
    expect((await dialogText()).includes('Update the app first'), `dialog says: ${await dialogText()}`);
    await pressInDialog('OK');
    await dialogClosed();

    // Passes the file checks but breaks a unique index: the database must roll back.
    const clash = structuredClone(fixture);
    clash.stores.planExceptions[1].originalDate = clash.stores.planExceptions[0].originalDate;
    await pickBackup(tempFile('clash.json', js(clash)));
    await pressInDialog('Replace my data');
    await page.waitFor(`${DIALOG}?.querySelector('h2')?.textContent === 'Not imported'`, { what: 'the failure message' });
    await pressInDialog('OK');
    await dialogClosed();

    equal(await dumpStores(), before, 'data after three refused imports');
  }, { allowErrors: true }); // the rolled-back import logs its database error on purpose

  await check('Backup import: restores every store of the fixture exactly', async () => {
    await pickBackup(join(root, 'tests', 'fixtures', 'backup-v1.json'));
    await stubShare('ok');
    await pressInDialog('Export current data first');
    await page.waitFor(`window.__shared.length === 1`, { what: '"Export current data first" to produce a file' });
    expect(await page.eval(`!!${DIALOG}`), 'the dialog closed after exporting');
    await page.dark(true);
    await shot('import-confirm-dark');
    await page.dark(false);
    await pressInDialog('Replace my data');
    await dialogClosed();
    await page.waitFor(`${REMINDER} === '21'`, { what: 'the reminder interval from the fixture (21)' });
    const after = JSON.parse(await dumpStores());
    equal(sorted(withoutLastBackup(after)), sorted(withoutLastBackup(fixture.stores)), 'restored data');
    equal(await dbCall(`return db.getSetting('lastBackupAt');`), fixture.exportedAt, 'lastBackupAt');
    await openSettings();
    equal(await page.eval(REMINDER), '21', 'reminder interval after a reload');
  });

  // ----- Phase 1: exercise library (the fixture backup is loaded at this point) -----
  const total = expectedCount({});
  const DETAIL = `document.querySelector('.detail-title')`;

  await check('Exercise library: lists all exercises, recently used first, 60 at a time', async () => {
    await openLibrary();
    await waitCount(`${total} exercises`);
    equal(await rowTitles(3), ['Barbell Squat', 'Barbell Bench Press - Medium Grip', 'Ring rows'], 'recently used exercises on top');
    equal(await page.eval(`document.querySelectorAll('.list-row').length`), 60, 'rows shown at first');
    await click('main > button.btn.secondary');
    equal(await page.eval(`document.querySelectorAll('.list-row').length`), 120, 'rows after "Show more"');
    await noSidewaysScroll();
    await shot('exercises-light');
    await page.dark(true);
    await shot('exercises-dark');
    await page.dark(false);
  });

  await check('Exercise library: search, muscle chips (with secondary) and equipment chips', async () => {
    await typeInto('input[type=search]', 'press bench');
    await waitCount(`${expectedCount({ query: 'press bench' })} of ${total} exercises`);
    const titles = await rowTitles(100);
    expect(titles.length > 3 && titles.every((t) => /bench/i.test(t) && /press/i.test(t)), `search results: ${titles.slice(0, 5)}`);
    await typeInto('input[type=search]', 'zzzz');
    await waitCount('No exercises match.');
    await typeInto('input[type=search]', '');

    await tapChip('Back');
    await waitCount(`${expectedCount({ group: 'back' })} of ${total} exercises`);
    await tapChip('+ Secondary');
    await waitCount(`${expectedCount({ group: 'back', includeSecondary: true })} of ${total} exercises`);
    await tapChip('Dumbbell');
    await tapChip('Barbell');
    await waitCount(`${expectedCount({ group: 'back', includeSecondary: true, equipment: ['dumbbell', 'barbell'] })} of ${total} exercises`);
    await noSidewaysScroll();
    await shot('exercises-filtered');
    await tapChip('Dumbbell');
    await tapChip('Barbell');
    await tapChip('Back');
    await waitCount(`${total} exercises`);
    expect(
      await page.eval(`[...document.querySelectorAll('main .chip')].find((c) => c.textContent === '+ Secondary').disabled`),
      '"+ Secondary" can be tapped without a muscle chosen'
    );

    // Tapping a chip far along the row must not jump the row back to the start.
    await page.eval(`document.querySelector('.chip-row').scrollLeft = 9999`);
    const scrolled = await page.eval(`document.querySelector('.chip-row').scrollLeft`);
    expect(scrolled > 100, 'the muscle chip row does not scroll sideways');
    await tapChip('Neck');
    await waitCount(`${expectedCount({ group: 'neck' })} of ${total} exercises`);
    equal(await page.eval(`document.querySelector('.chip-row').scrollLeft`), scrolled, 'chip row position after tapping a chip');
    await tapChip('Chest'); // choosing another muscle replaces the first
    await waitCount(`${expectedCount({ group: 'chest' })} of ${total} exercises`);
    equal(await page.eval(`[...document.querySelectorAll('.chip-row')[0].querySelectorAll('[aria-pressed=true]')].map((c) => c.textContent)`), ['Chest'], 'pressed muscle chips');
    await tapChip('Chest');
    await waitCount(`${total} exercises`);
  });

  await check('Favourites: the star is saved, and "My exercises" shows favourites and custom exercises', async () => {
    await tapChip('★ My exercises');
    await waitCount(`2 of ${total} exercises`);
    equal(await rowTitles(), ['Barbell Squat', 'Ring rows'], 'my exercises from the fixture');
    await tapChip('★ My exercises');
    await typeInto('input[type=search]', 'pullups');
    await page.waitFor(`document.querySelector('.list-title')?.textContent === 'Pullups'`, { what: 'Pullups in the results' });
    await click('.list-row .star');
    await page.waitFor(`document.querySelector('.list-row .star').getAttribute('aria-pressed') === 'true'`, { what: 'the star to fill' });
    await typeInto('input[type=search]', '');
    await openLibrary(); // a full reload
    await tapChip('★ My exercises');
    await waitCount(`3 of ${total} exercises`);
    equal((await rowTitles()).sort(), ['Barbell Squat', 'Pullups', 'Ring rows'], 'my exercises after a reload');
    await tapChip('★ My exercises');
  });

  await check('Exercise detail: facts, muscles, instructions, my history, and the way back', async () => {
    await typeInto('input[type=search]', 'medium grip');
    await page.waitFor(`document.querySelector('.list-title')?.textContent === 'Barbell Bench Press - Medium Grip'`, { what: 'the bench press in the results' });
    await click('.list-row .list-link');
    await page.waitFor(`${DETAIL}?.textContent === 'Barbell Bench Press - Medium Grip'`, { what: 'the detail screen' });
    const bench = dataset.find((e) => e.id === 'Barbell_Bench_Press_-_Medium_Grip');
    equal(await page.eval(`document.querySelectorAll('.steps li').length`), bench.instructions.length, 'number of instruction steps');
    equal(await tagTexts(), ['Chest', 'Shoulders', 'Triceps'], 'muscle tags');
    equal(
      await page.eval(`[...document.querySelectorAll('.history li')].map((li) => [...li.children].map((c) => c.textContent))`),
      [['16-11-2026', '42.5 kg × 10 · 42.5 kg × 8']],
      'history (working sets only, DD-MM-YYYY)'
    );
    await noSidewaysScroll();
    await shot('exercise-detail');
    await page.dark(true);
    await shot('exercise-detail-dark');
    await page.dark(false);
    await click('#back-button');
    await page.waitFor(`location.hash === '#/exercises' && document.querySelector('.list-title')`, { what: 'the list after going back' });
    equal(await page.eval(`document.querySelector('input[type=search]').value`), 'medium grip', 'search text after coming back');
    await typeInto('input[type=search]', '');

    await goTo('#/exercises/Barbell_Squat', `${DETAIL}?.textContent === 'Barbell Squat'`, 'the squat');
    equal(await tagTexts(), ['Quadriceps', 'Glutes'], 'muscle tags edited in the fixture');
    expect(await page.eval(`document.querySelector('main').textContent.includes('Edited by you.')`), 'no "Edited by you" note');
    equal(await page.eval(`document.querySelectorAll('.history li').length`), 0, 'history must not include the in-progress workout');

    await goTo('#/exercises/No_Such_Exercise', `document.querySelector('.card-title')`, 'the not-found screen');
    expect(await page.eval(`document.querySelector('main').textContent.includes('No_Such_Exercise')`), 'the unknown id is not shown');
  });

  await check('Edit muscles: saved as an override, used by the filter, and resettable', async () => {
    const PICKER = `document.querySelector('[aria-label="Primary muscles"]')`;
    await goTo('#/exercises/Pullups/muscles', PICKER, 'the muscle picker');
    await tapPicker('Primary muscles', 'Lats'); // removes the only primary muscle
    await pressButton('Save');
    await waitToast('Choose at least one primary muscle.');
    await tapPicker('Primary muscles', 'Biceps'); // was secondary: moves to primary
    await shot('exercise-muscles');
    await pressButton('Save');
    await page.waitFor(`location.hash === '#/exercises/Pullups' && document.querySelector('.tag')`, { what: 'the detail screen after saving' });
    equal(await tagTexts(), ['Biceps', 'Middle back'], 'tags after the edit');
    const override = await dbCall(`return db.get('exerciseOverrides', 'Pullups');`);
    equal([override.primaryMuscles, override.secondaryMuscles, override.favourite], [['biceps'], ['middle back'], true], 'stored override (favourite kept)');

    await goTo('#/exercises', `document.querySelector('.list-title')`, 'the list');
    await tapChip('Biceps');
    await waitCount(`${expectedCount({ group: 'biceps' }) + 1} of ${total} exercises`); // Pullups now counts as biceps
    await tapChip('Biceps');

    await goTo('#/exercises/Pullups/muscles', `[...document.querySelectorAll('main .btn')].some((b) => b.textContent === 'Reset to original')`, 'the reset button');
    await pressButton('Reset to original');
    await page.waitFor(`location.hash === '#/exercises/Pullups' && document.querySelector('.tag')`, { what: 'the detail screen after the reset' });
    equal(await tagTexts(), ['Lats', 'Biceps', 'Middle back'], 'tags after the reset');
    const after = await dbCall(`return db.get('exerciseOverrides', 'Pullups');`);
    equal(Object.keys(after).sort(), ['exerciseId', 'favourite', 'updatedAt'], 'override after the reset');
  });

  await check('Custom exercises: create, find, edit and delete; text is never treated as markup', async () => {
    const name = 'Towel <b>row</b> & "pull"';
    const NAME_INPUT = `document.getElementById('exercise-name')`;

    await goTo('#/exercises', `document.querySelector('.btn.icon')`, 'the + button');
    await click('.btn.icon');
    await page.waitFor(NAME_INPUT, { what: 'the new exercise form' });
    await pressButton('Create exercise');
    await waitToast('Give the exercise a name.');
    await page.eval(`${NAME_INPUT}.value = ${js(name)}`);
    await pressButton('Create exercise');
    await waitToast('Choose the equipment.');
    await page.eval(`document.getElementById('exercise-equipment').value = 'other'`);
    await tapPicker('Primary muscles', 'Lats');
    await tapPicker('Secondary muscles', 'Forearms');
    await shot('exercise-new');
    await pressButton('Create exercise');
    await page.waitFor(`location.hash.startsWith('#/exercises/custom-') && ${DETAIL}`, { what: 'the new exercise' });
    equal(await text('.detail-title'), name, 'name shown as plain text');
    expect(!(await page.eval(`!!document.querySelector('main b')`)), 'the name was rendered as HTML');
    const id = await page.eval(`decodeURIComponent(location.hash.split('/')[2])`);
    const record = await dbCall(`return db.get('customExercises', ${js(id)});`);
    equal(
      [record.name, record.equipment, record.primaryMuscles, record.secondaryMuscles, record.archivedAt],
      [name, 'other', ['lats'], ['forearms'], null],
      'stored record'
    );

    await goTo('#/exercises', `document.querySelector('input[type=search]')`, 'the list');
    await typeInto('input[type=search]', 'towel');
    await page.waitFor(`[...document.querySelectorAll('.list-title')].some((n) => n.textContent === ${js(name)})`, { what: 'the custom exercise in the list' });
    expect((await rowTitles()).includes('Standing Towel Triceps Extension'), 'built-in and custom exercises are not listed together');
    expect(!(await page.eval(`!!document.querySelector('.list b')`)), 'the name was rendered as HTML in the list');
    await typeInto('input[type=search]', '');

    await goTo(`#/exercises/${id}/edit`, `${NAME_INPUT}?.value === ${js(name)}`, 'the edit form');
    await page.eval(`${NAME_INPUT}.value = 'Towel row'`);
    await pressButton('Save');
    await page.waitFor(`${DETAIL}?.textContent === 'Towel row'`, { what: 'the renamed exercise' });

    await pressButton('Delete exercise');
    await page.waitFor(DIALOG, { what: 'the delete confirmation' });
    await pressInDialog('Delete');
    await page.waitFor(`location.hash === '#/exercises'`, { what: 'the list after deleting' });
    equal(await dbCall(`return db.get('customExercises', ${js(id)});`), null, 'an unused custom exercise is deleted');

    // "Ring rows" is used by a logged workout: it must be archived, not deleted.
    const ringRows = fixture.stores.customExercises[0].id;
    await goTo(`#/exercises/${ringRows}`, `${DETAIL}?.textContent === 'Ring rows'`, 'Ring rows');
    equal(await page.eval(`[...document.querySelectorAll('.history li')].map((li) => li.children[1].textContent)`), ['12 reps'], 'bodyweight history');
    await pressButton('Delete exercise');
    await page.waitFor(DIALOG, { what: 'the delete confirmation' });
    await pressInDialog('Delete');
    await page.waitFor(`location.hash === '#/exercises' && document.querySelector('.list-title')`, { what: 'the list after deleting' });
    const archived = await dbCall(`return db.get('customExercises', ${js(ringRows)});`);
    expect(archived && typeof archived.archivedAt === 'string', 'a used custom exercise was not archived');
    await typeInto('input[type=search]', 'ring rows');
    await waitCount('No exercises match.');
    await typeInto('input[type=search]', '');
    equal(JSON.parse(await dumpStores()).workouts.length, fixture.stores.workouts.length, 'workouts are untouched');
  });

  // ----- Phase 2: logging workouts -----
  // The fixture's dates are fixed, so "last time" would depend on the day the
  // checks run. Move its completed workout to a week ago to make it stable.
  const today = todayStr();
  const lastWeek = addDays(today, -7);
  const BENCH = 'Barbell_Bench_Press_-_Medium_Grip';
  const card = (e) => `document.querySelectorAll('[data-entry]')[${e}]`;
  const row = (e, r) => `${card(e)}.querySelectorAll('.set-row')[${r}]`;
  const field = (e, r, n) => `${row(e, r)}.querySelectorAll('input')[${n}]`; // 0 = kg, 1 = reps
  const typeField = (e, r, n, value) =>
    page.eval(`(() => { const i = ${field(e, r, n)}; i.focus(); i.value = ${js(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`);
  const tapTick = (e, r) => page.eval(`${row(e, r)}.querySelector('.tick').click()`);
  const tapBadge = (e, r) => page.eval(`${row(e, r)}.querySelector('.set-badge').click()`);
  const rowsOf = (e) =>
    page.eval(`[...${card(e)}.querySelectorAll('.set-row')].map((r) => [r.querySelector('.set-badge').textContent, ...[...r.querySelectorAll('input')].map((i) => i.value), r.classList.contains('done')])`);
  const cardTitles = () => page.eval(`[...document.querySelectorAll('[data-entry] .card-title')].map((n) => n.textContent)`);
  const chooseAction = async (openExpression, label) => {
    await page.eval(`${openExpression}.click()`);
    await page.waitFor(DIALOG, { what: 'the options menu' });
    await pressInDialog(label);
    await dialogClosed();
  };
  const pickExercise = async (query, name) => {
    await page.eval(`[...document.querySelectorAll('main a.btn')].find((a) => a.textContent === '+ Add exercise').click()`);
    await page.waitFor(`document.querySelector('input[type=search]')`, { what: 'the exercise picker' });
    await typeInto('input[type=search]', query);
    await page.waitFor(`document.querySelector('button.list-link .list-title')?.textContent === ${js(name)}`, { what: `${name} in the picker` });
    await typeInto('input[type=search]', ''); // the picker shares the library's search text; leave it empty
    await typeInto('input[type=search]', query);
    await click('button.list-link');
    await page.waitFor(`[...document.querySelectorAll('[data-entry] .card-title')].some((n) => n.textContent === ${js(name)})`, { what: `${name} in the workout` });
  };
  const activeWorkout = () => dbCall(`return (await db.getAllFromIndex('workouts', 'status', 'active'))[0] ?? null;`);
  // Starting from Today offers the routines when there are any: pick one, or 'Empty workout'.
  const startFromToday = async (buttonLabel, choice) => {
    await page.waitFor(`[...document.querySelectorAll('main .btn')].some((b) => b.textContent === ${js(buttonLabel)})`, { what: `the "${buttonLabel}" button` });
    await pressButton(buttonLabel);
    await page.waitFor(DIALOG, { what: 'the choice of routines' });
    await pressInDialog(choice);
    await page.waitFor(`location.hash === '#/workout' && document.querySelector('main > p.muted')`, { what: 'the workout screen' });
  };

  await check('Today: a workout in progress is offered again, with a pill on other screens', async () => {
    await dbCall(`
      const completed = (await db.getAllFromIndex('workouts', 'status', 'completed'))[0];
      await db.saveWorkout({ ...completed, date: ${js(lastWeek)}, startedAt: ${js(`${lastWeek}T16:02:11.000Z`)} });
      // The fixture's plan has fixed dates too. Remove it; the plan checks below make their own.
      for (const store of ['planRules', 'planExceptions', 'plannedOneOffs']) {
        for (const record of await db.getAll(store)) await db.remove(store, record.id);
      }`);
    await openApp('#/today');
    await page.waitFor(`document.querySelector('.card-title')?.textContent === 'Workout in progress'`, { what: 'the in-progress card' });
    expect(/^(Started today|For 18-11-2026) · 1 exercise · 1 set done$/.test(await text('.card .muted')), `card says: ${await text('.card .muted')}`);
    expect(await page.eval(`document.querySelector('.pill').hidden`), 'the pill repeats the card on Today');
    await shot('today-in-progress');
    await goTo('#/settings', `${REMINDER} === '21'`, 'Settings');
    expect(!(await page.eval(`document.querySelector('.pill').hidden`)), 'no pill on Settings');
    await click('.pill');
    await page.waitFor(`location.hash === '#/workout' && document.querySelector('[data-entry] .set-row')`, { what: 'the workout screen' });
    expect(await page.eval(`document.querySelector('.pill').hidden`), 'the pill shows on the workout screen itself');
    equal(await page.eval(`document.querySelector('.tabbar [aria-current]').dataset.tab`), 'today', 'highlighted tab');
    equal(await text('#view-title'), 'Workout', 'screen title');
    await page.waitFor(`document.querySelector('[data-entry] .card-title')?.textContent === 'Barbell Squat'`, { what: 'the exercise name' });
    equal(await rowsOf(0), [['1', '60', '8', true], ['2', '', '', false]], 'rows of the resumed workout');

    await pressButton('Discard workout');
    await page.waitFor(DIALOG, { what: 'the discard confirmation' });
    await pressInDialog('Discard workout');
    await page.waitFor(`location.hash === '#/today' && document.querySelector('.card-title')?.textContent === 'Rest day'`, { what: 'Today after discarding' });
    equal(await activeWorkout(), null, 'workout in progress after discarding');
    expect(await page.eval(`document.querySelector('.pill').hidden`), 'the pill is still there');
  });

  await check('Logging: last time shown, ✓ accepts it, comma decimals, warm-up, copy and delete', async () => {
    await startFromToday('Start a workout anyway', 'Empty workout');
    await page.waitFor(`document.querySelector('.hint')`, { what: 'the empty workout' });
    await pickExercise('medium grip', 'Barbell Bench Press - Medium Grip');
    equal(await page.eval(`location.hash`), '#/workout', 'address after picking');

    // Last time: two working sets (the warm-up is not shown).
    equal(await page.eval(`${card(0)}.querySelector('.entry-title .muted').textContent`), `Last · ${formatShortDate(lastWeek, today)}: 42.5×10 · 42.5×8`, 'the "Last" line');
    equal(await rowsOf(0), [['1', '', '', false], ['2', '', '', false]], 'starts with as many rows as last time');
    equal(await page.eval(`[0, 1].map((r) => [...${card(0)}.querySelectorAll('.set-row')[r].querySelectorAll('input')].map((i) => i.placeholder))`),
      [['42.5', '10'], ['42.5', '8']], 'placeholders from last time');
    equal(await page.eval(`[...${row(0, 0)}.querySelectorAll('input')].map((i) => [i.getAttribute('inputmode'), getComputedStyle(i).fontSize])`),
      [['decimal', '16px'], ['numeric', '16px']], 'keyboards and font size (16px stops iOS zooming)');

    await tapTick(0, 0); // empty row: accepts last time's values
    await page.waitFor(`${row(0, 0)}.classList.contains('done')`, { what: 'row 1 to be ticked' });
    await typeField(0, 1, 0, '45,5'); // Danish decimal comma
    await typeField(0, 1, 1, '9');
    await tapTick(0, 1);
    await page.waitFor(`${row(0, 1)}.classList.contains('done')`, { what: 'row 2 to be ticked' });
    equal(await rowsOf(0), [['1', '42.5', '10', true], ['2', '45.5', '9', true]], 'rows after ticking');

    await page.eval(`[...${card(0)}.querySelectorAll('.btn')].find((b) => b.textContent === '+ Add set').click()`);
    await page.waitFor(`${card(0)}.querySelectorAll('.set-row').length === 3`, { what: 'a third row' });
    await tapTick(0, 2); // empty, and no third set last time: nothing is saved, the kg field gets focus
    equal(await page.eval(`document.activeElement === ${field(0, 2, 0)}`), true, 'kg field focused after ✓ on an empty row');
    equal((await rowsOf(0))[2], ['3', '', '', false], 'the empty row stays unticked');
    await typeField(0, 2, 0, '12 5'); // not a number
    expect(await page.eval(`${field(0, 2, 0)}.classList.contains('invalid') && ${field(0, 2, 0)}.value === '12 5'`), 'invalid text is not marked');
    equal((await activeWorkout()).exercises[0].sets[2].kg, null, 'stored weight for invalid text');
    await tapTick(0, 2);
    equal((await rowsOf(0))[2][3], false, 'a row with an invalid weight and no reps is not ticked');
    await typeField(0, 2, 0, '');

    await chooseAction(`${row(0, 2)}.querySelector('.icon-button')`, 'Copy previous set');
    equal((await rowsOf(0))[2], ['3', '45.5', '9', false], 'row 3 after "Copy previous set"');
    await tapBadge(0, 2);
    await page.waitFor(`${row(0, 2)}.querySelector('.set-badge').textContent === 'W'`, { what: 'the warm-up badge' });
    await tapTick(0, 2);
    await page.waitFor(`${row(0, 2)}.classList.contains('done')`, { what: 'the warm-up to be ticked' });

    await page.eval(`[...${card(0)}.querySelectorAll('.btn')].find((b) => b.textContent === '+ Add set').click()`);
    await page.waitFor(`${card(0)}.querySelectorAll('.set-row').length === 4`, { what: 'a fourth row' });
    await chooseAction(`${row(0, 3)}.querySelector('.icon-button')`, 'Delete set');
    equal((await rowsOf(0)).length, 3, 'rows after deleting one');

    await page.eval(`(() => { const n = document.getElementById('workout-notes'); n.value = 'Felt <b>good</b>'; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await page.eval(`(() => { const d = document.getElementById('workout-duration'); d.value = '55'; d.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await noSidewaysScroll();
    await shot('workout-light');
    await page.dark(true);
    await shot('workout-dark');
    await page.dark(false);

    // Closing the app must lose nothing: reload and compare.
    await page.sleep(300);
    await openApp('#/workout');
    await page.waitFor(`document.querySelector('[data-entry] .card-title')?.textContent === 'Barbell Bench Press - Medium Grip'`, { what: 'the workout after a reload' });
    equal(await rowsOf(0), [['1', '42.5', '10', true], ['2', '45.5', '9', true], ['W', '45.5', '9', true]], 'rows after a reload');
    equal(await page.eval(`[document.getElementById('workout-notes').value, document.getElementById('workout-duration').value]`), ['Felt <b>good</b>', '55'], 'notes and duration after a reload');
    const stored = await activeWorkout();
    equal(stored.exercises[0].sets.map((s) => [s.kg, s.reps, s.warmup, s.done]), [[42.5, 10, false, true], [45.5, 9, false, true], [45.5, 9, true, true]], 'stored sets');
    equal(stored.exerciseIds, [BENCH], 'stored exercise ids');
  });

  let finishedId = null;
  await check('Finishing: reorder, bodyweight set, unticked rows removed after a confirmation', async () => {
    await pickExercise('pullups', 'Pullups');
    equal(await cardTitles(), ['Barbell Bench Press - Medium Grip', 'Pullups'], 'exercise order');
    equal(await rowsOf(1), [['1', '', '', false], ['2', '', '', false], ['3', '', '', false]], 'a new exercise starts with three rows');
    expect(!(await page.eval(`!!${card(1)}.querySelector('.entry-title .muted')`)), 'a "Last" line shows for an exercise never done');
    await chooseAction(`${card(1)}.querySelector('.entry-head .icon-button')`, 'Move up');
    equal(await cardTitles(), ['Pullups', 'Barbell Bench Press - Medium Grip'], 'order after "Move up"');
    await typeField(0, 0, 1, '12'); // reps only: a bodyweight set
    await tapTick(0, 0);
    await page.waitFor(`${row(0, 0)}.classList.contains('done')`, { what: 'the bodyweight set to be ticked' });
    equal((await rowsOf(0))[0], ['1', '0', '12', true], 'bodyweight row');

    await pressButton('Finish workout');
    await page.waitFor(DIALOG, { what: 'the finish confirmation' });
    expect((await dialogText()).includes('2 sets are not ticked and will be removed.'), `dialog says: ${await dialogText()}`);
    await pressInDialog('Cancel');
    await dialogClosed();
    equal((await rowsOf(0)).length, 3, 'rows after cancelling');
    await pressButton('Finish workout');
    await page.waitFor(DIALOG, { what: 'the finish confirmation' });
    await pressInDialog('Finish');
    await page.waitFor(`location.hash.startsWith('#/calendar/') && document.querySelector('.stats')`, { what: 'the summary' });

    finishedId = await page.eval(`decodeURIComponent(location.hash.split('/')[2])`);
    const stored = await dbCall(`return db.get('workouts', ${js(finishedId)});`);
    equal([stored.status, stored.date, stored.durationMin, stored.notes, typeof stored.finishedAt], ['completed', today, 55, 'Felt <b>good</b>', 'string'], 'stored workout');
    equal(stored.exercises.map((e) => [e.exerciseId, e.sets.length]), [['Pullups', 1], [BENCH, 3]], 'stored exercises (unticked rows gone)');
    equal(stored.exerciseIds, ['Pullups', BENCH], 'stored exercise ids');
    equal(await activeWorkout(), null, 'workout in progress after finishing');
    expect(await page.eval(`document.querySelector('.pill').hidden`), 'the pill is still there after finishing');
  });

  await check('Summary: totals, muscles toward the weekly target, comparison with last time', async () => {
    equal(await text('.card-title'), `${weekdayName(today)} ${formatDate(today)}`, 'summary title');
    equal(await page.eval(`[...document.querySelectorAll('.stat')].map((s) => s.textContent)`),
      ['2exercises', '3sets', '835kg volume', '55minutes'], 'totals (42.5×10 + 45.5×9 = 834.5 kg; the warm-up is not counted)');
    expect(await page.eval(`document.querySelector('main').textContent.includes('Plus 1 warm-up set, not counted.')`), 'no warm-up note');

    const library = new Map(mergeExercises(dataset, [], []).map((e) => [e.id, e]));
    const set = { kg: 1, reps: 1, warmup: false, done: true };
    // The fixture's settings apply: counting mode "primary" and a chest target of 12.
    const setting = (key) => fixture.stores.settings.find((s) => s.key === key).value;
    const expected = weekProgress(
      { exercises: [{ exerciseId: 'Pullups', sets: [set] }, { exerciseId: BENCH, sets: [set, set] }] }, [], library,
      { mode: setting('volumeCounting'), targets: resolveTargets(setting('muscleTargets')) }
    );
    equal(await page.eval(`[...document.querySelectorAll('.progress-head')].map((h) => [...h.children].map((c) => c.textContent))`),
      expected.map((g) => [g.label, `+${formatKg(g.added)} → ${formatKg(g.after)}${g.target ? ` / ${formatKg(g.target)}` : ''} sets`]), 'muscle groups');
    equal(expected.map((g) => [g.id, g.added, g.target]), [['chest', 2, 12], ['back', 1, 10]], 'expected muscle sets');
    equal(await page.eval(`document.querySelectorAll('.bar-marker').length`), expected.filter((g) => g.target).length, 'target markers');

    equal(await page.eval(`[...document.querySelectorAll('.history li')].map((li) => [...li.children].map((c) => c.textContent))`), [
      ['Pullups', '12 reps', 'First time'],
      ['Barbell Bench Press - Medium Grip', '42.5 kg × 10 · 45.5 kg × 9', `Last time (${formatDate(lastWeek)}): 42.5 kg × 10 · 42.5 kg × 8`, '+70 kg volume'],
    ], 'exercises compared with last time');
    equal(await text('.notes'), 'Felt <b>good</b>', 'notes as plain text');
    expect(!(await page.eval(`!!document.querySelector('main b')`)), 'notes were rendered as HTML');
    await noSidewaysScroll();
    await shot('summary-light');
    await page.dark(true);
    await shot('summary-dark');
    await page.dark(false);
  });

  await check('History: list, edit a past workout (sets and date), delete it', async () => {
    const yesterday = addDays(today, -1);
    await goTo('#/calendar/history', `document.querySelectorAll('.list-row').length === 2`, 'two workouts in the history');
    equal(await page.eval(`[...document.querySelectorAll('.list-row')].map((r) => [...r.querySelectorAll('span')].map((s) => s.textContent).slice(0, 2))`), [
      [`${weekdayName(today)} ${formatDate(today)}`, '2 exercises · 3 sets · 835 kg'],
      [`${weekdayName(lastWeek)} ${formatDate(lastWeek)}`, 'Push day · 2 exercises · 3 sets · 765 kg'],
    ], 'history rows, newest first');
    await shot('history');
    await click('.list-row .list-link');
    await page.waitFor(`document.querySelector('.stats')`, { what: 'the summary' });
    await page.eval(`[...document.querySelectorAll('main a.btn')].find((a) => a.textContent === 'Edit workout').click()`);
    await page.waitFor(`location.hash.endsWith('/edit') && document.querySelectorAll('[data-entry]').length === 2 && document.getElementById('workout-date')`, { what: 'the editor' });
    await page.waitFor(`document.querySelector('[data-entry] .card-title')?.textContent === 'Pullups'`, { what: 'exercise names' });
    equal(await page.eval(`document.getElementById('workout-date').value`), today, 'date field');
    await typeField(1, 1, 1, '10'); // 45.5 × 9 → 45.5 × 10
    await page.eval(`(() => { const d = document.getElementById('workout-date'); d.value = ${js(yesterday)}; d.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await shot('workout-edit');
    await pressButton('Done');
    await page.waitFor(`location.hash === ${js(`#/calendar/${finishedId}`)} && document.querySelector('.stats')`, { what: 'the summary after editing' });
    equal(await text('.card-title'), `${weekdayName(yesterday)} ${formatDate(yesterday)}`, 'summary date after editing');
    equal(await page.eval(`document.querySelectorAll('.stat')[2].textContent`), '880kg volume', 'volume after editing (42.5×10 + 45.5×10)');
    const stored = await dbCall(`return db.get('workouts', ${js(finishedId)});`);
    equal([stored.status, stored.date, stored.exercises[1].sets[1].reps], ['completed', yesterday, 10], 'stored workout after editing');
    equal(await activeWorkout(), null, 'editing a past workout must not create one in progress');

    await pressButton('Delete workout');
    await page.waitFor(DIALOG, { what: 'the delete confirmation' });
    await pressInDialog('Delete workout');
    await page.waitFor(`location.hash === '#/calendar' && document.querySelector('.month-grid .day')`, { what: 'the calendar after deleting' });
    await goTo('#/calendar/history', `document.querySelectorAll('.list-row').length === 1`, 'one workout left in the history');
    equal(await page.eval(`[...document.querySelectorAll('.segment')].map((a) => [a.textContent, a.getAttribute('aria-current')])`), [['Month', null], ['List', 'page']], 'the Month / List switch');
    equal(await dbCall(`return db.get('workouts', ${js(finishedId)});`), null, 'the deleted workout');
    await goTo(`#/calendar/${finishedId}`, `document.querySelector('.card-title')?.textContent === 'Workout not found'`, 'the not-found screen');
  });

  // ----- Phase 3: routines and calendar planning -----
  // At this point: one finished workout a week ago ("Push day"), the routine
  // "Push day" (bench press, 3 sets), no plan, and no workout in progress.
  const yesterday = addDays(today, -1);
  const [in2, in3, in4] = [2, 3, 4].map((n) => addDays(today, n));
  const routineCards = () =>
    page.eval(`[...document.querySelectorAll('[data-routine-exercise]')].map((c) => [c.querySelector('.card-title').textContent, ...[...c.querySelectorAll('input')].map((i) => i.value)])`);
  const routineField = (c, n, value) =>
    page.eval(`(() => { const i = document.querySelectorAll('[data-routine-exercise]')[${c}].querySelectorAll('input')[${n}]; i.focus(); i.value = ${js(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`);
  const addToRoutine = async (query, name) => {
    await page.eval(`[...document.querySelectorAll('main a.btn')].find((a) => a.textContent === '+ Add exercise').click()`);
    await page.waitFor(`document.querySelector('input[type=search]')`, { what: 'the exercise picker' });
    await typeInto('input[type=search]', query);
    await page.waitFor(`document.querySelector('button.list-link .list-title')?.textContent === ${js(name)}`, { what: `${name} in the picker` });
    await typeInto('input[type=search]', '');
    await typeInto('input[type=search]', query);
    await click('button.list-link');
    await page.waitFor(`[...document.querySelectorAll('[data-routine-exercise] .card-title')].some((n) => n.textContent === ${js(name)})`, { what: `${name} in the routine` });
  };
  const routineNames = () => page.eval(`[...document.querySelectorAll('.list-row .list-title')].map((n) => n.textContent)`);
  const marks = (date) => page.eval(`document.querySelector('.day[data-date="${date}"] .day-marks').textContent`);
  const panelCards = () => page.eval(`[...document.querySelectorAll('main .card')].map((c) => [c.querySelector('.card-title')?.textContent, c.querySelector('.muted')?.textContent ?? null])`);
  const selectDay = async (date) => {
    await click(`.day[data-date="${date}"]`);
    await page.waitFor(`document.querySelector('.panel-title')?.textContent.startsWith(${js(`${weekdayName(date)} ${formatDate(date)}`)})`, { what: `the panel for ${date}` });
  };
  const waitMarks = (date, expected) =>
    page.waitFor(`document.querySelector('.day[data-date="${date}"] .day-marks')?.textContent === ${js(expected)}`, { what: `"${expected}" on ${date}` });
  const stored = (store) => dbCall(`return db.getAll(${js(store)});`);
  let pullId = null;
  const pushId = fixture.stores.routines[0].id;

  await check('Routines: create, name, add exercises, sets and rep range, reorder, duplicate, delete', async () => {
    await goTo('#/calendar/plan', `document.querySelector('.card-title')?.textContent === 'Weekly plan' && document.querySelector('.list-row')`, 'Plan & routines');
    equal(await routineNames(), ['Push day'], 'routines at the start (the archived one is hidden)');
    expect(await page.eval(`document.querySelector('.card').textContent.includes('No plan yet')`), 'a plan shows although none exists');
    await pressButton('New routine');
    await page.waitFor(`location.hash.startsWith('#/calendar/routines/') && document.getElementById('routine-name')?.value === 'New routine'`, { what: 'the new routine' });
    pullId = await page.eval(`decodeURIComponent(location.hash.split('/')[3])`);
    await page.eval(`(() => { const n = document.getElementById('routine-name'); n.value = '  Pull   day '; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);

    await addToRoutine('pullups', 'Pullups');
    equal(await page.eval(`location.hash`), `#/calendar/routines/${pullId}`, 'address after picking');
    await addToRoutine('seated cable rows', 'Seated Cable Rows');
    equal(await routineCards(), [['Pullups', '3', '8', '12'], ['Seated Cable Rows', '3', '8', '12']], 'new exercises default to 3 sets of 8–12');

    await routineField(0, 0, '4'); // sets
    await routineField(0, 1, '15'); // minimum above the maximum: the two swap
    equal((await routineCards())[0], ['Pullups', '4', '12', '15'], 'sets and rep range after editing');
    await routineField(1, 0, ''); // empty falls back to the default
    await routineField(1, 2, '500'); // above the limit: marked, not stored
    equal((await routineCards())[1], ['Seated Cable Rows', '3', '8', '12'], 'invalid values fall back');
    equal(await page.eval(`[...document.querySelectorAll('.routine-fields input')].map((i) => [i.getAttribute('inputmode'), getComputedStyle(i).fontSize]).every(([m, f]) => m === 'numeric' && f === '16px')`), true, 'numeric keyboards at 16px');

    await chooseAction(`document.querySelector('[data-routine-exercise] .icon-button')`, 'Move down');
    equal((await routineCards()).map((c) => c[0]), ['Seated Cable Rows', 'Pullups'], 'order after "Move down"');
    await noSidewaysScroll();
    await shot('routine-light');
    await page.dark(true);
    await shot('routine-dark');
    await page.dark(false);

    await page.sleep(300);
    await openApp(`#/calendar/routines/${pullId}`); // nothing is lost when the app is closed
    await page.waitFor(`document.querySelector('[data-routine-exercise] .card-title')?.textContent === 'Seated Cable Rows'`, { what: 'the routine after a reload' });
    equal(await page.eval(`document.getElementById('routine-name').value`), 'Pull day', 'name after a reload (tidied)');
    equal(await routineCards(), [['Seated Cable Rows', '3', '8', '12'], ['Pullups', '4', '12', '15']], 'exercises after a reload');

    await pressButton('Duplicate routine');
    await page.waitFor(`document.getElementById('routine-name')?.value === 'Pull day copy'`, { what: 'the copy' });
    const copyId = await page.eval(`decodeURIComponent(location.hash.split('/')[3])`);
    expect(copyId !== pullId, 'the copy has the same id');
    await page.waitFor(`document.querySelectorAll('[data-routine-exercise]').length === 2`, { what: 'the copy\'s exercises' });
    await click('#back-button'); // one level up is not a screen of its own: lands on Plan & routines
    await page.waitFor(`location.hash === '#/calendar/plan' && document.querySelectorAll('.list-row').length === 3`, { what: 'three routines' });
    equal(await routineNames(), ['Pull day', 'Pull day copy', 'Push day'], 'routines by name');
    equal(await page.eval(`[...document.querySelectorAll('.list-row .muted')].map((n) => n.textContent)`), ['2 exercises · 7 sets', '2 exercises · 7 sets', '1 exercise · 3 sets'], 'routine summaries');
    await shot('plan-empty');

    await goTo(`#/calendar/routines/${copyId}`, `document.getElementById('routine-name')?.value === 'Pull day copy'`, 'the copy');
    await pressButton('Delete routine');
    await page.waitFor(DIALOG, { what: 'the delete confirmation' });
    await pressInDialog('Delete');
    await page.waitFor(`location.hash === '#/calendar/plan' && document.querySelectorAll('.list-row').length === 2`, { what: 'two routines after deleting' });
    equal(await dbCall(`return db.get('routines', ${js(copyId)});`), null, 'an unused routine is deleted');
  });

  await check('Weekly plan: fixed weekdays, on the calendar years ahead, and on Today', async () => {
    const todayName = weekdayName(today);
    const in2Name = weekdayName(in2);
    await goTo('#/calendar/plan/edit', `document.querySelector('select[aria-label="Monday"]')`, 'the plan editor');
    await page.eval(`(() => {
      const set = (label, value) => { const s = document.querySelector('select[aria-label="' + label + '"]'); s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); };
      set(${js(todayName)}, ${js(pullId)});
      set(${js(in2Name)}, ${js(pushId)});
    })()`);
    equal(await page.eval(`[document.getElementById('plan-start').value, document.getElementById('plan-start').min]`), [today, today], 'the plan starts today by default, never earlier');
    await shot('plan-edit');
    await pressButton('Save plan');
    await page.waitFor(`location.hash === '#/calendar/plan' && document.querySelector('.plain-list')`, { what: 'the saved plan' });
    const order = [todayName, in2Name].sort((a, b) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(a) - ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(b));
    equal(await page.eval(`[...document.querySelectorAll('.plain-list li')].map((n) => n.textContent)`),
      order.map((name) => `${name} · ${name === todayName ? 'Pull day' : 'Push day'}`), 'plan summary');
    expect(await page.eval(`document.querySelector('.card').textContent.includes(${js(`Since ${formatDate(today)}.`)})`), 'no "Since" date');
    const rules = await stored('planRules');
    const wd = (date) => ((new Date(`${date}T12:00:00`).getDay() + 6) % 7) + 1;
    equal(rules.map((r) => [r.type, r.startDate, r.endDate, r.days]), [['weekly', today, null, { [wd(today)]: pullId, [wd(in2)]: pushId }]], 'stored plan');
    await shot('plan-light');

    // The calendar: today and the day after tomorrow are planned.
    await goTo('#/calendar', `document.querySelectorAll('.month-grid .day').length === 42 && document.querySelector('.panel-title')`, 'the month view');
    await waitMarks(today, '○');
    equal(await marks(in2), '○', `mark on ${in2}`);
    equal(await marks(addDays(today, 1)), '', 'mark on a rest day');
    equal(await text('.month-title'), monthLabel(today), 'month title');
    equal(await page.eval(`document.querySelector('.day.today').dataset.date`), today, 'the day marked as today');
    expect((await text('.panel-title')).endsWith('· today'), 'today is not selected at first');
    equal((await panelCards())[0], ['Planned: Pull day', '2 exercises · 7 sets'], 'panel for today');
    await noSidewaysScroll();
    await shot('calendar-light');
    await page.dark(true);
    await shot('calendar-dark');
    await page.dark(false);

    // Five years ahead, instantly, with the plan still on its weekdays.
    for (let i = 0; i < 5; i++) await click('[aria-label="Next year"]');
    const far = addMonths(today, 60);
    equal(await text('.month-title'), monthLabel(far), 'month title five years ahead');
    const expectedPlanned = monthGrid(far).filter((d) => d.inMonth && [wd(today), wd(in2)].includes(wd(d.date))).length;
    equal(await page.eval(`document.querySelectorAll('.day:not(.outside) .mark.planned').length`), expectedPlanned, 'planned days five years ahead');
    equal(await page.eval(`document.querySelectorAll('.mark.missed').length`), 0, 'missed days in the future');
    for (let i = 0; i < 7; i++) await click('[aria-label="Previous year"]');
    equal(await text('.month-title'), monthLabel(addMonths(today, -24)), 'month title two years back');
    equal(await page.eval(`document.querySelectorAll('.day:not(.outside) .mark').length`), 0, 'nothing is planned or missed before the plan started');
    await pressButton('Today');
    equal(await text('.month-title'), monthLabel(today), 'month title after "Today"');

    // Today shows the planned workout with a big Start button.
    await goTo('#/today', `document.querySelector('.card-title')?.textContent === 'Pull day'`, 'the planned workout on Today');
    equal(await page.eval(`[...document.querySelectorAll('.card .plain-list li')].map((n) => n.textContent)`),
      ['Seated Cable Rows · 3 × 8–12', 'Pullups · 4 × 12–15'], 'exercises of the planned routine');
    expect(await page.eval(`[...document.querySelectorAll('main .btn.big')].some((b) => b.textContent === 'Start workout')`), 'no big Start button');
    equal(await page.eval(`[...document.querySelectorAll('main .hint')].map((n) => n.textContent)`), [`Next: ${in2Name} ${formatDate(in2)} · Push day`], 'the "Next" line');
    await shot('today-planned');
    await page.dark(true);
    await shot('today-planned-dark');
    await page.dark(false);
  });

  await check('A planned day: cancel and restore, change routine, move, one-off workouts', async () => {
    await goTo('#/calendar', `document.querySelectorAll('.month-grid .day').length === 42 && document.querySelector('.panel-title')`, 'the month view');
    await selectDay(in2);
    equal((await panelCards())[0], ['Planned: Push day', '1 exercise · 3 sets'], `panel for ${in2}`);

    await pressButton('Cancel this workout');
    await waitMarks(in2, '–');
    equal((await panelCards())[0][0], 'Cancelled: Push day', 'card after cancelling');
    equal((await stored('planExceptions')).map((e) => [e.originalDate, e.cancelled, e.movedTo, e.routineId]), [[in2, true, null, null]], 'stored exception');
    await pressButton('Restore');
    await waitMarks(in2, '○');
    equal(await stored('planExceptions'), [], 'no exception is kept once nothing deviates');

    await pressButton('Change routine');
    await page.waitFor(DIALOG, { what: 'the routine choice' });
    await pressInDialog('Pull day');
    await page.waitFor(`document.querySelector('main .card .card-title')?.textContent === 'Planned: Pull day'`, { what: 'the changed routine' });

    await pressButton('Move to another date');
    await page.waitFor(`${DIALOG}?.querySelector('input[type=date]')`, { what: 'the date picker' });
    equal(await page.eval(`${DIALOG}.querySelector('input[type=date]').value`), in2, 'the date picker starts on the current date');
    await page.eval(`${DIALOG}.querySelector('input[type=date]').value = ${js(in3)}`);
    await pressInDialog('Move');
    await waitMarks(in3, '○');
    equal(await marks(in2), '', 'the day it was moved away from');
    await selectDay(in3);
    equal((await panelCards())[0], ['Planned: Pull day', `2 exercises · 7 sets · moved from ${formatDate(in2)}`], 'the moved workout');
    equal((await stored('planExceptions')).map((e) => [e.originalDate, e.cancelled, e.movedTo, e.routineId]), [[in2, false, in3, pullId]], 'one exception holds both changes');
    await shot('calendar-day');

    // One-off workouts: on a free day, without a routine; then deleted.
    await selectDay(in4);
    expect((await page.eval(`document.querySelector('main').textContent`)).includes('Nothing planned or logged.'), 'the free day is not empty');
    await pressButton('Plan a workout on this day');
    await page.waitFor(DIALOG, { what: 'the routine choice' });
    await pressInDialog('No routine (empty workout)');
    await waitMarks(in4, '○');
    equal((await panelCards())[0], ['Planned: Workout', 'one-off'], 'the one-off');
    await pressButton('Delete');
    await page.waitFor(DIALOG, { what: 'the delete confirmation' });
    await pressInDialog('Delete');
    await waitMarks(in4, '');
    equal(await stored('plannedOneOffs'), [], 'one-offs after deleting');

    // A planned workout in the past that was not done is "missed".
    await selectDay(yesterday);
    await pressButton('Plan a workout on this day');
    await page.waitFor(DIALOG, { what: 'the routine choice' });
    await pressInDialog('Push day');
    await waitMarks(yesterday, '×');
    equal((await panelCards())[0], ['Missed: Push day', '1 exercise · 3 sets · one-off'], 'the missed workout');
    expect((await page.eval(`document.querySelector('.day[data-date="${yesterday}"]').getAttribute('aria-label')`)).endsWith('missed: Push day'), 'the day is not announced as missed');
  });

  let plannedWorkoutId = null;
  await check('Starting a planned workout: rows from the routine, linked to the plan, shown as done', async () => {
    await pressButton('Start'); // yesterday's missed "Push day"
    await page.waitFor(`location.hash === '#/workout' && document.querySelector('[data-entry] .set-row')`, { what: 'the workout' });
    await page.waitFor(`document.querySelector('[data-entry] .card-title')?.textContent === 'Barbell Bench Press - Medium Grip'`, { what: 'the routine\'s exercise' });
    expect((await text('main > p.muted')).startsWith(`Push day · ${weekdayName(today)} ${formatDate(today)}`), `heading says: ${await text('main > p.muted')}`);
    equal(await rowsOf(0), [['1', '', '', false], ['2', '', '', false], ['3', '', '', false]], 'rows come from the routine (3 sets)');
    const oneOff = (await stored('plannedOneOffs'))[0];
    const active = await activeWorkout();
    equal([active.date, active.routineId, active.routineName, active.plannedRef, active.exercises[0].repMin, active.exercises[0].repMax],
      [today, pushId, 'Push day', `oneoff:${oneOff.id}`, 8, 12], 'stored workout');

    // While it is in progress, another one cannot be started.
    await goTo('#/calendar', `document.querySelector('.panel-title')`, 'the month view');
    await selectDay(today);
    await page.waitFor(`[...document.querySelectorAll('main .card .card-title')].some((n) => n.textContent === 'In progress: Push day')`, { what: 'the in-progress card' });
    expect(await page.eval(`[...document.querySelectorAll('main .btn')].find((b) => b.textContent === 'Start').disabled`), 'Start is enabled while a workout is in progress');
    await click('.pill');
    await page.waitFor(`location.hash === '#/workout' && document.querySelector('[data-entry] .set-row')`, { what: 'the workout again' });
    await page.waitFor(`${field(0, 0, 0)}.placeholder === '42.5'`, { what: 'last time as placeholder' });

    await tapTick(0, 0); // accepts last time: 42.5 × 10
    await page.waitFor(`${row(0, 0)}.classList.contains('done')`, { what: 'the tick' });
    await pressButton('Finish workout');
    await page.waitFor(DIALOG, { what: 'the finish confirmation' });
    await pressInDialog('Finish');
    await page.waitFor(`location.hash.startsWith('#/calendar/') && document.querySelector('.stats')`, { what: 'the summary' });
    plannedWorkoutId = await page.eval(`decodeURIComponent(location.hash.split('/')[2])`);
    expect(await page.eval(`document.querySelector('.card').textContent.includes('Push day')`), 'the summary does not name the routine');

    // Yesterday is no longer missed; today counts as done (so today's own plan is not shown as open).
    await click('#back-button');
    await page.waitFor(`location.hash === '#/calendar' && document.querySelector('.panel-title')`, { what: 'the month view' });
    await waitMarks(today, '●');
    equal(await marks(yesterday), '', 'yesterday after doing its workout today');
    await selectDay(today);
    equal((await panelCards())[0], ['Done: Push day', '1 exercise · 1 set'], 'panel for today');
    await goTo('#/today', `document.querySelector('.card-title')?.textContent === 'Done today: Push day'`, 'Today after the workout');
    expect(await page.eval(`[...document.querySelectorAll('main .btn')].some((b) => b.textContent === 'Start another workout')`), 'no way to start another workout');
    equal(await page.eval(`[...document.querySelectorAll('main .hint')].map((n) => n.textContent)`), [`Next: ${weekdayName(in3)} ${formatDate(in3)} · Pull day`], 'the "Next" line follows the moved workout');
  });

  await check('Starting from a routine, logging a past day, and deleting routines that are in use', async () => {
    await startFromToday('Start another workout', 'Pull day');
    await page.waitFor(`document.querySelectorAll('[data-entry]').length === 2`, { what: 'the routine\'s exercises' });
    await page.waitFor(`document.querySelector('[data-entry] .card-title')?.textContent === 'Seated Cable Rows'`, { what: 'exercise names' });
    equal([(await rowsOf(0)).length, (await rowsOf(1)).length], [3, 4], 'rows per exercise');
    let active = await activeWorkout();
    equal([active.routineName, active.plannedRef, active.exercises.map((e) => [e.repMin, e.repMax])], ['Pull day', null, [[8, 12], [12, 15]]], 'stored workout from a routine');
    await pressButton('Discard workout');
    await page.waitFor(DIALOG, { what: 'the discard confirmation' });
    await pressInDialog('Discard workout');
    await page.waitFor(`location.hash === '#/today'`, { what: 'Today' });

    // Logging a workout for a past day.
    await goTo('#/calendar', `document.querySelector('.panel-title')`, 'the month view');
    await selectDay(yesterday);
    await pressButton('Log a workout for this day');
    await page.waitFor(`location.hash === '#/workout' && document.querySelector('.hint')`, { what: 'the workout for yesterday' });
    active = await activeWorkout();
    equal([active.date, active.routineId], [yesterday, null], 'the workout counts for yesterday');
    expect((await text('main > p.muted')).startsWith(`${weekdayName(yesterday)} ${formatDate(yesterday)}`), 'the heading does not show yesterday');
    await pressButton('Discard workout');
    await page.waitFor(DIALOG, { what: 'the discard confirmation' });
    await pressInDialog('Discard workout');
    await page.waitFor(`location.hash === '#/today'`, { what: 'Today' });

    // A routine in the weekly plan cannot be deleted.
    await goTo(`#/calendar/routines/${pullId}`, `document.getElementById('routine-name')?.value === 'Pull day'`, 'Pull day');
    await pressButton('Delete routine');
    await page.waitFor(DIALOG, { what: 'the delete confirmation' });
    await pressInDialog('Delete');
    await page.waitFor(`${DIALOG}?.querySelector('h2')?.textContent === 'Still in your weekly plan'`, { what: 'the refusal' });
    await pressInDialog('OK');
    await dialogClosed();
    equal((await dbCall(`return db.get('routines', ${js(pullId)});`)).archivedAt, null, 'the routine after the refused delete');

    // Stop planning; then it can go. It is still referred to (a changed day), so it is archived, not deleted.
    await goTo('#/calendar/plan/edit', `[...document.querySelectorAll('main .btn')].some((b) => b.textContent === 'Stop planning')`, 'the plan editor');
    equal(await page.eval(`document.querySelector('select[aria-label=${js(weekdayName(today))}]').value`), pullId, 'the editor starts from the current plan');
    await pressButton('Stop planning');
    await page.waitFor(DIALOG, { what: 'the confirmation' });
    await pressInDialog('Stop planning');
    await page.waitFor(`location.hash === '#/calendar/plan' && document.querySelector('.card').textContent.includes('No plan yet')`, { what: 'no plan' });
    equal(await stored('planRules'), [], 'stored plan after stopping on the day it started');
    await goTo(`#/calendar/routines/${pullId}`, `document.getElementById('routine-name')?.value === 'Pull day'`, 'Pull day');
    await pressButton('Delete routine');
    await page.waitFor(DIALOG, { what: 'the delete confirmation' });
    await pressInDialog('Delete');
    await page.waitFor(`location.hash === '#/calendar/plan' && document.querySelectorAll('.list-row').length === 1`, { what: 'one routine left' });
    expect(typeof (await dbCall(`return db.get('routines', ${js(pullId)});`)).archivedAt === 'string', 'a routine that is referred to was not archived');

    // Past workouts keep the routine's name, and the calendar still shows them.
    await goTo('#/calendar/history', `document.querySelectorAll('.list-row').length === 2`, 'the history');
    expect((await page.eval(`document.querySelector('.list-row').textContent`)).includes('Push day'), 'the workout lost its routine name');
    await goTo('#/calendar', `document.querySelector('.panel-title')`, 'the month view');
    await waitMarks(today, '●');
    equal(await marks(in3), '', 'planned days after stopping the plan');
  });

  await check('Weekly plan as a rotation: routines take turns on the chosen days', async () => {
    await goTo('#/calendar/plan/edit', `document.querySelector('select[aria-label="Monday"]')`, 'the plan editor');
    await tapChip('Rotation');
    await page.waitFor(`document.querySelector('[aria-label="Training days"]')`, { what: 'the rotation editor' });
    equal(await page.eval(`[...document.querySelectorAll('[aria-label="Training days"] [aria-pressed=true]')].map((c) => c.textContent)`), ['Mon', 'Wed', 'Fri'], 'default training days');
    await pressButton('+ Add a step'); // Push day → Push day: a two-step rotation with the only routine
    equal(await page.eval(`document.querySelectorAll('select[aria-label^="Rotation step"]').length`), 2, 'rotation steps');
    await shot('plan-rotation');
    await pressButton('Save plan');
    await page.waitFor(`location.hash === '#/calendar/plan' && document.querySelector('.plain-list')`, { what: 'the saved plan' });
    equal(await page.eval(`[...document.querySelectorAll('.plain-list li')].map((n) => n.textContent)`), ['Training days: Mon, Wed, Fri', 'Rotation: Push day → Push day'], 'plan summary');
    const [rule] = await stored('planRules');
    equal([rule.type, rule.startDate, rule.endDate, rule.weekdays, rule.routineIds, rule.offset], ['rotation', today, null, [1, 3, 5], [pushId, pushId], 0], 'stored rotation');
    await goTo('#/calendar', `document.querySelector('.panel-title')`, 'the month view');
    for (let i = 0; i < 12; i++) await click('[aria-label="Next month"]');
    const far = addMonths(today, 12);
    const wd = (date) => ((new Date(`${date}T12:00:00`).getDay() + 6) % 7) + 1;
    equal(await page.eval(`document.querySelectorAll('.day:not(.outside) .mark.planned').length`),
      monthGrid(far).filter((d) => d.inMonth && [1, 3, 5].includes(wd(d.date))).length, 'planned days a year ahead');
    await pressButton('Today');
  });

  await check('Update: a new version shows the banner, and tapping it loads the new version', async () => {
    const next = '999.0.0';
    server.state.swVersion = next;
    await openSettings();
    await page.waitFor(`document.getElementById('update-banner')`, { what: 'the update banner', timeout: 15000 });
    equal(await text('#update-banner'), 'Update available — tap to reload', 'banner text');
    equal(await page.eval(VERSION), APP_VERSION, 'version before tapping the banner');
    await shot('update-banner');
    await click('#update-banner');
    await page.waitFor(`${VERSION} === ${js(next)}`, { what: `version ${next} after the reload`, timeout: 15000 });
    expect(!(await page.eval(`!!document.getElementById('update-banner')`)), 'the banner is still there after updating');
    equal(await page.eval(`caches.keys()`), [`shell-v${next}`], 'cache names after the update');
    equal(await page.eval(REMINDER), '21', 'data after the update');
  });

  await check('Offline: with the server stopped, the app reloads and every tab works', async () => {
    await server.stop();
    let reachable = true;
    try {
      await fetch(`http://localhost:${PORT}/`);
    } catch {
      reachable = false;
    }
    expect(!reachable, 'the server is still reachable');
    await page.reload();
    await page.waitFor(`document.querySelector('.card')`, { what: 'the app to load from the cache' });
    for (const tab of ['today', 'calendar', 'progress', 'exercises', 'settings']) {
      await page.eval(`location.hash = '#/${tab}'`);
      await page.waitFor(
        `document.querySelector('.tabbar [aria-current]')?.dataset.tab === ${js(tab)} && document.querySelector('main').children.length > 0`,
        { what: `the ${tab} tab offline` }
      );
    }
    await page.waitFor(`${REMINDER} === '21'`, { what: 'saved data offline' });
    await goTo('#/exercises', `document.querySelectorAll('.list-row').length === 60`, 'the exercise list offline');
    await goTo('#/exercises/Barbell_Squat', `document.querySelectorAll('.steps li').length > 0`, 'exercise instructions offline');
    await goTo('#/calendar/history', `document.querySelectorAll('.list-row').length >= 1`, 'the workout history offline');
    await goTo('#/calendar', `document.querySelectorAll('.month-grid .day').length === 42`, 'the month view offline');
    await goTo('#/calendar/plan', `document.querySelector('.card-title')?.textContent === 'Weekly plan'`, 'the plan offline');
    await goTo('#/today', `[...document.querySelectorAll('main .btn')].some((b) => b.textContent.startsWith('Start a'))`, 'Today offline');
    await page.eval(`[...document.querySelectorAll('main .btn')].find((b) => b.textContent.startsWith('Start a')).click()`);
    await page.waitFor(DIALOG, { what: 'the choice of routines offline' });
    await pressInDialog('Empty workout');
    await page.waitFor(`location.hash === '#/workout' && document.querySelector('.hint')`, { what: 'starting a workout offline' });
    await goTo('#/settings', `document.querySelector('main a.btn[href="#/settings/selfcheck"]')`, 'Settings offline');
    await click('main a.btn[href="#/settings/selfcheck"]');
    await page.waitFor(`/^All \\d+ checks passed\\.$/.test(document.querySelector('.check-summary')?.textContent ?? '')`, {
      what: 'the self-check to pass offline',
      timeout: 20000,
    });
  }, { allowErrors: true }); // the browser logs the failed update check while offline
}

try {
  await server.start();
  page = await launch();
  console.log(`Checking version ${APP_VERSION} at ${origin} (375 px wide)\n`);
  await run();
} catch (err) {
  failures += 1;
  console.log(`\nThe checks could not run: ${err.message || err}`);
} finally {
  if (page) await page.close();
  await server.stop();
}

console.log(`\n${failures ? `${failures} check(s) FAILED` : 'All checks passed'}`);
console.log(`Screenshots (light and dark) to look at: ${out}`);
process.exit(failures ? 1 : 0);
