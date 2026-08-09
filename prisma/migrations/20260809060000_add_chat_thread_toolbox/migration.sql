-- Toolbox membership for saved chats.
-- Nullable timestamp: presence = saved, value = save time (also the eviction
-- order once the plan's slots are full). Existing threads stay NULL, which is
-- what makes the toolbox contain only chats saved from this point forward.
ALTER TABLE "ChatThread" ADD COLUMN "toolboxSavedAt" TIMESTAMP(3);

CREATE INDEX "ChatThread_ownerUserId_toolboxSavedAt_idx"
  ON "ChatThread"("ownerUserId", "toolboxSavedAt");
