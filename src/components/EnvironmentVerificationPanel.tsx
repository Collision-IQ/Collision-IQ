"use client";

import { useState } from "react";

type VerificationStatus = "pass" | "fail" | "warn";

type VerificationResult = {
  key: string;
  label: string;
  status: VerificationStatus;
  details: string;
  metadata?: Record<string, unknown>;
  failedDependency?: {
    name: string;
    message: string;
    code?: string | number;
  };
};

type VerificationPayload = {
  ok: boolean;
  timestamp: string;
  environment: {
    nodeEnv: string | null;
    vercelEnv: string | null;
    vercelRegion: string | null;
    vercelUrl: string | null;
    gitCommitSha: string | null;
  };
  results: VerificationResult[];
};

export default function EnvironmentVerificationPanel() {
  const [payload, setPayload] = useState<VerificationPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runVerification() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/environment-verification", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = (await response.json()) as VerificationPayload | { error?: string };
      if (!response.ok && "error" in data) {
        setPayload(null);
        setError(data.error ?? `Verification failed (${response.status}).`);
        return;
      }
      setPayload(data as VerificationPayload);
    } catch (fetchError) {
      setPayload(null);
      setError(fetchError instanceof Error ? fetchError.message : "Verification request failed.");
    } finally {
      setLoading(false);
    }
  }

  const counts = payload
    ? {
        pass: payload.results.filter((result) => result.status === "pass").length,
        warn: payload.results.filter((result) => result.status === "warn").length,
        fail: payload.results.filter((result) => result.status === "fail").length,
      }
    : null;

  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-white/45">Admin</div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Environment Verification</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
            Checks production dependencies, masks secrets, and reports failed dependency details.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runVerification()}
          disabled={loading}
          className="rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[var(--accent)]/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Running..." : "Run verification"}
        </button>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {payload ? (
        <div className="mt-6 space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <MiniStat label="Overall" value={payload.ok ? "Pass" : "Attention"} tone={payload.ok ? "pass" : "fail"} />
            <MiniStat label="Passed" value={String(counts?.pass ?? 0)} tone="pass" />
            <MiniStat label="Warnings" value={String(counts?.warn ?? 0)} tone="warn" />
            <MiniStat label="Failed" value={String(counts?.fail ?? 0)} tone="fail" />
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-white/45">Deployment</div>
            <div className="mt-3 grid gap-2 text-sm text-white/70 md:grid-cols-2">
              <div>Timestamp: {payload.timestamp}</div>
              <div>Node: {payload.environment.nodeEnv ?? "unset"}</div>
              <div>Vercel env: {payload.environment.vercelEnv ?? "unset"}</div>
              <div>Region: {payload.environment.vercelRegion ?? "unset"}</div>
              <div>Host: {payload.environment.vercelUrl ?? "unset"}</div>
              <div>Commit: {payload.environment.gitCommitSha ?? "unset"}</div>
            </div>
          </div>

          <div className="grid gap-3">
            {payload.results.map((result) => (
              <ResultRow key={result.key} result={result} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: VerificationStatus;
}) {
  const toneClass =
    tone === "pass"
      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
      : tone === "warn"
        ? "border-yellow-400/25 bg-yellow-500/10 text-yellow-100"
        : "border-red-400/25 bg-red-500/10 text-red-100";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.18em] opacity-70">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

function ResultRow({ result }: { result: VerificationResult }) {
  const statusClass =
    result.status === "pass"
      ? "bg-emerald-400/15 text-emerald-100"
      : result.status === "warn"
        ? "bg-yellow-400/15 text-yellow-100"
        : "bg-red-400/15 text-red-100";

  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-semibold text-white">{result.label}</div>
          <div className="mt-1 text-sm leading-6 text-white/65">{result.details}</div>
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusClass}`}>
          {result.status}
        </span>
      </div>

      {result.failedDependency ? (
        <div className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100/85">
          <div>Dependency: {result.failedDependency.name}</div>
          <div>Message: {result.failedDependency.message}</div>
          {result.failedDependency.code ? <div>Code: {result.failedDependency.code}</div> : null}
        </div>
      ) : null}

      {result.metadata ? (
        <pre className="mt-3 max-h-48 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 text-xs leading-5 text-white/60">
          {JSON.stringify(result.metadata, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
