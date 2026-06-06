# Docker deployment

This deployment ships Open Design as a single Alpine-based runtime image. The
daemon serves both the API and the built Next.js static export, so there is no
separate nginx container.

For the Ignitabull production checklist, including Cloudflare routing,
provider readiness, backups, and hosted smoke verification, see
[`docs/deployment/hosted-planner.md`](../docs/deployment/hosted-planner.md).

## Local compose

Before starting:

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Generate a secure token:

   ```bash
   openssl rand -hex 32
   ```

3. Open `.env` in your editor, find `OD_API_TOKEN=`, and paste the generated token there.

Then pull and start the service:

```bash
OPEN_DESIGN_IMAGE=ghcr.io/nexu-io/od:latest docker compose pull
OPEN_DESIGN_IMAGE=ghcr.io/nexu-io/od:latest docker compose up -d --no-build
```

Defaults:

- Host port: `127.0.0.1:7456` (`OPEN_DESIGN_PORT=8080` to publish on `127.0.0.1:8080`)
- Runtime data volume: `open_design_data` mounted at `/app/.od`
- Node heap cap: `--max-old-space-size=192`
- Compose memory cap: `384m` (`OPEN_DESIGN_MEM_LIMIT=256m` to override)

Do not publish the daemon directly on a public or shared LAN interface. The daemon
refuses public binds without `OD_API_TOKEN`, and non-loopback `/api/*` callers must
authenticate with either `Authorization: Bearer <OD_API_TOKEN>` or the hosted
planner's httpOnly `od_planning_session` cookie. Keep Compose bound to localhost
and put Cloudflare Tunnel, an authenticated reverse proxy, SSH tunnel, or VPN in
front of it.

When exposing the service through an authenticated public IP, domain, or reverse
proxy, set `OPEN_DESIGN_ALLOWED_ORIGINS` to the browser origins that should be
allowed to call `/api`:

```bash
OPEN_DESIGN_ALLOWED_ORIGINS=https://od.example.com,http://203.0.113.10:7456 docker compose up -d --no-build
```

For the Ignitabull hosted planner, the expected public origin is:

```bash
OPEN_DESIGN_ALLOWED_ORIGINS=https://open-design.ignitabull.org
OD_API_TOKEN=<stored in the deployment secret manager>
```

Pin a specific published image with a digest instead of the mutable `latest` tag:

```bash
OPEN_DESIGN_IMAGE=ghcr.io/nexu-io/od@sha256:<digest> docker compose up -d --no-build
```
The image intentionally does not bundle Claude/Codex/Gemini CLI binaries. Keep
those outside the image, or build a separate private runtime layer if a server
deployment needs local code-agent CLIs installed in the container.

## Hosted smoke

After every deployment or token rotation, run the hosted monitor and smoke from a
trusted operator shell. These scripts print health, plan, and run identifiers
only; they never print the token.

```bash
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
node --experimental-strip-types deploy/scripts/monitor-hosted-planner.ts
```

```bash
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
node --experimental-strip-types deploy/scripts/smoke-hosted-planner.ts
```

The smoke verifies:

- `/api/health` is open and daemon-backed.
- `/api/plans` is protected without a token.
- `/api/planning/session` sets the httpOnly planning cookie.
- plan creation, section answer edits, stack/tool updates, section-agent runs,
  event replay, SSE streaming, and reload persistence all work against the
  hosted daemon.

Provider readiness is checked separately because it should inspect the production
plan's chosen integrations without creating new provider side effects:

```bash
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
OD_PLAN_ID=<production-plan-id> \
node --experimental-strip-types deploy/scripts/check-hosted-provider-readiness.ts
```

The post-deploy wrapper runs monitor, smoke, provider readiness, and Coolify
backup readiness in one command. It also probes live provider credentials when
their env vars are present.

```bash
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
OD_PLAN_ID=<production-plan-id> \
node --experimental-strip-types deploy/scripts/run-hosted-post-deploy.ts
```

To make a Docker/Compose update fail closed when the hosted gate is missing or
red, run:

```bash
OPEN_DESIGN_RUN_POST_DEPLOY_CHECK=1 \
OD_HOSTED_BASE_URL=https://open-design.ignitabull.org \
OD_API_TOKEN="$OD_API_TOKEN" \
OD_PLAN_ID=<production-plan-id> \
deploy/scripts/update.sh --non-interactive
```

## Data, backup, and restore

Runtime state lives in the `open_design_data` Docker volume, mounted at
`/app/.od` inside the container. That volume contains SQLite (`app.sqlite*`),
project files, artifacts, installed plugins, and media/provider config.

