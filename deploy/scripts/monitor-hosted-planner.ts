#!/usr/bin/env -S node --experimental-strip-types
import { pathToFileURL } from 'node:url';

type JsonObject = Record<string, any>;

export interface HostedPlannerMonitorResult {
  ok: true;
  baseUrl: string;
  version: unknown;
  bindHost: unknown;
  dataDir: unknown;
  protectedApiStatus: number;
  authenticatedApiStatus?: number;
  planningSessionAuthenticated?: boolean;
}

interface HostedPlannerMonitorOptions {
  baseUrl?: string;
  apiToken?: string;
}

export async function monitorHostedPlanner(options: HostedPlannerMonitorOptions = {}): Promise<HostedPlannerMonitorResult> {
  const baseUrl = (options.baseUrl || process.env.OD_HOSTED_BASE_URL || 'https://open-design.ignitabull.org').replace(/\/$/, '');
  const apiToken = (options.apiToken || process.env.OD_API_TOKEN || '').trim();

  function url(path: string): string {
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  const health = await getJson(url('/api/health'));
  if (health.status !== 200 || health.body.ok !== true) {
    throw new Error(`/api/health expected 200 ok=true, got ${health.status}: ${JSON.stringify(health.body)}`);
  }

  const status = await getJson(url('/api/daemon/status'));
  if (status.status !== 200 || status.body.ok !== true) {
    throw new Error(`/api/daemon/status expected 200 ok=true, got ${status.status}: ${JSON.stringify(status.body)}`);
  }
  if (status.body.bindHost !== '0.0.0.0') {
    throw new Error(`/api/daemon/status expected bindHost=0.0.0.0, got ${JSON.stringify(status.body.bindHost)}`);
  }
  if (status.body.dataDir !== '/app/.od') {
    throw new Error(`/api/daemon/status expected dataDir=/app/.od, got ${JSON.stringify(status.body.dataDir)}`);
  }

  const protectedApi = await fetch(url('/api/plans'));
  if (protectedApi.status !== 401) {
    throw new Error(`/api/plans without auth expected 401, got ${protectedApi.status}`);
  }

  let authenticatedApiStatus: number | undefined;
  let planningSessionAuthenticated: boolean | undefined;
  if (apiToken) {
    const authenticatedApi = await fetch(url('/api/plans'), {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    authenticatedApiStatus = authenticatedApi.status;
    if (authenticatedApi.status !== 200) {
      const body = await authenticatedApi.text().catch(() => '');
      throw new Error(`/api/plans with auth expected 200, got ${authenticatedApi.status}: ${body}`);
    }

    const session = await fetch(url('/api/planning/session'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: apiToken }),
    });
    const body = await session.json().catch(() => ({}));
    planningSessionAuthenticated = body.authenticated === true;
    if (!session.ok || planningSessionAuthenticated !== true || !session.headers.get('set-cookie')?.includes('od_planning_session=')) {
      throw new Error(`/api/planning/session expected authenticated cookie, got ${session.status}: ${JSON.stringify(body)}`);
    }
  }

  return {
    ok: true,
    baseUrl,
    version: health.body.version,
    bindHost: status.body.bindHost,
    dataDir: status.body.dataDir,
    protectedApiStatus: protectedApi.status,
    ...(authenticatedApiStatus !== undefined ? { authenticatedApiStatus } : {}),
    ...(planningSessionAuthenticated !== undefined ? { planningSessionAuthenticated } : {}),
  };
}

async function getJson(url: string): Promise<{ status: number; body: JsonObject }> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body: body as JsonObject };
}

async function main() {
  const result = await monitorHostedPlanner();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
