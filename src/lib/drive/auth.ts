import { google } from "googleapis";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function getImpersonatedAuth() {
  const b64 = requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
  const impersonationUser = requireEnv("GOOGLE_IMPERSONATION_USER");

  // Decode JSON safely
  const jsonStr = Buffer.from(b64, "base64").toString("utf8");
  const creds = JSON.parse(jsonStr);

  const clientEmail = creds.client_email as string;
  const privateKeyRaw = creds.private_key as string;

  if (!clientEmail || !privateKeyRaw) {
    throw new Error("Service account JSON missing client_email or private_key");
  }

  // Normalize newlines regardless of platform
  const privateKey = privateKeyRaw.replace(/\r/g, "");

  const scopes = ["https://www.googleapis.com/auth/drive"];

  const jwt = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes,
    subject: impersonationUser,
  });

  await jwt.authorize();
  return jwt;
}