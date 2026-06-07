import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkHostedDeploymentDrift } from '../scripts/check-hosted-deployment-drift.ts';
import { exportHostedRestoreEvidence } from '../scripts/export-hosted-restore-evidence.ts';
import { proveHostedAlertDelivery } from '../scripts/prove-hosted-alert-delivery.ts';
import { runHostedReleaseChecklist } from '../scripts/run-hosted-release-checklist.ts';

test('restore evidence export writes the accepted offsite manifest proof', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'od-restore-evidence-'));
  try {
    const manifestPath = path.join(dir, 'latest-restore-drill.json');
    const outputPath = path.join(dir, 'restore.md');
    await writeFile(manifestPath, JSON.stringify({
      backupFile: 'open-design-20260606.tgz',
      offsiteTarget: 'r2://backups-postgres-box1/open-design/prod/backups/open-design-20260606.tgz',
      restoreCheck: 'sqlite-header-ok',
      checkedAt: '2026-06-06T04:18:00Z',
    }), 'utf8');

    const result = await exportHostedRestoreEvidence({ manifestPath, outputPath });

    assert.equal(result.ok, true);
    assert.equal(result.outputPath, outputPath);
    const markdown = await readFile(outputPath, 'utf8');
    assert.match(markdown, /sqlite-header-ok/);
    assert.match(markdown, /r2:\/\/backups-postgres-box1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('alert delivery proof posts a success payload and writes evidence', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'od-alert-evidence-'));
  const received: unknown[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  try {
    const address = server.address();
    assert(address && typeof address !== 'string');
    const outputPath = path.join(dir, 'alert.md');
    const result = await proveHostedAlertDelivery({
      alertWebhookUrl: `http://127.0.0.1:${address.port}/alert`,
      baseUrl: 'https://open-design.ignitabull.org',
      outputPath,
    });

    assert.equal(result.webhookStatus, 204);
    assert.equal(received.length, 1);
    assert.equal((received[0] as { ok: boolean }).ok, true);
    const markdown = await readFile(outputPath, 'utf8');
    assert.match(markdown, /Webhook status: `204`/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('deployment drift check compares Cloudflare, Coolify, and daemon runtime values', async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, bindHost: '0.0.0.0', dataDir: '/app/.od' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  try {
    const address = server.address();
    assert(address && typeof address !== 'string');
    const result = await checkHostedDeploymentDrift({
      baseUrl: `http://127.0.0.1:${address.port}`,
      expectedTunnelTarget: 'expected-tunnel.cfargotunnel.com',
      expectedCoolifyAppUuid: 'app-1',
      resolveCnameImpl: async () => ['expected-tunnel.cfargotunnel.com'],
      checkCoolifyBackupReadinessImpl: async () => ({
        ok: true,
        appUuid: 'app-1',
        appName: 'Open Design',
        storageUuid: 'storage-1',
        storageName: 'volume-1',
        mountPath: '/app/.od',
        backupCommand: 'backup',
        restoreCommand: 'restore',
      }),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.checks.map((check) => check.status), ['ok', 'ok', 'ok', 'ok']);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('release checklist can emit a skipped operator report without live dependencies', async () => {
  const result = await runHostedReleaseChecklist({
    skipLocalChecks: true,
    skipLiveChecks: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.steps.map((step) => step.status), ['skipped', 'skipped']);
});
