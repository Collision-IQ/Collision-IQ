import { describe, expect, it } from "vitest";
import {
  DRAFT_CHAT_SESSION_KEY,
  clearEndedChatSessionStorage,
  getChatSessionStorageKey,
  readStoredChatMessages,
  writeStoredChatMessages,
  type ChatSessionStore,
} from "@/components/chatWidget/sessionStorageUtils";

function memoryStore(): ChatSessionStore & { keys(): string[] } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

const INITIAL = { id: "initial", role: "assistant" as const, content: "Hi there" };
const USER = { id: "m1", role: "user" as const, content: "Compare these estimates" };
const REPLY = { id: "m2", role: "assistant" as const, content: "Your review is ready" };

describe("chat session storage keys", () => {
  it("uses the draft key when no case is active", () => {
    expect(getChatSessionStorageKey(null)).toBe(DRAFT_CHAT_SESSION_KEY);
    expect(getChatSessionStorageKey("   ")).toBe(DRAFT_CHAT_SESSION_KEY);
  });

  it("scopes the key to the active case", () => {
    expect(getChatSessionStorageKey(" case-42 ")).toBe(
      "collision-iq.chat-widget.session:case:case-42"
    );
  });

  it("round-trips messages and drops malformed entries", () => {
    const store = memoryStore();
    writeStoredChatMessages(DRAFT_CHAT_SESSION_KEY, [INITIAL, USER], store);
    expect(readStoredChatMessages(DRAFT_CHAT_SESSION_KEY, store)).toEqual([INITIAL, USER]);

    store.setItem(DRAFT_CHAT_SESSION_KEY, JSON.stringify([USER, { role: "user" }, "junk"]));
    expect(readStoredChatMessages(DRAFT_CHAT_SESSION_KEY, store)).toEqual([USER]);

    store.setItem(DRAFT_CHAT_SESSION_KEY, "{not json");
    expect(readStoredChatMessages(DRAFT_CHAT_SESSION_KEY, store)).toBeNull();
  });
});

describe("clearEndedChatSessionStorage", () => {
  // Regression: End Chat with an active case cleared only the case key. The
  // draft key still held the pre-case transcript, so when activeCaseId
  // dropped to null the widget's key-switch effect restored it and the
  // "ended" conversation reappeared until End was pressed a second time.
  it("removes the draft snapshot as well as the case snapshot", () => {
    const store = memoryStore();
    const caseKey = getChatSessionStorageKey("case-42");

    // Pre-case transcript persisted under the draft key…
    writeStoredChatMessages(DRAFT_CHAT_SESSION_KEY, [INITIAL, USER, REPLY], store);
    // …then the case key took over once the analysis returned a case id.
    writeStoredChatMessages(caseKey, [INITIAL, USER, REPLY], store);

    clearEndedChatSessionStorage({ currentStorageKey: caseKey, activeCaseId: "case-42" }, store);

    expect(readStoredChatMessages(caseKey, store)).toBeNull();
    expect(readStoredChatMessages(DRAFT_CHAT_SESSION_KEY, store)).toBeNull();
    expect(store.keys()).toEqual([]);
  });

  it("clears the draft snapshot when no case is active", () => {
    const store = memoryStore();
    writeStoredChatMessages(DRAFT_CHAT_SESSION_KEY, [INITIAL, USER], store);

    clearEndedChatSessionStorage(
      { currentStorageKey: DRAFT_CHAT_SESSION_KEY, activeCaseId: null },
      store
    );

    expect(store.keys()).toEqual([]);
  });

  it("clears a stale current key that differs from the active case key", () => {
    const store = memoryStore();
    const previousCaseKey = getChatSessionStorageKey("case-1");
    const activeCaseKey = getChatSessionStorageKey("case-2");
    writeStoredChatMessages(previousCaseKey, [USER], store);
    writeStoredChatMessages(activeCaseKey, [USER], store);
    writeStoredChatMessages(DRAFT_CHAT_SESSION_KEY, [USER], store);

    clearEndedChatSessionStorage(
      { currentStorageKey: previousCaseKey, activeCaseId: "case-2" },
      store
    );

    expect(store.keys()).toEqual([]);
  });

  it("does not touch other sessions' snapshots", () => {
    const store = memoryStore();
    const otherCaseKey = getChatSessionStorageKey("case-other");
    writeStoredChatMessages(otherCaseKey, [USER], store);
    writeStoredChatMessages(DRAFT_CHAT_SESSION_KEY, [USER], store);

    clearEndedChatSessionStorage(
      { currentStorageKey: DRAFT_CHAT_SESSION_KEY, activeCaseId: null },
      store
    );

    expect(store.keys()).toEqual([otherCaseKey]);
  });
});
