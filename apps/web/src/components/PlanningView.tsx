import { useEffect, useMemo, useState } from 'react';
import type {
  PlanningToolOption,
  ProjectIdeationSession,
  ProjectPlan,
  ProjectStackDecision,
} from '@open-design/contracts';
import { Icon } from './Icon';
import {
  createProjectIdeationSession,
  createProjectPlan,
  listProjectIdeationSessions,
  listPlanningTools,
  listProjectPlans,
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ideationByPlanId, setIdeationByPlanId] = useState<Record<string, ProjectIdeationSession[]>>({});
  const [ideationPrompt, setIdeationPrompt] = useState('Explore stack directions for this project and call out what tools I need to connect first.');
  const [brainstorming, setBrainstorming] = useState(false);
  const [name, setName] = useState('New product workspace');
  const [purpose, setPurpose] = useState('Plan, scaffold, and ship a web app from an accepted stack decision.');
  const [audience, setAudience] = useState('operators and product builders');
  const [stack, setStack] = useState<ProjectStackDecision>(INITIAL_STACK);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [plansResult, toolsResult] = await Promise.all([
          listProjectPlans(),
          listPlanningTools(),
        ]);
        if (cancelled) return;
        setPlans(plansResult.plans);
        setTools(toolsResult.tools);
        setSelectedId((curr) => curr ?? plansResult.plans[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedId) ?? plans[0] ?? null,
    [plans, selectedId],
  );
  const toolCountByKind = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tool of tools) counts.set(tool.kind, (counts.get(tool.kind) ?? 0) + 1);
    return Array.from(counts.entries());
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
              onIdeationPromptChange={setIdeationPrompt}
              onBrainstorm={handleBrainstorm}
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
  onIdeationPromptChange,
  onBrainstorm,
}: {
  plan: ProjectPlan;
  ideationPrompt: string;
  ideationSessions: ProjectIdeationSession[];
  brainstorming: boolean;
  onIdeationPromptChange: (prompt: string) => void;
  onBrainstorm: () => void;
}) {
  return (
    <section className="planning-view__detail" aria-labelledby="selected-plan-title">
      <div>
        <p className="planning-view__kicker">Selected plan</p>
        <h2 id="selected-plan-title">{plan.name}</h2>
        <p>{plan.intent.purpose}</p>
      </div>
      <pre className="planning-view__command"><code>{plan.scaffold.command}</code></pre>
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
          <ul>
            {plan.databaseDesign.entities.slice(0, 6).map((entity) => (
              <li key={entity}>{entity}</li>
            ))}
          </ul>
        </section>
      </div>
      <div className="planning-view__lanes">
        <h3>Agent lanes</h3>
        {plan.agentLanes.map((lane) => (
          <article key={lane.id} className="planning-view__lane">
            <div>
              <strong>{lane.label}</strong>
              <span>{lane.brief}</span>
            </div>
            <small>{lane.mode} · {lane.status}{lane.dependsOn.length ? ` · after ${lane.dependsOn.join(', ')}` : ''}</small>
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
