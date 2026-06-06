# Hosted planner runbook

This runbook is the production checklist for `https://open-design.ignitabull.org`.
It assumes the current single-tenant daemon-backed deployment: Cloudflare fronts a
Node daemon that serves both the static web bundle and `/api/*`.

## Required environment

Set these in the deployment secret/config surface:

```bash
OPEN_DESIGN_IMAGE=ghcr.io/nexu-io/od:latest
OPEN_DESIGN_ALLOWED_ORIGINS=https://open-design.ignitabull.org
OD_BIND_HOST=0.0.0.0
OD_API_TOKEN=<secret>
OD_DATA_DIR=/app/.od
OD_PLAN_SECTION_AGENT_RUNTIME=native
```

`OD_PLAN_SECTION_AGENT_RUNTIME=native` is optional only when the hosted daemon is
expected to use record-only section drafts. If native section agents are required,
the container or host layer must also provide the selected agent CLI and its
authenticated home/config.

## Cloudflare routing

The public route must terminate TLS at Cloudflare and proxy to the daemon origin.
Keep the daemon origin itself private: Docker Compose binds to `127.0.0.1`, and a
Cloudflare Tunnel or reverse proxy forwards only `https://open-design.ignitabull.org`.

Expected probe results:

```bash
curl -fsS https://open-design.ignitabull.org/api/health
curl -fsS https://open-design.ignitabull.org/api/planning/session
curl -i https://open-design.ignitabull.org/api/plans
```

The first command returns `{ "ok": true, "version": "..." }`, the second returns
`authenticated: false` before login, and the third returns `401 API_TOKEN_REQUIRED`
without a token.

## Backup and restore

Back up the Coolify persistent storage mounted at `/app/.od` before image
upgrades, token rotations that also touch config, or schema migrations. First
verify the Coolify app still has the expected persistent storage:

```bash
node --experimental-strip-types deploy/scripts/check-coolify-backup-readiness.ts
```

The command prints the current storage UUID/name, mount path, and host-side
backup/restore commands. On the Ignitabull production app this should report the
Coolify application `jrdtaush3izl7bz10f9gg9qo` and mount path `/app/.od`.

Run the printed backup command on the Docker host or through the Coolify terminal.
The command has this shape:

```bash
docker run --rm \
  -v <coolify-storage-name>:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine sh -c 'cd /data && tar czf "/backup/open-design-$(date +%Y%m%d-%H%M%S).tgz" .'
```

Restore only while the service is stopped, then run the hosted smoke before
calling the restore accepted:

```bash
coolify app stop jrdtaush3izl7bz10f9gg9qo
docker run --rm \
  -v <coolify-storage-name>:/data \
  -v "$PWD/backups:/backup:ro" \
  alpine sh -c 'rm -rf /data/* && tar xzf /backup/<backup-file>.tgz -C /data'
coolify app start jrdtaush3izl7bz10f9gg9qo
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
node --experimental-strip-types deploy/scripts/smoke-hosted-planner.ts
```

## Hosted monitor and smoke

Run the lightweight monitor on a schedule and after Cloudflare/Coolify route
changes:

```bash
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
node --experimental-strip-types deploy/scripts/monitor-hosted-planner.ts
```

It verifies:

- `/api/health` and `/api/daemon/status` are open and daemon-backed.
- `/api/daemon/status` reports `bindHost=0.0.0.0` and `dataDir=/app/.od`.
- `/api/plans` returns `401 API_TOKEN_REQUIRED` without a token.
- When `OD_API_TOKEN` is present, authenticated `/api/plans` and the hosted
  planning session cookie both work.

Run the smoke after deploy, after token rotation, and after changing Cloudflare
routes. It creates one persisted plan and one section-agent run.

```bash
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
node --experimental-strip-types deploy/scripts/smoke-hosted-planner.ts
```

Required success shape:

```json
{
  "ok": true,
  "baseUrl": "https://open-design.ignitabull.org",
  "planId": "plan-...",
  "runId": "plan-run-...",
  "version": "0.9.0",
  "eventCount": 1
}
```

Any failure is a release blocker unless it is a deliberate token mismatch check.

The single post-deploy gate runs monitor, smoke, provider readiness, and Coolify
backup readiness:

```bash
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
OD_PLAN_ID=<production-plan-id> \
node --experimental-strip-types deploy/scripts/run-hosted-post-deploy.ts
```

## Production logs

