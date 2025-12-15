/**
 * @file fs.js
 * @description Stub for Node.js 'fs' module in React Native
 * 
 * The wallet SDK imports 'fs' for file operations in CLI mode,
 * but mobile uses SecureStore/AsyncStorage instead. These stubs
 * allow the code to compile while the actual storage is handled
 * by MobileStorageAdapter.
 */

// Stub implementations that throw helpful errors if accidentally called
const notAvailable = (method) => {
  return (...args) => {
    console.warn(`fs.${method} is not available in React Native. Use MobileStorageAdapter.`);
    throw new Error(`fs.${method} is not supported in React Native`);
  };
};

module.exports = {
  existsSync: () => false,
  readFileSync: notAvailable('readFileSync'),
  writeFileSync: notAvailable('writeFileSync'),
  copyFileSync: notAvailable('copyFileSync'),
  renameSync: notAvailable('renameSync'),
  unlinkSync: notAvailable('unlinkSync'),
  statSync: notAvailable('statSync'),
  mkdirSync: notAvailable('mkdirSync'),
  readdirSync: notAvailable('readdirSync'),
  promises: {
    readFile: notAvailable('promises.readFile'),
    writeFile: notAvailable('promises.writeFile'),
    mkdir: notAvailable('promises.mkdir'),
    unlink: notAvailable('promises.unlink'),
    access: notAvailable('promises.access'),
  },
};
