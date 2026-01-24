// src/lib/sessionStore.ts
export type SessionRecord = {
  sessionKey: string;
  threadId: string;
  vectorStoreId: string;
  createdAt: number;
};

const sessions = new Map<string, SessionRecord>();

export function getSession(sessionKey: string) {
  return sessions.get(sessionKey);
}

export function setSession(rec: SessionRecord) {
  sessions.set(rec.sessionKey, rec);
}

export function requireSession(sessionKey: string) {
  const s = sessions.get(sessionKey);
  if (!s) {
    throw new Error("Unknown sessionKey. Call POST /api/session first.");
  }
  return s;
}
