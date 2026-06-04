# Planning, Stack Selection, and Scaffold Workflow

**Status:** in progress  
**Owner surface:** daemon `/api/plans`, `od plan ...`, and the Planning UI  
**Primary scaffold engine:** Better-T-Stack

## Product intent

Open Design should store whole software projects before implementation starts. A project plan begins with the user's purpose, audience, constraints, and success criteria, then lets the AI help choose from eligible stack tools, produce a Better-T-Stack scaffold command, and track GitHub plus deployment follow-through.

The first supported stack catalog is intentionally opinionated around the user's current operating surface:

| Category | Supported choices |
|---|---|
| Source control | GitHub |
| Hosting | Cloudflare, Vercel, Coolify, Hostinger |
| Database | Supabase, Cloudflare D1/R2/Vectorize, Convex, Postgres on Coolify |
| Payments | Stripe |
| Project management | Linear, GitHub Issues, Google Docs |
| AI/runtime | Codex, Cloudflare AI Gateway, Ollama Cloud, OpenRouter |
| Workflow automation | Trigger.dev |
| Secrets | 1Password |
| Integrations | Composio.dev |
| AI memory | Supermemory.ai |
| Authentication | Cloudflare Access, Supabase Auth, Better Auth |

## Research baseline

Use current primary-source docs and changelogs when changing scaffold defaults or integration tasks:

- Better-T-Stack docs: `https://www.better-t-stack.dev/docs`
- Cloudflare AI, Workers, and Access changelogs: `https://developers.cloudflare.com/changelog/product-group/ai/`, `https://developers.cloudflare.com/workers/platform/changelog/`, `https://developers.cloudflare.com/changelog/product/access/`
- Vercel changelog: `https://vercel.com/changelog`
- Coolify changelog and releases: `https://coolify.io/changelog/`, `https://github.com/coollabsio/coolify/releases`
- Supabase changelog: `https://supabase.com/changelog`
- Convex changelog: `https://ship.convex.dev/changelog`
- PostgreSQL releases: `https://www.postgresql.org/docs/release/`
- Stripe changelog: `https://stripe.com/changelog`
- Linear changelog: `https://linear.app/changelog`
- GitHub changelog: `https://github.blog/changelog/`
- Google Docs API release notes: `https://developers.google.com/workspace/docs/release-notes`
- Better Auth changelog: `https://better-auth.com/changelog`
- Codex changelog: `https://help.openai.com/en/articles/11428266-codex-changelog/`
- 1Password developer releases: `https://releases.1password.com/developers/`
- Composio changelog: `https://docs.composio.dev/docs/changelog/2026/02/01`
- Supermemory developer changelog: `https://supermemory.ai/docs/changelog/developer-platform`
- OpenRouter changelog: `https://openrouter.ai/docs/changelog`
- Trigger.dev changelog: `https://trigger.dev/changelog/`

Recent planning implications from the current primary sources, last refreshed 2026-06-04:

- Cloudflare planning should treat AI Gateway's current REST API, Agents SDK skills/messengers/scheduled tasks/Workflows, and usage budget alerts as architecture and delivery inputs. The current Open Design daemon remains Express/SQLite, so Cloudflare Pages static hosting needs a separate daemon origin or a future Workers-compatible refactor.
- Supabase planning should account for passkeys beta, RLS/access-policy review, and self-hosted Postgres 15 to 17 migration risk before choosing Supabase Auth or self-hosted Supabase/Postgres.
- Trigger.dev should be treated as the long-running workflow lane because v4 adds Run Engine 2, waitpoints, prioritized runs, queue management, lifecycle hooks, OTEL exports, task TTL defaults, MCP tooling, Supabase/Vercel integration support, and bidirectional input streams.
- Composio planning must store session, toolkit, connected-account, webhook, and MCP API-key assumptions because current releases emphasize session updates, connected account arrays, link-session/OAuth changes, typed toolkit responses, polling interval changes, and MCP API-key enforcement.
- Stripe stays a post-scaffold integration with explicit API-version and webhook-idempotency review because Checkout/Billing shapes change across dated API versions and Better-T-Stack does not provide the Stripe-native payment flag in this plan.

## Current architecture

The shared contract lives in `packages/contracts/src/api/plans.ts`.

