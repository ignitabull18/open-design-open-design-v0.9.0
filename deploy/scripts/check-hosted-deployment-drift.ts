#!/usr/bin/env -S node --experimental-strip-types
import { resolveCname } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';
import { checkCoolifyBackupReadiness } from './check-coolify-backup-readiness.ts';

type JsonObject = Record<string, any>;

export interface HostedDeploymentDriftCheck {
  id: string;
  expected: string;
  actual: string;
  status: 'ok' | 'drift';
}

export interface HostedDeploymentDriftResult {
  ok: boolean;
  baseUrl: string;
  checks: HostedDeploymentDriftCheck[];
}

interface HostedDeploymentDriftOptions {
  baseUrl?: string;
  expectedTunnelTarget?: string;
  expectedCoolifyAppUuid?: string;
  expectedBindHost?: string;
  expectedDataDir?: string;
  resolveCnameImpl?: typeof resolveCname;
  checkCoolifyBackupReadinessImpl?: typeof checkCoolifyBackupReadiness;
}

export async function checkHostedDeploymentDrift(
  options: HostedDeploymentDriftOptions = {},
): Promise<HostedDeploymentDriftResult> {
  const baseUrl = (options.baseUrl || process.env.OD_HOSTED_BASE_URL || 'https://open-design.ignitabull.org').replace(/\/$/, '');
  const host = new URL(baseUrl).hostname;
  const expectedTunnelTarget = (options.expectedTunnelTarget || process.env.OD_EXPECTED_TUNNEL_TARGET || '80432e44-51c1-45bc-b6d8-098c423606de.cfargotunnel.com').replace(/\.$/, '');
  const expectedCoolifyAppUuid = options.expectedCoolifyAppUuid || process.env.COOLIFY_APP_UUID || 'jrdtaush3izl7bz10f9gg9qo';
  const expectedBindHost = options.expectedBindHost || process.env.OD_EXPECTED_BIND_HOST || '0.0.0.0';
  const expectedDataDir = options.expectedDataDir || process.env.OD_EXPECTED_DATA_DIR || '/app/.od';
  const cnameResolver = options.resolveCnameImpl || resolveCname;
  const coolifyChecker = options.checkCoolifyBackupReadinessImpl || checkCoolifyBackupReadiness;

  const status = await getJson(`${baseUrl}/api/daemon/status`);
  const cname = await cnameResolver(host);
  const coolify = await coolifyChecker({ appUuid: expectedCoolifyAppUuid });
  const checks = [
    buildDriftCheck('cloudflare-cname', expectedTunnelTarget, String(cname[0] || '').replace(/\.$/, '')),
    buildDriftCheck('coolify-app-uuid', expectedCoolifyAppUuid, coolify.appUuid),
    buildDriftCheck('daemon-bind-host', expectedBindHost, String(status.body.bindHost || '')),
    buildDriftCheck('daemon-data-dir', expectedDataDir, String(status.body.dataDir || '')),
  ];
  return {
    ok: checks.every((check) => check.status === 'ok'),
    baseUrl,
    checks,
  };
}

function buildDriftCheck(id: string, expected: string, actual: string): HostedDeploymentDriftCheck {
  return {
    id,
    expected,
    actual,
    status: expected === actual ? 'ok' : 'drift',
  };
}

async function getJson(url: string): Promise<{ status: number; body: JsonObject }> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} failed with ${response.status}: ${JSON.stringify(body)}`);
  return { status: response.status, body: body as JsonObject };
}

async function main() {
  const result = await checkHostedDeploymentDrift();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
