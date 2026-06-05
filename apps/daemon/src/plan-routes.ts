import type { Express } from 'express';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  CheckProjectPlanToolRequest,
  CreateProjectIdeationRequest,
  ExecuteProjectPlanActionRequest,
  CreateProjectPlanRequest,
  DatabaseDesignPlan,
  DeliveryPlan,
  IdeationQuestion,
  PlanningAgentLane,
  PlanningExecutionAction,
  PlanningRuntimePlan,
  PlanningExecutionArtifact,
  PlanningExecutionRun,
  PlanningToolOption,
  PlanningToolCheck,
  ProjectIdeaOption,
  ProjectIdeationSession,
  ProjectIntentBrief,
  ProviderCapabilitySnapshot,
  ProjectSectionAnswer,
  ProjectPlan,
  ProjectSectionAnswers,
  ProjectSectionWorkflow,
  ProjectStackDecision,
  ProjectToolConnection,
  ProjectWorkspaceSection,
  RepoPlan,
  RunProjectPlanSectionRequest,
  ScaffoldExecutionPlan,
  ScaffoldPlan,
  UpdateProjectSectionRequest,
  UpdateProjectPlanRequest,
} from '@open-design/contracts';
import {
  deletePlan,
  getPlan,
  insertPlan,
  insertPlanIdeationSession,
  listPlanIdeationSessions,
  listPlans,
  updatePlan,
} from './db.js';
import type { RouteDeps } from './server-context.js';

interface ScaffoldCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  outputDir: string;
  timeoutMs: number;
}

interface ScaffoldCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type ScaffoldCommandRunner = (request: ScaffoldCommandRequest) => Promise<ScaffoldCommandResult>;

interface RepoCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

interface RepoCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type RepoCommandRunner = (request: RepoCommandRequest) => Promise<RepoCommandResult>;

interface DeployCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

interface DeployCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type DeployCommandRunner = (request: DeployCommandRequest) => Promise<DeployCommandResult>;

interface ProjectManagementCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

interface ProjectManagementCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type ProjectManagementCommandRunner = (request: ProjectManagementCommandRequest) => Promise<ProjectManagementCommandResult>;

export interface RegisterPlanRoutesDeps extends RouteDeps<'db'> {
  scaffoldRoot?: string;
  scaffoldRunner?: ScaffoldCommandRunner;
  repoRunner?: RepoCommandRunner;
  deployRunner?: DeployCommandRunner;
  projectManagementRunner?: ProjectManagementCommandRunner;
}

interface ProjectPlanBuildInput {
  id: string;
  name: string;
  intent: ProjectIntentBrief;
  selectedTools?: ProjectToolConnection[];
  stack?: ProjectStackDecision;
  sectionAnswers?: ProjectSectionAnswers;
  repo?: Partial<RepoPlan>;
  delivery?: DeliveryPlan[];
  executionRuns?: PlanningExecutionRun[];
  executionArtifacts?: PlanningExecutionArtifact[];
  toolChecks?: PlanningToolCheck[];
  scaffoldExecution?: ScaffoldExecutionPlan;
  createdAt: number;
  updatedAt: number;
}

const APPROVED_TOOLS: PlanningToolOption[] = [
  { id: 'github', kind: 'source-control', label: 'GitHub', notes: 'Canonical source control and repo creation target.' },
  { id: 'cloudflare-hosting', kind: 'hosting', label: 'Cloudflare', notes: 'Workers, Pages, Access, D1, R2, AI Gateway, and edge deploys.' },
  { id: 'vercel', kind: 'hosting', label: 'Vercel', notes: 'Next.js-first hosting and preview deploy target.' },
  { id: 'coolify', kind: 'hosting', label: 'Coolify', notes: 'Self-hosted deployment control plane for VPS/container stacks.' },
  { id: 'hostinger', kind: 'hosting', label: 'Hostinger', notes: 'VPS and managed hosting target, often paired with Coolify.' },
  { id: 'supabase-database', kind: 'database', label: 'Supabase', notes: 'Postgres, Auth, Storage, Realtime, and Edge Functions.' },
  { id: 'cloudflare-data', kind: 'database', label: 'Cloudflare D1/R2/Vectorize', notes: 'Cloudflare-native data resources for edge apps.' },
  { id: 'convex', kind: 'database', label: 'Convex', notes: 'Reactive TypeScript backend and database option.' },
  { id: 'postgres-coolify', kind: 'database', label: 'Postgres on Coolify', notes: 'Self-hosted Postgres for Coolify/VPS deployments.' },
  { id: 'stripe', kind: 'payments', label: 'Stripe', notes: 'Payment, billing, checkout, and customer portal layer.' },
  { id: 'linear', kind: 'project-management', label: 'Linear', notes: 'Product planning, issues, projects, Diffs, and agent workflows.' },
  { id: 'github-issues', kind: 'project-management', label: 'GitHub Issues', notes: 'Repo-native issues, milestones, and project boards.' },
  { id: 'google-docs', kind: 'project-management', label: 'Google Docs', notes: 'Planning docs, specs, PRDs, and external collaboration.' },
  { id: 'codex', kind: 'ai-runtime', label: 'Codex', notes: 'Primary coding agent runtime.' },
  { id: 'cloudflare-ai-gateway', kind: 'ai-runtime', label: 'Cloudflare AI Gateway', notes: 'Unified AI routing, observability, caching, and guardrails.' },
  { id: 'ollama-cloud', kind: 'ai-runtime', label: 'Ollama Cloud', notes: 'OpenAI-compatible hosted Ollama model endpoint.' },
  { id: 'openrouter', kind: 'ai-runtime', label: 'OpenRouter', notes: 'Model routing and fallback provider.' },
  { id: 'trigger-dev', kind: 'workflow-automation', label: 'Trigger.dev', notes: 'Long-running workflows, background jobs, scheduled work, and durable task runs.' },
  { id: 'onepassword', kind: 'secrets', label: '1Password', notes: 'Default source of truth for secrets and env handoff.' },
  { id: 'composio', kind: 'integrations', label: 'Composio.dev', notes: 'Integration/tool execution layer for external SaaS APIs.' },
  { id: 'supermemory', kind: 'memory', label: 'Supermemory.ai', notes: 'AI memory provider for project and agent context.' },
  { id: 'better-auth', kind: 'authentication', label: 'Better Auth', notes: 'TypeScript auth framework; Better-T-Stack native auth option.' },
  { id: 'cloudflare-access', kind: 'authentication', label: 'Cloudflare Access', notes: 'Zero Trust auth gate for private apps and admin surfaces.' },
  { id: 'supabase-auth', kind: 'authentication', label: 'Supabase Auth', notes: 'Managed auth for Supabase-backed projects.' },
];

const SOURCE_URLS = [
  'https://www.better-t-stack.dev/docs',
  'https://developers.cloudflare.com/changelog/product-group/ai/',
  'https://developers.cloudflare.com/workers/platform/changelog/',
  'https://developers.cloudflare.com/changelog/product/access/',
  'https://vercel.com/changelog',
  'https://coolify.io/changelog/',
  'https://github.com/coollabsio/coolify/releases',
  'https://supabase.com/changelog',
  'https://ship.convex.dev/changelog',
  'https://www.postgresql.org/docs/release/',
  'https://stripe.com/changelog',
  'https://linear.app/changelog',
  'https://github.blog/changelog/',
  'https://developers.google.com/workspace/docs/release-notes',
  'https://better-auth.com/changelog',
  'https://help.openai.com/en/articles/11428266-codex-changelog/',
  'https://releases.1password.com/developers/',
  'https://docs.composio.dev/docs/changelog/2026/02/01',
  'https://supermemory.ai/docs/changelog/developer-platform',
  'https://openrouter.ai/docs/changelog',
  'https://trigger.dev/changelog/',
];

const CHECKED_AT = '2026-06-04';

const PROVIDER_CAPABILITIES: ProviderCapabilitySnapshot[] = [
  {
    toolId: 'cloudflare-hosting',
    label: 'Cloudflare Workers, Pages, Agents, Workflows, and AI Gateway',
    sourceUrl: 'https://developers.cloudflare.com/changelog/product-group/ai/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'AI Gateway REST API supports unified model calls through /ai/run and OpenAI/Anthropic-compatible endpoints.',
      'Agents SDK now emphasizes skills, messengers, scheduled tasks, Workflows, and durable chat recovery.',
      'Workers and Pages billing sidebars can show current usage and budget alerts for several developer products.',
    ],
    planningImplications: [
      'Keep Cloudflare AI routing explicit with account id, gateway id, and provider model ids.',
      'Plan durable agent steps separately from normal request handlers when work needs recovery or scheduling.',
      'Track spend and budget-alert setup as a delivery task when Cloudflare is selected.',
    ],
    riskNotes: [
      'The current Open Design daemon is Express/SQLite; a Cloudflare-only production runtime still needs either a Workers refactor or a separate Node daemon.',
    ],
  },
  {
    toolId: 'supabase-database',
    label: 'Supabase Database and Auth',
    sourceUrl: 'https://supabase.com/changelog',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Supabase Auth passkeys are in beta.',
      'Self-hosted Supabase is moving its default Postgres image from 15 to 17 in June 2026.',
      'Recent developer updates include dashboard, branching, SDK, database, auth, PostgREST, and breaking-change notes.',
    ],
    planningImplications: [
      'Choose Supabase Auth versus Better Auth before scaffold execution.',
      'For self-hosted Supabase or Coolify Postgres, pin database versions and plan PG 17 compatibility.',
      'Put RLS testing and access-policy review inside the database lane before deployment.',
    ],
    riskNotes: [
      'Do not store workflow payloads or provider webhooks in core product tables without retention limits.',
    ],
  },
  {
    toolId: 'composio',
    label: 'Composio.dev Integrations',
    sourceUrl: 'https://docs.composio.dev/docs/changelog/2026/02/01',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Sessions can be updated without recreating them.',
      'Connected account inputs can accept arrays per toolkit.',
      'MCP API key enforcement is enabled for new organizations and enforced for existing MCP URL requests.',
    ],
    planningImplications: [
      'Store toolkit slugs, session assumptions, and connected-account mapping in the integrations section.',
      'Prefer webhook triggers or custom auth when near-real-time polling is required.',
      'Add x-api-key handling to MCP URLs before exposing Composio-backed tools.',
    ],
    riskNotes: [
      'Composio-managed OAuth polling intervals and link-session behavior can affect workflow freshness.',
    ],
  },
  {
    toolId: 'trigger-dev',
    label: 'Trigger.dev Workflows',
    sourceUrl: 'https://trigger.dev/changelog/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'v4 introduces Run Engine 2 with warm starts, waitpoints, prioritized runs, queue management, lifecycle hooks, and OTEL exports.',
      'Recent releases add run replay detection, API key rotation grace, task-level TTL defaults, MCP tools, and Supabase/Vercel integration support.',
      'Input streams support bidirectional task communication.',
    ],
    planningImplications: [
      'Use Trigger.dev for long-running jobs, retries, schedules, approvals, and provider sync tasks.',
      'Model human approvals as waitpoints rather than ad hoc polling loops.',
      'Keep task observability and queue limits in the workflows lane.',
    ],
    riskNotes: [
      'Trigger.dev runtime support differs from this repo Node 24 target; generated projects need explicit runtime validation.',
    ],
  },
  {
    toolId: 'stripe',
    label: 'Stripe Payments and Billing',
    sourceUrl: 'https://docs.stripe.com/changelog',
    checkedAt: CHECKED_AT,
    capabilities: [
      'The 2026 Clover API line includes Billing, Checkout, Payment Records, Terminal, and Connect changes.',
      'Checkout and subscription API shapes can change across dated API versions.',
    ],
    planningImplications: [
      'Keep Stripe as a post-scaffold integration because Better-T-Stack does not map it as the native payments flag in this plan.',
      'Persist Stripe customer, subscription, price, and invoice ids in the database design instead of using emails as keys.',
      'Pin API version expectations and webhook event handling before accepting billing as complete.',
    ],
    riskNotes: [
      'Billing correctness depends on downstream reconciliation, failed-payment handling, and webhook idempotency.',
    ],
  },
  {
    toolId: 'github',
    label: 'GitHub Source Control',
    sourceUrl: 'https://github.blog/changelog/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'GitHub remains the canonical repo creation and issue target for this planner.',
      'GitHub Issues can act as the project-management fallback when Linear is deferred.',
    ],
    planningImplications: [
      'Gate repo creation behind an explicit confirmation and gh auth status.',
      'Generate issue drafts from accepted section outputs before opening implementation work.',
    ],
    riskNotes: [
      'Repo creation should never invent an owner; use gh-authenticated owner or a user-provided org.',
    ],
  },
];

