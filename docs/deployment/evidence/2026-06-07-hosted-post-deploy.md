# Hosted Post-Deploy Evidence - 2026-06-07

Generated at: `2026-06-07T02:42:34.102Z`

Ops status:

- Source: `runtime-file`
- Checks: `monitor`, `backup`, `weekly-restore-drill`, `r2-offhost-backup`, `alerting`, `api-rate-limit`
- Rate limit enabled: `true`
- Backup offsite target: `r2://backups-postgres-box1/open-design/prod/backups/open-design-20260606T213018Z.tgz`
- CLI source: `runtime-file`
- CLI checks: `monitor`, `backup`, `weekly-restore-drill`, `r2-offhost-backup`, `alerting`, `api-rate-limit`

Provider readiness:

- Plan: `plan-04a3d239-e5b0-4424-906d-62010979c7dd`
- Checked: `github`, `cloudflare-hosting`, `cloudflare-ai-gateway`, `trigger-dev`, `composio`, `supermemory`, `onepassword`
- Connected: `github`, `cloudflare-hosting`, `supermemory`
- Deferred: `cloudflare-ai-gateway`, `trigger-dev`, `composio`, `onepassword`

Provider connection probes:

- `supermemory`: `connected` - Supermemory API token reached the read-only documents list endpoint.
- `composio`: `connected` - Composio API token reached the connected accounts endpoint.
