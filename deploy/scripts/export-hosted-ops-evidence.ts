#!/usr/bin/env -S node --experimental-strip-types
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkHostedOpsStatus } from './check-hosted-ops-status.ts';
import { checkHostedProviderConnections } from './check-hosted-provider-connections.ts';
import { checkHostedProviderReadiness } from './check-hosted-provider-readiness.ts';

export interface HostedOpsEvidenceExportResult {
  ok: true;
  outputPath: string;
  generatedAt: string;
}

interface HostedOpsEvidenceExportOptions {
  outputPath?: string;
}

export async function exportHostedOpsEvidence(
  options: HostedOpsEvidenceExportOptions = {},
): Promise<HostedOpsEvidenceExportResult> {
  const generatedAt = new Date().toISOString();
  const outputPath = options.outputPath
    || process.env.OD_OPS_EVIDENCE_OUTPUT
    || path.join('docs', 'deployment', 'evidence', `${generatedAt.slice(0, 10)}-hosted-post-deploy.md`);

  const [ops, providerReadiness, providerConnections] = await Promise.all([
    checkHostedOpsStatus(),
    checkHostedProviderReadiness(),
    checkHostedProviderConnections(),
  ]);

  const body = [
    `# Hosted Post-Deploy Evidence - ${generatedAt.slice(0, 10)}`,
    '',
    `Generated at: \`${generatedAt}\``,
    '',
    'Ops status:',
    '',
    `- Source: \`${ops.source}\``,
    `- Checks: ${ops.checkIds.map((id) => `\`${id}\``).join(', ')}`,
    `- Rate limit enabled: \`${String(ops.rateLimitEnabled)}\``,
    ...(ops.backupOffsiteTarget ? [`- Backup offsite target: \`${ops.backupOffsiteTarget}\``] : []),
    ...(ops.cli ? [
      `- CLI source: \`${ops.cli.source}\``,
      `- CLI checks: ${ops.cli.checkIds.map((id) => `\`${id}\``).join(', ')}`,
    ] : []),
    '',
    'Provider readiness:',
    '',
    `- Plan: \`${providerReadiness.planId}\``,
    `- Checked: ${providerReadiness.checkedToolIds.map((id) => `\`${id}\``).join(', ')}`,
    `- Connected: ${providerReadiness.connectedToolIds.map((id) => `\`${id}\``).join(', ') || 'none'}`,
    `- Deferred: ${providerReadiness.deferredToolIds.map((id) => `\`${id}\``).join(', ') || 'none'}`,
    '',
    'Provider connection probes:',
    '',
    ...providerConnections.probes.map((probe) => `- \`${probe.provider}\`: \`${probe.status}\` - ${probe.summary}`),
    '',
  ].join('\n');

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body, 'utf8');
  return { ok: true, outputPath, generatedAt };
}

async function main() {
  const result = await exportHostedOpsEvidence();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
