'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Role = 'system' | 'user' | 'assistant';

type Message = {
  id: string;
  role: Role;
  content: string;
};

export type UploadedDocument = {
  id?: string;
  filename?: string;
  name?: string;
  type?: string;
  status?: string;
  text?: string;
};

export type ChatWidgetApi = {
  setDraft: (text: string) => void;
  sendDraft: () => void;
  sendText: (text: string) => void;
  openUpload: () => void;
  clearChat: () => void;
};

type Props = {
  onApiReady?: (api: ChatWidgetApi) => void;
  documents?: UploadedDocument[];
  onDocumentsChange?: (docs: UploadedDocument[]) => void;
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function ChatWidget({ onApiReady, documents = [], onDocumentsChange }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: uid(),
      role: 'assistant',
      content:
        "Hello! Upload an estimate, OEM procedure, or photo and I'll provide structured analysis for supplements, missing ops, and OEM-aligned steps.",
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const openUpload = () => fileInputRef.current?.click();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const api: ChatWidgetApi = useMemo(
    () => ({
      setDraft: (t) => setInput(t),
      sendDraft: () => {
        const t = input.trim();
        if (t) void sendText(t);
      },
      sendText: (t) => void sendText(t),
      openUpload,
      clearChat: () => {
        setMessages([
          {
            id: uid(),
            role: 'assistant',
            content:
              "Hello! Upload an estimate, OEM procedure, or photo and I'll provide structured analysis for supplements, missing ops, and OEM-aligned steps.",
          },
        ]);
        setError(null);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input]
  );

  useEffect(() => {
    onApiReady?.(api);
  }, [api, onApiReady]);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setError(null);

    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append('files', f));

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Upload failed (${res.status})`);
      }
      const data = await res.json();

      const newDocs: UploadedDocument[] =
        data?.documents ??
        data?.docs ??
        Array.from(files).map((f) => ({ filename: f.name, type: f.type, status: 'ready' }));

      onDocumentsChange?.(newDocs);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || 'Upload failed');
      // keep chat usable even if upload fails
      console.error(e);
    }
  }

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setError(null);
    setSending(true);

    const userMsg: Message = { id: uid(), role: 'user', content: trimmed };
    const assistantId = uid();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '' };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // keep compatibility: message is always present; docs are optional
        body: JSON.stringify({
          message: trimmed,
          documents,
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Chat request failed (${res.status})`);
      }

      if (!res.body) throw new Error('No response body (streaming unavailable).');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m))
        );
      }
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)) || 'Something went wrong.';
      setError(msg);

      // remove empty assistant placeholder if nothing came back
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === 'assistant' && last.content.trim() === '') copy.pop();
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header bar */}
      <div className="shrink-0 border-b border-white/10 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Collision-IQ</div>
            <div className="text-xs text-white/60">Workspace mode — uploads + context stay in sync.</div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/60">
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">Streaming</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">OEM-aware</span>
          </div>
        </div>
      </div>

      {/* Message list (THIS is what must scroll; container height is fixed) */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={[
                'max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed',
                m.role === 'user'
                  ? 'ml-auto bg-[#ff6a1a]/90 text-black'
                  : 'mr-auto bg-white/10 text-white',
              ].join(' ')}
            >
              {m.content}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      {/* Footer (fixed) */}
      <div className="shrink-0 border-t border-white/10 px-5 py-4">
        {/* hidden input used by BOTH center + external panels */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept=".pdf,.doc,.docx,image/*"
          title="Upload documents"
          onChange={(e) => {
            const files = e.currentTarget.files;
            // reset so same file can be selected again
            e.currentTarget.value = '';
            void uploadFiles(files);
          }}
        />

        <button
          type="button"
          onClick={openUpload}
          className="mb-3 w-full rounded-xl bg-[#ff6a1a] px-4 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-60"
          disabled={sending}
        >
          Upload documents
        </button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendText(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/20"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
