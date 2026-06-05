import type {
  CreatePlanningSessionRequest,
  CreateProjectPlanRequest,
  ExecuteProjectPlanActionRequest,
  CreateProjectIdeationRequest,
  PlanningSessionResponse,
  ProjectIdeationSessionResponse,
  ProjectIdeationSessionsResponse,
  ProjectSectionAnswers,
  ProjectToolConnection,
  ProviderCapabilitySnapshotsResponse,
  PlanningToolOptionsResponse,
  ProjectPlanResponse,
  ProjectPlansResponse,
  ProjectStackDecision,
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

export function refreshProviderCapabilitySnapshots(): Promise<ProviderCapabilitySnapshotsResponse> {
  return jsonFetch<ProviderCapabilitySnapshotsResponse>('/api/planning/capabilities/refresh', {
    method: 'POST',
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

export function updateProjectPlanSectionAnswers(
  id: string,
  sectionAnswers: ProjectSectionAnswers,
): Promise<ProjectPlanResponse> {
  return jsonFetch<ProjectPlanResponse>(`/api/plans/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sectionAnswers }),
  });
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
