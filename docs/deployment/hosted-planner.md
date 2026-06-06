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

Production backups must also leave the host. The `core1` production timer writes
local archives under `/root/open-design-backups`, verifies the accepted archive
from the off-host copy, and records the latest restore drill manifest at:

```bash
/root/open-design-backups/latest-restore-drill.json
```

The current hosted planner off-host ladder is:

- Daily backup timer: `open-design-planner-backup.timer` at `03:17 UTC`.
- Weekly independent restore drill: `open-design-planner-restore-drill.timer` at
  `04:17 UTC` on Sundays.
- Primary off-host copy:
  `r2://backups-postgres-box1/open-design/prod/backups/`.
- Upload/download path: Cloudflare Worker
  `open-design-backup-ingest` at
  `https://open-design-backup-ingest.lingering-rain-68b6.workers.dev`, backed by
  R2 binding `BACKUP_BUCKET`.
- Secondary fallback copy:
  `ssh://heavy1/root/open-design-offsite-backups/open-design/`.

`core1` does not store broad Wrangler OAuth or R2 S3 credentials. It stores only
the Worker upload token in `/root/open-design-ops.env`; the Worker enforces that
token and restricts keys to `open-design/prod/backups/open-design-*.tgz`.
`/root/open-design-backups/latest-r2-copy.json` must be produced by the backup
timer itself before the restore drill is accepted as R2-backed.

The manifest is intentionally small: backup filename, offsite target, restore
check, and timestamp. Verify it from an operator shell after backup changes:

```bash
OD_BACKUP_DRILL_MANIFEST=/root/open-design-backups/latest-restore-drill.json \
node --experimental-strip-types deploy/scripts/check-hosted-backup-drill.ts
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

Set `OD_ALERT_WEBHOOK_URL` on scheduled monitor runs to send failures to the
production alert destination. The webhook receives a JSON payload with
`service`, `ok`, `baseUrl`, `message`, and `checkedAt`. If the destination needs
a bearer token, set `OD_ALERT_WEBHOOK_TOKEN`; set `OD_ALERT_ON_SUCCESS=1` only
for one-off delivery tests.

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
backup readiness. It also runs provider connection probes for configured
provider credentials:

```bash
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
OD_PLAN_ID=<production-plan-id> \
node --experimental-strip-types deploy/scripts/run-hosted-post-deploy.ts
```

For Docker/Compose style updates, `deploy/scripts/update.sh` can run this gate
automatically after the local health check:

```bash
OPEN_DESIGN_RUN_POST_DEPLOY_CHECK=1 \
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
OD_PLAN_ID=<production-plan-id> \
deploy/scripts/update.sh --non-interactive
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

On `core1`, the hosted operations helper combines the app container logs with
the monitor and backup unit journals:

```bash
/usr/local/sbin/open-design-planner-logs.sh
TAIL=500 /usr/local/sbin/open-design-planner-logs.sh
```

The daemon also exposes live hosted operations state through the protected
`/api/ops/status` endpoint. The Planning UI reads this endpoint after hosted
session authentication, and the CLI mirror is:

```bash
OD_API_TOKEN="$OD_API_TOKEN" \
od ops status --daemon-url https://open-design.ignitabull.org --json
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

Provider readiness is plan metadata. Run provider connection probes when a
credential is meant to be live:

```bash
SUPERMEMORY_API_KEY="$SUPERMEMORY_API_KEY" \
COMPOSIO_API_KEY="$COMPOSIO_API_KEY" \
node --experimental-strip-types deploy/scripts/check-hosted-provider-connections.ts
```

By default this checks Supermemory, Composio, Trigger.dev, and Cloudflare AI
Gateway. For the current hosted planner release, AI Gateway is deliberately
dropped from the required provider set because the hosted daemon does not route
model calls through AI Gateway yet. Narrow the set with
`OD_PROVIDER_CONNECTION_IDS=supermemory,composio,trigger-dev`.

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
- Browser acceptance artifact: attach `/tmp/open-design-planning-acceptance.png`
  or a refreshed screenshot to release notes/PRs when UI or hosted route
  behavior changes.
- Hardening: protected APIs return `401` without auth, monitor alerts have a
  delivery target, backups leave the host, restore drill manifest is current,
  and public-origin changes include a rate-limit/auth review.

## Current provider order

Use this order for the next provider work:

1. Composio is installed in Coolify as `COMPOSIO_API_KEY` from the 1Password
   `Composio API - Prod` item. Verify it with the read-only connected accounts
   probe after each deploy.
2. Trigger.dev is installed in Coolify as `TRIGGER_ACCESS_TOKEN` from the cloud
   profile; verify it with the read-only projects probe after each deploy.
3. 1Password, because it remains the source of truth for provider credentials.
4. Cloudflare AI Gateway is explicitly not required for this hosted planner
   release. Add it back only when model traffic actually routes through a named
   gateway and a scoped `CF_AIG_TOKEN` or `CLOUDFLARE_API_TOKEN` is installed.
5. Additional Supermemory workflows, only after the connection probe remains
   green in the post-deploy gate.

Do not mark a provider as ready just because it is selected in a plan. The
production plan must record each selected provider as `connected` or `deferred`
with notes, and `deploy/scripts/check-hosted-provider-readiness.ts` must pass.
