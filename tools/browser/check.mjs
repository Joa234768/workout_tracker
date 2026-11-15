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
    await fn();
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
const shot = (name) => page.screenshot(join(out, `${name}.png`));
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
const dialogClosed = () => page.waitFor(`!${DIALOG}`, { what: 'the dialog to close' });

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
