import { readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

const SETTINGS_FILE = new URL('./settings.json', import.meta.url);
const PUBLIC_SETTINGS_FILE = new URL('./public/settings.json', import.meta.url);
const PRESETS_FILE = new URL('./public/presets.json', import.meta.url);

function settingsPlugin() {
  return {
    name: 'd-pressed-settings',
    configureServer(server) {
      server.middlewares.use('/__dpressed/settings', async (request, response, next) => {
        if (request.method === 'GET') {
          next();
          return;
        }

        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end();
          return;
        }

        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', async () => {
          try {
            const incoming = JSON.parse(body);
            let current = {};
            try { current = JSON.parse(await readFile(SETTINGS_FILE, 'utf8')); } catch { /* start with an empty settings object */ }
            const settings = { ...current, ...incoming };
            const serialized = `${JSON.stringify(settings, null, 2)}\n`;
            await Promise.all([
              writeFile(SETTINGS_FILE, serialized, 'utf8'),
              writeFile(PUBLIC_SETTINGS_FILE, serialized, 'utf8'),
            ]);
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ ok: true }));
          } catch {
            response.statusCode = 400;
            response.end(JSON.stringify({ ok: false }));
          }
        });
      });
      server.middlewares.use('/__dpressed/presets', async (request, response, next) => {
        if (request.method === 'GET') {
          try {
            const presets = await readFile(PRESETS_FILE, 'utf8');
            response.setHeader('Content-Type', 'application/json');
            response.end(presets);
          } catch {
            response.statusCode = 500;
            response.end(JSON.stringify({}));
          }
          return;
        }
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end();
          return;
        }
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', async () => {
          try {
            const presets = JSON.parse(body);
            await writeFile(PRESETS_FILE, `${JSON.stringify(presets, null, 2)}\n`, 'utf8');
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ ok: true }));
          } catch {
            response.statusCode = 400;
            response.end(JSON.stringify({ ok: false }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [settingsPlugin()],
});
