#!/usr/bin/env -S node --experimental-strip-types
import { pathToFileURL } from 'node:url';
import { checkCoolifyBackupReadiness } from './check-coolify-backup-readiness.ts';
import { checkHostedProviderReadiness } from './check-hosted-provider-readiness.ts';
import { monitorHostedPlanner } from './monitor-hosted-planner.ts';
import { runHostedPlannerSmoke } from './smoke-hosted-planner.ts';

export interface HostedPostDeployResult {
  ok: true;
  monitor: Awaited<ReturnType<typeof monitorHostedPlanner>>;
  smoke: Awaited<ReturnType<typeof runHostedPlannerSmoke>>;
  providerReadiness: Awaited<ReturnType<typeof checkHostedProviderReadiness>>;
  backupReadiness: Awaited<ReturnType<typeof checkCoolifyBackupReadiness>>;
}

export async function runHostedPostDeploy(): Promise<HostedPostDeployResult> {
  const monitor = await monitorHostedPlanner();
  const smoke = await runHostedPlannerSmoke();
  const providerReadiness = await checkHostedProviderReadiness();
  const backupReadiness = await checkCoolifyBackupReadiness();
  return {
    ok: true,
    monitor,
    smoke,
    providerReadiness,
    backupReadiness,
  };
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
