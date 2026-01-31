// src/app/api/chat/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'edge'; // Enable edge runtime for low latency

export async function POST(req: Request) {
  const { message } = await req.json();

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant for Collision Academy.' },
        { role: 'user', content: message },
      ],
      temperature: 0.7,
      stream: true,
    }),
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk
          .split('\n')
          .filter((line) => line.trim().startsWith('data: '))
          .map((line) => line.replace(/^data: /, ''));

        for (const line of lines) {
          if (line === '[DONE]') {
            controller.close();
            return;
          }

          try {
            const json = JSON.parse(line);
            const token = json.choices?.[0]?.delta?.content || '';
            fullText += token;
            controller.enqueue(encoder.encode(token));
          } catch (e) {
            console.error('JSON parse error', e);
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}
