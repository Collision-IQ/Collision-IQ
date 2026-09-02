"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  KeyRound,
  Loader2,
  Lock,
  Upload,
} from "lucide-react";
import { isNative, saveAndShareBlob } from "@/lib/native";
import { buildRekeyPdfBlob } from "@/lib/rekey/rekeySheetPdf";
import type { RekeySheet } from "@/lib/rekey/rekeyTypes";
import type { RekeyVerification } from "@/lib/rekey/rekeyVerification";

// Rekey Sheet (Pro-only). The backend enforces entitlements; this panel
// surfaces the upgrade and failure states rather than hiding them.

type RekeyResponse = {
  reportId: string;
  sheet: RekeySheet;
  sheetText: string;
  verification: RekeyVerification | null;
  verificationText: string | null;
  keyedFilename: string | null;
  keyedNotice: string | null;
};

const RESOLUTION_LABEL: Record<string, string> = {
  exact: "matches",
  value_delta: "value differs",
  missing_in_keyed: "not keyed",
  unmatched: "could not be matched",
};

const RESOLUTION_STYLE: Record<string, string> = {
  value_delta: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  missing_in_keyed: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
  unmatched: "border-border bg-muted text-muted-foreground",
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function money(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `$${value.toFixed(2)}`;
}

async function downloadBlob(blob: Blob, filename: string, label: string) {
  if (isNative()) {
    await saveAndShareBlob(blob, filename, label);
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function RekeyFilePicker({
  label,
  hint,
  accept,
  file,
  onFile,
}: {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  return (
    <label className="flex min-h-[96px] flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-3 text-center transition hover:border-[var(--accent)]/50">
      <Upload size={16} className="text-muted-foreground" />
      <span className="text-xs font-medium text-foreground">{label}</span>
      <span className="max-w-full truncate text-[11px] text-muted-foreground">{file ? file.name : hint}</span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export default function RekeyPanel() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [keyedFile, setKeyedFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [result, setResult] = useState<RekeyResponse | null>(null);

  const buildSheet = async () => {
    if (!sourceFile || running) return;
    setRunning(true);
    setError(null);
    setLocked(null);
    try {
      const payload: Record<string, unknown> = {
        source: {
          filename: sourceFile.name,
          mimeType: sourceFile.type || "application/pdf",
          dataUrl: await fileToDataUrl(sourceFile),
        },
      };
      if (keyedFile) {
        payload.keyed = {
          filename: keyedFile.name,
          mimeType: keyedFile.type || "application/pdf",
          dataUrl: await fileToDataUrl(keyedFile),
        };
      }
      const response = await fetch("/api/rekey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as (RekeyResponse & { error?: string }) | null;
      if (response.status === 403) {
        setLocked(data?.error ?? "The rekey sheet is available on Pro and Team plans.");
        return;
      }
      if (!response.ok || !data) {
        setError(data?.error ?? "The rekey sheet could not be built. Your files were kept.");
        return;
      }
      setResult(data);
    } catch {
      setError("The rekey sheet could not be built. Your files were kept.");
    } finally {
      setRunning(false);
    }
  };

  const verification = result?.verification ?? null;
  const unresolvedFindings = (verification?.lineFindings ?? []).filter(
    (finding) => finding.resolution !== "exact"
  );

  return (
    <div className="ci-panel flex min-h-0 min-w-0 flex-col overflow-y-auto p-5">
      <div className="flex items-center gap-2">
        <KeyRound size={18} className="text-[var(--accent)]" />
        <h2 className="text-lg font-semibold text-foreground">Rekey Sheet</h2>
        <span className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--accent)]">
          Pro
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload the estimate that has to be rekeyed. Collision iQ translates every line into the receiving
        system&apos;s vocabulary, groups them in keying order, and prints the profile settings to set first. Add
        the shop&apos;s estimate as a second upload and it is reconciled against the sheet, line by line.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <RekeyFilePicker
          label="1 · Estimate to be rekeyed"
          hint="PDF, image, or text export"
          accept=".pdf,.txt,.csv,image/*,application/pdf,text/plain,text/csv"
          file={sourceFile}
          onFile={setSourceFile}
        />
        <RekeyFilePicker
          label="2 · Shop estimate to rekey to it (optional)"
          hint="PDF, text export, or a ZIP of an EMS export"
          accept=".pdf,.txt,.csv,.zip,image/*,application/pdf,text/plain,text/csv,application/zip"
          file={keyedFile}
          onFile={setKeyedFile}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void buildSheet()}
          disabled={!sourceFile || running}
          className="ci-btn-primary inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
          {running ? "Building sheet…" : keyedFile ? "Build sheet and verify" : "Build rekey sheet"}
        </button>
        {result ? (
          <>
            <button
              type="button"
              onClick={() =>
                void downloadBlob(
                  buildRekeyPdfBlob({
                    title: `Rekey sheet — ${result.sheet.sourceFile}`,
                    sheetText: result.sheetText,
                    verificationText: result.verificationText,
                  }),
                  "collision-iq-rekey-sheet.pdf",
                  "Rekey sheet"
                )
              }
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-[11px] font-medium hover:bg-background"
            >
              <Download size={11} /> Sheet PDF
            </button>
            <button
              type="button"
              onClick={() =>
                void downloadBlob(
                  new Blob([JSON.stringify({ sheet: result.sheet, verification: result.verification }, null, 2)], {
                    type: "application/json",
                  }),
                  "collision-iq-rekey-ledger.json",
                  "Rekey ledger"
                )
              }
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-[11px] font-medium hover:bg-background"
            >
              <Download size={11} /> Ledger JSON
            </button>
            <span className="text-xs text-muted-foreground">
              Saved to Reports (#{result.reportId.slice(0, 8)}…)
            </span>
          </>
        ) : null}
      </div>

      {locked ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock size={14} /> {locked}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">{error}</p> : null}
      {result?.keyedNotice ? (
        <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">{result.keyedNotice}</p>
      ) : null}

      {result ? (
        <div className="mt-6 space-y-5">
          {result.sheet.warnings.length > 0 ? (
            <div className="ci-card rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="ci-eyebrow mb-2 flex items-center gap-1.5 text-amber-600 dark:text-amber-300">
                <AlertTriangle size={13} /> Before you rely on this sheet
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs text-foreground">
                {result.sheet.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="ci-card rounded-lg border border-border bg-card p-4">
            <div className="ci-eyebrow mb-2">Set these profile values before keying</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-2 font-medium">Setting</th>
                    <th className="px-2.5 py-2 font-medium">Value</th>
                    <th className="px-2.5 py-2 font-medium">Where it comes from</th>
                  </tr>
                </thead>
                <tbody className="text-foreground">
                  {result.sheet.profile.map((field) => (
                    <tr key={field.field} className="border-t border-border align-top">
                      <td className="px-2.5 py-1.5 font-medium">{field.field}</td>
                      <td className="px-2.5 py-1.5 font-mono">{field.display}</td>
                      <td className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
                        {field.basis === "printed"
                          ? "From the source estimate"
                          : field.basis === "derived"
                            ? "Derived"
                            : field.basis === "instruction"
                              ? "Keying instruction"
                              : "Not printed on the source"}
                        {field.note ? ` — ${field.note}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {verification ? (
            <div
              className={`ci-card rounded-lg border p-4 ${
                verification.blocked
                  ? "border-red-500/30 bg-red-500/5"
                  : verification.summary.pass
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-amber-500/30 bg-amber-500/5"
              }`}
            >
              <div className="flex items-center gap-2">
                {verification.summary.pass && !verification.blocked ? (
                  <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-300" />
                ) : (
                  <AlertTriangle size={15} className="text-amber-600 dark:text-amber-300" />
                )}
                <h3 className="text-sm font-semibold text-foreground">
                  {verification.blocked
                    ? "No verification produced"
                    : verification.summary.pass
                      ? "Verified — every line and total matched"
                      : "Differences found"}
                </h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {verification.blockedReason ?? verification.identity.detail}
              </p>

              {!verification.blocked ? (
                <>
                  {verification.profileFindings.length > 0 ? (
                    <div className="mt-3">
                      <div className="ci-eyebrow mb-1">Profile — fix these first</div>
                      <ul className="list-disc space-y-1 pl-5 text-xs text-foreground">
                        {verification.profileFindings.map((finding) => (
                          <li key={finding.field}>
                            {finding.field}: should be {finding.expected}, is {finding.found}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[520px] text-left text-xs">
                      <thead className="bg-muted/60 text-muted-foreground">
                        <tr>
                          <th className="px-2.5 py-2 font-medium">Total</th>
                          <th className="px-2.5 py-2 font-medium">Source</th>
                          <th className="px-2.5 py-2 font-medium">Keyed</th>
                          <th className="px-2.5 py-2 font-medium">Difference</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground">
                        {verification.totals.map((row) => {
                          const format = (value: number | null) =>
                            value === null ? "—" : row.unit === "hours" ? `${value.toFixed(1)} h` : money(value);
                          return (
                            <tr key={`${row.code}-${row.label}`} className="border-t border-border">
                              <td className="px-2.5 py-1.5">{row.label}</td>
                              <td className="px-2.5 py-1.5 font-mono">{format(row.source)}</td>
                              <td className="px-2.5 py-1.5 font-mono">{format(row.keyed)}</td>
                              <td
                                className={`px-2.5 py-1.5 font-mono ${
                                  row.matches ? "text-muted-foreground" : "text-amber-600 dark:text-amber-300"
                                }`}
                              >
                                {row.delta === null ? (row.matches ? "—" : "not comparable") : format(row.delta)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {verification.summary.exact} of {verification.summary.keyableRows} rows matched exactly.
                  </p>

                  {unresolvedFindings.length > 0 ? (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                      <table className="w-full min-w-[560px] text-left text-xs">
                        <thead className="bg-muted/60 text-muted-foreground">
                          <tr>
                            <th className="px-2.5 py-2 font-medium">Line</th>
                            <th className="px-2.5 py-2 font-medium">Description</th>
                            <th className="px-2.5 py-2 font-medium">Result</th>
                            <th className="px-2.5 py-2 font-medium">Difference</th>
                          </tr>
                        </thead>
                        <tbody className="text-foreground">
                          {unresolvedFindings.map((finding, index) => (
                            <tr key={`${finding.description}-${index}`} className="border-t border-border align-top">
                              <td className="px-2.5 py-1.5 font-mono">
                                {finding.supplementTag ? `${finding.supplementTag} ` : ""}
                                {finding.sourceLine ?? "—"}
                              </td>
                              <td className="px-2.5 py-1.5">
                                {finding.description}
                                {finding.partNumber ? (
                                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                                    #{finding.partNumber}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-2.5 py-1.5">
                                <span
                                  className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                                    RESOLUTION_STYLE[finding.resolution] ?? RESOLUTION_STYLE.unmatched
                                  }`}
                                >
                                  {RESOLUTION_LABEL[finding.resolution] ?? finding.resolution}
                                </span>
                              </td>
                              <td className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
                                {finding.deltas.length === 0
                                  ? "—"
                                  : finding.deltas
                                      .map((delta) => `${delta.field}: ${delta.expected} → ${delta.found}`)
                                      .join("; ")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  {verification.extraLines.length > 0 ? (
                    <div className="mt-3">
                      <div className="ci-eyebrow mb-1">Keyed lines with no source line</div>
                      <ul className="list-disc space-y-1 pl-5 text-xs text-foreground">
                        {verification.extraLines.map((extra, index) => (
                          <li key={index}>
                            {extra.description}
                            {extra.partNumber ? ` (#${extra.partNumber})` : ""} {money(extra.price)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <div>
            <div className="ci-eyebrow mb-2">Keying sheet</div>
            <div className="space-y-4">
              {result.sheet.groups.map((group) => (
                <div key={group.group} className="overflow-hidden rounded-lg border border-border">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/60 px-2.5 py-2">
                    <span className="text-xs font-semibold text-foreground">
                      {group.group}
                      {group.mapped ? null : (
                        <span className="ml-2 font-normal text-[10px] text-amber-600 dark:text-amber-300">
                          no group matched — choose one when keying
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {group.totals.lines} lines · body {group.totals.body.toFixed(1)} h · paint{" "}
                      {group.totals.paint.toFixed(1)} h · mech {group.totals.mech.toFixed(1)} h · parts{" "}
                      {money(group.totals.parts)} · misc {money(group.totals.misc)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead className="bg-muted/30 text-muted-foreground">
                        <tr>
                          <th className="px-2.5 py-1.5 font-medium">Line</th>
                          <th className="px-2.5 py-1.5 font-medium">Op</th>
                          <th className="px-2.5 py-1.5 font-medium">Description</th>
                          <th className="px-2.5 py-1.5 font-medium">Part #</th>
                          <th className="px-2.5 py-1.5 font-medium">Type</th>
                          <th className="px-2.5 py-1.5 font-medium">Qty</th>
                          <th className="px-2.5 py-1.5 font-medium">Price</th>
                          <th className="px-2.5 py-1.5 font-medium">Labor</th>
                          <th className="px-2.5 py-1.5 font-medium">Misc</th>
                          <th className="px-2.5 py-1.5 font-medium">Flags</th>
                        </tr>
                      </thead>
                      <tbody className="text-foreground">
                        {group.rows.map((row) => (
                          <tr
                            key={row.id}
                            className={`border-t border-border align-top ${row.keyable ? "" : "bg-muted/30"}`}
                          >
                            <td className="px-2.5 py-1.5 font-mono">
                              {row.supplementTag ? `${row.supplementTag} ` : ""}
                              {row.sourceLine ?? "—"}
                            </td>
                            <td className="px-2.5 py-1.5">{row.operationCcc}</td>
                            <td className="px-2.5 py-1.5">
                              {row.keyable ? null : (
                                <span className="mr-1 font-mono text-[10px] uppercase text-muted-foreground">
                                  do not key
                                </span>
                              )}
                              {row.descriptionCcc}
                              {row.notes.map((note, index) => (
                                <span key={index} className="mt-0.5 block text-[10px] text-muted-foreground">
                                  {note}
                                </span>
                              ))}
                            </td>
                            <td className="px-2.5 py-1.5 font-mono">{row.partNumber ?? "—"}</td>
                            <td className="px-2.5 py-1.5">{row.partTypeCcc === "None" ? "—" : row.partTypeCcc}</td>
                            <td className="px-2.5 py-1.5">{row.qty ?? "—"}</td>
                            <td className="px-2.5 py-1.5 font-mono">{money(row.price)}</td>
                            <td className="px-2.5 py-1.5 font-mono">
                              {row.labor.length === 0
                                ? "—"
                                : row.labor
                                    .map((entry) => `${entry.type} ${entry.included ? "Incl." : entry.hours.toFixed(1)}`)
                                    .join(" · ")}
                            </td>
                            <td className="px-2.5 py-1.5 font-mono">
                              {row.misc ? `${money(row.misc.amount)}${row.misc.sublet ? " subl" : ""}` : "—"}
                            </td>
                            <td className="px-2.5 py-1.5 text-[10px] text-muted-foreground">
                              {row.flags.join(", ") || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {result.sheet.expectedTotals ? (
            <div className="ci-card rounded-lg border border-border bg-card p-4">
              <div className="ci-eyebrow mb-2 flex items-center gap-1.5">
                <FileText size={13} /> The keyed estimate should read
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-xs">
                  <tbody className="text-foreground">
                    {result.sheet.expectedTotals.categories.map((category) => (
                      <tr key={category.category} className="border-t border-border">
                        <td className="px-2.5 py-1.5">{category.category}</td>
                        <td className="px-2.5 py-1.5 font-mono">
                          {category.hours === null ? "" : `${category.hours.toFixed(1)} h @ ${money(category.rate)} = `}
                          {money(category.cost)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-border">
                      <td className="px-2.5 py-1.5">Tax</td>
                      <td className="px-2.5 py-1.5 font-mono">{money(result.sheet.expectedTotals.tax)}</td>
                    </tr>
                    <tr className="border-t border-border font-semibold">
                      <td className="px-2.5 py-1.5">Gross total</td>
                      <td className="px-2.5 py-1.5 font-mono">{money(result.sheet.expectedTotals.grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
