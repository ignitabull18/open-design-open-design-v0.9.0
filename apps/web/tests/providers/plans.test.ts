import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectPlanArtifact, executeProjectPlanAction, executeProjectPlanLaunch, getProjectPlanLaunchPreview, getProjectPlanReadiness } from '../../src/providers/plans';

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

  it('executes provider setup with provider validation enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      plan: { id: 'plan-1' },
      run: {
        id: 'plan-run-1',
        planId: 'plan-1',
        kind: 'action',
        actionId: 'provider-setup',
        status: 'completed',
        title: 'Provider setup',
        mode: 'external',
        summary: 'Validated providers.',
        startedAt: 1,
        artifactIds: [],
        evidence: [],
      },
      artifacts: [],
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await executeProjectPlanAction('plan-1', {
      actionId: 'provider-setup',
      confirmed: true,
      targetDir: 'workspace/my-app',
      validateProviders: true,
    });

    expect(result.run.actionId).toBe('provider-setup');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/plans/plan-1/actions/provider-setup/execute');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      confirmed: true,
      targetDir: 'workspace/my-app',
      validateProviders: true,
    });
  });

  it('executes a plan launch sequence through the daemon API', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      plan: { id: 'plan-1' },
      runs: [],
      artifacts: [],
      proof: {
        planId: 'plan-1',
        generatedAt: 1,
        status: 'in_progress',
        summary: 'Launch proof is incomplete.',
        readyGateCount: 3,
        totalGateCount: 9,
        blockedGateCount: 0,
        nextSteps: [],
        gates: [],
      },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await executeProjectPlanLaunch('plan-1', {
      confirmed: true,
      scaffoldParentDir: 'workspace',
      targetDir: 'workspace/my-app',
      deliveryTarget: 'vercel',
      projectManagementTarget: 'github-issues',
      validateProviders: true,
    });

    expect(result.proof.readyGateCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/plans/plan-1/launch/execute');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      confirmed: true,
      scaffoldParentDir: 'workspace',
      targetDir: 'workspace/my-app',
      deliveryTarget: 'vercel',
      projectManagementTarget: 'github-issues',
      validateProviders: true,
    });
  });

  it('fetches a plan launch preview through the daemon API', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      plan: { id: 'plan-1' },
      launch: {
        planId: 'plan-1',
        generatedAt: 1,
        readyToExecute: false,
        actionIds: ['scaffold'],
        missingInputs: ['Scaffold parent directory: Required'],
        requirements: [],
      },
      proof: {
        planId: 'plan-1',
        generatedAt: 1,
        status: 'not_started',
        summary: 'Launch proof is incomplete.',
        readyGateCount: 0,
        totalGateCount: 9,
        blockedGateCount: 0,
        nextSteps: [],
        gates: [],
      },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await getProjectPlanLaunchPreview('plan-1');

    expect(result.launch.readyToExecute).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/plans/plan-1/launch');
    expect(init.credentials).toBe('include');
  });
});
