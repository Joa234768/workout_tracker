// A minimal driver for a headless Edge or Chrome, using the Chrome DevTools
// Protocol over Node's built-in WebSocket. No dependencies.
//
// Used by tools/browser/check.mjs. The page is emulated as a 375 px wide phone.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSER_PATHS = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  const found = BROWSER_PATHS.find((path) => existsSync(path));
  if (!found) throw new Error('No Edge or Chrome found. Set BROWSER_PATH to the browser executable.');
  return found;
}

/**
 * Starts a headless browser with a fresh, throwaway profile and returns a
 * `page` object. Always call page.close() when done.
 */
export async function launch({ debugPort = 9333, width = 375, height = 740 } = {}) {
  const profileDir = mkdtempSync(join(tmpdir(), 'workout-check-profile-'));
  const proc = spawn(
    findBrowser(),
    [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--hide-scrollbars',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let target = null;
  for (let attempt = 0; attempt < 75 && !target; attempt++) {
    await sleep(200);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      target = targets.find((t) => t.type === 'page');
    } catch {
      /* not up yet */
    }
  }
  if (!target) {
    proc.kill();
    throw new Error('The browser did not start.');
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('Could not connect to the browser.'));
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  /** Console errors, warnings and uncaught exceptions seen on the page. Clear with errors.length = 0. */
  const errors = [];

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) if (listener.method === message.method) listener.callback(message.params);
    }
  };

  /** Sends a raw protocol command, e.g. send('DOM.getDocument'). */
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`The browser did not answer ${method} within 15 s`));
      }, 15000);
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  const on = (method, callback) => listeners.push({ method, callback });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  on('Runtime.exceptionThrown', (p) =>
    errors.push(`exception: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`)
  );
  on('Runtime.consoleAPICalled', (p) => {
    if (p.type !== 'error' && p.type !== 'warning') return;
    errors.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description).join(' ')}`);
  });
  on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error') errors.push(`log: ${p.entry.text} ${p.entry.url || ''}`);
  });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });

  async function navigate(command, params) {
    const loaded = new Promise((resolve) => on('Page.loadEventFired', resolve));
    await send(command, params);
    await Promise.race([loaded, sleep(10000)]);
  }

  const page = {
    send,
    errors,
    sleep,

    goto: (url) => navigate('Page.navigate', { url }),
    reload: () => navigate('Page.reload', {}),

    /** Evaluates a JavaScript expression in the page (promises are awaited) and returns its value. */
    async eval(expression) {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result.value;
    },

    /** Polls until the expression is truthy and returns its value. Throws after `timeout` ms. */
    async waitFor(expression, { timeout = 8000, what = expression } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        let value;
        try {
          value = await page.eval(expression);
        } catch {
          value = undefined; // e.g. the page is in the middle of reloading
        }
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what}`);
        await sleep(100);
      }
    },

    /** Emulates the system dark or light setting. */
    dark: (enabled) =>
      send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: enabled ? 'dark' : 'light' }],
      }),

    /** Puts local files into an <input type="file">, as if the user picked them. */
    async pickFiles(selector, files) {
      const { root } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`No element matches ${selector}`);
      await send('DOM.setFileInputFiles', { nodeId, files });
    },

    /** Saves a PNG screenshot of the viewport. */
    async screenshot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(data, 'base64'));
    },

    async close() {
      try {
        await send('Browser.close');
      } catch {
        /* already gone */
      }
      await sleep(500);
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      try {
        rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        /* the OS cleans its temp folder eventually */
      }
    },
  };
  return page;
}
