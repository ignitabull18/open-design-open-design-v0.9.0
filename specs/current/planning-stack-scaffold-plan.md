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

Recent planning implications from the current primary sources:

- Trigger.dev should be treated as the long-running workflow lane because v4 adds AI coding assistant skills, Vercel integration, Supabase env var sync, task TTL defaults, MCP tooling, metrics/query dashboards, and bidirectional input streams.
- Composio planning must store session and connected-account assumptions because current releases emphasize `composio.use()` session reuse, session updates, connected account arrays, webhook subscriptions, V3 payloads, and MCP API-key enforcement.
- Cloudflare and Supabase capability choices should stay source-backed and refreshable because Workers/AI Gateway/Access/D1/R2/Queues/Workflows and Supabase platform defaults change quickly enough to affect architecture decisions.

## Current architecture

The shared contract lives in `packages/contracts/src/api/plans.ts`.

The daemon persists plans in SQLite through the `plans` table. It stores JSON for intent, selected tools, stack, database design, planning agent lanes, pointed ideation questions, workspace sections, scaffold, repo, and delivery so the plan remains inspectable and can be regenerated when stack fields change.

The daemon route layer owns:

- `GET /api/planning/tools`
- `GET /api/plans`
- `POST /api/plans`
- `GET /api/plans/:id`
- `GET /api/plans/:id/ideation`
- `POST /api/plans/:id/ideation`
- `PATCH /api/plans/:id`
- `DELETE /api/plans/:id`

The CLI mirrors the same HTTP surface:

- `od plan tools --json`
- `od plan list --json`
- `od plan info <id> --json`
- `od plan create --name <name> --intent-json <path|-> [--stack-json <path|->]`
- `od plan update <id> ...`
- `od plan scaffold <id>`
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
- Show planning agent lanes that can run sequentially or in parallel and record each lane's expected outputs.
- Generate a database design draft from the current stack choice.
- Ask which tools the user wants to connect, then mark tools as `wanted`, `connected`, `deferred`, or `blocked`.
- Generate Linear issue drafts, GitHub issue drafts, and Google Docs PRD outlines from the accepted plan.

### Phase 4: scaffold and repo execution

- Validate `gh` availability and authenticated owner before creating a repo.
- Run Better-T-Stack scaffold in a clean target directory after user acceptance.
- Create the GitHub repo, push the scaffold, and write provider setup tasks back into the plan.
- Keep secrets in 1Password and write local env files only after explicit source-of-truth lookup.

### Phase 5: deployment execution

- Cloudflare: Workers/Pages deployment path plus AI Gateway and Access notes where selected.
- Vercel: preview deployment path for Next.js projects.
- Coolify: v4 API-backed service creation and Postgres deployment path.
- Hostinger: VPS or managed-hosting handoff notes, often paired with Coolify.

## Acceptance criteria

- Every planning capability has both UI and CLI access.
- `od plan scaffold <id>` prints the exact command generated by the daemon.
- Role-specific tool ids prevent provider ambiguity across hosting, database, and auth.
- Workspace sections stay distinct from agent lanes and explicitly document what each section owns and does not own.
- Plan mutations regenerate scaffold output deterministically.
- A user can move from purpose to selected tools to scaffold command to GitHub/deploy next steps without losing the stored project context.
