export type TtsVoiceSymbol = "voice_1" | "voice_2";
export type TtsProvider = "elevenlabs" | "browser";

export type SpeakResult = {
  provider: TtsProvider;
  voiceId?: string;
  model?: string;
  status: number;
  firstByteMs: number | null;
  playingMs: number | null;
  objectUrl?: string;
};

export class TtsClientError extends Error {
  code: string;
  status?: number;
  missing?: string[];
  upstreamStatus?: number;

  constructor(message: string, options?: {
    code?: string;
    status?: number;
    missing?: string[];
    upstreamStatus?: number;
  }) {
    super(message);
    this.name = "TtsClientError";
    this.code = options?.code ?? message;
    this.status = options?.status;
    this.missing = options?.missing;
    this.upstreamStatus = options?.upstreamStatus;
  }
}

const MAX_TTS_CHARS = 4_000;

function splitTextForTts(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TTS_CHARS) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_TTS_CHARS) {
      chunks.push(remaining);
      break;
    }

    const windowText = remaining.slice(0, MAX_TTS_CHARS);
    const splitAt = Math.max(
      windowText.lastIndexOf(". "),
      windowText.lastIndexOf("? "),
      windowText.lastIndexOf("! "),
      windowText.lastIndexOf("; "),
      windowText.lastIndexOf(", "),
      windowText.lastIndexOf(" ")
    );
    const end = splitAt > MAX_TTS_CHARS * 0.6 ? splitAt + 1 : MAX_TTS_CHARS;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }

  return chunks.filter(Boolean);
}

export async function speak(params: {
  messageId: string;
  text: string;
  voice: TtsVoiceSymbol;
  audioEl: HTMLAudioElement;
  signal?: AbortSignal;
  allowBrowserFallback?: boolean;
}): Promise<SpeakResult> {
  const startedAt = performance.now();
  const chunks = splitTextForTts(params.text);
  const audioChunks: BlobPart[] = [];
  let firstByteMs: number | null = null;
  let status = 200;
  let voiceId: string | undefined;
  let model: string | undefined;

  for (const chunk of chunks) {
    if (params.signal?.aborted) {
      throw new DOMException("TTS request aborted.", "AbortError");
    }

    const response = await fetch("/api/tts", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messageId: params.messageId,
        text: chunk,
        voice: params.voice,
      }),
      signal: params.signal,
    });

    status = response.status;

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; missing?: string[]; upstreamStatus?: number }
        | null;
      const code = payload?.error ?? `TTS_HTTP_${response.status}`;

      if (params.allowBrowserFallback) {
        await speakWithBrowser(params.text, params.signal);
        return {
          provider: "browser",
          status: response.status,
          firstByteMs: null,
          playingMs: performance.now() - startedAt,
        };
      }

      throw new TtsClientError(code, {
        code,
        status: response.status,
        missing: payload?.missing,
        upstreamStatus: payload?.upstreamStatus,
      });
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("audio/")) {
      throw new TtsClientError("TTS_NON_AUDIO_RESPONSE", {
        code: "TTS_NON_AUDIO_RESPONSE",
        status: response.status,
      });
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new TtsClientError("TTS_EMPTY_STREAM", {
        code: "TTS_EMPTY_STREAM",
        status: response.status,
      });
    }

    voiceId ??= response.headers.get("x-tts-voice-id") ?? undefined;
    model ??= response.headers.get("x-tts-model") ?? undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (params.signal?.aborted) {
        throw new DOMException("TTS request aborted.", "AbortError");
      }
      if (value) {
        firstByteMs ??= performance.now() - startedAt;
        audioChunks.push(value.slice().buffer as ArrayBuffer);
      }
    }
  }

  if (audioChunks.length === 0) {
    throw new TtsClientError("TTS_EMPTY_AUDIO", {
      code: "TTS_EMPTY_AUDIO",
      status,
    });
  }

  const blob = new Blob(audioChunks, { type: "audio/mpeg" });
  const objectUrl = URL.createObjectURL(blob);
  params.audioEl.src = objectUrl;
  try {
    await params.audioEl.play();
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }

  return {
    provider: "elevenlabs",
    voiceId,
    model,
    status,
    firstByteMs,
    playingMs: params.audioEl.paused ? null : performance.now() - startedAt,
    objectUrl,
  };
}

function speakWithBrowser(text: string, signal?: AbortSignal) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    throw new TtsClientError("TTS_BROWSER_UNAVAILABLE", {
      code: "TTS_BROWSER_UNAVAILABLE",
    });
  }

  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    let settled = false;

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const abort = () => {
      window.speechSynthesis.cancel();
      rejectOnce(new DOMException("TTS browser fallback aborted.", "AbortError"));
    };

    signal?.addEventListener("abort", abort, { once: true });
    utterance.onstart = () => {
      signal?.removeEventListener("abort", abort);
      resolveOnce();
    };
    utterance.onend = () => {
      signal?.removeEventListener("abort", abort);
      resolveOnce();
    };
    utterance.onerror = () => {
      signal?.removeEventListener("abort", abort);
      rejectOnce(new TtsClientError("TTS_BROWSER_FAILED"));
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}
