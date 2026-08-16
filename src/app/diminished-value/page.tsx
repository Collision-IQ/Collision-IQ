"use client";

// Self-service ACV + Diminished Value generator — a paid, standalone flow
// separate from the chatbot:
//
//   upload estimate → confirm extracted details + 3 intake answers →
//   one-time payment (Stripe service checkout) → generation → downloads.
//
// Generation never runs before the server has verified the Stripe session.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { upload as uploadBlob } from "@vercel/blob/client";
import {
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  Share2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { createUploadStallGuard, uploadFileViaChunkedRelay } from "@/lib/chunkedBlobUpload";
import { STANDARD_UPLOAD_ROUTE_MAX_BYTES } from "@/lib/uploadSafety/directUploadRouting";
import {
  exportDemandLetterPdf,
  exportMarketValueReportPdf,
  exportTotalLossDemandLetterPdf,
  exportTotalLossReportPdf,
} from "@/lib/dv/pdf/dvPdfBuilders";
import type { DvExtraction, DvIntake, DvReportData, DvResult } from "@/lib/dv/types";

type DvReportMode = "diminished_value" | "total_loss";

type DvRequestView = {
  id: string;
  status: "draft" | "paid" | "processing" | "ready" | "failed";
  extraction: DvExtraction | null;
  intake: DvIntake | null;
  result: DvResult | null;
  paidAt: string | null;
  errorMessage: string | null;
};

type WizardStep = "upload" | "intake" | "payment" | "generating" | "ready";

type IntakeForm = {
  lossDate: string;
  claimPosture: "third_party" | "first_party" | "unsure";
  zip: string;
  state: string;
  taxRatePct: string;
  appraisalFee: string;
  ownerName: string;
  insurer: string;
  claimNumber: string;
  mileage: string;
  repairTotal: string;
  carfaxPostLossValue: string;
};

const EMPTY_INTAKE: IntakeForm = {
  lossDate: "",
  claimPosture: "third_party",
  zip: "",
  state: "",
  taxRatePct: "6",
  appraisalFee: "350",
  ownerName: "",
  insurer: "",
  claimNumber: "",
  mileage: "",
  repairTotal: "",
  carfaxPostLossValue: "",
};

function usd(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Shops share this page with their customers — native share sheet where the
 *  platform has one, clipboard copy elsewhere. */
function ShareValueIqButton() {
  const [copied, setCopied] = useState(false);
  const shareUrl = "https://www.collision-iq.ai/diminished-value";

  async function handleShare() {
    const payload = {
      title: "Collision iQ — Value IQ",
      text: "Get a carrier-ready Actual Cash Value & Diminished Value report for your vehicle.",
      url: shareUrl,
    };
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share(payload);
        return;
      }
    } catch {
      // fall through to clipboard (user may simply have dismissed the sheet)
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // last resort: nothing to do — the URL is in the address bar
    }
  }

  return (
    <button type="button" className="ci-btn ci-btn-ghost" onClick={() => void handleShare()}>
      <Share2 className="mr-2 h-4 w-4" />
      {copied ? "Link copied!" : "Share Value IQ with a customer"}
    </button>
  );
}

const STEPS: Array<{ key: WizardStep; label: string }> = [
  { key: "upload", label: "Upload estimate" },
  { key: "intake", label: "Confirm details" },
  { key: "payment", label: "Payment" },
  { key: "generating", label: "Generate" },
  { key: "ready", label: "Your report" },
];

