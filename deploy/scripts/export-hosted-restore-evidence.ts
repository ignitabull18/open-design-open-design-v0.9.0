#!/usr/bin/env -S node --experimental-strip-types
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkHostedBackupDrill } from './check-hosted-backup-drill.ts';

export interface HostedRestoreEvidenceExportResult {
  ok: true;
  outputPath: string;
  generatedAt: string;
  manifestPath: string;
  backupFile: string;
  offsiteTarget: string;
}

interface HostedRestoreEvidenceExportOptions {
  outputPath?: string;
  manifestPath?: string;
}

export async function exportHostedRestoreEvidence(
  options: HostedRestoreEvidenceExportOptions = {},
): Promise<HostedRestoreEvidenceExportResult> {
  const generatedAt = new Date().toISOString();
  const result = await checkHostedBackupDrill({
    ...(options.manifestPath ? { manifestPath: options.manifestPath } : {}),
  });
  const outputPath = options.outputPath
    || process.env.OD_RESTORE_EVIDENCE_OUTPUT
    || path.join('docs', 'deployment', 'evidence', `${generatedAt.slice(0, 10)}-hosted-restore-drill.md`);
  const body = [
    `# Hosted Restore Drill Evidence - ${generatedAt.slice(0, 10)}`,
    '',
    `Generated at: \`${generatedAt}\``,
    `Manifest: \`${result.manifestPath}\``,
    '',
    `- Backup file: \`${result.backupFile}\``,
    `- Offsite target: \`${result.offsiteTarget}\``,
    `- Restore check: \`${result.restoreCheck}\``,
    `- Checked at: \`${result.checkedAt}\``,
    '',
  ].join('\n');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body, 'utf8');
  return {
    ok: true,
    outputPath,
    generatedAt,
    manifestPath: result.manifestPath,
    backupFile: result.backupFile,
    offsiteTarget: result.offsiteTarget,
  };
}

async function main() {
  const result = await exportHostedRestoreEvidence();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
