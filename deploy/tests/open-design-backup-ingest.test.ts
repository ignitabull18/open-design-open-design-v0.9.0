import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../cloudflare/open-design-backup-ingest.ts';

class FakeR2Bucket {
  objects = new Map<string, { body: string; httpMetadata?: { contentType?: string }; httpEtag: string }>();

  async put(key: string, body: ReadableStream | null, options: { httpMetadata?: { contentType?: string } } = {}) {
    const text = body ? await new Response(body).text() : '';
    this.objects.set(key, { body: text, httpMetadata: options.httpMetadata, httpEtag: '"fake-etag"' });
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new Response(object.body).body,
      httpMetadata: object.httpMetadata,
      httpEtag: object.httpEtag,
    };
  }
}

function env() {
  return {
    BACKUP_BUCKET: new FakeR2Bucket(),
    BACKUP_TOKEN: 'secret-token',
  };
}

const validKey = 'open-design/prod/backups/open-design-20260606T213018Z.tgz';

test('backup ingest exposes health without auth', async () => {
  const response = await worker.fetch(new Request('https://worker.example/health'), env() as any);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('backup ingest rejects missing or invalid token', async () => {
  const response = await worker.fetch(new Request(`https://worker.example/${validKey}`), env() as any);
  assert.equal(response.status, 401);
});

test('backup ingest rejects keys outside the backup prefix', async () => {
  const response = await worker.fetch(new Request('https://worker.example/open-design/prod/secrets.txt', {
    headers: { authorization: 'Bearer secret-token' },
  }), env() as any);
  assert.equal(response.status, 400);
});

test('backup ingest stores and reads a backup object', async () => {
  const testEnv = env();
  const put = await worker.fetch(new Request(`https://worker.example/${validKey}`, {
    method: 'PUT',
    headers: {
      authorization: 'Bearer secret-token',
      'content-type': 'application/gzip',
    },
    body: 'sqlite backup',
  }), testEnv as any);
  assert.equal(put.status, 200);

  const get = await worker.fetch(new Request(`https://worker.example/${validKey}`, {
    headers: { authorization: 'Bearer secret-token' },
  }), testEnv as any);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('content-type'), 'application/gzip');
  assert.equal(await get.text(), 'sqlite backup');
});

test('backup ingest returns 404 for a missing backup object', async () => {
  const response = await worker.fetch(new Request(`https://worker.example/${validKey}`, {
    headers: { authorization: 'Bearer secret-token' },
  }), env() as any);
  assert.equal(response.status, 404);
});
