'use client';

import { useRef, useState } from 'react';
import ChatShell from '@/components/ChatShell';
import ChatWidget, { type ChatWidgetApi, type UploadedDocument } from '@/components/ChatWidget';

export default function ChatbotPage() {
  const apiRef = useRef<ChatWidgetApi | null>(null);
  const [docs, setDocs] = useState<UploadedDocument[]>([]);

  return (
    <ChatShell
      left={
        <div className="flex h-full flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Collision Academy</div>
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
          </div>

          <button
            className="w-full rounded-xl bg-[#ff6a1a] px-4 py-2.5 text-sm font-semibold text-black hover:opacity-90"
            onClick={() => apiRef.current?.openUpload()}
          >
            Upload docs
          </button>

          <div className="text-[11px] tracking-wide text-white/50">QUICK PROMPTS</div>

          <div className="grid gap-2">
            {[
              'Analyze this estimate for missing ops & likely supplements.',
              'Summarize OEM procedure implications & safety-critical steps.',
              'Identify ADAS triggers, required scans, and calibrations.',
              'Draft a neutral insurer message requesting OEM-aligned steps.',
            ].map((t) => (
              <button
                key={t}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm text-white/90 hover:bg-white/10"
                onClick={() => apiRef.current?.sendText(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-auto">
            <div className="text-[11px] tracking-wide text-white/50">TOOLS</div>
            <div className="mt-2 flex gap-2">
              <button
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                onClick={() => apiRef.current?.sendText('Create a claim dispute checklist for this repair.')}
              >
                Claim dispute checklist
              </button>
              <button
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                onClick={() => apiRef.current?.sendText('Explain policy vs insurance law considerations for this situation.')}
              >
                Policy vs insurance law
              </button>
            </div>
          </div>
        </div>
      }
      center={
        <ChatWidget
          documents={docs}
          onDocumentsChange={(newDocs) => setDocs(newDocs)}
          onApiReady={(api) => {
            apiRef.current = api;
          }}
        />
      }
      right={
        <div className="flex h-full flex-col gap-4">
          <div>
            <div className="text-sm font-semibold">Workspace</div>
            <div className="text-xs text-white/60">Uploaded documents available to the assistant</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs font-semibold text-white/80">Uploaded documents</div>
            <div className="mt-2 space-y-2">
              {docs.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/50">
                  No documents uploaded yet.
                </div>
              ) : (
                docs.map((d, idx) => (
                  <div
                    key={(d.id ?? d.filename ?? d.name ?? String(idx)) + idx}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <div className="text-xs text-white/80">{d.filename ?? d.name ?? `Document ${idx + 1}`}</div>
                    <div className="mt-1 text-[11px] text-white/50">
                      {(d.type ?? '').slice(0, 50) || 'document'}{' '}
                      {d.status ? `• ${d.status}` : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-auto flex gap-2">
            <button
              className="flex-1 rounded-xl bg-[#ff6a1a] px-4 py-2.5 text-sm font-semibold text-black hover:opacity-90"
              onClick={() => apiRef.current?.openUpload()}
            >
              Upload documents
            </button>
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10"
              onClick={() => {
                setDocs([]);
                apiRef.current?.clearChat();
              }}
            >
              Clear
            </button>
          </div>
        </div>
      }
    />
  );
}
