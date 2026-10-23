#!/usr/bin/env node
// Serves dist/ locally: npm run build && npm run serve
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from '../src/lib/config.js';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = Number(process.env.PORT) || 4173;

createServer(async (req, res) => {
  let file = path.join(PATHS.dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(PATHS.dist)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}/`));
