import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.collisionacademy.collisioniq',
  appName: 'Collision IQ',
  webDir: 'dist', // placeholder (won't be used in live mode)
  server: {
    url: 'https://collision-iq.ai', // <-- YOUR LIVE DOMAIN
    cleartext: false
  }
};

export default config;
