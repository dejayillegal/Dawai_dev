import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aidaw.app',
  appName: 'AIDAW',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
