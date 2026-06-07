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

export interface HostedPlannerAlertResult {
  ok: true;
  webhookStatus: number;
}

interface HostedPlannerMonitorOptions {
  baseUrl?: string;
  apiToken?: string;
  timeoutMs?: number;
}

interface HostedPlannerAlertOptions {
  alertWebhookUrl?: string;
  baseUrl?: string;
  message: string;
  ok: boolean;
  service?: string;
}

export async function monitorHostedPlanner(options: HostedPlannerMonitorOptions = {}): Promise<HostedPlannerMonitorResult> {
  const baseUrl = (options.baseUrl || process.env.OD_HOSTED_BASE_URL || 'https://open-design.ignitabull.org').replace(/\/$/, '');
  const apiToken = (options.apiToken || process.env.OD_API_TOKEN || '').trim();
  const timeoutMs = options.timeoutMs ?? Number(process.env.OD_HOSTED_MONITOR_TIMEOUT_MS || 30_000);

  function url(path: string): string {
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  const health = await getJson(url('/api/health'), timeoutMs);
  if (health.status !== 200 || health.body.ok !== true) {
    throw new Error(`/api/health expected 200 ok=true, got ${health.status}: ${JSON.stringify(health.body)}`);
  }

  const status = await getJson(url('/api/daemon/status'), timeoutMs);
  if (status.status !== 200 || status.body.ok !== true) {
    throw new Error(`/api/daemon/status expected 200 ok=true, got ${status.status}: ${JSON.stringify(status.body)}`);
  }
  if (status.body.bindHost !== '0.0.0.0') {
    throw new Error(`/api/daemon/status expected bindHost=0.0.0.0, got ${JSON.stringify(status.body.bindHost)}`);
  }
  if (status.body.dataDir !== '/app/.od') {
    throw new Error(`/api/daemon/status expected dataDir=/app/.od, got ${JSON.stringify(status.body.dataDir)}`);
  }

  const protectedApi = await fetchWithTimeout(url('/api/plans'), {}, timeoutMs);
  if (protectedApi.status !== 401) {
    throw new Error(`/api/plans without auth expected 401, got ${protectedApi.status}`);
  }

  let authenticatedApiStatus: number | undefined;
  let planningSessionAuthenticated: boolean | undefined;
  if (apiToken) {
    const authenticatedApi = await fetchWithTimeout(url('/api/plans'), {
      headers: { authorization: `Bearer ${apiToken}` },
    }, timeoutMs);
    authenticatedApiStatus = authenticatedApi.status;
    if (authenticatedApi.status !== 200) {
      const body = await authenticatedApi.text().catch(() => '');
      throw new Error(`/api/plans with auth expected 200, got ${authenticatedApi.status}: ${body}`);
    }

    const session = await fetchWithTimeout(url('/api/planning/session'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: apiToken }),
    }, timeoutMs);
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

export async function sendHostedPlannerAlert(options: HostedPlannerAlertOptions): Promise<HostedPlannerAlertResult | null> {
  const alertWebhookUrl = (options.alertWebhookUrl || process.env.OD_ALERT_WEBHOOK_URL || '').trim();
  if (!alertWebhookUrl) return null;

  const service = options.service || process.env.OD_ALERT_SERVICE || 'open-design-hosted-planner';
  const baseUrl = (options.baseUrl || process.env.OD_HOSTED_BASE_URL || 'https://open-design.ignitabull.org').replace(/\/$/, '');
  const payload = {
    service,
    ok: options.ok,
    baseUrl,
    message: options.message,
    checkedAt: new Date().toISOString(),
  };

  const response = await fetchWithTimeout(alertWebhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.OD_ALERT_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${process.env.OD_ALERT_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(payload),
  }, Number(process.env.OD_ALERT_TIMEOUT_MS || 15_000));
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Alert webhook failed with ${response.status}: ${body}`);
  }
  return { ok: true, webhookStatus: response.status };
}

async function getJson(url: string, timeoutMs: number): Promise<{ status: number; body: JsonObject }> {
  const response = await fetchWithTimeout(url, {}, timeoutMs);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body: body as JsonObject };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const baseUrl = (process.env.OD_HOSTED_BASE_URL || 'https://open-design.ignitabull.org').replace(/\/$/, '');
  try {
    const result = await monitorHostedPlanner();
    if (process.env.OD_ALERT_ON_SUCCESS === '1') {
      await sendHostedPlannerAlert({
        baseUrl,
        ok: true,
        message: `Hosted planner monitor passed for ${baseUrl}.`,
      });
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await sendHostedPlannerAlert({ baseUrl, ok: false, message });
    } catch (alertError) {
      console.error(alertError instanceof Error ? alertError.message : String(alertError));
    }
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
