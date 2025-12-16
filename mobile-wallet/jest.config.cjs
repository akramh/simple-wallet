/**
 * @file jest.config.cjs
 * @description Jest configuration for the Expo React Native mobile app.
 *
 * Uses `jest-expo` to provide Expo + React Native transforms and defaults.
 * We keep tests deterministic by mocking Expo modules and avoiding live network calls.
 */

module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/**/__tests__/**/*.(test|spec).(ts|tsx|js)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Map shared core imports used by the mobile app to the workspace source tree.
  // Note: many mobile modules import `@wallet/*.js` (ESM-style); Jest needs explicit mapping.
  moduleNameMapper: {
    '^@wallet/(.*)\\.js$': '<rootDir>/../src/$1.ts',
    '^@wallet/(.*)$': '<rootDir>/../src/$1.ts',
  },
  // Keep RN/Expo dependencies transformed when required by the preset.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|@react-navigation|expo(nent)?|expo-.*|@expo|expo-router|nativewind|react-native-css-interop)/)',
  ],
};


