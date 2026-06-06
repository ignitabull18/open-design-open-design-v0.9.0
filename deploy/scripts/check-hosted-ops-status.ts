#!/usr/bin/env -S node --experimental-strip-types
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

type JsonObject = Record<string, any>;

export interface HostedOpsStatusCheckResult {
  ok: true;
  baseUrl: string;
  source: string;
  checkIds: string[];
  rateLimitEnabled: boolean;
  backupOffsiteTarget?: string;
  cli?: {
    ok: true;
    source: string;
    checkIds: string[];
  };
}

interface HostedOpsStatusCheckOptions {
  baseUrl?: string;
  apiToken?: string;
  includeCli?: boolean;
  cliPath?: string;
  execFileImpl?: typeof execFileAsync;
}

export async function checkHostedOpsStatus(
  options: HostedOpsStatusCheckOptions = {},
): Promise<HostedOpsStatusCheckResult> {
  const baseUrl = (options.baseUrl || process.env.OD_HOSTED_BASE_URL || 'https://open-design.ignitabull.org').replace(/\/$/, '');
  const apiToken = (options.apiToken || process.env.OD_API_TOKEN || '').trim();
  if (!apiToken) {
    throw Object.assign(
      new Error('OD_API_TOKEN is required. Export the hosted daemon token before checking ops status.'),
      { exitCode: 2 },
    );
  }

  const apiStatus = await fetchOpsStatus(baseUrl, apiToken);
  assertOpsStatusReady(apiStatus, 'API');

  const result: HostedOpsStatusCheckResult = {
    ok: true,
    baseUrl,
    source: String(apiStatus.source || 'unknown'),
    checkIds: checkIds(apiStatus),
    rateLimitEnabled: apiStatus.rateLimit?.enabled === true,
    ...(typeof apiStatus.backup?.offsiteTarget === 'string' ? { backupOffsiteTarget: apiStatus.backup.offsiteTarget } : {}),
  };

  if (options.includeCli ?? process.env.OD_SKIP_CLI_OPS_STATUS !== '1') {
  const cliStatus = await readCliOpsStatus({
      baseUrl,
      apiToken,
      cliPath: options.cliPath,
      execFileImpl: options.execFileImpl ?? execFileAsync,
      requireExistingCli: !options.execFileImpl,
    });
    assertOpsStatusReady(cliStatus, 'CLI');
    result.cli = {
      ok: true,
      source: String(cliStatus.source || 'unknown'),
      checkIds: checkIds(cliStatus),
    };
  }

  return result;
}

async function fetchOpsStatus(baseUrl: string, apiToken: string): Promise<JsonObject> {
  const response = await fetch(`${baseUrl}/api/ops/status`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`/api/ops/status failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as JsonObject;
}

async function readCliOpsStatus(input: {
  baseUrl: string;
  apiToken: string;
  cliPath?: string;
  execFileImpl: typeof execFileAsync;
  requireExistingCli: boolean;
}): Promise<JsonObject> {
  const cliPath = input.cliPath || process.env.OD_CLI_PATH || defaultCliPath();
  if (input.requireExistingCli && !existsSync(cliPath)) {
    throw new Error(`Cannot run CLI ops status because ${cliPath} does not exist. Build @open-design/daemon first or set OD_CLI_PATH.`);
  }
  const { stdout } = await input.execFileImpl(process.execPath, [
    cliPath,
    'ops',
    'status',
    '--daemon-url',
    input.baseUrl,
    '--json',
  ], {
    env: {
      ...process.env,
      OD_API_TOKEN: input.apiToken,
    },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout) as JsonObject;
}

function defaultCliPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../apps/daemon/dist/cli.js');
}

function assertOpsStatusReady(status: JsonObject, label: string) {
  if (status.ok !== true) throw new Error(`${label} ops status did not return ok=true.`);
  const checks = Array.isArray(status.checks) ? status.checks : [];
  const bad = checks.filter((check: JsonObject) => check.status !== 'ok');
  if (bad.length > 0) {
    throw new Error(`${label} ops status has non-ok checks: ${bad.map((check: JsonObject) => `${check.id}:${check.status}`).join(', ')}`);
  }
  if (status.rateLimit?.enabled !== true) {
    throw new Error(`${label} ops status expected rateLimit.enabled=true.`);
  }
  const offsiteTarget = status.backup?.offsiteTarget;
  if (typeof offsiteTarget !== 'string' || !offsiteTarget.includes('://')) {
    throw new Error(`${label} ops status expected backup.offsiteTarget to be an offsite URI.`);
  }
}

function checkIds(status: JsonObject): string[] {
  return (Array.isArray(status.checks) ? status.checks : [])
    .map((check: JsonObject) => String(check.id || ''))
    .filter(Boolean);
}

async function main() {
  const result = await checkHostedOpsStatus();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(typeof error?.exitCode === 'number' ? error.exitCode : 1);
  });
}
