export type Session = {
  sessionKey: string;
  threadId: string;
  vectorStoreId: string;
  createdAt: number;
};

const sessions = new Map<string, Session>();

export function getSession(sessionKey: string) {
  return sessions.get(sessionKey);
}

export function setSession(s: Session) {
  sessions.set(s.sessionKey, s);
}

export function ensureSession(sessionKey: string) {
  const existing = sessions.get(sessionKey);
  return existing ?? null;
}
