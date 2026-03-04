'use client';

import { useRef, useState } from 'react';

type DocType = 'both' | 'procedure' | 'position_statement';

export default function ProcedureSearch() {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [docType, setDocType] = useState<DocType>('both');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!make.trim() && !query.trim()) return;

    setLoading(true);
    setResult('');
    setError('');

    try {
      const res = await fetch('/api/procedures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ make, model, year, docType, query }),
      });

      if (!res.ok || !res.body) {
        setError('Error contacting the procedures search service. Please try again.');
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setResult(text);
      }

      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
      console.error('Procedure search error:', err);
    } finally {
      setLoading(false);
    }
  }

  const docTypeOptions: { value: DocType; label: string }[] = [
    { value: 'both', label: 'Procedures & Statements' },
    { value: 'procedure', label: 'OE Procedures' },
    { value: 'position_statement', label: 'Position Statements' },
  ];

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearch} className="space-y-4">
        {/* Vehicle fields */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="make"
              className="mb-1 block text-sm font-medium text-[color:var(--muted)]"
            >
              Make
            </label>
            <input
              id="make"
              type="text"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="e.g. Toyota, Honda, Ford"
              className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="model"
              className="mb-1 block text-sm font-medium text-[color:var(--muted)]"
            >
              Model
            </label>
            <input
              id="model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. Camry, Civic, F-150"
              className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="year"
              className="mb-1 block text-sm font-medium text-[color:var(--muted)]"
            >
              Year
            </label>
            <input
              id="year"
              type="text"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2022"
              className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Document type toggle */}
        <div>
          <div className="mb-1 text-sm font-medium text-[color:var(--muted)]">
            Document Type
          </div>
          <div className="flex flex-wrap gap-2">
            {docTypeOptions.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setDocType(value)}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                  docType === value
                    ? 'border-[color:var(--accent)] bg-[color:var(--accent)] text-black'
                    : 'border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--muted)] hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Free-text query */}
        <div>
          <label
            htmlFor="query"
            className="mb-1 block text-sm font-medium text-[color:var(--muted)]"
          >
            Repair Topic or Component{' '}
            <span className="text-[color:var(--muted)] font-normal">(optional if make is provided)</span>
          </label>
          <input
            id="query"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. quarter panel replacement, ADAS calibration, structural repair"
            className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={loading || (!make.trim() && !query.trim())}
          className="rounded-xl bg-[color:var(--accent)] px-6 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search Procedures'}
        </button>
      </form>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div
          ref={resultRef}
          className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5"
        >
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Results
          </div>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{result}</div>
        </div>
      )}
    </div>
  );
}
