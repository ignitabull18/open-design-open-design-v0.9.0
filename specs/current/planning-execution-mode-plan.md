# Planning Execution Mode Plan

**Status:** in progress
**Owner surface:** daemon `/api/plans`, `od plan ...`, and the Planning UI
**Builds on:** `specs/current/planning-stack-scaffold-plan.md`

## Goal

Turn stored project plans into executable project workspaces. The planner should move from accepted decisions to scaffolded files, GitHub repository creation, provider setup tasks, project-management artifacts, database implementation drafts, and deployment proof without losing the stored planning context.

## Completion scope

Execution mode is complete only when these surfaces are implemented with UI and CLI parity:

1. **Better-T-Stack scaffold execution**
   - Validate that the target directory is empty or explicitly disposable.
   - Run the stored scaffold command after explicit confirmation.
   - Persist command, target directory, exit code, stdout/stderr excerpts, produced path, and timestamps.
   - Mark the scaffold action `completed` only after the command succeeds.

2. **GitHub repository creation**
   - Validate `gh` availability and authenticated owner before repo creation.
   - Reject placeholder owners such as `<github-owner-or-org>`.
   - Create the repository, add/update the scaffold directory remote, push the scaffold, and persist repo URL/status.
   - Keep repo creation gated behind explicit confirmation.

3. **Project-management artifact generation**
   - Generate issue drafts from the accepted plan for Linear and GitHub Issues.
   - Generate a Google Docs PRD outline from purpose, success criteria, section answers, database design, agent lanes, and execution tasks.
   - Persist drafts before creating external records.
   - Require confirmation before writing to Linear, GitHub Issues, or Google Docs.

4. **Provider connection checks**
   - Add check actions for 1Password, Composio, Supermemory, Stripe, Supabase, Cloudflare, Trigger.dev, GitHub, Linear, Vercel, Coolify, Hostinger, OpenRouter, Ollama Cloud, Cloudflare AI Gateway, Better Auth, Cloudflare Access, and Supabase Auth.
   - Persist each tool as `wanted`, `connected`, `deferred`, or `blocked` with evidence and last-checked time.
   - Never expose secrets in UI, CLI output, stored logs, or test fixtures.

5. **Database implementation output**
   - Generate SQL or Drizzle schema drafts from the database section.
   - Generate RLS/access-policy notes for Supabase/Postgres and migration tasks for D1/Convex/Postgres variants.
   - Persist drafts as plan artifacts before writing scaffold files.
   - Require confirmation before modifying scaffold files.

6. **Deployment execution**
   - Support Coolify service creation/update, Vercel preview deploys, Cloudflare deploy notes or Workers/Pages commands, and Hostinger/Coolify handoff.
   - Persist deployment target status, command/provisioning evidence, live URL, and verification checks.
   - Mark delivery actions completed only after health/reload proof is recorded.

7. **Real section agents**
   - Let each section lane create an execution run with status, started/completed timestamps, outputs, and artifacts.
   - Execute through the configured section-agent runner when available, marking the run `external` and appending runner output to the section artifact.
   - Preserve lane dependencies: Product first; Database, Workflows, and Integrations can run in parallel after Product; Delivery waits for Architecture, Database, Workflows, and Integrations.
   - Keep section results attached to the plan and visible in the section workflow panel.

## Data model additions

Add these durable fields to the plan contract and SQLite JSON payload:

- `executionRuns`: records one accepted action or section-agent run.
- `executionArtifacts`: stores generated issue drafts, PRD outlines, schema drafts, scaffold logs, deployment evidence, and provider-check evidence.
- `toolChecks`: stores provider connection-check status and redacted evidence.
- `scaffoldExecution`: stores target directory and scaffold command result.

All execution records must be append-only enough for auditability. Later updates may mark a run completed or failed, but should not erase prior command/evidence text.

## API surface

Add endpoints beside the existing `/api/plans` routes:

- `GET /api/plans/:id/execution`
- `POST /api/plans/:id/actions/:actionId/execute`
- `POST /api/plans/:id/sections/:sectionId/runs`
- `POST /api/plans/:id/sections/runs`
- `POST /api/plans/:id/tools/:toolId/check`
- `POST /api/plans/:id/artifacts`

Execution endpoints must return structured status, redacted logs, and the updated plan.

Section-agent runs use deterministic record-only drafts when no runner is configured. Operators can set `OD_PLAN_SECTION_AGENT_COMMAND` plus optional `OD_PLAN_SECTION_AGENT_ARGS_JSON` to run an external specialist command. The daemon writes `{ prompt, manifest }` to stdin as JSON, sets `OD_PLAN_ID`, `OD_PLAN_SECTION_ID`, and `OD_PLAN_SECTION_LABEL`, and accepts either plain stdout or JSON stdout shaped like `{ "status": "completed|blocked|failed", "summary": "...", "output": "...", "evidence": ["..."] }`.

## CLI surface

Add CLI parity:

- `od plan execution <id> [--json]`
- `od plan execute <id> --action <name> --confirmed [--target-dir <path>] [--json]`
- `od plan run-section <id> --section <name> [--json]`
- `od plan check-tool <id> --tool <tool-id> [--json]`
- `od plan artifacts <id> [--json]`

CLI output must support `--json`; long prompts or generated text must support `--prompt-file <path|->` when user-provided content is needed.

## UI surface

The Planning UI should add an Execution panel with:

- action run history,
- scaffold target directory and result,
- repo status and URL,
- provider connection evidence,
- generated issues/PRD/schema drafts,
- deployment target proof,
- section-agent run status.

Existing action buttons should call execute endpoints, not just mark actions accepted.

## Phase order

### Phase A: execution records and artifact drafts

Implement storage/contract/API/CLI/UI for execution runs and artifacts. Existing actions can create dry-run artifacts even before external writes.

### Phase B: scaffold and GitHub execution

Run Better-T-Stack in a confirmed clean directory, then create/push GitHub repo once `gh` and owner validation pass.

### Phase C: provider checks and project-management drafts

Add provider checkers and issue/PRD draft generation. External writes remain gated.

### Phase D: database implementation drafts

Generate SQL/Drizzle/RLS/migration drafts from database design and section answers. Writing into scaffold files remains gated.

### Phase E: deployment execution

Add Coolify/Vercel/Cloudflare/Hostinger execution paths with verification evidence.

### Phase F: section-agent runs

Attach real run records to section lanes, with dependency validation and parallelizable lane scheduling. The current implementation supports injected or env-backed specialist runners, opt-in native Open Design agent runs through `OD_PLAN_SECTION_AGENT_RUNTIME=native`, durable running records while external/native specialists are in flight, stored runner output/evidence, and multi-section requests in parallel unless the request mode is `sequential`; remaining work is to stream native agent SSE progress directly into the Planning UI.

## Acceptance criteria

- Each remaining gap has an API, CLI, UI, storage, and test path.
- Existing `od plan action` remains available for accepting a gated action, while `od plan execute` performs the action.
- No execution endpoint performs external writes without `confirmed: true`.
- Secrets are redacted from stored evidence and command output.
- Scaffold and repo execution write proof back to the same persisted plan.
- Hosted planner can show execution history after reload.
