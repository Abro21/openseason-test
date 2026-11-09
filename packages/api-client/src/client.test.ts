import { describe, expect, it, vi } from 'vitest';
import { ApiError, httpTransport, OpenSeasonClient, ScopedCache, supabaseTransport, type Transport } from './index.js';

const fake = (impl: (fn: string, args: Record<string, unknown>) => unknown = () => null) => {
  const call = vi.fn(async (fn: string, args: Record<string, unknown>) => impl(fn, args));
  return { call } satisfies Transport;
};

describe('OpenSeasonClient', () => {
  it('refuses unknown functions, unknown arguments and server-only functions before calling', async () => {
    const t = fake();
    const c = new OpenSeasonClient(t);
    await expect(c.rpc('drop_everything')).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(c.rpc('rsvp_set', { p_event: 'x', p_role: 'owner' })).rejects.toThrow(/unknown argument p_role/);
    await expect(c.rpc('staff_message_reply', { p_thread: 'x' })).rejects.toMatchObject({ kind: 'forbidden' });
    expect(t.call).not.toHaveBeenCalled();
  });

  it('caches reads per person and context, and drops them on a switch, a write or sign-out', async () => {
    let n = 0;
    const t = fake(() => ({ n: ++n }));
    const c = new OpenSeasonClient(t);
    c.setScope('pat', 'family');
    expect(await c.rpc('my_fees')).toEqual({ n: 1 });
    expect(await c.rpc('my_fees')).toEqual({ n: 1 });
    c.setScope('pat', 'coach');
    expect(await c.rpc('my_fees')).toEqual({ n: 2 });
    await c.rpc('rsvp_set', { p_event: 'e', p_athlete: 'a', p_status: 'yes' });
    expect(await c.rpc('my_fees')).toEqual({ n: 4 });
    c.signOut();
    expect(c.cache.size).toBe(0);
    c.setScope('dana', null);
    expect(await c.rpc('my_fees')).toEqual({ n: 5 });
  });

  it('rejects a response that does not match the contract', async () => {
    const c = new OpenSeasonClient(fake(() => ({ clubs: 'nope' })));
    await expect(c.contexts('00000000-0000-4000-8000-000000000401')).rejects.toThrow(/unexpected response from my_contexts/);
  });
});

describe('transports', () => {
  it('maps database error codes to kinds', async () => {
    const t = supabaseTransport({ rpc: async () => ({ data: null, error: { code: '40001', message: 'stale' } }) });
    const err = await t.call('rsvp_set', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'conflict', code: '40001', message: 'stale' });
  });

  it('sends the bearer token and unwraps data over HTTP', async () => {
    const f = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: [1] }), { status: 200 }));
    const t = httpTransport({ baseUrl: 'http://gw/', getToken: () => 'tok', fetch: f as unknown as typeof fetch });
    expect(await t.call('my_fees', {})).toEqual([1]);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('http://gw/rpc/my_fees');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('reports a refused request as forbidden, and a dropped connection as network', async () => {
    const denied = httpTransport({ baseUrl: 'http://gw', getToken: () => null, fetch: (async () => new Response(JSON.stringify({ error: { code: '42501', message: 'not allowed' } }), { status: 403 })) as unknown as typeof fetch });
    await expect(denied.call('my_fees', {})).rejects.toMatchObject({ kind: 'forbidden' });
    const down = httpTransport({ baseUrl: 'http://gw', getToken: () => null, fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    await expect(down.call('my_fees', {})).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('ScopedCache', () => {
  it('expires entries and stores nothing while signed out', () => {
    let now = 0;
    const c = new ScopedCache(1000, () => now);
    c.set('a', 1);
    expect(c.get('a')).toBeUndefined();
    c.setScope('p', null);
    c.set('a', 1);
    now = 999;
    expect(c.get('a')).toBe(1);
    now = 1001;
    expect(c.get('a')).toBeUndefined();
  });
});
