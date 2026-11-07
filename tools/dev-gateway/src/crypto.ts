import { createHmac, timingSafeEqual } from 'node:crypto';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** HS256 JWT for the local gateway only. Hosted environments use Supabase Auth tokens. */
export function signJwt(claims: Record<string, unknown>, secret: string, ttlSeconds = 8 * 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds }));
  return `${head}.${body}.${hmac(secret, `${head}.${body}`).toString('base64url')}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const [head, body, sig] = token.split('.');
  if (!head || !body || !sig) return null;
  if (!safeEqual(Buffer.from(sig, 'base64url'), hmac(secret, `${head}.${body}`))) return null;
  try {
    const h = JSON.parse(Buffer.from(head, 'base64url').toString());
    if (h.alg !== 'HS256') return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

export function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Signature header for sandbox provider webhooks: hex HMAC of the raw body. */
export function verifyWebhook(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  return safeEqual(Buffer.from(signature, 'hex'), hmac(secret, rawBody));
}
