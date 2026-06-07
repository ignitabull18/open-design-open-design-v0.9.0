#!/usr/bin/env -S node --experimental-strip-types
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { checkHostedDeploymentDrift } from './check-hosted-deployment-drift.ts';
import { exportHostedOpsEvidence } from './export-hosted-ops-evidence.ts';
import { runHostedPostDeploy } from './run-hosted-post-deploy.ts';

const execFileAsync = promisify(execFile);

export interface HostedReleaseChecklistStep {
  id: string;
  status: 'passed' | 'failed' | 'skipped';
  summary: string;
}

export interface HostedReleaseChecklistResult {
  ok: boolean;
  generatedAt: string;
  steps: HostedReleaseChecklistStep[];
}

interface HostedReleaseChecklistOptions {
  skipLocalChecks?: boolean;
  skipLiveChecks?: boolean;
  execFileImpl?: typeof execFileAsync;
}

export async function runHostedReleaseChecklist(
  options: HostedReleaseChecklistOptions = {},
): Promise<HostedReleaseChecklistResult> {
  const generatedAt = new Date().toISOString();
  const execImpl = options.execFileImpl || execFileAsync;
  const steps: HostedReleaseChecklistStep[] = [];
  if (options.skipLocalChecks || process.env.OD_RELEASE_SKIP_LOCAL_CHECKS === '1') {
    steps.push({ id: 'local-checks', status: 'skipped', summary: 'Local guard/typecheck/deploy tests were skipped by option.' });
  } else {
    await runCommandStep(steps, execImpl, 'deploy-tests', 'sh', ['-lc', 'node --import tsx --test deploy/tests/*.test.ts']);
    await runCommandStep(steps, execImpl, 'guard', 'pnpm', ['guard']);
    await runCommandStep(steps, execImpl, 'contracts-typecheck', 'pnpm', ['--filter', '@open-design/contracts', 'typecheck']);
    await runCommandStep(steps, execImpl, 'daemon-typecheck', 'pnpm', ['--filter', '@open-design/daemon', 'typecheck']);
    await runCommandStep(steps, execImpl, 'web-typecheck', 'pnpm', ['--filter', '@open-design/web', 'typecheck']);
  }
  if (options.skipLiveChecks || process.env.OD_RELEASE_SKIP_LIVE_CHECKS === '1') {
    steps.push({ id: 'live-checks', status: 'skipped', summary: 'Live hosted post-deploy, drift, and evidence export checks were skipped by option.' });
  } else {
    await runFunctionStep(steps, 'hosted-post-deploy', async () => {
      const result = await runHostedPostDeploy();
      return `post-deploy ok with ${result.providerConnections.connectedProviders.join(', ')}`;
    });
    await runFunctionStep(steps, 'deployment-drift', async () => {
      const result = await checkHostedDeploymentDrift();
      if (!result.ok) throw new Error(result.checks.filter((check) => check.status === 'drift').map((check) => `${check.id}: expected ${check.expected}, got ${check.actual}`).join('; '));
      return `${result.checks.length} drift checks passed`;
    });
    await runFunctionStep(steps, 'ops-evidence-export', async () => {
      const result = await exportHostedOpsEvidence();
      return `wrote ${result.outputPath}`;
    });
  }
  return {
    ok: steps.every((step) => step.status === 'passed' || step.status === 'skipped'),
    generatedAt,
    steps,
  };
}

async function runCommandStep(
  steps: HostedReleaseChecklistStep[],
  execImpl: typeof execFileAsync,
  id: string,
  command: string,
  args: string[],
): Promise<void> {
  await runFunctionStep(steps, id, async () => {
    const result = await execImpl(command, args, { timeout: 600_000, maxBuffer: 10 * 1024 * 1024 });
    return `${command} ${args.join(' ')} passed${result.stdout ? `: ${result.stdout.slice(0, 200).trim()}` : ''}`;
  });
}

async function runFunctionStep(
  steps: HostedReleaseChecklistStep[],
  id: string,
  fn: () => Promise<string>,
): Promise<void> {
  try {
    steps.push({ id, status: 'passed', summary: await fn() });
  } catch (error) {
    steps.push({ id, status: 'failed', summary: error instanceof Error ? error.message : String(error) });
  }
}

async function main() {
  const result = await runHostedReleaseChecklist();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
