/**
 * @file jest.setup.js
 * @description Global Jest setup for mobile-wallet tests.
 *
 * @responsibilities
 * - Extend Jest matchers for React Native testing-library
 * - Provide stable mocks for Expo/React Native modules used by the app
 * - Keep tests deterministic (no real storage, biometrics, haptics, or linking)
 */

require('@testing-library/jest-native/extend-expect');

// -----------------------------------------------------------------------------
// SafeAreaView mock (keeps layout wrappers from causing test env issues)
// -----------------------------------------------------------------------------
jest.mock('react-native-safe-area-context', () => {
  return {
    __esModule: true,
    // Avoid importing `react-native` here to keep Jest mock hoisting stable under NativeWind transforms.
    SafeAreaView: ({ children }) => children,
  };
});

// -----------------------------------------------------------------------------
// Vector icons mock (avoid native font loading)
// -----------------------------------------------------------------------------
jest.mock('@expo/vector-icons', () => {
  return {
    __esModule: true,
    // Render nothing; tests should not depend on icon glyph rendering.
    Ionicons: () => null,
  };
});

// -----------------------------------------------------------------------------
// AsyncStorage mock (used by MobileStorageAdapter)
// -----------------------------------------------------------------------------
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      getAllKeys: jest.fn(async () => Array.from(store.keys())),
      multiGet: jest.fn(async (keys) => keys.map((k) => [k, store.get(k) ?? null])),
      getItem: jest.fn(async (key) => store.get(key) ?? null),
      setItem: jest.fn(async (key, value) => void store.set(key, value)),
      removeItem: jest.fn(async (key) => void store.delete(key)),
      multiRemove: jest.fn(async (keys) => keys.forEach((k) => store.delete(k))),
      clear: jest.fn(async () => void store.clear()),
    },
  };
});

// -----------------------------------------------------------------------------
// SecureStore mock (used by MobileStorageAdapter and useBiometrics)
// -----------------------------------------------------------------------------
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    __esModule: true,
    getItemAsync: jest.fn(async (key) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key, value) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key) => void store.delete(key)),
  };
});

// -----------------------------------------------------------------------------
// Clipboard / Haptics / Linking mocks (UI helpers)
// -----------------------------------------------------------------------------
jest.mock('expo-clipboard', () => ({
  __esModule: true,
  setStringAsync: jest.fn(async () => {}),
  getStringAsync: jest.fn(async () => ''),
  hasStringAsync: jest.fn(async () => false),
}));

jest.mock('expo-haptics', () => ({
  __esModule: true,
  NotificationFeedbackType: { Success: 'success' },
  notificationAsync: jest.fn(async () => {}),
}));

jest.mock('expo-linking', () => ({
  __esModule: true,
  openURL: jest.fn(async () => true),
}));

// -----------------------------------------------------------------------------
// Biometrics mock (LocalAuthentication)
// -----------------------------------------------------------------------------
jest.mock('expo-local-authentication', () => ({
  __esModule: true,
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  supportedAuthenticationTypesAsync: jest.fn(async () => [2]),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));