Use Coolify as the first log source for the hosted daemon. The app UUID for
`open-design.ignitabull.org` is `jrdtaush3izl7bz10f9gg9qo`.

```bash
coolify app logs jrdtaush3izl7bz10f9gg9qo --lines 200
coolify app logs jrdtaush3izl7bz10f9gg9qo --follow
```

When diagnosing a routing issue, compare those daemon logs with the Cloudflare
Tunnel logs on the host that runs `cloudflared`. The production CNAME points at
the tunnel target `80432e44-51c1-45bc-b6d8-098c423606de.cfargotunnel.com`; a
healthy request should appear in the daemon logs and should not show tunnel
origin connection errors.

```bash
journalctl -u cloudflared --since "30 minutes ago" --no-pager
journalctl -u cloudflared -f
```

If Coolify CLI access is unavailable, use the Coolify app terminal/logs screen
for the same application UUID and keep any copied output free of
`OD_API_TOKEN`, provider API keys, and session cookies.

## Provider readiness

Track provider credentials separately from the daemon token. A hosted planner can
load and persist plans without every provider connected, but action execution must
record each provider as connected or explicitly deferred.

Run the read-only provider readiness check against the production plan:

```bash
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
OD_PLAN_ID=<production-plan-id> \
node --experimental-strip-types deploy/scripts/check-hosted-provider-readiness.ts
```

Override the required provider set when a plan intentionally uses a narrower
scope:

```bash
OD_REQUIRED_TOOL_IDS=github,cloudflare-hosting,supermemory \
node --experimental-strip-types deploy/scripts/check-hosted-provider-readiness.ts
```

Minimum readiness inventory:

| Provider | Required for | Hosted status rule |
| --- | --- | --- |
| GitHub | repo creation and issue handoff | `od plan check-tool <plan> --tool github --json` returns connected or deferred with notes |
| Cloudflare | hosted route and deployment proof | `/api/health` works on `open-design.ignitabull.org`; deployment target records Cloudflare proof |
| Cloudflare AI Gateway | AI runtime planning | connected or deferred before AI delivery is marked ready |
| Trigger.dev | workflow automation planning | connected or deferred before workflow delivery is marked ready |
| Composio | integration actions | connected or deferred before integration delivery is marked ready |
| Supermemory | memory-backed planning | connected or deferred; authentication remains a production-readiness gate |
| 1Password | secret source of truth | token and provider credentials are stored outside repo and are retrievable by operator |

## Acceptance checklist

- Hosted auth bridge: Planning UI unlocks with the daemon token and then uses the
  httpOnly `od_planning_session` cookie.
- Daemon-backed deployment: `/api/health` shows Express/daemon headers and the
  current Open Design version.
- Persistence: hosted smoke creates a plan, edits section answers, updates stack
  and tools, reloads the plan, and sees the saved state.
- Data path: `/api/daemon/status` reports `/app/.od` or the configured
  `OD_DATA_DIR`; a fresh backup exists before upgrade.
- Section-agent runtime: hosted smoke records a section-agent run; native runtime
  is separately verified when native agents are installed in the host layer.
- SSE/live progress: run event replay and `text/event-stream` both work through
  `/api/plans/:id/sections/runs/:runId/events`; the Planning UI shows live
  events for active lanes.
- Provider credentials: every selected provider is connected or explicitly
  deferred with notes.
- Cloudflare routing: health/session probes are open; protected APIs return
  `401` without auth; TLS is valid on the public hostname.
- Runbook: deployment, backup, restore, token rotation, and smoke commands are
  documented in this file and `deploy/README.md`.
- Full production pass: browser login, plan creation, section run, event display,
  reload persistence, and CLI/API smoke are all green.

## Current provider order

Use this order for the next provider work:

1. Supermemory, because `SUPERMEMORY_API_KEY`/`SUPERMEMORY_CODEX_API_KEY` can be
   checked from an operator shell and memory-backed planning is user-visible.
2. Composio, because integration actions depend on connected accounts and
   webhook/session policy.
3. Trigger.dev, because long-running workflow execution is valuable only after
   integrations have real actions to run.
4. 1Password, because it is the source of truth for secrets but requires local
   `op` CLI/app authorization to verify.
5. Cloudflare AI Gateway, because model routing is separate from the hosted
   planner deployment itself.

Do not mark a provider as ready just because it is selected in a plan. The
production plan must record each selected provider as `connected` or `deferred`
with notes, and `deploy/scripts/check-hosted-provider-readiness.ts` must pass.
