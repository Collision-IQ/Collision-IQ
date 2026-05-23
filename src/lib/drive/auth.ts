import { google } from "googleapis";

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
};

function getServiceAccountConfig(): {
  credentials: ServiceAccountCredentials;
  credentialEnv: "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64" | "GOOGLE_SA_JSON";
} {
  const base64Json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const rawJson = process.env.GOOGLE_SA_JSON?.trim();

  let credentialEnv: "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64" | "GOOGLE_SA_JSON";
  let jsonStr: string;

  if (base64Json) {
    credentialEnv = "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64";
    jsonStr = Buffer.from(base64Json, "base64").toString("utf8");
  } else if (rawJson) {
    credentialEnv = "GOOGLE_SA_JSON";
    jsonStr = rawJson;
  } else {
    throw new Error(
      "Missing service account env var: GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or GOOGLE_SA_JSON"
    );
  }

  const parsed = JSON.parse(jsonStr) as Partial<ServiceAccountCredentials>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Service account JSON missing client_email or private_key");
  }

  console.info("[drive-auth]", {
    credentialEnv,
    subjectEnv: resolveImpersonationSubject().envName,
    driveEnv: process.env.GOOGLE_SHARED_DRIVE_ID ? "GOOGLE_SHARED_DRIVE_ID" : null,
  });

  return {
    credentials: {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    },
    credentialEnv,
  };
}

function resolveImpersonationSubject(): {
  value: string;
  envName: "GOOGLE_IMPERSONATION_USER" | "GOOGLE_IMPERSONATE_SUBJECT";
} {
  const impersonationUser = process.env.GOOGLE_IMPERSONATION_USER?.trim();
  if (impersonationUser) {
    return {
      value: impersonationUser,
      envName: "GOOGLE_IMPERSONATION_USER",
    };
  }

  const impersonationSubject = process.env.GOOGLE_IMPERSONATE_SUBJECT?.trim();
  if (impersonationSubject) {
    return {
      value: impersonationSubject,
      envName: "GOOGLE_IMPERSONATE_SUBJECT",
    };
  }

  throw new Error(
    "Missing impersonation env var: GOOGLE_IMPERSONATION_USER or GOOGLE_IMPERSONATE_SUBJECT"
  );
}

export function getDriveServiceAccountCredentials(): ServiceAccountCredentials {
  return getServiceAccountConfig().credentials;
}

export function getDriveImpersonationSubject(): string {
  return resolveImpersonationSubject().value;
}

export async function getImpersonatedAuth() {
  const creds = getDriveServiceAccountCredentials();
  const impersonationUser = getDriveImpersonationSubject();

  // Normalize newlines regardless of platform
  const privateKey = creds.private_key.replace(/\r/g, "");

  const scopes = ["https://www.googleapis.com/auth/drive"];

  const jwt = new google.auth.JWT({
    email: creds.client_email,
    key: privateKey,
    scopes,
    subject: impersonationUser,
  });

  await jwt.authorize();
  return jwt;
}

export const getDriveAuth = getImpersonatedAuth;
