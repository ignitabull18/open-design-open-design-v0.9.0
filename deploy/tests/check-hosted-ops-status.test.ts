import http from 'node:http';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { checkHostedOpsStatus } from '../scripts/check-hosted-ops-status.ts';

const token = 'test-token';
let server: http.Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function startOpsMock(checkStatus = 'ok') {
  server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/api/ops/status') {
      if (req.headers.authorization !== `Bearer ${token}`) {
        return json(res, 401, { error: { code: 'API_TOKEN_REQUIRED' } });
      }
      return json(res, 200, {
        ok: true,
        source: 'runtime-file',
        checks: [
          { id: 'monitor', status: 'ok' },
          { id: 'backup', status: checkStatus },
          { id: 'api-rate-limit', status: 'ok' },
        ],
        backup: {
          offsiteTarget: 'r2://backups-postgres-box1/open-design/prod/backups/open-design-20260606T213018Z.tgz',
        },
        rateLimit: {
          enabled: true,
          windowMs: 60000,
          maxRequests: 240,
        },
      });
    }
    return json(res, 404, {});
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

test('ops status check verifies API and CLI parity', async () => {
  const baseUrl = await startOpsMock();
  const result = await checkHostedOpsStatus({
    baseUrl,
    apiToken: token,
    cliPath: '/tmp/fake-od-cli.js',
    execFileImpl: async () => ({
      stdout: JSON.stringify({
        ok: true,
        source: 'runtime-file',
        checks: [
          { id: 'monitor', status: 'ok' },
          { id: 'backup', status: 'ok' },
          { id: 'api-rate-limit', status: 'ok' },
        ],
        backup: { offsiteTarget: 'r2://bucket/key' },
        rateLimit: { enabled: true },
      }),
      stderr: '',
    }) as any,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'runtime-file');
  assert.deepEqual(result.checkIds, ['monitor', 'backup', 'api-rate-limit']);
  assert.deepEqual(result.cli, {
    ok: true,
    source: 'runtime-file',
    checkIds: ['monitor', 'backup', 'api-rate-limit'],
  });
});

test('ops status check rejects non-ok ops checks', async () => {
  const baseUrl = await startOpsMock('unknown');
  await assert.rejects(
    () => checkHostedOpsStatus({
      baseUrl,
      apiToken: token,
      includeCli: false,
      execFileImpl: async () => ({ stdout: '{}', stderr: '' }) as any,
    }),
    /non-ok/,
  );
});
