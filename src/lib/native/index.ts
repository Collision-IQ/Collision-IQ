export {
  isNative,
  getPlatform,
  onAppStateChange,
  onBackButton,
  takeCameraPhoto,
  pickPhotoFromGallery,
  saveFileToDownloads,
  readFileAsBase64,
  nativeShare,
  bindAudioToAppLifecycle,
} from './capacitor-bridge';

export type { CameraPhoto } from './capacitor-bridge';
