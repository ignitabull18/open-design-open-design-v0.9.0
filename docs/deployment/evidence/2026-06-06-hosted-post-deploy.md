# Hosted Post-Deploy Evidence - 2026-06-06

Generated at: `2026-06-06T22:04:59.881Z`

Ops status:

- Source: `runtime-file`
- Checks: `monitor`, `backup`, `weekly-restore-drill`, `r2-offhost-backup`, `alerting`, `api-rate-limit`
- Rate limit enabled: `true`
- Backup offsite target: `r2://backups-postgres-box1/open-design/prod/backups/open-design-20260606T213018Z.tgz`
- CLI source: `runtime-file`
- CLI checks: `monitor`, `backup`, `weekly-restore-drill`, `r2-offhost-backup`, `alerting`, `api-rate-limit`

Provider readiness:

- Plan: `plan-04a3d239-e5b0-4424-906d-62010979c7dd`
- Checked: `github`, `cloudflare-hosting`, `supermemory`
- Connected: `cloudflare-hosting`, `supermemory`
- Deferred: `github`

Provider connection probes:

- `supermemory`: `connected` - Supermemory API token reached the read-only documents list endpoint.
- `composio`: `connected` - Composio API token reached the connected accounts endpoint.
- `trigger-dev`: `connected` - Trigger.dev token reached the projects endpoint.
