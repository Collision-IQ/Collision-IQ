"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Car, FileSearch, FileText, Loader2, Lock, Paperclip, Save, ScanSearch, ShieldAlert, Trash2, Wrench, X } from "lucide-react";
import type {
  MaintenanceItem,
  VehicleMaintenanceSummary,
  VehicleProfile,
} from "@/lib/vehicleMaintenance";
import type { VehicleRecallSnapshot, VpicDecodeResult } from "@/lib/nhtsa/types";
import { isSameVehicle, type LastAnalyzedVehicle } from "@/lib/lastAnalyzedVehicle";
import { VIN_SHAPE, type DecodedVinProfileFields } from "@/lib/nhtsa/vinDecode";

type VehicleAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes?: number;
  uploadedAt?: string;
};

const MAX_FILES = 5;

const STATUS_STYLE: Record<MaintenanceItem["status"], string> = {
  overdue: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
  "due-soon": "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  unknown: "border-border bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<MaintenanceItem["status"], string> = {
  overdue: "Overdue",
  "due-soon": "Due soon",
  ok: "OK",
  unknown: "Set baseline",
};

// Local editable form shape (strings for controlled inputs).
type FormState = {
  vin: string;
  year: string;
  make: string;
  model: string;
  mileage: string;
  oilDate: string;
  oilMileage: string;
  rotationDate: string;
  rotationMileage: string;
  tireDate: string;
  tireMileage: string;
};

const EMPTY_FORM: FormState = {
  vin: "", year: "", make: "", model: "", mileage: "",
  oilDate: "", oilMileage: "", rotationDate: "", rotationMileage: "",
  tireDate: "", tireMileage: "",
};

function profileToForm(p: VehicleProfile): FormState {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    vin: s(p.vin),
    year: s(p.year),
    make: s(p.make),
    model: s(p.model),
    mileage: s(p.mileage),
    oilDate: s(p.oilChange?.date),
    oilMileage: s(p.oilChange?.mileage),
    rotationDate: s(p.tireRotation?.date),
    rotationMileage: s(p.tireRotation?.mileage),
    tireDate: s(p.tireChange?.date),
    tireMileage: s(p.tireChange?.mileage),
  };
}

function formToPayload(f: FormState) {
  const num = (v: string) => (v.trim() ? Number(v.replace(/[,\s]/g, "")) : null);
  return {
    vin: f.vin.trim() || null,
    year: num(f.year),
    make: f.make.trim() || null,
    model: f.model.trim() || null,
    mileage: num(f.mileage),
    oilChange: { date: f.oilDate || null, mileage: num(f.oilMileage) },
    tireRotation: { date: f.rotationDate || null, mileage: num(f.rotationMileage) },
    tireChange: { date: f.tireDate || null, mileage: num(f.tireMileage) },
  };
}

type VehicleView = "mine" | "analyzed";

type VehicleIdentityFields = Pick<VehicleProfile, "year" | "make" | "model" | "vin">;

function identityOf(p: VehicleProfile): VehicleIdentityFields | null {
  const id = { year: p.year ?? null, make: p.make ?? null, model: p.model ?? null, vin: p.vin ?? null };
  return id.year || id.make || id.model || id.vin ? id : null;
}

function savedVehicleLabel(saved: VehicleIdentityFields | null): string | null {
  if (!saved) return null;
  return [saved.year, saved.make, saved.model].filter(Boolean).join(" ").trim() || (saved.vin ? `VIN ${saved.vin}` : null);
}

type VinDecodeState =
  | { status: "decoding"; vin: string }
  | { status: "decoded"; vin: string; decoded: VpicDecodeResult; fields: DecodedVinProfileFields }
  | { status: "invalid"; vin: string; message: string }
  | { status: "error"; vin: string; message: string };

/** Year/make/model or VIN present — enough for a recall lookup. */
function canCheckRecalls(f: FormState): boolean {
  if (f.vin.trim().length === 17) return true;
  return !!(f.year.trim() && f.make.trim() && f.model.trim());
}

/**
 * True when the saved identity differs from what the last recall check used
 * (or that check did not complete), so a changed VIN — or, for a typed-identity
 * check, a changed year/make/model — re-queries NHTSA while an unrelated save
 * (mileage, service dates) does not.
 */
