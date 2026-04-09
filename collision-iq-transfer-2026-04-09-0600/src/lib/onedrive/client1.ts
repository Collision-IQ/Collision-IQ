import { createOneDriveClient, ingestOneDriveSource } from "./shared";
import { ingestDocument } from "@/lib/rag/ingestDocument";

export const client1 = createOneDriveClient("ONEDRIVE_1");

export async function ingestOneDrive1() {
  return ingestOneDriveSource({
    client: client1,
    sourceType: "onedrive1",
    ingestDocument,
  });
}
