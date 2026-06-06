import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { checkCoolifyBackupReadiness } from '../scripts/check-coolify-backup-readiness.ts';

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

async function startCoolifyMock(storages: unknown[]) {
  server = http.createServer((req, res) => {
    const pathName = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (req.headers.authorization !== 'Bearer test-coolify-token') {
      return json(res, 401, { message: 'unauthorized' });
    }
    if (pathName === '/api/v1/applications/app-uuid') {
      return json(res, 200, { uuid: 'app-uuid', name: 'open-design-planner-v09' });
    }
    if (pathName === '/api/v1/applications/app-uuid/storages') {
      return json(res, 200, storages);
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

test('backup readiness verifies the persistent /app/.od Coolify storage', async () => {
  const baseUrl = await startCoolifyMock([
    {
      uuid: 'storage-uuid',
      type: 'persistent',
      name: 'open-design-data-volume',
      mount_path: '/app/.od',
    },
  ]);

  const result = await checkCoolifyBackupReadiness({
    appUuid: 'app-uuid',
    coolifyBaseUrl: baseUrl,
    coolifyToken: 'test-coolify-token',
  });

  assert.equal(result.ok, true);
  assert.equal(result.appName, 'open-design-planner-v09');
  assert.equal(result.storageName, 'open-design-data-volume');
  assert.equal(result.mountPath, '/app/.od');
  assert.match(result.backupCommand, /open-design-data-volume:\/data:ro/);
  assert.match(result.restoreCommand, /open-design-data-volume:\/data/);
});

test('backup readiness can read Coolify connection from config', async () => {
  const baseUrl = await startCoolifyMock([
    {
      uuid: 'storage-uuid',
      type: 'persistent',
      name: 'open-design-data-volume',
      mount_path: '/app/.od',
    },
  ]);
  const dir = await mkdtemp(path.join(tmpdir(), 'od-coolify-config-'));
  const configPath = path.join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify({
    instances: [{ default: true, fqdn: baseUrl, token: 'test-coolify-token' }],
  }));

  const result = await checkCoolifyBackupReadiness({
    appUuid: 'app-uuid',
    configPath,
  });

  assert.equal(result.storageUuid, 'storage-uuid');
});

test('backup readiness rejects missing persistent data storage', async () => {
  const baseUrl = await startCoolifyMock([
    {
      uuid: 'wrong-storage',
      type: 'persistent',
      name: 'other-volume',
      mount_path: '/tmp',
    },
  ]);

  await assert.rejects(
    () => checkCoolifyBackupReadiness({
      appUuid: 'app-uuid',
      coolifyBaseUrl: baseUrl,
      coolifyToken: 'test-coolify-token',
    }),
    /No persistent Coolify storage mounted at \/app\/.od/,
  );
});
