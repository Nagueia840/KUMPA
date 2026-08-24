import type { Context, NextFunction } from 'grammy';

export interface UserContext {
  activeTicker?: string;
  activeThesis?: string;
}

export interface UserSession {
  chatId: number;
  username?: string;
  createdAt: number;
  lastSeen: number;
  context: UserContext;
}

// Sesión en memoria (MVP). Se migra a Supabase en la fase de memoria.
const sessions = new Map<number, UserSession>();

export function getSession(chatId: number): UserSession | undefined {
  return sessions.get(chatId);
}

export function getOrCreateSession(chatId: number, username?: string): UserSession {
  const existing = sessions.get(chatId);
  if (existing) {
    existing.lastSeen = Date.now();
    if (username) existing.username = username;
    return existing;
  }
  const session: UserSession = {
    chatId,
    username,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    context: {},
  };
  sessions.set(chatId, session);
  return session;
}

export function clearSession(chatId: number): void {
  sessions.delete(chatId);
}

/** Middleware que garantiza que exista una sesión en memoria para el chat. */
export async function sessionMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  if (ctx.chat?.id !== undefined) {
    getOrCreateSession(ctx.chat.id, ctx.from?.username);
  }
  await next();
}
