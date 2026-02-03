'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import FileUpload from './FileUpload';
import type { UploadedDocument } from '@/types/uploadedDocument';

type Role = 'system' | 'user' | 'assistant';
type Message = { role: Role; content: string };

export default function ChatWidget() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [docs, setDocs] = useState<UploadedDocument[]>([]);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * SYSTEM DOC CONTEXT (SAFE, SIZE-LIMITED)
   * This is where uploaded document text is injected.
   */
  const systemDocs = useMemo<Message[]>(() => {
    if (!docs.length) return [];

    const joined = docs
      .map(
        (d) =>
          `--- ${d.filename} (${d.type}) ---\n${d.text.slice(0, 8000)}`
      )
      .join('\n\n');

    return [
      {
        role: 'system',
        content: `
The user uploaded documents. Use them as reference material.

${joined}

Rules:
- OEM procedures are guidance, not legal advice
- Insurance policy language varies by state and carrier
- Ask for missing pages if context appears incomplete
`.trim(),
      },
    ];
  }, [docs]);

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

    if (!res.ok || !res.body) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'Error contacting assistant.' },
      ]);
      setSending(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let assistantText = '';

    setMessages((m) => [...m, { role: 'assistant', content: '' }]);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      assistantText += decoder.decode(value, { stream: true });

      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: 'assistant',
          content: assistantText,
        };
        return copy;
      });
    }

    setSending(false);
  }

  return (
    <div className="flex flex-col h-full bg-black text-white">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] px-3 py-2 rounded text-sm whitespace-pre-wrap ${
              m.role === 'user'
                ? 'ml-auto bg-orange-600 text-white'
                : 'bg-white/10 text-white'
            }`}
          >
            {m.content}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="border-t border-white/10 p-3 space-y-2">
        <FileUpload onUploadComplete={setDocs} />

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 rounded px-3 py-2 text-sm bg-[#111827] text-white"
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
// This component implements a chat widget that allows users to upload documents
// and interact with an AI assistant. Uploaded documents are processed and their
// content is used to provide context for the chat responses. The chat interface
// supports streaming responses for a more dynamic user experience. The component
// is styled for a dark theme and includes file upload functionality.