function recallIdentityChanged(snapshot: VehicleRecallSnapshot | null, f: FormState): boolean {
  if (!snapshot || snapshot.status !== "ok") return true;
  const vin = f.vin.trim().toUpperCase() || null;
  if ((snapshot.vin ?? null) !== vin) return true;
  if (snapshot.identitySource === "vin_decoded") return false;
  const typed = [f.year.trim(), f.make.trim(), f.model.trim()].map((v) => v.toUpperCase()).join("|");
  const used = snapshot.identity
    ? [snapshot.identity.modelYear, snapshot.identity.make, snapshot.identity.model].map((v) => v.trim().toUpperCase()).join("|")
    : "";
  return typed !== used;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "min-h-9 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground outline-none transition focus:border-[var(--accent)]/60";

/**
 * "My Vehicle" tab — the signed-in user stores their vehicle + service history,
 * and the app projects upcoming maintenance from mileage and dates. All data is
 * scoped to the authenticated user (GET/PUT /api/vehicle).
 */
export default function MyVehiclePanel() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [maintenance, setMaintenance] = useState<VehicleMaintenanceSummary | null>(null);
  const [attachments, setAttachments] = useState<VehicleAttachment[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unauthorized">("loading");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recalls, setRecalls] = useState<VehicleRecallSnapshot | null>(null);
  const [checkingRecalls, setCheckingRecalls] = useState(false);
  const [recallError, setRecallError] = useState<string | null>(null);
  const [vinDecode, setVinDecode] = useState<VinDecodeState | null>(null);
  // The owner's saved vehicle is what recalls and maintenance track. The
  // vehicle from the most recent analysis rides alongside as a reference and
  // never overwrites it unless the owner chooses "Use as my vehicle".
  const [savedVehicle, setSavedVehicle] = useState<VehicleIdentityFields | null>(null);
  const [lastAnalyzed, setLastAnalyzed] = useState<LastAnalyzedVehicle | null>(null);
  const [view, setView] = useState<VehicleView>("mine");
  // The VIN most recently decoded (or loaded from the saved profile), so a
  // stored VIN is never re-decoded over the owner's saved make/model on load.
  const lastDecodedVin = useRef<string | null>(null);
  /** The VIN as loaded from the saved profile; a decode of it fills only empty fields. */
  const savedVinRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vehicle", { cache: "no-store" });
      if (res.status === 401) {
        setState("unauthorized");
        return;
      }
      if (!res.ok) {
        setState("error");
        return;
      }
      const data = (await res.json()) as {
        profile: VehicleProfile;
        attachments: VehicleAttachment[];
        maintenance: VehicleMaintenanceSummary;
        lastAnalyzed?: LastAnalyzedVehicle | null;
      };
      const loaded = profileToForm(data.profile ?? {});
      setForm(loaded);
      const saved = identityOf(data.profile ?? {});
      setSavedVehicle(saved);
      const analyzed = data.lastAnalyzed ?? null;
      setLastAnalyzed(analyzed);
      // Open on the last vehicle analysed when it is a different car from the
      // saved one; the "My vehicle" switch always brings the owner's car back.
      setView(analyzed && !isSameVehicle(analyzed, saved) ? "analyzed" : "mine");
      // A saved VIN with year, make and model already filled is left alone;
      // a saved VIN with any of them missing decodes on load and fills the gaps.
      const savedVin = loaded.vin.trim().toUpperCase();
      savedVinRef.current = VIN_SHAPE.test(savedVin) ? savedVin : null;
      lastDecodedVin.current =
        savedVinRef.current && loaded.year.trim() && loaded.make.trim() && loaded.model.trim()
          ? savedVinRef.current
          : null;
      setAttachments(data.attachments ?? []);
      setMaintenance(data.maintenance ?? null);
      setRecalls(data.profile?.recalls ?? null);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    // load() only sets state after awaiting fetch, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleVinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, vin: value }));
    const vin = value.trim().toUpperCase();
    if (!vin) {
      lastDecodedVin.current = null;
      setVinDecode(null);
    } else if (vin.length === 17 && !VIN_SHAPE.test(vin)) {
      setVinDecode({ status: "invalid", vin, message: "A VIN never contains the letters I, O, or Q." });
    } else if (vin.length !== 17) {
      // Editing the VIN re-arms the decoder, so retyping the same VIN decodes again.
      lastDecodedVin.current = null;
      setVinDecode(null);
    }
  };

  /**
   * Ask NHTSA vPIC for year/make/model. "override" (a typed or pasted VIN, or
   * the Decode button) replaces the fields because the decode outranks what
   * was typed; "fill-missing" (the saved VIN on load) only fills empty ones.
   */
  const runVinDecode = useCallback(async (vin: string, mode: "override" | "fill-missing") => {
    lastDecodedVin.current = vin;
    setVinDecode({ status: "decoding", vin });
    try {
      const res = await fetch("/api/vehicle/decode-vin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vin }),
      });
      if (res.status === 401) {
        setState("unauthorized");
        return;
      }
      // A newer VIN was typed while this decode was in flight: drop it.
      if (lastDecodedVin.current !== vin) return;
      const body = (await res.json().catch(() => null)) as
        | { decoded?: VpicDecodeResult; fields?: DecodedVinProfileFields; error?: string }
        | null;
      if (!res.ok || !body?.decoded || !body.fields) {
        setVinDecode({ status: "error", vin, message: body?.error ?? "NHTSA could not decode the VIN right now. Enter the year, make, and model manually." });
        return;
      }
      if (!body.decoded.isValid) {
        setVinDecode({ status: "invalid", vin, message: `${body.decoded.errorText ?? "VIN could not be decoded."} Enter the year, make, and model manually.` });
        return;
      }
      const fields = body.fields;
      const pick = (decoded: string | null, current: string) =>
        decoded && (mode === "override" || !current.trim()) ? decoded : current;
      setForm((f) => ({
        ...f,
        vin,
        year: pick(fields.year !== null ? String(fields.year) : null, f.year),
        make: pick(fields.make, f.make),
        model: pick(fields.model, f.model),
      }));
      setVinDecode({ status: "decoded", vin, decoded: body.decoded, fields });
    } catch {
      if (lastDecodedVin.current !== vin) return;
      setVinDecode({ status: "error", vin, message: "NHTSA could not decode the VIN right now. Enter the year, make, and model manually." });
    }
  }, []);

  // VIN decoder: once a well-formed 17-character VIN is present (typed,
  // pasted, or loaded with fields missing) and has not been decoded yet, ask
  // NHTSA after a short pause. Manual entry stays the fallback whenever the
  // VIN is missing or cannot be decoded.
  useEffect(() => {
    if (state !== "ready") return;
    const vin = form.vin.trim().toUpperCase();
    if (!VIN_SHAPE.test(vin) || vin === lastDecodedVin.current) return;
    const mode = vin === savedVinRef.current ? "fill-missing" : "override";
    const handle = setTimeout(() => void runVinDecode(vin, mode), 400);
    return () => clearTimeout(handle);
  }, [form.vin, state, runVinDecode]);

  const checkRecalls = useCallback(async () => {
    setCheckingRecalls(true);
    setRecallError(null);
    try {
      const res = await fetch("/api/vehicle/recalls", { method: "POST" });
      if (res.status === 401) {
        setState("unauthorized");
        return;
      }
      if (!res.ok) {
        setRecallError("Could not check recalls right now. Try again in a moment.");
        return;
      }
      const data = (await res.json()) as { recalls: VehicleRecallSnapshot | null };
      setRecalls(data.recalls ?? null);
    } catch {
      setRecallError("Could not check recalls right now. Try again in a moment.");
    } finally {
      setCheckingRecalls(false);
    }
  }, []);

  /**
   * Copy the last analysed vehicle into the form. Nothing is saved until the
   * owner presses Save, and the saved vehicle keeps driving recalls and
   * maintenance until then. Year, make and model come from the analysis when
   * present; a VIN with any of them missing decodes to fill only the gaps.
   */
  const useAnalyzedVehicle = () => {
    if (!lastAnalyzed) return;
    const vin = lastAnalyzed.vin ?? "";
    const complete = !!(vin && lastAnalyzed.year && lastAnalyzed.make && lastAnalyzed.model);
    savedVinRef.current = vin || null;
    lastDecodedVin.current = complete ? vin : null;
    setVinDecode(null);
    setSavedAt(null);
    setForm((f) => ({
      ...f,
      vin,
      year: lastAnalyzed.year !== null ? String(lastAnalyzed.year) : vin ? "" : f.year,
      make: lastAnalyzed.make ?? (vin ? "" : f.make),
      model: lastAnalyzed.model ?? (vin ? "" : f.model),
    }));
    setView("mine");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/vehicle", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(form)),
      });
      if (res.status === 401) {
        setState("unauthorized");
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { profile: VehicleProfile; maintenance: VehicleMaintenanceSummary };
      const nextForm = profileToForm(data.profile);
      setForm(nextForm);
      setSavedVehicle(identityOf(data.profile));
      setMaintenance(data.maintenance);
      setSavedAt(Date.now());
      // A new or changed vehicle identity gets an immediate NHTSA recall check
      // (same moment the maintenance outlook refreshes); otherwise the stored
      // snapshot stands until the weekly sweep or a manual re-check.
      if (canCheckRecalls(nextForm) && recallIdentityChanged(data.profile.recalls ?? null, nextForm)) {
        void checkRecalls();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (attachments.length >= MAX_FILES) {
          setUploadError(`You can store up to ${MAX_FILES} files.`);
          break;
        }
        const dataUrl = await readFileAsDataUrl(file);
        const res = await fetch("/api/vehicle/attachments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, mimeType: file.type, dataUrl }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setUploadError(body?.error ?? "Upload failed.");
          break;
        }
        const { attachment } = (await res.json()) as { attachment: VehicleAttachment };
        setAttachments((prev) => [...prev, attachment]);
      }
    } catch {
      setUploadError("Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemove = async (id: string) => {
    const res = await fetch("/api/vehicle/attachments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      const { attachments: next } = (await res.json()) as { attachments: VehicleAttachment[] };
      setAttachments(next);
    }
  };

  if (state === "loading") {
    return (
      <div className="ci-panel flex min-h-0 flex-1 items-center justify-center p-6 text-muted-foreground">
        <Loader2 className="mr-2 animate-spin" size={18} /> Loading your vehicle…
      </div>
    );
  }

  if (state === "unauthorized") {
    return (
      <div className="ci-panel flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <Lock size={22} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Sign in to save your vehicle</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Your vehicle details and maintenance history are private to your account. Sign in to store them and get
          upkeep reminders.
        </p>
      </div>
    );
  }

  return (
    <div className="ci-panel flex min-h-0 min-w-0 flex-col overflow-y-auto p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Car size={18} className="text-[var(--accent)]" />
          <h2 className="text-lg font-semibold text-foreground">My Vehicle</h2>
        </div>
        {lastAnalyzed ? (
          <VehicleViewSwitch view={view} onChange={setView} savedLabel={savedVehicleLabel(savedVehicle)} analyzedLabel={lastAnalyzed.label} />
        ) : null}
      </div>
      {view === "analyzed" && lastAnalyzed ? (
        <LastAnalyzedCard
          vehicle={lastAnalyzed}
          savedLabel={savedVehicleLabel(savedVehicle)}
          isSaved={isSameVehicle(lastAnalyzed, savedVehicle)}
          onUse={useAnalyzedVehicle}
          onShowMine={() => setView("mine")}
        />
      ) : null}
      {/* The saved vehicle stays mounted (form state, decoder, uploads) and is
          only hidden while the analysed vehicle is in front. */}
      <div className={view === "analyzed" ? "hidden" : "contents"}>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your VIN and we decode the year, make, and model from NHTSA — or type them in if you don&apos;t have
        it. We track your average mileage and project upcoming maintenance, or count down from the service date when
        mileage isn&apos;t available.
      </p>

      {/* Vehicle identity + mileage */}
      <div className="mt-4">
        <div className="ci-eyebrow mb-2">Vehicle</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Year"><input className={inputClass} inputMode="numeric" value={form.year} onChange={update("year")} placeholder="2022" /></Field>
          <Field label="Make"><input className={inputClass} value={form.make} onChange={update("make")} placeholder="Jeep" /></Field>
          <Field label="Model"><input className={inputClass} value={form.model} onChange={update("model")} placeholder="Grand Wagoneer" /></Field>
          <Field label="Current mileage"><input className={inputClass} inputMode="numeric" value={form.mileage} onChange={update("mileage")} placeholder="42,000" /></Field>
          <div className="col-span-2 sm:col-span-4">
            <Field label="VIN">
              <div className="flex gap-2">
                <input
                  className={`${inputClass} min-w-0 flex-1`}
                  value={form.vin}
                  onChange={handleVinChange}
                  placeholder="1C4SJVFP1RS133438"
                  maxLength={17}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => void runVinDecode(form.vin.trim().toUpperCase(), "override")}
                  disabled={vinDecode?.status === "decoding" || !VIN_SHAPE.test(form.vin.trim().toUpperCase())}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-[var(--accent)]/50 disabled:opacity-60"
                  title="Decode this VIN with NHTSA and fill in year, make, and model"
                >
                  {vinDecode?.status === "decoding" ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
                  Decode VIN
                </button>
              </div>
            </Field>
            <VinDecodeStatus state={vinDecode} />
          </div>
        </div>
      </div>

      {/* Last service records */}
      <div className="mt-4">
        <div className="ci-eyebrow mb-2">Last service</div>
        <div className="space-y-3">
          <ServiceRow label="Oil & filter change" date={form.oilDate} mileage={form.oilMileage} onDate={update("oilDate")} onMileage={update("oilMileage")} />
          <ServiceRow label="Tire rotation" date={form.rotationDate} mileage={form.rotationMileage} onDate={update("rotationDate")} onMileage={update("rotationMileage")} />
          <ServiceRow label="Tire replacement" date={form.tireDate} mileage={form.tireMileage} onDate={update("tireDate")} onMileage={update("tireMileage")} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="ci-btn-primary inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save vehicle
        </button>
        {savedAt ? <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span> : null}
      </div>

      {/* Maintenance projections */}
      <div className="mt-6">
        <div className="flex items-center gap-2">
          <Wrench size={15} className="text-[var(--accent)]" />
          <div className="ci-eyebrow">Maintenance outlook</div>
        </div>
        {maintenance ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              {maintenance.averageMilesPerYear !== null
                ? `Average ~${maintenance.averageMilesPerYear.toLocaleString("en-US")} mi/yr`
                : "Update your mileage again over time to calculate your average."}
              {maintenance.projectedMileage !== null
                ? ` · Projected odometer ~${maintenance.projectedMileage.toLocaleString("en-US")} mi`
                : ""}
            </p>
            <ul className="mt-3 space-y-2">
              {maintenance.items.map((item) => (
                <li key={item.key} className="ci-card flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{item.label}</span>
                      {item.estimatedBaseline ? (
                        <span className="text-[10px] text-muted-foreground">est.</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[item.status]}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
          Intervals are general guidance — always confirm against your owner&apos;s manual and a technician&apos;s inspection.
        </p>
      </div>

      {/* NHTSA safety recalls */}
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert size={15} className="text-[var(--accent)]" />
            <div className="ci-eyebrow">Safety recalls (NHTSA)</div>
          </div>
          <button
            type="button"
            onClick={() => void checkRecalls()}
            disabled={checkingRecalls || !canCheckRecalls(form)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-[var(--accent)]/50 disabled:opacity-60"
            title={canCheckRecalls(form) ? "Check NHTSA for recall campaigns" : "Enter a VIN or year, make, and model first"}
          >
            {checkingRecalls ? <Loader2 size={12} className="animate-spin" /> : <ShieldAlert size={12} />}
            {recalls ? "Re-check recalls" : "Check for recalls"}
          </button>
        </div>
        <RecallSummary snapshot={recalls} checking={checkingRecalls} canCheck={canCheckRecalls(form)} error={recallError} />
      </div>

      {/* Attachments */}
      <div className="mt-6">
        <div className="flex items-center gap-2">
          <Paperclip size={15} className="text-[var(--accent)]" />
          <div className="ci-eyebrow">Documents & photos ({attachments.length}/{MAX_FILES})</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div key={att.id} className="ci-card relative flex w-[104px] flex-col overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex h-[72px] items-center justify-center bg-muted">
                {att.mimeType.startsWith("image/") && att.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={att.dataUrl} alt={att.filename} className="h-full w-full object-cover" />
                ) : (
                  <FileText size={26} className="text-muted-foreground" />
                )}
              </div>
              <span className="truncate px-1.5 py-1 text-[10px] text-muted-foreground" title={att.filename}>{att.filename}</span>
              <button
                type="button"
                onClick={() => handleRemove(att.id)}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white transition hover:bg-black/80"
                aria-label={`Remove ${att.filename}`}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {attachments.length < MAX_FILES ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex h-[104px] w-[104px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition hover:border-[var(--accent)]/50 hover:text-foreground disabled:opacity-60"
            >
              {uploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
              <span className="text-[10px]">Add file</span>
            </button>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploadError ? (
          <p className="mt-2 flex items-center gap-1 text-xs text-red-500">
            <X size={12} /> {uploadError}
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">Up to {MAX_FILES} images or PDFs (registration, insurance, service records), 4 MB each.</p>
        )}
      </div>
      </div>
    </div>
  );
}

function VehicleViewSwitch({
  view, onChange, savedLabel, analyzedLabel,
}: {
  view: VehicleView;
  onChange: (view: VehicleView) => void;
  savedLabel: string | null;
  analyzedLabel: string;
}) {
  const base = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition";
  const on = "bg-[var(--accent)] text-white shadow-sm";
  const off = "text-muted-foreground hover:text-foreground";
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="tablist" aria-label="Which vehicle to show">
      <button
        type="button"
        role="tab"
        aria-selected={view === "mine"}
        onClick={() => onChange("mine")}
        className={`${base} ${view === "mine" ? on : off}`}
        title={savedLabel ? `Your saved vehicle: ${savedLabel}` : "Your saved vehicle"}
      >
        <Car size={13} /> My vehicle
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "analyzed"}
        onClick={() => onChange("analyzed")}
        className={`${base} ${view === "analyzed" ? on : off}`}
        title={`Last analyzed: ${analyzedLabel}`}
      >
        <FileSearch size={13} /> Last analyzed
      </button>
    </div>
  );
}

function fmtAnalyzedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const dtClass = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

/**
 * The vehicle from the owner's most recent analysis. Reference only: recalls
 * and maintenance keep tracking the saved vehicle until the owner copies this
 * one in with "Use as my vehicle" and saves.
 */
function LastAnalyzedCard({
  vehicle, savedLabel, isSaved, onUse, onShowMine,
}: {
  vehicle: LastAnalyzedVehicle;
  savedLabel: string | null;
  isSaved: boolean;
  onUse: () => void;
  onShowMine: () => void;
}) {
  const when = fmtAnalyzedAt(vehicle.analyzedAt);
  return (
    <div className="mt-3">
      <p className="text-sm text-muted-foreground">
        The vehicle from your most recent analysis{when ? ` on ${when}` : ""}. It is shown for reference and is not saved
        as your vehicle.
      </p>
      <div className="ci-card mt-3 rounded-lg border border-border bg-card p-4">
        <div className="ci-eyebrow">Last analyzed</div>
        <div className="mt-1 text-lg font-semibold text-foreground">{vehicle.label}</div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt className={dtClass}>Year</dt><dd className="text-foreground">{vehicle.year ?? "—"}</dd></div>
          <div><dt className={dtClass}>Make</dt><dd className="text-foreground">{vehicle.make ?? "—"}</dd></div>
          <div><dt className={dtClass}>Model</dt><dd className="text-foreground">{vehicle.model ?? "—"}</dd></div>
          <div><dt className={dtClass}>Trim</dt><dd className="text-foreground">{vehicle.trim ?? "—"}</dd></div>
          <div className="col-span-2 sm:col-span-4"><dt className={dtClass}>VIN</dt><dd className="font-mono text-foreground">{vehicle.vin ?? "—"}</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {isSaved ? (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">This is your saved vehicle.</span>
          ) : (
            <button
              type="button"
              onClick={onUse}
              className="ci-btn-primary inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold"
              title="Copy this vehicle into the form; nothing changes until you save"
            >
              <ArrowRightLeft size={14} /> Use as my vehicle
            </button>
          )}
          <button
            type="button"
            onClick={onShowMine}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-[var(--accent)]/50"
          >
            <Car size={12} /> {savedLabel ? `Show my vehicle (${savedLabel})` : "Set up my vehicle"}
          </button>
        </div>
      </div>
      <p className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
        Recalls, maintenance, and documents on this page belong to your saved vehicle
        {savedLabel ? ` (${savedLabel})` : ""}. Switch to My vehicle to see them.
      </p>
    </div>
  );
}

function VinDecodeStatus({ state }: { state: VinDecodeState | null }) {
  if (!state) {
    return <p className="mt-1 text-[11px] text-muted-foreground">17 characters. Year, make, and model fill in automatically once it decodes.</p>;
  }
  if (state.status === "decoding") {
    return (
      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 size={11} className="animate-spin" /> Decoding VIN with NHTSA…
      </p>
    );
  }
  if (state.status === "decoded") {
    const f = state.fields;
    const label = [f.year, f.make, f.model, f.trim].filter(Boolean).join(" ");
    const extra = state.decoded.bodyClass ? ` · ${state.decoded.bodyClass}` : "";
    return (
      <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        Decoded by NHTSA vPIC: {label}{extra}. Adjust anything that looks off, then save.
      </p>
    );
  }
  return (
    <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300">
      <X size={11} /> {state.message}
    </p>
  );
}

function fmtCheckedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RecallSummary({
  snapshot, checking, canCheck, error,
}: {
  snapshot: VehicleRecallSnapshot | null;
  checking: boolean;
  canCheck: boolean;
  error: string | null;
}) {
  if (error) {
    return <p className="mt-2 flex items-center gap-1 text-xs text-red-500"><X size={12} /> {error}</p>;
  }
  if (!snapshot) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {checking
          ? "Checking NHTSA for recall campaigns…"
          : canCheck
            ? "Save your vehicle to check NHTSA for open recall campaigns. We re-check weekly and flag anything new."
            : "Enter a VIN (or year, make, and model) and save to check NHTSA for recall campaigns."}
      </p>
    );
  }

  const identityText = snapshot.identity
    ? `${snapshot.identity.modelYear} ${snapshot.identity.make} ${snapshot.identity.model}`
    : null;
  const checkedText = fmtCheckedAt(snapshot.checkedAt);
  const sourceText =
    snapshot.identitySource === "vin_decoded" ? "from your VIN" : snapshot.identitySource === "profile" ? "from the year, make, and model you entered" : "";

  return (
    <div className="mt-1">
      {snapshot.status !== "ok" ? (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          {snapshot.message ?? "Recalls could not be checked."}
          {checkedText ? ` (last attempt ${checkedText})` : ""}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {snapshot.campaigns.length === 0
              ? "No recall campaigns found"
              : `${snapshot.campaigns.length} recall ${snapshot.campaigns.length === 1 ? "campaign" : "campaigns"} may apply`}
            {identityText ? ` for a ${identityText}` : ""}
            {sourceText ? ` (${sourceText})` : ""}
            {checkedText ? ` · checked ${checkedText}` : ""}.
          </p>
          {snapshot.campaigns.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {snapshot.campaigns.map((c) => (
                <li key={c.campaignNumber} className="ci-card rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{c.component || "Recall campaign"}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-300">
                      {c.campaignNumber}{c.reportReceivedDate ? ` · ${c.reportReceivedDate}` : ""}
                    </span>
                  </div>
                  {c.summary ? <p className="mt-1 text-xs text-muted-foreground">{c.summary}</p> : null}
                  {c.consequence ? <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Risk:</span> {c.consequence}</p> : null}
                  {c.remedy ? <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Remedy:</span> {c.remedy}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <p className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
        {snapshot.disclaimer}{" "}
        <a href="https://www.nhtsa.gov/recalls" target="_blank" rel="noreferrer" className="underline">
          Check your VIN at NHTSA
        </a>
        .
      </p>
    </div>
  );
}

function ServiceRow({
  label, date, mileage, onDate, onMileage,
}: {
  label: string;
  date: string;
  mileage: string;
  onDate: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onMileage: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 sm:grid-cols-[1fr_160px_140px]">
      <span className="text-sm text-foreground">{label}</span>
      <input type="date" className={inputClass} value={date} onChange={onDate} aria-label={`${label} date`} />
      <input className={inputClass} inputMode="numeric" value={mileage} onChange={onMileage} placeholder="mi" aria-label={`${label} mileage`} />
    </div>
  );
}
