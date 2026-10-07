import type { Prisma } from '../generated/prisma/client.js';

/** Cast a Prisma `Json` column value (read side) to its domain type. */
export function jsonValue<T>(value: Prisma.JsonValue): T {
  return value as unknown as T;
}
