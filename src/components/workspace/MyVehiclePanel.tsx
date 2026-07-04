"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Car, FileText, Loader2, Lock, Paperclip, Save, Trash2, Wrench, X } from "lucide-react";
import type {
  MaintenanceItem,
  VehicleMaintenanceSummary,
  VehicleProfile,
} from "@/lib/vehicleMaintenance";

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
      };
      setForm(profileToForm(data.profile ?? {}));
      setAttachments(data.attachments ?? []);
      setMaintenance(data.maintenance ?? null);
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
      setForm(profileToForm(data.profile));
      setMaintenance(data.maintenance);
      setSavedAt(Date.now());
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
      <div className="flex items-center gap-2">
        <Car size={18} className="text-[var(--accent)]" />
        <h2 className="text-lg font-semibold text-foreground">My Vehicle</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Store your vehicle and last-service details. We track your average mileage and project upcoming maintenance —
        or count down from the service date when mileage isn&apos;t available.
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
            <Field label="VIN"><input className={inputClass} value={form.vin} onChange={update("vin")} placeholder="1C4SJVFP1RS133438" /></Field>
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
