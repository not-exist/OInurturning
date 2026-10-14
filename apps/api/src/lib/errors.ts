import type { ErrorCode } from '@oinur/shared';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  INSUFFICIENT_RESOURCE: 409,
  STATE_CONFLICT: 409,
  ALREADY_EXISTS: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly httpStatus: number;
  constructor(
    readonly code: ErrorCode,
    readonly details?: unknown,
    httpStatusOverride?: number,
  ) {
    super(code);
    this.httpStatus = httpStatusOverride ?? STATUS[code];
  }
}
