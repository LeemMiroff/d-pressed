import { readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

const SETTINGS_FILE = new URL('./settings.json', import.meta.url);

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
            const settings = JSON.parse(body);
            await writeFile(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
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

export default defineConfig({ plugins: [settingsPlugin()] });
