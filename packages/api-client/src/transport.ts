import { ApiError } from './errors.js';

/** Moves one RPC call to the server and back. Authorization is the server's job. */
export interface Transport {
  call(fn: string, args: Record<string, unknown>): Promise<unknown>;
}

/** The slice of supabase-js the app uses, so this package needs no SDK dependency. */
export interface SupabaseLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}

/** Calls PostgREST through a supabase-js client (hosted or CLI Supabase). */
export function supabaseTransport(client: SupabaseLike): Transport {
  return {
    async call(fn, args) {
      const { data, error } = await client.rpc(fn, args);
      if (error) throw ApiError.fromCode(error.code, error.message);
      return data;
    },
  };
}

export interface HttpTransportOptions {
  baseUrl: string;
  /** Returns the current session token, or null when signed out. */
  getToken: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
}

/** Calls the local dev gateway (tools/dev-gateway): POST {baseUrl}/rpc/{fn}. */
export function httpTransport(opts: HttpTransportOptions): Transport {
  const doFetch = opts.fetch ?? fetch;
  return {
    async call(fn, args) {
      const token = await opts.getToken();
      let res: Response;
      try {
        res = await doFetch(`${opts.baseUrl.replace(/\/$/, '')}/rpc/${encodeURIComponent(fn)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(args),
        });
      } catch (e) {
        throw new ApiError('network', (e as Error).message);
      }
      const body = (await res.json().catch(() => null)) as { data?: unknown; error?: { code?: string; message: string } } | null;
      if (!res.ok || body?.error) {
        if (res.status === 401 && !body?.error?.code) throw new ApiError('unauthenticated', 'Please sign in again.');
        throw ApiError.fromCode(body?.error?.code, body?.error?.message ?? `Request failed (${res.status})`);
      }
      return body?.data ?? null;
    },
  };
}