The daemon persists plans in SQLite through the `plans` table. It stores JSON for intent, selected tools, stack, database design, planning agent lanes, pointed ideation questions, workspace sections, section answers, provider capability snapshots, runtime plan, execution actions, scaffold, repo, and delivery so the plan remains inspectable and can be regenerated when stack fields change.

The daemon route layer owns:

- `GET /api/planning/tools`
- `GET /api/planning/capabilities`
- `GET /api/plans`
- `POST /api/plans`
- `GET /api/plans/:id`
- `GET /api/plans/:id/ideation`
- `POST /api/plans/:id/ideation`
- `POST /api/plans/:id/actions`
- `PATCH /api/plans/:id`
- `DELETE /api/plans/:id`

The CLI mirrors the same HTTP surface:

- `od plan tools --json`
- `od plan capabilities --json`
- `od plan list --json`
- `od plan info <id> --json`
- `od plan create --name <name> --intent-json <path|-> [--stack-json <path|->]`
- `od plan update <id> ...`
- `od plan scaffold <id>`
- `od plan sections <id>`
- `od plan section <id> --section <name> --answers-json <path|->`
- `od plan actions <id>`
- `od plan action <id> --action <repo-create|scaffold|deploy-runtime|provider-research> --confirmed`
- `od plan ideas <id>`
- `od plan brainstorm <id> --prompt <text>`
- `od plan delete <id>`

## Scaffold rules

Better-T-Stack is the default scaffold engine for eligible web apps. The stored scaffold command must be generated from the accepted stack contract and should not embed secrets.

Current defaults:

- package manager: `pnpm`
- frontend: Next.js
- backend: Hono, unless Convex is selected
- runtime: Cloudflare Workers
- database: Supabase mapped to Postgres, Cloudflare D1 mapped to SQLite, Convex mapped to no SQL database flag
- ORM: Drizzle unless Convex is selected
- API: tRPC unless Convex is selected
- auth: Better Auth when selected, otherwise no Better-T-Stack auth flag
- addons: Turborepo, MCP, skills, Ultracite, and Fumadocs for Next.js

Requirements outside Better-T-Stack's native command flags stay as post-scaffold tasks. Stripe, 1Password secret handoff, Cloudflare AI Gateway routing, Ollama Cloud/OpenRouter providers, Trigger.dev, Composio, Supermemory, Linear/GitHub Issues/Google Docs artifacts, and Coolify/Hostinger deployment wiring are tracked this way.

## Planning model

Plans should support both logical sequencing and parallel work:

- Sequential lanes: product brief first, architecture after product, delivery after architecture/database/workflows/integrations.
- Parallel lanes: database design, workflow automation, and integrations can start once the product brief is clear.
- Database design belongs in the plan before scaffold execution. It captures primary store, data mode, core entities, relationships, access patterns, migrations, and risk notes.
- Ideation should ask pointed questions, not just generate ideas. Questions must cover required user workflows, data source of truth, long-running workflows, Cloudflare feature fit, integration account ownership, and secret ownership.
- Provider capability awareness must be tied to current source URLs and refreshed when changing defaults or generating execution tasks.
- Runtime planning is explicit. The default deployable path for the current Open Design product is a daemon-backed Node service, with Coolify recommended when self-hosting or Hostinger/VPS is selected. Cloudflare Pages is treated as static UI only unless `NEXT_PUBLIC_OD_API_BASE_URL` points to a live daemon.
- Execution actions are generated from the plan but gated. Repo creation, Better-T-Stack scaffold execution, and runtime deployment require explicit confirmation and must expose preconditions, command text where applicable, and expected effects.

### Workspace section boundaries

Sections are product areas with durable ownership boundaries. Agent lanes are work packages that may operate inside or across sections.

| Section | Owns | Does not own |
|---|---|---|
| Planning | Purpose, audience, MVP scope, success criteria, sequencing, open decisions | UI visual details, schema implementation, credentials, deployment execution |
| Design | User flows, screen inventory, navigation, interaction states, visual direction, accessibility expectations | Database source of truth, secret storage, provider auth scopes, deployment topology |
| Database | Entities, relationships, source of truth, access patterns, migrations, RLS/access policy, retention | UI layout, business value proposition, provider account login flows, model selection |
| Integrations | Connected accounts, OAuth/auth configs, webhook contracts, tool routing, secret source mapping | Core schema ownership, screen-level visual choices, model-provider ranking, hosting target choice |
| AI | Model routing, agent runtime, memory policy, prompt context, fallbacks, AI observability | Payment plan design, database migration order, OAuth provider setup, static screen layout |
| Workflows | Background jobs, schedules, retries, queues, approval waits, workflow observability | Visual design, tenant data model except workflow tables, source-control policy, billing product strategy |
| Delivery | GitHub repo, scaffold command, environment setup, deploy targets, preview URLs, verification evidence | Feature prioritization, visual design decisions, database entity naming except migration artifacts, model policy |

