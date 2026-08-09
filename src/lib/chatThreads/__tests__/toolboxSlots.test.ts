/**
 * The Toolbox's whole promise is that nothing the user deliberately kept
 * disappears without them saying so. These tests pin the two halves of that:
 * the slot counts per plan, and the two-phase save that refuses to write
 * anything until the user has accepted what they are giving up.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { toolboxSlotLimit } from "@/lib/featureAccess";
import { MAX_THREADS_PER_USER } from "@/lib/chatThreads/threadRules";

const findFirst = vi.fn();
const findMany = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatThread: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      update: (...args: unknown[]) => update(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));
vi.mock("@/lib/uploadedAttachmentStore", () => ({
  getUploadedAttachments: vi.fn(async () => []),
}));

const { saveToToolbox, listToolbox } = await import("@/lib/chatThreads/toolboxStore");

const thread = (id: string, savedAt: Date | null, title = id) => ({
  id,
  title,
  caseId: null,
  messages: [],
  messageCount: 4,
  toolboxSavedAt: savedAt,
  updatedAt: new Date("2026-08-01T00:00:00Z"),
});

beforeEach(() => {
  findFirst.mockReset();
  findMany.mockReset();
  update.mockReset();
  updateMany.mockReset();
});

describe("toolboxSlotLimit", () => {
  it("gives free accounts no toolbox at all", () => {
    expect(toolboxSlotLimit("free")).toBe(0);
    expect(toolboxSlotLimit("none")).toBe(0);
    expect(toolboxSlotLimit(null)).toBe(0);
  });

  it("maps paid plans: starter 3, pro 10, team/admin 20", () => {
    expect(toolboxSlotLimit("starter")).toBe(3);
    expect(toolboxSlotLimit("pro")).toBe(10);
    expect(toolboxSlotLimit("trial")).toBe(10);
    expect(toolboxSlotLimit("team")).toBe(20);
    expect(toolboxSlotLimit("admin")).toBe(20);
    expect(toolboxSlotLimit("free", true)).toBe(20);
    expect(toolboxSlotLimit("STARTER")).toBe(3);
  });

  it("never promises more slots than thread storage can hold", () => {
    for (const plan of ["free", "starter", "pro", "team", "admin"]) {
      expect(toolboxSlotLimit(plan)).toBeLessThanOrEqual(MAX_THREADS_PER_USER);
    }
  });
});

describe("saving when slots remain", () => {
  it("saves and reports no eviction", async () => {
    findFirst.mockResolvedValue(thread("t-new", null));
    findMany.mockResolvedValue([thread("t-1", new Date("2026-08-01T00:00:00Z"))]);
    update.mockResolvedValue(thread("t-new", new Date("2026-08-09T00:00:00Z")));

    const result = await saveToToolbox({
      ownerUserId: "u1",
      threadId: "t-new",
      limit: 3,
    });
    expect(result.status).toBe("saved");
    if (result.status === "saved") expect(result.evicted).toBeNull();
  });

  it("refuses on a plan with no toolbox, without touching the database", async () => {
    const result = await saveToToolbox({ ownerUserId: "u1", threadId: "t", limit: 0 });
    expect(result.status).toBe("locked");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("returns not_found rather than saving a thread the user does not own", async () => {
    findFirst.mockResolvedValue(null);
    const result = await saveToToolbox({ ownerUserId: "u1", threadId: "someone-elses", limit: 3 });
    expect(result.status).toBe("not_found");
    expect(update).not.toHaveBeenCalled();
  });
});

describe("saving when the toolbox is full", () => {
  const fullToolbox = () => {
    findFirst.mockResolvedValue(thread("t-new", null));
    findMany.mockResolvedValue([
      thread("t-oldest", new Date("2026-08-01T00:00:00Z"), "Oldest claim"),
      thread("t-mid", new Date("2026-08-05T00:00:00Z")),
      thread("t-newest", new Date("2026-08-08T00:00:00Z")),
    ]);
  };

  it("asks first and writes NOTHING — declining must leave the toolbox intact", async () => {
    fullToolbox();
    const result = await saveToToolbox({ ownerUserId: "u1", threadId: "t-new", limit: 3 });
    expect(result.status).toBe("needs_confirmation");
    if (result.status === "needs_confirmation") {
      expect(result.evicts.id).toBe("t-oldest");
      expect(result.evicts.title).toBe("Oldest claim");
    }
    // The whole point: no write happened, so "No" costs the user nothing.
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("displaces the OLDEST save once confirmed, and keeps the conversation", async () => {
    fullToolbox();
    update.mockResolvedValue(thread("t-new", new Date("2026-08-09T00:00:00Z")));

    const result = await saveToToolbox({
      ownerUserId: "u1",
      threadId: "t-new",
      limit: 3,
      confirmed: true,
    });
    expect(result.status).toBe("saved");
    if (result.status === "saved") expect(result.evicted?.id).toBe("t-oldest");

    // Eviction clears toolbox membership only. The thread itself survives in
    // ordinary history — a user giving up a SLOT must not lose a CHAT.
    const evictionCall = update.mock.calls.find(
      ([args]) => (args as { where: { id: string } }).where.id === "t-oldest"
    );
    expect(evictionCall).toBeDefined();
    expect((evictionCall?.[0] as { data: { toolboxSavedAt: null } }).data).toEqual({
      toolboxSavedAt: null,
    });
  });

  it("re-saving an already-saved chat refreshes it instead of demanding an eviction", async () => {
    // Checked before capacity: otherwise a user at their limit would be told to
    // give something up in order to re-save a chat that is already saved.
    findFirst.mockResolvedValue(thread("t-1", new Date("2026-08-01T00:00:00Z")));
    update.mockResolvedValue(thread("t-1", new Date("2026-08-09T00:00:00Z")));

    const result = await saveToToolbox({ ownerUserId: "u1", threadId: "t-1", limit: 3 });
    expect(result.status).toBe("already_saved");
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("listing", () => {
  it("reports the plan as locked and queries nothing when there is no toolbox", async () => {
    const listing = await listToolbox("u1", 0);
    expect(listing).toEqual({
      entries: [],
      limit: 0,
      locked: true,
      slotsUsed: 0,
      slotsRemaining: 0,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("reports slots used and remaining so the UI can warn before the user commits", async () => {
    findMany.mockResolvedValue([
      thread("t-1", new Date("2026-08-08T00:00:00Z")),
      thread("t-2", new Date("2026-08-07T00:00:00Z")),
    ]);
    const listing = await listToolbox("u1", 3);
    expect(listing.slotsUsed).toBe(2);
    expect(listing.slotsRemaining).toBe(1);
    expect(listing.locked).toBe(false);
  });
});
