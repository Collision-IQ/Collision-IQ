/**
 * Thin Capacitor bridge — all platform checks stay in this module.
 * Import only from "use client" components or browser-side code.
 * Never import this from server components, API routes, or SSR paths.
 */

// ─── Platform detection ───────────────────────────────────────────────────────

let _isNative: boolean | null = null;

export function isNative(): boolean {
  if (_isNative !== null) return _isNative;
  if (typeof window === 'undefined') return (_isNative = false);
  _isNative =
    'Capacitor' in window &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Capacitor?.isNativePlatform?.() === true;
  return _isNative;
}

export function getPlatform(): 'android' | 'ios' | 'web' {
  if (typeof window === 'undefined') return 'web';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return 'web';
  return cap.getPlatform() as 'android' | 'ios';
}

// ─── App lifecycle (foreground / background / back button) ───────────────────

type AppStateListener = (isActive: boolean) => void;
type BackButtonListener = () => void;

const _appListeners = new Set<AppStateListener>();
const _backListeners = new Set<BackButtonListener>();
let _appPluginHandle: { remove: () => void } | null = null;
let _backPluginHandle: { remove: () => void } | null = null;

export function onAppStateChange(cb: AppStateListener): () => void {
  _appListeners.add(cb);
  _initAppStateListener();
  return () => _appListeners.delete(cb);
}

export function onBackButton(cb: BackButtonListener): () => void {
  _backListeners.add(cb);
  _initBackButtonListener();
  return () => _backListeners.delete(cb);
}

async function _initAppStateListener() {
  if (_appPluginHandle || !isNative()) return;
  try {
    const { App } = await import('@capacitor/app');
    _appPluginHandle = await App.addListener('appStateChange', ({ isActive }) => {
      _appListeners.forEach((cb) => cb(isActive));
    });
  } catch {
    // not a native build
  }
}

async function _initBackButtonListener() {
  if (_backPluginHandle || !isNative()) return;
  try {
    const { App } = await import('@capacitor/app');
    _backPluginHandle = await App.addListener('backButton', () => {
      if (_backListeners.size === 0) {
        // No handler registered — exit the app
        App.exitApp();
        return;
      }
      _backListeners.forEach((cb) => cb());
    });
  } catch {
    // not a native build
  }
}

// ─── Camera ──────────────────────────────────────────────────────────────────

export type CameraPhoto = {
  dataUrl: string; // data:image/jpeg;base64,...
  format: string;
};

export async function takeCameraPhoto(): Promise<CameraPhoto | null> {
  if (!isNative()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      quality: 85,
    });
    if (!photo.dataUrl) return null;
    return { dataUrl: photo.dataUrl, format: photo.format };
  } catch {
    return null;
  }
}

export async function pickPhotoFromGallery(): Promise<CameraPhoto | null> {
  if (!isNative()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Photos,
      quality: 85,
    });
    if (!photo.dataUrl) return null;
    return { dataUrl: photo.dataUrl, format: photo.format };
  } catch {
    return null;
  }
}

// ─── Filesystem / downloads ──────────────────────────────────────────────────

export async function saveFileToDownloads(
  filename: string,
  base64Data: string,
  mimeType: string
): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({
      path: filename,
      data: base64Data,
      directory: Directory.Documents,
      recursive: true,
    });
    return true;
  } catch (err) {
    console.warn('[native] saveFileToDownloads failed', err);
    return false;
  }
}

export async function readFileAsBase64(path: string): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const result = await Filesystem.readFile({
      path,
      directory: Directory.Documents,
    });
    return typeof result.data === 'string' ? result.data : null;
  } catch {
    return null;
  }
}

// ─── Share ───────────────────────────────────────────────────────────────────

export async function nativeShare(options: {
  title?: string;
  text?: string;
  url?: string;
  dialogTitle?: string;
}): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { Share } = await import('@capacitor/share');
    const canShare = await Share.canShare();
    if (!canShare.value) return false;
    await Share.share(options);
    return true;
  } catch {
    return false;
  }
}

// ─── Audio lifecycle helpers ─────────────────────────────────────────────────

/**
 * Pauses an HTMLAudioElement when the app goes to background,
 * resumes when it returns to foreground.
 * Returns a cleanup function — call it when the component unmounts.
 */
export function bindAudioToAppLifecycle(audioRef: { current: HTMLAudioElement | null }): () => void {
  if (!isNative()) return () => {};
  const off = onAppStateChange((isActive) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isActive) {
      audio.pause();
    } else if (!audio.ended) {
      audio.play().catch(() => {});
    }
  });
  return off;
}
