// src/lib/sessionStore.ts
export type SessionState = {
  threadId: string;
  vectorStoreId: string;
  createdAt: number;
};

const store = new Map<string, SessionState>();

export function getSession(sessionKey: string): SessionState | undefined {
  return store.get(sessionKey);
}

export function setSession(sessionKey: string, state: SessionState) {
  store.set(sessionKey, state);
}

export function hasSession(sessionKey: string) {
  return store.has(sessionKey);
}
