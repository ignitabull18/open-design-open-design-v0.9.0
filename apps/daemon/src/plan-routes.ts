import type { Express } from 'express';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  CheckProjectPlanToolRequest,
  CreateProjectPlanArtifactRequest,
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
  ProjectPlanReadinessItem,
  ProjectPlanReadinessReport,
  ProjectPlanReadinessStatus,
  PlanningToolOption,
  PlanningToolCheck,
  PlanningToolId,
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
  RefreshProviderCapabilitySnapshotsRequest,
  RepoPlan,
  RunProjectPlanSectionRequest,
  RunProjectPlanSectionsRequest,
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
  env?: Record<string, string>;
}

interface DeployCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type DeployCommandRunner = (request: DeployCommandRequest) => Promise<DeployCommandResult>;

interface DeployCommandInvocation {
  command: string;
  args: string[];
  displayCommand: string;
  env?: Record<string, string>;
}

interface DeploymentHealthCheck {
  url: string;
  finalUrl?: string;
  statusCode?: number;
  ok: boolean;
  durationMs: number;
  error?: string;
}

type DeploymentHealthChecker = (url: string) => Promise<DeploymentHealthCheck>;

interface ToolCheckCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

interface ToolCheckCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type ToolCheckCommandRunner = (request: ToolCheckCommandRequest) => Promise<ToolCheckCommandResult>;

interface ProviderSourceFetch {
  url: string;
  statusCode?: number;
  ok: boolean;
  title?: string;
  excerpt?: string;
  error?: string;
  durationMs: number;
}

type ProviderSourceFetcher = (url: string) => Promise<ProviderSourceFetch>;

interface ProviderSetupCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}

interface ProviderSetupCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type ProviderSetupCommandRunner = (request: ProviderSetupCommandRequest) => Promise<ProviderSetupCommandResult>;

interface ProviderSetupCommandInvocation {
  toolId: PlanningToolId;
  command: string;
  args: string[];
  displayCommand: string;
  env?: Record<string, string>;
}

interface ProviderSetupCommandExecution {
  invocation: ProviderSetupCommandInvocation;
  result: ProviderSetupCommandResult;
}

interface ProjectManagementCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}

interface ProjectManagementCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type ProjectManagementCommandRunner = (request: ProjectManagementCommandRequest) => Promise<ProjectManagementCommandResult>;

interface ProjectManagementCommandInvocation {
  title: string;
  command: string;
  args: string[];
  displayCommand: string;
  env?: Record<string, string>;
}

interface DatabaseMigrationCommandRequest {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}

interface DatabaseMigrationCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type DatabaseMigrationCommandRunner = (request: DatabaseMigrationCommandRequest) => Promise<DatabaseMigrationCommandResult>;

interface DatabaseMigrationInvocation {
  command: string;
  args: string[];
  displayCommand: string;
  env?: Record<string, string>;
}

interface SectionAgentRunRequest {
  plan: ProjectPlan;
  section: ProjectWorkspaceSection;
  manifest: SpecialistAgentManifest;
  prompt: string;
  cwd: string;
  timeoutMs: number;
}

interface SectionAgentRunResult {
  status: Extract<PlanningExecutionRun['status'], 'completed' | 'blocked' | 'failed'>;
  summary: string;
  output: string;
  evidence: string[];
  durationMs: number;
  command?: string;
}

type SectionAgentRunner = (request: SectionAgentRunRequest) => Promise<SectionAgentRunResult>;

interface ProjectMaterializedWrite {
  relativePath: string;
  absolutePath: string;
  bytes: number;
}

export interface RegisterPlanRoutesDeps extends RouteDeps<'db'> {
  scaffoldRoot?: string;
  scaffoldRunner?: ScaffoldCommandRunner;
  repoRunner?: RepoCommandRunner;
  deployRunner?: DeployCommandRunner;
  deployHealthChecker?: DeploymentHealthChecker;
  toolCheckRunner?: ToolCheckCommandRunner;
  providerSourceFetcher?: ProviderSourceFetcher;
  providerSetupRunner?: ProviderSetupCommandRunner;
  projectManagementRunner?: ProjectManagementCommandRunner;
  databaseMigrationRunner?: DatabaseMigrationCommandRunner;
  sectionAgentRunner?: SectionAgentRunner;
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

const CHECKED_AT = '2026-06-05';

const PROVIDER_CAPABILITIES: ProviderCapabilitySnapshot[] = [
  {
    toolId: 'cloudflare-hosting',
    label: 'Cloudflare Hosting and Workers Runtime',
    sourceUrl: 'https://developers.cloudflare.com/workers/platform/changelog/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Workers supports framework deployments, service bindings, preview URLs, static assets, and Node.js compatibility surfaces.',
      'Workers changelog and docs expose product-specific runtime changes, compatibility flags, and deployment behavior.',
      'Workers and Pages billing sidebars can show current usage and budget alerts for several developer products.',
    ],
    planningImplications: [
      'Keep Cloudflare hosting separate from Cloudflare data, Access, Workflows, and AI Gateway setup.',
      'Choose Workers, Pages, or OpenNext before scaffold execution because deploy commands and bindings differ.',
      'Track spend and budget-alert setup as a delivery task when Cloudflare is selected.',
    ],
    riskNotes: [
      'The current Open Design daemon is Express/SQLite; a Cloudflare-only production runtime still needs either a Workers refactor or a separate Node daemon.',
    ],
  },
  {
    toolId: 'cloudflare-data',
    label: 'Cloudflare Data: D1, R2, KV, Queues, Durable Objects, Vectorize',
    sourceUrl: 'https://developers.cloudflare.com/changelog/product/d1/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Cloudflare data choices split across D1, R2, KV, Queues, Durable Objects, Hyperdrive, and Vectorize bindings.',
      'D1 uses SQLite-compatible migrations and account/database-specific wrangler commands.',
      'Workers bindings require explicit config before runtime code can access data resources.',
    ],
    planningImplications: [
      'Treat Cloudflare data as its own database lane instead of assuming hosting setup proves data setup.',
      'For D1, generate SQLite-compatible migrations and require a database name before applying migrations.',
      'For R2, Vectorize, Queues, or Durable Objects, write provider setup tasks even when no SQL migration exists.',
    ],
    riskNotes: [
      'D1, R2, Queues, and Vectorize have different limits, consistency models, and pricing surfaces; do not collapse them into one generic database status.',
    ],
  },
  {
    toolId: 'cloudflare-access',
    label: 'Cloudflare Access and Zero Trust',
    sourceUrl: 'https://developers.cloudflare.com/changelog/product/access/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Access supports app policies, service tokens, browser and non-browser auth flows, and Zero Trust admin controls.',
      'Recent Access changelog entries include managed OAuth for non-browser clients and granular API token permission changes.',
      'Access can protect private apps independently from app-level user identity providers.',
    ],
    planningImplications: [
      'Keep Access as an authentication gate, not as the product user/session database.',
      'Record team name, application audience, allowed identities, and service-token needs during provider setup.',
      'For internal tools or admin routes, decide whether Access protects the route before Better Auth or Supabase Auth loads.',
    ],
    riskNotes: [
      'Access policy proof is route-specific; a dashboard login does not prove every private route is protected.',
    ],
  },
  {
    toolId: 'vercel',
    label: 'Vercel Hosting and Preview Deploys',
    sourceUrl: 'https://vercel.com/changelog',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Vercel remains a Next.js-first preview and production deploy target.',
      'Project, team, and environment identity are required before automated deploys can be treated as connected.',
      'Vercel changelog is the source for platform behavior changes that affect routing, builds, functions, and framework support.',
    ],
    planningImplications: [
      'Keep Vercel env mapping separate for local, preview, and production.',
      'Prefer Vercel when Next.js fidelity matters more than Cloudflare edge-native bindings.',
      'Record preview URL and deployment status as execution evidence.',
    ],
    riskNotes: [
      'Vercel proof does not satisfy Cloudflare, Coolify, or Hostinger delivery targets selected in the same plan.',
    ],
  },
  {
    toolId: 'coolify',
    label: 'Coolify Self-Hosted Deployment',
    sourceUrl: 'https://coolify.io/changelog/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Coolify can own self-hosted app, worker, database, and service deployment resources.',
      'Coolify API/resource identity is required before deployment automation can run safely.',
      'Coolify changelog and releases are relevant for API behavior, service creation, and MCP controls.',
    ],
    planningImplications: [
      'Separate Coolify app deployment from Postgres-on-Coolify database ownership.',
      'Record Coolify URL, token, project UUID, and resource UUID in setup artifacts before deploy execution.',
      'Use Coolify when the project needs VPS/container control rather than managed serverless previews.',
    ],
    riskNotes: [
      'Coolify writes are environment-specific; a local generated command is not proof without API/resource output.',
    ],
  },
  {
    toolId: 'hostinger',
    label: 'Hostinger VPS and Managed Hosting',
    sourceUrl: 'https://developers.hostinger.com/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Hostinger exposes API surfaces for VPS and hosting account operations.',
      'Hostinger VPS deployments usually require explicit SSH host, user, port, deploy path, and post-deploy command decisions.',
      'Hostinger can be a parent VPS host for Coolify or a direct deployment target.',
    ],
    planningImplications: [
      'Decide whether Hostinger runs Coolify, direct Docker, or a static/app hosting workflow.',
      'Treat SSH proof, deploy path, and public URL as delivery evidence.',
      'Keep Hostinger infrastructure setup separate from Coolify resource setup.',
    ],
    riskNotes: [
      'Hostinger deployment is blocked until the target runtime and SSH/account access are explicit.',
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
    toolId: 'supabase-auth',
    label: 'Supabase Auth',
    sourceUrl: 'https://supabase.com/changelog',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Supabase Auth owns managed user sessions, providers, redirects, email settings, and auth-related SDK behavior.',
      'Recent Supabase updates include Auth, SDK, dashboard, database, and breaking-change notes.',
      'Supabase Auth can be selected independently from using Supabase Postgres as the primary database.',
    ],
    planningImplications: [
      'Choose Supabase Auth versus Better Auth before scaffold execution.',
      'Record redirect URLs for local, preview, and production before treating auth as connected.',
      'Keep service-role keys server-only and out of generated docs or client env files.',
    ],
    riskNotes: [
      'Auth provider setup proof is not the same as database migration proof.',
    ],
  },
  {
    toolId: 'convex',
    label: 'Convex Realtime Backend and Database',
    sourceUrl: 'https://ship.convex.dev/changelog',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Convex provides a reactive TypeScript backend with schema, functions, realtime state, and deployment-specific generated types.',
      'Convex plans need schema/function files instead of SQL migrations.',
      'Convex changelog is the source for runtime, deploy, and platform behavior changes.',
    ],
    planningImplications: [
      'Use Convex when collaborative/realtime product state is core to the workflow.',
      'Materialize convex/schema.ts and functions before running convex deploy.',
      'Keep long-running side effects in Trigger.dev or another workflow runner unless Convex functions are explicitly chosen for them.',
    ],
    riskNotes: [
      'Convex schema deployment requires project linkage and CLI/auth proof before production use.',
    ],
  },
  {
    toolId: 'postgres-coolify',
    label: 'Postgres on Coolify',
    sourceUrl: 'https://www.postgresql.org/docs/release/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Self-hosted Postgres uses SQL migrations, connection strings, backups, restore drills, and extension/version decisions.',
      'Coolify can host Postgres, but database readiness depends on the Postgres service and backup policy, not app deployment alone.',
      'Postgres release notes are relevant for version pinning and compatibility decisions.',
    ],
    planningImplications: [
      'Record DATABASE_URL source, backup policy, restore command, and extension requirements before migration execution.',
      'Keep Coolify service setup and Postgres migration proof as separate artifacts.',
      'Prefer RLS/access-policy review before exposing tenant data through generated APIs.',
    ],
    riskNotes: [
      'Self-hosted database ownership adds backup, restore, patching, and secret-rotation duties.',
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
    toolId: 'linear',
    label: 'Linear Project Management',
    sourceUrl: 'https://linear.app/changelog',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Linear owns teams, projects, issues, labels, status workflows, and product planning handoffs.',
      'Linear changelog is the source for issue/project workflow and agent-facing feature changes.',
      'Planning output can create implementation issues when team and project identity are explicit.',
    ],
    planningImplications: [
      'Record Linear team, project, labels, and handoff style before executing issue creation.',
      'Use Linear for product/project execution when GitHub Issues is too repo-local.',
      'Keep Google Docs or GitHub Issues as fallback surfaces when Linear write access is missing.',
    ],
    riskNotes: [
      'Linear writes should stay blocked until team/project ids and API scope are explicit.',
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
  {
    toolId: 'github-issues',
    label: 'GitHub Issues Project Management',
    sourceUrl: 'https://github.blog/changelog/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'GitHub Issues owns repo-native work items, labels, milestones, and project-board handoffs.',
      'Issue creation can run through gh after repo owner/name and auth scope are explicit.',
      'GitHub changelog is the source for repo, issue, workflow, and project behavior changes.',
    ],
    planningImplications: [
      'Use GitHub Issues as the default project-management fallback when Linear is deferred.',
      'Generate issue bodies from accepted planning, design, database, integrations, AI, workflows, and delivery sections.',
      'Keep repo creation and issue creation as separately confirmed actions.',
    ],
    riskNotes: [
      'Issue writes are blocked until the repo exists or repo identity is explicit.',
    ],
  },
  {
    toolId: 'google-docs',
    label: 'Google Docs Planning Handoffs',
    sourceUrl: 'https://developers.google.com/workspace/docs/release-notes',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Google Docs can store PRDs, specs, planning handoffs, and external collaboration documents.',
      'Docs writes depend on folder, auth scope, title, and sharing policy.',
      'Google Workspace release notes are the source for Docs API behavior and workspace platform changes.',
    ],
    planningImplications: [
      'Use Google Docs when the planning artifact must be shared outside the repo/project tracker.',
      'Record destination folder and sharing policy before document creation.',
      'Keep generated docs as handoffs, not as the source of truth for executable plan state.',
    ],
    riskNotes: [
      'Docs write proof requires the created document URL and sharing state, not just a local markdown draft.',
    ],
  },
  {
    toolId: 'codex',
    label: 'Codex Coding Runtime',
    sourceUrl: 'https://help.openai.com/en/articles/11428266-codex-changelog/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Codex can operate on local workspaces, run validation, and make code changes through approved tooling.',
      'Codex setup depends on workspace path, tool access, and repo-specific agent instructions.',
      'The Codex changelog is the source for runtime/product behavior changes.',
    ],
    planningImplications: [
      'Keep Codex as an execution/runtime provider, not as a substitute for stored plan state.',
      'Record workspace path, validation commands, and allowed external actions before autonomous execution.',
      'Every new capability still needs API/UI/CLI parity in this repo.',
    ],
    riskNotes: [
      'Codex execution proof must be command output, tests, artifacts, commits, or pushed branches, not intent.',
    ],
  },
  {
    toolId: 'cloudflare-ai-gateway',
    label: 'Cloudflare AI Gateway',
    sourceUrl: 'https://developers.cloudflare.com/ai-gateway/changelog/',
    checkedAt: CHECKED_AT,
    capabilities: [
      'AI Gateway supports provider routing, observability, caching, rate limiting, and OpenAI-compatible gateway endpoints.',
      'Recent AI Gateway changelog entries include unified billing, custom providers, model playground, and broader provider support.',
      'Gateway setup requires account id, gateway id, provider/model choices, and budget/logging decisions.',
    ],
    planningImplications: [
      'Keep AI Gateway routing explicit with account id, gateway id, provider, model, and fallback policy.',
      'Use Gateway when observability, spend controls, cache policy, or multi-provider routing matters.',
      'Treat Cloudflare AI Gateway setup separately from Cloudflare hosting and Workers deploy proof.',
    ],
    riskNotes: [
      'AI Gateway can route model calls but does not choose safe prompts, memory retention, or evaluation policy by itself.',
    ],
  },
  {
    toolId: 'ollama-cloud',
    label: 'Ollama Cloud',
    sourceUrl: 'https://registry.ollama.com/cloud',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Ollama Cloud provides hosted model access while retaining Ollama-oriented API/library workflows.',
      'Ollama setup needs base URL, model id, auth, and fallback behavior for local versus cloud model use.',
      'Ollama Cloud docs are the source for supported cloud behavior and API compatibility.',
    ],
    planningImplications: [
      'Use Ollama Cloud when hosted Ollama models are preferred over OpenRouter or direct provider APIs.',
      'Record model id, base URL, and local development fallback before agent runtime execution.',
      'Keep latency/cost validation in the AI section acceptance checklist.',
    ],
    riskNotes: [
      'Ollama Cloud assumptions can drift quickly; refresh provider evidence before hardcoding model behavior.',
    ],
  },
  {
    toolId: 'openrouter',
    label: 'OpenRouter Model Routing',
    sourceUrl: 'https://openrouter.ai/docs/changelog',
    checkedAt: CHECKED_AT,
    capabilities: [
      'OpenRouter provides model routing across many upstream model providers.',
      'OpenRouter setup needs API key, default model, fallback models, app attribution, and budget policy.',
      'OpenRouter changelog is the source for model/provider routing and API behavior changes.',
    ],
    planningImplications: [
      'Use OpenRouter when model fallback or broad provider access is more important than Cloudflare-native observability.',
      'Record default and fallback models before scaffold/runtime wiring.',
      'Keep spend policy and provider-specific model limitations visible in the AI section.',
    ],
    riskNotes: [
      'OpenRouter availability and model routing can vary by provider; check live model metadata before production use.',
    ],
  },
  {
    toolId: 'onepassword',
    label: '1Password Secrets and Developer Tools',
    sourceUrl: 'https://releases.1password.com/developers/',
    checkedAt: CHECKED_AT,
    capabilities: [
      '1Password Developer tools include CLI, SDKs, Connect, vault/item operations, and shell/plugin workflows.',
      'Developer release notes are the source for CLI, SDK, and Connect changes.',
      'Secrets setup can map generated env variable names to vault/item fields without committing values.',
    ],
    planningImplications: [
      'Use 1Password as the default source of truth for provider secrets.',
      'Generate env names and item-field mappings, but never write secret values into repository files.',
      'Run op-based checks before marking secret-backed provider setup connected.',
    ],
    riskNotes: [
      'A missing vault/item path blocks downstream provider setup even when the provider account itself exists.',
    ],
  },
  {
    toolId: 'supermemory',
    label: 'Supermemory.ai Memory',
    sourceUrl: 'https://supermemory.ai/docs/changelog/developer-platform',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Supermemory.ai can act as an external memory layer for project and agent context.',
      'Memory setup needs API key, project/account id, retention policy, and sensitive-data exclusions.',
      'Developer-platform changelog is the source for memory API and platform behavior changes.',
    ],
    planningImplications: [
      'Use memory only after deciding what project context may persist and what must be excluded.',
      'Write retention/deletion policy into AI acceptance criteria before agent workflows use memory.',
      'Keep memory provider health separate from model-provider health.',
    ],
    riskNotes: [
      'Memory can leak sensitive planning or customer context if retention and exclusion rules are vague.',
    ],
  },
  {
    toolId: 'better-auth',
    label: 'Better Auth',
    sourceUrl: 'https://better-auth.com/changelog',
    checkedAt: CHECKED_AT,
    capabilities: [
      'Better Auth is a TypeScript auth framework and a native Better-T-Stack auth option.',
      'Better Auth setup needs secret, base URL, adapter/session decisions, providers, and callback URLs.',
      'Better Auth changelog is the source for auth API, adapter, and provider behavior changes.',
    ],
    planningImplications: [
      'Choose Better Auth versus Supabase Auth or Cloudflare Access before scaffold execution.',
      'Align auth adapter with database/runtime choices before materializing database and provider setup docs.',
      'Record local, preview, and production callback URLs before treating auth as ready.',
    ],
    riskNotes: [
      'Auth changes affect database tables, screen states, route protection, and deployment envs at once.',
    ],
  },
];

