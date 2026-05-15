import { google } from "googleapis";
import {
  getDriveImpersonationSubject,
  getDriveServiceAccountCredentials,
} from "@/lib/drive/auth";

type SendMailParams = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

function toAddressList(value: string | string[]) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildRawMessage(params: SendMailParams) {
  const lines = [
    `From: ${getDriveImpersonationSubject()}`,
    `To: ${toAddressList(params.to)}`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ${params.subject}`,
    "",
    params.html ??
      `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(
        params.text
      )}</pre>`,
  ];

  return Buffer.from(lines.join("\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function sendMail(params: SendMailParams) {
  const credentials = getDriveServiceAccountCredentials();
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key.replace(/\r/g, ""),
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: getDriveImpersonationSubject(),
  });

  await auth.authorize();

  const gmail = google.gmail({ version: "v1", auth });
  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: buildRawMessage(params),
    },
  });
}
