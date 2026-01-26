'use client';

import { useState, useRef, useEffect } from 'react';
import { Message } from '@/lib/types'; // <-- ADD THIS

export default function ChatWidget() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
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

    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: input }),
        headers: { 'Content-Type': 'application/json' },
      });

      const { message: assistantReply } = await res.json();

      setMessages([...newMessages, { role: 'assistant', content: assistantReply }]);
    } catch (error: unknown) {
      console.error('Chat error:', error);
      setMessages([...newMessages, { role: 'system', content: 'Error: failed to get response.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black text-white">
      {/* Header with logo (optional) */}
      <div className="p-4">
        <img
          src="/brand/logos/Logo-white.png"
          alt="Collision Academy"
          className="h-10 w-auto mx-auto"
        />
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={msg.role === 'user' ? 'text-right' : 'text-left'}>
            <p className="text-sm font-semibold text-gray-400">{msg.role}</p>
            <p className="text-base">{msg.content}</p>
          </div>
        ))}
        <div ref={scrollRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-white/10 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 rounded bg-gray-800 text-white p-2"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) sendMessage();
            }}
            placeholder="Type your message..."
            disabled={loading}
          />
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
            onClick={sendMessage}
            disabled={loading}
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
