import { createOneDriveClient, ingestOneDriveSource } from "./shared";
import { ingestDocument } from "@/lib/rag/ingestDocument";

export const client2 = createOneDriveClient("ONEDRIVE_2");

export async function ingestOneDrive2() {
  return ingestOneDriveSource({
    client: client2,
    sourceType: "onedrive2",
    ingestDocument,
  });
}
