// /api/chat/route.ts

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body?.message || typeof body.message !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request: message is required.' },
        { status: 400 }
      );
    }

    const userMessage = body.message.trim();

    // ✅ Mock response — replace with OpenAI integration later
    const reply = `You said: ${userMessage}`;

    return NextResponse.json({ message: reply });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
