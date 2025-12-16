/**
 * @file detox.config.js
 * @description Detox configuration for mobile-wallet E2E smoke tests.
 *
 * @notes
 * - Detox requires a native build artifact (iOS simulator / Android emulator).
 * - The build command and binary path may need adjustment based on your local setup
 *   and the generated native project paths from `expo run:*`.
 */

/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.cjs',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.sim': {
      // NOTE: Update these for your app name and build output.
      // Common pattern after `expo run:ios` is a derived Xcode build path.
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/simplewalletmobile.app',
      build:
        'xcodebuild -workspace ios/simplewalletmobile.xcworkspace -scheme simplewalletmobile -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 15',
      },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.sim',
    },
  },
};


