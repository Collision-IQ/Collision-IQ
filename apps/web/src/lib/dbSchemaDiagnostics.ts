import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type QueryClient = {
  $queryRaw: typeof prisma.$queryRaw;
};

type DbContextRow = {
  current_database: string | null;
  current_schema: string | null;
  current_user: string | null;
};

type ColumnRow = {
  table_schema: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
};

const UPLOADED_ATTACHMENT_MODEL = "UploadedAttachment";
const CLASSIFICATION_FIELD = "classification";

let uploadedAttachmentSchemaWarningStarted = false;

export function getDatabaseUrlHostOnly(raw = process.env.DATABASE_URL?.trim()) {
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).host;
  } catch {
    return "[unparseable]";
  }
}

export function getPrismaModelFields(modelName = UPLOADED_ATTACHMENT_MODEL) {
  return (
    Prisma.dmmf.datamodel.models
      .find((model) => model.name === modelName)
      ?.fields.map((field) => ({
        name: field.name,
        kind: field.kind,
        type: field.type,
        isRequired: field.isRequired,
        isList: field.isList,
      })) ?? []
  );
}

export async function getUploadedAttachmentSchemaDiagnostics(client: QueryClient = prisma) {
  const contextRows = await client.$queryRaw<DbContextRow[]>`
    SELECT
      current_database() AS current_database,
      current_schema() AS current_schema,
      current_user AS current_user
  `;

  const columnRows = await client.$queryRaw<ColumnRow[]>`
    SELECT table_schema, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'UploadedAttachment'
    ORDER BY table_schema ASC, ordinal_position ASC
  `;

  const prismaFields = getPrismaModelFields();
  const columnNames = columnRows.map((row) => row.column_name);
  const prismaFieldNames = prismaFields.map((field) => field.name);

  return {
    dbContext: {
      currentDatabase: contextRows[0]?.current_database ?? null,
      currentSchema: contextRows[0]?.current_schema ?? null,
      currentUser: contextRows[0]?.current_user ?? null,
      databaseUrlHost: getDatabaseUrlHostOnly(),
      connectionSource: "Prisma DATABASE_URL runtime",
    },
    uploadedAttachment: {
      hasClassificationColumn: columnNames.includes(CLASSIFICATION_FIELD),
      prismaExpectsClassification: prismaFieldNames.includes(CLASSIFICATION_FIELD),
      columns: columnRows.map((row) => ({
        schema: row.table_schema,
        name: row.column_name,
        dataType: row.data_type,
        nullable: row.is_nullable === "YES",
      })),
      columnNames,
      tableSchemas: Array.from(new Set(columnRows.map((row) => row.table_schema))),
      prismaModelFields: prismaFields,
    },
  };
}

export function warnIfUploadedAttachmentSchemaMismatch(client: QueryClient = prisma) {
  if (
    uploadedAttachmentSchemaWarningStarted ||
    process.env.COLLISION_IQ_DISABLE_SCHEMA_WARNING === "1" ||
    !process.env.DATABASE_URL
  ) {
    return;
  }

  uploadedAttachmentSchemaWarningStarted = true;

  void getUploadedAttachmentSchemaDiagnostics(client)
    .then((diagnostics) => {
      if (
        diagnostics.uploadedAttachment.prismaExpectsClassification &&
        !diagnostics.uploadedAttachment.hasClassificationColumn
      ) {
        console.warn("[db-schema-check] UploadedAttachment schema mismatch", {
          prismaModel: UPLOADED_ATTACHMENT_MODEL,
          missingColumn: CLASSIFICATION_FIELD,
          databaseUrlHost: diagnostics.dbContext.databaseUrlHost,
          currentDatabase: diagnostics.dbContext.currentDatabase,
          currentSchema: diagnostics.dbContext.currentSchema,
        });
      }
    })
    .catch((error) => {
      console.warn("[db-schema-check] UploadedAttachment schema warning failed", {
        message: error instanceof Error ? error.message : "Unknown error",
        databaseUrlHost: getDatabaseUrlHostOnly(),
      });
    });
}
