// Serves the exported web app the way GitHub Pages does: files below an
// optional sub-path (e.g. /taskflow-app), and for any other path the site's
// 404.html with status 404 (the deploy copies index.html to 404.html, so the
// single-page app still starts and routes itself). Without a 404.html, other
// paths get index.html, as most static hosts are configured to do.
// No special headers: the app must work on an ordinary static host.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 8099);
const base = (process.argv[4] ?? '').replace(/\/+$/, '');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.map': 'application/json', '.wasm': 'application/wasm',
};

http
  .createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = null;
    if (!base || pathname === base || pathname.startsWith(`${base}/`)) {
      pathname = pathname.slice(base.length) || '/';
      const candidate = path.join(root, pathname);
      if (candidate.startsWith(root) && fs.existsSync(candidate)) {
        file = fs.statSync(candidate).isDirectory() ? path.join(candidate, 'index.html') : candidate;
        if (!fs.existsSync(file)) file = null;
      }
    }
    let status = 200;
    if (!file) {
      const notFound = path.join(root, '404.html');
      if (fs.existsSync(notFound)) {
        file = notFound;
        status = 404;
      } else {
        file = path.join(root, 'index.html');
      }
    }
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}${base}/`));
