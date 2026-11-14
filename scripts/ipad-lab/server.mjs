// Local test infrastructure only. No AFFiNE server code or production services.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(sourceDir, '../..');
// Reuse the exact Yjs already locked for BlockSuite, without resolving a new graph.
const workspaceRequire = createRequire(join(root, 'blocksuite/framework/store/package.json'));
const MAX_BODY = 8 * 1024 * 1024;
const validRoom = value => /^[a-zA-Z0-9-]{1,60}$/.test(value);
const atomicWrite = (path, value) => {
  writeFileSync(`${path}.tmp`, value, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
};
const encode = value => Buffer.from(value).toString('base64');
const decode = value => {
  if (typeof value !== 'string' || value.length > MAX_BODY || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('Invalid encoded update');
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
};
async function readJSON(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function createLabServer({ assetsDir, dataDir, token }) {
  const Y = await import(pathToFileURL(join(dirname(workspaceRequire.resolve('yjs')), 'yjs.mjs')).href);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const rooms = new Map();
  const clients = new Map();
  // Serve only files from the built app. Never expose the source tree or .git.
  const assets = new Map();
  function inventory(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) inventory(join(dir, entry.name), `${prefix}/${entry.name}`);
      else if (entry.isFile()) assets.set(`${prefix}/${entry.name}`, join(dir, entry.name));
    }
  }
  inventory(assetsDir);
  assets.set('/', join(assetsDir, 'index.html'));
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
  function roomFor(name) {
    if (!rooms.has(name)) {
      if (rooms.size >= 16) throw new Error('Test room limit reached');
      const doc = new Y.Doc();
      const path = join(dataDir, `${name}.yjs`);
      if (existsSync(path)) Y.applyUpdate(doc, readFileSync(path));
      rooms.set(name, doc);
    }
    return rooms.get(name);
  }
  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    try {
      const url = new URL(req.url, 'http://lab.invalid');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
        if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
        const path = assets.get(url.pathname);
        if (!path) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : readFileSync(path));
        return;
      }
      const supplied = Buffer.from(String(req.headers['x-lab-token'] ?? ''));
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        res.writeHead(401).end('Use the complete test link'); return;
      }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        res.writeHead(403).end('Origin not allowed'); return;
      }
      const name = url.searchParams.get('room') ?? 'ipad-baseline';
      if (!validRoom(name)) { res.writeHead(400).end('Invalid room'); return; }
      const reply = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (url.pathname === '/api/report' && req.method === 'GET') {
        reply({ room: name, clients: [...clients.values()].filter(client => client.summary.room === name) }); return;
      }
      if (url.pathname === '/api/telemetry' && req.method === 'POST') {
        const body = await readJSON(req);
        if (!/^[a-z0-9]{1,20}$/.test(body.client) || !Array.isArray(body.events) || body.events.length > 1500 || !body.summary || body.summary.room !== name) {
          throw new Error('Invalid telemetry');
        }
        if (!clients.has(body.client) && clients.size >= 32) clients.delete(clients.keys().next().value);
        const previous = clients.get(body.client);
        const entries = new Map((previous?.events ?? []).map(event => [event.seq, event]));
        for (const event of body.events) entries.set(event.seq, event);
        const report = { client: body.client, lastSeen: new Date().toISOString(), summary: body.summary, events: [...entries.values()].slice(-1500) };
        clients.set(body.client, report);
        atomicWrite(join(dataDir, `client-${body.client}.json`), JSON.stringify(report, null, 2));
        reply({ ok: true }); return;
      }
      const doc = roomFor(name);
      if (url.pathname === '/api/vector' && req.method === 'GET') {
        reply({ vector: encode(Y.encodeStateVector(doc)) }); return;
      }
      if (url.pathname === '/api/state' && req.method === 'GET') {
        reply({ initialized: doc.getMap('blocks').size > 0, update: encode(Y.encodeStateAsUpdate(doc)), vector: encode(Y.encodeStateVector(doc)) }); return;
      }
      if ((url.pathname === '/api/init' || url.pathname === '/api/sync') && req.method === 'POST') {
        const body = await readJSON(req);
        const vector = body.vector === undefined ? undefined : decode(body.vector);
        if (vector !== undefined) Y.decodeStateVector(vector);
        // Read/validate on a disposable document before accepting an update.
        // Initialization is chosen once, including simultaneous first joins.
        const shouldApply = url.pathname === '/api/sync' || doc.getMap('blocks').size === 0;
        if (shouldApply) {
          const update = decode(body.update);
          const candidate = new Y.Doc();
          try {
            Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
            let changed = false;
            candidate.on('update', () => { changed = true; });
            Y.applyUpdate(candidate, update);
            if (changed) {
              const state = Y.encodeStateAsUpdate(candidate);
              if (state.length > MAX_BODY) throw new Error('Test document size limit reached');
              atomicWrite(join(dataDir, `${name}.yjs`), state);
              Y.applyUpdate(doc, update);
            }
          } finally { candidate.destroy(); }
        }
        reply({ initialized: doc.getMap('blocks').size > 0, update: encode(Y.encodeStateAsUpdate(doc, vector)), vector: encode(Y.encodeStateVector(doc)) }); return;
      }
      res.writeHead(404).end('Not found');
    } catch (error) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end(error.message);
    }
  });
  server.on('close', () => { for (const doc of rooms.values()) doc.destroy(); });
  return server;
}

export async function buildLab(outDir) {
  // Vanilla Extract evaluates source during compilation. Keep its module graph
  // in a separate process so it cannot introduce a second Yjs into the relay.
  execFileSync(process.execPath, [join(sourceDir, 'build.mjs'), outDir], { stdio: 'inherit' });
}

async function main() {
  const port = Number(process.env.IPAD_LAB_PORT ?? 4173);
  const host = process.env.IPAD_LAB_HOST ?? '0.0.0.0';
  const dataDir = resolve(process.env.IPAD_LAB_DATA_DIR ?? join(tmpdir(), 'cw-ipad-lab'));
  const assetsDir = join(dataDir, 'app');
  const previousSession = join(dataDir, 'session.json');
  const token = process.argv.includes('--resume')
    ? new URL(JSON.parse(readFileSync(previousSession, 'utf8')).urls[0]).searchParams.get('token')
    : randomBytes(24).toString('hex');
  if (!token || !/^[a-f0-9]{48}$/.test(token)) throw new Error('No valid lab session to resume');
  if (!process.argv.includes('--no-build')) await buildLab(assetsDir);
  const server = await createLabServer({ assetsDir, dataDir, token });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const addresses = host === '127.0.0.1' ? [] : Object.values(networkInterfaces()).flat().filter(info => info?.family === 'IPv4' && !info.internal).map(info => info.address);
  const urls = [...new Set(['127.0.0.1', ...addresses])].map(address => `http://${address}:${server.address().port}/?room=ipad-baseline&token=${token}`);
  atomicWrite(join(dataDir, 'session.json'), JSON.stringify({ pid: process.pid, dataDir, urls }, null, 2));
  console.log(`\nCW iPad-test — låt denna process vara igång\n${urls.join('\n')}\n\nMac-monitor: byt /? till /monitor.html? i samma länk.\nTestdata och enhetsloggar: ${dataDir}\n\nUSB-skärm och Web Inspector ansluts separat; ingen iPad är verifierad ännu.\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
