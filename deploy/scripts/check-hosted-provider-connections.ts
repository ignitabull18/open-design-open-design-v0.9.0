#!/usr/bin/env -S node --experimental-strip-types
import { pathToFileURL } from 'node:url';

export type ProviderId = 'supermemory' | 'composio' | 'trigger-dev' | 'cloudflare-ai-gateway';

export interface HostedProviderConnectionProbe {
  provider: ProviderId;
  status: 'connected' | 'deferred';
  checked: boolean;
  summary: string;
}

export interface HostedProviderConnectionResult {
  ok: true;
  checkedProviders: ProviderId[];
  connectedProviders: ProviderId[];
  deferredProviders: ProviderId[];
  probes: HostedProviderConnectionProbe[];
}

interface HostedProviderConnectionOptions {
  providers?: ProviderId[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

const DEFAULT_PROVIDERS: ProviderId[] = ['supermemory', 'composio', 'trigger-dev', 'cloudflare-ai-gateway'];

export async function checkHostedProviderConnections(
  options: HostedProviderConnectionOptions = {},
): Promise<HostedProviderConnectionResult> {
  const env = options.env ?? process.env;
  const providers = options.providers ?? parseProviders(env.OD_PROVIDER_CONNECTION_IDS) ?? DEFAULT_PROVIDERS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const probes: HostedProviderConnectionProbe[] = [];

  for (const provider of providers) {
    probes.push(await probeProvider(provider, env, fetchImpl));
  }

  return {
    ok: true,
    checkedProviders: providers,
    connectedProviders: probes.filter((probe) => probe.status === 'connected').map((probe) => probe.provider),
    deferredProviders: probes.filter((probe) => probe.status === 'deferred').map((probe) => probe.provider),
    probes,
  };
}

async function probeProvider(
  provider: ProviderId,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<HostedProviderConnectionProbe> {
  if (provider === 'supermemory') {
    const token = env.SUPERMEMORY_API_KEY || env.SUPERMEMORY_CODEX_API_KEY;
    if (!token) return deferred(provider, 'SUPERMEMORY_API_KEY or SUPERMEMORY_CODEX_API_KEY is not set.');
    return endpointProbe({
      provider,
      fetchImpl,
      url: env.SUPERMEMORY_HEALTH_URL || 'https://api.supermemory.ai/v3/documents/list',
      method: 'POST',
      body: '{}',
      headers: { authorization: `Bearer ${token}` },
      success: 'Supermemory API token reached the read-only documents list endpoint.',
    });
  }

  if (provider === 'composio') {
    const token = env.COMPOSIO_API_KEY;
    if (!token) return deferred(provider, 'COMPOSIO_API_KEY is not set.');
    return endpointProbe({
      provider,
      fetchImpl,
      url: env.COMPOSIO_HEALTH_URL || 'https://backend.composio.dev/api/v3/connected_accounts?limit=1',
      headers: { 'x-api-key': token },
      success: 'Composio API token reached the connected accounts endpoint.',
    });
  }

  if (provider === 'trigger-dev') {
    const token = env.TRIGGER_SECRET_KEY || env.TRIGGER_ACCESS_TOKEN;
    if (!token) return deferred(provider, 'TRIGGER_SECRET_KEY or TRIGGER_ACCESS_TOKEN is not set.');
    return endpointProbe({
      provider,
      fetchImpl,
      url: env.TRIGGER_HEALTH_URL || 'https://api.trigger.dev/api/v1/projects',
      headers: { authorization: `Bearer ${token}` },
      success: 'Trigger.dev token reached the projects endpoint.',
    });
  }

  const token = env.CLOUDFLARE_API_TOKEN || env.CF_AIG_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    return deferred(provider, 'CLOUDFLARE_API_TOKEN/CF_AIG_TOKEN and CLOUDFLARE_ACCOUNT_ID are not both set.');
  }
  return endpointProbe({
    provider,
    fetchImpl,
    url: env.CLOUDFLARE_AI_GATEWAY_HEALTH_URL || `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/gateways`,
    headers: { authorization: `Bearer ${token}` },
    success: 'Cloudflare AI Gateway token reached the gateways endpoint.',
  });
}

async function endpointProbe(input: {
  provider: ProviderId;
  fetchImpl: typeof fetch;
  url: string;
  method?: string;
  body?: string;
  headers: Record<string, string>;
  success: string;
}): Promise<HostedProviderConnectionProbe> {
  const response = await input.fetchImpl(input.url, {
    method: input.method,
    headers: {
      ...input.headers,
      ...(input.body ? { 'content-type': 'application/json' } : {}),
    },
    body: input.body,
  });
  if (response.ok) {
    return {
      provider: input.provider,
      status: 'connected',
      checked: true,
      summary: input.success,
    };
  }
  const body = await response.text().catch(() => '');
  return deferred(input.provider, `Read-only probe returned ${response.status}${body ? `: ${body.slice(0, 160)}` : ''}.`);
}

function deferred(provider: ProviderId, summary: string): HostedProviderConnectionProbe {
  return {
    provider,
    status: 'deferred',
    checked: false,
    summary,
  };
}

function parseProviders(value: string | undefined): ProviderId[] | null {
  const providers = String(value || '').split(',').map((item) => item.trim()).filter(Boolean) as ProviderId[];
  return providers.length > 0 ? providers : null;
}

async function main() {
  const result = await checkHostedProviderConnections();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
