// Bundles the extension into dist/. Load dist/ via chrome://extensions → Developer mode → Load unpacked.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const common = { bundle: true, minify: false, target: 'chrome110', logLevel: 'info', legalComments: 'none' };
await build({ ...common, entryPoints: [path.join(root, 'src/background/serviceWorker.js')], outfile: path.join(dist, 'background.js'), format: 'esm' });
await build({ ...common, entryPoints: [path.join(root, 'src/content/contentScript.js')], outfile: path.join(dist, 'content.js'), format: 'iife' });
await build({ ...common, entryPoints: [path.join(root, 'src/popup/popup.js')], outfile: path.join(dist, 'popup.js'), format: 'iife' });
fs.copyFileSync(path.join(root, 'src/popup/popup.html'), path.join(dist, 'popup.html'));
fs.copyFileSync(path.join(root, 'src/popup/popup.css'), path.join(dist, 'popup.css'));
fs.copyFileSync(path.join(root, 'manifest.json'), path.join(dist, 'manifest.json'));
fs.cpSync(path.join(root, 'icons'), path.join(dist, 'icons'), { recursive: true, filter: (s) => !s.endsWith('.svg') });
fs.cpSync(path.join(root, '_locales'), path.join(dist, '_locales'), { recursive: true });
console.log('Built extension to dist/');
