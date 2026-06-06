# Open Design Hosted Ops Evidence - 2026-06-06

Target: `https://open-design.ignitabull.org`

Deploy:

- Coolify app: `jrdtaush3izl7bz10f9gg9qo`
- Deployment id: `inxtn55gr6o2rgkt7plfui3b`
- Commit: `c348f036ff31f5ced9cec5fc89de6ed9a0cfbcb2`
- Status: `finished`

Live checks:

- `/api/health`: `ok`, version `0.9.0`
- Unauthenticated `/api/ops/status`: `401`
- Authenticated `/api/ops/status`: `source=runtime-file`
- `od ops status --daemon-url https://open-design.ignitabull.org --json`: returned `runtime-file`
- Hosted smoke: `plan-c4fdcc68-8774-4d01-bb8e-13adfe66fcd0`, `plan-run-750786f5-7a5d-414a-a1f1-5784bb856a88`, `eventCount=4`, `sseEventCount=4`

Hosted operations:

- Monitor: `ok`
- Backup restore: `ok`
- Weekly restore drill timer: `ok`
- Alerting: `ok`
- API rate limit: `ok`, `240` requests per `60000ms`
- R2 Worker: `open-design-backup-ingest`, version `05d721e4-24c2-4262-bec0-17a37a6893d3`
- R2 verified timer copy: `r2://backups-postgres-box1/open-design/prod/backups/open-design-20260606T213018Z.tgz`
- Restore manifest: `restoreCheck=sqlite-header-ok`, `checkedAt=2026-06-06T21:30:24Z`
- Secondary fallback still retained: `ssh://heavy1/root/open-design-offsite-backups/open-design/`

Provider proof:

- Trigger.dev: connected; read-only projects endpoint accepted the cloud profile token.
- Provider readiness plan: `plan-04a3d239-e5b0-4424-906d-62010979c7dd`
- Required provider readiness for this hosted release: `github`, `cloudflare-hosting`, `supermemory`
- Connected: `cloudflare-hosting`, `supermemory`
- Deferred: `github`
- Cloudflare AI Gateway: explicitly dropped from required release set because hosted planner traffic is not routed through AI Gateway.
- Composio: connected. `COMPOSIO_API_KEY` is installed in Coolify from the 1Password `Composio API - Prod` item; the read-only connected accounts probe returned `200`.

Browser proof:

- Screenshot: `/tmp/open-design-hosted-ops-runtime-file.png`
- SHA-256: `37bb9f72bc3b3b77b9f357125aa4d4fa7f65a005fefb7d83a86554fcf517c6af`
