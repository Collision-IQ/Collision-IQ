export const FAL_POLL_INTERVAL_MS = 1600;
export const FAL_POLL_ATTEMPTS = 25;

function getFalStatusValue(status: unknown): string {
  if (!status || typeof status !== "object") return "";
  const record = status as Record<string, unknown>;
  return typeof record.status === "string"
    ? record.status
    : typeof record.state === "string"
      ? record.state
      : "";
}

export function isFalCompleted(status: unknown) {
  return /^(completed|success|succeeded)$/i.test(getFalStatusValue(status));
}

export function isFalFailed(status: unknown) {
  return /^(failed|error|cancelled|canceled)$/i.test(getFalStatusValue(status));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function pollFalStatus<T>(params: {
  fetchStatus: () => Promise<T>;
  intervalMs?: number;
  attempts?: number;
  signal?: AbortSignal;
  isCompleted?: (status: T) => boolean;
  isFailed?: (status: T) => boolean;
}): Promise<T> {
  const intervalMs = params.intervalMs ?? FAL_POLL_INTERVAL_MS;
  const attempts = params.attempts ?? FAL_POLL_ATTEMPTS;
  const isCompleted = params.isCompleted ?? isFalCompleted;
  const isFailed = params.isFailed ?? isFalFailed;

  let lastStatus: T | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (params.signal?.aborted) {
      throw new Error("Polling aborted.");
    }

    lastStatus = await params.fetchStatus();
    if (isCompleted(lastStatus) || isFailed(lastStatus)) {
      return lastStatus;
    }

    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }

  if (lastStatus !== null) {
    return lastStatus;
  }

  throw new Error("Polling did not return a status.");
}