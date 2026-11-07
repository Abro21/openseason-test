import { describe, expect, it } from 'vitest';
import { hmac, signJwt, verifyJwt, verifyWebhook } from './crypto.js';
import { assertLocalDatabase } from './db.js';

describe('gateway crypto', () => {
  it('verifies its own tokens and rejects tampered, foreign or expired ones', () => {
    const t = signJwt({ sub: 'u1' }, 's1');
    expect(verifyJwt(t, 's1')?.sub).toBe('u1');
    expect(verifyJwt(t, 's2')).toBeNull();
    const [h, , s] = t.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'u2', exp: 9e9 })).toString('base64url')}.${s}`;
    expect(verifyJwt(forged, 's1')).toBeNull();
    expect(verifyJwt(signJwt({ sub: 'u1' }, 's1', -10), 's1')).toBeNull();
    expect(verifyJwt('nope', 's1')).toBeNull();
  });

  it('accepts only correctly signed webhooks', () => {
    const body = '{"event_id":"e"}';
    expect(verifyWebhook(body, hmac('w', body).toString('hex'), 'w')).toBe(true);
    expect(verifyWebhook(body + ' ', hmac('w', body).toString('hex'), 'w')).toBe(false);
    expect(verifyWebhook(body, undefined, 'w')).toBe(false);
    expect(verifyWebhook(body, 'zz', 'w')).toBe(false);
  });

  it('refuses a database that is not on this machine', () => {
    expect(() => assertLocalDatabase('postgresql://u:p@localhost:5432/x')).not.toThrow();
    expect(() => assertLocalDatabase('postgresql://u:p@db.example.supabase.co:5432/postgres')).toThrow(/local database/);
  });
});
