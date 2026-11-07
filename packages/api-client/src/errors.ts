/** What went wrong, in terms a screen can act on. */
export type ApiErrorKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'conflict'
  | 'rate_limited'
  | 'invalid_state'
  | 'invalid_request'
  | 'not_found'
  | 'network'
  | 'unknown';

const BY_SQLSTATE: Record<string, ApiErrorKind> = {
  '28000': 'unauthenticated',
  '42501': 'forbidden',
  '40001': 'conflict',
  '53400': 'rate_limited',
  '55000': 'invalid_state',
  '22023': 'invalid_request',
  P0001: 'invalid_request',
  P0002: 'not_found',
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly code: string | null;
  constructor(kind: ApiErrorKind, message: string, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.code = code;
  }

  static fromCode(code: string | null | undefined, message: string): ApiError {
    return new ApiError((code && BY_SQLSTATE[code]) || 'unknown', message, code ?? null);
  }
}
