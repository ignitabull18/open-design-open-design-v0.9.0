import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PlanningToolOption,
  ProviderCapabilitySnapshot,
  ProjectIdeationSession,
  ProjectPlan,
  ProjectToolConnection,
  ProjectWorkspaceSection,
  ProjectStackDecision,
} from '@open-design/contracts';
import { Icon } from './Icon';
import {
  acceptProjectPlanAction,
  checkProjectPlanTool,
  createPlanningSession,
  createProjectIdeationSession,
  createProjectPlan,
  executeProjectPlanAction,
  isPlanningAuthError,
  listProviderCapabilitySnapshots,
  listProjectIdeationSessions,
  listPlanningTools,
  listProjectPlans,
  refreshProviderCapabilitySnapshots,
  runProjectPlanSection,
  runProjectPlanSections,
  updateProjectSectionWorkflow,
} from '../providers/plans';

const HOSTING_OPTIONS: NonNullable<ProjectStackDecision['hosting']> = [
  'cloudflare',
  'vercel',
  'coolify',
  'hostinger',
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

export function PlanningView() {
  const [plans, setPlans] = useState<ProjectPlan[]>([]);
  const [tools, setTools] = useState<PlanningToolOption[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapabilitySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [apiToken, setApiToken] = useState('');
  const [authSaving, setAuthSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ideationByPlanId, setIdeationByPlanId] = useState<Record<string, ProjectIdeationSession[]>>({});
  const [ideationPrompt, setIdeationPrompt] = useState('Explore stack directions for this project and call out what tools I need to connect first.');
  const [brainstorming, setBrainstorming] = useState(false);
  const [sectionSaving, setSectionSaving] = useState<string | null>(null);
  const [actionSaving, setActionSaving] = useState<string | null>(null);
  const [executionSaving, setExecutionSaving] = useState<string | null>(null);
  const [executionTargets, setExecutionTargets] = useState<Record<string, string>>({});
  const [deliveryTargets, setDeliveryTargets] = useState<Record<string, ProjectPlan['delivery'][number]['target'] | ''>>({});
  const [projectManagementTargets, setProjectManagementTargets] = useState<Record<string, Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> | ''>>({});
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
      });
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecutionSaving(null);
    }
  }

  async function handleRunSection(sectionId: ProjectWorkspaceSection['id']) {
    if (!selectedPlan) return;
    setExecutionSaving(`section:${sectionId}`);
    setError(null);
    try {
      const result = await runProjectPlanSection(selectedPlan.id, { sectionId });
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecutionSaving(null);
    }
  }

  async function handleRunReadySections() {
    if (!selectedPlan) return;
    setExecutionSaving('sections:ready');
    setError(null);
    try {
      const result = await runProjectPlanSections(selectedPlan.id, { onlyReady: true, mode: 'parallel' });
      setPlans((curr) => curr.map((plan) => (plan.id === result.plan.id ? result.plan : plan)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecutionSaving(null);
    }
  }

  async function handleRefreshCapabilities() {
    setRefreshingCapabilities(true);
    setError(null);
    try {
      const result = await refreshProviderCapabilitySnapshots({ persist: true });
      const plansResult = await listProjectPlans();
      setCapabilities(result.capabilities);
      setPlans(plansResult.plans);
      setSelectedId((curr) => curr ?? plansResult.plans[0]?.id ?? null);
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
              ideationPrompt={ideationPrompt}
              ideationSessions={selectedIdeation}
              brainstorming={brainstorming}
              sectionSaving={sectionSaving}
              actionSaving={actionSaving}
              executionSaving={executionSaving}
              capabilities={capabilities}
              onIdeationPromptChange={setIdeationPrompt}
              onBrainstorm={handleBrainstorm}
              onSaveSectionAnswer={handleSaveSectionAnswer}
              onAcceptAction={handleAcceptAction}
              onExecuteAction={handleExecuteAction}
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
              onRunSection={handleRunSection}
              onRunReadySections={handleRunReadySections}
              onCheckTool={handleCheckTool}
              onRefreshCapabilities={handleRefreshCapabilities}
              refreshingCapabilities={refreshingCapabilities}
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

function PlanDetail({
  plan,
  ideationPrompt,
  ideationSessions,
  brainstorming,
  sectionSaving,
  actionSaving,
  executionSaving,
  capabilities,
  refreshingCapabilities,
  onIdeationPromptChange,
  onBrainstorm,
  onSaveSectionAnswer,
  onAcceptAction,
  onExecuteAction,
  executionTargets,
  onExecutionTargetChange,
  deliveryTargets,
  onDeliveryTargetChange,
  projectManagementTargets,
  onProjectManagementTargetChange,
  onRunSection,
  onRunReadySections,
  onCheckTool,
  onRefreshCapabilities,
}: {
  plan: ProjectPlan;
  ideationPrompt: string;
  ideationSessions: ProjectIdeationSession[];
  brainstorming: boolean;
  sectionSaving: string | null;
  actionSaving: string | null;
  executionSaving: string | null;
  capabilities: ProviderCapabilitySnapshot[];
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
  ) => void;
  executionTargets: Record<string, string>;
  onExecutionTargetChange: (actionId: ProjectPlan['executionActions'][number]['id'], targetDir: string) => void;
  deliveryTargets: Record<string, ProjectPlan['delivery'][number]['target'] | ''>;
  onDeliveryTargetChange: (actionId: ProjectPlan['executionActions'][number]['id'], deliveryTarget: ProjectPlan['delivery'][number]['target'] | '') => void;
  projectManagementTargets: Record<string, Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> | ''>;
  onProjectManagementTargetChange: (
    actionId: ProjectPlan['executionActions'][number]['id'],
    projectManagementTarget: Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> | '',
  ) => void;
  onRunSection: (sectionId: ProjectWorkspaceSection['id']) => void;
  onRunReadySections: () => void;
  onCheckTool: (toolId: ProjectToolConnection['toolId']) => void;
  onRefreshCapabilities: () => void;
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
  const selectedProjectManagementTools = plan.selectedTools
    .map((tool) => tool.toolId)
    .filter((toolId): toolId is Extract<ProjectToolConnection['toolId'], 'github-issues' | 'linear' | 'google-docs'> =>
      toolId === 'github-issues' || toolId === 'linear' || toolId === 'google-docs',
    );
  const toolChecksById = new Map(plan.toolChecks.map((check) => [check.toolId, check]));

  return (
    <section className="planning-view__detail" aria-labelledby="selected-plan-title">
      <div>
        <p className="planning-view__kicker">Selected plan</p>
        <h2 id="selected-plan-title">{plan.name}</h2>
        <p>{plan.intent.purpose}</p>
      </div>
      <pre className="planning-view__command"><code>{plan.scaffold.command}</code></pre>
      <div className="planning-view__connected-tools">
        <h3>Tool connections</h3>
        {plan.selectedTools.length === 0 ? <p>No tools selected yet.</p> : null}
        <div>
          {plan.selectedTools.map((tool) => {
            const check = toolChecksById.get(tool.toolId);
            return (
              <article key={tool.toolId} className="planning-view__tool-connection">
                <div>
                  <strong>{tool.toolId}</strong>
                  <span>{tool.status}{check ? ` · last check ${check.status}` : ''}</span>
                </div>
                <button
                  type="button"
                  className="planning-view__secondary"
                  disabled={executionSaving === `tool:${tool.toolId}`}
                  onClick={() => onCheckTool(tool.toolId)}
                >
                  {executionSaving === `tool:${tool.toolId}` ? 'Checking...' : 'Check'}
                </button>
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
          <button
            type="button"
            className="planning-view__secondary"
            disabled={executionSaving === 'sections:ready'}
            onClick={() => onRunReadySections()}
          >
            {executionSaving === 'sections:ready' ? 'Running...' : 'Run ready in parallel'}
          </button>
        </div>
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
          <h3>Provider snapshots</h3>
          <button
            type="button"
            className="planning-view__secondary"
            disabled={refreshingCapabilities}
            onClick={() => onRefreshCapabilities()}
          >
            {refreshingCapabilities ? 'Refreshing...' : 'Refresh snapshots'}
          </button>
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
  actionSaving,
  executionSaving,
  onSave,
  onAcceptAction,
  onRunSection,
}: {
  section: ProjectWorkspaceSection;
  plan: ProjectPlan;
  saving: boolean;
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
          disabled={executionSaving === `section:${section.id}`}
          onClick={() => onRunSection(section.id)}
        >
          {executionSaving === `section:${section.id}` ? 'Running...' : 'Run section agent'}
        </button>
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
