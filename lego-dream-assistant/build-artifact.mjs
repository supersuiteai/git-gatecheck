// Builds the single-page version published as a Claude artifact:
// dist/lego-dream-assistant.html (markup + inlined CSS) and dist/app.js
// (the app, three.js included).
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['public/app.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/app.js',
});

const html = await readFile('public/index.html', 'utf8');
const css = await readFile('public/styles.css', 'utf8');
const body = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script type="module" src="app\.js"><\/script>/, '<script src="app.js" defer></script>');

await writeFile(
  'dist/lego-dream-assistant.html',
  `<title>Lego Dream Assistant</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}</style>
${body}`,
);
console.log('built dist/');
