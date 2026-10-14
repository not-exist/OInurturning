export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'INSUFFICIENT_RESOURCE',
  'STATE_CONFLICT',
  'ALREADY_EXISTS',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr {
  ok: false;
  error: { code: ErrorCode; message: string; details?: unknown };
}
export type ApiEnvelope<T> = ApiOk<T> | ApiErr;

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number }

export interface MeView {
  id: number;
  username: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
  lastLoginAt: string | null;
  money: number;
  reputation: number;
  badges: string[];
}
