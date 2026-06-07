import type http from 'node:http';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

describe('ops status route', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = await startServer({ port: 0, returnServer: true }) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('normalizes hosted ops dashboard sections from the runtime status file', async () => {
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    await writeFile(path.join(dataDir, 'ops-status.json'), JSON.stringify({
      service: 'open-design-hosted-planner',
      checks: [
        { id: 'monitor', label: 'Monitor', status: 'ok', summary: 'monitor green', checkedAt: '2026-06-06T01:00:00Z' },
        { id: 'backup', label: 'Backup', status: 'warn', summary: 'restore drill due' },
      ],
      categories: [
        {
          id: 'availability',
          label: 'Availability',
          status: 'ok',
          summary: 'Health and smoke probes are green.',
          checks: [{ id: 'health', label: 'Health', status: 'ok', summary: '/api/health 200' }],
        },
      ],
      evidence: {
        bundlePath: 'docs/deployment/evidence/2026-06-06-hosted-post-deploy.md',
        generatedAt: '2026-06-06T02:00:00Z',
        artifacts: [
          {
            id: 'alert-delivery',
            label: 'Alert delivery',
            status: 'ok',
            summary: 'Webhook accepted proof payload.',
            path: 'docs/deployment/evidence/2026-06-06-hosted-alert-delivery.md',
          },
        ],
      },
      deployment: {
        baseUrl: 'https://open-design.ignitabull.org',
        tunnelTarget: '80432e44-51c1-45bc-b6d8-098c423606de.cfargotunnel.com',
        expectedTunnelTarget: '80432e44-51c1-45bc-b6d8-098c423606de.cfargotunnel.com',
        coolifyAppUuid: 'jrdtaush3izl7bz10f9gg9qo',
        driftChecks: [{ id: 'cloudflare-cname', label: 'Cloudflare CNAME', status: 'ok', summary: 'target matches' }],
      },
      restore: {
        manifestPath: '/root/open-design-backups/latest-restore-drill.json',
        backupFile: 'open-design-20260606.tgz',
        offsiteTarget: 'r2://backups-postgres-box1/open-design/prod/backups/open-design-20260606.tgz',
        restoreCheck: 'sqlite-header-ok',
        checkedAt: '2026-06-06T03:00:00Z',
      },
      release: {
        channel: 'stable',
        version: '0.9.0',
        tag: 'v0.9.0',
        promotedAt: '2026-06-06T04:00:00Z',
        checklist: [{ id: 'release-checklist', label: 'Release checklist', status: 'ok', summary: 'all checks passed' }],
      },
    }), 'utf8');

    const response = await fetch(`${baseUrl}/api/ops/status`);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      ok: true,
      source: 'runtime-file',
      service: 'open-design-hosted-planner',
      checks: [
        { id: 'monitor', status: 'ok' },
        { id: 'backup', status: 'warn' },
      ],
      categories: [
        { id: 'availability', status: 'ok', checks: [{ id: 'health', status: 'ok' }] },
      ],
      evidence: {
        bundlePath: 'docs/deployment/evidence/2026-06-06-hosted-post-deploy.md',
        artifacts: [{ id: 'alert-delivery', status: 'ok' }],
      },
      deployment: {
        baseUrl: 'https://open-design.ignitabull.org',
        driftChecks: [{ id: 'cloudflare-cname', status: 'ok' }],
      },
      restore: {
        restoreCheck: 'sqlite-header-ok',
      },
      release: {
        tag: 'v0.9.0',
        checklist: [{ id: 'release-checklist', status: 'ok' }],
      },
    });
  });
});
