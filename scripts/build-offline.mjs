import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL('../dist/', import.meta.url);
const index = await readFile(new URL('index.html', directory), 'utf8');
const script = index.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/);
const stylesheet = index.match(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);

if (!script || !stylesheet) throw new Error('Expected a JavaScript bundle and stylesheet in dist/index.html');

const [javascript, css] = await Promise.all([
  readFile(new URL(script[1], directory), 'utf8'),
  readFile(new URL(stylesheet[1], directory), 'utf8'),
]);

const offline = index
  .replace(script[0], () => `<script type="module">${javascript.replace(/<\/script/gi, '<\\/script')}</script>`)
  .replace(stylesheet[0], () => `<style>${css}</style>`);

await writeFile(new URL('offline.html', directory), offline);
