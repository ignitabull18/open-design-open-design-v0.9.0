#!/usr/bin/env -S node --experimental-strip-types
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

type JsonObject = Record<string, any>;

export interface CoolifyBackupReadinessResult {
  ok: true;
  appUuid: string;
  appName: string;
  storageUuid: string;
  storageName: string;
  mountPath: string;
  backupCommand: string;
  restoreCommand: string;
}

interface CoolifyBackupReadinessOptions {
  appUuid?: string;
  configPath?: string;
  coolifyBaseUrl?: string;
  coolifyToken?: string;
  expectedMountPath?: string;
}

export async function checkCoolifyBackupReadiness(
  options: CoolifyBackupReadinessOptions = {},
): Promise<CoolifyBackupReadinessResult> {
  const appUuid = (options.appUuid || process.env.COOLIFY_APP_UUID || 'jrdtaush3izl7bz10f9gg9qo').trim();
  const expectedMountPath = options.expectedMountPath || process.env.OD_COOLIFY_DATA_MOUNT_PATH || '/app/.od';
  const connection = await resolveCoolifyConnection(options);
  const app = await request(connection, `/api/v1/applications/${encodeURIComponent(appUuid)}`);
  const storagesResponse = await request(connection, `/api/v1/applications/${encodeURIComponent(appUuid)}/storages`);
  const storages = normalizeStorages(storagesResponse);
  if (!Array.isArray(storages)) {
    throw new Error(`Coolify storages response for ${appUuid} was not an array.`);
  }

  const storage = storages.find((item: JsonObject) =>
    item.mount_path === expectedMountPath && (item.type === 'persistent' || item.kind === 'persistent'),
  );
  if (!storage) {
    throw new Error(`No persistent Coolify storage mounted at ${expectedMountPath} for application ${appUuid}.`);
  }

  const storageName = String(storage.name || '');
  if (!storageName) {
    throw new Error(`Coolify storage ${storage.uuid ?? '<missing uuid>'} is missing a Docker volume name.`);
  }

  return {
    ok: true,
    appUuid,
    appName: String(app.name || appUuid),
    storageUuid: String(storage.uuid),
    storageName,
    mountPath: String(storage.mount_path),
    backupCommand: `docker run --rm -v ${storageName}:/data:ro -v "$PWD/backups:/backup" alpine sh -c 'cd /data && tar czf "/backup/open-design-$(date +%Y%m%d-%H%M%S).tgz" .'`,
    restoreCommand: `docker run --rm -v ${storageName}:/data -v "$PWD/backups:/backup:ro" alpine sh -c 'rm -rf /data/* && tar xzf /backup/<backup-file>.tgz -C /data'`,
  };
}

function normalizeStorages(value: any): JsonObject[] | null {
  if (Array.isArray(value)) return value.map((item) => ({ kind: item.type, ...item }));
  if (Array.isArray(value?.persistent_storages)) {
    return value.persistent_storages.map((item: JsonObject) => ({ kind: 'persistent', ...item }));
  }
  return null;
}

async function resolveCoolifyConnection(options: CoolifyBackupReadinessOptions): Promise<{ baseUrl: string; token: string }> {
  const explicitBaseUrl = (options.coolifyBaseUrl || process.env.COOLIFY_URL || '').trim().replace(/\/$/, '');
  const explicitToken = (options.coolifyToken || process.env.COOLIFY_API_TOKEN || '').trim();
  if (explicitBaseUrl && explicitToken) return { baseUrl: explicitBaseUrl, token: explicitToken };

  const configPath = options.configPath || process.env.COOLIFY_CONFIG || `${homedir()}/.config/coolify/config.json`;
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const instance = config.instances?.find((candidate: JsonObject) => candidate.default) ?? config.instances?.[0];
  if (!instance?.fqdn || !instance?.token) {
    throw new Error('Coolify config does not include a default instance with fqdn and token.');
  }
  return { baseUrl: String(instance.fqdn).replace(/\/$/, ''), token: String(instance.token) };
}

async function request(connection: { baseUrl: string; token: string }, path: string): Promise<any> {
  const response = await fetch(`${connection.baseUrl}${path}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${connection.token}`,
    },
  });
  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : {};
  if (!response.ok) {
    throw new Error(`Coolify GET ${path} failed with ${response.status}: ${bodyText}`);
  }
  return body;
}

async function main() {
  const result = await checkCoolifyBackupReadiness();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
