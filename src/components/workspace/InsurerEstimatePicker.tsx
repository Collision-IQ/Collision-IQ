"use client";

import { useId, useState } from "react";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { describeCounterpartCandidate, type CounterpartChoice } from "@/lib/reports/counterpartChoice";

/**
 * Asks which comparison upload is the insurer's estimate when the Appraisal
 * Dispute Report could not tell from what the estimates print, and reruns the
 * report with the answer. After a run that compared against one of several,
 * it says which one and lets the user change it. Keyed by counterpartChoiceKey,
 * so a new question starts unanswered.
 */
export function InsurerEstimatePicker({
  choice,
  busy,
  onRun,
}: {
  choice: CounterpartChoice;
  busy: boolean;
  onRun: (documentId: string) => void;
}) {
  const headingId = useId();
  const [open, setOpen] = useState(choice.required);
  const [selected, setSelected] = useState<string | null>(choice.required ? null : choice.comparedDocumentId);

  const compared = choice.candidates.find((candidate) => candidate.sourceDocumentId === choice.comparedDocumentId);

  if (!open) {
    if (!compared) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-card px-3 py-2 text-[12px] leading-5 text-muted-foreground">
        <span className="min-w-0 break-words">
          Insurer&apos;s estimate: <span className="font-medium text-foreground">{compared.fileName}</span>
          {choice.confirmedByUser ? " (you chose it)" : ""}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer text-[12px] font-medium text-[var(--accent)] underline-offset-2 hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className={`rounded-md border p-3 ${choice.required ? "border-amber-500/50 bg-amber-500/5" : "border-border bg-card"}`}
    >
      <p id={headingId} className="text-sm font-semibold text-foreground">
        Which upload is the insurer&apos;s estimate?
      </p>
      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
        {choice.required
          ? "Nothing printed on these estimates settles it, so the Appraisal Dispute Report was not produced. Choose the insurer's estimate and run the report again. If it is not listed, upload it first."
          : "The report is measured against the estimate you choose here as the insurer's."}
      </p>
      <ul className="mt-2 space-y-2" role="radiogroup" aria-labelledby={headingId}>
        {choice.candidates.map((candidate) => {
          const isSelected = selected === candidate.sourceDocumentId;
          return (
            <li key={candidate.sourceDocumentId}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelected(candidate.sourceDocumentId)}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition ${
                  isSelected
                    ? "border-[var(--accent)]/60 bg-[var(--accent)]/8 ring-1 ring-[var(--accent)]/30"
                    : "border-border bg-card hover:bg-muted/40"
                }`}
              >
                <span
                  aria-hidden
                  className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full border ${
                    isSelected ? "border-[var(--accent)] bg-[var(--accent)]" : "border-muted-foreground/50"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start gap-2 text-sm font-medium text-foreground">
                    <FileText size={13} className="mt-1 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 break-words">{candidate.fileName}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{describeCounterpartCandidate(candidate)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => selected && onRun(selected)}
          disabled={!selected || busy}
          className="ci-btn-primary inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Run with this estimate
        </button>
        {!choice.required ? (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex cursor-pointer items-center rounded-md border border-border bg-muted px-2.5 py-1.5 text-[11px] font-medium hover:bg-background"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
