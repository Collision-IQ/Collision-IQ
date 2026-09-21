const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchJsonWithRetryOptions {
  retries?: number;
  timeoutMs?: number;
  /** Injectable for tests; defaults to a real delay. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A 4xx other than 429 is a bad request, not a transient fault — never retried. */
class NonRetryableHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableHttpError";
  }
}

/**
 * Small fetch wrapper with a timeout and exponential-backoff retry.
 * NHTSA's public APIs have no documented rate limit, but they are a shared
 * government resource with no SLA — retry politely, never hammer.
 */
export async function fetchJsonWithRetry<T>(
  url: string,
  { retries = 2, timeoutMs = DEFAULT_TIMEOUT_MS, sleep = realSleep }: FetchJsonWithRetryOptions = {}
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      if (res.status === 429 || res.status >= 500) {
        throw new Error(`NHTSA API returned ${res.status}`);
      }
      if (!res.ok) {
        throw new NonRetryableHttpError(`NHTSA API request failed: ${res.status} ${res.statusText}`);
      }

      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof NonRetryableHttpError) throw err;
      lastError = err;
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("NHTSA API request failed");
}