export function registerPlanRoutes(app: Express, ctx: RegisterPlanRoutesDeps) {
  const { db } = ctx;
  const scaffoldRunner = ctx.scaffoldRunner ?? runScaffoldCommand;
  const repoRunner = ctx.repoRunner ?? runRepoCommand;
  const deployRunner = ctx.deployRunner ?? runDeployCommand;
  const projectManagementRunner = ctx.projectManagementRunner ?? runProjectManagementCommand;
  const scaffoldRoot = path.resolve(ctx.scaffoldRoot ?? path.join(process.cwd(), '.od', 'scaffolds'));

  app.get('/api/planning/tools', (_req, res) => {
    res.json({ tools: APPROVED_TOOLS });
  });

  app.get('/api/planning/capabilities', (_req, res) => {
    res.json({ capabilities: PROVIDER_CAPABILITIES });
  });

  app.post('/api/planning/capabilities/refresh', (_req, res) => {
    const checkedAt = new Date().toISOString().slice(0, 10);
    res.json({
      capabilities: PROVIDER_CAPABILITIES.map((snapshot) => ({ ...snapshot, checkedAt })),
      sourceUrls: SOURCE_URLS,
      refreshedAt: Date.now(),
    });
  });

  app.get('/api/plans', (_req, res) => {
    try {
      res.json({ plans: listPlans(db) });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  app.post('/api/plans', (req, res) => {
    try {
      const body = normalizeCreateBody(req.body || {});
      const now = Date.now();
      const plan = buildProjectPlan({
        id: `plan-${randomUUID()}`,
        name: body.name,
        intent: body.intent,
        selectedTools: body.selectedTools ?? [],
        stack: body.stack ?? {},
        sectionAnswers: body.sectionAnswers ?? {},
        repo: body.repo ?? {},
        delivery: body.delivery ?? [],
        createdAt: now,
        updatedAt: now,
      });
      const inserted = insertPlan(db, plan);
      res.status(201).json({ plan: inserted });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  app.get('/api/plans/:id', (req, res) => {
    try {
      const plan = getPlan(db, req.params.id);
      if (!plan) return res.status(404).json({ error: 'plan not found' });
      res.json({ plan });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  app.get('/api/plans/:id/ideation', (req, res) => {
    try {
      const plan = getPlan(db, req.params.id);
      if (!plan) return res.status(404).json({ error: 'plan not found' });
      res.json({ sessions: listPlanIdeationSessions(db, req.params.id) });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  app.get('/api/plans/:id/execution', (req, res) => {
    try {
      const plan = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!plan) return res.status(404).json({ error: 'plan not found' });
      res.json(buildExecutionResponse(plan));
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  app.get('/api/plans/:id/sections/:sectionId', (req, res) => {
    try {
      const plan = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!plan) return res.status(404).json({ error: 'plan not found' });
      const workflow = buildSectionWorkflow(plan, normalizeSectionId(req.params.sectionId));
      res.json({ plan, workflow });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  app.patch('/api/plans/:id/sections/:sectionId', (req, res) => {
    try {
      const existing = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!existing) return res.status(404).json({ error: 'plan not found' });
      const sectionId = normalizeSectionId(req.params.sectionId);
      const body = normalizeSectionUpdateBody(req.body || {});
      const sectionAnswers = mergeSectionAnswers(existing.sectionAnswers ?? {}, {
        [sectionId]: {
          sectionId,
          status: body.status ?? ((body.answers?.length ?? 0) > 0 ? 'answered' : 'drafting'),
          answers: body.answers ?? [],
          ...(typeof body.notes === 'string' && body.notes.trim() ? { notes: body.notes.trim() } : {}),
          updatedAt: Date.now(),
        },
      });
      const rebuilt = buildProjectPlan({
        ...existing,
        sectionAnswers,
        updatedAt: Date.now(),
      });
      const updated = updatePlan(db, req.params.id, rebuilt) as ProjectPlan | null;
      if (!updated) return res.status(404).json({ error: 'plan not found' });
      res.json({ plan: updated, workflow: buildSectionWorkflow(updated, sectionId) });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  app.post('/api/plans/:id/ideation', (req, res) => {
    try {
      const plan = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!plan) return res.status(404).json({ error: 'plan not found' });
      const body = normalizeIdeationBody(req.body || {});
      const session = buildIdeationSession(plan, body.prompt);
      const inserted = insertPlanIdeationSession(db, session);
      res.status(201).json({ session: inserted });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  app.post('/api/plans/:id/actions', (req, res) => {
    try {
      const existing = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!existing) return res.status(404).json({ error: 'plan not found' });
      const body = normalizeActionBody(req.body || {});
      const action = existing.executionActions.find((item) => item.id === body.actionId);
      if (!action) return res.status(404).json({ error: 'plan action not found' });
      if (action.requiresConfirmation && !body.confirmed) {
        return res.status(409).json({
          error: 'confirmation required',
          action,
          confirmation: 'Repeat with confirmed: true after reviewing the command, preconditions, and effects.',
        });
      }
      const nextActions = existing.executionActions.map((item) =>
        item.id === body.actionId
          ? { ...item, status: 'accepted' as const }
          : item,
      );
      const nextRepo = body.actionId === 'repo-create'
        ? { ...existing.repo, status: 'planned' as const }
        : existing.repo;
      const updated = updatePlan(db, req.params.id, {
        ...existing,
        executionActions: nextActions,
        repo: nextRepo,
        updatedAt: Date.now(),
      });
      res.json({ plan: updated, action: nextActions.find((item) => item.id === body.actionId) });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  app.post('/api/plans/:id/actions/:actionId/execute', async (req, res) => {
    try {
      const existing = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!existing) return res.status(404).json({ error: 'plan not found' });
      const body = normalizeActionExecutionBody(req.params.actionId, req.body || {});
      const action = existing.executionActions.find((item) => item.id === body.actionId);
      if (!action) return res.status(404).json({ error: 'plan action not found' });
      if (action.requiresConfirmation && !body.confirmed) {
        return res.status(409).json({
          error: 'confirmation required',
          action,
          confirmation: 'Repeat with confirmed: true after reviewing the command, preconditions, and effects.',
        });
      }
      const { planPatch, run, artifacts } = await executePlanningAction(existing, action, body, {
        scaffoldRoot,
        scaffoldRunner,
        repoRunner,
        deployRunner,
        projectManagementRunner,
      });
      const updated = updatePlan(db, req.params.id, {
        ...existing,
        ...planPatch,
        updatedAt: Date.now(),
      }) as ProjectPlan | null;
      if (!updated) return res.status(404).json({ error: 'plan not found' });
      res.status(run.status === 'blocked' ? 202 : 201).json({ plan: updated, run, artifacts });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  app.post('/api/plans/:id/sections/:sectionId/runs', (req, res) => {
    try {
      const existing = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!existing) return res.status(404).json({ error: 'plan not found' });
      const body = normalizeSectionRunBody(req.params.sectionId);
      const section = existing.workspaceSections.find((item) => item.id === body.sectionId);
      if (!section) return res.status(404).json({ error: 'plan section not found' });
      const { run, artifacts } = runPlanningSection(existing, section);
      const updated = updatePlan(db, req.params.id, {
        ...existing,
        executionRuns: [...(existing.executionRuns ?? []), run],
        executionArtifacts: [...(existing.executionArtifacts ?? []), ...artifacts],
        updatedAt: Date.now(),
      }) as ProjectPlan | null;
      if (!updated) return res.status(404).json({ error: 'plan not found' });
      res.status(201).json({ plan: updated, run, artifacts });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  app.post('/api/plans/:id/tools/:toolId/check', (req, res) => {
    try {
      const existing = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!existing) return res.status(404).json({ error: 'plan not found' });
      const body = normalizeToolCheckBody(req.params.toolId);
      const tool = APPROVED_TOOLS.find((item) => item.id === body.toolId);
      if (!tool) return res.status(404).json({ error: 'planning tool not found' });
      const { run, toolCheck, artifacts, selectedTools } = checkPlanningTool(existing, body.toolId);
      const updated = updatePlan(db, req.params.id, {
        ...existing,
        selectedTools,
        executionRuns: [...(existing.executionRuns ?? []), run],
        executionArtifacts: [...(existing.executionArtifacts ?? []), ...artifacts],
        toolChecks: [toolCheck, ...(existing.toolChecks ?? []).filter((item) => item.toolId !== body.toolId)],
        updatedAt: Date.now(),
      }) as ProjectPlan | null;
      if (!updated) return res.status(404).json({ error: 'plan not found' });
      res.status(201).json({ plan: updated, run, toolCheck, artifacts });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  app.patch('/api/plans/:id', (req, res) => {
    try {
      const existing = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!existing) return res.status(404).json({ error: 'plan not found' });
      const patch = normalizeUpdateBody(req.body || {});
      const stack = patch.stack ? { ...existing.stack, ...patch.stack } : existing.stack;
      const selectedTools = patch.selectedTools ?? (patch.stack ? [] : existing.selectedTools);
      const rebuilt = buildProjectPlan({
        ...existing,
        ...patch,
        intent: patch.intent ? { ...existing.intent, ...patch.intent } : existing.intent,
        repo: patch.repo ? { ...existing.repo, ...patch.repo } : existing.repo,
        stack,
        selectedTools,
        sectionAnswers: patch.sectionAnswers
          ? mergeSectionAnswers(existing.sectionAnswers ?? {}, patch.sectionAnswers)
          : existing.sectionAnswers,
        updatedAt: Date.now(),
      });
      const updated = updatePlan(db, req.params.id, rebuilt);
      res.json({ plan: updated });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  app.delete('/api/plans/:id', (req, res) => {
    try {
      const deleted = deletePlan(db, req.params.id);
      if (!deleted) return res.status(404).json({ error: 'plan not found' });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });
}

function buildSectionWorkflow(
  plan: ProjectPlan,
  sectionId: ProjectWorkspaceSection['id'],
): ProjectSectionWorkflow {
  const section = plan.workspaceSections.find((item) => item.id === sectionId);
  if (!section) throw new Error(`section not found: ${sectionId}`);
  const laneIds = new Set(section.relatedLaneIds);
  const toolIds = new Set(section.toolIds);
  const lanes = plan.agentLanes.filter((lane) => lane.sectionId === sectionId || laneIds.has(lane.id));
  return {
    section,
    ...(plan.sectionAnswers[sectionId] ? { answer: plan.sectionAnswers[sectionId] } : {}),
    questions: plan.ideationQuestions.filter((question) => laneIds.has(question.laneId)),
    lanes,
    actions: plan.executionActions.filter((action) => action.relatedSectionIds.includes(sectionId)),
    ...(sectionId === 'database' ? { databaseDesign: plan.databaseDesign } : {}),
    providerCapabilities: plan.providerCapabilities.filter((snapshot) => toolIds.has(snapshot.toolId)),
  };
}

function normalizeIdeationBody(body: Record<string, unknown>): CreateProjectIdeationRequest {
  return {
    prompt: cleanRequiredString(body.prompt, 'prompt'),
  };
}

function normalizeSectionUpdateBody(body: Record<string, unknown>): UpdateProjectSectionRequest {
  const answers = body.answers === undefined
    ? []
    : Array.isArray(body.answers)
      ? cleanStringArray(body.answers)
      : (() => {
        throw new Error('answers must be an array');
      })();
  const status = typeof body.status === 'string' && ['not_started', 'drafting', 'answered', 'blocked'].includes(body.status)
    ? body.status as UpdateProjectSectionRequest['status']
    : undefined;
  return {
    answers,
    ...(status ? { status } : {}),
    ...(typeof body.notes === 'string' ? { notes: body.notes.trim() } : {}),
  };
}

function normalizeActionBody(body: Record<string, unknown>): ExecuteProjectPlanActionRequest {
  const actionId = cleanRequiredString(body.actionId, 'actionId') as PlanningExecutionAction['id'];
  if (!['repo-create', 'scaffold', 'deploy-runtime', 'provider-research', 'project-management'].includes(actionId)) {
    throw new Error('actionId must be one of repo-create, scaffold, deploy-runtime, provider-research, or project-management');
  }
  return {
    actionId,
    confirmed: body.confirmed === true,
  };
}

function normalizeActionExecutionBody(
  actionIdParam: string,
  body: Record<string, unknown>,
): ExecuteProjectPlanActionRequest {
  const actionId = cleanRequiredString(actionIdParam, 'actionId') as PlanningExecutionAction['id'];
  if (!['repo-create', 'scaffold', 'deploy-runtime', 'provider-research', 'project-management'].includes(actionId)) {
    throw new Error('actionId must be one of repo-create, scaffold, deploy-runtime, provider-research, or project-management');
  }
  return {
    actionId,
    confirmed: body.confirmed === true,
    ...(typeof body.targetDir === 'string' && body.targetDir.trim() ? { targetDir: body.targetDir.trim() } : {}),
    ...(typeof body.deliveryTarget === 'string' && ['cloudflare', 'vercel', 'coolify', 'hostinger'].includes(body.deliveryTarget)
      ? { deliveryTarget: body.deliveryTarget as DeliveryPlan['target'] }
      : {}),
    ...(typeof body.projectManagementTarget === 'string' && ['github-issues', 'linear', 'google-docs'].includes(body.projectManagementTarget)
      ? { projectManagementTarget: body.projectManagementTarget as Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> }
      : {}),
  };
}

function normalizeSectionRunBody(sectionIdParam: string): RunProjectPlanSectionRequest {
  return { sectionId: normalizeSectionId(sectionIdParam) };
}

function normalizeToolCheckBody(toolIdParam: string): CheckProjectPlanToolRequest {
  const toolId = cleanRequiredString(toolIdParam, 'toolId') as CheckProjectPlanToolRequest['toolId'];
  if (!APPROVED_TOOLS.some((tool) => tool.id === toolId)) {
    throw new Error('toolId must be one of the approved planning tool ids');
  }
  return { toolId };
}

function buildExecutionResponse(plan: ProjectPlan) {
  return {
    plan,
    runs: plan.executionRuns ?? [],
    artifacts: plan.executionArtifacts ?? [],
    toolChecks: plan.toolChecks ?? [],
    scaffoldExecution: plan.scaffoldExecution ?? { status: 'not_started' as const },
  };
}

function normalizeCreateBody(body: Record<string, unknown>): CreateProjectPlanRequest {
  const name = cleanRequiredString(body.name, 'name');
  const intent = normalizeIntent(body.intent, false);
  return {
    name,
    intent,
    selectedTools: normalizeToolConnections(body.selectedTools),
    stack: normalizeStack(body.stack),
    sectionAnswers: normalizeSectionAnswers(body.sectionAnswers),
    repo: normalizeRepo(body.repo),
    delivery: normalizeDelivery(body.delivery),
  };
}

function normalizeUpdateBody(body: Record<string, unknown>): UpdateProjectPlanRequest {
  return {
    ...(body.name === undefined ? {} : { name: cleanRequiredString(body.name, 'name') }),
    ...(body.intent === undefined ? {} : { intent: normalizeIntent(body.intent, true) }),
    ...(body.selectedTools === undefined ? {} : { selectedTools: normalizeToolConnections(body.selectedTools) }),
    ...(body.stack === undefined ? {} : { stack: normalizeStack(body.stack) }),
    ...(body.sectionAnswers === undefined ? {} : { sectionAnswers: normalizeSectionAnswers(body.sectionAnswers) }),
    ...(body.repo === undefined ? {} : { repo: normalizeRepo(body.repo) }),
    ...(body.delivery === undefined ? {} : { delivery: normalizeDelivery(body.delivery) }),
  };
}

function normalizeSectionId(value: string): ProjectWorkspaceSection['id'] {
  if (['planning', 'design', 'database', 'integrations', 'ai', 'workflows', 'delivery'].includes(value)) {
    return value as ProjectWorkspaceSection['id'];
  }
  throw new Error('sectionId must be one of planning, design, database, integrations, ai, workflows, or delivery');
}

function buildProjectPlan(input: ProjectPlanBuildInput): ProjectPlan {
  const stack = withStackDefaults(input.stack ?? {});
  const selectedTools = input.selectedTools?.length ? input.selectedTools : defaultToolConnections(stack);
  const sectionAnswers = normalizeSectionAnswers(input.sectionAnswers ?? {});
  const repoPatch = input.repo ?? {};
  const { provider: _provider, status: repoStatus, ...repoRest } = repoPatch;
  return {
    id: input.id,
    name: input.name,
    intent: input.intent,
    selectedTools,
    stack,
    databaseDesign: buildDatabaseDesign(stack),
    agentLanes: buildAgentLanes(stack, selectedTools, sectionAnswers),
    ideationQuestions: buildIdeationQuestions(stack),
    workspaceSections: buildWorkspaceSections(stack, selectedTools),
    sectionAnswers,
    providerCapabilities: buildProviderCapabilities(selectedTools),
    runtimePlan: buildRuntimePlan(stack, selectedTools),
    executionActions: buildExecutionActions(input.name, stack, selectedTools, sectionAnswers, repoPatch),
    executionRuns: input.executionRuns ?? [],
    executionArtifacts: input.executionArtifacts ?? [],
    toolChecks: input.toolChecks ?? [],
    scaffoldExecution: input.scaffoldExecution ?? { status: 'not_started' },
    scaffold: buildScaffoldPlan(input.name, stack, selectedTools, sectionAnswers),
    repo: {
      ...repoRest,
      provider: 'github',
      status: repoStatus ?? 'planned',
    },
    delivery: input.delivery?.length ? input.delivery : defaultDelivery(stack),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function buildScaffoldPlan(
  name: string,
  stack: ProjectStackDecision,
  selectedTools: ProjectToolConnection[],
  sectionAnswers: ProjectSectionAnswers,
): ScaffoldPlan {
  const slug = slugify(name || 'new-project');
  const pm = stack.packageManager ?? 'pnpm';
  const runner = pm === 'bun' ? 'bun create' : pm === 'pnpm' ? 'pnpm create' : pm === 'yarn' ? 'yarn create' : 'npm create';
  const args = [
    `${runner} better-t-stack@latest ${slug}`,
    `--frontend ${stack.frontend ?? 'next'}`,
    `--backend ${stack.backend ?? 'hono'}`,
    `--runtime ${stack.runtime ?? 'workers'}`,
    `--database ${dbFlag(stack)}`,
    `--orm ${stack.orm ?? 'drizzle'}`,
    `--api ${stack.api ?? 'trpc'}`,
    `--auth ${stack.auth === 'better-auth' ? 'better-auth' : 'none'}`,
  ];
  const addons = stack.addons?.length ? stack.addons : defaultAddons(stack);
  if (addons.length > 0) args.push(`--addons ${addons.join(',')}`);
  const postScaffoldTasks = [
    'Initialize Git and create the GitHub repository with gh after scaffold validation.',
    'Store generated secrets and provider API keys in 1Password before writing local env files.',
    'Add Stripe manually because Better-T-Stack currently advertises Polar, not Stripe, as its native payments flag.',
    'Wire Cloudflare AI Gateway, Ollama Cloud, and OpenRouter as explicit model-provider config rather than hardcoded model calls.',
    'Wire Composio.dev as the integration/tool execution layer and keep toolkit slugs in config.',
    'Wire Trigger.dev for long-running workflows, scheduled jobs, retries, and provider sync tasks after env sources are settled.',
    'Wire Supermemory.ai as project memory only after API key availability is verified.',
    'Generate Linear/GitHub Issues/Google Docs planning artifacts from the accepted plan.',
  ];
  if (selectedTools.some((tool) => tool.toolId === 'coolify')) {
    postScaffoldTasks.push('For Coolify deploys, target the current v4 API: service creation uses POST /api/v1/services and MCP toggle calls use POST.');
  }
  if (selectedTools.some((tool) => tool.toolId === 'cloudflare-ai-gateway')) {
    postScaffoldTasks.push('Use the current Cloudflare AI Gateway REST API and route through a specific gateway with cf-aig-gateway-id when needed.');
  }
  for (const answer of Object.values(sectionAnswers)) {
    if (!answer || answer.answers.length === 0) continue;
    postScaffoldTasks.push(`Apply ${answer.sectionId} section decisions before execution: ${answer.answers.slice(0, 2).join('; ')}`);
  }
  return {
    engine: 'better-t-stack',
    command: args.join(' \\\n  '),
    postScaffoldTasks,
    docsSources: SOURCE_URLS,
  };
}

function buildProviderCapabilities(selectedTools: ProjectToolConnection[]): ProviderCapabilitySnapshot[] {
  const selected = new Set(selectedTools.map((tool) => tool.toolId));
  return PROVIDER_CAPABILITIES.filter((snapshot) =>
    selected.has(snapshot.toolId)
      || (snapshot.toolId === 'cloudflare-hosting' && (selected.has('cloudflare-ai-gateway') || selected.has('cloudflare-data') || selected.has('cloudflare-access')))
      || (snapshot.toolId === 'github' && selected.has('github-issues'))
      || (snapshot.toolId === 'supabase-database' && selected.has('supabase-auth')),
  );
}

function buildRuntimePlan(
  stack: ProjectStackDecision,
  selectedTools: ProjectToolConnection[],
): PlanningRuntimePlan {
  const selected = new Set(selectedTools.map((tool) => tool.toolId));
  if (selected.has('coolify') || selected.has('hostinger') || stack.runtime === 'node') {
    return {
      recommended: 'coolify-daemon',
      summary: 'Run the current Open Design web and daemon pair as a Node service behind Coolify, with Cloudflare DNS/Access in front when needed.',
      requiredEnv: ['OD_DATA_DIR', 'OD_WEB_PORT', 'OD_PORT', 'PUBLIC_ORIGIN', 'NEXT_PUBLIC_OD_API_BASE_URL'],
      deploySteps: [
        'Build the web package and daemon package with the pinned Node 24 and pnpm workspace.',
        'Run the daemon with persistent OD_DATA_DIR mounted to the Coolify volume.',
        'Expose the web service publicly and route /api/* to the daemon service.',
        'Protect private planning environments with Cloudflare Access before inviting collaborators.',
      ],
      verification: [
        'Create a plan through the deployed Planning page.',
        'Save a section answer, reload, and confirm it persists.',
        'Run od plan list against the deployed daemon URL.',
        'Record the live URL and API health proof in the delivery section.',
      ],
      caveats: [
        'Cloudflare Pages static hosting by itself cannot persist /api/plans because the daemon is Express/SQLite.',
        'Workers-only deployment requires a separate compatibility refactor for storage and API routes.',
      ],
    };
  }
  return {
    recommended: 'node-daemon',
    summary: 'Keep the current daemon-backed planner as a Node runtime and use Cloudflare Pages only as a static preview unless an API base URL points at a live daemon.',
    requiredEnv: ['NEXT_PUBLIC_OD_API_BASE_URL', 'OD_DATA_DIR'],
    deploySteps: [
      'Deploy the static web bundle with NEXT_PUBLIC_OD_API_BASE_URL set to the public daemon origin.',
      'Run the daemon as a persistent Node process with a durable SQLite data directory.',
      'Ensure CORS/proxy policy allows the deployed web origin to reach /api/plans.',
    ],
    verification: [
      'Fetch /api/health from the daemon origin.',
      'Create and reload a plan from the public Planning page.',
      'Verify od plan sections works against the same daemon URL.',
    ],
    caveats: [
      'The static Pages URL is only a UI shell until a daemon origin is configured.',
    ],
  };
}

function buildExecutionActions(
  name: string,
  stack: ProjectStackDecision,
  selectedTools: ProjectToolConnection[],
  sectionAnswers: ProjectSectionAnswers,
  repo: Partial<RepoPlan>,
): PlanningExecutionAction[] {
  const slug = slugify(repo.name ?? name ?? 'new-project');
  const owner = repo.owner ? String(repo.owner).trim() : '<github-owner-or-org>';
  const visibility = repo.visibility ?? 'private';
  const runtimePlan = buildRuntimePlan(stack, selectedTools);
  return [
    {
      id: 'provider-research',
      label: 'Review provider capability snapshots',
      status: 'ready',
      requiresConfirmation: false,
      preconditions: ['Provider capability snapshots are visible in the plan.'],
      effects: ['Confirms the selected tools were planned against dated provider notes.'],
      relatedSectionIds: ['planning', 'integrations', 'ai', 'workflows'],
    },
    {
      id: 'repo-create',
      label: 'Create GitHub repository',
      status: 'ready',
      requiresConfirmation: true,
      command: `gh repo create ${owner}/${slug} --${visibility} --source . --remote origin --push`,
      preconditions: [
        'gh is installed and authenticated for the intended owner.',
        'The scaffold has passed local validation.',
        'The repository owner is explicit; placeholders are not accepted.',
      ],
      effects: ['Creates the GitHub repository, adds the origin remote, and pushes the scaffold.'],
      relatedSectionIds: ['delivery'],
    },
    {
      id: 'scaffold',
      label: 'Run Better-T-Stack scaffold',
      status: 'ready',
      requiresConfirmation: true,
      command: buildScaffoldPlan(name, stack, selectedTools, sectionAnswers).command,
      preconditions: [
        'Target directory is empty or disposable.',
        'Section answers that affect stack, database, auth, and workflows are accepted.',
        'Secrets are identified but not written into the command.',
      ],
      effects: ['Creates the initial app skeleton from the approved Better-T-Stack command.'],
      relatedSectionIds: ['planning', 'database', 'ai', 'workflows', 'delivery'],
    },
    {
      id: 'deploy-runtime',
      label: 'Deploy daemon-backed runtime',
      status: runtimePlan.recommended === 'cloudflare-pages-static' ? 'blocked' : 'ready',
      requiresConfirmation: true,
      preconditions: runtimePlan.deploySteps,
      effects: runtimePlan.verification,
      relatedSectionIds: ['delivery', 'integrations'],
    },
    {
      id: 'project-management',
      label: 'Create project-management handoff',
      status: 'ready',
      requiresConfirmation: true,
      command: `gh issue create --repo ${owner}/${slug} --title "Implement accepted project plan" --body "<generated from plan sections>"`,
      preconditions: [
        'The repository owner and name are explicit.',
        'GitHub CLI is authenticated with issue write access when GitHub Issues is selected.',
        'Planning, database, integrations, workflows, and delivery sections have enough accepted detail to create useful work items.',
      ],
      effects: [
        'Creates implementation issues from the accepted plan when GitHub Issues is selected.',
        'Records blocked provider handoff notes when Linear or Google Docs is selected before their executor is connected.',
      ],
      relatedSectionIds: ['planning', 'database', 'integrations', 'ai', 'workflows', 'delivery'],
    },
  ];
}

async function executePlanningAction(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  body: ExecuteProjectPlanActionRequest,
  options: { scaffoldRoot: string; scaffoldRunner: ScaffoldCommandRunner; repoRunner: RepoCommandRunner; deployRunner: DeployCommandRunner; projectManagementRunner: ProjectManagementCommandRunner },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  if (action.id === 'scaffold' && body.targetDir) {
    return executeScaffoldAction(plan, action, body, options);
  }
  if (action.id === 'repo-create' && body.targetDir) {
    return executeRepoCreateAction(plan, action, body, options);
  }
  if (action.id === 'deploy-runtime' && body.targetDir) {
    return executeDeployRuntimeAction(plan, action, body, options);
  }
  if (action.id === 'project-management') {
    return executeProjectManagementAction(plan, action, body, options);
  }
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const artifact = buildActionArtifact(plan, action, runId, body);
  const isProviderResearch = action.id === 'provider-research';
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: action.id,
    status: isProviderResearch ? 'completed' : 'blocked',
    title: action.label,
    mode: isProviderResearch ? 'record-only' : 'dry-run',
    summary: isProviderResearch
      ? 'Provider capability snapshots were reviewed and recorded as execution evidence.'
      : 'External execution is gated. This run records the reviewed command, preconditions, and remaining provider write work.',
    ...(action.command ? { command: action.command } : {}),
    startedAt: now,
    completedAt: now,
    artifactIds: [artifact.id],
    evidence: isProviderResearch
      ? plan.providerCapabilities.map((snapshot) => `${snapshot.toolId} checked ${snapshot.checkedAt} from ${snapshot.sourceUrl}`)
      : [
        'External writes are not performed by this first execution foundation.',
        'The action remains accepted or blocked until a provider-specific executor records proof.',
      ],
  };
  const nextActionStatus: PlanningExecutionAction['status'] = isProviderResearch ? 'completed' : 'accepted';
  const executionActions = plan.executionActions.map((item) =>
    item.id === action.id ? { ...item, status: nextActionStatus } : item,
  );
  const scaffoldExecution: ScaffoldExecutionPlan = action.id === 'scaffold'
    ? {
      status: 'planned',
      ...(body.targetDir ? { targetDir: body.targetDir } : {}),
      lastRunId: run.id,
      ...(action.command ? { lastCommand: action.command } : {}),
      notes: [
        'Better-T-Stack command recorded. Real scaffold execution still needs the provider-specific executor.',
        ...action.preconditions,
      ],
      updatedAt: now,
    }
    : plan.scaffoldExecution ?? { status: 'not_started' };
  const repo = action.id === 'repo-create'
    ? { ...plan.repo, status: 'planned' as const }
    : plan.repo;
  const delivery = action.id === 'deploy-runtime'
    ? plan.delivery.map((item) => item.status === 'not_started' ? { ...item, status: 'planned' as const } : item)
    : plan.delivery;
  return {
    planPatch: {
      executionRuns: [...(plan.executionRuns ?? []), run],
      executionArtifacts: [...(plan.executionArtifacts ?? []), artifact],
      executionActions,
      scaffoldExecution,
      repo,
      delivery,
    },
    run,
    artifacts: [artifact],
  };
}

type ProjectManagementTarget = Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'>;

async function executeProjectManagementAction(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  body: ExecuteProjectPlanActionRequest,
  options: { scaffoldRoot: string; projectManagementRunner: ProjectManagementCommandRunner },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const target = resolveProjectManagementTarget(plan, body.projectManagementTarget as ProjectManagementTarget | undefined);
  const cwd = await resolveProjectManagementCwd(body.targetDir, options.scaffoldRoot);
  const unsupported = target !== 'github-issues';
  const repo = target === 'github-issues' ? `${cleanRepoSegment(plan.repo.owner, 'repo.owner')}/${cleanRepoSegment(plan.repo.name, 'repo.name')}` : '';
  const issueSpecs = buildProjectManagementIssueSpecs(plan);
  const results: Array<{ title: string; command?: string; result: ProjectManagementCommandResult }> = [];
  let status: PlanningExecutionRun['status'] = unsupported ? 'blocked' : 'completed';

  if (unsupported) {
    results.push({
      title: `${target} handoff`,
      result: {
        exitCode: 1,
        stdout: '',
        stderr: `${target} project-management execution is not implemented yet.`,
        durationMs: 0,
      },
    });
  } else {
    for (const issue of issueSpecs) {
      const invocation = buildGitHubIssueInvocation(repo, issue);
      try {
        const result = await options.projectManagementRunner({
          command: invocation.command,
          args: invocation.args,
          cwd,
          timeoutMs: 120_000,
        });
        if (result.exitCode !== 0) status = 'failed';
        results.push({
          title: issue.title,
          command: [invocation.command, ...invocation.args].join(' '),
          result,
        });
      } catch (err: any) {
        status = 'failed';
        results.push({
          title: issue.title,
          command: [invocation.command, ...invocation.args].join(' '),
          result: {
            exitCode: typeof err?.code === 'number' ? err.code : 1,
            stdout: typeof err?.stdout === 'string' ? err.stdout : '',
            stderr: typeof err?.stderr === 'string' ? err.stderr : String(err?.message ?? err),
            durationMs: 0,
          },
        });
      }
    }
  }

  const artifact = buildProjectManagementArtifact(plan, action, runId, target, cwd, issueSpecs, results, status);
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: 'project-management',
    status,
    title: `${action.label}: ${target}`,
    mode: unsupported ? 'dry-run' : 'external',
    summary: status === 'completed'
      ? `Created ${issueSpecs.length} GitHub issue handoff item(s) for ${plan.name}.`
      : unsupported
        ? `${target} handoff executor is not implemented yet; recorded the blocked provider target.`
        : 'GitHub issue handoff failed; inspect the attached artifact for stdout and stderr.',
    ...(results[0]?.command ? { command: results[0].command } : {}),
    startedAt: now,
    completedAt: Date.now(),
    artifactIds: [artifact.id],
    evidence: [
      `target: ${target}`,
      `cwd: ${cwd}`,
      `issueCount: ${issueSpecs.length}`,
      ...results.map((item) => `${item.title}: exit ${item.result.exitCode}`),
    ],
  };
  const executionActions = plan.executionActions.map((item) =>
    item.id === 'project-management'
      ? { ...item, status: status === 'completed' ? 'completed' as const : 'accepted' as const }
      : item,
  );
  return {
    planPatch: {
      executionRuns: [...(plan.executionRuns ?? []), run],
      executionArtifacts: [...(plan.executionArtifacts ?? []), artifact],
      executionActions,
      scaffoldExecution: plan.scaffoldExecution,
      repo: plan.repo,
      delivery: plan.delivery,
    },
    run,
    artifacts: [artifact],
  };
}

async function executeDeployRuntimeAction(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  body: ExecuteProjectPlanActionRequest,
  options: { scaffoldRoot: string; deployRunner: DeployCommandRunner },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const sourceDir = await resolveRepoSourceDir(body.targetDir ?? '', options.scaffoldRoot);
  const target = resolveDeliveryTarget(plan, body.deliveryTarget);
  const unsupported = target !== 'vercel';
  const invocation = unsupported ? null : buildDeployInvocation(target);
  let result: DeployCommandResult = {
    exitCode: unsupported ? 1 : 0,
    stdout: '',
    stderr: unsupported ? `${target} deployment execution is not implemented yet.` : '',
    durationMs: 0,
  };
  let status: PlanningExecutionRun['status'] = unsupported ? 'blocked' : 'completed';
  if (invocation) {
    try {
      result = await options.deployRunner({
        command: invocation.command,
        args: invocation.args,
        cwd: sourceDir,
        timeoutMs: 300_000,
      });
      if (result.exitCode !== 0) status = 'failed';
    } catch (err: any) {
      result = {
        exitCode: typeof err?.code === 'number' ? err.code : 1,
        stdout: typeof err?.stdout === 'string' ? err.stdout : '',
        stderr: typeof err?.stderr === 'string' ? err.stderr : String(err?.message ?? err),
        durationMs: 0,
      };
      status = 'failed';
    }
  }
  const previewUrl = status === 'completed' ? extractFirstUrl(result.stdout) : undefined;
  const artifact = buildDeployArtifact(plan, action, runId, sourceDir, target, invocation, result, status, previewUrl);
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: 'deploy-runtime',
    status,
    title: `${action.label}: ${target}`,
    mode: unsupported ? 'dry-run' : 'external',
    summary: status === 'completed'
      ? `${target} deployment completed${previewUrl ? ` at ${previewUrl}` : ''}.`
      : unsupported
        ? `${target} deployment executor is not implemented yet; recorded the blocked target and required source directory.`
        : `${target} deployment failed; inspect the attached artifact for stdout and stderr.`,
    ...(invocation ? { command: [invocation.command, ...invocation.args].join(' ') } : {}),
    startedAt: now,
    completedAt: Date.now(),
    artifactIds: [artifact.id],
    evidence: [
      `sourceDir: ${sourceDir}`,
      `deliveryTarget: ${target}`,
      `exitCode: ${result.exitCode}`,
      ...(previewUrl ? [`previewUrl: ${previewUrl}`] : []),
    ],
  };
  const delivery = plan.delivery.map((item) =>
    item.target === target
      ? {
        ...item,
        status: status === 'completed' ? 'deployed' as const : 'blocked' as const,
        notes: status === 'completed'
          ? `Deployment completed${previewUrl ? ` at ${previewUrl}` : ''}.`
          : result.stderr.slice(0, 500),
      }
      : item,
  );
  const executionActions = plan.executionActions.map((item) =>
    item.id === 'deploy-runtime'
      ? { ...item, status: delivery.some((deliveryItem) => deliveryItem.status === 'deployed') ? 'completed' as const : 'accepted' as const }
      : item,
  );
  return {
    planPatch: {
      executionRuns: [...(plan.executionRuns ?? []), run],
      executionArtifacts: [...(plan.executionArtifacts ?? []), artifact],
      executionActions,
      scaffoldExecution: plan.scaffoldExecution,
      repo: plan.repo,
      delivery,
    },
    run,
    artifacts: [artifact],
  };
}

async function executeRepoCreateAction(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  body: ExecuteProjectPlanActionRequest,
  options: { scaffoldRoot: string; repoRunner: RepoCommandRunner },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const sourceDir = await resolveRepoSourceDir(body.targetDir ?? '', options.scaffoldRoot);
  const invocation = buildRepoCreateInvocation(plan, sourceDir);
  let result: RepoCommandResult;
  let status: PlanningExecutionRun['status'] = 'completed';
  try {
    result = await options.repoRunner({
      command: invocation.command,
      args: invocation.args,
      cwd: sourceDir,
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0) status = 'failed';
  } catch (err: any) {
    result = {
      exitCode: typeof err?.code === 'number' ? err.code : 1,
      stdout: typeof err?.stdout === 'string' ? err.stdout : '',
      stderr: typeof err?.stderr === 'string' ? err.stderr : String(err?.message ?? err),
      durationMs: 0,
    };
    status = 'failed';
  }
  const artifact = buildRepoArtifact(plan, action, runId, sourceDir, invocation, result, status);
  const repoUrl = `https://github.com/${invocation.owner}/${invocation.name}`;
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: 'repo-create',
    status,
    title: action.label,
    mode: 'external',
    summary: status === 'completed'
      ? `GitHub repository created at ${repoUrl}.`
      : 'GitHub repository creation failed; inspect the attached artifact for stdout and stderr.',
    command: [invocation.command, ...invocation.args].join(' '),
    startedAt: now,
    completedAt: Date.now(),
    artifactIds: [artifact.id],
    evidence: [
      `sourceDir: ${sourceDir}`,
      `repo: ${invocation.owner}/${invocation.name}`,
      `visibility: ${invocation.visibility}`,
      `exitCode: ${result.exitCode}`,
    ],
  };
  const executionActions = plan.executionActions.map((item) =>
    item.id === 'repo-create'
      ? { ...item, status: status === 'completed' ? 'completed' as const : 'accepted' as const }
      : item,
  );
  const repo: RepoPlan = {
    ...plan.repo,
    owner: invocation.owner,
    name: invocation.name,
    visibility: invocation.visibility,
    status: status === 'completed' ? 'created' : 'blocked',
    ...(status === 'completed' ? { url: repoUrl } : {}),
  };
  return {
    planPatch: {
      executionRuns: [...(plan.executionRuns ?? []), run],
      executionArtifacts: [...(plan.executionArtifacts ?? []), artifact],
      executionActions,
      scaffoldExecution: plan.scaffoldExecution,
      repo,
      delivery: plan.delivery,
    },
    run,
    artifacts: [artifact],
  };
}

async function executeScaffoldAction(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  body: ExecuteProjectPlanActionRequest,
  options: { scaffoldRoot: string; scaffoldRunner: ScaffoldCommandRunner },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const target = await resolveScaffoldTarget(plan, body.targetDir ?? '', options.scaffoldRoot);
  const invocation = buildScaffoldInvocation(plan);
  let result: ScaffoldCommandResult;
  let status: PlanningExecutionRun['status'] = 'completed';
  try {
    result = await options.scaffoldRunner({
      command: invocation.command,
      args: invocation.args,
      cwd: target.parentDir,
      outputDir: target.outputDir,
      timeoutMs: 300_000,
    });
    if (result.exitCode !== 0) status = 'failed';
  } catch (err: any) {
    result = {
      exitCode: typeof err?.code === 'number' ? err.code : 1,
      stdout: typeof err?.stdout === 'string' ? err.stdout : '',
      stderr: typeof err?.stderr === 'string' ? err.stderr : String(err?.message ?? err),
      durationMs: 0,
    };
    status = 'failed';
  }
  const outputExists = await directoryExists(target.outputDir);
  if (status === 'completed' && !outputExists) status = 'failed';
  const artifact = buildScaffoldArtifact(plan, action, runId, target, invocation, result, status);
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: 'scaffold',
    status,
    title: action.label,
    mode: 'external',
    summary: status === 'completed'
      ? `Better-T-Stack scaffold created ${target.outputDir}.`
      : 'Better-T-Stack scaffold execution failed; inspect the attached artifact for stdout and stderr.',
    command: [invocation.command, ...invocation.args].join(' '),
    startedAt: now,
    completedAt: Date.now(),
    artifactIds: [artifact.id],
    evidence: [
      `cwd: ${target.parentDir}`,
      `outputDir: ${target.outputDir}`,
      `exitCode: ${result.exitCode}`,
      `outputDirExists: ${outputExists ? 'yes' : 'no'}`,
    ],
  };
  const executionActions = plan.executionActions.map((item) =>
    item.id === 'scaffold'
      ? { ...item, status: status === 'completed' ? 'completed' as const : 'accepted' as const }
      : item,
  );
  const scaffoldExecution: ScaffoldExecutionPlan = {
    status: status === 'completed' ? 'completed' : 'blocked',
    targetDir: target.parentDir,
    lastRunId: run.id,
    ...(run.command ? { lastCommand: run.command } : {}),
    notes: status === 'completed'
      ? [`Scaffold output created at ${target.outputDir}.`]
      : [`Scaffold command failed with exit code ${result.exitCode}.`, result.stderr.slice(0, 500)].filter(Boolean),
    updatedAt: Date.now(),
  };
  return {
    planPatch: {
      executionRuns: [...(plan.executionRuns ?? []), run],
      executionArtifacts: [...(plan.executionArtifacts ?? []), artifact],
      executionActions,
      scaffoldExecution,
      repo: plan.repo,
      delivery: plan.delivery,
    },
    run,
    artifacts: [artifact],
  };
}

function buildActionArtifact(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  runId: string,
  body: ExecuteProjectPlanActionRequest,
): PlanningExecutionArtifact {
  const now = Date.now();
  const content = [
    `Plan: ${plan.name}`,
    `Action: ${action.label}`,
    `Status: ${action.id === 'provider-research' ? 'completed' : 'external executor pending'}`,
    action.command ? `Command:\n${action.command}` : '',
    body.targetDir ? `Target directory: ${body.targetDir}` : '',
    '',
    'Preconditions:',
    ...action.preconditions.map((item) => `- ${item}`),
    '',
    'Expected effects:',
    ...action.effects.map((item) => `- ${item}`),
    '',
    action.id === 'provider-research'
      ? `Provider snapshots:\n${plan.providerCapabilities.map((snapshot) => `- ${snapshot.toolId}: checked ${snapshot.checkedAt} (${snapshot.sourceUrl})`).join('\n')}`
      : 'External writes were not performed in this run. Provider-specific execution must attach command output or live proof in a later run.',
  ].filter(Boolean).join('\n');
  return {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: action.id === 'provider-research'
      ? 'provider-research'
      : action.id === 'scaffold'
        ? 'scaffold-plan'
        : action.id === 'repo-create'
          ? 'repo-plan'
          : 'deployment-plan',
    title: `${action.label} execution note`,
    content,
    createdAt: now,
  };
}

function buildScaffoldInvocation(plan: ProjectPlan): { command: string; args: string[] } {
  const pm = plan.stack.packageManager ?? 'pnpm';
  const slug = slugify(plan.repo.name ?? plan.name ?? 'new-project');
  const args = [
    'create',
    'better-t-stack@latest',
    slug,
    '--frontend',
    plan.stack.frontend ?? 'next',
    '--backend',
    plan.stack.backend ?? 'hono',
    '--runtime',
    plan.stack.runtime ?? 'workers',
    '--database',
    dbFlag(plan.stack),
    '--orm',
    plan.stack.orm ?? 'drizzle',
    '--api',
    plan.stack.api ?? 'trpc',
    '--auth',
    plan.stack.auth === 'better-auth' ? 'better-auth' : 'none',
  ];
  const addons = plan.stack.addons?.length ? plan.stack.addons : defaultAddons(plan.stack);
  if (addons.length > 0) args.push('--addons', addons.join(','));
  return {
    command: pm,
    args,
  };
}

function buildRepoCreateInvocation(
  plan: ProjectPlan,
  sourceDir: string,
): { command: string; args: string[]; owner: string; name: string; visibility: NonNullable<RepoPlan['visibility']> } {
  const owner = cleanRepoSegment(plan.repo.owner, 'repo.owner');
  const name = cleanRepoSegment(plan.repo.name, 'repo.name');
  const visibility = plan.repo.visibility ?? 'private';
  return {
    command: 'gh',
    args: [
      'repo',
      'create',
      `${owner}/${name}`,
      `--${visibility}`,
      '--source',
      sourceDir,
      '--remote',
      'origin',
      '--push',
    ],
    owner,
    name,
    visibility,
  };
}

function resolveDeliveryTarget(plan: ProjectPlan, requested?: DeliveryPlan['target']): DeliveryPlan['target'] {
  const target = requested ?? plan.delivery[0]?.target;
  if (!target) throw new Error('deliveryTarget is required before deployment execution');
  if (!plan.delivery.some((item) => item.target === target)) {
    throw new Error(`deliveryTarget is not selected for this plan: ${target}`);
  }
  return target;
}

function buildDeployInvocation(target: DeliveryPlan['target']): { command: string; args: string[] } {
  if (target !== 'vercel') throw new Error(`${target} deployment execution is not implemented yet`);
  return {
    command: 'vercel',
    args: ['deploy', '--yes'],
  };
}

function resolveProjectManagementTarget(plan: ProjectPlan, requested?: ProjectManagementTarget): ProjectManagementTarget {
  const selected = new Set(plan.selectedTools.map((tool) => tool.toolId));
  const target = requested
    ?? (selected.has('github-issues')
      ? 'github-issues'
      : selected.has('linear')
        ? 'linear'
        : selected.has('google-docs')
          ? 'google-docs'
          : undefined);
  if (!target) throw new Error('projectManagementTarget is required before project-management execution');
  if (!selected.has(target)) {
    throw new Error(`projectManagementTarget is not selected for this plan: ${target}`);
  }
  return target;
}

async function resolveProjectManagementCwd(targetDir: string | undefined, scaffoldRoot: string): Promise<string> {
  if (targetDir?.trim()) return resolveRepoSourceDir(targetDir, scaffoldRoot);
  const root = path.resolve(scaffoldRoot);
  await fs.mkdir(root, { recursive: true });
  return root;
}

interface ProjectManagementIssueSpec {
  title: string;
  body: string;
  labels: string[];
}

function buildProjectManagementIssueSpecs(plan: ProjectPlan): ProjectManagementIssueSpec[] {
  const answeredSections = Object.values(plan.sectionAnswers ?? {})
    .filter((answer): answer is ProjectSectionAnswer => Boolean(answer));
  const answerLines = answeredSections.flatMap((answer) =>
    answer.answers.map((line) => `- ${answer.sectionId}: ${line}`),
  );
  const deliveryTargets = plan.delivery.map((item) => `${item.target}: ${item.status}`).join(', ') || 'No delivery targets selected.';
  return [
    {
      title: `Implement accepted plan: ${plan.name}`,
      labels: ['planning', 'implementation'],
      body: [
        `Purpose: ${plan.intent.purpose}`,
        plan.intent.audience ? `Audience: ${plan.intent.audience}` : '',
        '',
        'Accepted section answers:',
        ...(answerLines.length ? answerLines : ['- No section answers have been accepted yet.']),
        '',
        'Stack decision:',
        `- frontend: ${plan.stack.frontend ?? 'next'}`,
        `- backend: ${plan.stack.backend ?? 'hono'}`,
        `- runtime: ${plan.stack.runtime ?? 'workers'}`,
        `- database: ${plan.stack.database ?? 'supabase'}`,
        `- auth: ${plan.stack.auth ?? 'better-auth'}`,
        '',
        `Scaffold command: ${plan.scaffold.command}`,
      ].filter(Boolean).join('\n'),
    },
    {
      title: `Design database and migrations: ${plan.name}`,
      labels: ['database', 'planning'],
      body: [
        `Primary store: ${plan.databaseDesign.primaryStore}`,
        `Mode: ${plan.databaseDesign.mode}`,
        '',
        'Entities:',
        ...plan.databaseDesign.entities.map((item) => `- ${item}`),
        '',
        'Relationships:',
        ...plan.databaseDesign.relationships.map((item) => `- ${item}`),
        '',
        'Migration order:',
        ...plan.databaseDesign.migrations.map((item) => `- ${item}`),
        '',
        'Risk notes:',
        ...plan.databaseDesign.riskNotes.map((item) => `- ${item}`),
      ].join('\n'),
    },
    {
      title: `Wire integrations, workflows, and delivery: ${plan.name}`,
      labels: ['integrations', 'delivery'],
      body: [
        'Selected tools:',
        ...plan.selectedTools.map((tool) => `- ${tool.toolId}: ${tool.status}${tool.notes ? ` (${tool.notes})` : ''}`),
        '',
        `Delivery targets: ${deliveryTargets}`,
        '',
        'Runtime plan:',
        plan.runtimePlan.summary,
        '',
        'Verification:',
        ...plan.runtimePlan.verification.map((item) => `- ${item}`),
      ].join('\n'),
    },
  ];
}

function buildGitHubIssueInvocation(repo: string, issue: ProjectManagementIssueSpec): { command: string; args: string[] } {
  return {
    command: 'gh',
    args: [
      'issue',
      'create',
      '--repo',
      repo,
      '--title',
      issue.title,
      '--body',
      issue.body,
      '--label',
      issue.labels.join(','),
    ],
  };
}

async function resolveScaffoldTarget(
  plan: ProjectPlan,
  targetDir: string,
  scaffoldRoot: string,
): Promise<{ parentDir: string; outputDir: string }> {
  const root = path.resolve(scaffoldRoot);
  const parentDir = path.isAbsolute(targetDir)
    ? path.resolve(targetDir)
    : path.resolve(root, targetDir);
  assertPathInside(parentDir, root, 'targetDir must stay inside the configured scaffold root');
  await fs.mkdir(parentDir, { recursive: true });
  const outputDir = path.resolve(parentDir, slugify(plan.repo.name ?? plan.name ?? 'new-project'));
  assertPathInside(outputDir, root, 'scaffold output must stay inside the configured scaffold root');
  const entries = await fs.readdir(outputDir).catch((err: any) => {
    if (err?.code === 'ENOENT') return null;
    throw err;
  });
  if (entries && entries.length > 0) {
    throw new Error(`scaffold output directory is not empty: ${outputDir}`);
  }
  return { parentDir, outputDir };
}

async function resolveRepoSourceDir(targetDir: string, scaffoldRoot: string): Promise<string> {
  const root = path.resolve(scaffoldRoot);
  const sourceDir = path.isAbsolute(targetDir)
    ? path.resolve(targetDir)
    : path.resolve(root, targetDir);
  assertPathInside(sourceDir, root, 'targetDir must stay inside the configured scaffold root');
  const entries = await fs.readdir(sourceDir).catch((err: any) => {
    if (err?.code === 'ENOENT') throw new Error(`repo source directory does not exist: ${sourceDir}`);
    throw err;
  });
  if (entries.length === 0) {
    throw new Error(`repo source directory is empty: ${sourceDir}`);
  }
  return sourceDir;
}

function assertPathInside(candidate: string, root: string, message: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new Error(message);
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch (err: any) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

function buildScaffoldArtifact(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  runId: string,
  target: { parentDir: string; outputDir: string },
  invocation: { command: string; args: string[] },
  result: ScaffoldCommandResult,
  status: PlanningExecutionRun['status'],
): PlanningExecutionArtifact {
  return {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'scaffold-plan',
    title: `${action.label} execution log`,
    content: [
      `Plan: ${plan.name}`,
      `Status: ${status}`,
      `Command: ${[invocation.command, ...invocation.args].join(' ')}`,
      `Working directory: ${target.parentDir}`,
      `Output directory: ${target.outputDir}`,
      `Exit code: ${result.exitCode}`,
      `Duration ms: ${result.durationMs}`,
      '',
      'stdout:',
      result.stdout || '<empty>',
      '',
      'stderr:',
      result.stderr || '<empty>',
    ].join('\n'),
    createdAt: Date.now(),
  };
}

function buildRepoArtifact(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  runId: string,
  sourceDir: string,
  invocation: { command: string; args: string[]; owner: string; name: string; visibility: NonNullable<RepoPlan['visibility']> },
  result: RepoCommandResult,
  status: PlanningExecutionRun['status'],
): PlanningExecutionArtifact {
  return {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'repo-plan',
    title: `${action.label} execution log`,
    content: [
      `Plan: ${plan.name}`,
      `Status: ${status}`,
      `Repository: ${invocation.owner}/${invocation.name}`,
      `Visibility: ${invocation.visibility}`,
      `Command: ${[invocation.command, ...invocation.args].join(' ')}`,
      `Source directory: ${sourceDir}`,
      `Exit code: ${result.exitCode}`,
      `Duration ms: ${result.durationMs}`,
      '',
      'stdout:',
      result.stdout || '(empty)',
      '',
      'stderr:',
      result.stderr || '(empty)',
    ].join('\n'),
    createdAt: Date.now(),
  };
}

function buildDeployArtifact(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  runId: string,
  sourceDir: string,
  target: DeliveryPlan['target'],
  invocation: { command: string; args: string[] } | null,
  result: DeployCommandResult,
  status: PlanningExecutionRun['status'],
  previewUrl?: string,
): PlanningExecutionArtifact {
  return {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'deployment-plan',
    title: `${action.label} ${target} execution log`,
    content: [
      `Plan: ${plan.name}`,
      `Status: ${status}`,
      `Delivery target: ${target}`,
      invocation ? `Command: ${[invocation.command, ...invocation.args].join(' ')}` : 'Command: not available for this delivery target yet',
      `Source directory: ${sourceDir}`,
      previewUrl ? `Preview URL: ${previewUrl}` : '',
      `Exit code: ${result.exitCode}`,
      `Duration ms: ${result.durationMs}`,
      '',
      'stdout:',
      result.stdout || '(empty)',
      '',
      'stderr:',
      result.stderr || '(empty)',
    ].filter(Boolean).join('\n'),
    createdAt: Date.now(),
  };
}

function buildProjectManagementArtifact(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  runId: string,
  target: ProjectManagementTarget,
  cwd: string,
  issues: ProjectManagementIssueSpec[],
  results: Array<{ title: string; command?: string; result: ProjectManagementCommandResult }>,
  status: PlanningExecutionRun['status'],
): PlanningExecutionArtifact {
  return {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'project-management-plan',
    title: `${action.label} ${target} execution log`,
    content: [
      `Plan: ${plan.name}`,
      `Status: ${status}`,
      `Project-management target: ${target}`,
      `Working directory: ${cwd}`,
      '',
      'Issue drafts:',
      ...issues.flatMap((issue) => [
        `- ${issue.title}`,
        `  labels: ${issue.labels.join(', ')}`,
      ]),
      '',
      'Command results:',
      ...results.flatMap((item) => [
        `Issue: ${item.title}`,
        item.command ? `Command: ${item.command}` : 'Command: not available for this project-management target yet',
        `Exit code: ${item.result.exitCode}`,
        `Duration ms: ${item.result.durationMs}`,
        'stdout:',
        item.result.stdout || '(empty)',
        'stderr:',
        item.result.stderr || '(empty)',
        '',
      ]),
    ].join('\n'),
    createdAt: Date.now(),
  };
}

function extractFirstUrl(value: string): string | undefined {
  const match = value.match(/https?:\/\/[^\s)]+/);
  return match?.[0];
}

function cleanRepoSegment(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required before creating a GitHub repository`);
  }
  const cleaned = value.trim();
  if (cleaned.startsWith('<') || cleaned.endsWith('>')) {
    throw new Error(`${field} must be explicit and cannot be a placeholder`);
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(cleaned)) {
    throw new Error(`${field} may only contain letters, numbers, dots, underscores, and hyphens`);
  }
  return cleaned;
}

function runScaffoldCommand(request: ScaffoldCommandRequest): Promise<ScaffoldCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(request.command, request.args, {
      cwd: request.cwd,
      timeout: request.timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    }, (error: any, stdout, stderr) => {
      resolve({
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
        stderr: typeof stderr === 'string' ? stderr : String(stderr ?? error?.message ?? ''),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function runRepoCommand(request: RepoCommandRequest): Promise<RepoCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(request.command, request.args, {
      cwd: request.cwd,
      timeout: request.timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    }, (error: any, stdout, stderr) => {
      resolve({
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
        stderr: typeof stderr === 'string' ? stderr : String(stderr ?? error?.message ?? ''),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function runDeployCommand(request: DeployCommandRequest): Promise<DeployCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(request.command, request.args, {
      cwd: request.cwd,
      timeout: request.timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    }, (error: any, stdout, stderr) => {
      resolve({
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
        stderr: typeof stderr === 'string' ? stderr : String(stderr ?? error?.message ?? ''),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function runProjectManagementCommand(request: ProjectManagementCommandRequest): Promise<ProjectManagementCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(request.command, request.args, {
      cwd: request.cwd,
      timeout: request.timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    }, (error: any, stdout, stderr) => {
      resolve({
        exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
        stderr: typeof stderr === 'string' ? stderr : String(stderr ?? error?.message ?? ''),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function runPlanningSection(
  plan: ProjectPlan,
  section: ProjectWorkspaceSection,
): { run: PlanningExecutionRun; artifacts: PlanningExecutionArtifact[] } {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const laneIds = new Set(section.relatedLaneIds);
  const lanes = plan.agentLanes.filter((lane) => lane.sectionId === section.id || laneIds.has(lane.id));
  const questions = plan.ideationQuestions.filter((question) => laneIds.has(question.laneId));
  const answer = plan.sectionAnswers[section.id];
  const databaseDraft = section.id === 'database' ? buildDatabaseDraftArtifactContent(plan) : '';
  const artifact: PlanningExecutionArtifact = {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: section.id === 'database' ? 'database-draft' : 'section-output',
    title: `${section.label} section output draft`,
    content: [
      `Section: ${section.label}`,
      `Purpose: ${section.purpose}`,
      '',
      'Accepted answers:',
      ...(answer?.answers.length ? answer.answers.map((item) => `- ${item}`) : ['- No accepted answers yet.']),
      answer?.notes ? `Notes: ${answer.notes}` : '',
      '',
      'Agent lanes:',
      ...lanes.map((lane) => `- ${lane.label}: ${lane.outputs.join(', ')}`),
      '',
      'Pointed questions:',
      ...questions.map((question) => `- ${question.question}`),
      databaseDraft,
    ].filter(Boolean).join('\n'),
    createdAt: now,
  };
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'section-agent',
    sectionId: section.id,
    status: 'completed',
    title: `${section.label} planning agent run`,
    mode: 'record-only',
    summary: `Generated a durable ${section.label} section output draft from stored answers, lanes, and provider notes.`,
    startedAt: now,
    completedAt: now,
    artifactIds: [artifact.id],
    evidence: [
      `${lanes.length} lane(s) considered`,
      `${questions.length} pointed question(s) attached`,
      answer ? `section answer status: ${answer.status}` : 'no section answer stored yet',
    ],
  };
  return { run, artifacts: [artifact] };
}

function buildDatabaseDraftArtifactContent(plan: ProjectPlan): string {
  const db = plan.databaseDesign;
  const projectIdType = db.primaryStore === 'convex' ? 'Id<"projects">' : 'uuid';
  const timestampType = db.primaryStore === 'convex' ? 'number' : 'timestamptz';
  const providerColumnType = db.primaryStore === 'convex' ? 'string' : 'text';
  const rows = [
    {
      table: 'organizations',
      columns: [
        ['id', projectIdType],
        ['name', providerColumnType],
        ['created_at', timestampType],
      ],
      policy: 'Only organization members can read organization records.',
    },
    {
      table: 'organization_memberships',
      columns: [
        ['organization_id', projectIdType],
        ['user_id', projectIdType],
        ['role', providerColumnType],
        ['created_at', timestampType],
      ],
      policy: 'Only owners can manage memberships; members can read their own membership.',
    },
    {
      table: 'projects',
      columns: [
        ['id', projectIdType],
        ['organization_id', projectIdType],
        ['name', providerColumnType],
        ['purpose', providerColumnType],
        ['created_at', timestampType],
      ],
      policy: 'Project access is inherited from organization membership.',
    },
    {
      table: 'plans',
      columns: [
        ['id', projectIdType],
        ['project_id', projectIdType],
        ['status', providerColumnType],
        ['stack_json', db.primaryStore === 'convex' ? 'object' : 'jsonb'],
        ['updated_at', timestampType],
      ],
      policy: 'Members can read plans; editors can update accepted planning decisions.',
    },
    {
      table: 'workflow_runs',
      columns: [
        ['id', projectIdType],
        ['project_id', projectIdType],
        ['provider', providerColumnType],
        ['status', providerColumnType],
        ['external_run_id', providerColumnType],
        ['updated_at', timestampType],
      ],
      policy: 'Workflow run reads require project membership; writes require service-role or workflow executor identity.',
    },
    {
      table: 'integration_connections',
      columns: [
        ['id', projectIdType],
        ['project_id', projectIdType],
        ['provider', providerColumnType],
        ['account_ref', providerColumnType],
        ['status', providerColumnType],
        ['updated_at', timestampType],
      ],
      policy: 'Never store provider secrets here; store only account references and health status.',
    },
    {
      table: 'audit_events',
      columns: [
        ['id', projectIdType],
        ['project_id', projectIdType],
        ['actor_id', projectIdType],
        ['event_type', providerColumnType],
        ['payload', db.primaryStore === 'convex' ? 'object' : 'jsonb'],
        ['created_at', timestampType],
      ],
      policy: 'Append-only service writes; project members can read scoped audit history.',
    },
  ];
  return [
    '',
    'Database draft:',
    `Mode: ${db.mode}`,
    `Primary store: ${db.primaryStore}`,
    '',
    'Logical schema:',
    ...rows.map((row) => [
      `- ${row.table}`,
      ...row.columns.map(([name, type]) => `  - ${name}: ${type}`),
    ].join('\n')),
    '',
    'Relationships:',
    ...db.relationships.map((item) => `- ${item}`),
    '',
    'Access patterns:',
    ...db.accessPatterns.map((item) => `- ${item}`),
    '',
    'Migration order:',
    ...db.migrations.map((item, index) => `${index + 1}. ${item}`),
    `${db.migrations.length + 1}. create organizations, memberships, projects, plans, workflow_runs, integration_connections, and audit_events`,
    `${db.migrations.length + 2}. add indexes for project status, workflow status, integration provider, and audit created_at`,
    `${db.migrations.length + 3}. add provider webhook idempotency keys before enabling external workflow writes`,
    '',
    'Access policy draft:',
    ...rows.map((row) => `- ${row.table}: ${row.policy}`),
    '',
    'Provider-specific notes:',
    db.primaryStore === 'supabase'
      ? '- Supabase/Postgres path: generate SQL migrations with RLS enabled before exposing API routes.'
      : db.primaryStore === 'cloudflare-d1'
        ? '- Cloudflare D1 path: convert uuid/jsonb/timestamptz columns to D1-compatible text/json/integer shapes and enforce authorization in API handlers.'
        : db.primaryStore === 'convex'
          ? '- Convex path: model this as Convex tables with function-level authorization and explicit indexes.'
          : db.primaryStore === 'postgres-coolify'
            ? '- Coolify Postgres path: run migrations against the managed service and keep backups/restore proof in delivery artifacts.'
            : '- No primary database selected; keep this as a logical model until a store is chosen.',
    '',
    'Risk notes:',
    ...db.riskNotes.map((item) => `- ${item}`),
  ].join('\n');
}

function checkPlanningTool(
  plan: ProjectPlan,
  toolId: PlanningToolCheck['toolId'],
): {
  run: PlanningExecutionRun;
  toolCheck: PlanningToolCheck;
  artifacts: PlanningExecutionArtifact[];
  selectedTools: ProjectToolConnection[];
} {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const snapshot = plan.providerCapabilities.find((item) => item.toolId === toolId);
  const tool = APPROVED_TOOLS.find((item) => item.id === toolId);
  const status: PlanningToolCheck['status'] = snapshot ? 'connected' : 'blocked';
  const evidence = snapshot
    ? [
      `Provider snapshot available: ${snapshot.sourceUrl}`,
      `Checked at ${snapshot.checkedAt}`,
      ...snapshot.planningImplications.slice(0, 2),
    ]
    : [
      'No provider snapshot is attached to this plan for the requested tool.',
      'Select the tool or refresh provider capabilities before relying on this provider.',
    ];
  const toolCheck: PlanningToolCheck = {
    id: `tool-check-${randomUUID()}`,
    planId: plan.id,
    toolId,
    status,
    summary: status === 'connected'
      ? `${tool?.label ?? toolId} has planning evidence attached to this plan.`
      : `${tool?.label ?? toolId} is not yet backed by plan-specific capability evidence.`,
    evidence,
    checkedAt: now,
  };
  const artifact: PlanningExecutionArtifact = {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'tool-check',
    title: `${tool?.label ?? toolId} tool check`,
    content: [`Tool: ${tool?.label ?? toolId}`, `Status: ${status}`, '', ...evidence.map((item) => `- ${item}`)].join('\n'),
    createdAt: now,
  };
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'tool-check',
    toolId,
    status: status === 'connected' ? 'completed' : 'blocked',
    title: `${tool?.label ?? toolId} tool check`,
    mode: 'record-only',
    summary: toolCheck.summary,
    startedAt: now,
    completedAt: now,
    artifactIds: [artifact.id],
    evidence,
  };
  const selectedTools = plan.selectedTools.map((item) =>
    item.toolId === toolId ? { ...item, status } : item,
  );
  return { run, toolCheck, artifacts: [artifact], selectedTools };
}

function buildIdeationSession(plan: ProjectPlan, prompt: string): ProjectIdeationSession {
  const options = buildIdeaOptions(plan, prompt);
  const summary = [
    `Explored ${options.length} directions for ${plan.name}.`,
    `Next questions to resolve: ${plan.ideationQuestions.slice(0, 3).map((question) => question.question).join(' ')}`,
    'Each direction keeps Better-T-Stack as the scaffold baseline and calls out the tools that need connection or follow-up wiring.',
  ].join(' ');
  return {
    id: `idea-${randomUUID()}`,
    planId: plan.id,
    prompt,
    summary,
    options,
    createdAt: Date.now(),
  };
}

function buildIdeaOptions(plan: ProjectPlan, prompt: string): ProjectIdeaOption[] {
  const baseStack = withStackDefaults(plan.stack);
  const promptText = prompt.toLowerCase();
  const wantsSelfHosted = promptText.includes('self-host') || promptText.includes('coolify') || promptText.includes('hostinger');
  const wantsRealtime = promptText.includes('realtime') || promptText.includes('reactive') || promptText.includes('collabor');
  const wantsEdge = promptText.includes('edge') || promptText.includes('cloudflare') || !wantsSelfHosted;
  const options: ProjectIdeaOption[] = [];

  if (wantsEdge) {
    options.push({
      title: 'Edge-first SaaS control plane',
      rationale: 'Optimizes for fast previews, Cloudflare runtime fit, managed Postgres, and a straightforward Better-T-Stack scaffold.',
      stack: {
        ...baseStack,
        frontend: 'next',
        backend: 'hono',
        runtime: 'workers',
        database: baseStack.database === 'convex' ? 'supabase' : baseStack.database ?? 'supabase',
        orm: 'drizzle',
        api: 'trpc',
        auth: baseStack.auth === 'none' ? 'better-auth' : baseStack.auth ?? 'better-auth',
        hosting: uniqueHosting([...(baseStack.hosting ?? []), 'cloudflare']),
      },
      toolIds: ['github', 'cloudflare-hosting', 'supabase-database', 'stripe', 'onepassword', 'cloudflare-ai-gateway', 'openrouter'],
      nextSteps: [
        'Answer the database ownership and workflow-duration questions before scaffolding.',
        'Accept the stack and review the generated Better-T-Stack command.',
        'Create the GitHub repo after gh auth is available.',
        'Wire 1Password-backed env files before deploying to Cloudflare.',
      ],
    });
  }

  if (wantsSelfHosted || options.length < 2) {
    options.push({
      title: 'Self-hosted operations workspace',
      rationale: 'Prioritizes Coolify/Hostinger ownership, self-hosted Postgres, and Cloudflare Access for private surfaces.',
      stack: {
        ...baseStack,
        frontend: 'next',
        backend: 'hono',
        runtime: 'node',
        database: 'postgres-coolify',
        orm: 'drizzle',
        api: 'trpc',
        auth: 'cloudflare-access',
        hosting: uniqueHosting(['coolify', 'hostinger']),
      },
      toolIds: ['github', 'coolify', 'hostinger', 'postgres-coolify', 'cloudflare-access', 'onepassword', 'composio', 'trigger-dev'],
      nextSteps: [
        'Decide which workflows belong in Trigger.dev versus Coolify cron or Cloudflare Workflows.',
        'Provision the Coolify app and Postgres service after scaffold validation.',
        'Put Cloudflare Access in front of admin routes.',
        'Track Hostinger DNS and VPS handoff separately from app deploy status.',
      ],
    });
  }

  if (wantsRealtime || options.length < 3) {
    options.push({
      title: 'Reactive collaboration cockpit',
      rationale: 'Uses Convex when the core workflow needs realtime project state, collaborative planning, or live activity streams.',
      stack: {
        ...baseStack,
        frontend: 'tanstack-start',
        backend: 'convex',
        runtime: 'node',
        database: 'convex',
        orm: 'none',
        api: 'none',
        auth: 'better-auth',
        hosting: uniqueHosting([...(baseStack.hosting ?? []), 'vercel']),
      },
      toolIds: ['github', 'convex', 'vercel', 'better-auth', 'trigger-dev', 'linear', 'github-issues', 'google-docs', 'supermemory'],
      nextSteps: [
        'Separate realtime product state from background workflow execution.',
        'Validate Better-T-Stack flags for the Convex/TanStack direction before scaffolding.',
        'Generate Linear and GitHub issue drafts from the accepted plan.',
        'Attach Supermemory only after the API key source is confirmed in 1Password.',
      ],
    });
  }

  return options.slice(0, 3);
}

function buildDatabaseDesign(stack: ProjectStackDecision): DatabaseDesignPlan {
  const primaryStore = stack.database ?? 'supabase';
  const mode: DatabaseDesignPlan['mode'] =
    primaryStore === 'convex'
      ? 'realtime'
      : primaryStore === 'cloudflare-d1'
        ? 'edge'
        : primaryStore === 'postgres-coolify'
          ? 'self-hosted'
          : primaryStore === 'none'
            ? 'hybrid'
            : 'transactional';
  return {
    mode,
    primaryStore,
    entities: [
      'users',
      'organizations',
      'projects',
      'plans',
      'tasks',
      'workflow_runs',
      'integration_connections',
      'audit_events',
    ],
    relationships: [
      'organizations own projects and invite users through membership records',
      'projects own plans, database designs, workflow runs, and delivery targets',
      'integration connections map provider accounts to projects without storing provider secrets in app tables',
    ],
    accessPatterns: [
      'fetch project dashboard by organization and latest plan status',
      'list workflow runs by project, status, and updated time',
      'load integration connection health by provider before agent execution',
      'append audit events for scaffold, repository, deployment, and secret handoff actions',
    ],
    migrations: [
      'create tenant tables before provider-specific tables',
      'add row-level ownership policies before exposing project data through APIs',
      'stage workflow run tables before enabling Trigger.dev or Cloudflare workflow execution',
    ],
    riskNotes: [
      primaryStore === 'cloudflare-d1'
        ? 'D1 is a strong edge fit, but design around SQLite limits and keep large logs in R2 or Postgres.'
        : 'Keep large workflow logs and provider payloads out of core transactional tables.',
      primaryStore === 'convex'
        ? 'Convex is a realtime product-state fit; long-running side effects still need a workflow runner such as Trigger.dev.'
        : 'Decide which records need realtime sync before adding realtime subscriptions.',
    ],
  };
}

function buildAgentLanes(
  stack: ProjectStackDecision,
  selectedTools: ProjectToolConnection[],
  sectionAnswers: ProjectSectionAnswers,
): PlanningAgentLane[] {
  const toolIds = new Set(selectedTools.map((tool) => tool.toolId));
  const databaseTools = selectedTools
    .map((tool) => tool.toolId)
    .filter((toolId) => ['supabase-database', 'cloudflare-data', 'convex', 'postgres-coolify'].includes(toolId));
  const deliveryTools = selectedTools
    .map((tool) => tool.toolId)
    .filter((toolId) => ['cloudflare-hosting', 'vercel', 'coolify', 'hostinger'].includes(toolId));
  const answerSummary = (sectionId: keyof ProjectSectionAnswers) => {
    const answer = sectionAnswers[sectionId];
    if (!answer || answer.answers.length === 0) return '';
    return ` Current ${sectionId} answers: ${answer.answers.slice(0, 2).join('; ')}.`;
  };
  return [
    {
      id: 'product',
      label: 'Product brief agent',
      sectionId: 'planning',
      mode: 'sequential',
      status: 'ready',
      dependsOn: [],
      toolIds: ['linear', 'github-issues', 'google-docs'],
      brief: `Turn the purpose, audience, constraints, and success criteria into a concrete feature map and acceptance checklist.${answerSummary('planning')}`,
      outputs: ['feature map', 'success criteria', 'MVP boundary'],
      runbook: [
        'Read planning section answers and open decisions.',
        'Produce MVP workflow order and acceptance criteria.',
        'Create Linear, GitHub Issues, or Google Docs drafts when those tools are connected.',
      ],
      parallelWith: [],
    },
    {
      id: 'architecture',
      label: 'Stack architecture agent',
      sectionId: 'ai',
      mode: 'sequential',
      status: 'ready',
      dependsOn: ['product'],
      toolIds: ['github', 'codex', 'cloudflare-ai-gateway', 'openrouter'],
      brief: `Choose the frontend, backend, runtime, auth, and scaffold flags from the approved stack catalog.${answerSummary('ai')}`,
      outputs: ['stack decision', 'Better-T-Stack command', 'provider fit notes'],
      runbook: [
        'Compare accepted requirements against Better-T-Stack-supported flags.',
        'Keep unsupported provider work as post-scaffold tasks.',
        'Update the scaffold command and runtime plan from the stored stack.',
      ],
      parallelWith: [],
    },
    {
      id: 'database',
      label: 'Database design agent',
      sectionId: 'database',
      mode: 'parallel',
      status: databaseTools.length > 0 ? 'ready' : 'blocked',
      dependsOn: ['product'],
      toolIds: databaseTools,
      brief: `Design the data model for ${stack.database ?? 'the selected database'} including tenancy, access patterns, migrations, and realtime boundaries.${answerSummary('database')}`,
      outputs: ['entity map', 'relationship map', 'migration plan', 'RLS/access notes'],
      runbook: [
        'Convert section answers into entities, relationships, and access patterns.',
        'Separate core product records from workflow/provider payloads.',
        'Write migration and RLS review tasks before scaffold acceptance.',
      ],
      parallelWith: ['workflows', 'integrations'],
    },
    {
      id: 'workflows',
      label: 'Workflow automation agent',
      sectionId: 'workflows',
      mode: 'parallel',
      status: 'ready',
      dependsOn: ['product'],
      toolIds: toolIds.has('trigger-dev') ? ['trigger-dev'] : ['trigger-dev', 'cloudflare-hosting'],
      brief: `Separate short request/response actions from long-running workflows, retries, schedules, webhooks, and provider sync jobs.${answerSummary('workflows')}`,
      outputs: ['workflow inventory', 'Trigger.dev task map', 'retry and schedule policy'],
      runbook: [
        'Identify tasks that need retries, waits, schedules, or approvals.',
        'Map long-running jobs to Trigger.dev or Cloudflare Workflows.',
        'Record audit events and queue visibility requirements.',
      ],
      parallelWith: ['database', 'integrations'],
    },
    {
      id: 'integrations',
      label: 'Integration agent',
      sectionId: 'integrations',
      mode: 'parallel',
      status: 'ready',
      dependsOn: ['product'],
      toolIds: ['composio', 'onepassword', 'supermemory'],
      brief: `Map external tools, connected accounts, memory requirements, and secret sources before scaffold execution.${answerSummary('integrations')}`,
      outputs: ['integration matrix', 'secret checklist', 'memory policy'],
      runbook: [
        'Map each provider to workspace-level or per-user auth.',
        'Decide which secrets live in 1Password and which are runtime env.',
        'Confirm Composio sessions, webhook paths, and Supermemory availability.',
      ],
      parallelWith: ['database', 'workflows'],
    },
    {
      id: 'delivery',
      label: 'Delivery agent',
      sectionId: 'delivery',
      mode: 'sequential',
      status: deliveryTools.length > 0 ? 'ready' : 'blocked',
      dependsOn: ['architecture', 'database', 'workflows', 'integrations'],
      toolIds: deliveryTools,
      brief: `Create the repo, pick deploy targets, and verify preview/live URLs after the scaffold passes local checks.${answerSummary('delivery')}`,
      outputs: ['repo plan', 'deployment plan', 'verification checklist'],
      runbook: [
        'Confirm scaffold command and repo owner before execution.',
        'Run local validation before pushing the scaffold.',
        'Record deployed URLs and reload/persistence proof in delivery notes.',
      ],
      parallelWith: [],
    },
  ];
}

function buildIdeationQuestions(stack: ProjectStackDecision): IdeationQuestion[] {
  const database = stack.database ?? 'supabase';
  return [
    {
      id: 'feature-scope',
      laneId: 'product',
      question: 'Which three user workflows must work before this project is considered useful?',
      whyItMatters: 'The first workflows decide the scaffold shape, tables, routes, and provider setup order.',
      answerType: 'checklist',
    },
    {
      id: 'data-source-of-truth',
      laneId: 'database',
      question: `Should ${database} be the source of truth for product state, operational logs, or both?`,
      whyItMatters: 'This controls table design, retention, realtime subscriptions, and where workflow payloads live.',
      answerType: 'choice',
      options: ['product state only', 'workflow logs only', 'both', 'split storage by data type'],
    },
    {
      id: 'workflow-duration',
      laneId: 'workflows',
      question: 'Which actions can run longer than a single web request or need retries, schedules, or human approval?',
      whyItMatters: 'Those should be modeled as Trigger.dev or Cloudflare workflow tasks instead of normal API handlers.',
      answerType: 'checklist',
    },
    {
      id: 'cloudflare-fit',
      laneId: 'architecture',
      question: 'Which Cloudflare capabilities are required: Workers, Pages, D1, R2, Queues, Workflows, AI Gateway, Access, or Vectorize?',
      whyItMatters: 'Cloudflare feature fit decides runtime, data placement, auth boundary, and deployment topology.',
      answerType: 'checklist',
    },
    {
      id: 'integration-accounts',
      laneId: 'integrations',
      question: 'Which connected accounts should the app act through, and which need per-user versus workspace-level auth?',
      whyItMatters: 'Composio session reuse, account mapping, and webhook security depend on this decision.',
      answerType: 'freeform',
    },
    {
      id: 'secret-ownership',
      laneId: 'delivery',
      question: 'Which secrets are user-provided, project-provided, or environment-provided through 1Password?',
      whyItMatters: 'Secret ownership decides what can be committed, what belongs in env files, and what must be configured before deploy.',
      answerType: 'checklist',
    },
  ];
}

function buildWorkspaceSections(
  _stack: ProjectStackDecision,
  selectedTools: ProjectToolConnection[],
): ProjectWorkspaceSection[] {
  const selected = new Set(selectedTools.map((tool) => tool.toolId));
  const hasAny = (ids: ProjectWorkspaceSection['toolIds']) => ids.filter((id) => selected.has(id));
  return [
    {
      id: 'planning',
      label: 'Planning',
      purpose: 'Define what should be built, why it matters, what is in scope, and the order of work.',
      owns: ['purpose', 'audience', 'success criteria', 'MVP scope', 'sequencing', 'open decisions'],
      doesNotOwn: ['visual system details', 'schema implementation', 'provider credentials', 'deployment execution'],
      primaryQuestions: [
        'What problem is this project solving?',
        'Which workflows must work first?',
        'Which decisions block scaffold or deployment?',
      ],
      outputs: ['project brief', 'decision log', 'feature map', 'execution order'],
      relatedLaneIds: ['product', 'architecture'],
      toolIds: hasAny(['linear', 'github-issues', 'google-docs']),
    },
    {
      id: 'design',
      label: 'Design',
      purpose: 'Shape the user experience, information architecture, interface states, and product interaction model.',
      owns: ['user flows', 'screen inventory', 'navigation', 'interaction states', 'visual direction', 'accessibility expectations'],
      doesNotOwn: ['database source of truth', 'secret storage', 'provider auth scopes', 'deployment topology'],
      primaryQuestions: [
        'What does the user need to understand on the first screen?',
        'Which actions need review, confirmation, or undo?',
        'Which screens or states are required for the MVP?',
      ],
      outputs: ['flow map', 'screen list', 'state checklist', 'design acceptance criteria'],
      relatedLaneIds: ['product'],
      toolIds: hasAny(['google-docs', 'github-issues']),
    },
    {
      id: 'database',
      label: 'Database',
      purpose: 'Decide data ownership, schema shape, access patterns, realtime boundaries, migrations, and retention.',
      owns: ['entities', 'relationships', 'source of truth', 'query patterns', 'migrations', 'RLS/access policy', 'retention'],
      doesNotOwn: ['UI layout', 'business value proposition', 'provider account login flows', 'model selection'],
      primaryQuestions: [
        'What is the source of truth for product state?',
        'Which records need realtime sync?',
        'Where do workflow logs and provider payloads live?',
      ],
      outputs: ['entity map', 'relationship map', 'migration plan', 'access policy notes'],
      relatedLaneIds: ['database'],
      toolIds: hasAny(['supabase-database', 'cloudflare-data', 'convex', 'postgres-coolify']),
    },
    {
      id: 'integrations',
      label: 'Integrations',
      purpose: 'Map external tools, connected accounts, permissions, webhooks, and secret handoff.',
      owns: ['connected accounts', 'OAuth/auth configs', 'webhook contracts', 'tool routing', 'secret source mapping'],
      doesNotOwn: ['core schema ownership', 'screen-level visual choices', 'model-provider ranking', 'hosting target choice'],
      primaryQuestions: [
        'Which accounts should the app act through?',
        'Which tools are workspace-level versus per-user?',
        'Which webhooks or callbacks need verification?',
      ],
      outputs: ['integration matrix', 'permission checklist', 'webhook map', 'secret inventory'],
      relatedLaneIds: ['integrations'],
      toolIds: hasAny(['composio', 'onepassword', 'supermemory']),
    },
    {
      id: 'ai',
      label: 'AI',
      purpose: 'Choose model providers, routing, memory, agent runtime assumptions, and AI safety boundaries.',
      owns: ['model routing', 'agent runtime', 'memory policy', 'prompt context', 'fallbacks', 'AI observability'],
      doesNotOwn: ['payment plan design', 'database migration order', 'OAuth provider setup', 'static screen layout'],
      primaryQuestions: [
        'Which work should be handled by Codex versus app agents?',
        'Which provider should route each model class?',
        'What should be remembered, forgotten, or isolated per project?',
      ],
      outputs: ['provider routing plan', 'memory policy', 'agent runtime notes', 'evaluation checklist'],
      relatedLaneIds: ['architecture', 'integrations'],
      toolIds: hasAny(['codex', 'cloudflare-ai-gateway', 'ollama-cloud', 'openrouter', 'supermemory']),
    },
    {
      id: 'workflows',
      label: 'Workflows',
      purpose: 'Separate immediate app actions from long-running jobs, scheduled runs, retries, and approvals.',
      owns: ['background jobs', 'schedules', 'retries', 'queues', 'approval waits', 'workflow observability'],
      doesNotOwn: ['visual design', 'tenant data model except workflow tables', 'source-control policy', 'billing product strategy'],
      primaryQuestions: [
        'Which tasks can outlive a request?',
        'Which steps need retry, delay, or manual approval?',
        'Which workflow events need audit trails?',
      ],
      outputs: ['workflow inventory', 'Trigger.dev task map', 'queue/retry policy', 'audit event list'],
      relatedLaneIds: ['workflows'],
      toolIds: hasAny(['trigger-dev', 'cloudflare-hosting']),
    },
    {
      id: 'delivery',
      label: 'Delivery',
      purpose: 'Own repository creation, scaffold execution, deploy targets, environments, and verification evidence.',
      owns: ['GitHub repo', 'scaffold command', 'environment setup', 'deploy targets', 'preview URLs', 'verification checklist'],
      doesNotOwn: ['feature prioritization', 'visual design decisions', 'database entity naming except migration artifacts', 'model policy'],
      primaryQuestions: [
        'Where should the repo live?',
        'Which target gets the first deploy?',
        'What proof is required before the project is considered shipped?',
      ],
      outputs: ['repo URL', 'scaffold log', 'deployment plan', 'live proof'],
      relatedLaneIds: ['delivery'],
      toolIds: hasAny(['github', 'cloudflare-hosting', 'vercel', 'coolify', 'hostinger']),
    },
  ];
}

function uniqueHosting(values: Array<NonNullable<ProjectStackDecision['hosting']>[number]>): NonNullable<ProjectStackDecision['hosting']> {
  return Array.from(new Set(values));
}

function withStackDefaults(stack: ProjectStackDecision): ProjectStackDecision {
  const normalized: ProjectStackDecision = {
    frontend: stack.frontend ?? 'next',
    backend: stack.backend ?? (stack.database === 'convex' ? 'convex' : 'hono'),
    runtime: stack.runtime ?? 'workers',
    database: stack.database ?? 'supabase',
    orm: stack.orm ?? (stack.database === 'convex' ? 'none' : 'drizzle'),
    api: stack.api ?? (stack.database === 'convex' ? 'none' : 'trpc'),
    auth: stack.auth ?? 'better-auth',
    payments: stack.payments ?? 'stripe',
    hosting: stack.hosting?.length ? stack.hosting : ['cloudflare'],
    packageManager: stack.packageManager ?? 'pnpm',
  };
  if (stack.addons !== undefined) normalized.addons = stack.addons;
  return normalized;
}

function dbFlag(stack: ProjectStackDecision): string {
  if (stack.database === 'convex') return 'none';
  if (stack.database === 'postgres-coolify' || stack.database === 'supabase') return 'postgres';
  if (stack.database === 'cloudflare-d1') return 'sqlite';
  return 'none';
}

function defaultAddons(stack: ProjectStackDecision): string[] {
  const addons = ['turborepo', 'mcp', 'skills', 'ultracite'];
  if (stack.frontend === 'next') addons.push('fumadocs');
  return addons;
}

function defaultToolConnections(stack: ProjectStackDecision): ProjectToolConnection[] {
  const ids = new Set(['github', 'stripe', 'onepassword', 'codex', 'composio', 'supermemory', 'trigger-dev']);
  for (const host of stack.hosting ?? []) ids.add(host === 'cloudflare' ? 'cloudflare-hosting' : host);
  if (stack.database === 'supabase') ids.add('supabase-database');
  if (stack.database === 'convex') ids.add('convex');
  if (stack.database === 'postgres-coolify') ids.add('postgres-coolify');
  if (stack.database === 'cloudflare-d1') ids.add('cloudflare-data');
  if (stack.auth === 'better-auth') ids.add('better-auth');
  if (stack.auth === 'cloudflare-access') ids.add('cloudflare-access');
  if (stack.auth === 'supabase') ids.add('supabase-auth');
  ids.add('cloudflare-ai-gateway');
  ids.add('openrouter');
  ids.add('ollama-cloud');
  ids.add('linear');
  ids.add('github-issues');
  ids.add('google-docs');
  return Array.from(ids).map((toolId) => ({
    toolId: toolId as ProjectToolConnection['toolId'],
    status: 'wanted',
  }));
}

function defaultDelivery(stack: ProjectStackDecision): DeliveryPlan[] {
  return (stack.hosting ?? ['cloudflare']).map((target) => ({
    target,
    status: 'planned',
  }));
}

function normalizeIntent(value: unknown, partial: false): ProjectIntentBrief;
function normalizeIntent(value: unknown, partial: true): Partial<ProjectIntentBrief>;
function normalizeIntent(value: unknown, partial: boolean): ProjectIntentBrief | Partial<ProjectIntentBrief> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (partial) return {};
    throw new Error('intent must be an object');
  }
  const input = value as Record<string, unknown>;
  const purpose = partial && input.purpose === undefined
    ? undefined
    : cleanRequiredString(input.purpose, 'intent.purpose');
  const normalized: Partial<ProjectIntentBrief> = {
    ...(typeof input.audience === 'string' ? { audience: input.audience.trim() } : {}),
    ...(typeof input.problem === 'string' ? { problem: input.problem.trim() } : {}),
    ...(Array.isArray(input.successCriteria) ? { successCriteria: cleanStringArray(input.successCriteria) } : {}),
    ...(Array.isArray(input.constraints) ? { constraints: cleanStringArray(input.constraints) } : {}),
  };
  if (purpose !== undefined) normalized.purpose = purpose;
  if (!partial && !normalized.purpose) throw new Error('intent.purpose is required');
  return normalized as ProjectIntentBrief | Partial<ProjectIntentBrief>;
}

function normalizeStack(value: unknown): ProjectStackDecision {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('stack must be an object');
  }
  return value as ProjectStackDecision;
}

function normalizeToolConnections(value: unknown): ProjectToolConnection[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('selectedTools must be an array');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('selectedTools entries must be objects');
    }
    const row = item as Record<string, unknown>;
    return {
      toolId: cleanRequiredString(row.toolId, 'selectedTools.toolId') as ProjectToolConnection['toolId'],
      status: cleanRequiredString(row.status ?? 'wanted', 'selectedTools.status') as ProjectToolConnection['status'],
      ...(typeof row.notes === 'string' ? { notes: row.notes.trim() } : {}),
    };
  });
}

function normalizeSectionAnswers(value: unknown): ProjectSectionAnswers {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('sectionAnswers must be an object');
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(['planning', 'design', 'database', 'integrations', 'ai', 'workflows', 'delivery']);
  const output: ProjectSectionAnswers = {};
  for (const [sectionId, raw] of Object.entries(input)) {
    if (!allowed.has(sectionId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const answers = Array.isArray(row.answers) ? cleanStringArray(row.answers) : [];
    const status = typeof row.status === 'string' && ['not_started', 'drafting', 'answered', 'blocked'].includes(row.status)
      ? row.status as ProjectSectionAnswer['status']
      : answers.length > 0
        ? 'answered'
        : 'drafting';
    output[sectionId as keyof ProjectSectionAnswers] = {
      sectionId: sectionId as any,
      status,
      answers,
      ...(typeof row.notes === 'string' && row.notes.trim() ? { notes: row.notes.trim() } : {}),
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.now(),
    };
  }
  return output;
}

function mergeSectionAnswers(existing: ProjectSectionAnswers, patch: ProjectSectionAnswers): ProjectSectionAnswers {
  return normalizeSectionAnswers({
    ...existing,
    ...patch,
  });
}

function normalizeRepo(value: unknown): Partial<RepoPlan> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('repo must be an object');
  }
  return value as Partial<RepoPlan>;
}

function normalizeDelivery(value: unknown): DeliveryPlan[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('delivery must be an array');
  return value as DeliveryPlan[];
}

function cleanRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function cleanStringArray(values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean);
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'new-project';
}
