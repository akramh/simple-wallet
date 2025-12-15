/**
 * @fileoverview Tests for XRP module functionality.
 *
 * Tests BIP-44 address derivation, address validation, and utility functions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveXRPAddress,
  deriveXRPAddresses,
  getXRPDerivationPath,
  isValidXRPAddress,
  isXAddress,
  dropsToXrp,
  xrpToDrops,
  parseXrpToDropsExact,
  formatXrpAmount,
  calculateReserve,
  isValidDestinationTag,
  DROPS_PER_XRP,
  XRP_RESERVE_BASE,
  XRP_RESERVE_INCREMENT,
  BASE_FEE_DROPS
} from '../dist/xrp/index.js';

// Well-known test mnemonic (BIP-39 test vector)
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// ============================================================================
// Address Derivation Tests
// ============================================================================

test('deriveXRPAddress derives address from mnemonic', async () => {
  const result = deriveXRPAddress(TEST_MNEMONIC, 0);

  assert.ok(result.address, 'should return an address');
  assert.ok(result.address.startsWith('r'), 'XRP address should start with r');
  assert.ok(result.address.length >= 25 && result.address.length <= 35, 'address length should be 25-35');
  assert.ok(result.publicKey, 'should return a public key');
  assert.ok(result.derivationPath.includes("44'/144'"), 'should use XRP BIP-44 path');
});

test('deriveXRPAddress produces different addresses for different account indices', async () => {
  const addr0 = deriveXRPAddress(TEST_MNEMONIC, 0);
  const addr1 = deriveXRPAddress(TEST_MNEMONIC, 1);

  assert.notEqual(addr0.address, addr1.address, 'different accounts should have different addresses');
});

test('deriveXRPAddress returns consistent address for same mnemonic', async () => {
  const addr1 = deriveXRPAddress(TEST_MNEMONIC, 0);
  const addr2 = deriveXRPAddress(TEST_MNEMONIC, 0);

  assert.equal(addr1.address, addr2.address, 'same mnemonic should produce same address');
});

test('deriveXRPAddress throws on invalid mnemonic', async () => {
  assert.throws(
    () => deriveXRPAddress('invalid mnemonic phrase', 0),
    /Invalid mnemonic/,
    'should throw on invalid mnemonic'
  );
});

test('deriveXRPAddresses derives multiple addresses', async () => {
  const addresses = deriveXRPAddresses(TEST_MNEMONIC, 0, 5);

  assert.equal(addresses.length, 5, 'should return 5 addresses');

  // All addresses should be unique
  const uniqueAddresses = new Set(addresses.map(a => a.address));
  assert.equal(uniqueAddresses.size, 5, 'all addresses should be unique');

  // All should start with 'r'
  addresses.forEach(addr => {
    assert.ok(addr.address.startsWith('r'), 'all should be XRP addresses');
  });
});

test('getXRPDerivationPath returns correct path format', async () => {
  assert.equal(getXRPDerivationPath(0), "m/44'/144'/0'/0/0");
  assert.equal(getXRPDerivationPath(1), "m/44'/144'/1'/0/0");
  assert.equal(getXRPDerivationPath(5), "m/44'/144'/5'/0/0");
});

// ============================================================================
// Address Validation Tests
// ============================================================================

test('isValidXRPAddress accepts valid XRP addresses', () => {
  // Derive a valid address from test mnemonic
  const { address } = deriveXRPAddress(TEST_MNEMONIC, 0);

  assert.equal(isValidXRPAddress(address), true);
});

test('isValidXRPAddress rejects empty string', () => {
  assert.equal(isValidXRPAddress(''), false);
});

test('isValidXRPAddress rejects null and undefined', () => {
  assert.equal(isValidXRPAddress(null), false);
  assert.equal(isValidXRPAddress(undefined), false);
});

test('isValidXRPAddress rejects addresses not starting with r', () => {
  assert.equal(isValidXRPAddress('sN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9'), false);
  assert.equal(isValidXRPAddress('1N7n3473SaZBCG4dFL83w7a1RXtXtbk2D9'), false);
});

test('isValidXRPAddress rejects addresses that are too short', () => {
  assert.equal(isValidXRPAddress('rABC123'), false);
  assert.equal(isValidXRPAddress('r' + 'A'.repeat(20)), false);
});

test('isValidXRPAddress rejects addresses that are too long', () => {
  assert.equal(isValidXRPAddress('r' + 'A'.repeat(40)), false);
});

test('isValidXRPAddress rejects Ethereum addresses', () => {
  assert.equal(isValidXRPAddress('0x1234567890abcdef1234567890abcdef12345678'), false);
});

test('isValidXRPAddress rejects Bitcoin addresses', () => {
  // Bitcoin mainnet P2PKH starts with 1
  assert.equal(isValidXRPAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'), false);
  // Bitcoin native segwit starts with bc1
  assert.equal(isValidXRPAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), false);
});

test('isValidXRPAddress rejects invalid base58 characters', () => {
  // Base58 doesn't include 0, O, I, l
  assert.equal(isValidXRPAddress('r0OIl' + 'A'.repeat(24)), false);
});

test('isXAddress detects X-addresses', () => {
  // X-addresses start with X (mainnet) or T (testnet)
  assert.equal(isXAddress('X7AcgcsBL6XDcUb289X4mJ8djcdyKaLLLM6hbszc4NaEWDT'), true);
  assert.equal(isXAddress('T7YChPMWHxdKsttPe5KGhXNsJhGQRgzUvt7JhmBL4pHPSWZ'), true);

  // Classic addresses should return false
  const { address } = deriveXRPAddress(TEST_MNEMONIC, 0);
  assert.equal(isXAddress(address), false);
});

// ============================================================================
// Constants Tests
// ============================================================================

test('DROPS_PER_XRP is correct', async () => {
  assert.equal(DROPS_PER_XRP, 1000000, 'should be 1 million');
});

test('XRP_RESERVE_BASE is correct (10 XRP in drops)', async () => {
  assert.equal(XRP_RESERVE_BASE, 10000000, 'should be 10 million drops');
});

test('XRP_RESERVE_INCREMENT is correct (2 XRP in drops)', async () => {
  assert.equal(XRP_RESERVE_INCREMENT, 2000000, 'should be 2 million drops');
});

test('BASE_FEE_DROPS is reasonable', async () => {
  assert.ok(BASE_FEE_DROPS >= 10 && BASE_FEE_DROPS <= 20, 'base fee should be around 10-20 drops');
});

// ============================================================================
// Unit Conversion Tests
// ============================================================================

test('dropsToXrp converts correctly', async () => {
  assert.equal(dropsToXrp(1000000), '1.000000');
  assert.equal(dropsToXrp(500000), '0.500000');
  assert.equal(dropsToXrp(1), '0.000001');
  assert.equal(dropsToXrp(0), '0.000000');
  assert.equal(dropsToXrp(1234567), '1.234567');
});

test('dropsToXrp accepts string input', async () => {
  assert.equal(dropsToXrp('1000000'), '1.000000');
  assert.equal(dropsToXrp('500000'), '0.500000');
});

test('xrpToDrops converts correctly', async () => {
  assert.equal(xrpToDrops('1'), 1000000);
  assert.equal(xrpToDrops('0.5'), 500000);
  assert.equal(xrpToDrops('0.000001'), 1);
  assert.equal(xrpToDrops('0'), 0);
  assert.equal(xrpToDrops('1.234567'), 1234567);
});

test('xrpToDrops accepts number input', async () => {
  assert.equal(xrpToDrops(1), 1000000);
  assert.equal(xrpToDrops(0.5), 500000);
});

test('parseXrpToDropsExact handles exact decimal precision', async () => {
  assert.equal(parseXrpToDropsExact('1'), 1000000);
  assert.equal(parseXrpToDropsExact('1.0'), 1000000);
  assert.equal(parseXrpToDropsExact('1.000000'), 1000000);
  assert.equal(parseXrpToDropsExact('0.000001'), 1);
  assert.equal(parseXrpToDropsExact('123.456789'), 123456789);
});

test('parseXrpToDropsExact throws on invalid format', async () => {
  assert.throws(
    () => parseXrpToDropsExact('abc'),
    /Invalid XRP amount format/
  );
  assert.throws(
    () => parseXrpToDropsExact('-1'),
    /Invalid XRP amount format/
  );
});

test('parseXrpToDropsExact throws on too many decimal places', async () => {
  assert.throws(
    () => parseXrpToDropsExact('1.0000001'),
    /too many decimal places/
  );
});

test('formatXrpAmount formats with appropriate precision', async () => {
  assert.equal(formatXrpAmount(1000000), '1.00 XRP');
  assert.equal(formatXrpAmount(1500000), '1.50 XRP');
  assert.equal(formatXrpAmount(1000), '0.001 XRP');
  assert.equal(formatXrpAmount(1), '0.000001 XRP');
  assert.equal(formatXrpAmount(0), '0.00 XRP');
});

test('formatXrpAmount accepts custom symbol', async () => {
  assert.equal(formatXrpAmount(1000000, 'tXRP'), '1.00 tXRP');
});

// ============================================================================
// Reserve Calculation Tests
// ============================================================================

test('calculateReserve computes base reserve correctly', async () => {
  // 0 owned objects = base reserve only (10 XRP)
  assert.equal(calculateReserve(0), 10000000);
});

test('calculateReserve computes owner reserve correctly', async () => {
  // 1 owned object = 10 + 2 = 12 XRP
  assert.equal(calculateReserve(1), 12000000);
  // 5 owned objects = 10 + (5 * 2) = 20 XRP
  assert.equal(calculateReserve(5), 20000000);
});

// ============================================================================
// Destination Tag Validation Tests
// ============================================================================

test('isValidDestinationTag accepts valid tags', async () => {
  assert.equal(isValidDestinationTag(0), true);
  assert.equal(isValidDestinationTag(12345), true);
  assert.equal(isValidDestinationTag(4294967295), true); // max uint32
  assert.equal(isValidDestinationTag('12345'), true);
});

test('isValidDestinationTag accepts empty/undefined (optional field)', async () => {
  assert.equal(isValidDestinationTag(undefined), true);
  assert.equal(isValidDestinationTag(null), true);
  assert.equal(isValidDestinationTag(''), true);
});

test('isValidDestinationTag rejects negative numbers', async () => {
  assert.equal(isValidDestinationTag(-1), false);
  assert.equal(isValidDestinationTag('-1'), false);
});

test('isValidDestinationTag rejects numbers greater than uint32 max', async () => {
  assert.equal(isValidDestinationTag(4294967296), false);
  assert.equal(isValidDestinationTag('4294967296'), false);
});

test('isValidDestinationTag rejects non-integers', async () => {
  assert.equal(isValidDestinationTag(12.5), false);
  assert.equal(isValidDestinationTag('12.5'), false);
  assert.equal(isValidDestinationTag('abc'), false);
});

// ============================================================================
// Edge Cases
// ============================================================================

test('dropsToXrp handles large values', () => {
  // Max XRP supply is 100 billion (100e9)
  const largeAmount = 100_000_000_000 * DROPS_PER_XRP;
  const result = dropsToXrp(largeAmount);

  assert.ok(result.startsWith('100000000000'), 'should handle max supply');
});

test('dropsToXrp handles zero', () => {
  assert.equal(dropsToXrp(0), '0.000000');
});

test('xrpToDrops handles zero string', () => {
  assert.equal(xrpToDrops('0'), 0);
  assert.equal(xrpToDrops('0.0'), 0);
  assert.equal(xrpToDrops('0.000000'), 0);
});

// ============================================================================
// Explorer Tests
// ============================================================================

import {
  XRPExplorer,
  getXRPExplorer,
  isXRPNetwork
} from '../dist/xrp/explorer.js';

test('isXRPNetwork identifies XRP networks correctly', () => {
  assert.equal(isXRPNetwork('xrp-mainnet'), true);
  assert.equal(isXRPNetwork('xrp-testnet'), true);
  assert.equal(isXRPNetwork('xrp-devnet'), true);
  assert.equal(isXRPNetwork('mainnet'), false);
  assert.equal(isXRPNetwork('bitcoin-mainnet'), false);
  assert.equal(isXRPNetwork('solana-mainnet'), false);
});

test('getXRPExplorer returns singleton instances', () => {
  const mainnet1 = getXRPExplorer('xrp-mainnet');
  const mainnet2 = getXRPExplorer('xrp-mainnet');

  assert.strictEqual(mainnet1, mainnet2, 'should return same instance');
});

test('getXRPExplorer returns different instances for different networks', () => {
  const mainnet = getXRPExplorer('xrp-mainnet');
  const testnet = getXRPExplorer('xrp-testnet');

  assert.notStrictEqual(mainnet, testnet, 'should return different instances');
});

test('XRPExplorer constructor uses correct default URLs', () => {
  const mainnetExplorer = new XRPExplorer('mainnet');
  const testnetExplorer = new XRPExplorer('testnet');

  assert.equal(mainnetExplorer.getNetwork(), 'mainnet');
  assert.equal(testnetExplorer.getNetwork(), 'testnet');
});

test('XRPExplorer getTransactionUrl returns correct URL format', () => {
  const explorer = new XRPExplorer('mainnet');
  const hash = 'ABC123DEF456';

  const url = explorer.getTransactionUrl(hash);

  assert.ok(url.includes(hash), 'URL should contain transaction hash');
  assert.ok(url.includes('xrpscan.com') || url.includes('xrpl.org'), 'URL should be xrpscan or xrpl explorer');
});

test('XRPExplorer getAddressUrl returns correct URL format', () => {
  const explorer = new XRPExplorer('mainnet');
  const address = 'rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';

  const url = explorer.getAddressUrl(address);

  assert.ok(url.includes(address), 'URL should contain address');
  assert.ok(url.includes('xrpscan.com') || url.includes('xrpl.org'), 'URL should be xrpscan or xrpl explorer');
});

test('XRPExplorer clearCache does not throw', () => {
  const explorer = new XRPExplorer('mainnet');

  assert.doesNotThrow(() => {
    explorer.clearCache();
  });
});

// ============================================================================
// Provider Tests
// ============================================================================

import {
  XRPProvider,
  getXRPProvider
} from '../dist/xrp/provider.js';

test('getXRPProvider returns singleton instances', () => {
  const mainnet1 = getXRPProvider('xrp-mainnet');
  const mainnet2 = getXRPProvider('xrp-mainnet');

  assert.strictEqual(mainnet1, mainnet2, 'should return same instance');
});

test('getXRPProvider returns different instances for different networks', () => {
  const mainnet = getXRPProvider('xrp-mainnet');
  const testnet = getXRPProvider('xrp-testnet');

  assert.notStrictEqual(mainnet, testnet, 'should return different instances');
});

test('XRPProvider getNetworkKey returns correct network key', () => {
  const provider = new XRPProvider({ networkKey: 'xrp-mainnet', network: 'mainnet' });

  assert.equal(provider.getNetworkKey(), 'xrp-mainnet');
});

test('XRPProvider getNetwork returns correct network type', () => {
  const mainnetProvider = new XRPProvider({ networkKey: 'xrp-mainnet', network: 'mainnet' });
  const testnetProvider = new XRPProvider({ networkKey: 'xrp-testnet', network: 'testnet' });

  assert.equal(mainnetProvider.getNetwork(), 'mainnet');
  assert.equal(testnetProvider.getNetwork(), 'testnet');
});

test('XRPProvider deriveAddress derives XRP address correctly', () => {
  const provider = new XRPProvider({ networkKey: 'xrp-mainnet', network: 'mainnet' });

  const addressInfo = provider.deriveAddress(TEST_MNEMONIC, 0);

  assert.ok(addressInfo.address, 'should return an address');
  assert.ok(addressInfo.address.startsWith('r'), 'XRP address should start with r');
  assert.ok(addressInfo.publicKey, 'should return a public key');
});

test('XRPProvider getCurrentAddress returns null before deriveAddress', () => {
  const provider = new XRPProvider({ networkKey: 'xrp-mainnet', network: 'mainnet' });

  assert.equal(provider.getCurrentAddress(), null);
});

test('XRPProvider getCurrentAddress returns address after deriveAddress', () => {
  const provider = new XRPProvider({ networkKey: 'xrp-mainnet', network: 'mainnet' });

  const addressInfo = provider.deriveAddress(TEST_MNEMONIC, 0);

  assert.equal(provider.getCurrentAddress(), addressInfo.address);
});

test('XRPProvider getNativeToken returns correct token info for mainnet', () => {
  const provider = new XRPProvider({ networkKey: 'xrp-mainnet', network: 'mainnet' });

  const token = provider.getNativeToken();

  assert.equal(token.symbol, 'XRP');
  assert.equal(token.name, 'XRP');
  assert.equal(token.decimals, 6);
  assert.equal(token.type, 'native');
});

test('XRPProvider getNativeToken returns correct token info for testnet', () => {
  const provider = new XRPProvider({ networkKey: 'xrp-testnet', network: 'testnet' });

  const token = provider.getNativeToken();

  assert.equal(token.symbol, 'tXRP');
  assert.ok(token.name.includes('Testnet'), 'testnet should indicate testnet in name');
  assert.equal(token.decimals, 6);
  assert.equal(token.type, 'native');
});

test('XRPProvider isValidAddress validates XRP addresses', () => {
  const provider = new XRPProvider({ networkKey: 'xrp-mainnet', network: 'mainnet' });

  // Valid XRP address
  const { address } = deriveXRPAddress(TEST_MNEMONIC, 0);
  assert.equal(provider.isValidAddress(address), true);

  // Invalid addresses
  assert.equal(provider.isValidAddress(''), false);
  assert.equal(provider.isValidAddress('0x1234567890abcdef1234567890abcdef12345678'), false);
  assert.equal(provider.isValidAddress('invalid'), false);
});

test('XRPProvider getTransactionUrl returns explorer URL', () => {
  const provider = new XRPProvider({ networkKey: 'xrp-mainnet', network: 'mainnet' });
  const txid = 'ABC123';

  const url = provider.getTransactionUrl(txid);

  assert.ok(url.includes(txid), 'URL should contain transaction ID');
});

test('XRPProvider getAddressUrl returns explorer URL', () => {
  const provider = new XRPProvider({ networkKey: 'xrp-mainnet', network: 'mainnet' });
  const address = 'rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9';

  const url = provider.getAddressUrl(address);

  assert.ok(url.includes(address), 'URL should contain address');
});

test('XRPProvider getPortfolio returns error result when no address', async () => {
  const provider = new XRPProvider({ networkKey: 'xrp-mainnet', network: 'mainnet' });

  const portfolio = await provider.getPortfolio();

  assert.equal(portfolio.length, 1);
  assert.ok(portfolio[0].error, 'should have error when no address');
  assert.equal(portfolio[0].balance, '0');
});

// ============================================================================
// Transaction Module Tests
// ============================================================================

import {
  buildPaymentTransaction,
  signPaymentTransaction,
  buildAndSignPayment,
  validateSufficientBalance,
  calculateMaxSendable,
  validateRecipientActivation,
  parseAmountToDrops,
  estimateTransferCost
} from '../dist/xrp/transaction.js';

import { getXRPWallet } from '../dist/xrp/address.js';

// Get a valid test wallet for transaction tests
const testWallet = getXRPWallet(TEST_MNEMONIC, 0);
const TEST_FROM_ADDRESS = testWallet.address;
// Derive a second address for recipient
const testWallet2 = getXRPWallet(TEST_MNEMONIC, 1);
const TEST_TO_ADDRESS = testWallet2.address;

test('buildPaymentTransaction creates unsigned transaction', () => {
  const params = {
    fromAddress: TEST_FROM_ADDRESS,
    toAddress: TEST_TO_ADDRESS,
    amountDrops: 1000000, // 1 XRP
    feeDrops: 12,
    sequence: 100,
    lastLedgerSequence: 12345678
  };

  const tx = buildPaymentTransaction(params);

  assert.equal(tx.TransactionType, 'Payment');
  assert.equal(tx.Account, params.fromAddress);
  assert.equal(tx.Destination, params.toAddress);
  assert.equal(tx.Amount, '1000000');
  assert.equal(tx.Fee, '12');
  assert.equal(tx.Sequence, 100);
  assert.equal(tx.LastLedgerSequence, 12345678);
  assert.equal(tx.DestinationTag, undefined);
});

test('buildPaymentTransaction includes destination tag when provided', () => {
  const params = {
    fromAddress: TEST_FROM_ADDRESS,
    toAddress: TEST_TO_ADDRESS,
    amountDrops: 1000000,
    feeDrops: 12,
    sequence: 100,
    destinationTag: 12345,
    lastLedgerSequence: 12345678
  };

  const tx = buildPaymentTransaction(params);

  assert.equal(tx.DestinationTag, 12345);
});

test('buildPaymentTransaction validates addresses', () => {
  const params = {
    fromAddress: 'invalid',
    toAddress: TEST_TO_ADDRESS,
    amountDrops: 1000000,
    feeDrops: 12,
    sequence: 100,
    lastLedgerSequence: 12345678
  };

  assert.throws(
    () => buildPaymentTransaction(params),
    /Invalid sender address/
  );
});

test('buildPaymentTransaction validates recipient address', () => {
  const params = {
    fromAddress: TEST_FROM_ADDRESS,
    toAddress: 'invalid',
    amountDrops: 1000000,
    feeDrops: 12,
    sequence: 100,
    lastLedgerSequence: 12345678
  };

  assert.throws(
    () => buildPaymentTransaction(params),
    /Invalid recipient address/
  );
});

test('buildPaymentTransaction validates destination tag', () => {
  const params = {
    fromAddress: TEST_FROM_ADDRESS,
    toAddress: TEST_TO_ADDRESS,
    amountDrops: 1000000,
    feeDrops: 12,
    sequence: 100,
    destinationTag: 4294967296, // > max uint32
    lastLedgerSequence: 12345678
  };

  assert.throws(
    () => buildPaymentTransaction(params),
    /Invalid destination tag/
  );
});

test('signPaymentTransaction signs and returns blob and hash', () => {
  const wallet = getXRPWallet(TEST_MNEMONIC, 0);
  const tx = {
    TransactionType: 'Payment',
    Account: wallet.address,
    Destination: TEST_TO_ADDRESS,
    Amount: '1000000',
    Fee: '12',
    Sequence: 100,
    LastLedgerSequence: 12345678
  };

  const signed = signPaymentTransaction(tx, wallet);

  assert.ok(signed.txBlob, 'should return tx blob');
  assert.ok(signed.hash, 'should return hash');
  assert.ok(signed.txBlob.length > 0, 'blob should not be empty');
  assert.ok(signed.hash.length === 64, 'hash should be 64 hex chars');
});

test('buildAndSignPayment builds and signs in one call', () => {
  const wallet = getXRPWallet(TEST_MNEMONIC, 0);
  const params = {
    fromAddress: wallet.address,
    toAddress: TEST_TO_ADDRESS,
    amountDrops: 1000000,
    feeDrops: 12,
    sequence: 100,
    lastLedgerSequence: 12345678
  };

  const signed = buildAndSignPayment(params, wallet);

  assert.ok(signed.txBlob, 'should return tx blob');
  assert.ok(signed.hash, 'should return hash');
});

test('validateSufficientBalance passes for sufficient balance', () => {
  // Balance: 100 XRP, sending 10 XRP, fee 12 drops, 0 owned objects
  assert.doesNotThrow(() => {
    validateSufficientBalance(100_000_000, 10_000_000, 12, 0);
  });
});

test('validateSufficientBalance throws for insufficient balance', () => {
  // Balance: 15 XRP, sending 10 XRP, fee 12 drops, 0 owned objects
  // Reserve is 10 XRP, so only 5 XRP available
  assert.throws(
    () => validateSufficientBalance(15_000_000, 10_000_000, 12, 0),
    /Insufficient XRP balance/
  );
});

test('validateSufficientBalance accounts for owner count', () => {
  // Balance: 20 XRP, sending 10 XRP, fee 12 drops, 3 owned objects
  // Reserve is 10 + (3*2) = 16 XRP, so only 4 XRP available
  assert.throws(
    () => validateSufficientBalance(20_000_000, 10_000_000, 12, 3),
    /Insufficient XRP balance/
  );
});

test('calculateMaxSendable returns correct value', () => {
  // Balance: 100 XRP, fee 12 drops, 0 owned objects
  // Reserve is 10 XRP, so max sendable is 90 XRP - 12 drops
  const max = calculateMaxSendable(100_000_000, 12, 0);

  assert.equal(max, 89_999_988);
});

test('calculateMaxSendable accounts for owner count', () => {
  // Balance: 100 XRP, fee 12 drops, 5 owned objects
  // Reserve is 10 + (5*2) = 20 XRP, so max sendable is 80 XRP - 12 drops
  const max = calculateMaxSendable(100_000_000, 12, 5);

  assert.equal(max, 79_999_988);
});

test('calculateMaxSendable returns 0 when balance below reserve', () => {
  // Balance: 5 XRP, fee 12 drops, 0 owned objects
  // Reserve is 10 XRP, so max sendable is 0 (negative balance)
  const max = calculateMaxSendable(5_000_000, 12, 0);

  assert.equal(max, 0);
});

test('validateRecipientActivation passes for activated account', () => {
  assert.doesNotThrow(() => {
    validateRecipientActivation(1_000_000, true); // 1 XRP to activated account
  });
});

test('validateRecipientActivation passes for unactivated account with enough', () => {
  assert.doesNotThrow(() => {
    validateRecipientActivation(10_000_000, false); // 10 XRP to new account
  });
});

test('validateRecipientActivation throws for unactivated account with too little', () => {
  assert.throws(
    () => validateRecipientActivation(5_000_000, false), // 5 XRP to new account
    /Cannot send.*to a new account/
  );
});

test('parseAmountToDrops parses string amounts', () => {
  assert.equal(parseAmountToDrops('1'), 1_000_000);
  assert.equal(parseAmountToDrops('0.5'), 500_000);
  assert.equal(parseAmountToDrops('10.123456'), 10_123_456);
});

test('parseAmountToDrops parses string with leading/trailing spaces', () => {
  assert.equal(parseAmountToDrops('  1  '), 1_000_000);
  assert.equal(parseAmountToDrops(' 0.5 '), 500_000);
});

test('estimateTransferCost returns cost breakdown', () => {
  const cost = estimateTransferCost('10', 12);

  assert.equal(cost.amountDrops, 10_000_000);
  assert.equal(cost.feeDrops, 12);
  assert.equal(cost.totalDrops, 10_000_012);
  assert.equal(cost.amountXrpStr, '10.000000');
  assert.equal(cost.feeXrpStr, '0.000012');
  assert.ok(cost.totalXrpStr, 'should have total XRP string');
});
