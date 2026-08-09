import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_IDS_PER_MESSAGE,
  MAX_THREADS_PER_USER,
  MAX_MESSAGE_CHARS,
  MAX_THREAD_MESSAGES,
  MAX_THREAD_TITLE_CHARS,
  deriveChatThreadTitle,
  isThreadWorthSaving,
  sanitizeChatThreadMessages,
} from "@/lib/chatThreads/threadRules";
import { chatHistoryReopenLimit } from "@/lib/featureAccess";

const user = (id: string, content: string) => ({ id, role: "user" as const, content });
const assistant = (id: string, content: string) => ({ id, role: "assistant" as const, content });

describe("sanitizeChatThreadMessages", () => {
  it("keeps only valid user/assistant messages and drops system status", () => {
    const result = sanitizeChatThreadMessages([
      user("user-1", "hi"),
      { id: "assistant-2", role: "assistant", content: "uploading…", kind: "system_status" },
      assistant("assistant-3", "hello"),
      { id: 4, role: "user", content: "bad id" },
      { id: "user-5", role: "tool", content: "bad role" },
      null,
      "junk",
    ]);
    expect(result.map((message) => message.id)).toEqual(["user-1", "assistant-3"]);
  });

  it("bounds message count (keeping the most recent) and message length", () => {
    const flood = Array.from({ length: MAX_THREAD_MESSAGES + 25 }, (_, index) =>
      user(`user-${index}`, "x".repeat(index === MAX_THREAD_MESSAGES + 24 ? MAX_MESSAGE_CHARS + 500 : 5))
    );
    const result = sanitizeChatThreadMessages(flood);
    expect(result).toHaveLength(MAX_THREAD_MESSAGES);
    expect(result[result.length - 1].id).toBe(`user-${MAX_THREAD_MESSAGES + 24}`);
    expect(result[result.length - 1].content).toHaveLength(MAX_MESSAGE_CHARS);
  });

  it("returns empty for non-array payloads", () => {
    expect(sanitizeChatThreadMessages(null)).toEqual([]);
    expect(sanitizeChatThreadMessages({})).toEqual([]);
  });
});

describe("isThreadWorthSaving", () => {
  it("requires a real exchange beyond the canned greeting", () => {
    expect(isThreadWorthSaving([])).toBe(false);
    expect(isThreadWorthSaving([assistant("assistant-initial", "hi there")])).toBe(false);
    expect(
      isThreadWorthSaving([assistant("assistant-initial", "hi"), user("user-1", "hello?")])
    ).toBe(false);
    expect(
      isThreadWorthSaving([
        assistant("assistant-initial", "hi"),
        user("user-1", "hello?"),
        assistant("assistant-2", "hey!"),
      ])
    ).toBe(true);
  });
});

describe("deriveChatThreadTitle", () => {
  it("uses the first user message, collapsed and truncated", () => {
    expect(deriveChatThreadTitle([user("user-1", "  Compare   these \n estimates  ")])).toBe(
      "Compare these estimates"
    );
    const long = deriveChatThreadTitle([user("user-1", "y".repeat(200))]);
    expect(long.length).toBeLessThanOrEqual(MAX_THREAD_TITLE_CHARS);
    expect(long.endsWith("…")).toBe(true);
    expect(deriveChatThreadTitle([assistant("assistant-1", "no user yet")])).toBe("Saved chat");
  });
});

describe("chatHistoryReopenLimit", () => {
  it("maps plans to reopen limits: free 0, starter 3, pro 10, team/admin 20", () => {
    expect(chatHistoryReopenLimit("free")).toBe(0);
    expect(chatHistoryReopenLimit("none")).toBe(0);
    expect(chatHistoryReopenLimit(null)).toBe(0);
    expect(chatHistoryReopenLimit("starter")).toBe(3);
    expect(chatHistoryReopenLimit("pro")).toBe(10);
    expect(chatHistoryReopenLimit("trial")).toBe(10);
    expect(chatHistoryReopenLimit("team")).toBe(20);
    expect(chatHistoryReopenLimit("admin")).toBe(20);
    expect(chatHistoryReopenLimit("free", true)).toBe(20);
    expect(chatHistoryReopenLimit("STARTER")).toBe(3);
  });

  it("never promises a window wider than storage can hold", () => {
    // listChatThreads takes Math.min(limit, MAX_THREADS_PER_USER), so any plan
    // above the prune ceiling states a number it can never deliver. The old
    // POSITIVE_INFINITY tiers silently behaved as 30, and a proposed 40 would
    // have done the same.
    for (const plan of ["free", "starter", "pro", "team", "admin"]) {
      expect(chatHistoryReopenLimit(plan)).toBeLessThanOrEqual(MAX_THREADS_PER_USER);
    }
    expect(chatHistoryReopenLimit("free", true)).toBeLessThanOrEqual(MAX_THREADS_PER_USER);
  });
});

describe("attachmentIds survive the round trip to storage", () => {
  it("carries the ids that let a reopened thread restore its files", () => {
    const [message] = sanitizeChatThreadMessages([
      { ...user("user-1", "compare these"), attachmentIds: ["att-1", "att-2"] },
    ]);
    expect(message.attachmentIds).toEqual(["att-1", "att-2"]);
  });

  it("omits the field entirely when a message carried no files", () => {
    // Absent rather than an empty array, so stored threads do not grow a
    // meaningless key on every text-only turn.
    const [message] = sanitizeChatThreadMessages([user("user-1", "hello")]);
    expect(message).not.toHaveProperty("attachmentIds");
  });

  it("drops non-string and blank ids rather than storing junk references", () => {
    const [message] = sanitizeChatThreadMessages([
      {
        ...user("user-1", "hi"),
        attachmentIds: ["att-1", "", "   ", 42, null, undefined, { id: "x" }, "att-2"],
      },
    ]);
    expect(message.attachmentIds).toEqual(["att-1", "att-2"]);
  });

  it("bounds a pathological payload instead of ballooning the stored thread", () => {
    const [message] = sanitizeChatThreadMessages([
      {
        ...user("user-1", "hi"),
        attachmentIds: Array.from({ length: 500 }, (_, index) => `att-${index}`),
      },
    ]);
    expect(message.attachmentIds).toHaveLength(MAX_ATTACHMENT_IDS_PER_MESSAGE);
    expect(message.attachmentIds?.[0]).toBe("att-0");
  });

  it("ignores an attachmentIds field that is not an array at all", () => {
    const [message] = sanitizeChatThreadMessages([
      { ...user("user-1", "hi"), attachmentIds: "att-1" },
    ]);
    expect(message).not.toHaveProperty("attachmentIds");
  });
});
