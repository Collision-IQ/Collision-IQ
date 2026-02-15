import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function fileToText(file: File): Promise<string> {
  const type = file.type || "";

  if (type.includes("text")) {
    return await file.text();
  }

  // Placeholder for PDFs/images
  return `[[No extractor configured for ${type || "unknown type"}: ${file.name}]]`;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file received" },
        { status: 400 }
      );
    }

    const text = await fileToText(file);

    return NextResponse.json({
      filename: file.name,
      type: file.type,
      text,
    });
  } catch (error) {
    console.error("UPLOAD ERROR:", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
