import type {
  CreatePlanningSessionRequest,
  CreateProjectPlanArtifactRequest,
  CheckProjectPlanToolRequest,
  CreateProjectPlanRequest,
  ExecuteProjectPlanActionRequest,
  ExecuteProjectPlanLaunchRequest,
  CreateProjectIdeationRequest,
  PlanningExecutionEvent,
  PlanningSessionResponse,
  ProjectPlanExecutionResponse,
  ProjectPlanExecutionRunResponse,
  ProjectPlanLaunchExecutionResponse,
  ProjectPlanLaunchPreviewResponse,
  ProjectPlanArtifactResponse,
  ProjectPlanToolCheckResponse,
  ProjectPlanToolStatusResponse,
  ProjectPlanReadinessResponse,
  ProjectLaunchProofResponse,
  ProjectSectionWorkflowResponse,
  ProjectIdeationSessionResponse,
  ProjectIdeationSessionsResponse,
  ProjectSectionAnswers,
  ProjectWorkspaceSection,
  RunProjectPlanSectionRequest,
  RunProjectPlanSectionsRequest,
  UpdateProjectSectionRequest,
  ProjectToolConnection,
  ProviderCapabilitySnapshotsResponse,
  PlanningToolOptionsResponse,
  ProjectPlanResponse,
  ProjectPlansResponse,
  RefreshProviderCapabilitySnapshotsRequest,
  RunDueProviderCapabilityRefreshRequest,
  ProviderCapabilityRefreshScheduleResponse,
  UpdateProviderCapabilityRefreshScheduleRequest,
  ProjectStackDecision,
  UpdateProjectPlanToolStatusRequest,
} from '@open-design/contracts';

