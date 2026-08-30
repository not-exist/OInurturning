import request from 'supertest';
import type { Express } from 'express';
import type { ApiEnvelope } from '@oinur/shared';

export function get(app: Express, url: string): request.Test {
  return request(app).get(url);
}

export function unwrap<T>(res: request.Response): ApiEnvelope<T> {
  return res.body as ApiEnvelope<T>;
}
