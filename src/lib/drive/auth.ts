import { google } from "googleapis";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Uses Service Account + Domain Wide Delegation impersonation
export async function getImpersonatedAuth() {
  const clientEmail = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKeyRaw = requireEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  const impersonationUser = requireEnv("GOOGLE_IMPERSONATION_USER");

  // Handle Vercel-style newline escaping
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  const scopes = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.readonly",
  ];

  const jwt = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes,
    subject: impersonationUser,
  });

  await jwt.authorize();
  return jwt;
}