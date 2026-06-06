#!/usr/bin/env -S node --experimental-strip-types
import { pathToFileURL } from 'node:url';
import { checkHostedBackupDrill } from './check-hosted-backup-drill.ts';
import { checkCoolifyBackupReadiness } from './check-coolify-backup-readiness.ts';
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
  providerReadiness: Awaited<ReturnType<typeof checkHostedProviderReadiness>>;
  providerConnections: Awaited<ReturnType<typeof checkHostedProviderConnections>>;
  backupReadiness: Awaited<ReturnType<typeof checkCoolifyBackupReadiness>>;
  backupDrill?: Awaited<ReturnType<typeof checkHostedBackupDrill>>;
}

export async function runHostedPostDeploy(): Promise<HostedPostDeployResult> {
  const monitor = await monitorHostedPlanner();
  const smoke = await runHostedPlannerSmoke();
  const opsStatus = await checkHostedOpsStatus();
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
  return {
    ok: true,
    monitor,
    smoke,
    opsStatus,
    providerReadiness,
    providerConnections,
    backupReadiness,
    ...(backupDrill ? { backupDrill } : {}),
  };
}

function postDeployProviderConnectionIds(): ProviderId[] {
  const explicit = String(process.env.OD_PROVIDER_CONNECTION_IDS || '').split(',').map((item) => item.trim()).filter(Boolean) as ProviderId[];
  if (explicit.length > 0) return explicit;
  return ['supermemory', 'composio', 'trigger-dev'];
}

async function main() {
  const result = await runHostedPostDeploy();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
