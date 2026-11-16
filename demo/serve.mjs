// Serves the demo store at http://localhost:4000 (static, no dependencies).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'store');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

export function createDemoServer() {
  return http.createServer((req, res) => {
    // Resolve from the path only, so "?loggedout=1" and "#..." do not break the lookup.
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { pathname = ''; }
    const rel = pathname === '/' ? 'index.html' : path.normalize(pathname).replace(/^([/\\]|\.\.[/\\])+/, '');
    const file = path.join(dir, rel);
    if (!pathname || !file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4000);
  createDemoServer().listen(port, () => console.log(`Demo store: http://localhost:${port}`));
}
