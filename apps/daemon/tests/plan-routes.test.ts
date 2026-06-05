import express from 'express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    const baseUrl = await startPlanServer();
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
      expect.objectContaining({ kind: 'database-draft', content: expect.stringContaining('Database draft') }),
    ]));

    const toolCheck = await jsonFetch(`${baseUrl}/api/plans/${planId}/tools/cloudflare-hosting/check`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(toolCheck.status).toBe(201);
    expect(toolCheck.body.toolCheck).toMatchObject({
      toolId: 'cloudflare-hosting',
      status: 'connected',
    });
    expect(toolCheck.body.run).toMatchObject({
      kind: 'tool-check',
      status: 'completed',
    });
    expect(toolCheck.body.plan.selectedTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolId: 'cloudflare-hosting', status: 'connected' }),
    ]));

    const execution = await jsonFetch(`${baseUrl}/api/plans/${planId}/execution`);
    expect(execution.status).toBe(200);
    expect(execution.body.runs).toHaveLength(4);
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
