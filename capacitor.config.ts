import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.collisionacademy.collisioniq',
  appName: 'Collision IQ',
  webDir: 'out',
  server: {
    url: 'https://www.collision-iq.ai',
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: ['www.collision-iq.ai', 'collision-iq.ai'],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
    },
  },
};

export default config;
