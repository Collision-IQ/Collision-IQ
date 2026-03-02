import { google } from "googleapis";

function getServiceAccount() {
  const raw = process.env.GOOGLE_SA_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SA_JSON");
  return JSON.parse(raw);
}

export function getDriveClient() {
  const sa = getServiceAccount();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.file",
    ],
    subject: process.env.GOOGLE_IMPERSONATE_SUBJECT,
  });

  return google.drive({ version: "v3", auth });
}
