import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectPlanArtifact } from '../../src/providers/plans';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('plans provider', () => {
  it('creates plan execution artifacts through the daemon API', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      plan: { id: 'plan-1' },
      artifact: {
        id: 'plan-artifact-1',
        planId: 'plan-1',
        kind: 'project-management-plan',
        title: 'PRD handoff',
        content: 'Handoff notes',
        createdAt: 1,
      },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await createProjectPlanArtifact('plan-1', {
      kind: 'project-management-plan',
      title: 'PRD handoff',
      content: 'Handoff notes',
    });

    expect(result.artifact.id).toBe('plan-artifact-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/plans/plan-1/artifacts');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      kind: 'project-management-plan',
      title: 'PRD handoff',
      content: 'Handoff notes',
    });
  });
});
