-- 20261003120000 created document_chunks, where it was missing, in a shape
-- inferred from src/lib/rag (text id, chunk_index, metadata columns).
-- Production's table, which predates migrations, has a different shape:
-- id serial, content, embedding, file_id. That is the shape the app now
-- reads and writes, and the one schema.prisma declares.
--
-- On a database where 20261003120000 created the inferred table and nothing
-- has been stored in it (CI, a fresh environment), rebuild it in production's
-- shape. Anywhere else, production included, this does nothing.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'document_chunks'
      AND column_name = 'id'
      AND data_type = 'text'
  ) THEN
    IF EXISTS (SELECT 1 FROM "document_chunks") THEN
      RAISE NOTICE 'document_chunks has a text id and holds rows; left unchanged';
    ELSE
      DROP TABLE "document_chunks";
      CREATE TABLE "document_chunks" (
          "id" SERIAL NOT NULL,
          "content" TEXT,
          "embedding" vector,
          "file_id" TEXT,

          CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
      );
    END IF;
  END IF;
END $$;