export function registerPlanRoutes(app: Express, ctx: RegisterPlanRoutesDeps) {
  const { db } = ctx;
  const scaffoldRunner = ctx.scaffoldRunner ?? runScaffoldCommand;
  const repoRunner = ctx.repoRunner ?? runRepoCommand;
  const deployRunner = ctx.deployRunner ?? runDeployCommand;
  const deployHealthChecker = ctx.deployHealthChecker ?? runDeploymentHealthCheck;
  const toolCheckRunner = ctx.toolCheckRunner ?? runToolCheckCommand;
  const providerSourceFetcher = ctx.providerSourceFetcher ?? fetchProviderSource;
  const providerSetupRunner = ctx.providerSetupRunner ?? runProviderSetupCommand;
  const projectManagementRunner = ctx.projectManagementRunner ?? runProjectManagementCommand;
  const databaseMigrationRunner = ctx.databaseMigrationRunner ?? runDatabaseMigrationCommand;
  const sectionAgentRunner = ctx.sectionAgentRunner ?? buildEnvSectionAgentRunner();
  const scaffoldRoot = path.resolve(ctx.scaffoldRoot ?? path.join(process.cwd(), '.od', 'scaffolds'));

  app.get('/api/planning/tools', (_req, res) => {
    res.json({ tools: APPROVED_TOOLS });
  });

  app.get('/api/planning/capabilities', (_req, res) => {
    res.json({ capabilities: PROVIDER_CAPABILITIES });
  });

  app.post('/api/planning/capabilities/refresh', async (req, res) => {
    try {
      const body = normalizeCapabilityRefreshBody(req.body || {});
      const refreshed = await refreshProviderCapabilities({
        providerSourceFetcher,
      });
      const plansUpdated = body.persist ? persistRefreshedProviderCapabilities(db, refreshed.capabilities) : 0;
      res.json({
        ...refreshed,
        ...(body.persist ? { plansUpdated } : {}),
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
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

  app.get('/api/plans/:id/readiness', (req, res) => {
    try {
      const plan = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!plan) return res.status(404).json({ error: 'plan not found' });
      res.json({ plan, readiness: buildPlanReadinessReport(plan) });
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
        deployHealthChecker,
        providerSourceFetcher,
        providerSetupRunner,
        projectManagementRunner,
        databaseMigrationRunner,
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

  app.post('/api/plans/:id/sections/runs', async (req, res) => {
    try {
      const existing = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!existing) return res.status(404).json({ error: 'plan not found' });
      const body = normalizeSectionsRunBody(req.body || {});
      const selectedSections = selectSectionsForRun(existing, body);
      if (selectedSections.length === 0) {
        return res.status(400).json({ error: 'no matching plan sections to run' });
      }
      const { runs, artifacts } = await runPlanningSections(existing, selectedSections, body, {
        sectionAgentRunner,
        scaffoldRoot,
      });
      const updated = updatePlan(db, req.params.id, {
        ...existing,
        executionRuns: [...(existing.executionRuns ?? []), ...runs],
        executionArtifacts: [...(existing.executionArtifacts ?? []), ...artifacts],
        updatedAt: Date.now(),
      }) as ProjectPlan | null;
      if (!updated) return res.status(404).json({ error: 'plan not found' });
      res.status(201).json({
        plan: updated,
        runs,
        artifacts,
        toolChecks: updated.toolChecks ?? [],
        scaffoldExecution: updated.scaffoldExecution ?? { status: 'not_started' },
      });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });

  app.post('/api/plans/:id/sections/:sectionId/runs', async (req, res) => {
    try {
      const existing = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!existing) return res.status(404).json({ error: 'plan not found' });
      const body = normalizeSectionRunBody(req.params.sectionId);
      const section = existing.workspaceSections.find((item) => item.id === body.sectionId);
      if (!section) return res.status(404).json({ error: 'plan section not found' });
      const { run, artifacts } = await runPlanningSection(existing, section, {
        sectionAgentRunner,
        scaffoldRoot,
      });
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

  app.post('/api/plans/:id/tools/:toolId/check', async (req, res) => {
    try {
      const existing = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!existing) return res.status(404).json({ error: 'plan not found' });
      const body = normalizeToolCheckBody(req.params.toolId);
      const tool = APPROVED_TOOLS.find((item) => item.id === body.toolId);
      if (!tool) return res.status(404).json({ error: 'planning tool not found' });
      const { run, toolCheck, artifacts, selectedTools } = await checkPlanningTool(existing, body.toolId, {
        toolCheckRunner,
      });
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

  app.post('/api/plans/:id/artifacts', (req, res) => {
    try {
      const existing = getPlan(db, req.params.id) as ProjectPlan | null;
      if (!existing) return res.status(404).json({ error: 'plan not found' });
      const body = normalizeCreateArtifactBody(req.body || {});
      const artifact: PlanningExecutionArtifact = {
        id: `plan-artifact-${randomUUID()}`,
        planId: existing.id,
        kind: body.kind,
        title: body.title,
        content: body.content,
        createdAt: Date.now(),
      };
      const updated = updatePlan(db, req.params.id, {
        ...existing,
        executionArtifacts: [...(existing.executionArtifacts ?? []), artifact],
        updatedAt: Date.now(),
      }) as ProjectPlan | null;
      if (!updated) return res.status(404).json({ error: 'plan not found' });
      res.status(201).json({ plan: updated, artifact });
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
  if (!isPlanningExecutionActionId(actionId)) {
    throw new Error('actionId must be one of repo-create, scaffold, deploy-runtime, provider-research, provider-setup, project-management, database-materialize, database-migrate, or design-materialize');
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
  if (!isPlanningExecutionActionId(actionId)) {
    throw new Error('actionId must be one of repo-create, scaffold, deploy-runtime, provider-research, provider-setup, project-management, database-materialize, database-migrate, or design-materialize');
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
    validateProviders: body.validateProviders === true,
  };
}

function isPlanningExecutionActionId(value: string): value is PlanningExecutionAction['id'] {
  return ['repo-create', 'scaffold', 'deploy-runtime', 'provider-research', 'provider-setup', 'project-management', 'database-materialize', 'database-migrate', 'design-materialize'].includes(value);
}

function normalizeCreateArtifactBody(body: Record<string, unknown>): CreateProjectPlanArtifactRequest {
  const kind = cleanRequiredString(body.kind, 'kind') as PlanningExecutionArtifact['kind'];
  if (!isPlanningExecutionArtifactKind(kind)) {
    throw new Error('kind must be a known planning execution artifact kind');
  }
  return {
    kind,
    title: cleanRequiredString(body.title, 'title'),
    content: cleanRequiredString(body.content, 'content'),
  };
}

function isPlanningExecutionArtifactKind(value: string): value is PlanningExecutionArtifact['kind'] {
  return [
    'provider-research',
    'provider-setup',
    'section-output',
    'specialist-agent-manifest',
    'parallel-orchestration',
    'database-draft',
    'database-materialization',
    'database-migration',
    'design-materialization',
    'scaffold-plan',
    'repo-plan',
    'deployment-plan',
    'project-management-plan',
    'tool-check',
  ].includes(value);
}

function normalizeCapabilityRefreshBody(body: Record<string, unknown>): RefreshProviderCapabilitySnapshotsRequest {
  return { persist: body.persist === true };
}

function normalizeSectionRunBody(sectionIdParam: string): RunProjectPlanSectionRequest {
  return { sectionId: normalizeSectionId(sectionIdParam) };
}

function normalizeSectionsRunBody(body: Record<string, unknown>): RunProjectPlanSectionsRequest {
  const sectionIds = Array.isArray(body.sectionIds)
    ? body.sectionIds.map((item) => normalizeSectionId(String(item)))
    : undefined;
  return {
    ...(sectionIds ? { sectionIds: Array.from(new Set(sectionIds)) } : {}),
    onlyReady: body.onlyReady === true,
    mode: body.mode === 'sequential' ? 'sequential' : 'parallel',
  };
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

function buildPlanReadinessReport(plan: ProjectPlan): ProjectPlanReadinessReport {
  const coreItems: ProjectPlanReadinessItem[] = [
    ...buildSectionReadinessItems(plan),
    buildToolReadinessItem(plan),
    buildScaffoldReadinessItem(plan),
    buildRepoReadinessItem(plan),
    buildProviderSetupReadinessItem(plan),
    buildDatabaseReadinessItem(plan),
    buildDesignReadinessItem(plan),
    buildDeploymentReadinessItem(plan),
    buildProjectManagementReadinessItem(plan),
  ];
  const items = [...coreItems, buildLaunchPathReadinessItem(coreItems)];
  const completedCount = items.filter((item) => item.status === 'ready').length;
  const blockedCount = items.filter((item) => item.status === 'blocked').length;
  const inProgressCount = items.filter((item) => item.status === 'in_progress').length;
  const next = items.find((item) => item.status === 'blocked')
    ?? items.find((item) => item.status === 'in_progress')
    ?? items.find((item) => item.status === 'not_started');
  const overallStatus: ProjectPlanReadinessStatus = completedCount === items.length
    ? 'ready'
    : blockedCount > 0
      ? 'blocked'
      : inProgressCount > 0
        ? 'in_progress'
        : 'not_started';
  return {
    planId: plan.id,
    generatedAt: Date.now(),
    overallStatus,
    completedCount,
    totalCount: items.length,
    blockedCount,
    ...(next?.actionId ? { nextActionId: next.actionId } : {}),
    nextSummary: next ? `${next.label}: ${next.nextSteps[0] ?? next.summary}` : 'All readiness items are complete.',
    items,
  };
}

function buildLaunchPathReadinessItem(coreItems: ProjectPlanReadinessItem[]): ProjectPlanReadinessItem {
  const incomplete = coreItems.filter((item) => item.status !== 'ready');
  const blocked = incomplete.filter((item) => item.status === 'blocked');
  const inProgress = incomplete.filter((item) => item.status === 'in_progress');
  const completed = coreItems.length - incomplete.length;
  const status: ProjectPlanReadinessStatus = incomplete.length === 0
    ? 'ready'
    : blocked.length > 0
      ? 'blocked'
      : completed > 0 || inProgress.length > 0
        ? 'in_progress'
        : 'not_started';
  const next = blocked[0] ?? inProgress[0] ?? incomplete[0];
  return {
    id: 'launch:path-proof',
    label: 'Launch path proof',
    status,
    summary: status === 'ready'
      ? 'The full planning path has proof from decisions through delivery.'
      : status === 'blocked'
        ? 'The end-to-end planning path is blocked by one or more failed readiness gates.'
        : 'The end-to-end planning path still needs proof across the required gates.',
    evidence: [
      `ready: ${completed}/${coreItems.length}`,
      `blocked: ${blocked.map((item) => item.id).join(', ') || 'none'}`,
      `inProgress: ${inProgress.map((item) => item.id).join(', ') || 'none'}`,
      `notStarted: ${incomplete.filter((item) => item.status === 'not_started').map((item) => item.id).join(', ') || 'none'}`,
    ],
    nextSteps: status === 'ready'
      ? []
      : [
        next
          ? `${next.label}: ${next.nextSteps[0] ?? next.summary}`
          : 'Complete every planning, scaffold, provider, database, design, delivery, and handoff gate.',
      ],
  };
}

function buildSectionReadinessItems(plan: ProjectPlan): ProjectPlanReadinessItem[] {
  return plan.workspaceSections.map((section) => {
    const answer = plan.sectionAnswers[section.id];
    const run = findLatestRun(plan, (item) => item.kind === 'section-agent' && item.sectionId === section.id);
    const status: ProjectPlanReadinessStatus = answer?.status === 'answered'
      ? 'ready'
      : run?.status === 'completed'
        ? 'in_progress'
        : answer?.status === 'blocked' || run?.status === 'blocked' || run?.status === 'failed'
          ? 'blocked'
          : 'not_started';
    return {
      id: `section:${section.id}`,
      label: `${section.label} section`,
      sectionId: section.id,
      status,
      summary: status === 'ready'
        ? `${section.label} has accepted answers.`
        : status === 'in_progress'
          ? `${section.label} has agent output but still needs accepted answers.`
          : status === 'blocked'
            ? `${section.label} needs blocker resolution before implementation.`
            : `${section.label} has not been answered yet.`,
      evidence: [
        `answerStatus: ${answer?.status ?? 'not_started'}`,
        ...(run ? [`latestRun: ${run.status}`] : []),
      ],
      nextSteps: status === 'ready'
        ? []
        : [
          `Answer the ${section.label} section questions.`,
          `Run the ${section.label} section agent if the section needs a draft.`,
        ],
    };
  });
}

function buildToolReadinessItem(plan: ProjectPlan): ProjectPlanReadinessItem {
  const selected = plan.selectedTools ?? [];
  const blocked = selected.filter((tool) => tool.status === 'blocked');
  const connected = selected.filter((tool) => tool.status === 'connected');
  const checkedIds = new Set((plan.toolChecks ?? []).map((check) => check.toolId));
  const unchecked = selected.filter((tool) => !checkedIds.has(tool.toolId) && tool.status !== 'deferred');
  const status: ProjectPlanReadinessStatus = selected.length === 0
    ? 'blocked'
    : blocked.length > 0
      ? 'blocked'
      : unchecked.length > 0
        ? 'in_progress'
        : connected.length > 0 || selected.every((tool) => tool.status === 'deferred')
          ? 'ready'
          : 'not_started';
  return {
    id: 'tools:selected',
    label: 'Selected tool checks',
    status,
    summary: status === 'ready'
      ? 'Selected tools have provider check evidence or are explicitly deferred.'
      : status === 'blocked'
        ? 'One or more selected tools are blocked or no tools are selected.'
        : 'Selected tools still need live checks or explicit deferral.',
    evidence: [
      `selected: ${selected.map((tool) => `${tool.toolId}:${tool.status}`).join(', ') || 'none'}`,
      `checks: ${(plan.toolChecks ?? []).map((check) => `${check.toolId}:${check.status}`).join(', ') || 'none'}`,
    ],
    nextSteps: status === 'ready'
      ? []
      : unchecked.length > 0
        ? unchecked.slice(0, 4).map((tool) => `Run a provider check for ${tool.toolId}.`)
        : ['Select at least one source-control, hosting, database, auth, and runtime tool.'],
  };
}

function buildScaffoldReadinessItem(plan: ProjectPlan): ProjectPlanReadinessItem {
  const scaffold = plan.scaffoldExecution ?? { status: 'not_started' as const };
  const status: ProjectPlanReadinessStatus = scaffold.status === 'completed'
    ? 'ready'
    : scaffold.status === 'blocked'
      ? 'blocked'
      : scaffold.status === 'planned'
        ? 'in_progress'
        : 'not_started';
  return {
    id: 'action:scaffold',
    label: 'Better-T-Stack scaffold',
    actionId: 'scaffold',
    status,
    summary: status === 'ready'
      ? 'Scaffold execution completed and generated the project handoff files.'
      : status === 'blocked'
        ? 'Scaffold execution is blocked or failed.'
        : 'Scaffold command has not completed yet.',
    evidence: [
      `scaffoldStatus: ${scaffold.status}`,
      ...(scaffold.targetDir ? [`targetDir: ${scaffold.targetDir}`] : []),
      ...(scaffold.lastRunId ? [`lastRunId: ${scaffold.lastRunId}`] : []),
    ],
    nextSteps: status === 'ready'
      ? []
      : ['Execute the scaffold action with a reviewed target directory.'],
  };
}

function buildRepoReadinessItem(plan: ProjectPlan): ProjectPlanReadinessItem {
  const status: ProjectPlanReadinessStatus = plan.repo.status === 'created'
    ? 'ready'
    : plan.repo.status === 'blocked'
      ? 'blocked'
      : plan.repo.status === 'planned'
        ? 'in_progress'
        : 'not_started';
  return {
    id: 'action:repo-create',
    label: 'GitHub repository',
    actionId: 'repo-create',
    status,
    summary: status === 'ready'
      ? `GitHub repository is recorded${plan.repo.url ? ` at ${plan.repo.url}` : ''}.`
      : status === 'blocked'
        ? 'GitHub repository creation is blocked.'
        : 'GitHub repository has not been created yet.',
    evidence: [
      `repoStatus: ${plan.repo.status}`,
      ...(plan.repo.owner ? [`owner: ${plan.repo.owner}`] : []),
      ...(plan.repo.name ? [`name: ${plan.repo.name}`] : []),
      ...(plan.repo.url ? [`url: ${plan.repo.url}`] : []),
    ],
    nextSteps: status === 'ready'
      ? []
      : ['Set the GitHub owner/name and execute repo creation from the scaffolded source directory.'],
  };
}

function buildProviderSetupReadinessItem(plan: ProjectPlan): ProjectPlanReadinessItem {
  return buildArtifactBackedReadinessItem(plan, {
    id: 'action:provider-setup',
    label: 'Provider setup materialization',
    actionId: 'provider-setup',
    artifactKind: 'provider-setup',
    readySummary: 'Provider setup docs, checklist, manifest, and env example are materialized.',
    pendingSummary: 'Provider setup files have not been materialized into the scaffold.',
    nextSteps: ['Execute provider setup materialization after scaffold completion.'],
  });
}

function buildDatabaseReadinessItem(plan: ProjectPlan): ProjectPlanReadinessItem {
  const materialized = hasArtifactKind(plan, 'database-materialization');
  const migrated = hasArtifactKind(plan, 'database-migration')
    && findLatestRun(plan, (run) => run.actionId === 'database-migrate')?.status === 'completed';
  const actionId: PlanningExecutionAction['id'] = materialized ? 'database-migrate' : 'database-materialize';
  const status: ProjectPlanReadinessStatus = migrated
    ? 'ready'
    : materialized
      ? 'in_progress'
      : 'not_started';
  return {
    id: 'action:database',
    label: 'Database design and migration',
    actionId,
    status,
    summary: status === 'ready'
      ? 'Database migration execution has completed.'
      : status === 'in_progress'
        ? 'Database files are materialized; migration execution still needs proof.'
        : 'Database design has not been materialized into project files yet.',
    evidence: [
      `primaryStore: ${plan.databaseDesign.primaryStore}`,
      `materialized: ${materialized ? 'yes' : 'no'}`,
      `migrated: ${migrated ? 'yes' : 'no'}`,
    ],
    nextSteps: status === 'ready'
      ? []
      : materialized
        ? ['Execute database migration against the selected provider and record proof.']
        : ['Materialize database design files into the scaffolded source directory.'],
  };
}

function buildDesignReadinessItem(plan: ProjectPlan): ProjectPlanReadinessItem {
  return buildArtifactBackedReadinessItem(plan, {
    id: 'action:design-materialize',
    label: 'Design planning materialization',
    actionId: 'design-materialize',
    artifactKind: 'design-materialization',
    readySummary: 'Design plan, user flows, and design acceptance files are materialized.',
    pendingSummary: 'Design planning files have not been materialized into the scaffold.',
    nextSteps: ['Execute design materialization after the design section has enough accepted decisions.'],
  });
}

function buildDeploymentReadinessItem(plan: ProjectPlan): ProjectPlanReadinessItem {
  const deployed = plan.delivery.filter((delivery) => delivery.status === 'deployed');
  const blocked = plan.delivery.filter((delivery) => delivery.status === 'blocked');
  const status: ProjectPlanReadinessStatus = plan.delivery.length === 0
    ? 'blocked'
    : deployed.length === plan.delivery.length
      ? 'ready'
      : blocked.length > 0
        ? 'blocked'
        : deployed.length > 0
          ? 'in_progress'
          : 'not_started';
  return {
    id: 'action:deploy-runtime',
    label: 'Deployment proof',
    actionId: 'deploy-runtime',
    status,
    summary: status === 'ready'
      ? 'All selected delivery targets are deployed.'
      : status === 'blocked'
        ? 'One or more delivery targets are blocked, or no delivery target is selected.'
        : 'Deployment proof is not complete for the selected delivery targets.',
    evidence: [
      `delivery: ${plan.delivery.map((delivery) => `${delivery.target}:${delivery.status}`).join(', ') || 'none'}`,
    ],
    nextSteps: status === 'ready'
      ? []
      : ['Execute deployment for each selected target and record live URL or health-check proof.'],
  };
}

function buildProjectManagementReadinessItem(plan: ProjectPlan): ProjectPlanReadinessItem {
  return buildArtifactBackedReadinessItem(plan, {
    id: 'action:project-management',
    label: 'Project-management handoff',
    actionId: 'project-management',
    artifactKind: 'project-management-plan',
    readySummary: 'Project-management handoff artifact exists.',
    pendingSummary: 'Project-management issues or document handoff have not been created yet.',
    nextSteps: ['Execute project-management handoff for GitHub Issues, Linear, or Google Docs.'],
  });
}

function buildArtifactBackedReadinessItem(
  plan: ProjectPlan,
  input: {
    id: string;
    label: string;
    actionId: PlanningExecutionAction['id'];
    artifactKind: PlanningExecutionArtifact['kind'];
    readySummary: string;
    pendingSummary: string;
    nextSteps: string[];
  },
): ProjectPlanReadinessItem {
  const latestRun = findLatestRun(plan, (run) => run.actionId === input.actionId);
  const hasArtifact = hasArtifactKind(plan, input.artifactKind);
  const status: ProjectPlanReadinessStatus = hasArtifact && latestRun?.status !== 'failed' && latestRun?.status !== 'blocked'
    ? 'ready'
    : latestRun?.status === 'failed' || latestRun?.status === 'blocked'
      ? 'blocked'
      : latestRun?.status === 'running' || latestRun?.status === 'queued'
        ? 'in_progress'
        : 'not_started';
  return {
    id: input.id,
    label: input.label,
    actionId: input.actionId,
    status,
    summary: status === 'ready'
      ? input.readySummary
      : status === 'blocked'
        ? `${input.label} is blocked; inspect the latest execution artifact.`
        : input.pendingSummary,
    evidence: [
      `artifactKind: ${input.artifactKind}`,
      `artifactPresent: ${hasArtifact ? 'yes' : 'no'}`,
      ...(latestRun ? [`latestRun: ${latestRun.status}`] : []),
    ],
    nextSteps: status === 'ready' ? [] : input.nextSteps,
  };
}

function hasArtifactKind(plan: ProjectPlan, kind: PlanningExecutionArtifact['kind']): boolean {
  return (plan.executionArtifacts ?? []).some((artifact) => artifact.kind === kind);
}

function findLatestRun(
  plan: ProjectPlan,
  predicate: (run: PlanningExecutionRun) => boolean,
): PlanningExecutionRun | undefined {
  return [...(plan.executionRuns ?? [])].reverse().find(predicate);
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
  return buildProviderCapabilitiesFromCatalog(selectedTools, PROVIDER_CAPABILITIES);
}

function buildProviderCapabilitiesFromCatalog(
  selectedTools: ProjectToolConnection[],
  catalog: ProviderCapabilitySnapshot[],
): ProviderCapabilitySnapshot[] {
  const selected = new Set(selectedTools.map((tool) => tool.toolId));
  return catalog.filter((snapshot) => selected.has(snapshot.toolId));
}

function persistRefreshedProviderCapabilities(
  db: Parameters<typeof listPlans>[0],
  capabilities: ProviderCapabilitySnapshot[],
): number {
  let updated = 0;
  for (const plan of listPlans(db) as ProjectPlan[]) {
    const nextProviderCapabilities = buildProviderCapabilitiesFromCatalog(plan.selectedTools, capabilities);
    if (nextProviderCapabilities.length === 0) continue;
    const { run, artifact } = buildProviderCapabilityRefreshRun(plan, nextProviderCapabilities);
    const executionActions = plan.executionActions.map((action) =>
      action.id === 'provider-research' ? { ...action, status: 'completed' as const } : action,
    );
    const saved = updatePlan(db, plan.id, {
      ...plan,
      providerCapabilities: nextProviderCapabilities,
      executionRuns: [...(plan.executionRuns ?? []), run],
      executionArtifacts: [...(plan.executionArtifacts ?? []), artifact],
      executionActions,
      updatedAt: Date.now(),
    });
    if (saved) updated += 1;
  }
  return updated;
}

function buildProviderCapabilityRefreshRun(
  plan: ProjectPlan,
  capabilities: ProviderCapabilitySnapshot[],
): { run: PlanningExecutionRun; artifact: PlanningExecutionArtifact } {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const sourceUrls = Array.from(new Set(capabilities.map((snapshot) => snapshot.sourceUrl)));
  const evidence = capabilities.flatMap((snapshot) => [
    `${snapshot.toolId}: checked ${snapshot.checkedAt}`,
    ...(snapshot.refreshEvidence?.slice(0, 5).map((item) => `${snapshot.toolId}: ${item}`) ?? []),
  ]);
  const artifact: PlanningExecutionArtifact = {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'provider-research',
    title: 'Provider capability refresh evidence',
    content: [
      `Plan: ${plan.name}`,
      `Status: completed`,
      `Selected provider snapshots: ${capabilities.length}`,
      '',
      'Source URLs:',
      ...sourceUrls.map((url) => `- ${url}`),
      '',
      'Refresh evidence:',
      ...evidence.map((item) => `- ${item}`),
    ].join('\n'),
    createdAt: now,
  };
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: 'provider-research',
    status: 'completed',
    title: 'Refresh provider capability snapshots',
    mode: 'external',
    summary: `Refreshed ${capabilities.length} selected provider capability snapshot(s) from ${sourceUrls.length} source URL(s).`,
    startedAt: now,
    completedAt: now,
    artifactIds: [artifact.id],
    evidence: [
      `snapshots: ${capabilities.length}`,
      `sources: ${sourceUrls.length}`,
      ...capabilities.map((snapshot) => `${snapshot.toolId}: ${snapshot.checkedAt}`),
    ],
  };
  return { run, artifact };
}

async function refreshProviderCapabilities(
  options: { providerSourceFetcher: ProviderSourceFetcher },
): Promise<{
  capabilities: ProviderCapabilitySnapshot[];
  sourceUrls: string[];
  refreshedAt: number;
  refreshEvidence: string[];
}> {
  const refreshedAt = Date.now();
  const checkedAt = new Date(refreshedAt).toISOString().slice(0, 10);
  const urls = Array.from(new Set(PROVIDER_CAPABILITIES.map((snapshot) => snapshot.sourceUrl)));
  const fetches = await Promise.all(urls.map((url) => options.providerSourceFetcher(url)));
  const byUrl = new Map(fetches.map((item) => [item.url, item]));
  const capabilities = PROVIDER_CAPABILITIES.map((snapshot) => {
    const source = byUrl.get(snapshot.sourceUrl);
    const refreshEvidence = source
      ? [
        `Fetched ${source.url}`,
        `Status: ${source.statusCode ?? 'unknown'} (${source.ok ? 'ok' : 'blocked'})`,
        `Duration ms: ${source.durationMs}`,
        ...(source.title ? [`Title: ${source.title}`] : []),
        ...(source.excerpt ? [`Excerpt: ${source.excerpt}`] : []),
        ...(source.error ? [`Error: ${source.error}`] : []),
      ]
      : [`No live fetch result for ${snapshot.sourceUrl}`];
    return {
      ...snapshot,
      checkedAt,
      refreshEvidence,
    };
  });
  return {
    capabilities,
    sourceUrls: SOURCE_URLS,
    refreshedAt,
    refreshEvidence: fetches.map((item) =>
      `${item.ok ? 'ok' : 'blocked'} ${item.statusCode ?? 'unknown'} ${item.url}${item.title ? ` - ${item.title}` : ''}`,
    ),
  };
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
      id: 'provider-setup',
      label: 'Write provider setup files',
      status: selectedTools.length > 0 ? 'ready' : 'blocked',
      requiresConfirmation: true,
      preconditions: [
        'The scaffold source directory exists inside the configured scaffold root.',
        'Selected tools are reviewed and marked wanted, connected, deferred, or blocked.',
        'Provider capability snapshots are refreshed before treating setup assumptions as current.',
        'Secrets are stored in 1Password or the selected secret manager before local env files are populated.',
      ],
      effects: [
        'Writes docs/provider-setup.md with setup order, provider-specific requirements, and blockers.',
        'Writes docs/provider-checklist.md with verification steps grouped by tool category.',
        'Writes env/planning.providers.env.example with non-secret env variable names for selected providers.',
      ],
      relatedSectionIds: ['integrations', 'ai', 'workflows', 'delivery', 'planning'],
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
      id: 'database-materialize',
      label: 'Write database design files',
      status: 'ready',
      requiresConfirmation: true,
      preconditions: [
        'The scaffold source directory exists inside the configured scaffold root.',
        'Database section decisions are accepted or reviewed.',
        'The generated files are reviewed before applying migrations to a live provider.',
      ],
      effects: [
        'Writes docs/database-plan.md into the scaffolded project.',
        'Writes db/migrations/0001_planning_schema.sql for SQL-compatible stores.',
        'Writes db/README.md with provider-specific next steps.',
      ],
      relatedSectionIds: ['database', 'planning', 'delivery'],
    },
    {
      id: 'design-materialize',
      label: 'Write design planning files',
      status: 'ready',
      requiresConfirmation: true,
      preconditions: [
        'The scaffold source directory exists inside the configured scaffold root.',
        'Design section decisions, pointed questions, and user flows have been reviewed.',
        'Database and integration constraints that affect screen state are represented in the plan.',
      ],
      effects: [
        'Writes docs/design-plan.md with the design section brief, screens, states, and acceptance criteria.',
        'Writes docs/user-flows.md with ordered workflow paths across planning, database, integrations, AI, and delivery.',
        'Writes docs/design-acceptance.md with testable UI and workflow acceptance checks.',
      ],
      relatedSectionIds: ['design', 'planning', 'database', 'integrations', 'ai', 'workflows', 'delivery'],
    },
    {
      id: 'database-migrate',
      label: 'Apply database migrations',
      status: canExecuteDatabaseDeployment(stack.database ?? 'supabase') ? 'ready' : 'blocked',
      requiresConfirmation: true,
      command: buildDatabaseMigrationCommandPreview(stack),
      preconditions: [
        'The database design files or provider schema files have been materialized and reviewed.',
        'Provider CLI credentials are connected for the selected database.',
        'A backup, rollback, or redeploy path is documented before applying live database changes.',
      ],
      effects: [
        'Runs the generated migration or provider schema deployment against the selected database provider when provider identity is available.',
        'Records stdout, stderr, exit code, and provider-specific migration proof.',
        'Leaves unsupported non-SQL database plans blocked until provider-specific schema generation is implemented.',
      ],
      relatedSectionIds: ['database', 'delivery'],
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
        'Creates implementation issues from the accepted plan when GitHub Issues or Linear is selected.',
        'Creates a Google Docs-ready planning handoff document when Google Docs is selected.',
        'Records command output and blocked provider configuration when required credentials or CLIs are missing.',
      ],
      relatedSectionIds: ['planning', 'database', 'integrations', 'ai', 'workflows', 'delivery'],
    },
  ];
}

async function executePlanningAction(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  body: ExecuteProjectPlanActionRequest,
  options: { scaffoldRoot: string; scaffoldRunner: ScaffoldCommandRunner; repoRunner: RepoCommandRunner; deployRunner: DeployCommandRunner; deployHealthChecker: DeploymentHealthChecker; providerSourceFetcher: ProviderSourceFetcher; providerSetupRunner: ProviderSetupCommandRunner; projectManagementRunner: ProjectManagementCommandRunner; databaseMigrationRunner: DatabaseMigrationCommandRunner },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'> & Partial<Pick<ProjectPlan, 'providerCapabilities'>>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  if (action.id === 'provider-research') {
    return executeProviderResearchAction(plan, action, options);
  }
  if (action.id === 'scaffold' && body.targetDir) {
    return executeScaffoldAction(plan, action, body, options);
  }
  if (action.id === 'repo-create' && body.targetDir) {
    return executeRepoCreateAction(plan, action, body, options);
  }
  if (action.id === 'deploy-runtime' && body.targetDir) {
    return executeDeployRuntimeAction(plan, action, body, options);
  }
  if (action.id === 'database-materialize' && body.targetDir) {
    return executeDatabaseMaterializeAction(plan, action, body, options);
  }
  if (action.id === 'design-materialize' && body.targetDir) {
    return executeDesignMaterializeAction(plan, action, body, options);
  }
  if (action.id === 'provider-setup' && body.targetDir) {
    return executeProviderSetupAction(plan, action, body, options);
  }
  if (action.id === 'database-migrate' && body.targetDir) {
    return executeDatabaseMigrateAction(plan, action, body, options);
  }
  if (action.id === 'project-management') {
    return executeProjectManagementAction(plan, action, body, options);
  }
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const artifact = buildActionArtifact(plan, action, runId, body);
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: action.id,
    status: 'blocked',
    title: action.label,
    mode: 'dry-run',
    summary: 'External execution is gated. This run records the reviewed command, preconditions, and remaining provider write work.',
    ...(action.command ? { command: action.command } : {}),
    startedAt: now,
    completedAt: now,
    artifactIds: [artifact.id],
    evidence: [
      'External writes are not performed by this fallback execution path.',
      'The action remains accepted or blocked until a provider-specific executor records proof.',
    ],
  };
  const executionActions = plan.executionActions.map((item) =>
    item.id === action.id ? { ...item, status: 'accepted' as const } : item,
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

async function executeProviderResearchAction(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  options: { providerSourceFetcher: ProviderSourceFetcher },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'> & Partial<Pick<ProjectPlan, 'providerCapabilities'>>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  const refreshed = await refreshProviderCapabilities({
    providerSourceFetcher: options.providerSourceFetcher,
  });
  const providerCapabilities = buildProviderCapabilitiesFromCatalog(plan.selectedTools, refreshed.capabilities);
  const selectedCapabilities = providerCapabilities.length > 0 ? providerCapabilities : plan.providerCapabilities;
  const { run, artifact } = buildProviderCapabilityRefreshRun(plan, selectedCapabilities);
  const executionActions = plan.executionActions.map((item) =>
    item.id === action.id ? { ...item, status: 'completed' as const } : item,
  );
  return {
    planPatch: {
      providerCapabilities: selectedCapabilities,
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

type ProjectManagementTarget = Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'>;

async function executeDatabaseMigrateAction(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  body: ExecuteProjectPlanActionRequest,
  options: { scaffoldRoot: string; databaseMigrationRunner: DatabaseMigrationCommandRunner },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const sourceDir = await resolveRepoSourceDir(body.targetDir ?? '', options.scaffoldRoot);
  const invocation = buildDatabaseMigrationInvocation(plan, sourceDir);
  const unsupported = !invocation;
  let result: DatabaseMigrationCommandResult = {
    exitCode: unsupported ? 1 : 0,
    stdout: '',
    stderr: unsupported ? buildDatabaseMigrationBlockedReason(plan) : '',
    durationMs: 0,
  };
  let status: PlanningExecutionRun['status'] = unsupported ? 'blocked' : 'completed';

  if (invocation) {
    try {
      result = await options.databaseMigrationRunner({
        command: invocation.command,
        args: invocation.args,
        cwd: sourceDir,
        timeoutMs: 300_000,
        ...(invocation.env ? { env: invocation.env } : {}),
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

  const artifact = buildDatabaseMigrationArtifact(plan, action, runId, sourceDir, invocation, result, status);
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: 'database-migrate',
    status,
    title: `${action.label}: ${plan.databaseDesign.primaryStore}`,
    mode: unsupported ? 'dry-run' : 'external',
    summary: status === 'completed'
      ? `Applied database deployment for ${plan.databaseDesign.primaryStore}.`
      : unsupported
        ? `Database migration execution is blocked for ${plan.databaseDesign.primaryStore}: ${result.stderr}`
        : 'Database migration execution failed; inspect the attached artifact for stdout and stderr.',
    ...(invocation ? { command: invocation.displayCommand } : {}),
    startedAt: now,
    completedAt: Date.now(),
    artifactIds: [artifact.id],
    evidence: [
      `sourceDir: ${sourceDir}`,
      `primaryStore: ${plan.databaseDesign.primaryStore}`,
      `exitCode: ${result.exitCode}`,
      ...(invocation ? [`command: ${invocation.displayCommand}`] : []),
    ],
  };
  const executionActions = plan.executionActions.map((item) =>
    item.id === 'database-migrate'
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

async function executeDatabaseMaterializeAction(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  body: ExecuteProjectPlanActionRequest,
  options: { scaffoldRoot: string },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const sourceDir = await resolveRepoSourceDir(body.targetDir ?? '', options.scaffoldRoot);
  const writes = await writeDatabaseDesignFiles(plan, sourceDir);
  const artifact = buildDatabaseMaterializeArtifact(plan, action, runId, sourceDir, writes);
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: 'database-materialize',
    status: 'completed',
    title: action.label,
    mode: 'external',
    summary: `Wrote ${writes.length} database design file(s) into ${sourceDir}.`,
    startedAt: now,
    completedAt: Date.now(),
    artifactIds: [artifact.id],
    evidence: [
      `sourceDir: ${sourceDir}`,
      ...writes.map((write) => `wrote ${write.relativePath}`),
    ],
  };
  const executionActions = plan.executionActions.map((item) =>
    item.id === 'database-materialize' ? { ...item, status: 'completed' as const } : item,
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

async function executeDesignMaterializeAction(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  body: ExecuteProjectPlanActionRequest,
  options: { scaffoldRoot: string },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const sourceDir = await resolveRepoSourceDir(body.targetDir ?? '', options.scaffoldRoot);
  const writes = await writeDesignPlanningFiles(plan, sourceDir);
  const artifact = buildDesignMaterializeArtifact(plan, action, runId, sourceDir, writes);
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: 'design-materialize',
    status: 'completed',
    title: action.label,
    mode: 'external',
    summary: `Wrote ${writes.length} design planning file(s) into ${sourceDir}.`,
    startedAt: now,
    completedAt: Date.now(),
    artifactIds: [artifact.id],
    evidence: [
      `sourceDir: ${sourceDir}`,
      ...writes.map((write) => `wrote ${write.relativePath}`),
    ],
  };
  const executionActions = plan.executionActions.map((item) =>
    item.id === 'design-materialize' ? { ...item, status: 'completed' as const } : item,
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

async function executeProviderSetupAction(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  body: ExecuteProjectPlanActionRequest,
  options: { scaffoldRoot: string; providerSetupRunner: ProviderSetupCommandRunner },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const sourceDir = await resolveRepoSourceDir(body.targetDir ?? '', options.scaffoldRoot);
  const writes = await writeProviderSetupFiles(plan, sourceDir);
  const invocations = body.validateProviders ? buildProviderSetupInvocations(plan) : [];
  const executions: ProviderSetupCommandExecution[] = [];
  let status: PlanningExecutionRun['status'] = 'completed';
  for (const invocation of invocations) {
    let result: ProviderSetupCommandResult;
    try {
      result = await options.providerSetupRunner({
        command: invocation.command,
        args: invocation.args,
        cwd: sourceDir,
        timeoutMs: 120_000,
        ...(invocation.env ? { env: invocation.env } : {}),
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
    executions.push({ invocation, result });
  }
  const artifact = buildProviderSetupArtifact(plan, action, runId, sourceDir, writes, invocations, executions, status);
  const commandDisplay = invocations.map((invocation) => invocation.displayCommand).join(' && ');
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: 'provider-setup',
    status,
    title: action.label,
    mode: 'external',
    summary: status === 'completed'
      ? `Wrote ${writes.length} provider setup file(s) into ${sourceDir}${executions.length > 0 ? ` and validated ${executions.length} provider connection(s).` : '.'}`
      : 'Provider setup validation failed; inspect the attached artifact for stdout and stderr.',
    ...(commandDisplay ? { command: commandDisplay } : {}),
    startedAt: now,
    completedAt: Date.now(),
    artifactIds: [artifact.id],
    evidence: [
      `sourceDir: ${sourceDir}`,
      ...writes.map((write) => `wrote ${write.relativePath}`),
      ...(invocations.length > 0
        ? executions.flatMap(({ invocation, result }) => [
          `command: ${invocation.displayCommand}`,
          `${invocation.toolId} exitCode: ${result.exitCode}`,
        ])
        : ['provider validation: not requested']),
    ],
  };
  const executionActions = plan.executionActions.map((item) =>
    item.id === 'provider-setup'
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
  const issueSpecs = buildProjectManagementIssueSpecs(plan);
  const results: Array<{ title: string; command?: string; result: ProjectManagementCommandResult }> = [];
  const invocations = await buildProjectManagementInvocations(plan, target, cwd, runId, issueSpecs);
  const unsupported = invocations.length === 0;
  let status: PlanningExecutionRun['status'] = unsupported ? 'blocked' : 'completed';

  if (unsupported) {
    results.push(buildBlockedProjectManagementResult(target));
  } else {
    for (const invocation of invocations) {
      try {
        const result = await options.projectManagementRunner({
          command: invocation.command,
          args: invocation.args,
          cwd,
          timeoutMs: 120_000,
          ...(invocation.env ? { env: invocation.env } : {}),
        });
        if (result.exitCode !== 0) status = 'failed';
        results.push({
          title: invocation.title,
          command: invocation.displayCommand,
          result,
        });
      } catch (err: any) {
        status = 'failed';
        results.push({
          title: invocation.title,
          command: invocation.displayCommand,
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
      ? `Created ${target} project-management handoff for ${plan.name}.`
      : unsupported
        ? `${target} handoff executor is missing required provider configuration.`
        : `${target} project-management handoff failed; inspect the attached artifact for stdout and stderr.`,
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
  options: { scaffoldRoot: string; deployRunner: DeployCommandRunner; deployHealthChecker: DeploymentHealthChecker },
): Promise<{
  planPatch: Pick<ProjectPlan, 'executionRuns' | 'executionArtifacts' | 'executionActions' | 'scaffoldExecution' | 'repo' | 'delivery'>;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}> {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const sourceDir = await resolveRepoSourceDir(body.targetDir ?? '', options.scaffoldRoot);
  const target = resolveDeliveryTarget(plan, body.deliveryTarget);
  const invocation = buildDeployInvocation(plan, target);
  const unsupported = !invocation;
  let result: DeployCommandResult = {
    exitCode: unsupported ? 1 : 0,
    stdout: '',
    stderr: unsupported ? buildDeployBlockedReason(target) : '',
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
        ...(invocation.env ? { env: invocation.env } : {}),
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
  const previewUrl = status === 'completed' ? extractFirstUrl([result.stdout, result.stderr].join('\n')) : undefined;
  const healthCheck = previewUrl ? await options.deployHealthChecker(previewUrl) : undefined;
  if (healthCheck && !healthCheck.ok) status = 'failed';
  const artifact = buildDeployArtifact(plan, action, runId, sourceDir, target, invocation, result, status, previewUrl, healthCheck);
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'action',
    actionId: 'deploy-runtime',
    status,
    title: `${action.label}: ${target}`,
    mode: unsupported ? 'dry-run' : 'external',
    summary: status === 'completed'
      ? `${target} deployment completed${previewUrl ? ` at ${previewUrl}` : ''}${healthCheck ? ` and health check returned ${healthCheck.statusCode ?? 'unknown'}` : ''}.`
      : unsupported
        ? `${target} deployment executor is missing required provider configuration.`
        : healthCheck && !healthCheck.ok
          ? `${target} deployment completed but health check failed for ${previewUrl}.`
          : `${target} deployment failed; inspect the attached artifact for stdout and stderr.`,
    ...(invocation ? { command: invocation.displayCommand } : {}),
    startedAt: now,
    completedAt: Date.now(),
    artifactIds: [artifact.id],
    evidence: [
      `sourceDir: ${sourceDir}`,
      `deliveryTarget: ${target}`,
      `exitCode: ${result.exitCode}`,
      ...(previewUrl ? [`previewUrl: ${previewUrl}`] : []),
      ...(healthCheck ? [
        `healthCheck.ok: ${healthCheck.ok ? 'yes' : 'no'}`,
        `healthCheck.statusCode: ${healthCheck.statusCode ?? 'unknown'}`,
        ...(healthCheck.finalUrl ? [`healthCheck.finalUrl: ${healthCheck.finalUrl}`] : []),
      ] : []),
    ],
  };
  const delivery = plan.delivery.map((item) =>
    item.target === target
      ? {
        ...item,
        status: status === 'completed' ? 'deployed' as const : 'blocked' as const,
        notes: status === 'completed'
          ? `Deployment completed${previewUrl ? ` at ${previewUrl}` : ''}${healthCheck ? `; health ${healthCheck.statusCode ?? 'unknown'}` : ''}.`
          : (healthCheck
            ? `Health check failed${healthCheck.statusCode ? ` with ${healthCheck.statusCode}` : ''}${healthCheck.error ? `: ${healthCheck.error}` : ''}.`
            : result.stderr
          ).slice(0, 500),
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
  const handoffWrites = status === 'completed' ? await writeScaffoldHandoffFiles(plan, target.outputDir, runId) : [];
  const artifact = buildScaffoldArtifact(plan, action, runId, target, invocation, result, status, handoffWrites);
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
      ...handoffWrites.map((write) => `wrote ${write.relativePath}`),
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
      ? [
        `Scaffold output created at ${target.outputDir}.`,
        ...handoffWrites.map((write) => `Wrote ${write.relativePath}.`),
      ]
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
          : action.id === 'provider-setup'
            ? 'provider-setup'
            : action.id === 'database-materialize'
              ? 'database-materialization'
              : action.id === 'database-migrate'
                ? 'database-migration'
                : action.id === 'design-materialize'
                  ? 'design-materialization'
                  : action.id === 'project-management'
                    ? 'project-management-plan'
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

function buildDeployInvocation(plan: ProjectPlan, target: DeliveryPlan['target']): DeployCommandInvocation | null {
  if (target === 'vercel') {
    return {
      command: 'vercel',
      args: ['deploy', '--yes'],
      displayCommand: 'vercel deploy --yes',
    };
  }
  if (target === 'cloudflare') {
    return buildCloudflareDeployInvocation(plan.stack.packageManager);
  }
  if (target === 'coolify') {
    return buildCoolifyDeployInvocation();
  }
  if (target === 'hostinger') {
    return buildHostingerDeployInvocation();
  }
  return null;
}

function buildCloudflareDeployInvocation(packageManager: ProjectStackDecision['packageManager']): DeployCommandInvocation {
  switch (packageManager ?? 'pnpm') {
    case 'npm':
      return { command: 'npx', args: ['wrangler', 'deploy'], displayCommand: 'npx wrangler deploy' };
    case 'yarn':
      return { command: 'yarn', args: ['wrangler', 'deploy'], displayCommand: 'yarn wrangler deploy' };
    case 'bun':
      return { command: 'bunx', args: ['wrangler', 'deploy'], displayCommand: 'bunx wrangler deploy' };
    case 'pnpm':
    default:
      return { command: 'pnpm', args: ['wrangler', 'deploy'], displayCommand: 'pnpm wrangler deploy' };
  }
}

function buildCoolifyDeployInvocation(): DeployCommandInvocation | null {
  const baseUrl = process.env.COOLIFY_URL?.trim().replace(/\/+$/, '');
  const apiToken = process.env.COOLIFY_API_TOKEN?.trim();
  const resourceUuid = process.env.COOLIFY_RESOURCE_UUID?.trim();
  if (!baseUrl || !apiToken || !resourceUuid) return null;
  const forceDeploy = process.env.COOLIFY_FORCE_DEPLOY?.trim() === '1' ? 'true' : 'false';
  const deployUrl = `${baseUrl}/api/v1/deploy?uuid=${encodeURIComponent(resourceUuid)}&force=${forceDeploy}`;
  return {
    command: 'bash',
    args: [
      '-lc',
      [
        'set -euo pipefail',
        'response="$(curl -sS -X POST "$COOLIFY_DEPLOY_URL" -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Content-Type: application/json")"',
        'printf "%s\\n" "$response"',
        'if [ -n "${COOLIFY_PUBLIC_URL:-}" ]; then printf "Preview: %s\\n" "$COOLIFY_PUBLIC_URL"; fi',
      ].join('\n'),
    ],
    displayCommand: 'coolify deploy --resource "$COOLIFY_RESOURCE_UUID"',
    env: {
      COOLIFY_URL: baseUrl,
      COOLIFY_API_TOKEN: apiToken,
      COOLIFY_RESOURCE_UUID: resourceUuid,
      COOLIFY_DEPLOY_URL: deployUrl,
      ...(process.env.COOLIFY_PUBLIC_URL?.trim() ? { COOLIFY_PUBLIC_URL: process.env.COOLIFY_PUBLIC_URL.trim() } : {}),
    },
  };
}

function buildHostingerDeployInvocation(): DeployCommandInvocation | null {
  const sshHost = process.env.HOSTINGER_SSH_HOST?.trim();
  const sshUser = process.env.HOSTINGER_SSH_USER?.trim();
  const deployPath = process.env.HOSTINGER_DEPLOY_PATH?.trim();
  if (!sshHost || !sshUser || !deployPath) return null;
  const sshPort = process.env.HOSTINGER_SSH_PORT?.trim() || '22';
  const postDeployCommand = process.env.HOSTINGER_POST_DEPLOY_COMMAND?.trim();
  return {
    command: 'bash',
    args: [
      '-lc',
      [
        'set -euo pipefail',
        'rsync -az --delete -e "ssh -p $HOSTINGER_SSH_PORT" ./ "$HOSTINGER_SSH_USER@$HOSTINGER_SSH_HOST:$HOSTINGER_DEPLOY_PATH/"',
        'if [ -n "${HOSTINGER_POST_DEPLOY_COMMAND:-}" ]; then ssh -p "$HOSTINGER_SSH_PORT" "$HOSTINGER_SSH_USER@$HOSTINGER_SSH_HOST" "cd $HOSTINGER_DEPLOY_PATH && $HOSTINGER_POST_DEPLOY_COMMAND"; fi',
        'if [ -n "${HOSTINGER_PUBLIC_URL:-}" ]; then printf "Preview: %s\\n" "$HOSTINGER_PUBLIC_URL"; fi',
      ].join('\n'),
    ],
    displayCommand: 'rsync ./ "$HOSTINGER_SSH_USER@$HOSTINGER_SSH_HOST:$HOSTINGER_DEPLOY_PATH/"',
    env: {
      HOSTINGER_SSH_HOST: sshHost,
      HOSTINGER_SSH_USER: sshUser,
      HOSTINGER_SSH_PORT: sshPort,
      HOSTINGER_DEPLOY_PATH: deployPath,
      ...(postDeployCommand ? { HOSTINGER_POST_DEPLOY_COMMAND: postDeployCommand } : {}),
      ...(process.env.HOSTINGER_PUBLIC_URL?.trim() ? { HOSTINGER_PUBLIC_URL: process.env.HOSTINGER_PUBLIC_URL.trim() } : {}),
    },
  };
}

function buildDeployBlockedReason(target: DeliveryPlan['target']): string {
  if (target === 'coolify') {
    return 'COOLIFY_URL, COOLIFY_API_TOKEN, and COOLIFY_RESOURCE_UUID are required before Coolify deployment execution.';
  }
  if (target === 'hostinger') {
    return 'HOSTINGER_SSH_HOST, HOSTINGER_SSH_USER, and HOSTINGER_DEPLOY_PATH are required before Hostinger VPS deployment execution.';
  }
  return `${target} deployment execution is not implemented yet.`;
}

function buildDatabaseMigrationCommandPreview(stack: ProjectStackDecision): string {
  switch (stack.database ?? 'supabase') {
    case 'supabase':
      return 'supabase db push';
    case 'cloudflare-d1':
      return 'wrangler d1 migrations apply $CLOUDFLARE_D1_DATABASE_NAME';
    case 'postgres-coolify':
      return 'psql $DATABASE_URL -f db/migrations/0001_planning_schema.sql';
    case 'convex':
      return 'convex deploy';
    case 'none':
    default:
      return 'No SQL migration command available for this database selection.';
  }
}

function buildDatabaseMigrationInvocation(
  plan: ProjectPlan,
  sourceDir: string,
): DatabaseMigrationInvocation | null {
  switch (plan.databaseDesign.primaryStore) {
    case 'supabase':
      return { command: 'supabase', args: ['db', 'push'], displayCommand: 'supabase db push' };
    case 'cloudflare-d1': {
      const databaseName = process.env.CLOUDFLARE_D1_DATABASE_NAME?.trim();
      if (!databaseName) return null;
      const base = buildCloudflareD1MigrationInvocation(plan.stack.packageManager);
      return {
        command: base.command,
        args: [...base.args, databaseName],
        displayCommand: `${[base.command, ...base.args].join(' ')} ${databaseName}`,
      };
    }
    case 'postgres-coolify': {
      const databaseUrl = process.env.POSTGRES_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
      if (!databaseUrl) return null;
      const migrationPath = path.resolve(sourceDir, 'db', 'migrations', '0001_planning_schema.sql');
      return {
        command: 'psql',
        args: ['-f', migrationPath],
        displayCommand: 'psql $DATABASE_URL -f db/migrations/0001_planning_schema.sql',
        env: { PGDATABASE: databaseUrl },
      };
    }
    case 'convex': {
      const schemaPath = path.resolve(sourceDir, 'convex', 'schema.ts');
      return {
        ...buildConvexDeploymentInvocation(plan.stack.packageManager),
        env: process.env.CONVEX_DEPLOYMENT?.trim()
          ? { CONVEX_DEPLOYMENT: process.env.CONVEX_DEPLOYMENT.trim(), CONVEX_SCHEMA_PATH: schemaPath }
          : { CONVEX_SCHEMA_PATH: schemaPath },
      };
    }
    case 'none':
    default:
      return null;
  }
}

function buildCloudflareD1MigrationInvocation(packageManager: ProjectStackDecision['packageManager']): { command: string; args: string[] } {
  switch (packageManager ?? 'pnpm') {
    case 'npm':
      return { command: 'npx', args: ['wrangler', 'd1', 'migrations', 'apply'] };
    case 'yarn':
      return { command: 'yarn', args: ['wrangler', 'd1', 'migrations', 'apply'] };
    case 'bun':
      return { command: 'bunx', args: ['wrangler', 'd1', 'migrations', 'apply'] };
    case 'pnpm':
    default:
      return { command: 'pnpm', args: ['wrangler', 'd1', 'migrations', 'apply'] };
  }
}

function buildConvexDeploymentInvocation(packageManager: ProjectStackDecision['packageManager']): DatabaseMigrationInvocation {
  switch (packageManager ?? 'pnpm') {
    case 'npm':
      return { command: 'npx', args: ['convex', 'deploy'], displayCommand: 'npx convex deploy' };
    case 'yarn':
      return { command: 'yarn', args: ['convex', 'deploy'], displayCommand: 'yarn convex deploy' };
    case 'bun':
      return { command: 'bunx', args: ['convex', 'deploy'], displayCommand: 'bunx convex deploy' };
    case 'pnpm':
    default:
      return { command: 'pnpm', args: ['convex', 'deploy'], displayCommand: 'pnpm convex deploy' };
  }
}

function buildDatabaseMigrationBlockedReason(plan: ProjectPlan): string {
  switch (plan.databaseDesign.primaryStore) {
    case 'cloudflare-d1':
      return 'CLOUDFLARE_D1_DATABASE_NAME is required to apply D1 migrations.';
    case 'postgres-coolify':
      return 'DATABASE_URL or POSTGRES_DATABASE_URL is required to apply Postgres migrations.';
    case 'convex':
      return 'Convex deployment command is not available. Materialize convex/schema.ts and connect the Convex CLI before deploying.';
    case 'none':
      return 'No database provider is selected for migration execution.';
    case 'supabase':
    default:
      return 'No database migration command is available for this provider.';
  }
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

async function buildProjectManagementInvocations(
  plan: ProjectPlan,
  target: ProjectManagementTarget,
  cwd: string,
  runId: string,
  issues: ProjectManagementIssueSpec[],
): Promise<ProjectManagementCommandInvocation[]> {
  if (target === 'github-issues') {
    const repo = `${cleanRepoSegment(plan.repo.owner, 'repo.owner')}/${cleanRepoSegment(plan.repo.name, 'repo.name')}`;
    return issues.map((issue) => buildGitHubIssueInvocation(repo, issue));
  }
  if (target === 'linear') {
    const apiKey = process.env.LINEAR_API_KEY?.trim();
    const teamId = process.env.LINEAR_TEAM_ID?.trim();
    if (!apiKey || !teamId) return [];
    return issues.map((issue) => buildLinearIssueInvocation(issue, teamId, apiKey));
  }
  if (target === 'google-docs') {
    const bodyFile = await writeGoogleDocsHandoffBody(cwd, runId, plan, issues);
    return [buildGoogleDocsInvocation(plan, bodyFile)];
  }
  return [];
}

function buildBlockedProjectManagementResult(target: ProjectManagementTarget): { title: string; result: ProjectManagementCommandResult } {
  const reason = target === 'linear'
    ? 'LINEAR_API_KEY and LINEAR_TEAM_ID are required before Linear handoff execution.'
    : target === 'google-docs'
      ? 'Google Docs handoff command could not be built.'
      : `${target} project-management execution is not implemented yet.`;
  return {
    title: `${target} handoff`,
    result: {
      exitCode: 1,
      stdout: '',
      stderr: reason,
      durationMs: 0,
    },
  };
}

function buildGitHubIssueInvocation(repo: string, issue: ProjectManagementIssueSpec): ProjectManagementCommandInvocation {
  return {
    title: issue.title,
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
    displayCommand: `gh issue create --repo ${repo} --title "${shellDisplayArg(issue.title)}" --body "<generated from plan sections>" --label ${issue.labels.join(',')}`,
  };
}

function buildLinearIssueInvocation(
  issue: ProjectManagementIssueSpec,
  teamId: string,
  apiKey: string,
): ProjectManagementCommandInvocation {
  const body = JSON.stringify({
    query: 'mutation OpenDesignIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }',
    variables: {
      input: {
        teamId,
        title: issue.title,
        description: issue.body,
      },
    },
  });
  return {
    title: issue.title,
    command: 'bash',
    args: [
      '-lc',
      'curl -sS -X POST https://api.linear.app/graphql -H "Content-Type: application/json" -H "Authorization: $LINEAR_API_KEY" --data-binary "$LINEAR_GRAPHQL_BODY"',
    ],
    displayCommand: `linear graphql issueCreate --team "$LINEAR_TEAM_ID" --title "${shellDisplayArg(issue.title)}"`,
    env: {
      LINEAR_API_KEY: apiKey,
      LINEAR_TEAM_ID: teamId,
      LINEAR_GRAPHQL_BODY: body,
    },
  };
}

async function writeGoogleDocsHandoffBody(
  cwd: string,
  runId: string,
  plan: ProjectPlan,
  issues: ProjectManagementIssueSpec[],
): Promise<string> {
  const handoffDir = path.join(cwd, '.od', 'plan-handoffs');
  await fs.mkdir(handoffDir, { recursive: true });
  const bodyFile = path.join(handoffDir, `${runId}-google-docs.md`);
  await fs.writeFile(bodyFile, buildGoogleDocsHandoffMarkdown(plan, issues), 'utf8');
  return bodyFile;
}

function buildGoogleDocsInvocation(plan: ProjectPlan, bodyFile: string): ProjectManagementCommandInvocation {
  const title = `Project plan handoff: ${plan.name}`;
  return {
    title,
    command: 'bash',
    args: [
      '-lc',
      'gws docs-write --title "$GOOGLE_DOCS_TITLE" --body-file "$GOOGLE_DOCS_BODY_FILE"',
    ],
    displayCommand: 'gws docs-write --title "$GOOGLE_DOCS_TITLE" --body-file "$GOOGLE_DOCS_BODY_FILE"',
    env: {
      GOOGLE_DOCS_TITLE: title,
      GOOGLE_DOCS_BODY_FILE: bodyFile,
    },
  };
}

function buildGoogleDocsHandoffMarkdown(plan: ProjectPlan, issues: ProjectManagementIssueSpec[]): string {
  return [
    `# Project Plan Handoff: ${plan.name}`,
    '',
    `Purpose: ${plan.intent.purpose}`,
    plan.intent.audience ? `Audience: ${plan.intent.audience}` : '',
    '',
    '## Stack',
    `- Frontend: ${plan.stack.frontend ?? 'next'}`,
    `- Backend: ${plan.stack.backend ?? 'hono'}`,
    `- Runtime: ${plan.stack.runtime ?? 'workers'}`,
    `- Database: ${plan.stack.database ?? 'supabase'}`,
    `- Auth: ${plan.stack.auth ?? 'better-auth'}`,
    '',
    '## Work Items',
    ...issues.flatMap((issue) => [
      `### ${issue.title}`,
      '',
      issue.body,
      '',
    ]),
  ].filter(Boolean).join('\n');
}

function buildProviderSetupInvocations(plan: ProjectPlan): ProviderSetupCommandInvocation[] {
  const invocations: ProviderSetupCommandInvocation[] = [];
  const seen = new Set<string>();
  for (const tool of plan.selectedTools) {
    if (tool.status === 'deferred') continue;
    const invocation = buildProviderSetupInvocation(plan, tool.toolId);
    if (!invocation) continue;
    const key = `${invocation.toolId}:${invocation.displayCommand}`;
    if (seen.has(key)) continue;
    seen.add(key);
    invocations.push(invocation);
  }
  return invocations;
}

function buildProviderSetupInvocation(plan: ProjectPlan, toolId: PlanningToolId): ProviderSetupCommandInvocation | null {
  if (toolId === 'onepassword') {
    return buildOnePasswordProviderSetupInvocation();
  }
  const toolCheck = buildToolCheckInvocation(plan, toolId);
  if (!toolCheck) return null;
  return {
    toolId,
    command: toolCheck.command,
    args: toolCheck.args,
    displayCommand: [toolCheck.command, ...toolCheck.args].join(' '),
  };
}

function buildOnePasswordProviderSetupInvocation(): ProviderSetupCommandInvocation {
  const vault = process.env.OP_VAULT?.trim();
  if (!vault) {
    return {
      toolId: 'onepassword',
      command: 'op',
      args: ['whoami'],
      displayCommand: 'op whoami',
    };
  }
  return {
    toolId: 'onepassword',
    command: 'op',
    args: ['item', 'list', '--vault', vault, '--format', 'json'],
    displayCommand: 'op item list --vault "$OP_VAULT" --format json',
    env: {
      OP_VAULT: vault,
      ...(process.env.OP_SERVICE_ACCOUNT_TOKEN?.trim()
        ? { OP_SERVICE_ACCOUNT_TOKEN: process.env.OP_SERVICE_ACCOUNT_TOKEN.trim() }
        : {}),
      ...(process.env.OP_CONNECT_HOST?.trim()
        ? { OP_CONNECT_HOST: process.env.OP_CONNECT_HOST.trim() }
        : {}),
    },
  };
}

function shellDisplayArg(value: string): string {
  return value.replace(/"/g, '\\"');
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

async function writeDatabaseDesignFiles(plan: ProjectPlan, sourceDir: string): Promise<ProjectMaterializedWrite[]> {
  const writes: ProjectMaterializedWrite[] = [];
  await writeProjectFile(sourceDir, 'docs/database-plan.md', buildDatabasePlanMarkdown(plan), writes);
  await writeProjectFile(sourceDir, 'db/README.md', buildDatabaseReadme(plan), writes);
  if (isSqlDatabase(plan.databaseDesign.primaryStore)) {
    await writeProjectFile(sourceDir, 'db/migrations/0001_planning_schema.sql', buildDatabaseMigrationSql(plan), writes);
  } else if (plan.databaseDesign.primaryStore === 'convex') {
    await writeProjectFile(sourceDir, 'db/schema-notes.md', buildDatabaseSchemaNotes(plan), writes);
    await writeProjectFile(sourceDir, 'convex/schema.ts', buildConvexSchemaTs(plan), writes);
    await writeProjectFile(sourceDir, 'convex/planning.ts', buildConvexPlanningFunctionsTs(plan), writes);
  } else {
    await writeProjectFile(sourceDir, 'db/schema-notes.md', buildDatabaseSchemaNotes(plan), writes);
  }
  return writes;
}

async function writeDesignPlanningFiles(plan: ProjectPlan, sourceDir: string): Promise<ProjectMaterializedWrite[]> {
  const writes: ProjectMaterializedWrite[] = [];
  await writeProjectFile(sourceDir, 'docs/design-plan.md', buildDesignPlanMarkdown(plan), writes);
  await writeProjectFile(sourceDir, 'docs/user-flows.md', buildUserFlowsMarkdown(plan), writes);
  await writeProjectFile(sourceDir, 'docs/design-acceptance.md', buildDesignAcceptanceMarkdown(plan), writes);
  return writes;
}

async function writeProviderSetupFiles(plan: ProjectPlan, sourceDir: string): Promise<ProjectMaterializedWrite[]> {
  const writes: ProjectMaterializedWrite[] = [];
  await writeProjectFile(sourceDir, 'docs/provider-setup.md', buildProviderSetupMarkdown(plan), writes);
  await writeProjectFile(sourceDir, 'docs/provider-checklist.md', buildProviderChecklistMarkdown(plan), writes);
  await writeProjectFile(sourceDir, 'docs/provider-connections.json', buildProviderConnectionManifestJson(plan), writes);
  await writeProjectFile(sourceDir, 'env/planning.providers.env.example', buildProviderEnvExample(plan), writes);
  return writes;
}

async function writeScaffoldHandoffFiles(
  plan: ProjectPlan,
  sourceDir: string,
  runId: string,
): Promise<ProjectMaterializedWrite[]> {
  const writes: ProjectMaterializedWrite[] = [];
  await writeProjectFile(sourceDir, 'docs/open-design-plan.md', buildScaffoldHandoffMarkdown(plan), writes);
  await writeProjectFile(sourceDir, '.od/planning-handoff.json', buildScaffoldHandoffJson(plan, runId), writes);
  return writes;
}

async function writeProjectFile(
  sourceDir: string,
  relativePath: string,
  content: string,
  writes: ProjectMaterializedWrite[],
): Promise<void> {
  const absolutePath = path.resolve(sourceDir, relativePath);
  assertPathInside(absolutePath, sourceDir, 'generated planning files must stay inside the scaffold source directory');
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
  writes.push({
    relativePath,
    absolutePath,
    bytes: Buffer.byteLength(content.endsWith('\n') ? content : `${content}\n`, 'utf8'),
  });
}

function isSqlDatabase(primaryStore: string): boolean {
  return ['supabase', 'postgres-coolify', 'cloudflare-d1'].includes(primaryStore);
}

function canExecuteDatabaseDeployment(primaryStore: string): boolean {
  return isSqlDatabase(primaryStore) || primaryStore === 'convex';
}

function buildScaffoldHandoffMarkdown(plan: ProjectPlan): string {
  const answeredSections = Object.values(plan.sectionAnswers ?? {})
    .filter((answer): answer is ProjectSectionAnswer => Boolean(answer) && answer.answers.length > 0);
  const nextActions = plan.executionActions.filter((action) => action.id !== 'scaffold');
  return [
    '# Open Design Plan Handoff',
    '',
    `Project: ${plan.name}`,
    `Plan id: ${plan.id}`,
    `Purpose: ${plan.intent.purpose}`,
    plan.intent.audience ? `Audience: ${plan.intent.audience}` : '',
    '',
    '## Stack Decision',
    `- Frontend: ${plan.stack.frontend ?? 'next'}`,
    `- Backend: ${plan.stack.backend ?? 'hono'}`,
    `- Runtime: ${plan.stack.runtime ?? 'workers'}`,
    `- Database: ${plan.stack.database ?? 'supabase'}`,
    `- ORM: ${plan.stack.orm ?? 'drizzle'}`,
    `- API: ${plan.stack.api ?? 'trpc'}`,
    `- Auth: ${plan.stack.auth ?? 'better-auth'}`,
    `- Payments: ${plan.stack.payments ?? 'none'}`,
    `- Hosting: ${plan.stack.hosting?.join(', ') || 'none'}`,
    '',
    '## Better-T-Stack Command',
    plan.scaffold.command,
    '',
    '## Selected Tools',
    ...formatBullets(plan.selectedTools.map((tool) =>
      `${tool.toolId}: ${tool.status}${tool.notes ? ` (${tool.notes})` : ''}`,
    )),
    '',
    '## Workspace Sections',
    ...formatBullets(plan.workspaceSections.map((section) =>
      `${section.label}: ${section.purpose}`,
    )),
    '',
    '## Accepted Section Answers',
    ...(answeredSections.length
      ? answeredSections.flatMap((answer) => [
        `### ${answer.sectionId}`,
        ...answer.answers.map((line) => `- ${line}`),
        answer.notes ? `Notes: ${answer.notes}` : '',
        '',
      ])
      : ['- No accepted section answers have been stored yet.']),
    '',
    '## Database Plan',
    `- Primary store: ${plan.databaseDesign.primaryStore}`,
    `- Mode: ${plan.databaseDesign.mode}`,
    ...formatBullets(plan.databaseDesign.entities.map((entity) => `Entity: ${entity}`)),
    '',
    '## Next Execution Actions',
    ...formatBullets(nextActions.map((action) =>
      `${action.id}: ${action.status} - ${action.label}`,
    )),
    '',
    '## Provider Capability Notes',
    ...formatBullets(plan.providerCapabilities.map((snapshot) =>
      `${snapshot.toolId}: checked ${snapshot.checkedAt}; ${snapshot.planningImplications[0] ?? snapshot.sourceUrl}`,
    )),
    '',
    '## Guardrails',
    '- Keep secret values in the selected secret manager; do not commit provider secrets.',
    '- Treat provider checks, migrations, deploys, repo creation, and project-management writes as separate proof-bearing actions.',
    '- Keep Planning, Design, Database, Integrations, AI, Workflows, and Delivery decisions distinct when implementing this scaffold.',
  ].filter(Boolean).join('\n');
}

function buildScaffoldHandoffJson(plan: ProjectPlan, runId: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    generatedBy: 'open-design-planning',
    planId: plan.id,
    runId,
    projectName: plan.name,
    intent: plan.intent,
    stack: plan.stack,
    selectedTools: plan.selectedTools,
    scaffold: plan.scaffold,
    databaseDesign: plan.databaseDesign,
    workspaceSections: plan.workspaceSections.map((section) => ({
      id: section.id,
      label: section.label,
      purpose: section.purpose,
      owns: section.owns,
      doesNotOwn: section.doesNotOwn,
      outputs: section.outputs,
    })),
    sectionAnswers: plan.sectionAnswers,
    delivery: plan.delivery,
    repo: plan.repo,
    nextActionIds: plan.executionActions.filter((action) => action.id !== 'scaffold').map((action) => action.id),
  }, null, 2);
}

function buildDesignPlanMarkdown(plan: ProjectPlan): string {
  const context = buildDesignContext(plan);
  return [
    '# Design Plan',
    '',
    `Project: ${plan.name}`,
    `Purpose: ${plan.intent.purpose}`,
    plan.intent.audience ? `Audience: ${plan.intent.audience}` : '',
    '',
    '## Design Section Ownership',
    `Purpose: ${context.section?.purpose ?? 'Shape the product experience and user-facing workflows.'}`,
    '',
    'Owns:',
    ...formatBullets(context.section?.owns ?? ['user flows', 'screen inventory', 'interaction states', 'accessibility expectations']),
    '',
    'Does not own:',
    ...formatBullets(context.section?.doesNotOwn ?? ['database source of truth', 'secret storage', 'provider auth scopes']),
    '',
    '## Accepted Design Inputs',
    ...formatBullets(context.answer?.answers.length ? context.answer.answers : ['No accepted design answers have been stored yet.']),
    context.answer?.notes ? `Notes: ${context.answer.notes}` : '',
    '',
    '## Screen Inventory',
    ...formatBullets(buildDesignScreenInventory(plan)),
    '',
    '## Required States',
    ...formatBullets(buildDesignStateChecklist(plan)),
    '',
    '## Provider-Aware Constraints',
    ...formatBullets(buildDesignProviderConstraints(plan)),
  ].filter(Boolean).join('\n');
}

function buildUserFlowsMarkdown(plan: ProjectPlan): string {
  const context = buildDesignContext(plan);
  return [
    '# User Flows',
    '',
    `Project: ${plan.name}`,
    '',
    '## Primary Workflow',
    ...formatNumbered([
      'Capture the project purpose, audience, and success criteria in Planning.',
      'Answer pointed questions for design, database, integrations, AI, workflows, and delivery.',
      'Review generated stack decisions and Better-T-Stack scaffold command before execution.',
      'Materialize design and database files into the scaffolded source tree.',
      'Run deployment, migration, and project-management handoff actions with recorded proof.',
    ]),
    '',
    '## Design Agent Lanes',
    ...formatBullets(context.lanes.map((lane) => `${lane.label}: ${lane.outputs.join(', ')}`)),
    '',
    '## Pointed Design Questions',
    ...formatBullets(context.questions.map((question) => `${question.question} (${question.answerType})`)),
    '',
    '## Cross-Section Dependencies',
    ...formatBullets([
      `Database source of truth: ${plan.databaseDesign.primaryStore}`,
      `Runtime target: ${plan.runtimePlan.recommended}`,
      `Delivery targets: ${plan.delivery.map((item) => item.target).join(', ') || 'not selected'}`,
      `Selected tools: ${plan.selectedTools.map((tool) => tool.toolId).join(', ') || 'none'}`,
    ]),
  ].filter(Boolean).join('\n');
}

function buildDesignAcceptanceMarkdown(plan: ProjectPlan): string {
  return [
    '# Design Acceptance Criteria',
    '',
    `Project: ${plan.name}`,
    '',
    '## Product Clarity',
    ...formatBullets([
      'The first screen states the project purpose, current planning status, and next required action.',
      'Planning, Design, Database, Integrations, AI, Workflows, and Delivery remain visually and functionally distinct.',
      'Every section shows accepted answers, unanswered blocking questions, and related execution actions.',
    ]),
    '',
    '## Workflow Usability',
    ...formatBullets([
      'Users can run ready section agents individually or in parallel without losing section context.',
      'Actions that write files, create external resources, or deploy require explicit confirmation.',
      'Each completed action surfaces artifacts, command proof, and follow-up evidence in the execution history.',
    ]),
    '',
    '## Implementation Readiness',
    ...formatBullets([
      'Design docs reference database states, integration auth states, workflow run states, and delivery proof states.',
      'Generated UI avoids hiding provider setup blockers behind generic “done” states.',
      'Scaffolded screens have empty, loading, error, blocked, ready, running, completed, and failed states where applicable.',
    ]),
    '',
    '## Accessibility And Responsiveness',
    ...formatBullets([
      'Primary workflows are keyboard-reachable and visible at desktop and mobile widths.',
      'Status, blocker, and proof text remains readable without relying on color alone.',
      'Long provider names, commands, URLs, and artifact paths wrap without overlapping controls.',
    ]),
  ].join('\n');
}

interface ProviderSetupSpec {
  toolId: ProjectToolConnection['toolId'];
  label: string;
  kind: PlanningToolOption['kind'];
  status: ProjectToolConnection['status'];
  notes?: string;
  envVars: string[];
  setupSteps: string[];
  verification: string[];
  blockerNotes: string[];
}

interface ProviderConnectionManifest {
  generatedAt: string;
  plan: {
    id: string;
    name: string;
    purpose: string;
  };
  tools: Array<{
    toolId: ProjectToolConnection['toolId'];
    label: string;
    category: PlanningToolOption['kind'];
    desiredStatus: ProjectToolConnection['status'];
    notes?: string;
    envVars: string[];
    checkCommand?: string;
    setupSteps: string[];
    verification: string[];
    blockers: string[];
    capabilitySourceUrl?: string;
    lastCheck?: {
      status: PlanningToolCheck['status'];
      checkedAt: number;
      summary: string;
    };
  }>;
}

function buildProviderSetupMarkdown(plan: ProjectPlan): string {
  const specs = buildProviderSetupSpecs(plan);
  return [
    '# Provider Setup',
    '',
    `Project: ${plan.name}`,
    `Purpose: ${plan.intent.purpose}`,
    '',
    '## Rules',
    ...formatBullets([
      'Keep real secrets in 1Password or the selected secret manager; generated files only name required variables.',
      'Run provider capability refresh before relying on provider-specific behavior, flags, or account features.',
      'Do not mark a provider connected until a tool check, CLI command, webhook test, or dashboard URL proves it.',
      'Keep Cloudflare hosting, Cloudflare data, and Cloudflare Access as separate setup tracks.',
    ]),
    '',
    '## Setup Order',
    ...formatNumbered(buildProviderSetupOrder(specs)),
    '',
    '## Selected Providers',
    ...specs.flatMap((spec) => [
      `### ${spec.label}`,
      '',
      `Tool id: ${spec.toolId}`,
      `Category: ${spec.kind}`,
      `Status: ${spec.status}`,
      spec.notes ? `Notes: ${spec.notes}` : '',
      '',
      'Environment names:',
      ...formatBullets(spec.envVars.length ? spec.envVars : ['No environment variables required by the generated plan.']),
      '',
      'Setup steps:',
      ...formatBullets(spec.setupSteps),
      '',
      'Verification:',
      ...formatBullets(spec.verification),
      '',
      'Blockers to keep visible:',
      ...formatBullets(spec.blockerNotes),
      '',
    ]),
    '## Provider Capability Evidence',
    ...formatBullets(plan.providerCapabilities.map((snapshot) =>
      `${snapshot.label}: checked ${snapshot.checkedAt} from ${snapshot.sourceUrl}`,
    )),
  ].filter(Boolean).join('\n');
}

function buildProviderChecklistMarkdown(plan: ProjectPlan): string {
  const specs = buildProviderSetupSpecs(plan);
  const grouped = groupProviderSetupSpecs(specs);
  return [
    '# Provider Setup Checklist',
    '',
    `Project: ${plan.name}`,
    '',
    '## Cross-Provider Checks',
    ...formatBullets([
      '[ ] 1Password item or vault path exists for every secret-bearing provider.',
      '[ ] Local env loading is documented before deployment envs are populated.',
      '[ ] Webhook providers have local, preview, and production callback URLs recorded.',
      '[ ] Long-running workflow providers have retry, timeout, and idempotency policies recorded.',
      '[ ] Provider setup blockers are copied into project-management issues before implementation starts.',
    ]),
    '',
    ...Array.from(grouped.entries()).flatMap(([kind, kindSpecs]) => [
      `## ${providerKindLabel(kind)}`,
      '',
      ...kindSpecs.flatMap((spec) => [
        `### ${spec.label}`,
        '',
        ...spec.setupSteps.map((step) => `- [ ] ${step}`),
        ...spec.verification.map((step) => `- [ ] Verify: ${step}`),
        '',
      ]),
    ]),
  ].join('\n');
}

function buildProviderEnvExample(plan: ProjectPlan): string {
  const specs = buildProviderSetupSpecs(plan);
  const envVars = uniqueStrings(specs.flatMap((spec) => spec.envVars)).sort();
  return [
    '# Generated by Open Design planning provider setup.',
    '# Copy names into your real env template only after deciding which providers are active.',
    '# Store values in 1Password or the selected secret manager; do not commit real secrets.',
    '',
    ...envVars.map((name) => `${name}=`),
  ].join('\n');
}

function buildProviderConnectionManifestJson(plan: ProjectPlan): string {
  const specs = buildProviderSetupSpecs(plan);
  const manifest: ProviderConnectionManifest = {
    generatedAt: new Date().toISOString(),
    plan: {
      id: plan.id,
      name: plan.name,
      purpose: plan.intent.purpose,
    },
    tools: specs.map((spec) => {
      const invocation = buildToolCheckInvocation(plan, spec.toolId);
      const snapshot = plan.providerCapabilities.find((item) => item.toolId === spec.toolId);
      const lastCheck = (plan.toolChecks ?? []).find((item) => item.toolId === spec.toolId);
      return {
        toolId: spec.toolId,
        label: spec.label,
        category: spec.kind,
        desiredStatus: spec.status,
        ...(spec.notes ? { notes: spec.notes } : {}),
        envVars: spec.envVars,
        ...(invocation ? { checkCommand: [invocation.command, ...invocation.args].join(' ') } : {}),
        setupSteps: spec.setupSteps,
        verification: spec.verification,
        blockers: spec.blockerNotes,
        ...(snapshot ? { capabilitySourceUrl: snapshot.sourceUrl } : {}),
        ...(lastCheck
          ? {
            lastCheck: {
              status: lastCheck.status,
              checkedAt: lastCheck.checkedAt,
              summary: lastCheck.summary,
            },
          }
          : {}),
      };
    }),
  };
  return JSON.stringify(manifest, null, 2);
}

function buildProviderSetupSpecs(plan: ProjectPlan): ProviderSetupSpec[] {
  return plan.selectedTools.map((connection) => {
    const tool = APPROVED_TOOLS.find((item) => item.id === connection.toolId);
    const base = buildProviderSetupDetails(connection.toolId);
    return {
      toolId: connection.toolId,
      label: tool?.label ?? connection.toolId,
      kind: tool?.kind ?? 'integrations',
      status: connection.status,
      ...(connection.notes ? { notes: connection.notes } : {}),
      ...base,
    };
  });
}

function buildProviderSetupOrder(specs: ProviderSetupSpec[]): string[] {
  const orderedKinds: PlanningToolOption['kind'][] = [
    'secrets',
    'source-control',
    'database',
    'authentication',
    'hosting',
    'ai-runtime',
    'memory',
    'integrations',
    'workflow-automation',
    'payments',
    'project-management',
  ];
  const byKind = groupProviderSetupSpecs(specs);
  return orderedKinds
    .filter((kind) => byKind.has(kind))
    .map((kind) => `${providerKindLabel(kind)}: ${byKind.get(kind)?.map((spec) => spec.label).join(', ')}`);
}

function groupProviderSetupSpecs(specs: ProviderSetupSpec[]): Map<PlanningToolOption['kind'], ProviderSetupSpec[]> {
  const grouped = new Map<PlanningToolOption['kind'], ProviderSetupSpec[]>();
  for (const spec of specs) {
    const bucket = grouped.get(spec.kind) ?? [];
    bucket.push(spec);
    grouped.set(spec.kind, bucket);
  }
  return grouped;
}

function providerKindLabel(kind: PlanningToolOption['kind']): string {
  return kind.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim()).map((value) => value.trim())));
}

function buildProviderSetupDetails(toolId: ProjectToolConnection['toolId']): Pick<ProviderSetupSpec, 'envVars' | 'setupSteps' | 'verification' | 'blockerNotes'> {
  switch (toolId) {
    case 'github':
    case 'github-issues':
      return {
        envVars: ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPOSITORY'],
        setupSteps: ['Authenticate gh for the intended owner or org.', 'Confirm repo visibility, branch policy, issue labels, and project-board expectations.'],
        verification: ['Run gh auth status and a read-only repo or issue command.', 'Record the created repo or issue URL in execution artifacts.'],
        blockerNotes: ['Missing owner, repo name, or issue write scope blocks repo and issue automation.'],
      };
    case 'cloudflare-hosting':
      return {
        envVars: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_PROJECT_NAME'],
        setupSteps: ['Create or select the Cloudflare account and project.', 'Choose Workers, Pages, or OpenNext deployment path before writing deploy scripts.'],
        verification: ['Run wrangler whoami or an account-scoped read command.', 'Record preview URL and deployment health check after deploy.'],
        blockerNotes: ['Cloudflare hosting is separate from D1/R2/Vectorize and Access setup.'],
      };
    case 'cloudflare-data':
      return {
        envVars: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_R2_BUCKET', 'CLOUDFLARE_VECTORIZE_INDEX'],
        setupSteps: ['Decide which Cloudflare data products are active: D1, R2, KV, Queues, Durable Objects, or Vectorize.', 'Create data resources before binding them into Workers config.'],
        verification: ['List each resource with wrangler or the Cloudflare API.', 'Run a read/write smoke for every resource used by the app.'],
        blockerNotes: ['Do not reuse hosting proof as data-resource proof.'],
      };
    case 'cloudflare-access':
      return {
        envVars: ['CLOUDFLARE_ACCESS_TEAM_NAME', 'CLOUDFLARE_ACCESS_AUD'],
        setupSteps: ['Create Access application and policies for admin/private routes.', 'Record allowed users, groups, and service-token needs.'],
        verification: ['Confirm protected route requires Access in a browser or curl flow.', 'Record Access audience/tag values without storing secrets in app tables.'],
        blockerNotes: ['Access auth is separate from Better Auth and Supabase Auth user identity.'],
      };
    case 'vercel':
      return {
        envVars: ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_ORG_ID'],
        setupSteps: ['Link the project to the intended Vercel team.', 'Map preview and production envs before enabling deploy automation.'],
        verification: ['Run vercel project ls or a deploy dry-run.', 'Record preview URL and deployment status.'],
        blockerNotes: ['Vercel is blocked without team/project identity and deploy token scope.'],
      };
    case 'coolify':
      return {
        envVars: ['COOLIFY_URL', 'COOLIFY_TOKEN', 'COOLIFY_PROJECT_UUID', 'COOLIFY_RESOURCE_UUID'],
        setupSteps: ['Create or select Coolify project/resource.', 'Decide whether Coolify owns app, Postgres, worker, and background services.'],
        verification: ['Call the Coolify API for the selected resource.', 'Record deployment status and service URL.'],
        blockerNotes: ['Coolify deploy and Postgres-on-Coolify are separate setup checks.'],
      };
    case 'hostinger':
      return {
        envVars: ['HOSTINGER_VPS_HOST', 'HOSTINGER_SSH_USER', 'HOSTINGER_SSH_KEY_REF'],
        setupSteps: ['Record the VPS host and SSH access path.', 'Decide whether Hostinger runs Coolify, direct Docker, or static hosting.'],
        verification: ['Run a non-mutating SSH command or provider inventory check.', 'Record server path, user, and deployment target.'],
        blockerNotes: ['Hostinger is blocked until SSH and target runtime are explicit.'],
      };
    case 'supabase-database':
      return {
        envVars: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_PROJECT_REF'],
        setupSteps: ['Create or select the Supabase project.', 'Review RLS, migrations, storage, realtime, and edge-function needs.'],
        verification: ['Run a Supabase CLI project/status check.', 'Apply migrations only after reviewing generated database files.'],
        blockerNotes: ['Service role keys must stay in secret storage and server-only envs.'],
      };
    case 'supabase-auth':
      return {
        envVars: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
        setupSteps: ['Choose Supabase Auth providers, redirect URLs, and email settings.', 'Document user/session ownership versus app-specific authorization tables.'],
        verification: ['Run a sign-in/sign-out smoke in preview.', 'Confirm redirect URLs for local, preview, and production.'],
        blockerNotes: ['Supabase Auth should not be conflated with Supabase database migration proof.'],
      };
    case 'convex':
      return {
        envVars: ['CONVEX_DEPLOYMENT', 'NEXT_PUBLIC_CONVEX_URL'],
        setupSteps: ['Create or link the Convex deployment.', 'Translate database entities into Convex schema/functions instead of SQL migrations.'],
        verification: ['Run convex dev or deploy dry-run.', 'Record generated Convex deployment URL.'],
        blockerNotes: ['Convex deploy remains blocked until the generated schema/functions are reviewed and the Convex CLI is connected.'],
      };
    case 'postgres-coolify':
      return {
        envVars: ['DATABASE_URL', 'POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_DATABASE'],
        setupSteps: ['Create the Coolify Postgres service and backup policy.', 'Decide extension, migration, and connection-pooling requirements.'],
        verification: ['Run a read-only psql connection check.', 'Record backup and restore procedure before production writes.'],
        blockerNotes: ['Database credentials must not be stored in app tables or generated docs.'],
      };
    case 'stripe':
      return {
        envVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'STRIPE_CUSTOMER_PORTAL_URL'],
        setupSteps: ['Create products, prices, and customer portal configuration.', 'Create local, preview, and production webhooks.'],
        verification: ['Run Stripe CLI webhook forwarding locally.', 'Complete a test checkout and record webhook delivery proof.'],
        blockerNotes: ['Payments are blocked until webhook signing and price ids are explicit.'],
      };
    case 'linear':
      return {
        envVars: ['LINEAR_API_KEY', 'LINEAR_TEAM_ID', 'LINEAR_PROJECT_ID'],
        setupSteps: ['Select team, project, labels, and issue templates.', 'Decide whether planning handoffs create issues directly or draft first.'],
        verification: ['Run a read-only Linear team/project query.', 'Record created issue URLs when handoff runs.'],
        blockerNotes: ['Linear writes need explicit team/project ids.'],
      };
    case 'google-docs':
      return {
        envVars: ['GOOGLE_DOCS_FOLDER_ID', 'GOOGLE_DOCS_TITLE_PREFIX'],
        setupSteps: ['Select the destination folder and sharing policy.', 'Decide whether generated handoffs are private drafts or shared docs.'],
        verification: ['Run a read-only folder/doc lookup.', 'Record created document URL after handoff.'],
        blockerNotes: ['Google Docs writes are blocked until folder and auth scope are explicit.'],
      };
    case 'codex':
      return {
        envVars: ['CODEX_AGENT_PROFILE', 'CODEX_WORKSPACE_ROOT'],
        setupSteps: ['Document Codex workspace, allowed tools, and repo entrypoint.', 'Keep autonomous actions bounded by plan actions and execution artifacts.'],
        verification: ['Record the Codex workspace path and validation commands.', 'Confirm CLI/UI parity for new Open Design capabilities.'],
        blockerNotes: ['Codex setup is blocked if the workspace path or agent permissions are unclear.'],
      };
    case 'cloudflare-ai-gateway':
      return {
        envVars: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID', 'CLOUDFLARE_AI_GATEWAY_URL'],
        setupSteps: ['Create or select AI Gateway and provider routing policies.', 'Document cache, logging, budget, and fallback expectations.'],
        verification: ['Run a gateway request against a test model.', 'Record gateway URL and provider route proof.'],
        blockerNotes: ['AI Gateway proof is separate from Cloudflare hosting proof.'],
      };
    case 'ollama-cloud':
      return {
        envVars: ['OLLAMA_CLOUD_API_KEY', 'OLLAMA_CLOUD_BASE_URL', 'OLLAMA_CLOUD_MODEL'],
        setupSteps: ['Select hosted Ollama models and fallback policy.', 'Document latency, cost, and local-development behavior.'],
        verification: ['Run a small model request through the configured base URL.', 'Record model id and response metadata.'],
        blockerNotes: ['Ollama Cloud is blocked until base URL, key, and model id are explicit.'],
      };
    case 'openrouter':
      return {
        envVars: ['OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_APP_URL'],
        setupSteps: ['Select default and fallback models.', 'Document app attribution and budget limits.'],
        verification: ['Run a low-cost model request and record model/provider metadata.', 'Confirm fallback behavior for unavailable models.'],
        blockerNotes: ['OpenRouter setup is blocked until routing and spend policy are accepted.'],
      };
    case 'trigger-dev':
      return {
        envVars: ['TRIGGER_SECRET_KEY', 'TRIGGER_PROJECT_REF', 'TRIGGER_API_URL'],
        setupSteps: ['Create Trigger.dev project and environments.', 'Map long-running jobs, schedules, retries, and idempotency keys.'],
        verification: ['Run a dev task or list project environments.', 'Record task run URL after the first workflow execution.'],
        blockerNotes: ['Long-standing workflows are blocked until retry and payload-retention policy are explicit.'],
      };
    case 'onepassword':
      return {
        envVars: ['OP_SERVICE_ACCOUNT_TOKEN', 'OP_VAULT', 'OP_CONNECT_HOST'],
        setupSteps: ['Create vault/items for provider secrets.', 'Map each generated env variable to a 1Password item field.'],
        verification: ['Run op whoami or read a non-secret item field.', 'Record vault/item names, never secret values.'],
        blockerNotes: ['Provider setup is blocked until secrets have a durable source of truth.'],
      };
    case 'composio':
      return {
        envVars: ['COMPOSIO_API_KEY', 'COMPOSIO_ENTITY_ID'],
        setupSteps: ['Create Composio entity and select external toolkits.', 'Document which provider actions run through Composio versus native CLIs.'],
        verification: ['Run a toolkit/entity read check.', 'Record connected account status before agent workflows use it.'],
        blockerNotes: ['Composio is blocked until entity and connected account ownership are explicit.'],
      };
    case 'supermemory':
      return {
        envVars: ['SUPERMEMORY_API_KEY', 'SUPERMEMORY_PROJECT_ID'],
        setupSteps: ['Create memory project and retention policy.', 'Decide what project context can be persisted and what must be excluded.'],
        verification: ['Run a write/read smoke with non-sensitive test content.', 'Record retention and deletion policy.'],
        blockerNotes: ['Memory setup is blocked until sensitive-data boundaries are accepted.'],
      };
    case 'better-auth':
      return {
        envVars: ['BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'],
        setupSteps: ['Choose providers, session storage, and adapter.', 'Confirm Better-T-Stack scaffold flags match selected auth/database decisions.'],
        verification: ['Run local sign-in/sign-out smoke.', 'Confirm callback URLs for local, preview, and production.'],
        blockerNotes: ['Auth setup is blocked until session storage and provider redirects are explicit.'],
      };
  }
  const exhaustive: never = toolId;
  throw new Error(`Unsupported provider setup tool: ${exhaustive}`);
}

function buildDesignContext(plan: ProjectPlan): {
  section?: ProjectWorkspaceSection;
  answer?: ProjectSectionAnswer;
  lanes: PlanningAgentLane[];
  questions: IdeationQuestion[];
} {
  const section = plan.workspaceSections.find((item) => item.id === 'design');
  const laneIds = new Set(section?.relatedLaneIds ?? []);
  const lanes = plan.agentLanes.filter((lane) => lane.sectionId === 'design' || laneIds.has(lane.id));
  const questions = plan.ideationQuestions.filter((question) => laneIds.has(question.laneId));
  return {
    ...(section ? { section } : {}),
    ...(plan.sectionAnswers.design ? { answer: plan.sectionAnswers.design } : {}),
    lanes,
    questions,
  };
}

function buildDesignScreenInventory(plan: ProjectPlan): string[] {
  const screens = [
    'Project planning dashboard with section status, pointed questions, and accepted decisions.',
    'Design section workspace with flow map, screen inventory, state checklist, and acceptance criteria.',
    'Database section workspace with entities, relationships, migration order, and provider notes.',
    'Integrations section workspace with connected-account mapping, auth ownership, and webhook states.',
    'AI section workspace with model/runtime routing, memory, and safety boundaries.',
    'Workflows section workspace with long-running jobs, retries, schedules, and run history.',
    'Delivery section workspace with scaffold, repository, deployment, migration, and handoff proof.',
  ];
  if (plan.selectedTools.some((tool) => tool.toolId === 'stripe')) {
    screens.push('Payments setup view with products, prices, customer state, and webhook verification.');
  }
  if (plan.selectedTools.some((tool) => ['linear', 'github-issues', 'google-docs'].includes(tool.toolId))) {
    screens.push('Project-management handoff view showing target, generated work items, and external proof.');
  }
  return screens;
}

function buildDesignStateChecklist(plan: ProjectPlan): string[] {
  return [
    'Not started: section exists but has no accepted answers.',
    'Drafting: pointed questions are visible and editable.',
    'Answered: accepted decisions are stored and reflected in generated actions.',
    'Blocked: missing provider configuration, auth, credentials, or target directory is explicit.',
    'Ready: an action can run and shows its preconditions before confirmation.',
    'Running: active section-agent or execution action shows progress without hiding previous proof.',
    'Completed: artifacts, command evidence, and next steps are linked from execution history.',
    `Database-specific: ${plan.databaseDesign.primaryStore} migration and schema states are represented separately from UI state.`,
  ];
}

function buildDesignProviderConstraints(plan: ProjectPlan): string[] {
  const constraints = plan.providerCapabilities.flatMap((snapshot) =>
    snapshot.planningImplications.slice(0, 2).map((item) => `${snapshot.toolId}: ${item}`),
  );
  if (constraints.length > 0) return constraints;
  return [
    'Refresh provider capability snapshots before treating provider-specific UI or workflow assumptions as current.',
    'Keep provider setup blockers visible until a live check or execution artifact records proof.',
  ];
}

function formatBullets(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ['- None recorded.'];
}

function formatNumbered(items: string[]): string[] {
  return items.map((item, index) => `${index + 1}. ${item}`);
}

function buildDatabasePlanMarkdown(plan: ProjectPlan): string {
  const db = plan.databaseDesign;
  return [
    '# Database Plan',
    '',
    `Project: ${plan.name}`,
    `Primary store: ${db.primaryStore}`,
    `Mode: ${db.mode}`,
    '',
    '## Entities',
    ...db.entities.map((item) => `- ${item}`),
    '',
    '## Relationships',
    ...db.relationships.map((item) => `- ${item}`),
    '',
    '## Access Patterns',
    ...db.accessPatterns.map((item) => `- ${item}`),
    '',
    '## Migration Order',
    ...db.migrations.map((item) => `- ${item}`),
    '',
    '## Risk Notes',
    ...db.riskNotes.map((item) => `- ${item}`),
    '',
    '## Draft Schema',
    '',
    buildDatabaseDraftArtifactContent(plan),
  ].join('\n');
}

function buildDatabaseReadme(plan: ProjectPlan): string {
  const primaryStore = plan.databaseDesign.primaryStore;
  const providerNote = primaryStore === 'cloudflare-d1'
    ? 'Cloudflare D1 uses SQLite-compatible migrations. Keep authorization in the API layer or Cloudflare Access unless a higher-level auth layer enforces tenant boundaries.'
    : primaryStore === 'supabase'
      ? 'Supabase/Postgres supports RLS. Review the generated policies before applying the migration to a live project.'
      : primaryStore === 'postgres-coolify'
        ? 'Self-hosted Postgres on Coolify needs extension setup, backups, and RLS policy review before production use.'
        : primaryStore === 'convex'
          ? 'Convex uses schema and function files instead of SQL migrations. Review generated convex/schema.ts and convex/planning.ts before deploying.'
          : 'No SQL store is selected. Use schema-notes.md to decide whether the project needs a database.';
  return [
    '# Database Workspace',
    '',
    `Generated from Open Design plan: ${plan.name}`,
    '',
    providerNote,
    '',
    '## Files',
    '- docs/database-plan.md: accepted database planning artifact.',
    isSqlDatabase(primaryStore)
      ? '- db/migrations/0001_planning_schema.sql: first SQL-compatible planning migration.'
      : '- db/schema-notes.md: non-SQL schema implementation notes.',
    '',
    '## Next Steps',
    '- Review tenant ownership and auth assumptions.',
    '- Apply migrations only after connecting the real provider project.',
    '- Store provider secrets in the selected secret manager, not in repository files.',
  ].join('\n');
}

function buildDatabaseSchemaNotes(plan: ProjectPlan): string {
  return [
    '# Database Schema Notes',
    '',
    `Primary store: ${plan.databaseDesign.primaryStore}`,
    '',
    'This plan does not target a SQL-compatible migration file. Translate the entities and relationships below into the selected provider schema.',
    '',
    '## Entities',
    ...plan.databaseDesign.entities.map((item) => `- ${item}`),
    '',
    '## Access Policies',
    '- Tenant data must be scoped by organization or project membership.',
    '- Integration credentials should reference external secret storage instead of storing raw secrets.',
  ].join('\n');
}

function buildConvexSchemaTs(plan: ProjectPlan): string {
  return [
    'import { defineSchema, defineTable } from "convex/server";',
    'import { v } from "convex/values";',
    '',
    '// Generated by Open Design planning. Review authorization rules in functions before deploying.',
    `// Plan: ${plan.name}`,
    '',
    'export default defineSchema({',
    '  organizations: defineTable({',
    '    name: v.string(),',
    '    createdAt: v.number(),',
    '  }).index("by_name", ["name"]),',
    '',
    '  organizationMemberships: defineTable({',
    '    organizationId: v.id("organizations"),',
    '    userId: v.string(),',
    '    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),',
    '    createdAt: v.number(),',
    '  })',
    '    .index("by_organization", ["organizationId"])',
    '    .index("by_user", ["userId"])',
    '    .index("by_organization_user", ["organizationId", "userId"]),',
    '',
    '  projects: defineTable({',
    '    organizationId: v.id("organizations"),',
    '    name: v.string(),',
    '    purpose: v.string(),',
    '    createdAt: v.number(),',
    '  })',
    '    .index("by_organization", ["organizationId"])',
    '    .index("by_organization_name", ["organizationId", "name"]),',
    '',
    '  plans: defineTable({',
    '    projectId: v.id("projects"),',
    '    status: v.union(v.literal("draft"), v.literal("reviewing"), v.literal("accepted"), v.literal("blocked")),',
    '    stack: v.any(),',
    '    sections: v.any(),',
    '    updatedAt: v.number(),',
    '  })',
    '    .index("by_project", ["projectId"])',
    '    .index("by_project_status", ["projectId", "status"]),',
    '',
    '  workflowRuns: defineTable({',
    '    projectId: v.id("projects"),',
    '    provider: v.string(),',
    '    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("blocked"), v.literal("failed")),',
    '    externalRunId: v.optional(v.string()),',
    '    evidence: v.array(v.string()),',
    '    updatedAt: v.number(),',
    '  })',
    '    .index("by_project", ["projectId"])',
    '    .index("by_project_status", ["projectId", "status"])',
    '    .index("by_provider", ["provider"]),',
    '',
    '  integrationConnections: defineTable({',
    '    projectId: v.id("projects"),',
    '    provider: v.string(),',
    '    accountRef: v.optional(v.string()),',
    '    status: v.union(v.literal("wanted"), v.literal("connected"), v.literal("deferred"), v.literal("blocked")),',
    '    updatedAt: v.number(),',
    '  })',
    '    .index("by_project", ["projectId"])',
    '    .index("by_project_provider", ["projectId", "provider"])',
    '    .index("by_status", ["status"]),',
    '',
    '  auditEvents: defineTable({',
    '    projectId: v.optional(v.id("projects")),',
    '    actorId: v.optional(v.string()),',
    '    eventType: v.string(),',
    '    payload: v.any(),',
    '    createdAt: v.number(),',
    '  })',
    '    .index("by_project_created", ["projectId", "createdAt"])',
    '    .index("by_event_type", ["eventType"]),',
    '});',
  ].join('\n');
}

function buildConvexPlanningFunctionsTs(plan: ProjectPlan): string {
  return [
    'import { mutation, query } from "./_generated/server";',
    'import { v } from "convex/values";',
    '',
    '// Generated by Open Design planning. Replace placeholder identity checks before production use.',
    `// Plan: ${plan.name}`,
    '',
    'async function requireProjectAccess(ctx: any, projectId: string) {',
    '  const project = await ctx.db.get(projectId);',
    '  if (!project) throw new Error("Project not found");',
    '  // TODO: Check organizationMemberships against the authenticated user before returning data.',
    '  return project;',
    '}',
    '',
    'export const listPlansByProject = query({',
    '  args: { projectId: v.id("projects") },',
    '  handler: async (ctx, args) => {',
    '    await requireProjectAccess(ctx, args.projectId);',
    '    return ctx.db',
    '      .query("plans")',
    '      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))',
    '      .collect();',
    '  },',
    '});',
    '',
    'export const upsertIntegrationConnection = mutation({',
    '  args: {',
    '    projectId: v.id("projects"),',
    '    provider: v.string(),',
    '    accountRef: v.optional(v.string()),',
    '    status: v.union(v.literal("wanted"), v.literal("connected"), v.literal("deferred"), v.literal("blocked")),',
    '  },',
    '  handler: async (ctx, args) => {',
    '    await requireProjectAccess(ctx, args.projectId);',
    '    const existing = await ctx.db',
    '      .query("integrationConnections")',
    '      .withIndex("by_project_provider", (q) => q.eq("projectId", args.projectId).eq("provider", args.provider))',
    '      .first();',
    '    const patch = {',
    '      accountRef: args.accountRef,',
    '      status: args.status,',
    '      updatedAt: Date.now(),',
    '    };',
    '    if (existing) {',
    '      await ctx.db.patch(existing._id, patch);',
    '      return existing._id;',
    '    }',
    '    return ctx.db.insert("integrationConnections", {',
    '      projectId: args.projectId,',
    '      provider: args.provider,',
    '      ...patch,',
    '    });',
    '  },',
    '});',
    '',
    'export const recordWorkflowRun = mutation({',
    '  args: {',
    '    projectId: v.id("projects"),',
    '    provider: v.string(),',
    '    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("blocked"), v.literal("failed")),',
    '    externalRunId: v.optional(v.string()),',
    '    evidence: v.array(v.string()),',
    '  },',
    '  handler: async (ctx, args) => {',
    '    await requireProjectAccess(ctx, args.projectId);',
    '    return ctx.db.insert("workflowRuns", {',
    '      projectId: args.projectId,',
    '      provider: args.provider,',
    '      status: args.status,',
    '      externalRunId: args.externalRunId,',
    '      evidence: args.evidence,',
    '      updatedAt: Date.now(),',
    '    });',
    '  },',
    '});',
  ].join('\n');
}

function buildDatabaseMigrationSql(plan: ProjectPlan): string {
  if (plan.databaseDesign.primaryStore === 'cloudflare-d1') return buildD1MigrationSql(plan);
  return buildPostgresMigrationSql(plan);
}

function buildPostgresMigrationSql(plan: ProjectPlan): string {
  return [
    '-- Generated by Open Design planning. Review before applying to a live database.',
    'create extension if not exists "pgcrypto";',
    '',
    'create table if not exists organizations (',
    '  id uuid primary key default gen_random_uuid(),',
    '  name text not null,',
    '  created_at timestamptz not null default now()',
    ');',
    '',
    'create table if not exists organization_memberships (',
    '  organization_id uuid not null references organizations(id) on delete cascade,',
    '  user_id uuid not null,',
    '  role text not null default \'member\',',
    '  created_at timestamptz not null default now(),',
    '  primary key (organization_id, user_id)',
    ');',
    '',
    'create table if not exists projects (',
    '  id uuid primary key default gen_random_uuid(),',
    '  organization_id uuid not null references organizations(id) on delete cascade,',
    '  name text not null,',
    '  purpose text not null default \'\',',
    '  created_at timestamptz not null default now()',
    ');',
    '',
    'create table if not exists plans (',
    '  id uuid primary key default gen_random_uuid(),',
    '  project_id uuid not null references projects(id) on delete cascade,',
    '  status text not null default \'draft\',',
    '  stack jsonb not null default \'{}\'::jsonb,',
    '  sections jsonb not null default \'{}\'::jsonb,',
    '  created_at timestamptz not null default now(),',
    '  updated_at timestamptz not null default now()',
    ');',
    '',
    'create table if not exists workflow_runs (',
    '  id uuid primary key default gen_random_uuid(),',
    '  project_id uuid not null references projects(id) on delete cascade,',
    '  provider text not null,',
    '  status text not null default \'queued\',',
    '  evidence jsonb not null default \'[]\'::jsonb,',
    '  created_at timestamptz not null default now(),',
    '  updated_at timestamptz not null default now()',
    ');',
    '',
    'create table if not exists integration_connections (',
    '  id uuid primary key default gen_random_uuid(),',
    '  project_id uuid not null references projects(id) on delete cascade,',
    '  provider text not null,',
    '  status text not null default \'blocked\',',
    '  external_ref text,',
    '  created_at timestamptz not null default now(),',
    '  updated_at timestamptz not null default now()',
    ');',
    '',
    'create table if not exists audit_events (',
    '  id uuid primary key default gen_random_uuid(),',
    '  project_id uuid references projects(id) on delete set null,',
    '  actor_id uuid,',
    '  event_type text not null,',
    '  payload jsonb not null default \'{}\'::jsonb,',
    '  created_at timestamptz not null default now()',
    ');',
    '',
    'create index if not exists projects_organization_id_idx on projects(organization_id);',
    'create index if not exists plans_project_id_status_idx on plans(project_id, status);',
    'create index if not exists workflow_runs_project_id_status_idx on workflow_runs(project_id, status);',
    'create index if not exists integration_connections_project_id_provider_idx on integration_connections(project_id, provider);',
    'create index if not exists audit_events_project_id_created_at_idx on audit_events(project_id, created_at desc);',
    '',
    'alter table organizations enable row level security;',
    'alter table organization_memberships enable row level security;',
    'alter table projects enable row level security;',
    'alter table plans enable row level security;',
    'alter table workflow_runs enable row level security;',
    'alter table integration_connections enable row level security;',
    'alter table audit_events enable row level security;',
  ].join('\n');
}

function buildD1MigrationSql(plan: ProjectPlan): string {
  return [
    '-- Generated by Open Design planning for Cloudflare D1. Review before applying.',
    `-- Plan: ${plan.name}`,
    '',
    'create table if not exists organizations (',
    '  id text primary key,',
    '  name text not null,',
    '  created_at integer not null',
    ');',
    '',
    'create table if not exists organization_memberships (',
    '  organization_id text not null references organizations(id) on delete cascade,',
    '  user_id text not null,',
    '  role text not null default \'member\',',
    '  created_at integer not null,',
    '  primary key (organization_id, user_id)',
    ');',
    '',
    'create table if not exists projects (',
    '  id text primary key,',
    '  organization_id text not null references organizations(id) on delete cascade,',
    '  name text not null,',
    '  purpose text not null default \'\',',
    '  created_at integer not null',
    ');',
    '',
    'create table if not exists plans (',
    '  id text primary key,',
    '  project_id text not null references projects(id) on delete cascade,',
    '  status text not null default \'draft\',',
    '  stack_json text not null default \'{}\',',
    '  sections_json text not null default \'{}\',',
    '  created_at integer not null,',
    '  updated_at integer not null',
    ');',
    '',
    'create table if not exists workflow_runs (',
    '  id text primary key,',
    '  project_id text not null references projects(id) on delete cascade,',
    '  provider text not null,',
    '  status text not null default \'queued\',',
    '  evidence_json text not null default \'[]\',',
    '  created_at integer not null,',
    '  updated_at integer not null',
    ');',
    '',
    'create table if not exists integration_connections (',
    '  id text primary key,',
    '  project_id text not null references projects(id) on delete cascade,',
    '  provider text not null,',
    '  status text not null default \'blocked\',',
    '  external_ref text,',
    '  created_at integer not null,',
    '  updated_at integer not null',
    ');',
    '',
    'create table if not exists audit_events (',
    '  id text primary key,',
    '  project_id text references projects(id) on delete set null,',
    '  actor_id text,',
    '  event_type text not null,',
    '  payload_json text not null default \'{}\',',
    '  created_at integer not null',
    ');',
    '',
    'create index if not exists projects_organization_id_idx on projects(organization_id);',
    'create index if not exists plans_project_id_status_idx on plans(project_id, status);',
    'create index if not exists workflow_runs_project_id_status_idx on workflow_runs(project_id, status);',
    'create index if not exists integration_connections_project_id_provider_idx on integration_connections(project_id, provider);',
    'create index if not exists audit_events_project_id_created_at_idx on audit_events(project_id, created_at desc);',
  ].join('\n');
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
  handoffWrites: ProjectMaterializedWrite[],
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
      'Generated handoff files:',
      ...(handoffWrites.length
        ? handoffWrites.map((write) => `- ${write.relativePath} (${write.bytes} bytes)`)
        : ['- None written.']),
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
  invocation: DeployCommandInvocation | null,
  result: DeployCommandResult,
  status: PlanningExecutionRun['status'],
  previewUrl?: string,
  healthCheck?: DeploymentHealthCheck,
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
      invocation ? `Command: ${invocation.displayCommand}` : 'Command: not available for this delivery target yet',
      `Source directory: ${sourceDir}`,
      previewUrl ? `Preview URL: ${previewUrl}` : '',
      healthCheck ? `Health check: ${healthCheck.ok ? 'ok' : 'failed'}` : '',
      healthCheck?.statusCode ? `Health status: ${healthCheck.statusCode}` : '',
      healthCheck?.finalUrl ? `Health final URL: ${healthCheck.finalUrl}` : '',
      healthCheck?.error ? `Health error: ${healthCheck.error}` : '',
      healthCheck ? `Health duration ms: ${healthCheck.durationMs}` : '',
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

function buildDatabaseMaterializeArtifact(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  runId: string,
  sourceDir: string,
  writes: ProjectMaterializedWrite[],
): PlanningExecutionArtifact {
  return {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'database-materialization',
    title: `${action.label} execution log`,
    content: [
      `Plan: ${plan.name}`,
      'Status: completed',
      `Source directory: ${sourceDir}`,
      `Primary store: ${plan.databaseDesign.primaryStore}`,
      '',
      'Generated files:',
      ...writes.map((write) => `- ${write.relativePath} (${write.bytes} bytes)`),
      '',
      'Review notes:',
      '- Confirm tenant ownership and auth assumptions before applying migrations.',
      '- Keep provider secrets in the selected secret manager, not in generated files.',
    ].join('\n'),
    createdAt: Date.now(),
  };
}

function buildDesignMaterializeArtifact(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  runId: string,
  sourceDir: string,
  writes: ProjectMaterializedWrite[],
): PlanningExecutionArtifact {
  const designAnswer = plan.sectionAnswers.design;
  return {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'design-materialization',
    title: `${action.label} execution log`,
    content: [
      `Plan: ${plan.name}`,
      'Status: completed',
      `Source directory: ${sourceDir}`,
      `Design answer status: ${designAnswer?.status ?? 'not_started'}`,
      '',
      'Generated files:',
      ...writes.map((write) => `- ${write.relativePath} (${write.bytes} bytes)`),
      '',
      'Review notes:',
      '- Confirm generated flows match the intended MVP before implementation.',
      '- Keep planning, design, database, integrations, AI, workflows, and delivery as distinct product surfaces.',
      '- Validate responsive and accessibility states before treating the scaffold as ready for users.',
    ].join('\n'),
    createdAt: Date.now(),
  };
}

function buildProviderSetupArtifact(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  runId: string,
  sourceDir: string,
  writes: ProjectMaterializedWrite[],
  invocations: ProviderSetupCommandInvocation[],
  executions: ProviderSetupCommandExecution[],
  status: PlanningExecutionRun['status'],
): PlanningExecutionArtifact {
  const executionBlocks = executions.length > 0
    ? executions.flatMap(({ invocation, result }) => [
      `Provider: ${invocation.toolId}`,
      `Command: ${invocation.displayCommand}`,
      `Exit code: ${result.exitCode}`,
      `Duration ms: ${result.durationMs}`,
      '',
      'stdout:',
      result.stdout || '(empty)',
      '',
      'stderr:',
      result.stderr || '(empty)',
      '',
    ])
    : [
      invocations.length > 0
        ? 'Provider validation was requested, but no command results were recorded.'
        : 'Provider validation was not requested for this setup run.',
      '',
    ];
  return {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'provider-setup',
    title: `${action.label} execution log`,
    content: [
      `Plan: ${plan.name}`,
      `Status: ${status}`,
      `Source directory: ${sourceDir}`,
      `Selected providers: ${plan.selectedTools.map((tool) => tool.toolId).join(', ') || 'none'}`,
      `Provider validation: ${invocations.length > 0 ? `${invocations.length} command(s)` : 'not requested'}`,
      '',
      'Generated files:',
      ...writes.map((write) => `- ${write.relativePath} (${write.bytes} bytes)`),
      '',
      'Validation commands:',
      ...executionBlocks,
      '',
      'Review notes:',
      '- Store secret values in 1Password or the selected secret manager before populating deploy envs.',
      '- Run provider tool checks or provider-specific CLIs before marking a provider connected.',
      '- Keep setup blockers visible in the planning UI until live proof exists.',
    ].join('\n'),
    createdAt: Date.now(),
  };
}

function buildDatabaseMigrationArtifact(
  plan: ProjectPlan,
  action: PlanningExecutionAction,
  runId: string,
  sourceDir: string,
  invocation: DatabaseMigrationInvocation | null,
  result: DatabaseMigrationCommandResult,
  status: PlanningExecutionRun['status'],
): PlanningExecutionArtifact {
  return {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'database-migration',
    title: `${action.label} execution log`,
    content: [
      `Plan: ${plan.name}`,
      `Status: ${status}`,
      `Primary store: ${plan.databaseDesign.primaryStore}`,
      `Source directory: ${sourceDir}`,
      invocation ? `Command: ${invocation.displayCommand}` : 'Command: not available for this database target',
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
      env: { ...process.env, ...(request.env ?? {}) },
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

async function runDeploymentHealthCheck(url: string): Promise<DeploymentHealthCheck> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    return {
      url,
      finalUrl: response.url,
      statusCode: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    };
  } catch (err: any) {
    return {
      url,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: String(err?.message ?? err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProviderSource(url: string): Promise<ProviderSourceFetch> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    const title = extractHtmlTitle(text);
    const excerpt = buildSourceExcerpt(text);
    return {
      url,
      statusCode: response.status,
      ok: response.ok,
      ...(title ? { title } : {}),
      ...(excerpt ? { excerpt } : {}),
      durationMs: Date.now() - startedAt,
    };
  } catch (err: any) {
    return {
      url,
      ok: false,
      error: String(err?.message ?? err),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractHtmlTitle(value: string): string | undefined {
  const match = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1];
  return title ? normalizeWhitespace(stripHtml(title)).slice(0, 160) : undefined;
}

function buildSourceExcerpt(value: string): string | undefined {
  const stripped = normalizeWhitespace(stripHtml(value));
  return stripped ? stripped.slice(0, 240) : undefined;
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function runToolCheckCommand(request: ToolCheckCommandRequest): Promise<ToolCheckCommandResult> {
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
      env: { ...process.env, ...(request.env ?? {}) },
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

function runProviderSetupCommand(request: ProviderSetupCommandRequest): Promise<ProviderSetupCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(request.command, request.args, {
      cwd: request.cwd,
      timeout: request.timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, ...(request.env ?? {}) },
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

function runDatabaseMigrationCommand(request: DatabaseMigrationCommandRequest): Promise<DatabaseMigrationCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(request.command, request.args, {
      cwd: request.cwd,
      timeout: request.timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, ...(request.env ?? {}) },
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

function buildEnvSectionAgentRunner(): SectionAgentRunner | undefined {
  const command = process.env.OD_PLAN_SECTION_AGENT_COMMAND?.trim();
  if (!command) return undefined;
  const args = parseJsonStringArray(process.env.OD_PLAN_SECTION_AGENT_ARGS_JSON, 'OD_PLAN_SECTION_AGENT_ARGS_JSON');
  return (request) => runSectionAgentCommand({
    ...request,
    command,
    args,
  });
}

function parseJsonStringArray(value: string | undefined, label: string): string[] {
  if (!value?.trim()) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a JSON string array`);
  }
  return parsed;
}

function runSectionAgentCommand(request: SectionAgentRunRequest & { command: string; args: string[] }): Promise<SectionAgentRunResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: {
        ...process.env,
        OD_PLAN_ID: request.plan.id,
        OD_PLAN_SECTION_ID: request.section.id,
        OD_PLAN_SECTION_LABEL: request.section.label,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM');
      }
    }, request.timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 2 * 1024 * 1024) stdout = stdout.slice(-2 * 1024 * 1024);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 2 * 1024 * 1024) stderr = stderr.slice(-2 * 1024 * 1024);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        status: 'failed',
        summary: `Section specialist runner failed to start for ${request.section.label}.`,
        output: '',
        evidence: [`runner error: ${error.message}`],
        durationMs: Date.now() - startedAt,
        command: formatCommand(request.command, request.args),
      });
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(normalizeSectionAgentCommandResult({
        code,
        signal,
        stdout,
        stderr,
        sectionLabel: request.section.label,
        durationMs: Date.now() - startedAt,
        command: formatCommand(request.command, request.args),
      }));
    });
    child.stdin.end(JSON.stringify({
      prompt: request.prompt,
      manifest: request.manifest,
    }));
  });
}

function normalizeSectionAgentCommandResult(input: {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  sectionLabel: string;
  durationMs: number;
  command: string;
}): SectionAgentRunResult {
  const parsed = parseSectionAgentJsonOutput(input.stdout);
  const status = parsed?.status ?? (input.code === 0 ? 'completed' : 'failed');
  const output = parsed?.output ?? input.stdout.trim();
  const evidence = [
    `runner exit code: ${input.code ?? 'none'}`,
    ...(input.signal ? [`runner signal: ${input.signal}`] : []),
    ...(parsed?.evidence ?? []),
    ...(input.stderr.trim() ? [`stderr: ${input.stderr.trim().slice(0, 500)}`] : []),
  ];
  return {
    status,
    summary: parsed?.summary ?? (
      input.code === 0
        ? `Executed ${input.sectionLabel} specialist runner.`
        : `Section specialist runner failed for ${input.sectionLabel}.`
    ),
    output,
    evidence,
    durationMs: input.durationMs,
    command: input.command,
  };
}

function parseSectionAgentJsonOutput(value: string): Pick<SectionAgentRunResult, 'status' | 'summary' | 'output' | 'evidence'> | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as Partial<SectionAgentRunResult>;
    const status = parsed.status === 'completed' || parsed.status === 'blocked' || parsed.status === 'failed'
      ? parsed.status
      : 'completed';
    return {
      status,
      summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : 'Executed section specialist runner.',
      output: typeof parsed.output === 'string' ? parsed.output : trimmed,
      evidence: Array.isArray(parsed.evidence)
        ? parsed.evidence.filter((item): item is string => typeof item === 'string')
        : [],
    };
  } catch {
    return undefined;
  }
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

interface SpecialistAgentManifest {
  generatedAt: string;
  plan: {
    id: string;
    name: string;
    purpose: string;
  };
  section: {
    id: ProjectWorkspaceSection['id'];
    label: string;
    purpose: string;
    owns: string[];
    doesNotOwn: string[];
  };
  role: string;
  prompt: string;
  inputs: {
    acceptedAnswers: string[];
    notes?: string;
    pointedQuestions: Array<{
      id: string;
      question: string;
      whyItMatters: string;
      answerType: IdeationQuestion['answerType'];
      options?: string[];
    }>;
    selectedTools: ProjectToolConnection[];
    providerConstraints: string[];
    runtimeSummary: string;
  };
  lanes: Array<{
    id: PlanningAgentLane['id'];
    label: string;
    mode: PlanningAgentLane['mode'];
    status: PlanningAgentLane['status'];
    dependsOn: PlanningAgentLane['dependsOn'];
    parallelWith: PlanningAgentLane['parallelWith'];
    toolIds: PlanningAgentLane['toolIds'];
    brief: string;
    outputs: string[];
    runbook: string[];
  }>;
  dependencies: string[];
  parallelPeers: string[];
  expectedOutputs: string[];
  followUpActions: Array<{
    id: PlanningExecutionAction['id'];
    label: string;
    status: PlanningExecutionAction['status'];
  }>;
}

interface PlanningSectionRunOptions {
  sectionAgentRunner: SectionAgentRunner | undefined;
  scaffoldRoot: string;
}

async function runPlanningSection(
  plan: ProjectPlan,
  section: ProjectWorkspaceSection,
  options: PlanningSectionRunOptions,
): Promise<{ run: PlanningExecutionRun; artifacts: PlanningExecutionArtifact[] }> {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const laneIds = new Set(section.relatedLaneIds);
  const lanes = plan.agentLanes.filter((lane) => lane.sectionId === section.id || laneIds.has(lane.id));
  const questions = plan.ideationQuestions.filter((question) => laneIds.has(question.laneId));
  const answer = plan.sectionAnswers[section.id];
  const databaseDraft = section.id === 'database' ? buildDatabaseDraftArtifactContent(plan) : '';
  const draftArtifact: PlanningExecutionArtifact = {
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
  const manifestArtifact = buildSpecialistAgentManifestArtifact(plan, section, lanes, questions, answer, runId, now);
  const manifest = JSON.parse(manifestArtifact.content) as SpecialistAgentManifest;
  const runnerResult = options.sectionAgentRunner
    ? await options.sectionAgentRunner({
      plan,
      section,
      manifest,
      prompt: manifest.prompt,
      cwd: options.scaffoldRoot,
      timeoutMs: 300_000,
    })
    : undefined;
  if (runnerResult) {
    draftArtifact.content = [
      draftArtifact.content,
      '',
      'Specialist runner output:',
      runnerResult.output || '(runner returned no stdout content)',
    ].join('\n');
  }
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'section-agent',
    sectionId: section.id,
    status: runnerResult?.status ?? 'completed',
    title: `${section.label} planning agent run`,
    mode: runnerResult ? 'external' : 'record-only',
    summary: runnerResult?.summary ?? `Generated a durable ${section.label} section output draft from stored answers, lanes, and provider notes.`,
    ...(runnerResult?.command ? { command: runnerResult.command } : {}),
    startedAt: now,
    completedAt: runnerResult ? now + Math.max(1, runnerResult.durationMs) : now,
    artifactIds: [draftArtifact.id, manifestArtifact.id],
    evidence: [
      `${lanes.length} lane(s) considered`,
      `${questions.length} pointed question(s) attached`,
      answer ? `section answer status: ${answer.status}` : 'no section answer stored yet',
      `specialist manifest: ${manifestArtifact.id}`,
      ...(runnerResult ? runnerResult.evidence : []),
    ],
  };
  return { run, artifacts: [draftArtifact, manifestArtifact] };
}

function buildSpecialistAgentManifestArtifact(
  plan: ProjectPlan,
  section: ProjectWorkspaceSection,
  lanes: PlanningAgentLane[],
  questions: IdeationQuestion[],
  answer: ProjectSectionAnswer | undefined,
  runId: string,
  now: number,
): PlanningExecutionArtifact {
  const relatedToolIds = new Set([
    ...section.toolIds,
    ...lanes.flatMap((lane) => lane.toolIds),
  ]);
  const relatedActions = plan.executionActions.filter((action) => action.relatedSectionIds.includes(section.id));
  const providerConstraints = plan.providerCapabilities
    .filter((snapshot) => relatedToolIds.has(snapshot.toolId))
    .flatMap((snapshot) => [
      `${snapshot.toolId}: ${snapshot.planningImplications[0] ?? snapshot.label}`,
      ...(snapshot.riskNotes[0] ? [`${snapshot.toolId} risk: ${snapshot.riskNotes[0]}`] : []),
    ]);
  const dependencies = uniqueStrings(lanes.flatMap((lane) => lane.dependsOn));
  const parallelPeers = uniqueStrings(lanes.flatMap((lane) => lane.parallelWith));
  const expectedOutputs = uniqueStrings([
    ...lanes.flatMap((lane) => lane.outputs),
    ...relatedActions.flatMap((action) => action.effects),
  ]);
  const prompt = [
    `You are the ${section.label} specialist for the project "${plan.name}".`,
    `Purpose: ${plan.intent.purpose}`,
    `Section boundary: own ${section.owns.join(', ')}; do not own ${section.doesNotOwn.join(', ')}.`,
    'Use the accepted answers and pointed questions as your working context.',
    'Return concrete decisions, blockers, files or artifacts to create, validation steps, and dependencies on other specialist sections.',
  ].join('\n');
  const manifest: SpecialistAgentManifest = {
    generatedAt: new Date(now).toISOString(),
    plan: {
      id: plan.id,
      name: plan.name,
      purpose: plan.intent.purpose,
    },
    section: {
      id: section.id,
      label: section.label,
      purpose: section.purpose,
      owns: section.owns,
      doesNotOwn: section.doesNotOwn,
    },
    role: `${section.label} specialist`,
    prompt,
    inputs: {
      acceptedAnswers: answer?.answers ?? [],
      ...(answer?.notes ? { notes: answer.notes } : {}),
      pointedQuestions: questions.map((question) => ({
        id: question.id,
        question: question.question,
        whyItMatters: question.whyItMatters,
        answerType: question.answerType,
        ...(question.options ? { options: question.options } : {}),
      })),
      selectedTools: plan.selectedTools.filter((tool) => relatedToolIds.has(tool.toolId)),
      providerConstraints,
      runtimeSummary: plan.runtimePlan.summary,
    },
    lanes: lanes.map((lane) => ({
      id: lane.id,
      label: lane.label,
      mode: lane.mode,
      status: lane.status,
      dependsOn: lane.dependsOn,
      parallelWith: lane.parallelWith,
      toolIds: lane.toolIds,
      brief: lane.brief,
      outputs: lane.outputs,
      runbook: lane.runbook,
    })),
    dependencies,
    parallelPeers,
    expectedOutputs,
    followUpActions: relatedActions.map((action) => ({
      id: action.id,
      label: action.label,
      status: action.status,
    })),
  };
  return {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'specialist-agent-manifest',
    title: `${section.label} specialist agent manifest`,
    content: JSON.stringify(manifest, null, 2),
    createdAt: now,
  };
}

function selectSectionsForRun(
  plan: ProjectPlan,
  input: RunProjectPlanSectionsRequest,
): ProjectWorkspaceSection[] {
  const requestedIds = input.sectionIds ? new Set(input.sectionIds) : null;
  const sections = requestedIds
    ? plan.workspaceSections.filter((section) => requestedIds.has(section.id))
    : plan.workspaceSections;
  if (!input.onlyReady) return sections;
  return sections.filter((section) => sectionIsReadyForParallelRun(plan, section));
}

function sectionIsReadyForParallelRun(plan: ProjectPlan, section: ProjectWorkspaceSection): boolean {
  const sectionLaneIds = new Set(section.relatedLaneIds);
  const lanes = plan.agentLanes.filter((lane) => lane.sectionId === section.id || sectionLaneIds.has(lane.id));
  if (lanes.length === 0) return true;
  const readyLaneIds = new Set(plan.agentLanes.filter((lane) => lane.status === 'ready').map((lane) => lane.id));
  return lanes.every((lane) => {
    if (lane.status !== 'ready') return false;
    return lane.dependsOn.every((dependencyId) => readyLaneIds.has(dependencyId));
  });
}

function runPlanningSections(
  plan: ProjectPlan,
  sections: ProjectWorkspaceSection[],
  input: RunProjectPlanSectionsRequest,
  options: PlanningSectionRunOptions,
): Promise<{ runs: PlanningExecutionRun[]; artifacts: PlanningExecutionArtifact[] }> {
  return runPlanningSectionsAsync(plan, sections, input, options);
}

async function runPlanningSectionsAsync(
  plan: ProjectPlan,
  sections: ProjectWorkspaceSection[],
  input: RunProjectPlanSectionsRequest,
  options: PlanningSectionRunOptions,
): Promise<{ runs: PlanningExecutionRun[]; artifacts: PlanningExecutionArtifact[] }> {
  const results = input.mode === 'sequential'
    ? []
    : await Promise.all(sections.map((section) => runPlanningSection(plan, section, options)));
  if (input.mode === 'sequential') {
    for (const section of sections) {
      results.push(await runPlanningSection(plan, section, options));
    }
  }
  const orchestration = buildSectionOrchestrationRun(plan, sections, results.map((result) => result.run), input);
  return {
    runs: [orchestration.run, ...results.map((result) => result.run)],
    artifacts: [orchestration.artifact, ...results.flatMap((result) => result.artifacts)],
  };
}

function buildSectionOrchestrationRun(
  plan: ProjectPlan,
  sections: ProjectWorkspaceSection[],
  childRuns: PlanningExecutionRun[],
  input: RunProjectPlanSectionsRequest,
): { run: PlanningExecutionRun; artifact: PlanningExecutionArtifact } {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const mode = input.mode ?? 'parallel';
  const sectionIds = sections.map((section) => section.id);
  const laneIds = new Set(sections.flatMap((section) => section.relatedLaneIds));
  const lanes = plan.agentLanes.filter((lane) => laneIds.has(lane.id) || (lane.sectionId && sectionIds.includes(lane.sectionId)));
  const parallelLanes = lanes.filter((lane) => lane.mode === 'parallel');
  const blockedDependencies = lanes.flatMap((lane) =>
    lane.dependsOn.filter((dependencyId) => !lanes.some((candidate) => candidate.id === dependencyId)).map((dependencyId) =>
      `${lane.id} depends on ${dependencyId} outside this orchestration`,
    ),
  );
  const artifact: PlanningExecutionArtifact = {
    id: `plan-artifact-${randomUUID()}`,
    planId: plan.id,
    runId,
    kind: 'parallel-orchestration',
    title: `${mode === 'parallel' ? 'Parallel' : 'Sequential'} section orchestration`,
    content: [
      `Plan: ${plan.name}`,
      `Mode: ${mode}`,
      `Only ready: ${input.onlyReady === true ? 'yes' : 'no'}`,
      '',
      'Sections:',
      ...sections.map((section) => `- ${section.id}: ${section.label}`),
      '',
      'Child runs:',
      ...childRuns.map((run) => `- ${run.sectionId ?? '-'}: ${run.id} (${run.status})`),
      '',
      'Lanes:',
      ...lanes.map((lane) => `- ${lane.id}: ${lane.mode}; depends on ${lane.dependsOn.join(', ') || 'none'}; parallel with ${lane.parallelWith.join(', ') || 'none'}`),
      '',
      'Coordination notes:',
      ...(
        blockedDependencies.length > 0
          ? blockedDependencies.map((item) => `- ${item}`)
          : ['- Selected sections can be coordinated without unresolved lane dependencies inside this run.']
      ),
      '- Section-agent outputs remain separate artifacts; this artifact records the orchestration boundary and ordering assumptions.',
    ].join('\n'),
    createdAt: now,
  };
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'orchestration',
    status: 'completed',
    title: `${mode === 'parallel' ? 'Parallel' : 'Sequential'} planning section orchestration`,
    mode: 'record-only',
    summary: `${mode === 'parallel' ? 'Coordinated' : 'Sequenced'} ${sections.length} section agent run(s) with ${parallelLanes.length} parallel lane(s).`,
    startedAt: now,
    completedAt: now,
    artifactIds: [artifact.id, ...childRuns.flatMap((child) => child.artifactIds)],
    evidence: [
      `mode: ${mode}`,
      `sections: ${sectionIds.join(', ')}`,
      `childRuns: ${childRuns.length}`,
      `parallelLanes: ${parallelLanes.map((lane) => lane.id).join(', ') || 'none'}`,
      ...(blockedDependencies.length > 0 ? blockedDependencies : ['dependencies resolved inside selected run']),
    ],
  };
  return { run, artifact };
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

async function checkPlanningTool(
  plan: ProjectPlan,
  toolId: PlanningToolCheck['toolId'],
  options: { toolCheckRunner: ToolCheckCommandRunner },
): Promise<{
  run: PlanningExecutionRun;
  toolCheck: PlanningToolCheck;
  artifacts: PlanningExecutionArtifact[];
  selectedTools: ProjectToolConnection[];
}> {
  const now = Date.now();
  const runId = `plan-run-${randomUUID()}`;
  const snapshot = plan.providerCapabilities.find((item) => item.toolId === toolId);
  const tool = APPROVED_TOOLS.find((item) => item.id === toolId);
  const liveInvocation = buildToolCheckInvocation(plan, toolId);
  let status: PlanningToolCheck['status'];
  let evidence: string[];
  let mode: PlanningExecutionRun['mode'] = 'record-only';
  let command: string | undefined;
  if (liveInvocation) {
    const result = await options.toolCheckRunner({
      command: liveInvocation.command,
      args: liveInvocation.args,
      cwd: process.cwd(),
      timeoutMs: 60_000,
    });
    status = result.exitCode === 0 ? 'connected' : 'blocked';
    command = [liveInvocation.command, ...liveInvocation.args].join(' ');
    mode = 'external';
    evidence = [
      `Command: ${command}`,
      `Exit code: ${result.exitCode}`,
      result.stdout ? `stdout: ${result.stdout.slice(0, 500)}` : 'stdout: (empty)',
      result.stderr ? `stderr: ${result.stderr.slice(0, 500)}` : 'stderr: (empty)',
      `Duration ms: ${result.durationMs}`,
    ];
    if (snapshot) evidence.push(`Provider snapshot: ${snapshot.sourceUrl}`);
  } else {
    status = snapshot ? 'connected' : 'blocked';
    evidence = snapshot
      ? [
        `Provider snapshot available: ${snapshot.sourceUrl}`,
        `Checked at ${snapshot.checkedAt}`,
        ...snapshot.planningImplications.slice(0, 2),
      ]
      : [
        'No provider snapshot is attached to this plan for the requested tool.',
        'Select the tool or refresh provider capabilities before relying on this provider.',
      ];
  }
  const toolCheck: PlanningToolCheck = {
    id: `tool-check-${randomUUID()}`,
    planId: plan.id,
    toolId,
    status,
    summary: status === 'connected'
      ? liveInvocation
        ? `${tool?.label ?? toolId} responded to a live provider check.`
        : `${tool?.label ?? toolId} has planning evidence attached to this plan.`
      : liveInvocation
        ? `${tool?.label ?? toolId} live provider check failed.`
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
    content: [
      `Tool: ${tool?.label ?? toolId}`,
      `Status: ${status}`,
      liveInvocation ? 'Mode: live provider check' : 'Mode: planning evidence fallback',
      ...(command ? [`Command: ${command}`] : []),
      '',
      ...evidence.map((item) => `- ${item}`),
    ].join('\n'),
    createdAt: now,
  };
  const run: PlanningExecutionRun = {
    id: runId,
    planId: plan.id,
    kind: 'tool-check',
    toolId,
    status: status === 'connected' ? 'completed' : 'blocked',
    title: `${tool?.label ?? toolId} tool check`,
    mode,
    summary: toolCheck.summary,
    ...(command ? { command } : {}),
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

function buildToolCheckInvocation(
  plan: ProjectPlan,
  toolId: PlanningToolCheck['toolId'],
): { command: string; args: string[] } | null {
  switch (toolId) {
    case 'github':
    case 'github-issues':
      return { command: 'gh', args: ['auth', 'status'] };
    case 'cloudflare-hosting':
    case 'cloudflare-data':
    case 'cloudflare-access':
    case 'cloudflare-ai-gateway':
      return buildCloudflareToolCheckInvocation(plan.stack.packageManager);
    case 'vercel':
      return { command: 'vercel', args: ['whoami'] };
    case 'onepassword':
      return { command: 'op', args: ['whoami'] };
    case 'supabase-database':
    case 'supabase-auth':
      return { command: 'supabase', args: ['projects', 'list'] };
    case 'trigger-dev':
      return { command: 'npx', args: ['trigger.dev@latest', 'whoami'] };
    default:
      return null;
  }
}

function buildCloudflareToolCheckInvocation(packageManager: ProjectStackDecision['packageManager']): { command: string; args: string[] } {
  switch (packageManager ?? 'pnpm') {
    case 'npm':
      return { command: 'npx', args: ['wrangler', 'whoami'] };
    case 'yarn':
      return { command: 'yarn', args: ['wrangler', 'whoami'] };
    case 'bun':
      return { command: 'bunx', args: ['wrangler', 'whoami'] };
    case 'pnpm':
    default:
      return { command: 'pnpm', args: ['wrangler', 'whoami'] };
  }
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
