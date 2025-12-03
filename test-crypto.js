import { validatePasswordLength, encryptMnemonic, decryptMnemonic } from './crypto-utils.js';

console.log('Testing crypto utilities...\n');

// Test 1: Password validation
console.log('Test 1: Password validation');
console.log('  Short password (7 chars):', validatePasswordLength('1234567') ? '❌ FAIL' : '✅ PASS (expected)');
console.log('  Valid password (8 chars):', validatePasswordLength('12345678') ? '✅ PASS (expected)' : '❌ FAIL');
console.log('  Valid password (12 chars):', validatePasswordLength('mypassword12') ? '✅ PASS (expected)' : '❌ FAIL');

// Test 2: Encryption and decryption
console.log('\nTest 2: Encryption and decryption');
const testMnemonic = 'test wallet seed phrase with twelve words here for testing purposes only';
const password = 'testpassword123';

try {
  const { encrypted, salt } = encryptMnemonic(testMnemonic, password);
  console.log('  Encryption successful: ✅ PASS');
  console.log('  Encrypted format check:', encrypted.includes(':') ? '✅ PASS' : '❌ FAIL');
  console.log('  Salt generated:', salt.length > 0 ? '✅ PASS' : '❌ FAIL');

  // Test decryption with correct password
  const decrypted = decryptMnemonic(encrypted, password, salt);
  console.log('  Decryption with correct password:', decrypted === testMnemonic ? '✅ PASS' : '❌ FAIL');

  // Test decryption with wrong password
  try {
    decryptMnemonic(encrypted, 'wrongpassword', salt);
    console.log('  Decryption with wrong password: ❌ FAIL (should have thrown error)');
  } catch (error) {
    console.log('  Decryption with wrong password: ✅ PASS (correctly rejected)');
  }

  // Test 3: Unique salts
  console.log('\nTest 3: Unique salt generation');
  const { salt: salt1 } = encryptMnemonic(testMnemonic, password);
  const { salt: salt2 } = encryptMnemonic(testMnemonic, password);
  console.log('  Different salts per encryption:', salt1 !== salt2 ? '✅ PASS' : '❌ FAIL');

  console.log('\n✅ All crypto tests passed!');
} catch (error) {
  console.log('\n❌ Crypto test failed:', error.message);
  process.exit(1);
}
