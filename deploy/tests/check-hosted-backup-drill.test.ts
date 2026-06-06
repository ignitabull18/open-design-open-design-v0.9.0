import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkHostedBackupDrill } from '../scripts/check-hosted-backup-drill.ts';

test('backup drill accepts an offsite restore manifest', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'od-backup-drill-'));
  const manifestPath = path.join(dir, 'latest-restore-drill.json');
  await writeFile(manifestPath, JSON.stringify({
    backupFile: '/root/open-design-backups/open-design-20260606T200642Z.tgz',
    offsiteTarget: 'r2://ignitabull-backups/open-design/open-design-20260606T200642Z.tgz',
    restoreCheck: 'sqlite-header-ok',
    checkedAt: '2026-06-06T20:06:42.000Z',
  }));

  const result = await checkHostedBackupDrill({ manifestPath });

  assert.equal(result.ok, true);
  assert.equal(result.offsiteTarget, 'r2://ignitabull-backups/open-design/open-design-20260606T200642Z.tgz');
});

test('backup drill rejects local-only manifests', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'od-backup-drill-'));
  const manifestPath = path.join(dir, 'latest-restore-drill.json');
  await writeFile(manifestPath, JSON.stringify({
    backupFile: '/root/open-design-backups/open-design-20260606T200642Z.tgz',
    offsiteTarget: '/root/open-design-backups/open-design-20260606T200642Z.tgz',
    restoreCheck: 'sqlite-header-ok',
    checkedAt: '2026-06-06T20:06:42.000Z',
  }));

  await assert.rejects(
    () => checkHostedBackupDrill({ manifestPath }),
    /expected an offsite URI target/,
  );
});