function DiminishedValueFlow() {
  const searchParams = useSearchParams();
  const { getToken, isLoaded, userId } = useAuth();

  const [step, setStep] = useState<WizardStep>("upload");
  const [mode, setMode] = useState<DvReportMode>("diminished_value");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [request, setRequest] = useState<DvRequestView | null>(null);
  const [intakeForm, setIntakeForm] = useState<IntakeForm>(EMPTY_INTAKE);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bootstrapped = useRef(false);

  /** Owner requirement: a finished (or failed) report must be clearable so
   *  the next customer can start and pay without reopening the site. */
  function startNewReport() {
    setRequest(null);
    setIntakeForm(EMPTY_INTAKE);
    setError(null);
    setBusy(false);
    setBusyLabel("");
    setStep("upload");
    bootstrapped.current = true; // never re-resume the cleared request from the URL
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/diminished-value");
    }
  }

  const applyRequest = useCallback((next: DvRequestView) => {
    setRequest(next);
    const extraction = next.extraction;
    setIntakeForm((prev) => ({
      ...prev,
      lossDate: next.intake?.lossDate ?? prev.lossDate ?? "",
      claimPosture: next.intake?.claimPosture ?? prev.claimPosture,
      zip: next.intake?.zip ?? extraction?.ownerZip ?? prev.zip,
      state: next.intake?.state ?? extraction?.state ?? prev.state,
      taxRatePct: String(next.intake?.taxRatePct ?? prev.taxRatePct),
      appraisalFee: String(next.intake?.appraisalFee ?? prev.appraisalFee),
      ownerName: next.intake?.ownerName ?? extraction?.ownerName ?? prev.ownerName,
      insurer: next.intake?.insurer ?? extraction?.insurer ?? prev.insurer,
      claimNumber: next.intake?.claimNumber ?? extraction?.claimNumber ?? prev.claimNumber,
      mileage: String(next.intake?.mileage ?? extraction?.mileage ?? prev.mileage ?? ""),
      repairTotal: String(next.intake?.repairTotal ?? extraction?.repairTotal ?? prev.repairTotal ?? ""),
      carfaxPostLossValue: next.intake?.carfaxPostLossValue
        ? String(next.intake.carfaxPostLossValue)
        : prev.carfaxPostLossValue,
    }));

    if (next.status === "ready" && next.result) setStep("ready");
    else if (next.status === "processing") setStep("generating");
    else if (next.paidAt) setStep("generating");
    else if (next.intake) setStep("payment");
    else setStep("intake");
  }, []);

  const runGeneration = useCallback(async (id: string) => {
    setStep("generating");
    setError(null);
    setBusy(true);
    setBusyLabel("Researching comparables and computing the valuation…");
    try {
      const res = await fetch(`/api/dv/${id}/generate`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Generation failed.");
      }
      applyRequest(data.request as DvRequestView);
    } catch (generationError) {
      setError(
        generationError instanceof Error ? generationError.message : "Generation failed."
      );
      setStep("payment");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }, [applyRequest]);

  // Resume: back from Stripe (?checkout=success&request&session_id) or a
  // bookmarked in-progress request (?request).
  useEffect(() => {
    if (bootstrapped.current || !isLoaded || !userId) return;
    const requestId = searchParams.get("request");
    if (!requestId) return;
    bootstrapped.current = true;

    const sessionId = searchParams.get("session_id");
    const checkout = searchParams.get("checkout");

    void (async () => {
      setBusy(true);
      setBusyLabel("Restoring your request…");
      try {
        if (checkout === "success" && sessionId) {
          setBusyLabel("Verifying payment…");
          const confirmRes = await fetch(`/api/dv/${requestId}/confirm`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
          const confirmData = await confirmRes.json().catch(() => null);
          if (!confirmRes.ok) {
            throw new Error(confirmData?.error ?? "Payment verification failed.");
          }
          const confirmed = confirmData.request as DvRequestView;
          applyRequest(confirmed);
          if (confirmed.paidAt && confirmed.status !== "ready") {
            await runGeneration(requestId);
          }
          return;
        }

        const res = await fetch(`/api/dv/${requestId}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? "Request not found.");
        if (data.viewer?.isPlatformAdmin) setIsPlatformAdmin(true);
        applyRequest(data.request as DvRequestView);
      } catch (resumeError) {
        setError(resumeError instanceof Error ? resumeError.message : "Could not resume.");
      } finally {
        setBusy(false);
        setBusyLabel("");
      }
    })();
  }, [isLoaded, userId, searchParams, applyRequest, runGeneration]);

  async function handleUpload(file: File) {
    setBusy(true);
    setError(null);
    setBusyLabel("Uploading your estimate…");
    try {
      const token = await getToken();
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
      const freshAuthHeaders = async (): Promise<Record<string, string> | undefined> => {
        const freshToken = await getToken();
        return freshToken ? { Authorization: `Bearer ${freshToken}` } : undefined;
      };

      let attachmentId: string | null = null;

      if (file.size > STANDARD_UPLOAD_ROUTE_MAX_BYTES) {
        let blob: { url: string; downloadUrl: string; pathname: string; contentType?: string | null };
        const stallGuard = createUploadStallGuard();
        try {
          const directUploadPromise = uploadBlob(`uploads/${Date.now()}-${file.name}`, file, {
            access: "public",
            contentType: file.type || undefined,
            handleUploadUrl: "/api/upload/direct",
            clientPayload: JSON.stringify({
              filename: file.name,
              contentType: file.type,
              sizeBytes: file.size,
              activeCaseId: null,
            }),
            headers: authHeaders,
            abortSignal: stallGuard.abortSignal,
            onUploadProgress: stallGuard.onUploadProgress,
          });
          directUploadPromise.catch(() => {});
          blob = await Promise.race([directUploadPromise, stallGuard.stalled]);
        } catch {
          blob = await uploadFileViaChunkedRelay(file, {
            headers: authHeaders,
            getHeaders: freshAuthHeaders,
          });
        } finally {
          stallGuard.finish();
        }

        const finalizeHeaders = (await freshAuthHeaders()) ?? authHeaders;
        const finalizeRes = await fetch("/api/upload/finalize", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...(finalizeHeaders ?? {}) },
          body: JSON.stringify({
            url: blob.url,
            downloadUrl: blob.downloadUrl,
            pathname: blob.pathname,
            filename: file.name,
            contentType: blob.contentType || file.type,
            sizeBytes: file.size,
            activeCaseId: null,
          }),
        });
        const finalizeData = await finalizeRes.json().catch(() => null);
        if (!finalizeRes.ok) {
          throw new Error(finalizeData?.error ?? "Upload could not be finalized.");
        }
        attachmentId = finalizeData.attachmentId ?? null;
      } else {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", {
          method: "POST",
          credentials: "include",
          headers: authHeaders,
          body: formData,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          // The per-file failure reason is written for people; the top-level
          // error is a machine code (FILE_PROCESSING_FAILED) — never show it
          // when a real explanation is available.
          const reason = data?.failedUploads?.[0]?.reason;
          throw new Error(reason ?? data?.error ?? "Upload failed.");
        }
        attachmentId = data?.files?.[0]?.id ?? null;
      }

      if (!attachmentId) {
        throw new Error("Upload completed but no attachment id was returned.");
      }

      setBusyLabel(
        mode === "total_loss" ? "Reading the carrier's valuation…" : "Reading the estimate…"
      );
      const dvRes = await fetch("/api/dv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentId, mode }),
      });
      const dvData = await dvRes.json().catch(() => null);
      if (!dvRes.ok) {
        throw new Error(dvData?.error ?? "The estimate could not be read.");
      }

      if (dvData.viewer?.isPlatformAdmin) setIsPlatformAdmin(true);
      const created = dvData.request as DvRequestView;
      const defaults = dvData.intakeDefaults as {
        lossDate: string; zip: string; state: string; taxRatePct: number; appraisalFee: number;
      };
      setIntakeForm((prev) => ({
        ...prev,
        lossDate: defaults.lossDate || prev.lossDate,
        zip: defaults.zip || prev.zip,
        state: defaults.state || prev.state,
        taxRatePct: String(defaults.taxRatePct),
        appraisalFee: String(defaults.appraisalFee),
      }));
      applyRequest(created);
      setStep("intake");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  async function handleIntakeSubmit() {
    if (!request) return;
    // Validate up front with a visible message — a silently disabled button
    // reads as broken when a required field is empty.
    const missing: string[] = [];
    if (!intakeForm.lossDate) missing.push("the date of loss (estimates often omit it)");
    if (!/^\d{5}$/.test(intakeForm.zip.trim())) missing.push("a 5-digit registered ZIP");
    if (!intakeForm.mileage || !(Number(intakeForm.mileage) > 0)) missing.push("the mileage");
    // A total loss has no repair total — the ACV is the product.
    if (
      mode === "diminished_value" &&
      (!intakeForm.repairTotal || !(Number(intakeForm.repairTotal) > 0))
    ) {
      missing.push("the repair total");
    }
    if (missing.length) {
      setError(`Before continuing to payment, please provide ${missing.join(", ")}.`);
      return;
    }
    setBusy(true);
    setError(null);
    setBusyLabel("Saving your answers…");
    try {
      const res = await fetch(`/api/dv/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          lossDate: intakeForm.lossDate,
          claimPosture: intakeForm.claimPosture,
          zip: intakeForm.zip,
          state: intakeForm.state,
          taxRatePct: Number(intakeForm.taxRatePct),
          appraisalFee: Number(intakeForm.appraisalFee),
          ownerName: intakeForm.ownerName,
          insurer: intakeForm.insurer,
          claimNumber: intakeForm.claimNumber,
          mileage: intakeForm.mileage ? Number(intakeForm.mileage) : undefined,
          repairTotal: intakeForm.repairTotal ? Number(intakeForm.repairTotal) : undefined,
          carfaxPostLossValue: intakeForm.carfaxPostLossValue
            ? Number(intakeForm.carfaxPostLossValue)
            : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not save intake.");
      applyRequest(data.request as DvRequestView);
      setStep("payment");
    } catch (intakeError) {
      setError(intakeError instanceof Error ? intakeError.message : "Could not save intake.");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  async function handleCheckout() {
    if (!request) return;
    setBusy(true);
    setError(null);
    setBusyLabel("Opening secure checkout…");
    try {
      const res = await fetch("/api/billing/service-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceType: "value_iq",
          dvRequestId: request.id,
          sourcePage: "diminished-value",
          returnUrl: `/diminished-value?checkout=cancelled&request=${request.id}`,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? "Checkout could not be started.");
      }
      window.location.href = data.url;
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error ? checkoutError.message : "Checkout could not be started."
      );
      setBusy(false);
      setBusyLabel("");
    }
  }

  function reportData(): DvReportData | null {
    if (!request?.extraction || !request.intake || !request.result) return null;
    return {
      extraction: request.extraction,
      intake: request.intake,
      result: request.result,
    };
  }

  const extraction = request?.extraction;
  const result = request?.result;
  const stepIndex = STEPS.findIndex((entry) => entry.key === step);

  return (
    <section className="mx-auto max-w-3xl px-5 pb-24">
      {/* Step rail */}
      <ol className="mb-8 flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((entry, index) => (
          <li key={entry.key} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold ${
                index < stepIndex
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : index === stepIndex
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-border text-muted-foreground"
              }`}
            >
              {index < stepIndex ? "✓" : index + 1}
            </span>
            <span
              className={
                index === stepIndex ? "font-semibold text-foreground" : "text-muted-foreground"
              }
            >
              {entry.label}
            </span>
            {index < STEPS.length - 1 && (
              <span className="mx-1 hidden text-muted-foreground sm:inline">—</span>
            )}
          </li>
        ))}
      </ol>

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 font-semibold text-[var(--accent)] underline decoration-dotted"
            onClick={startNewReport}
          >
            Start a new report
          </button>
        </div>
      )}
      {busy && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
          {busyLabel || "Working…"}
        </div>
      )}

      {!isLoaded ? null : !userId ? (
        <div className="ci-card p-8 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            Sign in to start a diminished value report. Your request, payment, and documents stay
            attached to your account.
          </p>
          <SignInButton
            mode="modal"
            forceRedirectUrl={
              typeof window !== "undefined" ? window.location.href : "/diminished-value"
            }
          >
            <button type="button" className="ci-btn ci-btn-primary">
              Sign in to begin
            </button>
          </SignInButton>
        </div>
      ) : step === "upload" ? (
        <div className="ci-card p-8">
          <div className="mb-4 flex items-center gap-3">
            <Upload className="h-5 w-5 text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">
              {mode === "total_loss" ? "Upload the carrier's valuation report" : "Upload your repair estimate"}
            </h2>
          </div>

          {/* Two products, one flow: a repairable vehicle (diminished value)
              or a totalled one (value dispute against the carrier's ACV). */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("diminished_value")}
              className={`rounded-xl border p-4 text-left transition ${
                mode === "diminished_value"
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-border hover:border-[var(--accent)]"
              }`}
            >
              <span className="block text-sm font-semibold">My car was repaired</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Diminished value — what the loss record costs you at resale.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("total_loss")}
              className={`rounded-xl border p-4 text-left transition ${
                mode === "total_loss"
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-border hover:border-[var(--accent)]"
              }`}
            >
              <span className="block text-sm font-semibold">My car was totalled</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Value dispute — challenge the carrier&apos;s actual cash value offer.
              </span>
            </button>
          </div>

          <p className="mb-5 text-sm text-muted-foreground">
            {mode === "total_loss"
              ? "Upload the Market Valuation Report the carrier based its total-loss offer on (CCC ONE or Mitchell). We read its comparables, adjustments and value, then build an independent appraisal against it — including re-running the carrier's own comps at the industry mileage rate."
              : "Upload the estimate PDF from your repair shop or insurer (CCC ONE and similar formats supported). The vehicle, VIN, mileage, insurer, claim number, and repair total are read automatically — you confirm everything before anything is charged."}
          </p>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border px-6 py-12 text-center transition hover:border-[var(--accent)]">
            <FileText className="mb-3 h-8 w-8 text-muted-foreground" />
            <span className="text-sm font-medium">Choose the estimate PDF</span>
            <span className="mt-1 text-xs text-muted-foreground">PDF preferred — photos of paper estimates often cannot be read reliably</span>
            <input
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      ) : step === "intake" ? (
        <div className="ci-card p-8">
          <h2 className="mb-1 text-lg font-semibold">Confirm what we read</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            {extraction?.vehicle.label
              ? `${extraction.vehicle.label}${extraction.vehicle.vin ? ` · VIN ${extraction.vehicle.vin}` : ""}`
              : "Vehicle details could not be fully read — fill them in below."}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Date of loss *</span>
              <input
                type="date"
                required
                value={intakeForm.lossDate}
                onChange={(e) => setIntakeForm({ ...intakeForm, lossDate: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Estimates often omit this — it is required on the demand letter.
              </span>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Who pays the claim? *</span>
              <select
                value={intakeForm.claimPosture}
                onChange={(e) =>
                  setIntakeForm({
                    ...intakeForm,
                    claimPosture: e.target.value as IntakeForm["claimPosture"],
                  })
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              >
                <option value="third_party">The other driver&apos;s insurer (third-party)</option>
                <option value="first_party">My own insurer (first-party)</option>
                <option value="unsure">Not sure yet</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Registered ZIP *</span>
              <input
                value={intakeForm.zip}
                onChange={(e) => setIntakeForm({ ...intakeForm, zip: e.target.value })}
                inputMode="numeric"
                maxLength={5}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Sales tax %</span>
              <input
                value={intakeForm.taxRatePct}
                onChange={(e) => setIntakeForm({ ...intakeForm, taxRatePct: e.target.value })}
                inputMode="decimal"
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Owner name</span>
              <input
                value={intakeForm.ownerName}
                onChange={(e) => setIntakeForm({ ...intakeForm, ownerName: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Insurance carrier</span>
              <input
                value={intakeForm.insurer}
                onChange={(e) => setIntakeForm({ ...intakeForm, insurer: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Claim #</span>
              <input
                value={intakeForm.claimNumber}
                onChange={(e) => setIntakeForm({ ...intakeForm, claimNumber: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Mileage *</span>
              <input
                value={intakeForm.mileage}
                onChange={(e) => setIntakeForm({ ...intakeForm, mileage: e.target.value })}
                inputMode="numeric"
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Repair total *</span>
              <input
                value={intakeForm.repairTotal}
                onChange={(e) => setIntakeForm({ ...intakeForm, repairTotal: e.target.value })}
                inputMode="decimal"
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">CarFax post-loss value (optional)</span>
              <input
                value={intakeForm.carfaxPostLossValue}
                onChange={(e) =>
                  setIntakeForm({ ...intakeForm, carfaxPostLossValue: e.target.value })
                }
                inputMode="decimal"
                placeholder="If you already pulled it"
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
          </div>
          <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
            <span className="font-semibold">Check every field before continuing.</span> Your
            valuation, comparable search, and demand letter are generated from the information
            confirmed on this page — in particular the registered ZIP, mileage, and repair total.
            Fees for completed reports are non-refundable.
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              className="ci-btn ci-btn-ghost"
              disabled={busy}
              onClick={() => setStep("upload")}
            >
              Back
            </button>
            <button
              type="button"
              className="ci-btn ci-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={() => void handleIntakeSubmit()}
            >
              Continue to payment
            </button>
          </div>
        </div>
      ) : step === "payment" ? (
        <div className="ci-card p-8">
          <div className="mb-4 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-[var(--accent)]" />
            <h2 className="text-lg font-semibold">One-time payment</h2>
          </div>
          <p className="mb-2 text-sm text-muted-foreground">
            The report generates only after payment clears — a single flat fee, no subscription.
            The appraisal fee is itemized on the demand itself as an additional indirect loss, so a
            successful claim recovers it.
          </p>
          <ul className="mb-6 list-inside list-disc space-y-1 text-sm text-muted-foreground">
            <li>Market Value Report (ACV) with three live dealer comps, mileage-adjusted at $0.07/mile</li>
            <li>Every comp linked to its live listing so you and the carrier can verify it</li>
            <li>Diminished value calculation with the insurer 17c cross-check</li>
            <li>Carrier-ready demand letter, issued in your own name, on the Collision Academy template</li>
          </ul>
          <p className="mb-6 text-xs text-muted-foreground">
            By paying you confirm the details entered on the previous step are accurate. The report
            is generated from that information, and fees for completed reports are non-refundable.
          </p>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="ci-btn ci-btn-ghost"
              disabled={busy}
              onClick={() => setStep("intake")}
            >
              Back
            </button>
            <button
              type="button"
              className="ci-btn ci-btn-primary"
              disabled={busy}
              onClick={() => void handleCheckout()}
            >
              Pay &amp; generate
            </button>
          </div>
          {request?.paidAt && (
            <div className="mt-4 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
              Payment already verified for this request.{" "}
              <button
                type="button"
                className="font-semibold text-[var(--accent)]"
                onClick={() => void runGeneration(request.id)}
              >
                Generate now
              </button>
            </div>
          )}
          {isPlatformAdmin && request && !request.paidAt && (
            // Visible only when the server reported platform-admin; the
            // generate route independently re-checks admin before waiving
            // payment, so this button is a shortcut, not the gate.
            <div className="mt-4 rounded-lg border border-dashed border-[var(--accent)] px-4 py-3 text-sm">
              <span className="font-semibold">Admin test mode:</span> generate without paying.{" "}
              <button
                type="button"
                className="font-semibold text-[var(--accent)] underline decoration-dotted"
                disabled={busy}
                onClick={() => void runGeneration(request.id)}
              >
                Skip payment &amp; generate
              </button>
            </div>
          )}
        </div>
      ) : step === "generating" ? (
        <div className="ci-card p-8 text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-[var(--accent)]" />
          <h2 className="mb-2 text-lg font-semibold">Building your valuation</h2>
          <p className="text-sm text-muted-foreground">
            Searching live dealer listings near ZIP {request?.intake?.zip}, adjusting comps at
            $0.07/mile, and computing the diminished value demand. This usually takes under a
            minute.
          </p>
          {!busy && request && (
            <button
              type="button"
              className="ci-btn ci-btn-primary mt-6"
              onClick={() => void runGeneration(request.id)}
            >
              Start generation
            </button>
          )}
        </div>
      ) : step === "ready" && result ? (
        <div className="space-y-6">
          <div className="ci-card p-8">
            <div className="mb-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <h2 className="text-lg font-semibold">
                {result.totalLoss
                  ? "Your total-loss appraisal package is ready"
                  : "Your diminished value package is ready"}
              </h2>
            </div>
            {result.totalLoss ? (
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Carrier&apos;s value (pre-tax)</dt>
                  <dd className="text-lg font-semibold">
                    {usd(result.totalLoss.carrier.adjustedVehicleValue ?? undefined)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Appraised ACV (pre-tax)</dt>
                  <dd className="text-lg font-semibold">{usd(result.totalLoss.acv.preTaxAcv)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Shortfall</dt>
                  <dd className="text-lg font-semibold">
                    {usd(result.totalLoss.gap.shortfall ?? undefined)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total demand</dt>
                  <dd className="text-lg font-semibold text-[var(--accent)]">
                    {usd(result.totalLoss.acv.demand)}
                  </dd>
                </div>
              </dl>
            ) : (
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Pre-loss ACV</dt>
                  <dd className="text-lg font-semibold">{usd(result.calculation.preLossAcv)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Post-loss{result.calculation.postLoss.projected ? " (projected)" : ""}
                  </dt>
                  <dd className="text-lg font-semibold">{usd(result.calculation.postLoss.value)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Diminished value</dt>
                  <dd className="text-lg font-semibold">{usd(result.calculation.diminishedValue)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total demand</dt>
                  <dd className="text-lg font-semibold text-[var(--accent)]">
                    {usd(result.calculation.totalDemand)}
                  </dd>
                </div>
              </dl>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                className="ci-btn ci-btn-primary"
                onClick={() => {
                  const data = reportData();
                  if (!data) return;
                  void (result.totalLoss
                    ? exportTotalLossReportPdf(data)
                    : exportMarketValueReportPdf(data));
                }}
              >
                {result.totalLoss
                  ? "Download ACV Appraisal (Total Loss)"
                  : "Download Market Value Report (ACV)"}
              </button>
              <button
                type="button"
                className="ci-btn ci-btn-primary"
                onClick={() => {
                  const data = reportData();
                  if (!data) return;
                  void (result.totalLoss
                    ? exportTotalLossDemandLetterPdf(data)
                    : exportDemandLetterPdf(data));
                }}
              >
                Download Demand Letter
              </button>
              <button type="button" className="ci-btn ci-btn-ghost" onClick={startNewReport}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Start a new report
              </button>
            </div>
          </div>

          <div className="ci-card p-6">
            <h3 className="mb-3 text-sm font-semibold">Before you send</h3>
            <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
              {result.openItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          {result.compResearch.clean.length > 0 && (
            <div className="ci-card p-6">
              <h3 className="mb-3 text-sm font-semibold">Comparable listings used</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {result.compResearch.clean.map((comp) => (
                  <li key={`${comp.source}-${comp.askingPrice}`}>
                    <span className="text-foreground">{usd(comp.askingPrice)}</span>
                    {typeof comp.mileage === "number"
                      ? ` · ${comp.mileage.toLocaleString("en-US")} mi`
                      : ""}
                    {" · "}
                    {comp.url ? (
                      <a
                        href={comp.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted"
                      >
                        {comp.dealer ?? comp.source}
                      </a>
                    ) : (
                      comp.dealer ?? comp.source
                    )}
                    {comp.trimMatch !== "exact" ? " · adjacent trim (conservative)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default function DiminishedValuePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/iq/iq_logo.png" alt="Collision iQ" width={34} height={34} />
            <span className="text-sm font-semibold tracking-wide">Collision iQ</span>
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/the-academy" className="text-muted-foreground hover:text-foreground">
              Professional Services
            </Link>
            <Link href="/" className="ci-btn ci-btn-ghost">
              Workspace
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-5 pb-10 pt-12">
        <p className="ci-eyebrow mb-2">Self-service · Pay per report</p>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">
          Actual Cash Value &amp; Diminished Value Generator
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          The diminished value report generated here is more accurate than the 17c formula
          insurance carriers tend to run when left unchallenged. We provide a detailed report
          using live comparable values to support the value of your vehicle both with and without
          a recorded loss — every comp linked to its listing for independent review, with a
          carrier-ready demand letter issued in your own name.
        </p>
        <div className="mt-4">
          <ShareValueIqButton />
        </div>
      </section>

      <Suspense fallback={null}>
        <DiminishedValueFlow />
      </Suspense>
    </main>
  );
}
