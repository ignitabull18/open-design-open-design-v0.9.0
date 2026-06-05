import express from 'express';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, openDatabase } from '../src/db.js';
import { registerPlanRoutes, type RegisterPlanRoutesDeps } from '../src/plan-routes.js';

let tempDir: string;
let server: http.Server | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-plan-routes-'));
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((error?: Error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

async function startPlanServer(options: Partial<Omit<RegisterPlanRoutesDeps, 'db'>> = {}): Promise<string> {
  const app = express();
  app.use(express.json());
  const db = openDatabase(tempDir, { dataDir: tempDir });
  registerPlanRoutes(app, { db, ...options });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server?.once('listening', resolve);
    server?.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to resolve test server port');
  return `http://127.0.0.1:${address.port}`;
}

async function jsonFetch(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, any>,
  };
}

describe('planning routes', () => {
  it('exposes role-specific tool options for stack selection', async () => {
    const baseUrl = await startPlanServer();

    const response = await jsonFetch(`${baseUrl}/api/planning/tools`);
    const capabilities = await jsonFetch(`${baseUrl}/api/planning/capabilities`);

    expect(response.status).toBe(200);
    expect(response.body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cloudflare-hosting', kind: 'hosting' }),
      expect.objectContaining({ id: 'cloudflare-data', kind: 'database' }),
      expect.objectContaining({ id: 'cloudflare-access', kind: 'authentication' }),
      expect.objectContaining({ id: 'supabase-database', kind: 'database' }),
      expect.objectContaining({ id: 'supabase-auth', kind: 'authentication' }),
      expect.objectContaining({ id: 'trigger-dev', kind: 'workflow-automation' }),
    ]));
    const ids = response.body.tools.map((tool: { id: string }) => tool.id);
    expect(ids.filter((id: string) => id === 'cloudflare')).toHaveLength(0);
    expect(ids.filter((id: string) => id === 'supabase')).toHaveLength(0);
    expect(capabilities.status).toBe(200);
    expect(capabilities.body.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolId: 'cloudflare-hosting',
        checkedAt: '2026-06-04',
        planningImplications: expect.arrayContaining([
          expect.stringContaining('Cloudflare AI routing explicit'),
        ]),
      }),
      expect.objectContaining({
        toolId: 'trigger-dev',
        capabilities: expect.arrayContaining([
          expect.stringContaining('Run Engine 2'),
        ]),
      }),
    ]));
  });

  it('refreshes provider capability snapshots from live source URLs', async () => {
    const fetchCalls: string[] = [];
    const baseUrl = await startPlanServer({
      providerSourceFetcher: async (url) => {
        fetchCalls.push(url);
        return {
          url,
          statusCode: 200,
          ok: true,
          title: url.includes('supabase') ? 'Supabase Changelog' : 'Provider Changelog',
          excerpt: `Latest provider details from ${url}`,
          durationMs: 7,
        };
      },
    });

    const response = await jsonFetch(`${baseUrl}/api/planning/capabilities/refresh`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    expect(fetchCalls).toEqual(expect.arrayContaining([
      'https://developers.cloudflare.com/changelog/product-group/ai/',
      'https://supabase.com/changelog',
      'https://trigger.dev/changelog/',
    ]));
    expect(response.body.sourceUrls).toEqual(expect.arrayContaining([
      'https://www.better-t-stack.dev/docs',
      'https://trigger.dev/changelog/',
    ]));
    expect(response.body.refreshedAt).toEqual(expect.any(Number));
    expect(response.body.refreshEvidence).toEqual(expect.arrayContaining([
      expect.stringContaining('ok 200 https://supabase.com/changelog'),
    ]));
    expect(response.body.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolId: 'supabase-database',
        checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        refreshEvidence: expect.arrayContaining([
          expect.stringContaining('Fetched https://supabase.com/changelog'),
          expect.stringContaining('Title: Supabase Changelog'),
        ]),
      }),
    ]));
  });

  it('persists refreshed provider capability snapshots into stored plans when requested', async () => {
    const baseUrl = await startPlanServer({
      providerSourceFetcher: async (url) => ({
        url,
        statusCode: 200,
        ok: true,
        title: url.includes('supabase') ? 'Supabase Changelog Persisted' : 'Provider Changelog Persisted',
        excerpt: `Persisted provider details from ${url}`,
        durationMs: 5,
      }),
    });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Persisted Capability Studio',
        intent: { purpose: 'Keep saved plans current with provider capability refreshes.' },
        selectedTools: [
          { toolId: 'supabase-database', status: 'wanted' },
          { toolId: 'trigger-dev', status: 'wanted' },
        ],
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          auth: 'better-auth',
        },
      }),
    });

    const refreshed = await jsonFetch(`${baseUrl}/api/planning/capabilities/refresh`, {
      method: 'POST',
      body: JSON.stringify({ persist: true }),
    });
    const stored = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}`);

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.plansUpdated).toBe(1);
    expect(stored.body.plan.providerCapabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolId: 'supabase-database',
        refreshEvidence: expect.arrayContaining([
          expect.stringContaining('Title: Supabase Changelog Persisted'),
        ]),
      }),
      expect.objectContaining({
        toolId: 'trigger-dev',
        refreshEvidence: expect.arrayContaining([
          expect.stringContaining('Persisted provider details'),
        ]),
      }),
    ]));
  });

  it('creates a persisted Better-T-Stack scaffold plan from a project brief', async () => {
    const baseUrl = await startPlanServer();

    const response = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Vendor Portal',
        intent: {
          purpose: 'Create a vendor portal with onboarding, payments, and AI memory.',
          audience: 'internal operators and vendors',
          successCriteria: ['scaffolded repo', 'Cloudflare preview', 'Stripe test checkout'],
        },
        sectionAnswers: {
          planning: {
            sectionId: 'planning',
            status: 'answered',
            answers: ['Ship project planning before scaffold execution'],
            notes: 'Created from test fixture',
            updatedAt: 1,
          },
        },
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          orm: 'drizzle',
          api: 'trpc',
          auth: 'better-auth',
          payments: 'stripe',
          hosting: ['cloudflare', 'vercel'],
          packageManager: 'pnpm',
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(response.body.plan).toMatchObject({
      name: 'Vendor Portal',
      repo: { provider: 'github', status: 'planned' },
      stack: {
        frontend: 'next',
        database: 'supabase',
        auth: 'better-auth',
      },
    });
    expect(response.body.plan.scaffold.command).toContain('pnpm create better-t-stack@latest vendor-portal');
    expect(response.body.plan.scaffold.command).toContain('--database postgres');
    expect(response.body.plan.scaffold.command).toContain('--auth better-auth');
    expect(response.body.plan.scaffold.docsSources).toContain('https://www.better-t-stack.dev/docs');
    expect(response.body.plan.scaffold.docsSources).toContain('https://trigger.dev/changelog/');
    expect(response.body.plan.databaseDesign).toMatchObject({
      mode: 'transactional',
      primaryStore: 'supabase',
    });
    expect(response.body.plan.agentLanes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'database',
        sectionId: 'database',
        mode: 'parallel',
        status: 'ready',
        runbook: expect.arrayContaining([expect.stringContaining('entities')]),
        parallelWith: expect.arrayContaining(['workflows', 'integrations']),
      }),
      expect.objectContaining({
        id: 'workflows',
        sectionId: 'workflows',
        mode: 'parallel',
        toolIds: expect.arrayContaining(['trigger-dev']),
      }),
    ]));
    expect(response.body.plan.ideationQuestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'data-source-of-truth', laneId: 'database' }),
      expect.objectContaining({ id: 'workflow-duration', laneId: 'workflows' }),
    ]));
    expect(response.body.plan.workspaceSections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'planning',
        owns: expect.arrayContaining(['purpose', 'sequencing']),
        doesNotOwn: expect.arrayContaining(['schema implementation']),
      }),
      expect.objectContaining({
        id: 'design',
        owns: expect.arrayContaining(['user flows', 'screen inventory']),
        doesNotOwn: expect.arrayContaining(['database source of truth']),
      }),
      expect.objectContaining({
        id: 'database',
        owns: expect.arrayContaining(['entities', 'relationships']),
        doesNotOwn: expect.arrayContaining(['UI layout']),
      }),
      expect.objectContaining({
        id: 'ai',
        owns: expect.arrayContaining(['model routing', 'memory policy']),
      }),
      expect.objectContaining({
        id: 'integrations',
        owns: expect.arrayContaining(['connected accounts', 'webhook contracts']),
      }),
    ]));
    expect(response.body.plan.sectionAnswers).toMatchObject({
      planning: {
        sectionId: 'planning',
        status: 'answered',
        answers: ['Ship project planning before scaffold execution'],
        notes: 'Created from test fixture',
      },
    });
    expect(response.body.plan.scaffold.postScaffoldTasks).toEqual(expect.arrayContaining([
      expect.stringContaining('Apply planning section decisions before execution'),
    ]));
    expect(response.body.plan.providerCapabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolId: 'cloudflare-hosting' }),
      expect.objectContaining({ toolId: 'supabase-database' }),
      expect.objectContaining({ toolId: 'trigger-dev' }),
    ]));
    expect(response.body.plan.runtimePlan).toMatchObject({
      recommended: 'node-daemon',
    });
    expect(response.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'scaffold',
        requiresConfirmation: true,
        command: expect.stringContaining('better-t-stack'),
      }),
      expect.objectContaining({
        id: 'repo-create',
        command: expect.stringContaining('gh repo create'),
      }),
      expect.objectContaining({
        id: 'deploy-runtime',
        status: 'ready',
      }),
    ]));
    expect(response.body.plan.executionRuns).toEqual([]);
    expect(response.body.plan.executionArtifacts).toEqual([]);
    expect(response.body.plan.toolChecks).toEqual([]);
    expect(response.body.plan.scaffoldExecution).toMatchObject({ status: 'not_started' });
    expect(response.body.plan.selectedTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolId: 'cloudflare-hosting', status: 'wanted' }),
      expect.objectContaining({ toolId: 'vercel', status: 'wanted' }),
      expect.objectContaining({ toolId: 'supabase-database', status: 'wanted' }),
      expect.objectContaining({ toolId: 'trigger-dev', status: 'wanted' }),
      expect.objectContaining({ toolId: 'stripe', status: 'wanted' }),
      expect.objectContaining({ toolId: 'onepassword', status: 'wanted' }),
    ]));

    const list = await jsonFetch(`${baseUrl}/api/plans`);
    expect(list.body.plans).toHaveLength(1);
    expect(list.body.plans[0].id).toBe(response.body.plan.id);

    const blocked = await jsonFetch(`${baseUrl}/api/plans/${response.body.plan.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ actionId: 'scaffold' }),
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('confirmation required');

    const accepted = await jsonFetch(`${baseUrl}/api/plans/${response.body.plan.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ actionId: 'scaffold', confirmed: true }),
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'scaffold', status: 'accepted' }),
    ]));
  });

  it('records plan execution runs, artifacts, tool checks, and section-agent outputs', async () => {
    const toolCheckCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const baseUrl = await startPlanServer({
      toolCheckRunner: async (request) => {
        toolCheckCalls.push({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
        });
        return {
          exitCode: 0,
          stdout: 'You are logged in with an API Token',
          stderr: '',
          durationMs: 11,
        };
      },
    });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Execution Studio',
        intent: { purpose: 'Turn planning records into execution artifacts.' },
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          auth: 'better-auth',
          hosting: ['cloudflare'],
        },
      }),
    });
    const planId = created.body.plan.id;

    const missingConfirmation = await jsonFetch(`${baseUrl}/api/plans/${planId}/actions/scaffold/execute`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(missingConfirmation.status).toBe(409);
    expect(missingConfirmation.body.error).toBe('confirmation required');

    const providerRun = await jsonFetch(`${baseUrl}/api/plans/${planId}/actions/provider-research/execute`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(providerRun.status).toBe(201);
    expect(providerRun.body.run).toMatchObject({
      kind: 'action',
      actionId: 'provider-research',
      status: 'completed',
      mode: 'record-only',
    });
    expect(providerRun.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'provider-research' }),
    ]));
    expect(providerRun.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider-research', status: 'completed' }),
    ]));

    const scaffoldRun = await jsonFetch(`${baseUrl}/api/plans/${planId}/actions/scaffold/execute`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    });
    expect(scaffoldRun.status).toBe(202);
    expect(scaffoldRun.body.run).toMatchObject({
      kind: 'action',
      actionId: 'scaffold',
      status: 'blocked',
      mode: 'dry-run',
    });
    expect(scaffoldRun.body.plan.scaffoldExecution).toMatchObject({
      status: 'planned',
      lastRunId: scaffoldRun.body.run.id,
    });

    const sectionRun = await jsonFetch(`${baseUrl}/api/plans/${planId}/sections/database/runs`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(sectionRun.status).toBe(201);
    expect(sectionRun.body.run).toMatchObject({
      kind: 'section-agent',
      sectionId: 'database',
      status: 'completed',
    });
    expect(sectionRun.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'database-draft',
        content: expect.stringContaining('Logical schema:'),
      }),
    ]));
    expect(sectionRun.body.artifacts[0].content).toContain('plans');
    expect(sectionRun.body.artifacts[0].content).toContain('Access policy draft:');
    expect(sectionRun.body.artifacts[0].content).toContain('Supabase/Postgres path');

    const sectionBatch = await jsonFetch(`${baseUrl}/api/plans/${planId}/sections/runs`, {
      method: 'POST',
      body: JSON.stringify({ onlyReady: true, sectionIds: ['design', 'database', 'integrations'] }),
    });
    expect(sectionBatch.status).toBe(201);
    expect(sectionBatch.body.runs).toHaveLength(3);
    expect(sectionBatch.body.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'section-agent', sectionId: 'design', status: 'completed' }),
      expect.objectContaining({ kind: 'section-agent', sectionId: 'database', status: 'completed' }),
      expect.objectContaining({ kind: 'section-agent', sectionId: 'integrations', status: 'completed' }),
    ]));
    expect(sectionBatch.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'section-output', title: expect.stringContaining('Design') }),
      expect.objectContaining({ kind: 'database-draft', title: expect.stringContaining('Database') }),
      expect.objectContaining({ kind: 'section-output', title: expect.stringContaining('Integrations') }),
    ]));

    const toolCheck = await jsonFetch(`${baseUrl}/api/plans/${planId}/tools/cloudflare-hosting/check`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(toolCheck.status).toBe(201);
    expect(toolCheck.body.toolCheck).toMatchObject({
      toolId: 'cloudflare-hosting',
      status: 'connected',
      summary: expect.stringContaining('live provider check'),
    });
    expect(toolCheck.body.run).toMatchObject({
      kind: 'tool-check',
      status: 'completed',
      mode: 'external',
      command: 'pnpm wrangler whoami',
    });
    expect(toolCheckCalls).toEqual([
      expect.objectContaining({
        command: 'pnpm',
        args: ['wrangler', 'whoami'],
      }),
    ]);
    expect(toolCheck.body.artifacts[0].content).toContain('Mode: live provider check');
    expect(toolCheck.body.plan.selectedTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolId: 'cloudflare-hosting', status: 'connected' }),
    ]));

    const execution = await jsonFetch(`${baseUrl}/api/plans/${planId}/execution`);
    expect(execution.status).toBe(200);
    expect(execution.body.runs).toHaveLength(7);
    expect(execution.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'provider-research' }),
      expect.objectContaining({ kind: 'scaffold-plan' }),
      expect.objectContaining({ kind: 'database-draft' }),
      expect.objectContaining({ kind: 'tool-check' }),
    ]));
    expect(execution.body.toolChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolId: 'cloudflare-hosting', status: 'connected' }),
    ]));
    expect(execution.body.scaffoldExecution).toMatchObject({ status: 'planned' });
  });

  it('blocks selected tools when a live provider check fails', async () => {
    const toolCheckCalls: Array<{ command: string; args: string[] }> = [];
    const baseUrl = await startPlanServer({
      toolCheckRunner: async (request) => {
        toolCheckCalls.push({
          command: request.command,
          args: request.args,
        });
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'gh: not logged in',
          durationMs: 8,
        };
      },
    });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Auth Check Studio',
        intent: { purpose: 'Verify real provider auth before execution.' },
        selectedTools: [
          { toolId: 'github', status: 'wanted' },
        ],
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          auth: 'better-auth',
        },
      }),
    });

    const checked = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/tools/github/check`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    expect(checked.status).toBe(201);
    expect(toolCheckCalls).toEqual([
      { command: 'gh', args: ['auth', 'status'] },
    ]);
    expect(checked.body.toolCheck).toMatchObject({
      toolId: 'github',
      status: 'blocked',
      summary: expect.stringContaining('live provider check failed'),
    });
    expect(checked.body.run).toMatchObject({
      kind: 'tool-check',
      status: 'blocked',
      mode: 'external',
      command: 'gh auth status',
    });
    expect(checked.body.plan.selectedTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolId: 'github', status: 'blocked' }),
    ]));
    expect(checked.body.artifacts[0].content).toContain('stderr: gh: not logged in');
  });

  it('executes a confirmed scaffold inside the configured scaffold root', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const runnerCalls: Array<{ command: string; args: string[]; cwd: string; outputDir: string }> = [];
    const baseUrl = await startPlanServer({
      scaffoldRoot,
      scaffoldRunner: async (request) => {
        runnerCalls.push({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
          outputDir: request.outputDir,
        });
        mkdirSync(request.outputDir, { recursive: true });
        return {
          exitCode: 0,
          stdout: 'created scaffold',
          stderr: '',
          durationMs: 12,
        };
      },
    });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Scaffold Studio',
        intent: { purpose: 'Run Better-T-Stack in a jailed target directory.' },
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          auth: 'better-auth',
          hosting: ['cloudflare'],
          packageManager: 'pnpm',
        },
      }),
    });

    const blockedEscape = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/scaffold/execute`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true, targetDir: path.join(tempDir, '..', 'outside') }),
    });
    expect(blockedEscape.status).toBe(400);
    expect(blockedEscape.body.error).toContain('targetDir must stay inside');

    const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/scaffold/execute`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true, targetDir: 'workspace' }),
    });

    expect(executed.status).toBe(201);
    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0]).toMatchObject({
      command: 'pnpm',
      args: expect.arrayContaining(['create', 'better-t-stack@latest', 'scaffold-studio']),
      cwd: path.join(scaffoldRoot, 'workspace'),
      outputDir: path.join(scaffoldRoot, 'workspace', 'scaffold-studio'),
    });
    expect(executed.body.run).toMatchObject({
      actionId: 'scaffold',
      status: 'completed',
      mode: 'external',
    });
    expect(executed.body.plan.scaffoldExecution).toMatchObject({
      status: 'completed',
      targetDir: path.join(scaffoldRoot, 'workspace'),
    });
    expect(executed.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'scaffold', status: 'completed' }),
    ]));
    expect(executed.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'scaffold-plan',
        content: expect.stringContaining('created scaffold'),
      }),
    ]));
  });

  it('executes confirmed GitHub repo creation from a configured scaffold source', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'repo-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"repo-studio"}\n');
    const runnerCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const baseUrl = await startPlanServer({
      scaffoldRoot,
      repoRunner: async (request) => {
        runnerCalls.push({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
        });
        return {
          exitCode: 0,
          stdout: 'https://github.com/ignitabull/repo-studio',
          stderr: '',
          durationMs: 20,
        };
      },
    });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Repo Studio',
        intent: { purpose: 'Create a GitHub repository from a scaffolded source directory.' },
        repo: {
          owner: 'ignitabull',
          name: 'repo-studio',
          visibility: 'private',
        },
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          auth: 'better-auth',
          packageManager: 'pnpm',
        },
      }),
    });

    const blockedEscape = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/repo-create/execute`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true, targetDir: path.join(tempDir, '..', 'outside') }),
    });
    expect(blockedEscape.status).toBe(400);
    expect(blockedEscape.body.error).toContain('targetDir must stay inside');

    const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/repo-create/execute`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true, targetDir: 'workspace/repo-studio' }),
    });

    expect(executed.status).toBe(201);
    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0]).toMatchObject({
      command: 'gh',
      args: [
        'repo',
        'create',
        'ignitabull/repo-studio',
        '--private',
        '--source',
        sourceDir,
        '--remote',
        'origin',
        '--push',
      ],
      cwd: sourceDir,
    });
    expect(executed.body.run).toMatchObject({
      actionId: 'repo-create',
      status: 'completed',
      mode: 'external',
      summary: expect.stringContaining('https://github.com/ignitabull/repo-studio'),
    });
    expect(executed.body.plan.repo).toMatchObject({
      owner: 'ignitabull',
      name: 'repo-studio',
      visibility: 'private',
      status: 'created',
      url: 'https://github.com/ignitabull/repo-studio',
    });
    expect(executed.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'repo-create', status: 'completed' }),
    ]));
    expect(executed.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'repo-plan',
        content: expect.stringContaining('https://github.com/ignitabull/repo-studio'),
      }),
    ]));
  });

  it('executes a confirmed Vercel deployment from a configured scaffold source', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'deploy-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"deploy-studio"}\n');
    const runnerCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const healthCalls: string[] = [];
    const baseUrl = await startPlanServer({
      scaffoldRoot,
      deployRunner: async (request) => {
        runnerCalls.push({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
        });
        return {
          exitCode: 0,
          stdout: 'Preview: https://deploy-studio.vercel.app',
          stderr: '',
          durationMs: 30,
        };
      },
      deployHealthChecker: async (url) => {
        healthCalls.push(url);
        return {
          url,
          finalUrl: url,
          statusCode: 200,
          ok: true,
          durationMs: 12,
        };
      },
    });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Deploy Studio',
        intent: { purpose: 'Deploy a scaffolded project to Vercel.' },
        delivery: [{ target: 'vercel', status: 'planned' }],
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'node',
          database: 'supabase',
          auth: 'better-auth',
          hosting: ['vercel'],
        },
      }),
    });

    const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/deploy-runtime/execute`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        targetDir: 'workspace/deploy-studio',
        deliveryTarget: 'vercel',
      }),
    });

    expect(executed.status).toBe(201);
    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0]).toMatchObject({
      command: 'vercel',
      args: ['deploy', '--yes'],
      cwd: sourceDir,
    });
    expect(healthCalls).toEqual(['https://deploy-studio.vercel.app']);
    expect(executed.body.run).toMatchObject({
      actionId: 'deploy-runtime',
      status: 'completed',
      mode: 'external',
      summary: expect.stringContaining('https://deploy-studio.vercel.app'),
    });
    expect(executed.body.plan.delivery).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'vercel',
        status: 'deployed',
        notes: expect.stringContaining('https://deploy-studio.vercel.app'),
      }),
    ]));
    expect(executed.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'deploy-runtime', status: 'completed' }),
    ]));
    expect(executed.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'deployment-plan',
        content: expect.stringContaining('Preview URL: https://deploy-studio.vercel.app'),
      }),
    ]));
    expect(executed.body.run.evidence).toEqual(expect.arrayContaining([
      'healthCheck.ok: yes',
      'healthCheck.statusCode: 200',
    ]));
    expect(executed.body.artifacts[0].content).toContain('Health check: ok');
  });

  it('executes a confirmed Cloudflare deployment from a configured scaffold source', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'cloudflare-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"cloudflare-studio"}\n');
    const runnerCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const healthCalls: string[] = [];
    const baseUrl = await startPlanServer({
      scaffoldRoot,
      deployRunner: async (request) => {
        runnerCalls.push({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
        });
        return {
          exitCode: 0,
          stdout: 'Uploaded cloudflare-studio\nhttps://cloudflare-studio.ignitabull.workers.dev',
          stderr: '',
          durationMs: 45,
        };
      },
      deployHealthChecker: async (url) => {
        healthCalls.push(url);
        return {
          url,
          finalUrl: url,
          statusCode: 204,
          ok: true,
          durationMs: 9,
        };
      },
    });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Cloudflare Studio',
        intent: { purpose: 'Deploy a scaffolded project to Cloudflare Workers.' },
        delivery: [{ target: 'cloudflare', status: 'planned' }],
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'cloudflare-d1',
          auth: 'better-auth',
          hosting: ['cloudflare'],
          packageManager: 'pnpm',
        },
      }),
    });

    const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/deploy-runtime/execute`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        targetDir: 'workspace/cloudflare-studio',
        deliveryTarget: 'cloudflare',
      }),
    });

    expect(executed.status).toBe(201);
    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0]).toMatchObject({
      command: 'pnpm',
      args: ['wrangler', 'deploy'],
      cwd: sourceDir,
    });
    expect(healthCalls).toEqual(['https://cloudflare-studio.ignitabull.workers.dev']);
    expect(executed.body.run).toMatchObject({
      actionId: 'deploy-runtime',
      status: 'completed',
      mode: 'external',
      summary: expect.stringContaining('https://cloudflare-studio.ignitabull.workers.dev'),
      command: 'pnpm wrangler deploy',
    });
    expect(executed.body.plan.delivery).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'cloudflare',
        status: 'deployed',
        notes: expect.stringContaining('https://cloudflare-studio.ignitabull.workers.dev'),
      }),
    ]));
    expect(executed.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'deploy-runtime', status: 'completed' }),
    ]));
    expect(executed.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'deployment-plan',
        content: expect.stringContaining('Command: pnpm wrangler deploy'),
      }),
    ]));
    expect(executed.body.artifacts[0].content).toContain('Health status: 204');
  });

  it('executes a confirmed Coolify deployment from provider configuration', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'coolify-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"coolify-studio"}\n');
    const previousUrl = process.env.COOLIFY_URL;
    const previousToken = process.env.COOLIFY_API_TOKEN;
    const previousResourceUuid = process.env.COOLIFY_RESOURCE_UUID;
    const previousPublicUrl = process.env.COOLIFY_PUBLIC_URL;
    process.env.COOLIFY_URL = 'https://coolify.example.test/';
    process.env.COOLIFY_API_TOKEN = 'coolify_test_token';
    process.env.COOLIFY_RESOURCE_UUID = 'resource-123';
    process.env.COOLIFY_PUBLIC_URL = 'https://coolify-studio.example.test';
    const runnerCalls: Array<{ command: string; args: string[]; cwd: string; env?: Record<string, string> }> = [];
    const healthCalls: string[] = [];
    const baseUrl = await startPlanServer({
      scaffoldRoot,
      deployRunner: async (request) => {
        runnerCalls.push({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
          ...(request.env ? { env: request.env } : {}),
        });
        return {
          exitCode: 0,
          stdout: '{"message":"Deployment queued"}\nPreview: https://coolify-studio.example.test',
          stderr: '',
          durationMs: 55,
        };
      },
      deployHealthChecker: async (url) => {
        healthCalls.push(url);
        return {
          url,
          finalUrl: url,
          statusCode: 200,
          ok: true,
          durationMs: 11,
        };
      },
    });

    try {
      const created = await jsonFetch(`${baseUrl}/api/plans`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Coolify Studio',
          intent: { purpose: 'Deploy a scaffolded project through Coolify.' },
          delivery: [{ target: 'coolify', status: 'planned' }],
          stack: {
            frontend: 'next',
            backend: 'hono',
            runtime: 'node',
            database: 'postgres-coolify',
            auth: 'better-auth',
            hosting: ['coolify'],
          },
        }),
      });

      const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/deploy-runtime/execute`, {
        method: 'POST',
        body: JSON.stringify({
          confirmed: true,
          targetDir: 'workspace/coolify-studio',
          deliveryTarget: 'coolify',
        }),
      });

      expect(executed.status).toBe(201);
      expect(runnerCalls).toHaveLength(1);
      expect(runnerCalls[0]).toMatchObject({
        command: 'bash',
        cwd: sourceDir,
      });
      expect(runnerCalls[0]?.args.join('\n')).toContain('curl -sS -X POST "$COOLIFY_DEPLOY_URL"');
      expect(runnerCalls[0]?.env?.COOLIFY_URL).toBe('https://coolify.example.test');
      expect(runnerCalls[0]?.env?.COOLIFY_API_TOKEN).toBe('coolify_test_token');
      expect(runnerCalls[0]?.env?.COOLIFY_RESOURCE_UUID).toBe('resource-123');
      expect(runnerCalls[0]?.env?.COOLIFY_DEPLOY_URL).toBe('https://coolify.example.test/api/v1/deploy?uuid=resource-123&force=false');
      expect(healthCalls).toEqual(['https://coolify-studio.example.test']);
      expect(executed.body.run).toMatchObject({
        actionId: 'deploy-runtime',
        status: 'completed',
        mode: 'external',
        command: 'coolify deploy --resource "$COOLIFY_RESOURCE_UUID"',
        summary: expect.stringContaining('https://coolify-studio.example.test'),
      });
      expect(executed.body.plan.delivery).toEqual(expect.arrayContaining([
        expect.objectContaining({
          target: 'coolify',
          status: 'deployed',
          notes: expect.stringContaining('https://coolify-studio.example.test'),
        }),
      ]));
      expect(executed.body.artifacts[0].content).toContain('Command: coolify deploy --resource "$COOLIFY_RESOURCE_UUID"');
      expect(executed.body.artifacts[0].content).not.toContain('coolify_test_token');
    } finally {
      if (previousUrl === undefined) delete process.env.COOLIFY_URL;
      else process.env.COOLIFY_URL = previousUrl;
      if (previousToken === undefined) delete process.env.COOLIFY_API_TOKEN;
      else process.env.COOLIFY_API_TOKEN = previousToken;
      if (previousResourceUuid === undefined) delete process.env.COOLIFY_RESOURCE_UUID;
      else process.env.COOLIFY_RESOURCE_UUID = previousResourceUuid;
      if (previousPublicUrl === undefined) delete process.env.COOLIFY_PUBLIC_URL;
      else process.env.COOLIFY_PUBLIC_URL = previousPublicUrl;
    }
  });

  it('executes a confirmed Hostinger VPS deployment from provider configuration', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'hostinger-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"hostinger-studio"}\n');
    const previousHost = process.env.HOSTINGER_SSH_HOST;
    const previousUser = process.env.HOSTINGER_SSH_USER;
    const previousPath = process.env.HOSTINGER_DEPLOY_PATH;
    const previousPort = process.env.HOSTINGER_SSH_PORT;
    const previousCommand = process.env.HOSTINGER_POST_DEPLOY_COMMAND;
    const previousPublicUrl = process.env.HOSTINGER_PUBLIC_URL;
    process.env.HOSTINGER_SSH_HOST = 'vps.example.test';
    process.env.HOSTINGER_SSH_USER = 'deploy';
    process.env.HOSTINGER_DEPLOY_PATH = '/var/www/hostinger-studio';
    process.env.HOSTINGER_SSH_PORT = '2222';
    process.env.HOSTINGER_POST_DEPLOY_COMMAND = 'pnpm install --prod && pnpm start';
    process.env.HOSTINGER_PUBLIC_URL = 'https://hostinger-studio.example.test';
    const runnerCalls: Array<{ command: string; args: string[]; cwd: string; env?: Record<string, string> }> = [];
    const healthCalls: string[] = [];
    const baseUrl = await startPlanServer({
      scaffoldRoot,
      deployRunner: async (request) => {
        runnerCalls.push({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
          ...(request.env ? { env: request.env } : {}),
        });
        return {
          exitCode: 0,
          stdout: 'Preview: https://hostinger-studio.example.test',
          stderr: '',
          durationMs: 75,
        };
      },
      deployHealthChecker: async (url) => {
        healthCalls.push(url);
        return {
          url,
          finalUrl: url,
          statusCode: 200,
          ok: true,
          durationMs: 13,
        };
      },
    });

    try {
      const created = await jsonFetch(`${baseUrl}/api/plans`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Hostinger Studio',
          intent: { purpose: 'Deploy a scaffolded project to Hostinger VPS.' },
          delivery: [{ target: 'hostinger', status: 'planned' }],
          stack: {
            frontend: 'next',
            backend: 'hono',
            runtime: 'node',
            database: 'postgres-coolify',
            auth: 'better-auth',
            hosting: ['hostinger'],
          },
        }),
      });

      const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/deploy-runtime/execute`, {
        method: 'POST',
        body: JSON.stringify({
          confirmed: true,
          targetDir: 'workspace/hostinger-studio',
          deliveryTarget: 'hostinger',
        }),
      });

      expect(executed.status).toBe(201);
      expect(runnerCalls).toHaveLength(1);
      expect(runnerCalls[0]).toMatchObject({
        command: 'bash',
        cwd: sourceDir,
      });
      expect(runnerCalls[0]?.args.join('\n')).toContain('rsync -az --delete');
      expect(runnerCalls[0]?.args.join('\n')).toContain('HOSTINGER_POST_DEPLOY_COMMAND');
      expect(runnerCalls[0]?.env?.HOSTINGER_SSH_HOST).toBe('vps.example.test');
      expect(runnerCalls[0]?.env?.HOSTINGER_SSH_USER).toBe('deploy');
      expect(runnerCalls[0]?.env?.HOSTINGER_SSH_PORT).toBe('2222');
      expect(runnerCalls[0]?.env?.HOSTINGER_DEPLOY_PATH).toBe('/var/www/hostinger-studio');
      expect(healthCalls).toEqual(['https://hostinger-studio.example.test']);
      expect(executed.body.run).toMatchObject({
        actionId: 'deploy-runtime',
        status: 'completed',
        mode: 'external',
        command: 'rsync ./ "$HOSTINGER_SSH_USER@$HOSTINGER_SSH_HOST:$HOSTINGER_DEPLOY_PATH/"',
        summary: expect.stringContaining('https://hostinger-studio.example.test'),
      });
      expect(executed.body.plan.delivery).toEqual(expect.arrayContaining([
        expect.objectContaining({
          target: 'hostinger',
          status: 'deployed',
          notes: expect.stringContaining('https://hostinger-studio.example.test'),
        }),
      ]));
      expect(executed.body.artifacts[0].content).toContain('Command: rsync ./ "$HOSTINGER_SSH_USER@$HOSTINGER_SSH_HOST:$HOSTINGER_DEPLOY_PATH/"');
    } finally {
      if (previousHost === undefined) delete process.env.HOSTINGER_SSH_HOST;
      else process.env.HOSTINGER_SSH_HOST = previousHost;
      if (previousUser === undefined) delete process.env.HOSTINGER_SSH_USER;
      else process.env.HOSTINGER_SSH_USER = previousUser;
      if (previousPath === undefined) delete process.env.HOSTINGER_DEPLOY_PATH;
      else process.env.HOSTINGER_DEPLOY_PATH = previousPath;
      if (previousPort === undefined) delete process.env.HOSTINGER_SSH_PORT;
      else process.env.HOSTINGER_SSH_PORT = previousPort;
      if (previousCommand === undefined) delete process.env.HOSTINGER_POST_DEPLOY_COMMAND;
      else process.env.HOSTINGER_POST_DEPLOY_COMMAND = previousCommand;
      if (previousPublicUrl === undefined) delete process.env.HOSTINGER_PUBLIC_URL;
      else process.env.HOSTINGER_PUBLIC_URL = previousPublicUrl;
    }
  });

  it('blocks a deployment when the post-deploy health check fails', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'unhealthy-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"unhealthy-studio"}\n');
    const baseUrl = await startPlanServer({
      scaffoldRoot,
      deployRunner: async () => ({
        exitCode: 0,
        stdout: 'Preview: https://unhealthy-studio.vercel.app',
        stderr: '',
        durationMs: 30,
      }),
      deployHealthChecker: async (url) => ({
        url,
        finalUrl: url,
        statusCode: 503,
        ok: false,
        durationMs: 10,
      }),
    });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Unhealthy Studio',
        intent: { purpose: 'Reject a deployment with a failing preview URL.' },
        delivery: [{ target: 'vercel', status: 'planned' }],
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'node',
          database: 'supabase',
          auth: 'better-auth',
          hosting: ['vercel'],
        },
      }),
    });

    const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/deploy-runtime/execute`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        targetDir: 'workspace/unhealthy-studio',
        deliveryTarget: 'vercel',
      }),
    });

    expect(executed.status).toBe(201);
    expect(executed.body.run).toMatchObject({
      actionId: 'deploy-runtime',
      status: 'failed',
      summary: expect.stringContaining('health check failed'),
    });
    expect(executed.body.plan.delivery).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'vercel',
        status: 'blocked',
        notes: expect.stringContaining('503'),
      }),
    ]));
    expect(executed.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'deploy-runtime', status: 'accepted' }),
    ]));
    expect(executed.body.run.evidence).toEqual(expect.arrayContaining([
      'healthCheck.ok: no',
      'healthCheck.statusCode: 503',
    ]));
    expect(executed.body.artifacts[0].content).toContain('Health check: failed');
  });

  it('materializes database planning files into a scaffold source', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'database-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"database-studio"}\n');
    const migrationCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const baseUrl = await startPlanServer({
      scaffoldRoot,
      databaseMigrationRunner: async (request) => {
        migrationCalls.push({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
        });
        return {
          exitCode: 0,
          stdout: 'Pushed migration 0001_planning_schema.sql',
          stderr: '',
          durationMs: 19,
        };
      },
    });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Database Studio',
        intent: { purpose: 'Design a tenant-aware project planning database.' },
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          auth: 'better-auth',
        },
      }),
    });

    const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/database-materialize/execute`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        targetDir: 'workspace/database-studio',
      }),
    });

    expect(executed.status).toBe(201);
    expect(executed.body.run).toMatchObject({
      actionId: 'database-materialize',
      status: 'completed',
      mode: 'external',
      summary: expect.stringContaining('Wrote 3 database design file'),
    });
    expect(executed.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'database-materialize', status: 'completed' }),
    ]));
    expect(executed.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'database-materialization',
        content: expect.stringContaining('db/migrations/0001_planning_schema.sql'),
      }),
    ]));
    const databasePlan = readFileSync(path.join(sourceDir, 'docs', 'database-plan.md'), 'utf8');
    const readme = readFileSync(path.join(sourceDir, 'db', 'README.md'), 'utf8');
    const migration = readFileSync(path.join(sourceDir, 'db', 'migrations', '0001_planning_schema.sql'), 'utf8');
    expect(databasePlan).toContain('Primary store: supabase');
    expect(readme).toContain('Supabase/Postgres supports RLS');
    expect(migration).toContain('create table if not exists organizations');
    expect(migration).toContain('alter table plans enable row level security');

    const migrated = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/database-migrate/execute`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        targetDir: 'workspace/database-studio',
      }),
    });

    expect(migrated.status).toBe(201);
    expect(migrationCalls).toEqual([
      {
        command: 'supabase',
        args: ['db', 'push'],
        cwd: sourceDir,
      },
    ]);
    expect(migrated.body.run).toMatchObject({
      actionId: 'database-migrate',
      status: 'completed',
      mode: 'external',
      command: 'supabase db push',
    });
    expect(migrated.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'database-migrate', status: 'completed' }),
    ]));
    expect(migrated.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'database-migration',
        content: expect.stringContaining('Pushed migration 0001_planning_schema.sql'),
      }),
    ]));
  });

  it('materializes design planning files into a scaffold source', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'design-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"design-studio"}\n');
    const baseUrl = await startPlanServer({ scaffoldRoot });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Design Studio',
        intent: {
          purpose: 'Design a planning app with distinct product sections.',
          audience: 'Solo builders customizing their stack',
        },
        selectedTools: [
          { toolId: 'google-docs', status: 'wanted' },
          { toolId: 'github-issues', status: 'wanted' },
          { toolId: 'stripe', status: 'wanted' },
          { toolId: 'trigger-dev', status: 'wanted' },
        ],
        sectionAnswers: {
          design: {
            status: 'answered',
            answers: [
              'Keep planning, design, database, integrations, AI, workflows, and delivery as separate sections.',
              'Show execution proof and blockers directly on each action.',
            ],
            notes: 'The design should prioritize repeated operational use over a marketing landing page.',
          },
        },
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          auth: 'better-auth',
          hosting: ['cloudflare'],
        },
      }),
    });

    const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/design-materialize/execute`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        targetDir: 'workspace/design-studio',
      }),
    });

    expect(executed.status).toBe(201);
    expect(executed.body.run).toMatchObject({
      actionId: 'design-materialize',
      status: 'completed',
      mode: 'external',
      summary: expect.stringContaining('Wrote 3 design planning file'),
    });
    expect(executed.body.run.evidence).toEqual(expect.arrayContaining([
      'wrote docs/design-plan.md',
      'wrote docs/user-flows.md',
      'wrote docs/design-acceptance.md',
    ]));
    expect(executed.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'design-materialize', status: 'completed' }),
    ]));
    expect(executed.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'design-materialization',
        content: expect.stringContaining('docs/design-plan.md'),
      }),
    ]));
    const designPlan = readFileSync(path.join(sourceDir, 'docs', 'design-plan.md'), 'utf8');
    const userFlows = readFileSync(path.join(sourceDir, 'docs', 'user-flows.md'), 'utf8');
    const acceptance = readFileSync(path.join(sourceDir, 'docs', 'design-acceptance.md'), 'utf8');
    expect(designPlan).toContain('Audience: Solo builders customizing their stack');
    expect(designPlan).toContain('Keep planning, design, database, integrations, AI, workflows, and delivery as separate sections.');
    expect(userFlows).toContain('Materialize design and database files into the scaffolded source tree.');
    expect(userFlows).toContain('Selected tools: google-docs, github-issues, stripe, trigger-dev');
    expect(acceptance).toContain('Planning, Design, Database, Integrations, AI, Workflows, and Delivery remain visually and functionally distinct.');
  });

  it('materializes provider setup files into a scaffold source', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'provider-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"provider-studio"}\n');
    const baseUrl = await startPlanServer({ scaffoldRoot });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Provider Studio',
        intent: {
          purpose: 'Configure a scaffolded project against the selected provider stack.',
          audience: 'Builders using Cloudflare, Supabase, Trigger.dev, Composio, Supermemory, and 1Password',
        },
        selectedTools: [
          { toolId: 'onepassword', status: 'wanted', notes: 'Secret source of truth' },
          { toolId: 'cloudflare-hosting', status: 'wanted' },
          { toolId: 'cloudflare-ai-gateway', status: 'wanted' },
          { toolId: 'supabase-database', status: 'wanted' },
          { toolId: 'trigger-dev', status: 'wanted' },
          { toolId: 'composio', status: 'wanted' },
          { toolId: 'supermemory', status: 'wanted' },
          { toolId: 'stripe', status: 'deferred' },
        ],
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          auth: 'better-auth',
          hosting: ['cloudflare'],
        },
      }),
    });

    const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/provider-setup/execute`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        targetDir: 'workspace/provider-studio',
      }),
    });

    expect(executed.status).toBe(201);
    expect(executed.body.run).toMatchObject({
      actionId: 'provider-setup',
      status: 'completed',
      mode: 'external',
      summary: expect.stringContaining('Wrote 3 provider setup file'),
    });
    expect(executed.body.run.evidence).toEqual(expect.arrayContaining([
      'wrote docs/provider-setup.md',
      'wrote docs/provider-checklist.md',
      'wrote env/planning.providers.env.example',
    ]));
    expect(executed.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider-setup', status: 'completed' }),
    ]));
    expect(executed.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'provider-setup',
        content: expect.stringContaining('Selected providers: onepassword, cloudflare-hosting, cloudflare-ai-gateway'),
      }),
    ]));
    const setup = readFileSync(path.join(sourceDir, 'docs', 'provider-setup.md'), 'utf8');
    const checklist = readFileSync(path.join(sourceDir, 'docs', 'provider-checklist.md'), 'utf8');
    const envExample = readFileSync(path.join(sourceDir, 'env', 'planning.providers.env.example'), 'utf8');
    expect(setup).toContain('Keep Cloudflare hosting, Cloudflare data, and Cloudflare Access as separate setup tracks.');
    expect(setup).toContain('Secret source of truth');
    expect(setup).toContain('TRIGGER_SECRET_KEY');
    expect(setup).toContain('COMPOSIO_API_KEY');
    expect(setup).toContain('SUPERMEMORY_API_KEY');
    expect(checklist).toContain('Workflow Automation');
    expect(checklist).toContain('Verify: Run a dev task or list project environments.');
    expect(envExample).toContain('CLOUDFLARE_AI_GATEWAY_ID=');
    expect(envExample).toContain('OP_SERVICE_ACCOUNT_TOKEN=');
    expect(envExample).toContain('STRIPE_WEBHOOK_SECRET=');
  });

  it('blocks database migration execution when provider identity is missing', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'd1-studio');
    mkdirSync(path.join(sourceDir, 'db', 'migrations'), { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"d1-studio"}\n');
    writeFileSync(path.join(sourceDir, 'db', 'migrations', '0001_planning_schema.sql'), '-- migration\n');
    const previousDatabaseName = process.env.CLOUDFLARE_D1_DATABASE_NAME;
    delete process.env.CLOUDFLARE_D1_DATABASE_NAME;
    const baseUrl = await startPlanServer({ scaffoldRoot });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'D1 Studio',
        intent: { purpose: 'Apply edge database migrations.' },
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'cloudflare-d1',
          auth: 'better-auth',
          packageManager: 'pnpm',
        },
      }),
    });

    const migrated = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/database-migrate/execute`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        targetDir: 'workspace/d1-studio',
      }),
    });

    if (previousDatabaseName === undefined) delete process.env.CLOUDFLARE_D1_DATABASE_NAME;
    else process.env.CLOUDFLARE_D1_DATABASE_NAME = previousDatabaseName;

    expect(migrated.status).toBe(202);
    expect(migrated.body.run).toMatchObject({
      actionId: 'database-migrate',
      status: 'blocked',
      mode: 'dry-run',
    });
    expect(migrated.body.run.summary).toContain('CLOUDFLARE_D1_DATABASE_NAME');
    expect(migrated.body.artifacts[0].content).toContain('Command: not available for this database target');
  });

  it('executes a confirmed GitHub Issues project-management handoff', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'handoff-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"handoff-studio"}\n');
    const runnerCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const baseUrl = await startPlanServer({
      scaffoldRoot,
      projectManagementRunner: async (request) => {
        runnerCalls.push({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
        });
        return {
          exitCode: 0,
          stdout: `https://github.com/ignitabull/handoff-studio/issues/${runnerCalls.length}`,
          stderr: '',
          durationMs: 15,
        };
      },
    });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Handoff Studio',
        intent: { purpose: 'Create implementation issues from the accepted planning sections.' },
        repo: {
          owner: 'ignitabull',
          name: 'handoff-studio',
          visibility: 'private',
        },
        selectedTools: [
          { toolId: 'github', status: 'wanted' },
          { toolId: 'github-issues', status: 'wanted' },
          { toolId: 'supabase-database', status: 'wanted' },
        ],
        sectionAnswers: {
          planning: {
            sectionId: 'planning',
            status: 'answered',
            answers: ['Implement the planner as the first workflow.'],
            updatedAt: 1,
          },
        },
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          auth: 'better-auth',
        },
      }),
    });

    const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/project-management/execute`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        targetDir: 'workspace/handoff-studio',
        projectManagementTarget: 'github-issues',
      }),
    });

    expect(executed.status).toBe(201);
    expect(runnerCalls).toHaveLength(3);
    const firstRunnerCall = runnerCalls[0];
    expect(firstRunnerCall).toBeDefined();
    expect(firstRunnerCall).toMatchObject({
      command: 'gh',
      cwd: sourceDir,
    });
    expect(firstRunnerCall?.args).toEqual(expect.arrayContaining([
      'issue',
      'create',
      '--repo',
      'ignitabull/handoff-studio',
      '--title',
      'Implement accepted plan: Handoff Studio',
    ]));
    expect(firstRunnerCall?.args.join('\n')).toContain('Implement the planner as the first workflow.');
    expect(executed.body.run).toMatchObject({
      actionId: 'project-management',
      status: 'completed',
      mode: 'external',
      summary: expect.stringContaining('Created github-issues project-management handoff'),
    });
    expect(executed.body.plan.executionActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'project-management', status: 'completed' }),
    ]));
    expect(executed.body.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'project-management-plan',
        content: expect.stringContaining('Project-management target: github-issues'),
      }),
    ]));
    expect(executed.body.artifacts[0].content).toContain('https://github.com/ignitabull/handoff-studio/issues/1');
  });

  it('executes a confirmed Linear project-management handoff', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'linear-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"linear-studio"}\n');
    const previousApiKey = process.env.LINEAR_API_KEY;
    const previousTeamId = process.env.LINEAR_TEAM_ID;
    process.env.LINEAR_API_KEY = 'lin_test_key';
    process.env.LINEAR_TEAM_ID = 'team_test_id';
    const runnerCalls: Array<{ command: string; args: string[]; cwd: string; env?: Record<string, string> }> = [];
    const baseUrl = await startPlanServer({
      scaffoldRoot,
      projectManagementRunner: async (request) => {
        runnerCalls.push({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
          ...(request.env ? { env: request.env } : {}),
        });
        return {
          exitCode: 0,
          stdout: '{"data":{"issueCreate":{"success":true,"issue":{"identifier":"OPS-1","url":"https://linear.app/acme/issue/OPS-1"}}}}',
          stderr: '',
          durationMs: 18,
        };
      },
    });
    try {
      const created = await jsonFetch(`${baseUrl}/api/plans`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Linear Studio',
          intent: { purpose: 'Create Linear implementation work from the accepted plan.' },
          selectedTools: [
            { toolId: 'linear', status: 'wanted' },
            { toolId: 'supabase-database', status: 'wanted' },
          ],
          stack: {
            frontend: 'next',
            backend: 'hono',
            runtime: 'workers',
            database: 'supabase',
            auth: 'better-auth',
          },
        }),
      });

      const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/project-management/execute`, {
        method: 'POST',
        body: JSON.stringify({
          confirmed: true,
          targetDir: 'workspace/linear-studio',
          projectManagementTarget: 'linear',
        }),
      });

      expect(executed.status).toBe(201);
      expect(runnerCalls).toHaveLength(3);
      expect(runnerCalls[0]).toMatchObject({
        command: 'bash',
        cwd: sourceDir,
      });
      expect(runnerCalls[0]?.args.join('\n')).toContain('https://api.linear.app/graphql');
      expect(runnerCalls[0]?.env?.LINEAR_API_KEY).toBe('lin_test_key');
      expect(runnerCalls[0]?.env?.LINEAR_TEAM_ID).toBe('team_test_id');
      expect(runnerCalls[0]?.env?.LINEAR_GRAPHQL_BODY).toContain('IssueCreateInput');
      expect(executed.body.run).toMatchObject({
        actionId: 'project-management',
        status: 'completed',
        mode: 'external',
        summary: expect.stringContaining('Created linear project-management handoff'),
      });
      expect(executed.body.artifacts[0].content).toContain('Project-management target: linear');
      expect(executed.body.artifacts[0].content).toContain('OPS-1');
    } finally {
      if (previousApiKey === undefined) delete process.env.LINEAR_API_KEY;
      else process.env.LINEAR_API_KEY = previousApiKey;
      if (previousTeamId === undefined) delete process.env.LINEAR_TEAM_ID;
      else process.env.LINEAR_TEAM_ID = previousTeamId;
    }
  });

  it('executes a confirmed Google Docs project-management handoff', async () => {
    const scaffoldRoot = path.join(tempDir, 'scaffolds');
    const sourceDir = path.join(scaffoldRoot, 'workspace', 'docs-studio');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"docs-studio"}\n');
    const runnerCalls: Array<{ command: string; args: string[]; cwd: string; env?: Record<string, string> }> = [];
    const baseUrl = await startPlanServer({
      scaffoldRoot,
      projectManagementRunner: async (request) => {
        runnerCalls.push({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
          ...(request.env ? { env: request.env } : {}),
        });
        return {
          exitCode: 0,
          stdout: 'https://docs.google.com/document/d/test-doc',
          stderr: '',
          durationMs: 20,
        };
      },
    });
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Docs Studio',
        intent: { purpose: 'Create a Google Docs planning handoff.' },
        selectedTools: [
          { toolId: 'google-docs', status: 'wanted' },
          { toolId: 'trigger-dev', status: 'wanted' },
        ],
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          auth: 'better-auth',
        },
      }),
    });

    const executed = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/actions/project-management/execute`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed: true,
        targetDir: 'workspace/docs-studio',
        projectManagementTarget: 'google-docs',
      }),
    });

    expect(executed.status).toBe(201);
    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0]).toMatchObject({
      command: 'bash',
      cwd: sourceDir,
    });
    expect(runnerCalls[0]?.args.join('\n')).toContain('gws docs-write');
    expect(runnerCalls[0]?.env?.GOOGLE_DOCS_TITLE).toBe('Project plan handoff: Docs Studio');
    const bodyFile = runnerCalls[0]?.env?.GOOGLE_DOCS_BODY_FILE;
    expect(bodyFile).toEqual(expect.stringContaining('.od/plan-handoffs'));
    expect(readFileSync(String(bodyFile), 'utf8')).toContain('# Project Plan Handoff: Docs Studio');
    expect(executed.body.run).toMatchObject({
      actionId: 'project-management',
      status: 'completed',
      mode: 'external',
      summary: expect.stringContaining('Created google-docs project-management handoff'),
    });
    expect(executed.body.artifacts[0].content).toContain('Project-management target: google-docs');
    expect(executed.body.artifacts[0].content).toContain('https://docs.google.com/document/d/test-doc');
  });

  it('updates stack decisions and regenerates the scaffold command', async () => {
    const baseUrl = await startPlanServer();
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Reactive Ops',
        intent: { purpose: 'Prototype a reactive operations workspace.' },
        stack: { database: 'supabase', auth: 'better-auth' },
      }),
    });

    const updated = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        stack: {
          frontend: 'tanstack-start',
          backend: 'convex',
          runtime: 'node',
          database: 'convex',
          orm: 'none',
          api: 'none',
          auth: 'none',
          hosting: ['coolify'],
        },
      }),
    });

    expect(updated.status).toBe(200);
    expect(updated.body.plan.scaffold.command).toContain('--backend convex');
    expect(updated.body.plan.scaffold.command).toContain('--database none');
    expect(updated.body.plan.selectedTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolId: 'coolify' }),
      expect.objectContaining({ toolId: 'convex' }),
      expect.objectContaining({ toolId: 'trigger-dev' }),
    ]));
    expect(updated.body.plan.databaseDesign).toMatchObject({
      mode: 'realtime',
      primaryStore: 'convex',
    });
    expect(updated.body.plan.runtimePlan).toMatchObject({
      recommended: 'coolify-daemon',
    });

    const answered = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sectionAnswers: {
          database: {
            sectionId: 'database',
            status: 'answered',
            answers: ['Use Convex for realtime project state and Trigger.dev for background work.'],
            updatedAt: 2,
          },
        },
      }),
    });

    expect(answered.status).toBe(200);
    expect(answered.body.plan.sectionAnswers.database).toMatchObject({
      status: 'answered',
      answers: ['Use Convex for realtime project state and Trigger.dev for background work.'],
    });
    expect(answered.body.plan.agentLanes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'database',
        brief: expect.stringContaining('Current database answers'),
      }),
    ]));
  });

  it('exposes section-specific workflows and saves one section independently', async () => {
    const baseUrl = await startPlanServer();
    const created = await jsonFetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Workflow Studio',
        intent: { purpose: 'Plan a scaffoldable workflow-heavy SaaS workspace.' },
        stack: {
          frontend: 'next',
          backend: 'hono',
          runtime: 'workers',
          database: 'supabase',
          auth: 'better-auth',
          hosting: ['cloudflare'],
        },
      }),
    });

    const initial = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/sections/database`);

    expect(initial.status).toBe(200);
    expect(initial.body.workflow).toMatchObject({
      section: { id: 'database', label: 'Database' },
      databaseDesign: {
        mode: 'transactional',
        primaryStore: 'supabase',
      },
    });
    expect(initial.body.workflow.questions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'data-source-of-truth', laneId: 'database' }),
    ]));
    expect(initial.body.workflow.lanes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'database',
        outputs: expect.arrayContaining(['entity map', 'migration plan']),
      }),
    ]));
    expect(initial.body.workflow.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'scaffold' }),
    ]));

    const saved = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/sections/database`, {
      method: 'PATCH',
      body: JSON.stringify({
        answers: [
          'Projects own plans, workflow runs, integration connections, and audit events.',
          'Workflow logs should use retention policies and stay out of core plan tables.',
        ],
        notes: 'Database decisions from acceptance test',
      }),
    });

    expect(saved.status).toBe(200);
    expect(saved.body.workflow.answer).toMatchObject({
      sectionId: 'database',
      status: 'answered',
      notes: 'Database decisions from acceptance test',
      answers: [
        'Projects own plans, workflow runs, integration connections, and audit events.',
        'Workflow logs should use retention policies and stay out of core plan tables.',
      ],
    });
    expect(saved.body.workflow.lanes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'database',
        brief: expect.stringContaining('Current database answers'),
      }),
    ]));
    expect(saved.body.plan.sectionAnswers.database).toMatchObject({
      status: 'answered',
      notes: 'Database decisions from acceptance test',
    });

    const reloaded = await jsonFetch(`${baseUrl}/api/plans/${created.body.plan.id}/sections/database`);
    expect(reloaded.body.workflow.answer.answers).toEqual(saved.body.workflow.answer.answers);
    expect(reloaded.body.workflow.questions).toHaveLength(initial.body.workflow.questions.length);
  });
});
