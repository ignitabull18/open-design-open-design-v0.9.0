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
  resolveCloudflareDnsTargetImpl?: typeof resolveCloudflareDnsTarget;
  checkCoolifyBackupReadinessImpl?: typeof checkCoolifyBackupReadiness;
  timeoutMs?: number;
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
  const cloudflareDnsResolver = options.resolveCloudflareDnsTargetImpl || resolveCloudflareDnsTarget;
  const coolifyChecker = options.checkCoolifyBackupReadinessImpl || checkCoolifyBackupReadiness;
  const timeoutMs = options.timeoutMs ?? Number(process.env.OD_DEPLOYMENT_DRIFT_TIMEOUT_MS || 30_000);

  const status = await getJson(`${baseUrl}/api/daemon/status`, timeoutMs);
  const dnsTarget = await resolveDnsTarget(host, cnameResolver, cloudflareDnsResolver);
  const coolify = await coolifyChecker({ appUuid: expectedCoolifyAppUuid });
  const checks = [
    buildDriftCheck('cloudflare-cname', expectedTunnelTarget, dnsTarget),
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

async function resolveDnsTarget(
  host: string,
  cnameResolver: typeof resolveCname,
  cloudflareDnsResolver: typeof resolveCloudflareDnsTarget,
): Promise<string> {
  try {
    const cname = await cnameResolver(host);
    return String(cname[0] || '').replace(/\.$/, '');
  } catch (error) {
    if (!isMissingCnameError(error)) throw error;
    return cloudflareDnsResolver(host);
  }
}

function isMissingCnameError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ENODATA';
}

async function resolveCloudflareDnsTarget(host: string): Promise<string> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID || process.env.CF_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
  if (!zoneId || !token) {
    throw new Error(`No public CNAME for ${host}; set CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN to inspect proxied Cloudflare DNS records.`);
  }
  const params = new URLSearchParams({ type: 'CNAME', name: host, per_page: '1' });
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/dns_records?${params}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json().catch(() => ({})) as JsonObject;
  if (!response.ok || body.success === false) {
    throw new Error(`Cloudflare DNS lookup failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  const record = Array.isArray(body.result) ? body.result[0] : undefined;
  const content = typeof record?.content === 'string' ? record.content : '';
  if (!content) {
    throw new Error(`Cloudflare DNS lookup found no CNAME record for ${host}.`);
  }
  return content.replace(/\.$/, '');
}

function buildDriftCheck(id: string, expected: string, actual: string): HostedDeploymentDriftCheck {
  return {
    id,
    expected,
    actual,
    status: expected === actual ? 'ok' : 'drift',
  };
}

async function getJson(url: string, timeoutMs: number): Promise<{ status: number; body: JsonObject }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
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
  main().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
