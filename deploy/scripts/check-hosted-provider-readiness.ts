#!/usr/bin/env -S node --experimental-strip-types
import { pathToFileURL } from 'node:url';

type JsonObject = Record<string, any>;

const DEFAULT_REQUIRED_TOOLS = [
  'github',
  'cloudflare-hosting',
  'cloudflare-ai-gateway',
  'trigger-dev',
  'composio',
  'supermemory',
  'onepassword',
];

export interface HostedProviderReadinessResult {
  ok: true;
  baseUrl: string;
  planId: string;
  checkedToolIds: string[];
  connectedToolIds: string[];
  deferredToolIds: string[];
}

interface HostedProviderReadinessOptions {
  baseUrl?: string;
  apiToken?: string;
  planId?: string;
  requiredToolIds?: string[];
}

export async function checkHostedProviderReadiness(
  options: HostedProviderReadinessOptions = {},
): Promise<HostedProviderReadinessResult> {
  const baseUrl = (options.baseUrl || process.env.OD_HOSTED_BASE_URL || 'https://open-design.ignitabull.org').replace(/\/$/, '');
  const apiToken = (options.apiToken || process.env.OD_API_TOKEN || '').trim();
  const requiredToolIds = options.requiredToolIds ?? parseToolIds(process.env.OD_REQUIRED_TOOL_IDS) ?? DEFAULT_REQUIRED_TOOLS;
  if (!apiToken) {
    throw Object.assign(
      new Error('OD_API_TOKEN is required. Export the hosted daemon token before checking provider readiness.'),
      { exitCode: 2 },
    );
  }

  const planId = options.planId || process.env.OD_PLAN_ID || await latestPlanId(baseUrl, apiToken);
  if (!planId) {
    throw new Error('No hosted plan found. Set OD_PLAN_ID to the production plan to check.');
  }

  const { plan } = await request(baseUrl, apiToken, `/api/plans/${encodeURIComponent(planId)}`);
  const selectedTools = Array.isArray(plan?.selectedTools) ? plan.selectedTools : [];
  const toolChecks = Array.isArray(plan?.toolChecks) ? plan.toolChecks : [];
  const failures: string[] = [];
  const connectedToolIds: string[] = [];
  const deferredToolIds: string[] = [];

  for (const toolId of requiredToolIds) {
    const selected = selectedTools.find((tool: JsonObject) => tool.toolId === toolId);
    const check = toolChecks.find((item: JsonObject) => item.toolId === toolId);
    const status = check?.status ?? selected?.status;
    const notes = String(selected?.notes ?? check?.summary ?? '').trim();
    if (status === 'connected') {
      connectedToolIds.push(toolId);
      continue;
    }
    if (status === 'deferred' && notes.length > 0) {
      deferredToolIds.push(toolId);
      continue;
    }
    failures.push(`${toolId}: expected connected or deferred with notes, got ${status ?? 'missing'}`);
  }

  if (failures.length > 0) {
    throw new Error(`Provider readiness failed for ${planId}: ${failures.join('; ')}`);
  }

  return {
    ok: true,
    baseUrl,
    planId,
    checkedToolIds: requiredToolIds,
    connectedToolIds,
    deferredToolIds,
  };
}

async function latestPlanId(baseUrl: string, apiToken: string): Promise<string | null> {
  const { plans } = await request(baseUrl, apiToken, '/api/plans');
  const sorted = [...(Array.isArray(plans) ? plans : [])].sort((a: JsonObject, b: JsonObject) =>
    Number(b.updatedAt ?? b.createdAt ?? 0) - Number(a.updatedAt ?? a.createdAt ?? 0),
  );
  return typeof sorted[0]?.id === 'string' ? sorted[0].id : null;
}

async function request(baseUrl: string, apiToken: string, path: string): Promise<JsonObject> {
  const response = await fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as JsonObject;
}

function parseToolIds(value: string | undefined): string[] | null {
  const ids = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  return ids.length > 0 ? ids : null;
}

async function main() {
  const result = await checkHostedProviderReadiness();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(typeof error?.exitCode === 'number' ? error.exitCode : 1);
  });
}
