import { prisma } from "@/lib/prisma";

export type DatabaseUrlDiagnostic = {
  present: boolean;
  host: string | null;
  pooled: boolean | null;
  neon: boolean;
};

export type DatabaseEnvironmentDiagnostics = {
  DATABASE_URL: DatabaseUrlDiagnostic;
  DIRECT_URL: DatabaseUrlDiagnostic;
  DATABASE_URL_UNPOOLED: DatabaseUrlDiagnostic;
};

export type DatabaseHealthResult = {
  env: DatabaseEnvironmentDiagnostics;
  prisma: {
    ok: boolean;
    error: {
      name: string;
      message: string;
      code?: string | number;
    } | null;
  };
};

const DB_HEALTH_TIMEOUT_MS = 4500;

export function getDatabaseUrlDiagnostic(value?: string | null): DatabaseUrlDiagnostic {
  const trimmed = value?.trim();
  if (!trimmed) {
    return {
      present: false,
      host: null,
      pooled: null,
      neon: false,
    };
  }

  try {
    const url = new URL(trimmed);
    return {
      present: true,
      host: url.host,
      pooled: /-pooler\./i.test(url.host),
      neon: /\.neon\.tech$/i.test(url.host),
    };
  } catch {
    return {
      present: true,
      host: "[unparseable]",
      pooled: null,
      neon: false,
    };
  }
}

export function getDatabaseEnvironmentDiagnostics(): DatabaseEnvironmentDiagnostics {
  return {
    DATABASE_URL: getDatabaseUrlDiagnostic(process.env.DATABASE_URL),
    DIRECT_URL: getDatabaseUrlDiagnostic(process.env.DIRECT_URL),
    DATABASE_URL_UNPOOLED: getDatabaseUrlDiagnostic(process.env.DATABASE_URL_UNPOOLED),
  };
}

export async function checkDatabaseHealth(): Promise<DatabaseHealthResult> {
  const env = getDatabaseEnvironmentDiagnostics();

  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DB_HEALTH_TIMEOUT_MS);
    return {
      env,
      prisma: {
        ok: true,
        error: null,
      },
    };
  } catch (error) {
    return {
      env,
      prisma: {
        ok: false,
        error: sanitizeDatabaseErrorForLog(error),
      },
    };
  }
}

export function isDatabaseUnavailableError(error: unknown) {
  const details = sanitizeDatabaseErrorForLog(error);
  const message = details.message.toLowerCase();
  const code = String(details.code ?? "").toLowerCase();
  return (
    details.name === "PrismaClientInitializationError" ||
    code === "p1001" ||
    message.includes("can't reach database server") ||
    message.includes("database server") ||
    message.includes("connection") && message.includes("database")
  );
}

export function sanitizeDatabaseErrorForLog(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof record.code === "string" || typeof record.code === "number"
    ? record.code
    : undefined;

  return {
    name: error instanceof Error ? error.name : typeof error,
    message: sanitizeDatabaseErrorMessage(message),
    ...(code ? { code } : {}),
  };
}

function sanitizeDatabaseErrorMessage(message: string) {
  let sanitized = message.replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, "postgres://[redacted]");
  for (const value of [
    process.env.DATABASE_URL,
    process.env.DIRECT_URL,
    process.env.DATABASE_URL_UNPOOLED,
  ]) {
    if (value) {
      sanitized = sanitized.split(value).join("[redacted-db-url]");
    }
  }
  return sanitized;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(Object.assign(new Error("Database health check timed out."), {
        code: "DB_HEALTH_TIMEOUT",
      }));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
