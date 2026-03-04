import { drive_v3 } from "googleapis";

export async function extractDriveText(drive: drive_v3.Drive, file: drive_v3.Schema$File) {
  const mime = file.mimeType || "";
  const id = file.id!;
  const name = file.name || "Untitled";

  // Google Doc → export plain text
  if (mime === "application/vnd.google-apps.document") {
    const res = await drive.files.export(
      { fileId: id, mimeType: "text/plain" },
      { responseType: "text" }
    );
    return {
      ok: true as const,
      text: String(res.data || ""),
      kind: "gdoc" as const,
      name,
    };
  }

  // Skip everything else for v1
  return { ok: false as const, reason: `Unsupported mimeType: ${mime}`, name };
}