/**
 * @fileoverview Tests for the runtime Alchemy key precedence in
 * bundled-config: a user-entered key must win over the build-time Expo
 * extra value, and clearing it must fall back cleanly.
 */

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        alchemyApiKey: 'buildtime-key-123456',
      },
    },
  },
}));

// Import after the Constants mock so module init sees the mocked extra.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAlchemyApiKey, setRuntimeAlchemyKey } = require('../config/bundled-config');

describe('runtime Alchemy key precedence', () => {
  afterEach(() => {
    setRuntimeAlchemyKey(null);
  });

  it('falls back to the build-time key when no runtime key is set', () => {
    expect(getAlchemyApiKey()).toBe('buildtime-key-123456');
  });

  it('runtime key wins over the build-time key', () => {
    setRuntimeAlchemyKey('runtime-key-abcdef');
    expect(getAlchemyApiKey()).toBe('runtime-key-abcdef');
  });

  it('clearing the runtime key restores the build-time key', () => {
    setRuntimeAlchemyKey('runtime-key-abcdef');
    setRuntimeAlchemyKey(null);
    expect(getAlchemyApiKey()).toBe('buildtime-key-123456');
  });

  it('blank or whitespace runtime keys are treated as unset', () => {
    setRuntimeAlchemyKey('   ');
    expect(getAlchemyApiKey()).toBe('buildtime-key-123456');
  });

  it('trims the runtime key', () => {
    setRuntimeAlchemyKey('  padded-runtime-key  ');
    expect(getAlchemyApiKey()).toBe('padded-runtime-key');
  });
});