The UI should show this boundary map separately from the agent-lane list. A user should be able to tell whether a question belongs to Planning, Design, Database, Integrations, AI, Workflows, or Delivery before an agent starts work.

Section answers are editable user decisions, separate from generated section definitions. Each answer stores status, answer lines, notes, and update time. Regenerated agent lanes and scaffold follow-up tasks must consume section answers so saved decisions are not ornamental.

## Implementation phases

### Phase 1: stored planning contract

- Shared contract in `packages/contracts`.
- Daemon persistence and `/api/plans` routes.
- `od plan` CLI with JSON and prompt-file-friendly inputs.
- Focused daemon route tests.

### Phase 2: Planning UI

- Add a separate Planning section to the web shell.
- Show stored plans, project purpose, chosen stack, scaffold command, repo status, and delivery targets.
- Let users create/update a plan from the supported stack catalog.
- Keep UI mutations behind `/api/plans`; no client-side duplicate scaffold logic.

### Phase 3: AI-assisted ideation

- Add brainstorm sessions attached to a plan.
- Store brainstorm output as plan ideation sessions with a prompt, summary, suggested directions, stack deltas, tool ids, and next steps.
- Surface pointed ideation questions from the plan so the user can answer feature, database, workflow, Cloudflare, integration, and secret-ownership decisions before scaffold execution.
- Show workspace sections as a distinct boundary map separate from agent lanes.
- Let users edit and persist section answers from the UI and `od plan section`.
- Show planning agent lanes that can run sequentially or in parallel and record each lane's expected outputs.
- Give each lane a runbook and explicit `parallelWith` metadata so Database, Workflows, and Integrations can proceed simultaneously after the Product lane.
- Generate a database design draft from the current stack choice.
- Show provider capability snapshots and the recommended runtime path in the selected plan.
- Ask which tools the user wants to connect, then mark tools as `wanted`, `connected`, `deferred`, or `blocked`.
- Generate Linear issue drafts, GitHub issue drafts, and Google Docs PRD outlines from the accepted plan.

### Phase 4: scaffold and repo execution

- Validate `gh` availability and authenticated owner before creating a repo.
- Run Better-T-Stack scaffold in a clean target directory after user acceptance.
- Create the GitHub repo, push the scaffold, and write provider setup tasks back into the plan only after `repo-create` and `scaffold` actions are explicitly accepted.
- Keep secrets in 1Password and write local env files only after explicit source-of-truth lookup.

### Phase 5: deployment execution

- Cloudflare: Workers/Pages deployment path plus AI Gateway and Access notes where selected.
- Vercel: preview deployment path for Next.js projects.
- Coolify: v4 API-backed service creation and Postgres deployment path.
- Hostinger: VPS or managed-hosting handoff notes, often paired with Coolify.

## Acceptance criteria

- Every planning capability has both UI and CLI access.
- The Planning web provider can target a deployed daemon through `NEXT_PUBLIC_OD_API_BASE_URL`; without that env var, static Pages remains a UI preview and local/runtime proxy uses relative `/api`.
- `od plan scaffold <id>` prints the exact command generated by the daemon.
- `od plan capabilities` exposes dated provider capability snapshots with source URLs.
- `od plan actions` exposes repo, scaffold, runtime, and provider-research actions; confirmation is required before accepting gated actions.
- Role-specific tool ids prevent provider ambiguity across hosting, database, and auth.
- Workspace sections stay distinct from agent lanes and explicitly document what each section owns and does not own.
- Section answers persist across reloads and influence agent lane briefs plus scaffold follow-up tasks.
- Agent lanes include runbooks and parallel execution metadata.
- Runtime plan calls out the daemon-backed deployment path and the Cloudflare Pages static limitation.
- Plan mutations regenerate scaffold output deterministically.
- A user can move from purpose to selected tools to scaffold command to GitHub/deploy next steps without losing the stored project context.
