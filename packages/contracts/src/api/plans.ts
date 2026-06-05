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
  refreshEvidence?: string[];
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
  id: 'repo-create' | 'scaffold' | 'deploy-runtime' | 'provider-research' | 'provider-setup' | 'project-management' | 'database-materialize' | 'database-migrate' | 'design-materialize';
  label: string;
  status: 'blocked' | 'ready' | 'accepted' | 'completed';
  requiresConfirmation: boolean;
  command?: string;
  preconditions: string[];
  effects: string[];
  relatedSectionIds: ProjectWorkspaceSection['id'][];
}

export interface PlanningExecutionRun {
  id: string;
  planId: string;
  kind: 'action' | 'section-agent' | 'orchestration' | 'tool-check';
  status: 'queued' | 'running' | 'completed' | 'blocked' | 'failed';
  title: string;
  actionId?: PlanningExecutionAction['id'];
  sectionId?: ProjectWorkspaceSection['id'];
  toolId?: PlanningToolId;
  mode: 'record-only' | 'dry-run' | 'external';
  summary: string;
  command?: string;
  startedAt: number;
  completedAt?: number;
  artifactIds: string[];
  evidence: string[];
}

export interface PlanningExecutionArtifact {
  id: string;
  planId: string;
  runId?: string;
  kind: 'provider-research' | 'provider-setup' | 'section-output' | 'specialist-agent-manifest' | 'parallel-orchestration' | 'database-draft' | 'database-materialization' | 'database-migration' | 'design-materialization' | 'scaffold-plan' | 'repo-plan' | 'deployment-plan' | 'project-management-plan' | 'tool-check';
  title: string;
  content: string;
  createdAt: number;
}

export interface PlanningToolCheck {
  id: string;
  planId: string;
  toolId: PlanningToolId;
  status: 'connected' | 'blocked' | 'deferred';
  summary: string;
  evidence: string[];
  checkedAt: number;
}

export interface ScaffoldExecutionPlan {
  status: 'not_started' | 'planned' | 'blocked' | 'completed';
  targetDir?: string;
  lastRunId?: string;
  lastCommand?: string;
  notes?: string[];
  updatedAt?: number;
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
  executionRuns: PlanningExecutionRun[];
  executionArtifacts: PlanningExecutionArtifact[];
  toolChecks: PlanningToolCheck[];
  scaffoldExecution: ScaffoldExecutionPlan;
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
  targetDir?: string;
  deliveryTarget?: DeliveryPlan['target'];
  projectManagementTarget?: Extract<PlanningToolId, 'github-issues' | 'linear' | 'google-docs'>;
}

export interface RunProjectPlanSectionRequest {
  sectionId: ProjectWorkspaceSection['id'];
}

export interface RunProjectPlanSectionsRequest {
  sectionIds?: ProjectWorkspaceSection['id'][];
  onlyReady?: boolean;
  mode?: 'parallel' | 'sequential';
}

export interface CheckProjectPlanToolRequest {
  toolId: PlanningToolId;
}

export interface CreateProjectPlanArtifactRequest {
  kind: PlanningExecutionArtifact['kind'];
  title: string;
  content: string;
}

export type ProjectPlanReadinessStatus = 'ready' | 'in_progress' | 'blocked' | 'not_started';

export interface ProjectPlanReadinessItem {
  id: string;
  label: string;
  sectionId?: ProjectWorkspaceSection['id'];
  actionId?: PlanningExecutionAction['id'];
  status: ProjectPlanReadinessStatus;
  summary: string;
  evidence: string[];
  nextSteps: string[];
}

export interface ProjectPlanReadinessReport {
  planId: string;
  generatedAt: number;
  overallStatus: ProjectPlanReadinessStatus;
  completedCount: number;
  totalCount: number;
  blockedCount: number;
  nextActionId?: PlanningExecutionAction['id'];
  nextSummary: string;
  items: ProjectPlanReadinessItem[];
}

export interface RefreshProviderCapabilitySnapshotsRequest {
  persist?: boolean;
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

export interface ProjectPlanExecutionResponse {
  plan: ProjectPlan;
  runs: PlanningExecutionRun[];
  artifacts: PlanningExecutionArtifact[];
  toolChecks: PlanningToolCheck[];
  scaffoldExecution: ScaffoldExecutionPlan;
}

export interface ProjectPlanReadinessResponse {
  plan: ProjectPlan;
  readiness: ProjectPlanReadinessReport;
}

export interface ProjectPlanExecutionRunResponse {
  plan: ProjectPlan;
  run: PlanningExecutionRun;
  artifacts: PlanningExecutionArtifact[];
}

export interface ProjectPlanArtifactResponse {
  plan: ProjectPlan;
  artifact: PlanningExecutionArtifact;
}

export interface ProjectPlanToolCheckResponse {
  plan: ProjectPlan;
  run: PlanningExecutionRun;
  toolCheck: PlanningToolCheck;
  artifacts: PlanningExecutionArtifact[];
}

export interface PlanningToolOptionsResponse {
  tools: PlanningToolOption[];
}

export interface ProviderCapabilitySnapshotsResponse {
  capabilities: ProviderCapabilitySnapshot[];
  sourceUrls?: string[];
  refreshedAt?: number;
  refreshEvidence?: string[];
  plansUpdated?: number;
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
