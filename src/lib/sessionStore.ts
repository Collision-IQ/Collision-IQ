export type SessionState = {
  threadId: string;
  vectorStoreId: string;
};

const store = new Map<string, SessionState>();

export function getSession(sessionKey: string) {
  return store.get(sessionKey);
}

export function setSession(sessionKey: string, state: SessionState) {
  store.set(sessionKey, state);
}
