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

/**
 * 清空全部账号及其级联数据，恢复用例间隔离。
 *
 * 公告须显式清理：AdminAnnouncement.authorId 自注销改物理删除后由 CASCADE 改为
 * SET NULL（公告是全站内容，不随作者注销消失，见 TECH-DESIGN §9.6），因此删用户
 * 不再连带删公告。若不在此清理，admin 套件创建的公告会跨文件泄漏到断言
 * 「announcements 为空」的套件（如 overview）。
 */
export async function resetUsers(): Promise<void> {
  await prisma.adminAnnouncement.deleteMany({});
  await prisma.user.deleteMany({});
}
