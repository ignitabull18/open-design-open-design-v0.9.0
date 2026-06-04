export type PlanningToolKind =
  | 'source-control'
  | 'hosting'
  | 'database'
  | 'payments'
  | 'project-management'
  | 'ai-runtime'
  | 'secrets'
  | 'integrations'
  | 'memory'
  | 'authentication';

export type PlanningToolId =
  | 'github'
  | 'cloudflare-hosting'
  | 'cloudflare-data'
  | 'cloudflare-access'
  | 'vercel'
  | 'coolify'
  | 'hostinger'
  | 'supabase-database'
  | 'supabase-auth'
  | 'convex'
  | 'postgres-coolify'
  | 'stripe'
  | 'linear'
  | 'github-issues'
  | 'google-docs'
  | 'codex'
  | 'cloudflare-ai-gateway'
  | 'ollama-cloud'
  | 'openrouter'
  | 'onepassword'
  | 'composio'
  | 'supermemory'
  | 'better-auth';

export interface PlanningToolOption {
  id: PlanningToolId;
  kind: PlanningToolKind;
  label: string;
  notes: string;
}

export interface ProjectIntentBrief {
  purpose: string;
  audience?: string;
  problem?: string;
  successCriteria?: string[];
  constraints?: string[];
}

export interface ProjectStackDecision {
  frontend?: 'next' | 'tanstack-router' | 'tanstack-start' | 'astro' | 'none';
  backend?: 'hono' | 'convex' | 'self' | 'none';
  runtime?: 'workers' | 'node' | 'bun' | 'none';
  database?: 'supabase' | 'convex' | 'postgres-coolify' | 'cloudflare-d1' | 'none';
  orm?: 'drizzle' | 'prisma' | 'none';
  api?: 'trpc' | 'orpc' | 'none';
  auth?: 'better-auth' | 'supabase' | 'cloudflare-access' | 'none';
  payments?: 'stripe' | 'none';
  hosting?: Array<'cloudflare' | 'vercel' | 'coolify' | 'hostinger'>;
  packageManager?: 'pnpm' | 'bun' | 'npm' | 'yarn';
  addons?: string[];
}

export interface ProjectToolConnection {
  toolId: PlanningToolId;
  status: 'wanted' | 'connected' | 'deferred' | 'blocked';
  notes?: string;
}

export interface ScaffoldPlan {
  engine: 'better-t-stack' | 'custom';
  command: string;
  postScaffoldTasks: string[];
  docsSources: string[];
}

export interface RepoPlan {
  provider: 'github';
  owner?: string;
  name?: string;
  visibility?: 'private' | 'public';
  url?: string;
  status: 'not_started' | 'planned' | 'created' | 'blocked';
}

export interface DeliveryPlan {
  target: 'cloudflare' | 'vercel' | 'coolify' | 'hostinger';
  status: 'not_started' | 'planned' | 'deployed' | 'blocked';
  notes?: string;
}

export interface ProjectPlan {
  id: string;
  name: string;
  intent: ProjectIntentBrief;
  selectedTools: ProjectToolConnection[];
  stack: ProjectStackDecision;
  scaffold: ScaffoldPlan;
  repo: RepoPlan;
  delivery: DeliveryPlan[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectIdeaOption {
  title: string;
  rationale: string;
  stack: ProjectStackDecision;
  toolIds: PlanningToolId[];
  nextSteps: string[];
}

export interface ProjectIdeationSession {
  id: string;
  planId: string;
  prompt: string;
  summary: string;
  options: ProjectIdeaOption[];
  createdAt: number;
}

export interface CreateProjectPlanRequest {
  name: string;
  intent: ProjectIntentBrief;
  selectedTools?: ProjectToolConnection[];
  stack?: ProjectStackDecision;
  repo?: Partial<RepoPlan>;
  delivery?: DeliveryPlan[];
}

export interface UpdateProjectPlanRequest {
  name?: string;
  intent?: Partial<ProjectIntentBrief>;
  selectedTools?: ProjectToolConnection[];
  stack?: ProjectStackDecision;
  repo?: Partial<RepoPlan>;
  delivery?: DeliveryPlan[];
}

export interface CreateProjectIdeationRequest {
  prompt: string;
}

export interface ProjectPlansResponse {
  plans: ProjectPlan[];
}

export interface ProjectPlanResponse {
  plan: ProjectPlan;
}

export interface PlanningToolOptionsResponse {
  tools: PlanningToolOption[];
}

export interface ProjectIdeationSessionsResponse {
  sessions: ProjectIdeationSession[];
}

export interface ProjectIdeationSessionResponse {
  session: ProjectIdeationSession;
}
