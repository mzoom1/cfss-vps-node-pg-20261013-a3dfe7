'use strict';

const http = require('node:http');
const { Pool } = require('pg');
const { label } = require('./version.json');

// The platform injects a private database URL with its own CA file. Requiring
// verify-full keeps this fixture from silently connecting without verified TLS.
const databaseUrl = new URL(process.env.DATABASE_URL);
if (databaseUrl.searchParams.get('sslmode') !== 'verify-full' ||
    !databaseUrl.searchParams.get('sslrootcert')) {
  throw new Error('A platform DATABASE_URL with verified TLS and its CA is required');
}
const pool = new Pool({ connectionString: databaseUrl.toString(), max: 2 });
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');

const page = `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${label}</title><body><h1>${label}</h1>
<p>Values are stored in this project's private PostgreSQL database.</p>
<form id="form"><label>Value <input id="value" maxlength="120" required></label>
<button>Add value</button></form><p id="status" role="status"></p><ul id="values"></ul>
<script>
async function load() {
  const response = await fetch('/values');
  if (!response.ok) throw new Error('Read failed');
  const rows = await response.json();
  document.querySelector('#values').replaceChildren(...rows.map(row => {
    const item = document.createElement('li'); item.textContent = row.value; return item;
  }));
}
document.querySelector('#form').onsubmit = async event => {
  event.preventDefault();
  try {
    const response = await fetch('/values', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({value:document.querySelector('#value').value})});
    if (!response.ok) throw new Error('Write failed');
    document.querySelector('#value').value = ''; await load();
    document.querySelector('#status').textContent = 'Saved';
  } catch (_) { document.querySelector('#status').textContent = 'Could not save'; }
};
load().catch(() => { document.querySelector('#status').textContent = 'Could not read values'; });
</script></body></html>`;

function reply(response, status, type, body) {
  response.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store'});
  response.end(body);
}

async function handle(request, response) {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (request.method === 'GET' && path === '/healthz') {
    await pool.query('SELECT 1');
    return reply(response, 200, 'text/plain; charset=utf-8', 'postgres-ok');
  }
  if (request.method === 'GET' && path === '/') {
    return reply(response, 200, 'text/html; charset=utf-8', page);
  }
  if (request.method === 'GET' && path === '/values') {
    const result = await pool.query('SELECT id, value FROM pilot_values ORDER BY id');
    return reply(response, 200, 'application/json', JSON.stringify(result.rows));
  }
  if (request.method === 'POST' && path === '/values') {
    let body = '';
    for await (const chunk of request) {
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body) > 1024) {
        return reply(response, 413, 'text/plain', 'Value is too large');
      }
    }
    let parsed;
    try { parsed = JSON.parse(body); } catch (_) { return reply(response, 400, 'text/plain', 'Invalid JSON'); }
    if (typeof parsed?.value !== 'string' || !parsed.value.trim() || parsed.value.length > 120) {
      return reply(response, 400, 'text/plain', 'Value must contain 1 to 120 characters');
    }
    const result = await pool.query('INSERT INTO pilot_values(value) VALUES ($1) RETURNING id, value', [parsed.value]);
    return reply(response, 201, 'application/json', JSON.stringify(result.rows[0]));
  }
  reply(response, 404, 'text/plain', 'Not found');
}

let server;
async function start() {
  // Both source versions use this identical schema; updates preserve rows.
  await pool.query('CREATE TABLE IF NOT EXISTS pilot_values (id BIGSERIAL PRIMARY KEY, value TEXT NOT NULL)');
  server = http.createServer((request, response) => {
    handle(request, response).catch(() => reply(response, 503, 'text/plain', 'Database unavailable'));
  });
  server.listen(port, '0.0.0.0');
}
async function stop() {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
}
process.once('SIGTERM', () => { stop().then(() => process.exit(0), () => process.exit(1)); });
start().catch(() => { process.exitCode = 1; pool.end(); });
