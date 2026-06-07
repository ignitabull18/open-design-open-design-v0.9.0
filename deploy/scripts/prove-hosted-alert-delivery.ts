#!/usr/bin/env -S node --experimental-strip-types
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sendHostedPlannerAlert } from './monitor-hosted-planner.ts';

export interface HostedAlertDeliveryProofResult {
  ok: true;
  outputPath: string;
  generatedAt: string;
  webhookStatus: number;
}

interface HostedAlertDeliveryProofOptions {
  outputPath?: string;
  alertWebhookUrl?: string;
  baseUrl?: string;
}

export async function proveHostedAlertDelivery(
  options: HostedAlertDeliveryProofOptions = {},
): Promise<HostedAlertDeliveryProofResult> {
  const generatedAt = new Date().toISOString();
  const alert = await sendHostedPlannerAlert({
    alertWebhookUrl: options.alertWebhookUrl,
    baseUrl: options.baseUrl,
    ok: true,
    message: `Hosted planner alert delivery proof at ${generatedAt}.`,
  });
  if (!alert) {
    throw new Error('OD_ALERT_WEBHOOK_URL is required before proving hosted alert delivery.');
  }
  const outputPath = options.outputPath
    || process.env.OD_ALERT_EVIDENCE_OUTPUT
    || path.join('docs', 'deployment', 'evidence', `${generatedAt.slice(0, 10)}-hosted-alert-delivery.md`);
  const body = [
    `# Hosted Alert Delivery Evidence - ${generatedAt.slice(0, 10)}`,
    '',
    `Generated at: \`${generatedAt}\``,
    `Webhook status: \`${alert.webhookStatus}\``,
    '',
    'The production alert destination accepted a structured hosted-planner success proof payload.',
    '',
  ].join('\n');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body, 'utf8');
  return {
    ok: true,
    outputPath,
    generatedAt,
    webhookStatus: alert.webhookStatus,
  };
}

async function main() {
  const result = await proveHostedAlertDelivery();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
