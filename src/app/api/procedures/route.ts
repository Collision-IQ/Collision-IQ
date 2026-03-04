import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ProcedureSearchBody = {
  make?: string;
  model?: string;
  year?: string;
  docType?: string;
  query?: string;
};

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  let body: ProcedureSearchBody = {};
  try {
    body = await req.json();
  } catch (err) {
    console.error("Failed to parse request body:", err);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { make, model, year, docType, query } = body;

  if (!make?.trim() && !query?.trim()) {
    return NextResponse.json(
      { error: "Provide at least a vehicle make or a search query" },
      { status: 400 }
    );
  }

  const vehicleInfo = [year, make, model].filter(Boolean).join(" ");

  const typeLabel =
    docType === "position_statement"
      ? "OEM position statements"
      : docType === "procedure"
      ? "OE repair procedures"
      : "OE repair procedures and OEM position statements";

  const systemPrompt = `You are an OE (Original Equipment) procedures and position statements expert for Collision-IQ.

Your role is to help automotive repair professionals find and understand manufacturer repair procedures and OEM position statements.

When responding, provide:
1. A summary of the relevant OE repair requirements for the specified vehicle and repair topic
2. Critical safety steps, ADAS calibration requirements, or special materials/tools called out by the OEM
3. Any known OEM position statements that apply (e.g., Honda's no-sectioning policy on certain structural rails, Toyota's position on pre/post scan requirements)
4. Where to find the official documentation: OEM1Stop (oem1stop.com), I-CAR, manufacturer service portals (e.g., TIS for Toyota, Mopar for FCA, Service.GMC.com, ALLDATA, Mitchell)
5. Common estimating pitfalls for this repair type that result in underpayment

Important:
- This is educational guidance only — not legal advice
- Users must verify requirements against the official manufacturer documentation for their specific VIN, model year, and trim level
- OEM procedures and position statements take precedence over estimating software defaults
- Be specific about what is REQUIRED versus RECOMMENDED`.trim();

  const userPrompt = vehicleInfo
    ? `Search for ${typeLabel} for a ${vehicleInfo}${query?.trim() ? `. Specifically: ${query.trim()}` : "."}`
    : `Search for ${typeLabel}: ${query?.trim() ?? ""}`;

  const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return NextResponse.json(
      { error: "OpenAI request failed", details: text },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            if (!part.startsWith("data:")) continue;
            const data = part.replace(/^data:\s*/, "");
            if (data === "[DONE]") {
              controller.close();
              return;
            }

            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // ignore malformed chunks
            }
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
