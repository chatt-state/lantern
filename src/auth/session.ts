import type { FastifyRequest, FastifyReply } from 'fastify';

export interface LanternSession {
  userId?: string;
  institutionId?: string;
  azureOid?: string;
  email?: string;
  displayName?: string;
  institutionAdmin?: boolean;
  // OAuth 2.1 flow state
  oauthState?: string;
  oauthCodeVerifier?: string;
  oauthNonce?: string;
  pendingAuthSessionId?: string;
}

const SESSION_COOKIE = 'lantern_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function getSession(request: FastifyRequest): LanternSession {
  const raw = request.cookies?.[SESSION_COOKIE];
  if (!raw) return {};
  try {
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return {};
    return JSON.parse(Buffer.from(unsigned.value, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

export function setSession(reply: FastifyReply, session: LanternSession): void {
  const encoded = Buffer.from(JSON.stringify(session)).toString('base64');
  reply.setCookie(SESSION_COOKIE, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
    signed: true,
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
