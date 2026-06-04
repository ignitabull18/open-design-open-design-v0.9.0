import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import type {
  CreateProjectIdeationRequest,
  CreateProjectPlanRequest,
  DatabaseDesignPlan,
  DeliveryPlan,
  IdeationQuestion,
  PlanningAgentLane,
  PlanningToolOption,
  ProjectIdeaOption,
  ProjectIdeationSession,
  ProjectIntentBrief,
  ProjectSectionAnswer,
  ProjectPlan,
  ProjectSectionAnswers,
  ProjectStackDecision,
  ProjectToolConnection,
  ProjectWorkspaceSection,
  RepoPlan,
  ScaffoldPlan,
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

export interface RegisterPlanRoutesDeps extends RouteDeps<'db'> {}

interface ProjectPlanBuildInput {
  id: string;
  name: string;
  intent: ProjectIntentBrief;
  selectedTools?: ProjectToolConnection[];
  stack?: ProjectStackDecision;
  sectionAnswers?: ProjectSectionAnswers;
  repo?: Partial<RepoPlan>;
  delivery?: DeliveryPlan[];
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

export function registerPlanRoutes(app: Express, ctx: RegisterPlanRoutesDeps) {
  const { db } = ctx;

  app.get('/api/planning/tools', (_req, res) => {
    res.json({ tools: APPROVED_TOOLS });
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

function normalizeIdeationBody(body: Record<string, unknown>): CreateProjectIdeationRequest {
  return {
    prompt: cleanRequiredString(body.prompt, 'prompt'),
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
      mode: 'sequential',
      status: 'ready',
      dependsOn: [],
      toolIds: ['linear', 'github-issues', 'google-docs'],
      brief: `Turn the purpose, audience, constraints, and success criteria into a concrete feature map and acceptance checklist.${answerSummary('planning')}`,
      outputs: ['feature map', 'success criteria', 'MVP boundary'],
    },
    {
      id: 'architecture',
      label: 'Stack architecture agent',
      mode: 'sequential',
      status: 'ready',
      dependsOn: ['product'],
      toolIds: ['github', 'codex', 'cloudflare-ai-gateway', 'openrouter'],
      brief: `Choose the frontend, backend, runtime, auth, and scaffold flags from the approved stack catalog.${answerSummary('ai')}`,
      outputs: ['stack decision', 'Better-T-Stack command', 'provider fit notes'],
    },
    {
      id: 'database',
      label: 'Database design agent',
      mode: 'parallel',
      status: databaseTools.length > 0 ? 'ready' : 'blocked',
      dependsOn: ['product'],
      toolIds: databaseTools,
      brief: `Design the data model for ${stack.database ?? 'the selected database'} including tenancy, access patterns, migrations, and realtime boundaries.${answerSummary('database')}`,
      outputs: ['entity map', 'relationship map', 'migration plan', 'RLS/access notes'],
    },
    {
      id: 'workflows',
      label: 'Workflow automation agent',
      mode: 'parallel',
      status: 'ready',
      dependsOn: ['product'],
      toolIds: toolIds.has('trigger-dev') ? ['trigger-dev'] : ['trigger-dev', 'cloudflare-hosting'],
      brief: `Separate short request/response actions from long-running workflows, retries, schedules, webhooks, and provider sync jobs.${answerSummary('workflows')}`,
      outputs: ['workflow inventory', 'Trigger.dev task map', 'retry and schedule policy'],
    },
    {
      id: 'integrations',
      label: 'Integration agent',
      mode: 'parallel',
      status: 'ready',
      dependsOn: ['product'],
      toolIds: ['composio', 'onepassword', 'supermemory'],
      brief: `Map external tools, connected accounts, memory requirements, and secret sources before scaffold execution.${answerSummary('integrations')}`,
      outputs: ['integration matrix', 'secret checklist', 'memory policy'],
    },
    {
      id: 'delivery',
      label: 'Delivery agent',
      mode: 'sequential',
      status: deliveryTools.length > 0 ? 'ready' : 'blocked',
      dependsOn: ['architecture', 'database', 'workflows', 'integrations'],
      toolIds: deliveryTools,
      brief: `Create the repo, pick deploy targets, and verify preview/live URLs after the scaffold passes local checks.${answerSummary('delivery')}`,
      outputs: ['repo plan', 'deployment plan', 'verification checklist'],
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
