interface Env {
  BACKUP_BUCKET: R2Bucket;
  BACKUP_TOKEN: string;
}

const KEY_PATTERN = /^open-design\/prod\/backups\/open-design-\d{8}T\d{6}Z\.tgz$/;

function unauthorized(): Response {
  return new Response('unauthorized\n', { status: 401 });
}

function objectKey(request: Request): string | null {
  const url = new URL(request.url);
  const key = url.pathname.replace(/^\/+/, '');
  return KEY_PATTERN.test(key) ? key : null;
}

function hasValidToken(request: Request, env: Env): boolean {
  const expected = env.BACKUP_TOKEN.trim();
  if (!expected) return false;
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? request.headers.get('x-open-design-backup-token')?.trim();
  return token === expected;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true });
    if (!hasValidToken(request, env)) return unauthorized();

    const key = objectKey(request);
    if (!key) return new Response('invalid backup key\n', { status: 400 });

    if (request.method === 'PUT') {
      await env.BACKUP_BUCKET.put(key, request.body, {
        httpMetadata: {
          contentType: request.headers.get('content-type') ?? 'application/gzip',
        },
      });
      return Response.json({ ok: true, key });
    }

    if (request.method === 'GET') {
      const object = await env.BACKUP_BUCKET.get(key);
      if (!object) return new Response('not found\n', { status: 404 });
      return new Response(object.body, {
        headers: {
          'content-type': object.httpMetadata?.contentType ?? 'application/gzip',
          etag: object.httpEtag,
        },
      });
    }

    return new Response('method not allowed\n', {
      status: 405,
      headers: { allow: 'GET, PUT' },
    });
  },
};
