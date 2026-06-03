import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.lokalane.app',
  appName: 'LokaLane',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
