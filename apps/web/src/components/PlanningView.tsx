import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ExecuteProjectPlanLaunchRequest,
  PlanningExecutionArtifact,
  PlanningExecutionEvent,
  PlanningToolOption,
  ProviderCapabilityRefreshPolicy,
  ProviderCapabilityRefreshSchedule,
  ProviderCapabilitySnapshot,
  ProjectIdeationSession,
  ProjectLaunchProofReport,
  ProjectLaunchPreview,
  ProjectPlan,
  ProjectPlanReadinessReport,
  RunProjectPlanSectionsRequest,
  ProjectToolConnection,
  ProjectWorkspaceSection,
  ProjectStackDecision,
} from '@open-design/contracts';
import { Icon } from './Icon';
import {
  acceptProjectPlanAction,
  checkProjectPlanTool,
  createPlanningSession,
  createProjectPlanArtifact,
  createProjectIdeationSession,
  createProjectPlan,
  executeProjectPlanLaunch,
  executeProjectPlanAction,
  getProjectPlanExecution,
  getProjectLaunchProof,
  getProjectPlanLaunchPreview,
  getProjectPlanReadiness,
  isPlanningAuthError,
  listProviderCapabilitySnapshots,
  listProjectIdeationSessions,
  listPlanningTools,
  listProjectPlans,
  refreshProviderCapabilitySnapshots,
  runDueProviderCapabilityRefresh,
  runProjectPlanSection,
  runProjectPlanSections,
  subscribeProjectPlanRunEvents,
  updateProviderCapabilityRefreshSchedule,
  updateProjectPlanToolStatus,
  updateProjectSectionWorkflow,
} from '../providers/plans';

const HOSTING_OPTIONS: NonNullable<ProjectStackDecision['hosting']> = [
  'cloudflare',
  'vercel',
  'coolify',
  'hostinger',
];

const HOSTED_OPERATIONS_ITEMS = [
  {
    label: 'Monitor',
    status: 'every 5 min',
    detail: '/api/health and /api/daemon/status with webhook alert delivery',
  },
  {
    label: 'Backup',
    status: 'daily',
    detail: '/app/.od SQLite archive with offsite copy and restore drill manifest',
  },
  {
    label: 'Deploy gate',
    status: 'required',
    detail: 'post-deploy wrapper runs monitor, smoke, provider probes, and storage checks',
  },
  {
    label: 'Logs',
    status: 'runbook',
    detail: 'Coolify app logs plus host monitor, backup, and tunnel journals',
  },
];

const INITIAL_STACK: ProjectStackDecision = {
  frontend: 'next',
  backend: 'hono',
  runtime: 'workers',
  database: 'supabase',
  orm: 'drizzle',
  api: 'trpc',
  auth: 'better-auth',
  payments: 'stripe',
  hosting: ['cloudflare'],
  packageManager: 'pnpm',
};

const ARTIFACT_KIND_OPTIONS: PlanningExecutionArtifact['kind'][] = [
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
];

function buildLaunchExecutionInput(
  plan: ProjectPlan,
  executionTargets: Record<string, string>,
  deliveryTargets: Record<string, ProjectPlan['delivery'][number]['target'] | ''>,
  projectManagementTargets: Record<string, Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> | ''>,
  validateProviders: boolean,
): Partial<ExecuteProjectPlanLaunchRequest> {
  const targetDir = executionTargets['repo-create']
    || executionTargets['provider-setup']
    || executionTargets['database-materialize']
    || executionTargets['database-migrate']
    || executionTargets['design-materialize']
    || executionTargets['deploy-runtime']
    || executionTargets['project-management'];
  const projectManagementTarget = projectManagementTargets['project-management'] || plan.selectedTools
    .map((tool) => tool.toolId)
    .find((toolId): toolId is Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> =>
      toolId === 'github-issues' || toolId === 'linear' || toolId === 'google-docs',
    );

  return {
    ...(executionTargets.scaffold?.trim() ? { scaffoldParentDir: executionTargets.scaffold.trim() } : {}),
    ...(targetDir?.trim() ? { targetDir: targetDir.trim() } : {}),
    ...(deliveryTargets['deploy-runtime'] || plan.delivery[0]?.target
      ? { deliveryTarget: deliveryTargets['deploy-runtime'] || plan.delivery[0]?.target }
      : {}),
    ...(projectManagementTarget ? { projectManagementTarget } : {}),
    ...(validateProviders ? { validateProviders: true } : {}),
  };
}

