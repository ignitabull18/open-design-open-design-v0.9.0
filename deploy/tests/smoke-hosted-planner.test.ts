import http from 'node:http';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { runHostedPlannerSmoke } from '../scripts/smoke-hosted-planner.ts';

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

async function startMockPlanner() {
  const plan = {
    id: 'plan-smoke',
    sectionAnswers: {},
    executionRuns: [] as Array<Record<string, unknown>>,
  };
  const run = {
    id: 'plan-run-smoke',
    status: 'completed',
    kind: 'section-agent',
    sectionId: 'planning',
  };
  const event = {
    id: 'plan-event-smoke',
    planId: plan.id,
    runId: run.id,
    type: 'run_completed',
    message: 'Smoke run completed.',
    createdAt: 1,
    sequence: 1,
  };

  server = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/api/health') return json(res, 200, { ok: true, version: 'test-version' });
    if (path === '/api/planning/session' && req.method === 'POST') {
      const body = await readBody(req);
      return body.token === token
        ? json(res, 200, { authenticated: true }, { 'set-cookie': 'od_planning_session=test; Path=/api; HttpOnly' })
        : json(res, 401, { error: { code: 'API_TOKEN_REQUIRED' } });
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      return json(res, 401, { error: { code: 'API_TOKEN_REQUIRED' } });
    }
    if (path === '/api/plans' && req.method === 'POST') return json(res, 201, { plan });
    if (path === `/api/plans/${plan.id}/sections/planning` && req.method === 'PATCH') {
      const body = await readBody(req);
      plan.sectionAnswers = { planning: { sectionId: 'planning', answers: body.answers ?? [] } };
      return json(res, 200, { plan, workflow: {} });
    }
    if (path === `/api/plans/${plan.id}` && req.method === 'PATCH') return json(res, 200, { plan });
    if (path === `/api/plans/${plan.id}/archive` && req.method === 'POST') return json(res, 200, { plan: { ...plan, metadata: { archivedAt: Date.now() } } });
    if (path === `/api/plans/${plan.id}/sections/planning/runs` && req.method === 'POST') {
      plan.executionRuns = [run];
      return json(res, 201, { plan, run, artifacts: [] });
    }
    if (path === `/api/plans/${plan.id}/sections/runs/${run.id}/events`) {
      if (req.headers.accept === 'text/event-stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        res.write('event: done\n');
        res.write(`data: ${JSON.stringify({ runId: run.id, status: 'completed' })}\n\n`);
        return res.end();
      }
      return json(res, 200, { plan, run, events: [event] });
    }
    if (path === `/api/plans/${plan.id}` && req.method === 'GET') return json(res, 200, { plan });
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

test('hosted planner smoke verifies auth, persistence, replay, and SSE', async () => {
  const baseUrl = await startMockPlanner();

  const result = await runHostedPlannerSmoke({ baseUrl, apiToken: token });

  assert.deepEqual(result, {
    ok: true,
    baseUrl,
    planId: 'plan-smoke',
    runId: 'plan-run-smoke',
    version: 'test-version',
    eventCount: 1,
    sseEventCount: 1,
    archived: true,
  });
});

test('hosted planner smoke requires a token before network writes', async () => {
  await assert.rejects(
    () => runHostedPlannerSmoke({ baseUrl: 'http://127.0.0.1:1', apiToken: '' }),
    /OD_API_TOKEN is required/,
  );
});
