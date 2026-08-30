import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessClaims {
  uid: number;
  role: 'USER' | 'ADMIN';
  tv: number; // tokenVersion
}

export function signAccess(u: AccessClaims): string {
  return jwt.sign({ ...u, typ: 'access' }, env.JWT_SECRET, { expiresIn: '15m' });
}

export function signRefresh(u: AccessClaims): string {
  return jwt.sign({ uid: u.uid, tv: u.tv, typ: 'refresh' }, env.JWT_SECRET, { expiresIn: '7d' });
}

export function verifyAccess(token: string): AccessClaims {
  const claims = jwt.verify(token, env.JWT_SECRET) as AccessClaims & { typ?: string };
  if (typeof claims.uid !== 'number' || claims.typ !== 'access')
    throw new jwt.JsonWebTokenError('malformed claims');
  return claims;
}

export function verifyRefresh(token: string): AccessClaims & { typ: 'refresh' } {
  const claims = jwt.verify(token, env.JWT_SECRET) as AccessClaims & { typ?: string };
  if (claims.typ !== 'refresh') throw new jwt.JsonWebTokenError('not a refresh token');
  return claims as AccessClaims & { typ: 'refresh' };
}
