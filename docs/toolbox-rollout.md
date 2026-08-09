# Toolbox Rollout

The Toolbox lets a user deliberately keep a chat and pick it back up later, with
the documents and photos that were uploaded to it. It is distinct from History:
History is a passive recency window over autosaved threads, the Toolbox is an
act of keeping, and nothing leaves it without the user's confirmation.

## Slots

| Plan | Slots |
| --- | --- |
| Free / none | 0 — the Toolbox is not offered at all |
| Starter | 3 |
| Pro (and trial) | 10 |
| Team / Admin / platform admin | 20 |

Set in `toolboxSlotLimit` (`src/lib/featureAccess.ts`). Every value must stay at
or below `MAX_THREADS_PER_USER` (30), the storage prune ceiling — a slot count
above it is a number the system can never deliver. A test asserts this.

## Migration — required before the feature works at all

`20260809060000_add_chat_thread_toolbox`

```sql
ALTER TABLE "ChatThread" ADD COLUMN "toolboxSavedAt" TIMESTAMP(3);
CREATE INDEX "ChatThread_ownerUserId_toolboxSavedAt_idx"
  ON "ChatThread"("ownerUserId", "toolboxSavedAt");
```

Apply it with:

```bash
npm run db:migrate     # prisma migrate deploy
```

Until this runs, every Toolbox request fails: the queries filter on a column
the database does not have. Nothing else in the feature can be tested first.

**The migration is additive and safe on a live table.** One nullable column and
one index; no data is rewritten and no existing query changes meaning. Existing
rows stay `NULL`, which is exactly what makes the Toolbox start empty for
everyone rather than back-filling itself with whatever happened to be in
History.

### Why this is not wired into `npm run build`

`build` is `prisma generate && next build`, and deliberately does not run
migrations. Two reasons, and the second is the one that matters:

1. A failing `migrate deploy` would block every deploy, including deploys that
   have nothing to do with the schema.
2. This repository has 25 migrations and no automated apply step, so the state
   of `_prisma_migrations` in production is not known from the repository
   alone. If earlier schema changes were applied by other means, a first
   `migrate deploy` could try to replay migrations that are already present.
   **Check `migrate status` before `migrate deploy` on a database that has
   never had migrations applied through Prisma:**

```bash
npx prisma migrate status
```

If it reports migrations as not applied that clearly already exist in the
schema, resolve them as already-applied rather than replaying them:

```bash
npx prisma migrate resolve --applied <migration_name>
```

## Post-migration verification

Nothing below has been exercised against a real database — no database exists
in the build environment, so the store is covered only by unit tests against a
mocked Prisma client. Run this once after migrating:

1. Open a chat, upload an estimate, let autosave fire (~2s).
2. Toolbox → **Save current chat**. It appears with a file count.
3. Fill every slot, then save one more. The overlay must name the **oldest**
   saved chat.
4. Click **No, keep it**. Nothing changes — the server writes nothing until the
   confirmation returns, so declining must cost the user nothing.
5. Save again, tick **Don't ask again**, click **Yes, replace it**. The oldest
   is displaced; the next save proceeds without prompting.
6. Confirm the displaced chat still exists in History. Eviction frees a slot; it
   does not delete a conversation.
7. **Open** a saved chat. The transcript returns and the attachment tray
   repopulates with the original files.

## Rollback

Removing the column is safe and loses only toolbox membership, not chats:

```sql
DROP INDEX IF EXISTS "ChatThread_ownerUserId_toolboxSavedAt_idx";
ALTER TABLE "ChatThread" DROP COLUMN IF EXISTS "toolboxSavedAt";
```

Every saved chat survives as an ordinary thread in History, subject to the
normal recency window and prune.

## Related retention rules

Threads exempt from the autosave LRU prune (`saveChatThread`):

- **Case-linked** threads — a claim's chat spans months of supplement and
  appraisal phases and must not be evicted by unrelated chat volume.
- **Toolbox-saved** threads — the Toolbox promises that displacing a saved chat
  requires the user's confirmation, and an autosave quietly deleting one would
  break that promise from a different code path entirely.