async function jsonFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(planningApiUrl(url), {
    ...options,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body?.error === 'string'
        ? body.error
        : typeof body?.error?.code === 'string'
          ? `${body.error.code}: ${body.error.message ?? ''}`.trim()
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function isPlanningAuthError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('API_TOKEN_REQUIRED');
}

function planningApiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_OD_API_BASE_URL?.replace(/\/$/, '');
  if (!base || /^https?:\/\//u.test(path)) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function getPlanningSession(): Promise<PlanningSessionResponse> {
  return jsonFetch<PlanningSessionResponse>('/api/planning/session');
}

export function createPlanningSession(input: CreatePlanningSessionRequest): Promise<PlanningSessionResponse> {
  return jsonFetch<PlanningSessionResponse>('/api/planning/session', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deletePlanningSession(): Promise<PlanningSessionResponse> {
  return jsonFetch<PlanningSessionResponse>('/api/planning/session', {
    method: 'DELETE',
  });
}

export function listPlanningTools(): Promise<PlanningToolOptionsResponse> {
  return jsonFetch<PlanningToolOptionsResponse>('/api/planning/tools');
}

export function listProviderCapabilitySnapshots(): Promise<ProviderCapabilitySnapshotsResponse> {
  return jsonFetch<ProviderCapabilitySnapshotsResponse>('/api/planning/capabilities');
}

export function refreshProviderCapabilitySnapshots(
  input: RefreshProviderCapabilitySnapshotsRequest = {},
): Promise<ProviderCapabilitySnapshotsResponse> {
  return jsonFetch<ProviderCapabilitySnapshotsResponse>('/api/planning/capabilities/refresh', {
    method: 'POST',
    body: JSON.stringify({
      persist: input.persist === true,
    }),
  });
}

export function getProviderCapabilityRefreshSchedule(): Promise<ProviderCapabilityRefreshScheduleResponse> {
  return jsonFetch<ProviderCapabilityRefreshScheduleResponse>('/api/planning/capabilities/schedule');
}

export function updateProviderCapabilityRefreshSchedule(
  input: UpdateProviderCapabilityRefreshScheduleRequest,
): Promise<ProviderCapabilityRefreshScheduleResponse> {
  return jsonFetch<ProviderCapabilityRefreshScheduleResponse>('/api/planning/capabilities/schedule', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function runDueProviderCapabilityRefresh(
  input: RunDueProviderCapabilityRefreshRequest = {},
): Promise<ProviderCapabilitySnapshotsResponse> {
  return jsonFetch<ProviderCapabilitySnapshotsResponse>('/api/planning/capabilities/refresh-due', {
    method: 'POST',
    body: JSON.stringify({ force: input.force === true }),
  });
}

export function listProjectPlans(): Promise<ProjectPlansResponse> {
  return jsonFetch<ProjectPlansResponse>('/api/plans');
}

export function createProjectPlan(input: CreateProjectPlanRequest): Promise<ProjectPlanResponse> {
  return jsonFetch<ProjectPlanResponse>('/api/plans', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateProjectPlanStack(
  id: string,
  stack: ProjectStackDecision,
): Promise<ProjectPlanResponse> {
  return jsonFetch<ProjectPlanResponse>(`/api/plans/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ stack }),
  });
}

export function updateProjectPlanTools(
  id: string,
  selectedTools: ProjectToolConnection[],
): Promise<ProjectPlanResponse> {
  return jsonFetch<ProjectPlanResponse>(`/api/plans/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ selectedTools }),
  });
}

export function updateProjectPlanToolStatus(
  id: string,
  input: UpdateProjectPlanToolStatusRequest,
): Promise<ProjectPlanToolStatusResponse> {
  return jsonFetch<ProjectPlanToolStatusResponse>(
    `/api/plans/${encodeURIComponent(id)}/tools/${encodeURIComponent(input.toolId)}/status`,
    {
      method: 'POST',
      body: JSON.stringify({
        status: input.status,
        ...(input.notes ? { notes: input.notes } : {}),
      }),
    },
  );
}

export function updateProjectPlanSectionAnswers(
  id: string,
  sectionAnswers: ProjectSectionAnswers,
): Promise<ProjectPlanResponse> {
  return jsonFetch<ProjectPlanResponse>(`/api/plans/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sectionAnswers }),
  });
}

export function getProjectSectionWorkflow(
  id: string,
  sectionId: ProjectWorkspaceSection['id'],
): Promise<ProjectSectionWorkflowResponse> {
  return jsonFetch<ProjectSectionWorkflowResponse>(
    `/api/plans/${encodeURIComponent(id)}/sections/${encodeURIComponent(sectionId)}`,
  );
}

export function updateProjectSectionWorkflow(
  id: string,
  sectionId: ProjectWorkspaceSection['id'],
  input: UpdateProjectSectionRequest,
): Promise<ProjectSectionWorkflowResponse> {
  return jsonFetch<ProjectSectionWorkflowResponse>(
    `/api/plans/${encodeURIComponent(id)}/sections/${encodeURIComponent(sectionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export function listProjectIdeationSessions(planId: string): Promise<ProjectIdeationSessionsResponse> {
  return jsonFetch<ProjectIdeationSessionsResponse>(`/api/plans/${encodeURIComponent(planId)}/ideation`);
}

export function createProjectIdeationSession(
  planId: string,
  input: CreateProjectIdeationRequest,
): Promise<ProjectIdeationSessionResponse> {
  return jsonFetch<ProjectIdeationSessionResponse>(`/api/plans/${encodeURIComponent(planId)}/ideation`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function acceptProjectPlanAction(
  planId: string,
  input: ExecuteProjectPlanActionRequest,
): Promise<ProjectPlanResponse> {
  return jsonFetch<ProjectPlanResponse>(`/api/plans/${encodeURIComponent(planId)}/actions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getProjectPlanExecution(planId: string): Promise<ProjectPlanExecutionResponse> {
  return jsonFetch<ProjectPlanExecutionResponse>(`/api/plans/${encodeURIComponent(planId)}/execution`);
}

export function getProjectPlanReadiness(planId: string): Promise<ProjectPlanReadinessResponse> {
  return jsonFetch<ProjectPlanReadinessResponse>(`/api/plans/${encodeURIComponent(planId)}/readiness`);
}

export function getProjectLaunchProof(planId: string): Promise<ProjectLaunchProofResponse> {
  return jsonFetch<ProjectLaunchProofResponse>(`/api/plans/${encodeURIComponent(planId)}/proof`);
}

export function getProjectPlanLaunchPreview(
  planId: string,
  input: Partial<ExecuteProjectPlanLaunchRequest> = {},
): Promise<ProjectPlanLaunchPreviewResponse> {
  const params = new URLSearchParams();
  for (const actionId of input.actionIds ?? []) params.append('actionIds', actionId);
  if (input.targetDir) params.set('targetDir', input.targetDir);
  if (input.scaffoldParentDir) params.set('scaffoldParentDir', input.scaffoldParentDir);
  if (input.deliveryTarget) params.set('deliveryTarget', input.deliveryTarget);
  if (input.projectManagementTarget) params.set('projectManagementTarget', input.projectManagementTarget);
  if (input.validateProviders) params.set('validateProviders', 'true');
  if (input.stopOnBlocked === false) params.set('stopOnBlocked', 'false');
  const query = params.toString();
  return jsonFetch<ProjectPlanLaunchPreviewResponse>(
    `/api/plans/${encodeURIComponent(planId)}/launch${query ? `?${query}` : ''}`,
  );
}

export function executeProjectPlanAction(
  planId: string,
  input: ExecuteProjectPlanActionRequest,
): Promise<ProjectPlanExecutionRunResponse> {
  return jsonFetch<ProjectPlanExecutionRunResponse>(
    `/api/plans/${encodeURIComponent(planId)}/actions/${encodeURIComponent(input.actionId)}/execute`,
    {
      method: 'POST',
      body: JSON.stringify({
        confirmed: input.confirmed === true,
        ...(input.targetDir ? { targetDir: input.targetDir } : {}),
        ...(input.deliveryTarget ? { deliveryTarget: input.deliveryTarget } : {}),
        ...(input.projectManagementTarget ? { projectManagementTarget: input.projectManagementTarget } : {}),
        ...(input.validateProviders ? { validateProviders: true } : {}),
      }),
    },
  );
}

export function executeProjectPlanLaunch(
  planId: string,
  input: ExecuteProjectPlanLaunchRequest,
): Promise<ProjectPlanLaunchExecutionResponse> {
  return jsonFetch<ProjectPlanLaunchExecutionResponse>(
    `/api/plans/${encodeURIComponent(planId)}/launch/execute`,
    {
      method: 'POST',
      body: JSON.stringify({
        confirmed: input.confirmed === true,
        ...(input.actionIds?.length ? { actionIds: input.actionIds } : {}),
        ...(input.targetDir ? { targetDir: input.targetDir } : {}),
        ...(input.scaffoldParentDir ? { scaffoldParentDir: input.scaffoldParentDir } : {}),
        ...(input.deliveryTarget ? { deliveryTarget: input.deliveryTarget } : {}),
        ...(input.projectManagementTarget ? { projectManagementTarget: input.projectManagementTarget } : {}),
        ...(input.validateProviders ? { validateProviders: true } : {}),
        ...(input.stopOnBlocked === false ? { stopOnBlocked: false } : {}),
      }),
    },
  );
}

export function runProjectPlanSection(
  planId: string,
  input: RunProjectPlanSectionRequest,
): Promise<ProjectPlanExecutionRunResponse> {
  return jsonFetch<ProjectPlanExecutionRunResponse>(
    `/api/plans/${encodeURIComponent(planId)}/sections/${encodeURIComponent(input.sectionId)}/runs`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export function subscribeProjectPlanRunEvents(
  planId: string,
  runId: string,
  handlers: {
    onEvent: (event: PlanningExecutionEvent) => void;
    onDone?: () => void;
    onError?: (error: Error) => void;
  },
): () => void {
  if (typeof EventSource === 'undefined') {
    handlers.onError?.(new Error('EventSource is not available in this environment'));
    return () => {};
  }
  const source = new EventSource(planningApiUrl(
    `/api/plans/${encodeURIComponent(planId)}/sections/runs/${encodeURIComponent(runId)}/events`,
  ), { withCredentials: true });
  const eventTypes: PlanningExecutionEvent['type'][] = [
    'run_started',
    'runner_stdout',
    'runner_stderr',
    'artifact_created',
    'status_changed',
    'run_completed',
    'run_failed',
  ];
  const handleMessage = (message: MessageEvent<string>) => {
    try {
      handlers.onEvent(JSON.parse(message.data) as PlanningExecutionEvent);
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };
  for (const type of eventTypes) source.addEventListener(type, handleMessage as EventListener);
  source.addEventListener('done', () => {
    handlers.onDone?.();
    source.close();
  });
  source.onerror = () => {
    handlers.onError?.(new Error('Plan execution event stream disconnected'));
    source.close();
  };
  return () => source.close();
}

export function runProjectPlanSections(
  planId: string,
  input: RunProjectPlanSectionsRequest,
): Promise<ProjectPlanExecutionResponse> {
  return jsonFetch<ProjectPlanExecutionResponse>(
    `/api/plans/${encodeURIComponent(planId)}/sections/runs`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...(input.sectionIds ? { sectionIds: input.sectionIds } : {}),
        onlyReady: input.onlyReady === true,
        ...(input.mode ? { mode: input.mode } : {}),
      }),
    },
  );
}

export function checkProjectPlanTool(
  planId: string,
  input: CheckProjectPlanToolRequest,
): Promise<ProjectPlanToolCheckResponse> {
  return jsonFetch<ProjectPlanToolCheckResponse>(
    `/api/plans/${encodeURIComponent(planId)}/tools/${encodeURIComponent(input.toolId)}/check`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export function createProjectPlanArtifact(
  planId: string,
  input: CreateProjectPlanArtifactRequest,
): Promise<ProjectPlanArtifactResponse> {
  return jsonFetch<ProjectPlanArtifactResponse>(
    `/api/plans/${encodeURIComponent(planId)}/artifacts`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}
