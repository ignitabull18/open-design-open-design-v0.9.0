export type PlanningToolKind =
  | 'source-control'
  | 'hosting'
  | 'database'
  | 'payments'
  | 'project-management'
  | 'ai-runtime'
  | 'workflow-automation'
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
  | 'trigger-dev'
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

export interface DatabaseDesignPlan {
  mode: 'transactional' | 'realtime' | 'edge' | 'self-hosted' | 'hybrid';
  primaryStore: 'supabase' | 'convex' | 'postgres-coolify' | 'cloudflare-d1' | 'none';
  entities: string[];
  relationships: string[];
  accessPatterns: string[];
  migrations: string[];
  riskNotes: string[];
}

export interface PlanningAgentLane {
  id: 'product' | 'architecture' | 'database' | 'workflows' | 'integrations' | 'delivery';
  label: string;
  sectionId?: ProjectWorkspaceSection['id'];
  mode: 'sequential' | 'parallel';
  status: 'not_started' | 'ready' | 'blocked';
  dependsOn: PlanningAgentLane['id'][];
  toolIds: PlanningToolId[];
  brief: string;
  outputs: string[];
  runbook: string[];
  parallelWith: PlanningAgentLane['id'][];
}

export interface IdeationQuestion {
  id: string;
  laneId: PlanningAgentLane['id'];
  question: string;
  whyItMatters: string;
  answerType: 'choice' | 'freeform' | 'checklist';
  options?: string[];
}

export interface ProjectWorkspaceSection {
  id: 'planning' | 'design' | 'database' | 'integrations' | 'ai' | 'workflows' | 'delivery';
  label: string;
  purpose: string;
  owns: string[];
  doesNotOwn: string[];
  primaryQuestions: string[];
  outputs: string[];
  relatedLaneIds: PlanningAgentLane['id'][];
  toolIds: PlanningToolId[];
}

export interface ProjectSectionAnswer {
  sectionId: ProjectWorkspaceSection['id'];
  status: 'not_started' | 'drafting' | 'answered' | 'blocked';
  answers: string[];
  notes?: string;
  updatedAt: number;
}

export type ProjectSectionAnswers = Partial<Record<ProjectWorkspaceSection['id'], ProjectSectionAnswer>>;

export interface ProjectSectionWorkflow {
  section: ProjectWorkspaceSection;
  answer?: ProjectSectionAnswer;
  questions: IdeationQuestion[];
  lanes: PlanningAgentLane[];
  actions: PlanningExecutionAction[];
  databaseDesign?: DatabaseDesignPlan;
  providerCapabilities: ProviderCapabilitySnapshot[];
}

export interface ScaffoldPlan {
  engine: 'better-t-stack' | 'custom';
  command: string;
  postScaffoldTasks: string[];
  docsSources: string[];
}

export interface ProviderCapabilitySnapshot {
  toolId: PlanningToolId;
  label: string;
  sourceUrl: string;
  checkedAt: string;
  capabilities: string[];
  planningImplications: string[];
  riskNotes: string[];
}

export interface PlanningRuntimePlan {
  recommended: 'coolify-daemon' | 'node-daemon' | 'cloudflare-pages-static' | 'workers-refactor';
  summary: string;
  requiredEnv: string[];
  deploySteps: string[];
  verification: string[];
  caveats: string[];
}

export interface PlanningExecutionAction {
  id: 'repo-create' | 'scaffold' | 'deploy-runtime' | 'provider-research';
  label: string;
  status: 'blocked' | 'ready' | 'accepted' | 'completed';
  requiresConfirmation: boolean;
  command?: string;
  preconditions: string[];
  effects: string[];
  relatedSectionIds: ProjectWorkspaceSection['id'][];
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
  databaseDesign: DatabaseDesignPlan;
  agentLanes: PlanningAgentLane[];
  ideationQuestions: IdeationQuestion[];
  workspaceSections: ProjectWorkspaceSection[];
  sectionAnswers: ProjectSectionAnswers;
  providerCapabilities: ProviderCapabilitySnapshot[];
  runtimePlan: PlanningRuntimePlan;
  executionActions: PlanningExecutionAction[];
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
  sectionAnswers?: ProjectSectionAnswers;
  repo?: Partial<RepoPlan>;
  delivery?: DeliveryPlan[];
}

export interface UpdateProjectPlanRequest {
  name?: string;
  intent?: Partial<ProjectIntentBrief>;
  selectedTools?: ProjectToolConnection[];
  stack?: ProjectStackDecision;
  sectionAnswers?: ProjectSectionAnswers;
  repo?: Partial<RepoPlan>;
  delivery?: DeliveryPlan[];
}

export interface UpdateProjectSectionRequest {
  status?: ProjectSectionAnswer['status'];
  answers?: string[];
  notes?: string;
}

export interface CreateProjectIdeationRequest {
  prompt: string;
}

export interface ExecuteProjectPlanActionRequest {
  actionId: PlanningExecutionAction['id'];
  confirmed?: boolean;
}

export interface ProjectPlansResponse {
  plans: ProjectPlan[];
}

export interface ProjectPlanResponse {
  plan: ProjectPlan;
}

export interface ProjectSectionWorkflowResponse {
  plan: ProjectPlan;
  workflow: ProjectSectionWorkflow;
}

export interface PlanningToolOptionsResponse {
  tools: PlanningToolOption[];
}

export interface ProviderCapabilitySnapshotsResponse {
  capabilities: ProviderCapabilitySnapshot[];
}

export interface PlanningSessionResponse {
  authenticated: boolean;
  maxAgeSeconds?: number;
}

export interface CreatePlanningSessionRequest {
  token: string;
}

export interface ProjectIdeationSessionsResponse {
  sessions: ProjectIdeationSession[];
}

export interface ProjectIdeationSessionResponse {
  session: ProjectIdeationSession;
}
