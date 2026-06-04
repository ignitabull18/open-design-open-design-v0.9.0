import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, openDatabase } from '../src/db.js';
import { registerPlanRoutes } from '../src/plan-routes.js';

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

async function startPlanServer(): Promise<string> {
  const app = express();
  app.use(express.json());
  const db = openDatabase(tempDir, { dataDir: tempDir });
  registerPlanRoutes(app, { db });
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

    expect(response.status).toBe(200);
    expect(response.body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cloudflare-hosting', kind: 'hosting' }),
      expect.objectContaining({ id: 'cloudflare-data', kind: 'database' }),
      expect.objectContaining({ id: 'cloudflare-access', kind: 'authentication' }),
      expect.objectContaining({ id: 'supabase-database', kind: 'database' }),
      expect.objectContaining({ id: 'supabase-auth', kind: 'authentication' }),
    ]));
    const ids = response.body.tools.map((tool: { id: string }) => tool.id);
    expect(ids.filter((id: string) => id === 'cloudflare')).toHaveLength(0);
    expect(ids.filter((id: string) => id === 'supabase')).toHaveLength(0);
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
    expect(response.body.plan.selectedTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolId: 'cloudflare-hosting', status: 'wanted' }),
      expect.objectContaining({ toolId: 'vercel', status: 'wanted' }),
      expect.objectContaining({ toolId: 'supabase-database', status: 'wanted' }),
      expect.objectContaining({ toolId: 'stripe', status: 'wanted' }),
      expect.objectContaining({ toolId: 'onepassword', status: 'wanted' }),
    ]));

    const list = await jsonFetch(`${baseUrl}/api/plans`);
    expect(list.body.plans).toHaveLength(1);
    expect(list.body.plans[0].id).toBe(response.body.plan.id);
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
    ]));
  });
});
