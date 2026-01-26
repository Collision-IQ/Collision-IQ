'use client';

import { useState, useRef, useEffect } from 'react';

export default function ChatWidget() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([
    { role: 'system', content: 'How can I assist you today?' },
  ]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!loading) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    setInput('');

    try {
      const res = await fetch('/api/assignments/dummy/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: input }),
      });

      const data = await res.json();
      const assistantMessage = { role: 'assistant', content: data.message };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-black text-white">
      {/* Scrollable message area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm whitespace-pre-wrap ${
              m.role === 'user'
                ? 'text-blue-400 text-right'
                : m.role === 'assistant'
                ? 'text-green-400 text-left'
                : 'text-gray-400'
            }`}
          >
            <span className="font-semibold">{m.role}:</span> {m.content}
          </div>
        ))}
        {loading && (
          <div className="text-white text-sm italic">Assistant is typing...</div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-white/10 p-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Ask something..."
            className="flex-1 px-4 py-2 bg-white/5 border border-white/20 rounded text-white"
          />
          <button
            onClick={sendMessage}
            disabled={loading}
            className="px-4 py-2 bg-white text-black rounded"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
