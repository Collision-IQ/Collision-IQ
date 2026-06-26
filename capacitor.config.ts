import type { CapacitorConfig } from '@capacitor/cli';

const PRODUCTION_SERVER_URL = 'https://www.collision-iq.ai';
const capServerUrl = process.env.CAP_SERVER_URL?.trim();
const serverUrl = capServerUrl || PRODUCTION_SERVER_URL;
const serverUrlHost = new URL(serverUrl).hostname;
const isDebugServerOverride = Boolean(capServerUrl);
const isCleartextServer = serverUrl.startsWith('http://');

const config: CapacitorConfig = {
  appId: 'com.collisionacademy.collisioniq',
  appName: 'Collision IQ',
  webDir: 'out',
  server: {
    url: serverUrl,
    cleartext: isCleartextServer,
    androidScheme: isCleartextServer ? 'http' : 'https',
    allowNavigation: [
      serverUrlHost,
      'www.collision-iq.ai',
      'collision-iq.ai',
      'clerk.collision-iq.ai',
      'accounts.clerk.services',
    ].filter((host, index, hosts) => hosts.indexOf(host) === index),
  },
  android: {
    allowMixedContent: isCleartextServer,
    captureInput: true,
    webContentsDebuggingEnabled: isDebugServerOverride,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0a0c0e',
      showSpinner: false,
    },
  },
};

export default config;
