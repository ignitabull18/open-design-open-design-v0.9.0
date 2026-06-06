import http from 'node:http';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { monitorHostedPlanner } from '../scripts/monitor-hosted-planner.ts';

const token = 'test-token';
let server: http.Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function startMonitorMock() {
  server = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/api/health') return json(res, 200, { ok: true, version: 'test-version' });
    if (path === '/api/daemon/status') {
      return json(res, 200, { ok: true, bindHost: '0.0.0.0', dataDir: '/app/.od' });
    }
    if (path === '/api/planning/session' && req.method === 'POST') {
      const body = await readBody(req);
      return body.token === token
        ? json(res, 200, { authenticated: true }, { 'set-cookie': 'od_planning_session=test; Path=/api; HttpOnly' })
        : json(res, 401, { authenticated: false });
    }
    if (path === '/api/plans') {
      return req.headers.authorization === `Bearer ${token}`
        ? json(res, 200, { plans: [] })
        : json(res, 401, { error: { code: 'API_TOKEN_REQUIRED' } });
    }
    return json(res, 404, { error: 'not found' });
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server!.once('listening', resolve);
    server!.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing mock server address');
  return `http://127.0.0.1:${address.port}`;
}

test('monitor verifies public probes, API auth, and planning session auth', async () => {
  const baseUrl = await startMonitorMock();

  const result = await monitorHostedPlanner({ baseUrl, apiToken: token });

  assert.deepEqual(result, {
    ok: true,
    baseUrl,
    version: 'test-version',
    bindHost: '0.0.0.0',
    dataDir: '/app/.od',
    protectedApiStatus: 401,
    authenticatedApiStatus: 200,
    planningSessionAuthenticated: true,
  });
});

test('monitor rejects a public API that is not token protected', async () => {
  server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/api/health') return json(res, 200, { ok: true, version: 'test-version' });
    if (path === '/api/daemon/status') return json(res, 200, { ok: true, bindHost: '0.0.0.0', dataDir: '/app/.od' });
    if (path === '/api/plans') return json(res, 200, { plans: [] });
    return json(res, 404, {});
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server!.once('listening', resolve);
    server!.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing mock server address');

  await assert.rejects(
    () => monitorHostedPlanner({ baseUrl: `http://127.0.0.1:${address.port}` }),
    /without auth expected 401/,
  );
});
