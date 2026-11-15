// A tiny static file server for the browser checks. No dependencies.
//
// Unlike `py -m http.server`, it can be stopped and restarted by the checks
// (to test offline use) and can serve sw.js with a different APP_VERSION
// (to test the update banner) without touching any file in the repo.
//
// Security: it listens on 127.0.0.1 only, so no other device on the network
// can reach it. It also only answers requests addressed to a local hostname,
// is read-only, never leaves the repo folder, and never serves hidden files
// or folders such as .git.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

const HOST = '127.0.0.1';
const LOCAL_HOSTNAMES = new Set(['localhost', 'app.localhost', '127.0.0.1']);

export function createStaticServer({ root, port }) {
  let server = null;
  const state = {
    /** When set, sw.js is served with this APP_VERSION instead of the real one. */
    swVersion: null,
  };

  async function handle(request, response) {
    try {
      // Only answer when the browser really asked for this local server. This
      // stops a web page elsewhere from reaching it under another hostname.
      const hostname = String(request.headers.host || '').replace(/:\d+$/, '').toLowerCase();
      if (!LOCAL_HOSTNAMES.has(hostname) || (request.method !== 'GET' && request.method !== 'HEAD')) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname);
      let file = normalize(join(root, pathname));
      const insideRoot = file === root || file.startsWith(root + sep);
      const hidden = pathname.split('/').some((part) => part.startsWith('.'));
      if (!insideRoot || hidden) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      if ((await stat(file)).isDirectory()) {
        if (!pathname.endsWith('/')) {
          response.writeHead(301, { Location: `${pathname}/` }).end();
          return;
        }
        file = join(file, 'index.html');
      }
      let body = await readFile(file);
      if (state.swVersion && pathname.endsWith('/sw.js')) {
        body = Buffer.from(
          body.toString('utf8').replace(/const APP_VERSION = '[^']+';/, `const APP_VERSION = '${state.swVersion}';`)
        );
      }
      response.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  }

  return {
    state,
    start() {
      return new Promise((resolve, reject) => {
        server = createServer(handle);
        server.once('error', reject);
        server.listen(port, HOST, () => resolve());
      });
    },
    stop() {
      return new Promise((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
        server = null;
      });
    },
  };
}
