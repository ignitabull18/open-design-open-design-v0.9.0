import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkHostedProviderConnections } from '../scripts/check-hosted-provider-connections.ts';

test('provider connection probes mark reachable providers connected', async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response('{}', { status: 200 });
  };

  const result = await checkHostedProviderConnections({
    providers: ['supermemory', 'composio'],
    env: {
      SUPERMEMORY_API_KEY: 'supermemory-token',
      COMPOSIO_API_KEY: 'composio-token',
    },
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.connectedProviders, ['supermemory', 'composio']);
  assert.deepEqual(result.deferredProviders, []);
  assert.equal(calls.length, 2);
});

test('provider connection probes keep missing provider credentials explicit', async () => {
  const result = await checkHostedProviderConnections({
    providers: ['supermemory', 'trigger-dev', 'cloudflare-ai-gateway'],
    env: {},
    fetchImpl: async () => {
      throw new Error('fetch should not run without credentials');
    },
  });

  assert.deepEqual(result.connectedProviders, []);
  assert.deepEqual(result.deferredProviders, ['supermemory', 'trigger-dev', 'cloudflare-ai-gateway']);
  assert.match(result.probes[0]?.summary ?? '', /SUPERMEMORY_API_KEY/);
});
