/**
 * Stub for react-native-quick-base64 that uses base64-js instead.
 *
 * The native react-native-quick-base64 module has issues with base64 decoding
 * that cause @ton/core to fail with "Offset + Length is out of bounds" errors.
 *
 * This stub re-exports base64-js which is pure JavaScript and works correctly.
 */
'use strict';

const base64js = require('base64-js');

// Re-export base64-js functions with the same API
module.exports = {
  byteLength: base64js.byteLength,
  toByteArray: base64js.toByteArray,
  fromByteArray: base64js.fromByteArray,

  // Extras that react-native-quick-base64 provides
  btoa: (str) => {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i);
    }
    return base64js.fromByteArray(bytes);
  },

  atob: (b64) => {
    const bytes = base64js.toByteArray(b64);
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      result += String.fromCharCode(bytes[i]);
    }
    return result;
  },

  shim: () => {
    global.btoa = module.exports.btoa;
    global.atob = module.exports.atob;
  },

  getNative: () => ({
    base64FromArrayBuffer: null,
    base64ToArrayBuffer: null,
  }),

  trimBase64Padding: (str) => str.replace(/[.=]{1,2}$/, ''),
};
