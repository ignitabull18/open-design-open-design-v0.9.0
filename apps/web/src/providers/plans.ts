import type {
  CreateProjectPlanRequest,
  CreateProjectIdeationRequest,
  ProjectIdeationSessionResponse,
  ProjectIdeationSessionsResponse,
  ProjectSectionAnswers,
  PlanningToolOptionsResponse,
  ProjectPlanResponse,
  ProjectPlansResponse,
  ProjectStackDecision,
} from '@open-design/contracts';

async function jsonFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
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
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function listPlanningTools(): Promise<PlanningToolOptionsResponse> {
  return jsonFetch<PlanningToolOptionsResponse>('/api/planning/tools');
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
