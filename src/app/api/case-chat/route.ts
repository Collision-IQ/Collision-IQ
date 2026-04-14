import { NextResponse } from "next/server";
import type { ExportModel } from "@/lib/ai/builders/buildExportModel";
import { buildCaseAwareSystemPrompt } from "@/lib/ai/builders/buildCaseAwareMessages";
import type {
  CaseContextExport,
  CaseContextFile,
} from "@/lib/context/buildCaseContext";
import { buildCaseContext } from "@/lib/context/buildCaseContext";

async function generateCaseAwareReply(params: {
  systemPrompt: string;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<string> {
  const { systemPrompt, message } = params;
  void params.history;

  return [
    "Using the existing case context:",
    "",
    "System context loaded.",
    "",
    `Direct answer: ${message}`,
    "",
    "The current case remains anchored to the uploaded files, extracted facts, transcript summary, and prior determination.",
    "",
    "Next step: wire this function into your existing AI/chat helper so the assistant response is model-generated instead of placeholder text.",
    "",
    "---",
    systemPrompt,
  ].join("\n");
}

type CaseChatRequest = {
  message?: string;
  intent?: string | null;
  exportModel?: ExportModel | null;
  transcriptSummary?: string | null;
  uploadedFiles?: CaseContextFile[] | null;
  exports?: CaseContextExport[] | null;
  history?: Array<{ role: "user" | "assistant"; content: string }> | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CaseChatRequest;

    if (!body.message?.trim()) {
      return NextResponse.json(
        { error: "Missing follow-up message." },
        { status: 400 }
      );
    }

    if (!body.exportModel) {
      return NextResponse.json(
        { error: "Missing export model context." },
        { status: 400 }
      );
    }

    const caseContext = buildCaseContext({
      intent: body.intent,
      exportModel: body.exportModel,
      transcriptSummary: body.transcriptSummary,
      uploadedFiles: body.uploadedFiles,
      exports: body.exports,
    });

    const systemPrompt = buildCaseAwareSystemPrompt(caseContext);

    const reply = await generateCaseAwareReply({
      systemPrompt,
      message: body.message,
      history: body.history ?? [],
    });

    return NextResponse.json({
      reply,
      caseContext,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to continue case chat.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
