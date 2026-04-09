import { google } from "googleapis";
import {
  getDriveImpersonationSubject,
  getDriveServiceAccountCredentials,
} from "@/lib/drive/auth";

function getServiceAccount() {
  return getDriveServiceAccountCredentials();
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
    subject: getDriveImpersonationSubject(),
  });

  return google.drive({ version: "v3", auth });
}
