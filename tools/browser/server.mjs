// A tiny static file server for the browser checks. No dependencies.
//
// Unlike `py -m http.server`, it can be stopped and restarted by the checks
// (to test offline use) and can serve sw.js with a different APP_VERSION
// (to test the update banner) without touching any file in the repo.

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

export function createStaticServer({ root, port }) {
  let server = null;
  const state = {
    /** When set, sw.js is served with this APP_VERSION instead of the real one. */
    swVersion: null,
  };

  async function handle(request, response) {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname);
      let file = normalize(join(root, pathname));
      if (file !== root && !file.startsWith(root + sep)) {
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
        server.listen(port, () => resolve());
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
