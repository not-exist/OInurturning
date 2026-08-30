import request from 'supertest';
import type { Express } from 'express';
import type { ApiEnvelope } from '@oinur/shared';
import { prisma } from '../src/lib/prisma.js';

export function get(app: Express, url: string): request.Test {
  return request(app).get(url);
}

export function unwrap<T>(res: request.Response): ApiEnvelope<T> {
  return res.body as ApiEnvelope<T>;
}

export function unwrapOk<T>(res: request.Response): T {
  const body = res.body as ApiEnvelope<T>;
  if (!body.ok) throw new Error(`expected ok envelope, got error: ${body.error.code}`);
  return body.data;
}

export function unwrapErr(res: request.Response): { code: string; message: string; details?: unknown } {
  const body = res.body as ApiEnvelope<unknown>;
  if (body.ok) throw new Error('expected error envelope, got ok');
  return body.error;
}

export async function resetUsers(): Promise<void> {
  await prisma.user.deleteMany({});
}
