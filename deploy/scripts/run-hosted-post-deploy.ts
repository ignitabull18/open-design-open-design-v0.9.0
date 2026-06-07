#!/usr/bin/env -S node --experimental-strip-types
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkHostedBackupDrill } from './check-hosted-backup-drill.ts';
import { checkCoolifyBackupReadiness } from './check-coolify-backup-readiness.ts';
import { checkHostedDeploymentDrift } from './check-hosted-deployment-drift.ts';
import { checkHostedOpsStatus } from './check-hosted-ops-status.ts';
import { checkHostedProviderConnections, type ProviderId } from './check-hosted-provider-connections.ts';
import { checkHostedProviderReadiness } from './check-hosted-provider-readiness.ts';
import { monitorHostedPlanner } from './monitor-hosted-planner.ts';
import { runHostedPlannerSmoke } from './smoke-hosted-planner.ts';

export interface HostedPostDeployResult {
  ok: true;
  monitor: Awaited<ReturnType<typeof monitorHostedPlanner>>;
  smoke: Awaited<ReturnType<typeof runHostedPlannerSmoke>>;
  opsStatus: Awaited<ReturnType<typeof checkHostedOpsStatus>>;
  deploymentDrift: Awaited<ReturnType<typeof checkHostedDeploymentDrift>>;
  providerReadiness: Awaited<ReturnType<typeof checkHostedProviderReadiness>>;
  providerConnections: Awaited<ReturnType<typeof checkHostedProviderConnections>>;
  backupReadiness: Awaited<ReturnType<typeof checkCoolifyBackupReadiness>>;
  backupDrill?: Awaited<ReturnType<typeof checkHostedBackupDrill>>;
}

export async function runHostedPostDeploy(): Promise<HostedPostDeployResult> {
  const monitor = await monitorHostedPlanner();
  const smoke = await runHostedPlannerSmoke();
  const opsStatus = await checkHostedOpsStatus();
  const deploymentDrift = await checkHostedDeploymentDrift();
  const providerReadiness = await checkHostedProviderReadiness();
  const providerConnections = await checkHostedProviderConnections({
    providers: postDeployProviderConnectionIds(),
  });
  if (providerConnections.deferredProviders.length > 0) {
    throw new Error(`Post-deploy provider connection gate failed: ${providerConnections.deferredProviders.join(', ')}`);
  }
  const backupReadiness = await checkCoolifyBackupReadiness();
  const backupDrill = process.env.OD_BACKUP_DRILL_MANIFEST
    ? await checkHostedBackupDrill()
    : undefined;
  const result = {
    ok: true,
    monitor,
    smoke,
    opsStatus,
    deploymentDrift,
    providerReadiness,
    providerConnections,
    backupReadiness,
    ...(backupDrill ? { backupDrill } : {}),
  } satisfies HostedPostDeployResult;
  await writeOpsStatusFileIfRequested(result);
  return result;
}

function postDeployProviderConnectionIds(): ProviderId[] {
  const explicit = String(process.env.OD_PROVIDER_CONNECTION_IDS || '').split(',').map((item) => item.trim()).filter(Boolean) as ProviderId[];
  if (explicit.length > 0) return explicit;
  return ['supermemory', 'composio', 'trigger-dev'];
}

async function writeOpsStatusFileIfRequested(result: HostedPostDeployResult): Promise<void> {
  const outputPath = process.env.OD_OPS_STATUS_OUTPUT;
  if (!outputPath) return;
  const generatedAt = new Date().toISOString();
  const checks = [
    { id: 'monitor', label: 'Hosted monitor', status: 'ok', summary: `Monitor passed for ${result.monitor.baseUrl}.`, checkedAt: generatedAt },
    { id: 'smoke', label: 'Hosted smoke', status: 'ok', summary: `Plan ${result.smoke.planId} run ${result.smoke.runId} completed and archived.`, checkedAt: generatedAt },
    ...result.deploymentDrift.checks.map((check) => ({
      id: check.id,
      label: check.id,
      status: check.status === 'ok' ? 'ok' : 'error',
      summary: `expected ${check.expected}, actual ${check.actual}`,
      checkedAt: generatedAt,
    })),
    { id: 'backup', label: 'Backup storage', status: 'ok', summary: `${result.backupReadiness.storageName} mounted at ${result.backupReadiness.mountPath}.`, checkedAt: generatedAt },
    { id: 'api-rate-limit', label: 'API rate limit', status: 'ok', summary: 'Authenticated hosted ops status reported rate limiting enabled.', checkedAt: generatedAt },
  ];
  const payload = {
    service: 'open-design-hosted-planner',
    checks,
    categories: [
      { id: 'deployment', label: 'Deployment', status: result.deploymentDrift.ok ? 'ok' : 'error', summary: `${result.deploymentDrift.checks.length} drift checks recorded.`, checks: checks.filter((check) => check.id !== 'backup' && check.id !== 'api-rate-limit') },
      { id: 'backup', label: 'Backup', status: 'ok', summary: 'Coolify persistent storage is ready for backup and restore.', checks: checks.filter((check) => check.id === 'backup') },
    ],
    backup: {
      backupFile: result.backupDrill?.backupFile,
      offsiteTarget: result.backupDrill?.offsiteTarget,
      restoreCheck: result.backupDrill?.restoreCheck,
      checkedAt: result.backupDrill?.checkedAt,
    },
    monitor: {
      checkedAt: generatedAt,
      alertTarget: process.env.OD_ALERT_WEBHOOK_URL ? 'configured' : 'not-configured',
    },
    deployment: {
      baseUrl: result.deploymentDrift.baseUrl,
      tunnelTarget: result.deploymentDrift.checks.find((check) => check.id === 'cloudflare-cname')?.actual,
      expectedTunnelTarget: result.deploymentDrift.checks.find((check) => check.id === 'cloudflare-cname')?.expected,
      coolifyAppUuid: result.backupReadiness.appUuid,
      deploymentUuid: process.env.COOLIFY_DEPLOYMENT_UUID || process.env.OD_COOLIFY_DEPLOYMENT_UUID,
      commit: process.env.SOURCE_COMMIT || process.env.GIT_COMMIT || process.env.OD_DEPLOY_COMMIT,
      driftChecks: checks.filter((check) => check.id.includes('cloudflare') || check.id.includes('coolify') || check.id.includes('daemon')),
    },
    evidence: {
      bundlePath: process.env.OD_OPS_EVIDENCE_OUTPUT,
      generatedAt,
      artifacts: [],
    },
    release: {
      channel: process.env.OD_RELEASE_CHANNEL || 'hosted',
      version: process.env.npm_package_version,
      tag: process.env.OD_RELEASE_TAG,
      promotedAt: process.env.OD_RELEASE_PROMOTED_AT,
    },
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
}

async function main() {
  const result = await runHostedPostDeploy();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
