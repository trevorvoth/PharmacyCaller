import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export function generateToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export function decodeToken(token: string): JwtPayload | null {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string') {
    return null;
  }
  return decoded as JwtPayload;
}

export function isTokenExpired(token: string): boolean {
  try {
    const decoded = decodeToken(token);
    if (!decoded?.exp) {
      return true;
    }
    return Date.now() >= decoded.exp * 1000;
  } catch {
    return true;
  }
}

export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1] ?? null;
}
