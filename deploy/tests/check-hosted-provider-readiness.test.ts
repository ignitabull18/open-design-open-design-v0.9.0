import http from 'node:http';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { checkHostedProviderReadiness } from '../scripts/check-hosted-provider-readiness.ts';

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

async function startProviderMock(plan: Record<string, unknown>) {
  server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (req.headers.authorization !== `Bearer ${token}`) {
      return json(res, 401, { error: { code: 'API_TOKEN_REQUIRED' } });
    }
    if (path === '/api/plans') {
      return json(res, 200, { plans: [{ id: plan.id, updatedAt: 2 }] });
    }
    if (path === `/api/plans/${plan.id}`) {
      return json(res, 200, { plan });
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

test('provider readiness accepts connected and explicitly deferred tools', async () => {
  const baseUrl = await startProviderMock({
    id: 'plan-ready',
    selectedTools: [
      { toolId: 'github', status: 'connected' },
      { toolId: 'cloudflare-hosting', status: 'deferred', notes: 'Already verified by external route smoke.' },
    ],
    toolChecks: [
      { toolId: 'github', status: 'connected', summary: 'GitHub connected.', checkedAt: 123 },
    ],
  });

  const result = await checkHostedProviderReadiness({
    baseUrl,
    apiToken: token,
    requiredToolIds: ['github', 'cloudflare-hosting'],
  });

  assert.deepEqual(result, {
    ok: true,
    baseUrl,
    planId: 'plan-ready',
    checkedToolIds: ['github', 'cloudflare-hosting'],
    connectedToolIds: ['github'],
    deferredToolIds: ['cloudflare-hosting'],
    evidence: [
      { toolId: 'github', status: 'connected', source: 'tool-check', checkedAt: 123, summary: 'GitHub connected.' },
      { toolId: 'cloudflare-hosting', status: 'deferred', source: 'selected-tool', summary: 'Already verified by external route smoke.' },
    ],
  });
});

test('provider readiness rejects missing or unannotated provider state', async () => {
  const baseUrl = await startProviderMock({
    id: 'plan-not-ready',
    selectedTools: [
      { toolId: 'github', status: 'wanted' },
      { toolId: 'supermemory', status: 'deferred' },
    ],
    toolChecks: [],
  });

  await assert.rejects(
    () => checkHostedProviderReadiness({
      baseUrl,
      apiToken: token,
      requiredToolIds: ['github', 'supermemory', 'composio'],
    }),
    /github: expected connected or deferred with notes.*supermemory.*composio/s,
  );
});

test('provider readiness requires token before network access', async () => {
  await assert.rejects(
    () => checkHostedProviderReadiness({ baseUrl: 'http://127.0.0.1:1', apiToken: '', requiredToolIds: ['github'] }),
    /OD_API_TOKEN is required/,
  );
});