export function PlanningView() {
  const [plans, setPlans] = useState<ProjectPlan[]>([]);
  const [tools, setTools] = useState<PlanningToolOption[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapabilitySnapshot[]>([]);
  const [capabilityRefreshPolicy, setCapabilityRefreshPolicy] = useState<ProviderCapabilityRefreshPolicy | null>(null);
  const [capabilityRefreshSchedule, setCapabilityRefreshSchedule] = useState<ProviderCapabilityRefreshSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [apiToken, setApiToken] = useState('');
  const [authSaving, setAuthSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ideationByPlanId, setIdeationByPlanId] = useState<Record<string, ProjectIdeationSession[]>>({});
  const [readinessByPlanId, setReadinessByPlanId] = useState<Record<string, ProjectPlanReadinessReport>>({});
  const [proofByPlanId, setProofByPlanId] = useState<Record<string, ProjectLaunchProofReport>>({});
  const [launchPreviewByPlanId, setLaunchPreviewByPlanId] = useState<Record<string, ProjectLaunchPreview>>({});
  const [ideationPrompt, setIdeationPrompt] = useState('Explore stack directions for this project and call out what tools I need to connect first.');
  const [brainstorming, setBrainstorming] = useState(false);
  const [sectionSaving, setSectionSaving] = useState<string | null>(null);
  const [actionSaving, setActionSaving] = useState<string | null>(null);
  const [executionSaving, setExecutionSaving] = useState<string | null>(null);
  const [liveRunEvents, setLiveRunEvents] = useState<Record<string, PlanningExecutionEvent[]>>({});
  const [artifactSaving, setArtifactSaving] = useState(false);
  const [artifactKind, setArtifactKind] = useState<PlanningExecutionArtifact['kind']>('project-management-plan');
  const [artifactTitle, setArtifactTitle] = useState('PRD handoff notes');
  const [artifactContent, setArtifactContent] = useState('');
  const [executionTargets, setExecutionTargets] = useState<Record<string, string>>({});
  const [deliveryTargets, setDeliveryTargets] = useState<Record<string, ProjectPlan['delivery'][number]['target'] | ''>>({});
  const [projectManagementTargets, setProjectManagementTargets] = useState<Record<string, Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> | ''>>({});
  const [validateProviderSetup, setValidateProviderSetup] = useState(false);
  const [sectionRunMode, setSectionRunMode] = useState<NonNullable<RunProjectPlanSectionsRequest['mode']>>('parallel');
  const [refreshingCapabilities, setRefreshingCapabilities] = useState(false);
  const [name, setName] = useState('New product workspace');
  const [purpose, setPurpose] = useState('Plan, scaffold, and ship a web app from an accepted stack decision.');
  const [audience, setAudience] = useState('operators and product builders');
  const [stack, setStack] = useState<ProjectStackDecision>(INITIAL_STACK);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([
    'github',
    'cloudflare-hosting',
    'coolify',
    'supabase-database',
    'stripe',
    'codex',
    'trigger-dev',
    'composio',
    'onepassword',
    'better-auth',
  ]);

  const loadPlanningData = useCallback(async (options: { cancelled?: () => boolean } = {}) => {
      setLoading(true);
      setError(null);
      try {
        const [plansResult, toolsResult, capabilitiesResult] = await Promise.all([
          listProjectPlans(),
          listPlanningTools(),
          listProviderCapabilitySnapshots(),
        ]);
        if (options.cancelled?.()) return;
        setPlans(plansResult.plans);
        setTools(toolsResult.tools);
        setCapabilities(capabilitiesResult.capabilities);
        setCapabilityRefreshPolicy(capabilitiesResult.refreshPolicy ?? null);
        setCapabilityRefreshSchedule(capabilitiesResult.refreshSchedule ?? null);
        setSelectedId((curr) => curr ?? plansResult.plans[0]?.id ?? null);
        setAuthRequired(false);
      } catch (err) {
        if (options.cancelled?.()) return;
        if (isPlanningAuthError(err)) {
          setAuthRequired(true);
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!options.cancelled?.()) setLoading(false);
      }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadPlanningData({ cancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [loadPlanningData]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedId) ?? plans[0] ?? null,
    [plans, selectedId],
  );
  const toolCountByKind = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tool of tools) counts.set(tool.kind, (counts.get(tool.kind) ?? 0) + 1);
    return Array.from(counts.entries());
  }, [tools]);
  const toolsByKind = useMemo(() => {
    const groups = new Map<string, PlanningToolOption[]>();
    for (const tool of tools) groups.set(tool.kind, [...(groups.get(tool.kind) ?? []), tool]);
    return Array.from(groups.entries());
  }, [tools]);
  const selectedIdeation = selectedPlan ? ideationByPlanId[selectedPlan.id] ?? [] : [];
  const selectedReadiness = selectedPlan ? readinessByPlanId[selectedPlan.id] ?? null : null;
  const selectedProof = selectedPlan ? proofByPlanId[selectedPlan.id] ?? null : null;
  const selectedLaunchPreview = selectedPlan ? launchPreviewByPlanId[selectedPlan.id] ?? null : null;
  const selectedLaunchInput = useMemo(
    () => selectedPlan
      ? buildLaunchExecutionInput(
        selectedPlan,
        executionTargets,
        deliveryTargets,
        projectManagementTargets,
        validateProviderSetup,
      )
      : {},
    [deliveryTargets, executionTargets, projectManagementTargets, selectedPlan, validateProviderSetup],
  );

  const refreshReadiness = useCallback(async (
    planId: string,
    launchInput: Partial<ExecuteProjectPlanLaunchRequest> = {},
  ) => {
    const [readinessResult, proofResult, launchResult] = await Promise.all([
      getProjectPlanReadiness(planId),
      getProjectLaunchProof(planId),
      getProjectPlanLaunchPreview(planId, launchInput),
    ]);
    setReadinessByPlanId((curr) => ({ ...curr, [planId]: readinessResult.readiness }));
    setProofByPlanId((curr) => ({ ...curr, [planId]: proofResult.proof }));
    setLaunchPreviewByPlanId((curr) => ({ ...curr, [planId]: launchResult.launch }));
    setPlans((curr) => curr.map((plan) => (plan.id === readinessResult.plan.id ? readinessResult.plan : plan)));
  }, []);

  useEffect(() => {
    if (!selectedPlan || ideationByPlanId[selectedPlan.id]) return;
    let cancelled = false;
    void listProjectIdeationSessions(selectedPlan.id)
      .then((result) => {
        if (cancelled) return;
        setIdeationByPlanId((curr) => ({ ...curr, [selectedPlan.id]: result.sessions }));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ideationByPlanId, selectedPlan]);

  useEffect(() => {
    if (!selectedPlan || (readinessByPlanId[selectedPlan.id] && proofByPlanId[selectedPlan.id] && launchPreviewByPlanId[selectedPlan.id])) return;
    let cancelled = false;
    void Promise.all([
      getProjectPlanReadiness(selectedPlan.id),
      getProjectLaunchProof(selectedPlan.id),
      getProjectPlanLaunchPreview(selectedPlan.id, selectedLaunchInput),
    ])
      .then(([result, proofResult, launchResult]) => {
        if (cancelled) return;
        setReadinessByPlanId((curr) => ({ ...curr, [selectedPlan.id]: result.readiness }));
        setProofByPlanId((curr) => ({ ...curr, [selectedPlan.id]: proofResult.proof }));
        setLaunchPreviewByPlanId((curr) => ({ ...curr, [selectedPlan.id]: launchResult.launch }));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [launchPreviewByPlanId, proofByPlanId, readinessByPlanId, selectedLaunchInput, selectedPlan]);

  useEffect(() => {
    if (!selectedPlan) return;
    let cancelled = false;
    void getProjectPlanLaunchPreview(selectedPlan.id, selectedLaunchInput)
      .then((result) => {
        if (cancelled) return;
        setLaunchPreviewByPlanId((curr) => ({ ...curr, [selectedPlan.id]: result.launch }));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLaunchInput, selectedPlan]);

  async function handleCreatePlan() {
    setSaving(true);
    setError(null);
    try {
      const result = await createProjectPlan({
        name,
        intent: {
          purpose,
          audience,
          successCriteria: [
            'Stack decision accepted',
            'Better-T-Stack scaffold command reviewed',
            'GitHub repo and delivery target planned',
          ],
        },
        selectedTools: selectedToolIds.map((toolId) => ({
          toolId: toolId as ProjectToolConnection['toolId'],
          status: 'wanted',
        })),
        stack,
      });
      setPlans((curr) => [result.plan, ...curr.filter((plan) => plan.id !== result.plan.id)]);
      setSelectedId(result.plan.id);
      await refreshReadiness(result.plan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreatePlanningSession() {
    setAuthSaving(true);
    setError(null);
    try {
      await createPlanningSession({ token: apiToken });
      setApiToken('');
      setAuthRequired(false);
      await loadPlanningData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthSaving(false);
    }
  }

  async function handleBrainstorm() {
    if (!selectedPlan) return;
    setBrainstorming(true);
    setError(null);
    try {
      const result = await createProjectIdeationSession(selectedPlan.id, {
        prompt: ideationPrompt,
      });
      setIdeationByPlanId((curr) => ({
        ...curr,
        [selectedPlan.id]: [
          result.session,
          ...(curr[selectedPlan.id] ?? []).filter((session) => session.id !== result.session.id),
        ],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBrainstorming(false);
    }
  }

  async function handleSaveSectionAnswer(
    sectionId: ProjectWorkspaceSection['id'],
    answerText: string,
    notes: string,
  ) {
    if (!selectedPlan) return;
    setSectionSaving(sectionId);
    setError(null);
    try {
      const result = await updateProjectSectionWorkflow(selectedPlan.id, sectionId, {
        status: answerText.trim() ? 'answered' : 'drafting',
        answers: answerText.split('\n').map((line) => line.trim()).filter(Boolean),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      await refreshReadiness(result.plan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSectionSaving(null);
    }
  }

  async function handleAcceptAction(actionId: ProjectPlan['executionActions'][number]['id']) {
    if (!selectedPlan) return;
    setActionSaving(actionId);
    setError(null);
    try {
      const result = await acceptProjectPlanAction(selectedPlan.id, {
        actionId,
        confirmed: true,
      });
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      await refreshReadiness(result.plan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionSaving(null);
    }
  }

  async function handleExecuteAction(
    actionId: ProjectPlan['executionActions'][number]['id'],
    targetDir?: string,
    deliveryTarget?: ProjectPlan['delivery'][number]['target'] | '',
    projectManagementTarget?: Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> | '',
    validateProviders?: boolean,
  ) {
    if (!selectedPlan) return;
    setExecutionSaving(`action:${actionId}`);
    setError(null);
    try {
      const result = await executeProjectPlanAction(selectedPlan.id, {
        actionId,
        confirmed: true,
        ...(targetDir?.trim() ? { targetDir: targetDir.trim() } : {}),
        ...(deliveryTarget ? { deliveryTarget } : {}),
        ...(projectManagementTarget ? { projectManagementTarget } : {}),
        ...(validateProviders ? { validateProviders: true } : {}),
      });
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      await refreshReadiness(result.plan.id, selectedLaunchInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecutionSaving(null);
    }
  }

  async function handleExecuteLaunchSequence() {
    if (!selectedPlan) return;
    setExecutionSaving('launch-sequence');
    setError(null);
    try {
      const result = await executeProjectPlanLaunch(selectedPlan.id, {
        confirmed: true,
        ...selectedLaunchInput,
      });
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      setProofByPlanId((curr) => ({ ...curr, [result.plan.id]: result.proof }));
      if (result.launch) setLaunchPreviewByPlanId((curr) => ({ ...curr, [result.plan.id]: result.launch! }));
      await refreshReadiness(result.plan.id, selectedLaunchInput);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecutionSaving(null);
    }
  }

  function mergeLiveRunEvent(event: PlanningExecutionEvent) {
    setLiveRunEvents((curr) => {
      const existing = curr[event.runId] ?? [];
      if (existing.some((item) => item.id === event.id)) return curr;
      return {
        ...curr,
        [event.runId]: [...existing, event].sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt).slice(-80),
      };
    });
  }

  async function followSectionRunEvents(
    planId: string,
    predicate: (run: ProjectPlan['executionRuns'][number]) => boolean,
  ): Promise<() => void> {
    const cleanups: Array<() => void> = [];
    const subscribedRunIds = new Set<string>();
    let sawMatchingRun = false;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const execution = await getProjectPlanExecution(planId);
      setPlans((curr) => curr.map((plan) => (plan.id === execution.plan.id ? execution.plan : plan)));
      for (const event of execution.events ?? []) mergeLiveRunEvent(event);
      const runningRuns = [...(execution.runs ?? [])].filter((run) =>
        (run.status === 'running' || run.status === 'queued') && predicate(run),
      );
      for (const runningRun of runningRuns) {
        sawMatchingRun = true;
        if (subscribedRunIds.has(runningRun.id)) continue;
        subscribedRunIds.add(runningRun.id);
        cleanups.push(subscribeProjectPlanRunEvents(planId, runningRun.id, {
          onEvent: mergeLiveRunEvent,
          onDone: () => {
            void getProjectPlanExecution(planId).then((latest) => {
              setPlans((curr) => curr.map((plan) => (plan.id === latest.plan.id ? latest.plan : plan)));
              for (const event of latest.events ?? []) mergeLiveRunEvent(event);
            }).catch(() => undefined);
          },
          onError: (err) => setError(err.message),
        }));
      }
      if (sawMatchingRun && runningRuns.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }

  async function handleRunSection(sectionId: ProjectWorkspaceSection['id']) {
    if (!selectedPlan) return;
    setExecutionSaving(`section:${sectionId}`);
    setError(null);
    let unsubscribe = () => {};
    try {
      const follow = followSectionRunEvents(selectedPlan.id, (run) => run.kind === 'section-agent' && run.sectionId === sectionId)
        .then((cleanup) => {
          unsubscribe = cleanup;
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
      const result = await runProjectPlanSection(selectedPlan.id, { sectionId });
      await follow;
      for (const event of result.events ?? []) mergeLiveRunEvent(event);
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      await refreshReadiness(result.plan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      unsubscribe();
      setExecutionSaving(null);
    }
  }

  async function handleRunReadySections(mode: NonNullable<RunProjectPlanSectionsRequest['mode']>) {
    if (!selectedPlan) return;
    setExecutionSaving(`sections:${mode}`);
    setError(null);
    let unsubscribe = () => {};
    try {
      const follow = followSectionRunEvents(selectedPlan.id, (run) => run.kind === 'section-agent')
        .then((cleanup) => {
          unsubscribe = cleanup;
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
      const result = await runProjectPlanSections(selectedPlan.id, {
        onlyReady: mode === 'parallel',
        mode,
      });
      await follow;
      for (const event of result.events ?? []) mergeLiveRunEvent(event);
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      await refreshReadiness(result.plan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      unsubscribe();
      setExecutionSaving(null);
    }
  }

  async function handleCheckTool(toolId: ProjectToolConnection['toolId']) {
    if (!selectedPlan) return;
    setExecutionSaving(`tool:${toolId}`);
    setError(null);
    try {
      const result = await checkProjectPlanTool(selectedPlan.id, { toolId });
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      await refreshReadiness(result.plan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecutionSaving(null);
    }
  }

  async function handleUpdateToolStatus(
    toolId: ProjectToolConnection['toolId'],
    status: ProjectToolConnection['status'],
  ) {
    if (!selectedPlan) return;
    setExecutionSaving(`tool-status:${toolId}`);
    setError(null);
    try {
      const result = await updateProjectPlanToolStatus(selectedPlan.id, { toolId, status });
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      await refreshReadiness(result.plan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecutionSaving(null);
    }
  }

  async function handleCreateArtifact() {
    if (!selectedPlan) return;
    setArtifactSaving(true);
    setError(null);
    try {
      const result = await createProjectPlanArtifact(selectedPlan.id, {
        kind: artifactKind,
        title: artifactTitle.trim(),
        content: artifactContent.trim(),
      });
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
      await refreshReadiness(result.plan.id);
      setArtifactTitle('');
      setArtifactContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setArtifactSaving(false);
    }
  }

  async function handleRefreshCapabilities() {
    setRefreshingCapabilities(true);
    setError(null);
    try {
      const result = await refreshProviderCapabilitySnapshots({ persist: true });
      const plansResult = await listProjectPlans();
      setCapabilities(result.capabilities);
      setCapabilityRefreshPolicy(result.refreshPolicy ?? null);
      setCapabilityRefreshSchedule(result.refreshSchedule ?? null);
      setPlans(plansResult.plans);
      setSelectedId((curr) => curr ?? plansResult.plans[0]?.id ?? null);
      if (selectedPlan) await refreshReadiness(selectedPlan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingCapabilities(false);
    }
  }

  async function handleRunDueCapabilityRefresh(force = false) {
    setRefreshingCapabilities(true);
    setError(null);
    try {
      const result = await runDueProviderCapabilityRefresh({ force });
      const plansResult = await listProjectPlans();
      setCapabilities(result.capabilities);
      setCapabilityRefreshPolicy(result.refreshPolicy ?? null);
      setCapabilityRefreshSchedule(result.refreshSchedule ?? null);
      setPlans(plansResult.plans);
      setSelectedId((curr) => curr ?? plansResult.plans[0]?.id ?? null);
      if (selectedPlan) await refreshReadiness(selectedPlan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingCapabilities(false);
    }
  }

  async function handleToggleCapabilityRefreshSchedule(enabled: boolean) {
    setRefreshingCapabilities(true);
    setError(null);
    try {
      const result = await updateProviderCapabilityRefreshSchedule({ enabled });
      setCapabilityRefreshPolicy(result.refreshPolicy);
      setCapabilityRefreshSchedule(result.refreshSchedule);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingCapabilities(false);
    }
  }

  return (
    <section className="planning-view" aria-labelledby="planning-title">
      <header className="planning-view__hero">
        <div>
          <p className="planning-view__kicker">Project planning</p>
          <h1 id="planning-title" className="entry-section__title">Planning</h1>
          <p className="planning-view__lede">
            Store the project brief, choose the stack, design the database, split the work into
            agent lanes, generate the Better-T-Stack scaffold command, and keep GitHub plus
            deployment intent attached to the plan.
          </p>
        </div>
        <div className="planning-view__badge" aria-hidden="true">
          <Icon name="pencil" size={15} />
          <span>Better-T-Stack ready</span>
        </div>
      </header>

      {error ? (
        <div className="planning-view__error" role="alert">{error}</div>
      ) : null}

      {authRequired ? (
        <form
          className="planning-view__auth"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreatePlanningSession();
          }}
        >
          <div>
            <h2>Unlock hosted planner</h2>
            <p>Enter the daemon API token once to create a same-origin httpOnly planning session.</p>
          </div>
          <label>
            <span>Daemon API token</span>
            <input
              type="password"
              autoComplete="current-password"
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
            />
          </label>
          <button className="planning-view__primary" type="submit" disabled={authSaving || !apiToken.trim()}>
            {authSaving ? 'Unlocking...' : 'Unlock'}
          </button>
        </form>
      ) : null}

      <div className="planning-view__layout">
        <form
          className="planning-view__composer"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreatePlan();
          }}
        >
          <div className="planning-view__field">
            <label htmlFor="planning-name">Project name</label>
            <input
              id="planning-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="planning-view__field">
            <label htmlFor="planning-purpose">Purpose</label>
            <textarea
              id="planning-purpose"
              rows={4}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
            />
          </div>
          <div className="planning-view__field">
            <label htmlFor="planning-audience">Audience</label>
            <input
              id="planning-audience"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
            />
          </div>

          <div className="planning-view__stack-grid">
            <SelectField
              label="Frontend"
              value={stack.frontend ?? 'next'}
              options={['next', 'tanstack-router', 'tanstack-start', 'astro', 'none']}
              onChange={(value) => setStack((curr) => ({ ...curr, frontend: value as ProjectStackDecision['frontend'] }))}
            />
            <SelectField
              label="Backend"
              value={stack.backend ?? 'hono'}
              options={['hono', 'convex', 'self', 'none']}
              onChange={(value) => setStack((curr) => ({ ...curr, backend: value as ProjectStackDecision['backend'] }))}
            />
            <SelectField
              label="Database"
              value={stack.database ?? 'supabase'}
              options={['supabase', 'cloudflare-d1', 'convex', 'postgres-coolify', 'none']}
              onChange={(value) => setStack((curr) => ({ ...curr, database: value as ProjectStackDecision['database'] }))}
            />
            <SelectField
              label="Auth"
              value={stack.auth ?? 'better-auth'}
              options={['better-auth', 'supabase', 'cloudflare-access', 'none']}
              onChange={(value) => setStack((curr) => ({ ...curr, auth: value as ProjectStackDecision['auth'] }))}
            />
            <SelectField
              label="Runtime"
              value={stack.runtime ?? 'workers'}
              options={['workers', 'node', 'bun', 'none']}
              onChange={(value) => setStack((curr) => ({ ...curr, runtime: value as ProjectStackDecision['runtime'] }))}
            />
            <SelectField
              label="API"
              value={stack.api ?? 'trpc'}
              options={['trpc', 'orpc', 'none']}
              onChange={(value) => setStack((curr) => ({ ...curr, api: value as ProjectStackDecision['api'] }))}
            />
          </div>

          <fieldset className="planning-view__hosting">
            <legend>Hosting targets</legend>
            {HOSTING_OPTIONS.map((target) => {
              const checked = stack.hosting?.includes(target) ?? false;
              return (
                <label key={target}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setStack((curr) => {
                        const current = new Set(curr.hosting ?? []);
                        if (event.target.checked) current.add(target);
                        else current.delete(target);
                        return { ...curr, hosting: Array.from(current) as ProjectStackDecision['hosting'] };
                      });
                    }}
                  />
                  <span>{target}</span>
                </label>
              );
            })}
          </fieldset>

          <fieldset className="planning-view__tool-picker">
            <legend>Tool stack</legend>
            {toolsByKind.map(([kind, group]) => (
              <div key={kind}>
                <strong>{kind}</strong>
                {group.map((tool) => {
                  const checked = selectedToolIds.includes(tool.id);
                  return (
                    <label key={tool.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setSelectedToolIds((curr) => {
                            const next = new Set(curr);
                            if (event.target.checked) next.add(tool.id);
                            else next.delete(tool.id);
                            return Array.from(next);
                          });
                        }}
                      />
                      <span>{tool.label}</span>
                    </label>
                  );
                })}
              </div>
            ))}
          </fieldset>

          <button className="planning-view__primary" type="submit" disabled={saving || !name.trim() || !purpose.trim()}>
            {saving ? 'Saving...' : 'Create plan'}
          </button>
        </form>

        <aside className="planning-view__summary" aria-live="polite">
          <div className="planning-view__tools">
            <h2>Eligible tools</h2>
            {toolCountByKind.map(([kind, count]) => (
              <span key={kind}>{kind}: {count}</span>
            ))}
          </div>

          <div className="planning-view__plans">
            <h2>Stored projects</h2>
            {loading ? <p>Loading plans...</p> : null}
            {!loading && plans.length === 0 ? <p>No stored project plans yet.</p> : null}
            {plans.map((plan) => (
              <button
                key={plan.id}
                type="button"
                className={`planning-view__plan-row${plan.id === selectedPlan?.id ? ' is-active' : ''}`}
                onClick={() => setSelectedId(plan.id)}
              >
                <strong>{plan.name}</strong>
                <span>{plan.stack.frontend ?? 'next'} · {plan.stack.database ?? 'none'} · {plan.stack.auth ?? 'none'}</span>
              </button>
            ))}
          </div>

          {selectedPlan ? (
            <PlanDetail
              plan={selectedPlan}
              readiness={selectedReadiness}
              proof={selectedProof}
              launchPreview={selectedLaunchPreview}
              ideationPrompt={ideationPrompt}
              ideationSessions={selectedIdeation}
              brainstorming={brainstorming}
              sectionSaving={sectionSaving}
              actionSaving={actionSaving}
              executionSaving={executionSaving}
              liveRunEvents={liveRunEvents}
              capabilities={capabilities}
              capabilityRefreshPolicy={capabilityRefreshPolicy}
              capabilityRefreshSchedule={capabilityRefreshSchedule}
              onIdeationPromptChange={setIdeationPrompt}
              onBrainstorm={handleBrainstorm}
              onSaveSectionAnswer={handleSaveSectionAnswer}
              onAcceptAction={handleAcceptAction}
              onExecuteAction={handleExecuteAction}
              onExecuteLaunchSequence={handleExecuteLaunchSequence}
              executionTargets={executionTargets}
              onExecutionTargetChange={(actionId, targetDir) => {
                setExecutionTargets((curr) => ({ ...curr, [actionId]: targetDir }));
              }}
              deliveryTargets={deliveryTargets}
              onDeliveryTargetChange={(actionId, deliveryTarget) => {
                setDeliveryTargets((curr) => ({ ...curr, [actionId]: deliveryTarget }));
              }}
              projectManagementTargets={projectManagementTargets}
              onProjectManagementTargetChange={(actionId, projectManagementTarget) => {
                setProjectManagementTargets((curr) => ({ ...curr, [actionId]: projectManagementTarget }));
              }}
              validateProviderSetup={validateProviderSetup}
              onValidateProviderSetupChange={setValidateProviderSetup}
              onRunSection={handleRunSection}
              sectionRunMode={sectionRunMode}
              onSectionRunModeChange={setSectionRunMode}
              onRunReadySections={handleRunReadySections}
              onCheckTool={handleCheckTool}
              onUpdateToolStatus={handleUpdateToolStatus}
              onRefreshCapabilities={handleRefreshCapabilities}
              onRunDueCapabilityRefresh={handleRunDueCapabilityRefresh}
              onToggleCapabilityRefreshSchedule={handleToggleCapabilityRefreshSchedule}
              refreshingCapabilities={refreshingCapabilities}
              artifactSaving={artifactSaving}
              artifactKind={artifactKind}
              artifactTitle={artifactTitle}
              artifactContent={artifactContent}
              onArtifactKindChange={setArtifactKind}
              onArtifactTitleChange={setArtifactTitle}
              onArtifactContentChange={setArtifactContent}
              onCreateArtifact={handleCreateArtifact}
            />
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="planning-view__select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function ReadinessPanel({ readiness }: { readiness: ProjectPlanReadinessReport | null }) {
  if (!readiness) {
    return (
      <section className="planning-view__readiness" aria-label="Plan readiness">
        <div className="planning-view__readiness-head">
          <h3>Readiness</h3>
          <span>loading</span>
        </div>
      </section>
    );
  }
  const incomplete = readiness.items
    .filter((item) => item.status !== 'ready')
    .slice(0, 5);
  return (
    <section className="planning-view__readiness" aria-label="Plan readiness">
      <div className="planning-view__readiness-head">
        <div>
          <h3>Readiness</h3>
          <p>{readiness.nextSummary}</p>
        </div>
        <span>{readiness.overallStatus}</span>
      </div>
      <div className="planning-view__readiness-meter">
        <strong>{readiness.completedCount}/{readiness.totalCount}</strong>
        <span>{readiness.blockedCount} blocked</span>
      </div>
      {incomplete.length > 0 ? (
        <ul className="planning-view__readiness-list">
          {incomplete.map((item) => (
            <li key={item.id}>
              <strong>{item.label}</strong>
              <span>{item.status}</span>
              <small>{item.nextSteps[0] ?? item.summary}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="planning-view__muted">All readiness checks are complete.</p>
      )}
    </section>
  );
}

function LaunchProofPanel({ proof }: { proof: ProjectLaunchProofReport | null }) {
  if (!proof) {
    return (
      <section className="planning-view__readiness" aria-label="Launch proof">
        <div className="planning-view__readiness-head">
          <div>
            <h3>Launch proof</h3>
            <p>Loading proof gates...</p>
          </div>
        </div>
      </section>
    );
  }
  const incomplete = proof.gates.filter((gate) => gate.status !== 'ready').slice(0, 5);
  return (
    <section className="planning-view__readiness planning-view__proof" aria-label="Launch proof">
      <div className="planning-view__readiness-head">
        <div>
          <h3>Launch proof</h3>
          <p>{proof.summary}</p>
        </div>
        <span>{proof.status}</span>
      </div>
      <div className="planning-view__readiness-meter">
        <strong>{proof.readyGateCount}/{proof.totalGateCount}</strong>
        <span>{proof.blockedGateCount} blocked</span>
      </div>
      {incomplete.length > 0 ? (
        <ul className="planning-view__readiness-list">
          {incomplete.map((gate) => (
            <li key={gate.id}>
              <strong>{gate.label}</strong>
              <span>{gate.status} · {gate.missingEvidence[0] ?? gate.summary}</span>
              <small>{gate.runIds.length} run(s) · {gate.artifactIds.length} artifact(s) · {gate.toolCheckIds.length} check(s)</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="planning-view__muted">Every launch proof gate has evidence.</p>
      )}
    </section>
  );
}

function HostedOperationsPanel() {
  return (
    <section className="planning-view__readiness planning-view__ops" aria-label="Hosted operations">
      <div className="planning-view__readiness-head">
        <div>
          <h3>Hosted operations</h3>
          <p>Production checks for open-design.ignitabull.org.</p>
        </div>
        <span>active</span>
      </div>
      <div className="planning-view__ops-grid">
        {HOSTED_OPERATIONS_ITEMS.map((item) => (
          <article key={item.label}>
            <strong>{item.label}</strong>
            <span>{item.status}</span>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function PlanDetail({
  plan,
  readiness,
  proof,
  launchPreview,
  ideationPrompt,
  ideationSessions,
  brainstorming,
  sectionSaving,
  actionSaving,
  executionSaving,
  liveRunEvents,
  capabilities,
  capabilityRefreshPolicy,
  capabilityRefreshSchedule,
  refreshingCapabilities,
  onIdeationPromptChange,
  onBrainstorm,
  onSaveSectionAnswer,
  onAcceptAction,
  onExecuteAction,
  onExecuteLaunchSequence,
  executionTargets,
  onExecutionTargetChange,
  deliveryTargets,
  onDeliveryTargetChange,
  projectManagementTargets,
  onProjectManagementTargetChange,
  validateProviderSetup,
  onValidateProviderSetupChange,
  onRunSection,
  sectionRunMode,
  onSectionRunModeChange,
  onRunReadySections,
  onCheckTool,
  onUpdateToolStatus,
  onRefreshCapabilities,
  onRunDueCapabilityRefresh,
  onToggleCapabilityRefreshSchedule,
  artifactSaving,
  artifactKind,
  artifactTitle,
  artifactContent,
  onArtifactKindChange,
  onArtifactTitleChange,
  onArtifactContentChange,
  onCreateArtifact,
}: {
  plan: ProjectPlan;
  readiness: ProjectPlanReadinessReport | null;
  proof: ProjectLaunchProofReport | null;
  launchPreview: ProjectLaunchPreview | null;
  ideationPrompt: string;
  ideationSessions: ProjectIdeationSession[];
  brainstorming: boolean;
  sectionSaving: string | null;
  actionSaving: string | null;
  executionSaving: string | null;
  liveRunEvents: Record<string, PlanningExecutionEvent[]>;
  capabilities: ProviderCapabilitySnapshot[];
  capabilityRefreshPolicy: ProviderCapabilityRefreshPolicy | null;
  capabilityRefreshSchedule: ProviderCapabilityRefreshSchedule | null;
  refreshingCapabilities: boolean;
  onIdeationPromptChange: (prompt: string) => void;
  onBrainstorm: () => void;
  onSaveSectionAnswer: (sectionId: ProjectWorkspaceSection['id'], answerText: string, notes: string) => void;
  onAcceptAction: (actionId: ProjectPlan['executionActions'][number]['id']) => void;
  onExecuteAction: (
    actionId: ProjectPlan['executionActions'][number]['id'],
    targetDir?: string,
    deliveryTarget?: ProjectPlan['delivery'][number]['target'] | '',
    projectManagementTarget?: Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> | '',
    validateProviders?: boolean,
  ) => void;
  onExecuteLaunchSequence: () => void;
  executionTargets: Record<string, string>;
  onExecutionTargetChange: (actionId: ProjectPlan['executionActions'][number]['id'], targetDir: string) => void;
  deliveryTargets: Record<string, ProjectPlan['delivery'][number]['target'] | ''>;
  onDeliveryTargetChange: (actionId: ProjectPlan['executionActions'][number]['id'], deliveryTarget: ProjectPlan['delivery'][number]['target'] | '') => void;
  projectManagementTargets: Record<string, Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> | ''>;
  onProjectManagementTargetChange: (
    actionId: ProjectPlan['executionActions'][number]['id'],
    projectManagementTarget: Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> | '',
  ) => void;
  validateProviderSetup: boolean;
  onValidateProviderSetupChange: (value: boolean) => void;
  onRunSection: (sectionId: ProjectWorkspaceSection['id']) => void;
  sectionRunMode: NonNullable<RunProjectPlanSectionsRequest['mode']>;
  onSectionRunModeChange: (mode: NonNullable<RunProjectPlanSectionsRequest['mode']>) => void;
  onRunReadySections: (mode: NonNullable<RunProjectPlanSectionsRequest['mode']>) => void;
  onCheckTool: (toolId: ProjectToolConnection['toolId']) => void;
  onUpdateToolStatus: (toolId: ProjectToolConnection['toolId'], status: ProjectToolConnection['status']) => void;
  onRefreshCapabilities: () => void;
  onRunDueCapabilityRefresh: (force?: boolean) => void;
  onToggleCapabilityRefreshSchedule: (enabled: boolean) => void;
  artifactSaving: boolean;
  artifactKind: PlanningExecutionArtifact['kind'];
  artifactTitle: string;
  artifactContent: string;
  onArtifactKindChange: (kind: PlanningExecutionArtifact['kind']) => void;
  onArtifactTitleChange: (title: string) => void;
  onArtifactContentChange: (content: string) => void;
  onCreateArtifact: () => void;
}) {
  const visibleCapabilities = plan.providerCapabilities.length > 0
    ? plan.providerCapabilities
    : capabilities.slice(0, 4);
  const [activeSectionId, setActiveSectionId] = useState<ProjectWorkspaceSection['id']>(
    plan.workspaceSections[0]?.id ?? 'planning',
  );
  useEffect(() => {
    if (!plan.workspaceSections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(plan.workspaceSections[0]?.id ?? 'planning');
    }
  }, [activeSectionId, plan.workspaceSections]);
  const activeSection = plan.workspaceSections.find((section) => section.id === activeSectionId)
    ?? plan.workspaceSections[0]
    ?? null;
  const runningSectionIds = useMemo(() => {
    if (executionSaving?.startsWith('section:')) {
      return new Set<ProjectWorkspaceSection['id']>([
        executionSaving.slice('section:'.length) as ProjectWorkspaceSection['id'],
      ]);
    }
    if (!executionSaving?.startsWith('sections:')) return new Set<ProjectWorkspaceSection['id']>();
    const mode = executionSaving.slice('sections:'.length) as NonNullable<RunProjectPlanSectionsRequest['mode']>;
    const workboard = plan.sectionWorkboard;
    if (mode === 'parallel') {
      return new Set(
        (workboard?.items ?? [])
          .filter((item) => item.readyForParallelRun)
          .map((item) => item.sectionId),
      );
    }
    const sequentialGroup = workboard?.parallelGroups.find((group) => group.mode === 'sequential');
    return new Set(sequentialGroup?.sectionIds ?? plan.workspaceSections.map((section) => section.id));
  }, [executionSaving, plan.sectionWorkboard, plan.workspaceSections]);
  const selectedProjectManagementTools = plan.selectedTools
    .map((tool) => tool.toolId)
    .filter((toolId): toolId is Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> =>
      toolId === 'github-issues' || toolId === 'linear' || toolId === 'google-docs',
    );
  const toolChecksById = new Map(plan.toolChecks.map((check) => [check.toolId, check]));
  const toolStatusCounts = plan.selectedTools.reduce<Record<ProjectToolConnection['status'], number>>(
    (counts, tool) => {
      counts[tool.status] += 1;
      return counts;
    },
    { wanted: 0, connected: 0, deferred: 0, blocked: 0 },
  );

  return (
    <section className="planning-view__detail" aria-labelledby="selected-plan-title">
      <div>
        <p className="planning-view__kicker">Selected plan</p>
        <h2 id="selected-plan-title">{plan.name}</h2>
        <p>{plan.intent.purpose}</p>
      </div>
      <ReadinessPanel readiness={readiness} />
      <LaunchProofPanel proof={proof} />
      <HostedOperationsPanel />
      <pre className="planning-view__command"><code>{plan.scaffold.command}</code></pre>
      <div className="planning-view__connected-tools">
        <div className="planning-view__tool-summary">
          <div>
            <h3>Provider status</h3>
            <p>Selected providers and deployment tools for this plan.</p>
          </div>
          <div className="planning-view__tool-status-counts" aria-label="Provider status counts">
            <span data-status="connected">{toolStatusCounts.connected} connected</span>
            <span data-status="deferred">{toolStatusCounts.deferred} deferred</span>
            <span data-status="blocked">{toolStatusCounts.blocked} blocked</span>
            <span data-status="wanted">{toolStatusCounts.wanted} wanted</span>
          </div>
        </div>
        {plan.selectedTools.length === 0 ? <p>No tools selected yet.</p> : null}
        <div>
          {plan.selectedTools.map((tool) => {
            const check = toolChecksById.get(tool.toolId);
            return (
              <article key={tool.toolId} className={`planning-view__tool-connection is-${tool.status}`}>
                <div>
                  <strong>{tool.toolId}</strong>
                  <span>
                    <mark>{tool.status}</mark>
                    {check ? ` · last check ${check.status}` : ''}
                    {tool.notes ? ` · ${tool.notes}` : ''}
                  </span>
                </div>
                <div className="planning-view__tool-actions">
                  <label>
                    <span>Status</span>
                    <select
                      value={tool.status}
                      disabled={executionSaving === `tool-status:${tool.toolId}`}
                      onChange={(event) => onUpdateToolStatus(tool.toolId, event.target.value as ProjectToolConnection['status'])}
                    >
                      <option value="wanted">Wanted</option>
                      <option value="connected">Connected</option>
                      <option value="deferred">Deferred</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="planning-view__secondary"
                    disabled={executionSaving === `tool:${tool.toolId}`}
                    onClick={() => onCheckTool(tool.toolId)}
                  >
                    {executionSaving === `tool:${tool.toolId}` ? 'Checking...' : 'Check'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="planning-view__decision-grid">
        <section>
          <h3>Pointed questions</h3>
          <div className="planning-view__question-list">
            {plan.ideationQuestions.map((question) => (
              <article key={question.id} className="planning-view__question">
                <strong>{question.question}</strong>
                <span>{question.whyItMatters}</span>
                {question.options?.length ? <small>{question.options.join(' · ')}</small> : null}
              </article>
            ))}
          </div>
        </section>
        <section>
          <h3>Database design</h3>
          <div className="planning-view__database">
            <span>{plan.databaseDesign.mode}</span>
            <span>{plan.databaseDesign.primaryStore}</span>
          </div>
          <DatabaseList title="Entities" items={plan.databaseDesign.entities} />
          <DatabaseList title="Relationships" items={plan.databaseDesign.relationships} />
          <DatabaseList title="Access patterns" items={plan.databaseDesign.accessPatterns} />
          <DatabaseList title="Migrations" items={plan.databaseDesign.migrations} />
          <DatabaseList title="Risks" items={plan.databaseDesign.riskNotes} />
        </section>
      </div>
      <div className="planning-view__sections">
        <div className="planning-view__section-heading">
          <div>
            <h3>Workspace sections</h3>
            <span>{activeSection?.label ?? 'No section'} workflow</span>
          </div>
          <div className="planning-view__section-run-controls">
            <label>
              <span>Agent run mode</span>
              <select
                value={sectionRunMode}
                onChange={(event) => onSectionRunModeChange(event.target.value as NonNullable<RunProjectPlanSectionsRequest['mode']>)}
              >
                <option value="parallel">Ready in parallel</option>
                <option value="sequential">Logical sequence</option>
              </select>
            </label>
            <button
              type="button"
              className="planning-view__secondary"
              disabled={executionSaving === `sections:${sectionRunMode}`}
              onClick={() => onRunReadySections(sectionRunMode)}
            >
              {executionSaving === `sections:${sectionRunMode}` ? 'Running...' : sectionRunMode === 'parallel' ? 'Run ready in parallel' : 'Run sequence'}
            </button>
          </div>
        </div>
        <SectionWorkboardPanel plan={plan} />
        <div className="planning-view__section-tabs" role="tablist" aria-label="Planning workflow sections">
          {plan.workspaceSections.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={section.id === activeSectionId}
              className={section.id === activeSectionId ? 'is-active' : ''}
              onClick={() => setActiveSectionId(section.id)}
            >
              <span>{section.label}</span>
              <small>{plan.sectionAnswers[section.id]?.status ?? 'not_started'}</small>
            </button>
          ))}
        </div>
        {activeSection ? (
          <SectionWorkflowPanel
            section={activeSection}
            plan={plan}
            saving={sectionSaving === activeSection.id}
            running={runningSectionIds.has(activeSection.id)}
            liveRunEvents={liveRunEvents}
            actionSaving={actionSaving}
            executionSaving={executionSaving}
            onSave={onSaveSectionAnswer}
            onAcceptAction={onAcceptAction}
            onRunSection={onRunSection}
          />
        ) : null}
      </div>
      <div className="planning-view__runtime">
        <h3>Runtime path</h3>
        <p>{plan.runtimePlan.summary}</p>
        <div>
          <span>{plan.runtimePlan.recommended}</span>
          <span>{plan.runtimePlan.requiredEnv.slice(0, 4).join(', ')}</span>
        </div>
      </div>
      <div className="planning-view__actions">
        <h3>Execution actions</h3>
        {launchPreview && launchPreview.missingInputs.length > 0 ? (
          <ul className="planning-view__readiness-list" aria-label="Launch inputs">
            {launchPreview.missingInputs.slice(0, 4).map((input) => (
              <li key={input}>
                <strong>Launch input</strong>
                <span>missing</span>
                <small>{input}</small>
              </li>
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          className="planning-view__primary"
          disabled={executionSaving === 'launch-sequence'}
          onClick={onExecuteLaunchSequence}
        >
          {executionSaving === 'launch-sequence' ? 'Running launch...' : 'Run launch sequence'}
        </button>
        {plan.executionActions.map((action) => (
          <article key={action.id} className="planning-view__action">
            <div>
              <strong>{action.label}</strong>
              <span>{action.status} · {action.requiresConfirmation ? 'confirmation required' : 'open'}</span>
            </div>
            {action.command ? <code>{action.command}</code> : null}
            {action.id === 'scaffold' || action.id === 'repo-create' || action.id === 'provider-setup' || action.id === 'database-materialize' || action.id === 'database-migrate' || action.id === 'design-materialize' ? (
              <label className="planning-view__execution-target">
                <span>
                  {action.id === 'scaffold'
                    ? 'Scaffold parent directory'
                    : 'Scaffold source directory'}
                </span>
                <input
                  value={executionTargets[action.id] ?? ''}
                  placeholder={action.id === 'scaffold' ? 'workspace' : 'workspace/my-project'}
                  onChange={(event) => onExecutionTargetChange(action.id, event.target.value)}
                />
              </label>
            ) : null}
            {action.id === 'deploy-runtime' ? (
              <div className="planning-view__execution-grid">
                <label className="planning-view__execution-target">
                  <span>Deployment source directory</span>
                  <input
                    value={executionTargets[action.id] ?? ''}
                    placeholder="workspace/my-project"
                    onChange={(event) => onExecutionTargetChange(action.id, event.target.value)}
                  />
                </label>
                <label className="planning-view__execution-target">
                  <span>Delivery target</span>
                  <select
                    value={deliveryTargets[action.id] ?? plan.delivery[0]?.target ?? ''}
                    onChange={(event) => {
                      onDeliveryTargetChange(action.id, event.target.value as ProjectPlan['delivery'][number]['target'] | '');
                    }}
                  >
                    {plan.delivery.length === 0 ? <option value="">No delivery targets</option> : null}
                    {plan.delivery.map((delivery) => (
                      <option key={delivery.target} value={delivery.target}>{delivery.target}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            {action.id === 'provider-setup' ? (
              <label className="planning-view__execution-target">
                <span>Validate selected providers</span>
                <input
                  type="checkbox"
                  checked={validateProviderSetup}
                  onChange={(event) => onValidateProviderSetupChange(event.target.checked)}
                />
              </label>
            ) : null}
            {action.id === 'project-management' ? (
              <div className="planning-view__execution-grid">
                <label className="planning-view__execution-target">
                  <span>Working directory</span>
                  <input
                    value={executionTargets[action.id] ?? ''}
                    placeholder="workspace/my-project"
                    onChange={(event) => onExecutionTargetChange(action.id, event.target.value)}
                  />
                </label>
                <label className="planning-view__execution-target">
                  <span>Project-management target</span>
                  <select
                    value={projectManagementTargets[action.id] ?? selectedProjectManagementTools[0] ?? ''}
                    onChange={(event) => {
                      onProjectManagementTargetChange(
                        action.id,
                        event.target.value as Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> | '',
                      );
                    }}
                  >
                    {selectedProjectManagementTools.length === 0 ? <option value="">No PM targets</option> : null}
                    {selectedProjectManagementTools.map((toolId) => (
                      <option key={toolId} value={toolId}>{toolId}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            <button
              type="button"
              className="planning-view__secondary"
              disabled={actionSaving === action.id || action.status === 'accepted' || action.status === 'completed'}
              onClick={() => onAcceptAction(action.id)}
            >
              {actionSaving === action.id ? 'Accepting...' : action.status === 'accepted' ? 'Accepted' : 'Accept action'}
            </button>
            <button
              type="button"
              className="planning-view__secondary"
              disabled={executionSaving === `action:${action.id}`}
              onClick={() => onExecuteAction(
                action.id,
                executionTargets[action.id],
                deliveryTargets[action.id] || plan.delivery[0]?.target,
                projectManagementTargets[action.id] || selectedProjectManagementTools[0],
                action.id === 'provider-setup' ? validateProviderSetup : false,
              )}
            >
              {executionSaving === `action:${action.id}` ? 'Recording...' : 'Execute'}
            </button>
          </article>
        ))}
      </div>
      <div className="planning-view__actions">
        <h3>Execution history</h3>
        {(plan.executionRuns ?? []).length === 0 ? <p className="planning-view__muted">No execution runs yet.</p> : null}
        {(plan.executionRuns ?? []).slice(0, 6).map((run) => (
          <article key={run.id} className="planning-view__action">
            <div>
              <strong>{run.title}</strong>
              <span>{run.status} · {run.kind} · {run.mode}</span>
            </div>
            <span>{run.summary}</span>
            <RunEvents events={eventsForRun(plan, liveRunEvents, run.id).slice(-3)} />
            <RunEvidence evidence={run.evidence} />
          </article>
        ))}
        {(plan.executionArtifacts ?? []).length > 0 ? (
          <div className="planning-view__task-list">
            <h3>Artifacts</h3>
            <ul>
              {(plan.executionArtifacts ?? []).slice(0, 5).map((artifact) => (
                <li key={artifact.id}>{artifact.kind}: {artifact.title}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <form
          className="planning-view__artifact-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onCreateArtifact();
          }}
        >
          <h3>Create artifact</h3>
          <div className="planning-view__execution-grid">
            <label className="planning-view__execution-target">
              <span>Kind</span>
              <select
                value={artifactKind}
                onChange={(event) => onArtifactKindChange(event.target.value as PlanningExecutionArtifact['kind'])}
              >
                {ARTIFACT_KIND_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
            </label>
            <label className="planning-view__execution-target">
              <span>Title</span>
              <input
                value={artifactTitle}
                placeholder="PRD handoff notes"
                onChange={(event) => onArtifactTitleChange(event.target.value)}
              />
            </label>
          </div>
          <label className="planning-view__artifact-content">
            <span>Content</span>
            <textarea
              value={artifactContent}
              rows={4}
              placeholder="Paste generated notes, drafts, schema decisions, or handoff details."
              onChange={(event) => onArtifactContentChange(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="planning-view__secondary"
            disabled={artifactSaving || !artifactTitle.trim() || !artifactContent.trim()}
          >
            {artifactSaving ? 'Creating...' : 'Create artifact'}
          </button>
        </form>
        {(plan.toolChecks ?? []).length > 0 ? (
          <div className="planning-view__task-list">
            <h3>Tool checks</h3>
            <ul>
              {(plan.toolChecks ?? []).map((check) => (
                <li key={check.id}>{check.toolId}: {check.status}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="planning-view__capabilities">
        <div className="planning-view__capability-header">
          <div>
            <h3>Provider snapshots</h3>
            {capabilityRefreshPolicy ? (
              <span>
                {capabilityRefreshPolicy.cadence} refresh · stale after {capabilityRefreshPolicy.staleAfterDays} day(s) · {capabilityRefreshPolicy.staleCount} stale
              </span>
            ) : null}
            <span>{formatCapabilityRefreshSchedule(capabilityRefreshSchedule)}</span>
            {capabilityRefreshSchedule?.lastSummary ? <span>{capabilityRefreshSchedule.lastSummary}</span> : null}
          </div>
          <div className="planning-view__capability-actions">
            {capabilityRefreshSchedule ? (
              <button
                type="button"
                className="planning-view__secondary"
                disabled={refreshingCapabilities}
                onClick={() => onToggleCapabilityRefreshSchedule(!capabilityRefreshSchedule.enabled)}
              >
                {capabilityRefreshSchedule.enabled ? 'Disable schedule' : 'Enable schedule'}
              </button>
            ) : null}
            <button
              type="button"
              className="planning-view__secondary"
              disabled={refreshingCapabilities}
              onClick={() => onRunDueCapabilityRefresh(false)}
            >
              {refreshingCapabilities ? 'Refreshing...' : 'Run due'}
            </button>
            <button
              type="button"
              className="planning-view__secondary"
              disabled={refreshingCapabilities}
              onClick={() => onRunDueCapabilityRefresh(true)}
            >
              Force refresh
            </button>
            <button
              type="button"
              className="planning-view__secondary"
              disabled={refreshingCapabilities}
              onClick={() => onRefreshCapabilities()}
            >
              Refresh snapshots
            </button>
          </div>
        </div>
        {visibleCapabilities.map((snapshot) => (
          <article key={`${snapshot.toolId}-${snapshot.sourceUrl}`} className="planning-view__capability">
            <strong>{snapshot.label}</strong>
            <span>Checked {snapshot.checkedAt}</span>
            <p>{snapshot.planningImplications[0]}</p>
            <button
              type="button"
              className="planning-view__secondary"
              disabled={executionSaving === `tool:${snapshot.toolId}`}
              onClick={() => onCheckTool(snapshot.toolId)}
            >
              {executionSaving === `tool:${snapshot.toolId}` ? 'Checking...' : 'Check tool'}
            </button>
          </article>
        ))}
      </div>
      <div className="planning-view__task-list">
        <h3>Post-scaffold tasks</h3>
        <ul>
          {plan.scaffold.postScaffoldTasks.map((task) => (
            <li key={task}>{task}</li>
          ))}
        </ul>
      </div>
      <div className="planning-view__ideation">
        <h3>Brainstorm</h3>
        <textarea
          value={ideationPrompt}
          rows={3}
          onChange={(event) => onIdeationPromptChange(event.target.value)}
          aria-label="Brainstorm prompt"
        />
        <button
          type="button"
          className="planning-view__secondary"
          disabled={brainstorming || !ideationPrompt.trim()}
          onClick={() => void onBrainstorm()}
        >
          {brainstorming ? 'Thinking...' : 'Generate directions'}
        </button>
      </div>
      {ideationSessions.length > 0 ? (
        <div className="planning-view__ideas">
          <h3>Ideation history</h3>
          {ideationSessions.map((session) => (
            <article key={session.id} className="planning-view__idea">
              <p className="planning-view__idea-summary">{session.summary}</p>
              {session.options.map((option) => (
                <div key={option.title} className="planning-view__idea-option">
                  <strong>{option.title}</strong>
                  <span>{option.rationale}</span>
                  <small>{option.toolIds.join(', ')}</small>
                </div>
              ))}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RunEvidence({ evidence }: { evidence: string[] }) {
  const externalUrls = evidence
    .map((item) => item.startsWith('externalUrl: ') ? item.slice('externalUrl: '.length).trim() : '')
    .filter(Boolean);
  const context = evidence
    .filter((item) => !item.startsWith('externalUrl: '))
    .slice(0, 3);
  if (externalUrls.length === 0 && context.length === 0) return null;
  return (
    <div className="planning-view__run-evidence">
      {externalUrls.length > 0 ? (
        <div>
          <strong>External proof</strong>
          <ul>
            {externalUrls.slice(0, 4).map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">{url}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {context.length > 0 ? (
        <small>{context.join(' · ')}</small>
      ) : null}
    </div>
  );
}

function SectionWorkboardPanel({ plan }: { plan: ProjectPlan }) {
  const workboard = plan.sectionWorkboard;
  if (!workboard) return null;
  const nextSectionIds = workboard.nextSectionIds ?? [];
  const parallelGroups = workboard.parallelGroups ?? [];
  const items = workboard.items ?? [];
  return (
    <div className="planning-view__workboard" aria-label="Section orchestration workboard">
      <div className="planning-view__workboard-summary">
        <strong>{workboard.summary}</strong>
        <span>Next: {nextSectionIds.length ? nextSectionIds.join(', ') : 'none'}</span>
      </div>
      <div className="planning-view__workboard-groups">
        {parallelGroups.map((group) => (
          <article key={group.id} className="planning-view__workboard-group">
            <strong>{group.label}</strong>
            <span>{group.mode} · {group.sectionIds.join(', ') || 'none'}</span>
            {group.blockedBy.length ? <small>Blocked by {group.blockedBy.join(' · ')}</small> : <small>No blockers recorded</small>}
          </article>
        ))}
      </div>
      <div className="planning-view__workboard-items">
        {items.map((item) => (
          <span key={item.sectionId} className={item.readyForParallelRun ? 'is-parallel-ready' : ''}>
            {item.label}: {item.readyForParallelRun ? 'parallel-ready' : item.status}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatCapabilityRefreshSchedule(schedule: ProviderCapabilityRefreshSchedule | null) {
  if (!schedule) return 'Schedule not loaded';
  const nextRun = schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : 'not scheduled';
  return `${schedule.enabled ? 'enabled' : 'disabled'} · ${schedule.schedule.kind} · next ${nextRun} · last ${schedule.lastStatus}`;
}

function DatabaseList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="planning-view__database-list">
      <strong>{title}</strong>
      <ul>
        {items.slice(0, 5).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function SectionWorkflowPanel({
  section,
  plan,
  saving,
  running,
  liveRunEvents,
  actionSaving,
  executionSaving,
  onSave,
  onAcceptAction,
  onRunSection,
}: {
  section: ProjectWorkspaceSection;
  plan: ProjectPlan;
  saving: boolean;
  running: boolean;
  liveRunEvents: Record<string, PlanningExecutionEvent[]>;
  actionSaving: string | null;
  executionSaving: string | null;
  onSave: (sectionId: ProjectWorkspaceSection['id'], answerText: string, notes: string) => void;
  onAcceptAction: (actionId: ProjectPlan['executionActions'][number]['id']) => void;
  onRunSection: (sectionId: ProjectWorkspaceSection['id']) => void;
}) {
  const answer = plan.sectionAnswers[section.id];
  const [answerText, setAnswerText] = useState(answer?.answers.join('\n') ?? '');
  const [notes, setNotes] = useState(answer?.notes ?? '');
  const laneIds = new Set(section.relatedLaneIds);
  const lanes = plan.agentLanes.filter((lane) => lane.sectionId === section.id || laneIds.has(lane.id));
  const questions = plan.ideationQuestions.filter((question) => laneIds.has(question.laneId));
  const actions = plan.executionActions.filter((action) => action.relatedSectionIds.includes(section.id));
  const capabilities = plan.providerCapabilities.filter((snapshot) => section.toolIds.includes(snapshot.toolId));
  const latestRun = [...(plan.executionRuns ?? [])]
    .reverse()
    .find((run) => run.kind === 'section-agent' && run.sectionId === section.id);
  const latestManifest = latestRun
    ? [...(plan.executionArtifacts ?? [])]
      .reverse()
      .find((artifact) =>
        artifact.kind === 'specialist-agent-manifest'
        && latestRun.artifactIds.includes(artifact.id)
        && artifact.title.includes(section.label),
      )
    : undefined;
  const latestRunEvents = latestRun ? eventsForRun(plan, liveRunEvents, latestRun.id).slice(-5) : [];
  const readyLanes = lanes.filter((lane) => lane.status === 'ready').length;
  const blockedLanes = lanes.filter((lane) => lane.status === 'blocked').length;
  const acceptedActions = actions.filter((action) => action.status === 'accepted' || action.status === 'completed').length;
  const blockedActions = actions.filter((action) => action.status === 'blocked').length;
  const dependencies = Array.from(new Set(lanes.flatMap((lane) => lane.dependsOn)));
  const parallelPeers = Array.from(new Set(lanes.flatMap((lane) => lane.parallelWith)));
  const providerRisks = capabilities.flatMap((snapshot) =>
    snapshot.riskNotes.slice(0, 1).map((risk) => `${snapshot.toolId}: ${risk}`),
  );

  useEffect(() => {
    setAnswerText(answer?.answers.join('\n') ?? '');
    setNotes(answer?.notes ?? '');
  }, [answer]);

  return (
    <article className={`planning-view__section-workflow planning-view__section-card--${section.id}`}>
      <div>
        <strong>{section.label}</strong>
        <span>{section.purpose}</span>
        <button
          type="button"
          className="planning-view__secondary"
          disabled={running}
          onClick={() => onRunSection(section.id)}
        >
          {running ? 'Running...' : 'Run section agent'}
        </button>
      </div>
      <div className="planning-view__section-dashboard" aria-label={`${section.label} section dashboard`}>
        <div className="planning-view__section-metric">
          <strong>{answer?.status ?? 'not_started'}</strong>
          <span>Decision status</span>
        </div>
        <div className="planning-view__section-metric">
          <strong>{readyLanes}/{lanes.length || 0}</strong>
          <span>Ready lanes</span>
        </div>
        <div className="planning-view__section-metric">
          <strong>{acceptedActions}/{actions.length || 0}</strong>
          <span>Accepted actions</span>
        </div>
        <div className="planning-view__section-metric">
          <strong>{blockedLanes + blockedActions}</strong>
          <span>Visible blockers</span>
        </div>
      </div>
      <div className="planning-view__section-agent-summary">
        <div>
          <h4>Latest specialist run</h4>
          {running ? (
            <div className="planning-view__workflow-item is-running" aria-live="polite">
              <strong>running · pending</strong>
              <span>{latestRunEvents.at(-1)?.message ?? `The ${section.label} specialist is generating section output and proof.`}</span>
              <small>{latestRunEvents.at(-1) ? `${latestRunEvents.at(-1)?.type} · ${new Date(latestRunEvents.at(-1)?.createdAt ?? Date.now()).toLocaleTimeString()}` : 'Previous stored run remains visible after completion.'}</small>
              <RunEvents events={latestRunEvents} />
            </div>
          ) : latestRun ? (
            <div className="planning-view__workflow-item">
              <strong>{latestRun.status} · {latestRun.mode}</strong>
              <span>{latestRun.summary}</span>
              <small>{formatSectionRunMeta(latestRun)}</small>
              <RunEvents events={latestRunEvents.slice(-3)} />
            </div>
          ) : (
            <span className="planning-view__muted">No specialist run has been recorded for this section yet.</span>
          )}
        </div>
        <div>
          <h4>Agent manifest</h4>
          {latestManifest ? (
            <div className="planning-view__workflow-item">
              <strong>{latestManifest.title}</strong>
              <span>{latestManifest.kind}</span>
              <small>{latestManifest.id}</small>
            </div>
          ) : (
            <span className="planning-view__muted">Run this section agent to generate a structured specialist manifest.</span>
          )}
        </div>
      </div>
      <div className="planning-view__section-dependency-grid">
        <div>
          <h4>Dependencies</h4>
          {dependencies.length ? dependencies.map((dependency) => <span key={dependency}>{dependency}</span>) : <span>none</span>}
        </div>
        <div>
          <h4>Parallel peers</h4>
          {parallelPeers.length ? parallelPeers.map((peer) => <span key={peer}>{peer}</span>) : <span>none</span>}
        </div>
        <div>
          <h4>Provider risks</h4>
          {providerRisks.length ? providerRisks.map((risk) => <span key={risk}>{risk}</span>) : <span>none recorded</span>}
        </div>
      </div>
      <dl>
        <div>
          <dt>Owns</dt>
          <dd>{section.owns.slice(0, 4).join(', ')}</dd>
        </div>
        <div>
          <dt>Not this section</dt>
          <dd>{section.doesNotOwn.slice(0, 3).join(', ')}</dd>
        </div>
        <div>
          <dt>Outputs</dt>
          <dd>{section.outputs.slice(0, 3).join(', ')}</dd>
        </div>
      </dl>
      <div className="planning-view__workflow-grid">
        <section>
          <h4>Pointed questions</h4>
          {questions.map((question) => (
            <div key={question.id} className="planning-view__workflow-item">
              <strong>{question.question}</strong>
              <span>{question.whyItMatters}</span>
              {question.options?.length ? <small>{question.options.join(' · ')}</small> : null}
            </div>
          ))}
        </section>
        <section>
          <h4>Agent outputs</h4>
          {lanes.map((lane) => (
            <div key={lane.id} className="planning-view__workflow-item">
              <strong>{lane.label}</strong>
              <span>{lane.outputs.join(' · ')}</span>
              <small>{lane.mode} · {lane.status}{lane.parallelWith.length ? ` · parallel with ${lane.parallelWith.join(', ')}` : ''}</small>
            </div>
          ))}
        </section>
        <section>
          <h4>Runbook</h4>
          {lanes.flatMap((lane) => lane.runbook.map((step) => `${lane.label}: ${step}`)).slice(0, 6).map((step) => (
            <div key={step} className="planning-view__workflow-item">
              <span>{step}</span>
            </div>
          ))}
        </section>
        <section>
          <h4>Execution</h4>
          {actions.length === 0 ? <span className="planning-view__muted">No direct execution actions for this section yet.</span> : null}
          {actions.map((action) => (
            <div key={action.id} className="planning-view__workflow-item">
              <strong>{action.label}</strong>
              <span>{action.status} · {action.requiresConfirmation ? 'confirmation required' : 'open'}</span>
              {action.command ? <code>{action.command}</code> : null}
              <button
                type="button"
                className="planning-view__secondary"
                disabled={actionSaving === action.id || action.status === 'accepted' || action.status === 'completed'}
                onClick={() => onAcceptAction(action.id)}
              >
                {actionSaving === action.id ? 'Accepting...' : action.status === 'accepted' ? 'Accepted' : 'Accept action'}
              </button>
            </div>
          ))}
        </section>
      </div>
      {section.id === 'database' ? (
        <div className="planning-view__database-workflow">
          <DatabaseList title="Entities" items={plan.databaseDesign.entities} />
          <DatabaseList title="Relationships" items={plan.databaseDesign.relationships} />
          <DatabaseList title="Access patterns" items={plan.databaseDesign.accessPatterns} />
          <DatabaseList title="Migrations" items={plan.databaseDesign.migrations} />
          <DatabaseList title="Risks" items={plan.databaseDesign.riskNotes} />
        </div>
      ) : null}
      {capabilities.length > 0 ? (
        <div className="planning-view__section-capabilities">
          <h4>Provider notes</h4>
          {capabilities.map((snapshot) => (
            <span key={`${snapshot.toolId}-${snapshot.sourceUrl}`}>{snapshot.label} · checked {snapshot.checkedAt}</span>
          ))}
        </div>
      ) : null}
      <div className="planning-view__section-editor">
        <label>
          <span>Answers</span>
          <textarea
            rows={4}
            value={answerText}
            onChange={(event) => setAnswerText(event.target.value)}
          />
        </label>
        <label>
          <span>Notes</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="planning-view__secondary"
          disabled={saving}
          onClick={() => onSave(section.id, answerText, notes)}
        >
          {saving ? 'Saving...' : 'Save section'}
        </button>
      </div>
    </article>
  );
}

function formatSectionRunMeta(run: ProjectPlan['executionRuns'][number]): string {
  const evidence = run.evidence.slice(0, 3).join(' · ');
  const timing = run.completedAt
    ? `completed ${new Date(run.completedAt).toLocaleString()}`
    : `started ${new Date(run.startedAt).toLocaleString()}`;
  return evidence ? `${timing} · ${evidence}` : timing;
}

function eventsForRun(
  plan: ProjectPlan,
  liveRunEvents: Record<string, PlanningExecutionEvent[]>,
  runId: string,
): PlanningExecutionEvent[] {
  const byId = new Map<string, PlanningExecutionEvent>();
  for (const event of plan.executionEvents ?? []) {
    if (event.runId === runId) byId.set(event.id, event);
  }
  for (const event of liveRunEvents[runId] ?? []) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values()).sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt);
}

function RunEvents({ events }: { events: PlanningExecutionEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="planning-view__run-events">
      {events.map((event) => (
        <div key={event.id} className="planning-view__run-event">
          <strong>{event.type.replaceAll('_', ' ')}</strong>
          <span>{event.message}</span>
          <small>{new Date(event.createdAt).toLocaleTimeString()}</small>
        </div>
      ))}
    </div>
  );
}
