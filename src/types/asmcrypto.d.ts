declare module 'asmcrypto.js' {
  export function Pbkdf2HmacSha256(password: Uint8Array, salt: Uint8Array, iterations: number, keyLength: number): Uint8Array;
  export const AES_GCM: {
    encrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array;
    decrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array;
  };
}
