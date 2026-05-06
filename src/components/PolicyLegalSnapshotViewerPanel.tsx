"use client";

import { useState } from "react";
import type { PolicyLegalSnapshotViewerPayload } from "@/lib/policyLegal/snapshotsEndpoint";

type SnapshotPayload =
  PolicyLegalSnapshotViewerPayload["snapshots"][number];

type SnapshotLookupPayload = PolicyLegalSnapshotViewerPayload | { error?: string };

export default function PolicyLegalSnapshotViewerPanel() {
  const [caseId, setCaseId] = useState("");
  const [claimId, setClaimId] = useState("");
  const [payload, setPayload] = useState<PolicyLegalSnapshotViewerPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSnapshots() {
    const params = new URLSearchParams();
    if (caseId.trim()) params.set("caseId", caseId.trim());
    if (claimId.trim()) params.set("claimId", claimId.trim());

    if (!params.toString()) {
      setError("Enter a case ID or claim ID.");
      setPayload(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/policy-legal/snapshots?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = (await response.json()) as SnapshotLookupPayload;
      if (!response.ok || "error" in data) {
        setPayload(null);
        setError("error" in data && data.error ? data.error : `Snapshot lookup failed (${response.status}).`);
        return;
      }
      if (isSnapshotViewerPayload(data)) {
        setPayload(data);
        return;
      }
      setPayload(null);
      setError("Snapshot lookup returned an invalid payload.");
    } catch (lookupError) {
      setPayload(null);
      setError(lookupError instanceof Error ? lookupError.message : "Snapshot lookup failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-white/45">Admin</div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Snapshot Viewer Validation</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
            Loads immutable policy/legal snapshots with citation counts, source metadata, timestamps, and replay validation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSnapshots()}
          disabled={loading}
          className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#C65A2A]/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Loading..." : "Load snapshots"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <SnapshotInput label="Case ID" value={caseId} onChange={setCaseId} />
        <SnapshotInput label="Claim ID" value={claimId} onChange={setClaimId} />
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {payload ? (
        <div className="mt-6 space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <MiniStat label="Snapshots" value={String(payload.total)} />
            <MiniStat label="Case filter" value={payload.filters.caseId ?? "None"} />
            <MiniStat label="Claim filter" value={payload.filters.claimId ?? "None"} />
          </div>

          <div className="space-y-4">
            {payload.snapshots.map((snapshot) => (
              <SnapshotCard key={snapshot.replay_safe_rendering.render_key} snapshot={snapshot} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function isSnapshotViewerPayload(
  payload: SnapshotLookupPayload
): payload is PolicyLegalSnapshotViewerPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "total" in payload &&
    "filters" in payload &&
    "snapshots" in payload &&
    Array.isArray(payload.snapshots)
  );
}

function SnapshotInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.18em] text-white/45">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[#C65A2A]/70"
        placeholder={`Enter ${label.toLowerCase()}`}
      />
    </label>
  );
}

function SnapshotCard({ snapshot }: { snapshot: SnapshotPayload }) {
  const validations = Object.entries(snapshot.validation);

  return (
    <article className="rounded-2xl border border-white/10 bg-black/30 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-semibold text-white">{snapshot.snapshot_id}</div>
          <div className="mt-1 break-all text-xs leading-5 text-white/50">
            Hash: {snapshot.immutable_snapshot_hash}
          </div>
        </div>
        <span className="w-fit rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">
          Replay safe
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <MiniStat label="Generated" value={snapshot.snapshot_timestamp} />
        <MiniStat label="Version" value={snapshot.snapshot_version} />
        <MiniStat label="Jurisdiction" value={snapshot.jurisdiction_context.claim_state ?? "Unknown"} />
        <MiniStat label="Confidence" value={`${snapshot.confidence_metadata.policyLegalConfidenceScore} (${snapshot.confidence_metadata.band})`} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <MetadataBlock
          title="Citation Counts"
          rows={[
            ["Regulation citations", snapshot.citation_counts.regulationCitations],
            ["Rendered citations", snapshot.citation_counts.renderedCitations],
            ["Placeholder citations", snapshot.citation_counts.placeholderCitations],
            ["OEM sources", snapshot.citation_counts.oemSources],
            ["Carrier sources", snapshot.citation_counts.carrierSources],
          ]}
        />
        <MetadataBlock
          title="Evidence Completeness"
          rows={[
            ["Regulation sources", snapshot.evidence_completeness_metadata.regulationSourceCount],
            ["Citation count", snapshot.evidence_completeness_metadata.citationCount],
            ["OEM source count", snapshot.evidence_completeness_metadata.oemSourceCount],
            ["Carrier source count", snapshot.evidence_completeness_metadata.carrierSourceCount],
            ["Missing", snapshot.evidence_completeness_metadata.missing.join(", ") || "None"],
          ]}
        />
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
        <div className="text-xs uppercase tracking-[0.2em] text-white/45">Regulation Citations</div>
        <div className="mt-3 space-y-3">
          {snapshot.regulation_sources_used.length > 0 ? (
            snapshot.regulation_sources_used.map((source) => (
              <div key={source.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-white/70">
                <div className="font-semibold text-white">{source.citation}</div>
                <div>Source: {source.sourceName ?? "Unknown source"}</div>
                <div>Effective: {source.effectiveDate ?? "Not recorded"}</div>
                <div>Retrieved: {source.retrievedAt ?? "Not recorded"}</div>
                {source.sourceUrl ? <div className="break-all">URL: {source.sourceUrl}</div> : null}
              </div>
            ))
          ) : (
            <div className="text-sm text-white/55">No verified regulation-source metadata recorded.</div>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
        <div className="text-xs uppercase tracking-[0.2em] text-white/45">Source Metadata</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <SourceList title="Rendered citations" items={snapshot.citations_used} />
          <SourceList title="OEM sources" items={snapshot.source_metadata.oemSources} />
          <SourceList title="Carrier sources" items={snapshot.source_metadata.carrierSources} />
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {validations.map(([key, result]) => (
          <div key={key} className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold capitalize text-white">{key.replaceAll("_", " ")}</div>
              <StatusBadge status={result.status} />
            </div>
            <div className="mt-2 text-sm leading-6 text-white/60">{result.details}</div>
          </div>
        ))}
      </div>
    </article>
  );
}

function SourceList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">{title}</div>
      <div className="mt-2 space-y-2 text-sm leading-5 text-white/65">
        {items.length > 0 ? (
          items.map((item) => <div key={item}>{item}</div>)
        ) : (
          <div>None recorded</div>
        )}
      </div>
    </div>
  );
}

function MetadataBlock({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string | number]>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-white/45">{title}</div>
      <div className="mt-3 space-y-2 text-sm text-white/70">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <span className="text-white/45">{label}</span>
            <span className="text-right text-white/80">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div className="mt-2 break-words text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: "pass" | "warn" | "fail" }) {
  const className =
    status === "pass"
      ? "bg-emerald-400/15 text-emerald-100"
      : status === "warn"
        ? "bg-yellow-400/15 text-yellow-100"
        : "bg-red-400/15 text-red-100";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${className}`}>
      {status}
    </span>
  );
}
