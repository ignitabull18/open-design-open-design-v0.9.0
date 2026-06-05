import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectPlanArtifact, getProjectPlanReadiness } from '../../src/providers/plans';

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
  it('fetches plan readiness through the daemon API', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      plan: { id: 'plan-1' },
      readiness: {
        planId: 'plan-1',
        generatedAt: 1,
        overallStatus: 'in_progress',
        completedCount: 1,
        totalCount: 3,
        blockedCount: 0,
        nextSummary: 'Selected tool checks: Run a provider check for github.',
        items: [],
      },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await getProjectPlanReadiness('plan-1');

    expect(result.readiness.nextSummary).toContain('Selected tool checks');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/plans/plan-1/readiness');
    expect(init.credentials).toBe('include');
  });

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
