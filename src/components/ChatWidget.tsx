'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import FileUpload from './FileUpload';
import type { UploadedDocument } from '@/types/uploadedDocument';

type Role = 'system' | 'user' | 'assistant';
type Message = { role: Role; content: string };

export default function ChatWidget() {
  const { theme } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [docs, setDocs] = useState<UploadedDocument[]>([]);
  const [sending, setSending] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const systemDocs = useMemo<Message[]>(
    () =>
      docs.length
        ? [
            {
              role: 'system',
              content: `
The user uploaded the following documents:

${docs
  .map(
    (d) =>
      `--- ${d.filename} (${d.type}) ---\n${d.text.slice(0, 12000)}`
  )
  .join('\n\n')}

Rules:
- Treat OEM procedures as manufacturer guidance, not legal advice
- Insurance policy language varies by carrier and state
- Ask if pages appear missing or incomplete
`,
            },
          ]
        : [],
    [docs]
  );

  async function sendMessage() {
    if (!input.trim() || sending) return;
    setSending(true);

    const userMsg: Message = { role: 'user', content: input };
    setMessages((m) => [...m, userMsg]);
    setInput('');

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [...systemDocs, ...messages, userMsg],
      }),
    });

    const data = await res.json();
    setMessages((m) => [...m, { role: 'assistant', content: data.message }]);
    setSending(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] px-3 py-2 rounded text-sm ${
              m.role === 'user'
                ? 'ml-auto bg-orange-600 text-white'
                : 'bg-black/5 dark:bg-white/10'
            }`}
          >
            {m.content}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t p-3 space-y-2">
        <FileUpload onUploadComplete={setDocs} />

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 rounded px-3 py-2 text-sm bg-white dark:bg-[#111827]"
            placeholder="Ask a question…"
          />
          <button
            onClick={sendMessage}
            disabled={sending}
            className="rounded px-4 bg-blue-600 text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
