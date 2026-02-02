'use client';

import { useEffect, useRef, useState } from 'react';
import FileUpload, { UploadedFile } from './FileUpload';

type Role = 'system' | 'user' | 'assistant';
type Message = { role: Role; content: string };

export default function ChatWidget() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'Hello! I can help with OEM procedures, policy language, state regulations, and claim best practices.',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || sending) return;

    setSending(true);

    const systemDocs: Message[] =
      uploadedFiles.length > 0
        ? [
            {
              role: 'system',
              content: `
The user uploaded the following documents:

${uploadedFiles
  .map(
    (f) => `
--- ${f.filename} (${f.type}) ---
${f.text.slice(0, 12000)}
`
  )
  .join('\n')}

Rules:
- Treat OEM procedures as manufacturer guidance, not legal advice
- Insurance policy language varies by carrier and state
- If pages appear missing or incomplete, ask the user
`,
            },
          ]
        : [];

    const nextMessages: Message[] = [
      ...systemDocs,
      ...messages,
      { role: 'user', content: input },
    ];

    setMessages((m) => [...m, { role: 'user', content: input }]);
    setInput('');

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: nextMessages }),
    });

    const data = await res.json();

    setMessages((m) => [
      ...m,
      { role: 'assistant', content: data.content },
    ]);

    setSending(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              m.role === 'user'
                ? 'ml-auto bg-orange-500 text-black'
                : 'mr-auto bg-black/5 dark:bg-white/10'
            }`}
          >
            {m.content}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t p-3 space-y-2">
        <FileUpload onUploaded={setUploadedFiles} />

        <div className="flex gap-2">
          <input
            className="flex-1 rounded border px-3 py-2 text-sm"
            placeholder="Ask a question…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          />
          <button
            onClick={sendMessage}
            disabled={sending}
            className="rounded bg-blue-600 px-4 py-2 text-white text-sm disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
