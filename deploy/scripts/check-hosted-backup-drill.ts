#!/usr/bin/env -S node --experimental-strip-types
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export interface HostedBackupDrillResult {
  ok: true;
  manifestPath: string;
  backupFile: string;
  offsiteTarget: string;
  restoreCheck: string;
  checkedAt: string;
}

interface HostedBackupDrillOptions {
  manifestPath?: string;
}

export async function checkHostedBackupDrill(
  options: HostedBackupDrillOptions = {},
): Promise<HostedBackupDrillResult> {
  const manifestPath = options.manifestPath || process.env.OD_BACKUP_DRILL_MANIFEST || '/root/open-design-backups/latest-restore-drill.json';
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const backupFile = stringField(manifest, 'backupFile');
  const offsiteTarget = stringField(manifest, 'offsiteTarget');
  const restoreCheck = stringField(manifest, 'restoreCheck');
  const checkedAt = stringField(manifest, 'checkedAt');
  if (restoreCheck !== 'sqlite-header-ok') {
    throw new Error(`Restore drill manifest ${manifestPath} expected restoreCheck=sqlite-header-ok, got ${restoreCheck}`);
  }
  if (!offsiteTarget.includes('://')) {
    throw new Error(`Restore drill manifest ${manifestPath} expected an offsite URI target, got ${offsiteTarget}`);
  }
  return {
    ok: true,
    manifestPath,
    backupFile,
    offsiteTarget,
    restoreCheck,
    checkedAt,
  };
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string' || !field.trim()) {
    throw new Error(`Backup drill manifest is missing ${key}.`);
  }
  return field;
}

async function main() {
  const result = await checkHostedBackupDrill();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
