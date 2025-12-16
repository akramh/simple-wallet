/**
 * @file e2e/jest.config.cjs
 * @description Jest config for Detox E2E tests.
 */

module.exports = {
  preset: 'detox',
  testTimeout: 120000,
  testMatch: ['<rootDir>/**/*.e2e.(js|ts)'],
  setupFilesAfterEnv: ['<rootDir>/init.js'],
};


