// app/widget/page.tsx
'use client';

import { useState } from 'react';

export default function ChatWidget() {
  const [messages, setMessages] = useState([
    { role: 'system', content: 'How can I assist you today?' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    const res = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: newMessages }),
      headers: { 'Content-Type': 'application/json' },
    });

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let gptResponse = '';

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      const chunk = decoder.decode(value);
      gptResponse += chunk;
      setMessages([...newMessages, { role: 'assistant', content: gptResponse }]);
    }

    setLoading(false);
  }

  return (
    <div className="h-screen w-screen bg-black text-white p-6 flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`text-sm ${m.role === 'user' ? 'text-blue-400' : 'text-green-400'}`}>
            <strong>{m.role}:</strong> {m.content}
          </div>
        ))}
      </div>
      <div className="mt-4 flex">
        <input
          className="flex-1 rounded-md border border-white/20 bg-white/5 px-4 py-2 text-white placeholder-white/30"
          placeholder="Ask a question..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          className="ml-2 rounded-md bg-white text-black px-4 py-2 font-semibold"
        >
          Send
        </button>
      </div>
    </div>
  );
}