For Coolify production, verify the actual persistent storage mount before taking
or restoring a backup:

```bash
node --experimental-strip-types deploy/scripts/check-coolify-backup-readiness.ts
```

The command prints the current Coolify storage name and host-side backup/restore
commands. Use those generated commands for `open-design.ignitabull.org`; the
local Compose `open_design_data` examples below are only for the local compose
layout.

Production backups should be copied off-host after the local archive is created.
For the Ignitabull host, the backup job records the latest restore proof in
`/root/open-design-backups/latest-restore-drill.json`. Verify the manifest with:

```bash
OD_BACKUP_DRILL_MANIFEST=/root/open-design-backups/latest-restore-drill.json \
node --experimental-strip-types deploy/scripts/check-hosted-backup-drill.ts
```

Back up before image upgrades and before opening the same data with an older
checkout:

```bash
docker run --rm \
  -v open_design_data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine sh -c 'cd /data && tar czf "/backup/open-design-$(date +%Y%m%d-%H%M%S).tgz" .'
```

Restore into a stopped service:

```bash
docker compose down
docker run --rm \
  -v open_design_data:/data \
  -v "$PWD/backups:/backup:ro" \
  alpine sh -c 'rm -rf /data/* && tar xzf /backup/<backup-file>.tgz -C /data'
docker compose up -d --no-build
```

## Publish images

```bash
deploy/scripts/publish-images.sh --image_tag latest
```

Useful overrides:

```bash
IMAGE_NAMESPACE=your-dockerhub-user deploy/scripts/publish-images.sh --arch arm64
deploy/scripts/publish-images.sh --image ghcr.io/your-org/od:0.1.0
```

The script defaults to:

- `ghcr.io/nexu-io/od:<tag>`
- `linux/amd64,linux/arm64`
- `skopeo` push strategy with Docker credentials read from `~/.docker/config.json`
- preloading base images through `skopeo` to reduce registry pull flakiness

If `127.0.0.1:7890` is available and no proxy is already set, the script uses it
for registry access and passes `host.docker.internal:7890` into Docker builds. The
host-gateway alias is only added for builds that need this local proxy mapping.

### Colima swap helper for Apple Silicon

`deploy/scripts/prepare-colima-build-swap.sh` is for manual Docker image
publishing from an Apple Silicon macOS host that uses Colima as the Docker VM.
The helper is intentionally Apple Silicon-only because the failure mode it covers
is local arm64 Colima builds exhausting a small Linux VM while preparing
multi-arch images. It exits before touching Colima on non-macOS or
non-Apple-Silicon hosts.

Low-memory Colima VMs can run out of RAM during multi-arch image builds. The
helper checks the VM memory and swap status, then creates and enables a temporary
swap file only when the VM has no swap and less than 4 GiB of RAM. The 4 GiB
threshold is a conservative default for short-lived manual publishes on small
Colima profiles; raise `COLIMA_BUILD_SWAP_MEMORY_THRESHOLD_KIB` if larger builds
still OOM, or lower it if you only want swap for very small VMs.

Prefer increasing the Colima VM memory (`colima start --memory <GiB>` or the
profile config) when you want a persistent build machine. Use this helper when
you need a temporary, reversible boost for one manual publish without resizing
or recreating the VM.

Run it before a manual publish if Docker builds fail with out-of-memory errors,
or if `status` shows a small Colima VM with no swap. The swap remains active
until cleanup or VM restart, so use a shell trap for one-off sessions:

```bash
deploy/scripts/prepare-colima-build-swap.sh status
deploy/scripts/prepare-colima-build-swap.sh
trap 'deploy/scripts/prepare-colima-build-swap.sh cleanup' EXIT
deploy/scripts/publish-images.sh --image_tag latest
```

Useful overrides:

```bash
COLIMA_BUILD_SWAP_SIZE=6G deploy/scripts/prepare-colima-build-swap.sh
COLIMA_BUILD_SWAP_MEMORY_THRESHOLD_KIB=6291456 deploy/scripts/prepare-colima-build-swap.sh
COLIMA_BIN=/opt/homebrew/bin/colima deploy/scripts/prepare-colima-build-swap.sh status
COLIMA_BUILD_SWAP_CLEANUP_FORCE=1 COLIMA_BUILD_SWAPFILE=/custom-swapfile deploy/scripts/prepare-colima-build-swap.sh cleanup
```

`cleanup` removes the default helper path and the old helper path. If you set a
custom `COLIMA_BUILD_SWAPFILE`, cleanup refuses to remove it unless
`COLIMA_BUILD_SWAP_CLEANUP_FORCE=1` is also set.
