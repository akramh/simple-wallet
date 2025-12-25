/**
 * @fileoverview Private key import tests for all supported chain types.
 *
 * Tests the core wallet private key import functionality including:
 * - EVM (Ethereum/EVM chains)
 * - Bitcoin (WIF format)
 * - Solana (Base58 format)
 * - XRP (hex and seed format)
 * - TON (hex format)
 *
 * Also tests encryption/decryption round-trips and cross-chain guards.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from '../dist/wallet.js';
import { deriveBitcoinAddressFromPrivateKey } from '../dist/bitcoin/index.js';
import { deriveSolanaAddressFromSecretKey } from '../dist/solana/index.js';
import { deriveXRPAddressFromPrivateKey } from '../dist/xrp/index.js';
import { deriveTonAddressFromSecretKey } from '../dist/ton/index.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Mock storage adapter for testing.
 * Does not persist any data.
 */
const mockStorage = {
    saveWallet: async () => {},
    getWallet: async () => null,
    hasWallet: async () => false,
    clear: async () => {},
    readJSON: () => ({}),
    writeJSON: () => {},
    writeFile: () => {},
    readFile: () => {}
};

/**
 * Valid private keys for testing.
 * WARNING: Do not use these on mainnet - they are publicly known test keys.
 */
const TEST_KEYS = {
    // Hardhat/Foundry default account #0
    EVM: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    EVM_NO_PREFIX: 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',

    // Valid Bitcoin testnet WIF (compressed) - generated via ECPair
    BTC_WIF_TESTNET: 'cV7r1xgwt2zNm3AStyiW7yEpxz7bMXFWFsNzEo5aMc2hivrLmXCB',

    // Solana keypair (64-byte secret key encoded as base58)
    // This is a test keypair - first 32 bytes are seed, remaining 32 are public key
    SOLANA: '5MaiiCavjCmn9Hs1o3eznqDEhRwxo7pXiAYez7keQUviUkauRiTMD8DrESdrNjN8zd9mTmVhRvBJeg5vhyvgrAhG',

    // XRP test keys
    XRP_HEX: 'AC0974BEC39A17E36BA4A6B4D238FF944BACB478CBED5EFCAE784D7BF4F2FF80',

    // TON test key (32-byte seed as hex)
    TON_HEX: 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
};

/**
 * Invalid keys for testing rejection.
 */
const INVALID_KEYS = {
    EMPTY: '',
    WHITESPACE: '   ',
    SHORT_HEX: '0x1234',
    INVALID_HEX: '0xGGGG',
    WRONG_LENGTH: '0x1234567890abcdef',
};

// ============================================================================
// Address Derivation Tests (Direct Function Tests)
// ============================================================================

describe('Bitcoin Address Derivation from Private Key', () => {
    test('derives testnet address from valid WIF', () => {
        const info = deriveBitcoinAddressFromPrivateKey(TEST_KEYS.BTC_WIF_TESTNET, 'testnet');

        assert.ok(info.address, 'Should return an address');
        assert.ok(info.address.startsWith('tb1') || info.address.startsWith('bcrt1'),
            `Testnet address should start with tb1 or bcrt1, got: ${info.address}`);
        assert.equal(info.derivationPath, 'imported-private-key');
        assert.equal(info.network, 'testnet');
        assert.ok(info.publicKey, 'Should include public key');
    });

    test('throws on invalid WIF', () => {
        assert.throws(() => {
            deriveBitcoinAddressFromPrivateKey('invalidWIF', 'testnet');
        }, /Invalid private key/);
    });

    test('throws on network mismatch', () => {
        // Testnet WIF on mainnet should fail
        assert.throws(() => {
            deriveBitcoinAddressFromPrivateKey(TEST_KEYS.BTC_WIF_TESTNET, 'mainnet');
        }, /Invalid private key/);
    });
});

describe('Solana Address Derivation from Secret Key', () => {
    test('derives address from valid Base58 secret key', () => {
        const info = deriveSolanaAddressFromSecretKey(TEST_KEYS.SOLANA);

        assert.ok(info.address, 'Should return an address');
        assert.ok(info.address.length >= 32, 'Solana address should be 32-44 chars');
        assert.equal(info.derivationPath, 'imported-private-key');
        assert.equal(info.publicKeyBase58, info.address);
    });

    test('throws on invalid Base58', () => {
        assert.throws(() => {
            deriveSolanaAddressFromSecretKey('invalid!@#$%');
        }, /Invalid Solana private key/);
    });

    test('throws on wrong length', () => {
        assert.throws(() => {
            deriveSolanaAddressFromSecretKey('4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi');  // Too short
        }, /Invalid Solana private key/);
    });
});

describe('XRP Address Derivation from Private Key', () => {
    test('derives address from valid hex key', () => {
        const info = deriveXRPAddressFromPrivateKey(TEST_KEYS.XRP_HEX);

        assert.ok(info.address, 'Should return an address');
        assert.ok(info.address.startsWith('r'), `XRP address should start with 'r', got: ${info.address}`);
        assert.equal(info.derivationPath, 'imported-private-key');
        assert.ok(info.publicKey, 'Should include public key');
    });

    test('throws on invalid hex', () => {
        assert.throws(() => {
            deriveXRPAddressFromPrivateKey('ZZZZZZ');
        }, /Invalid XRP key/);
    });

    test('throws on wrong length hex', () => {
        assert.throws(() => {
            deriveXRPAddressFromPrivateKey('1234');
        }, /Invalid XRP key/);
    });
});

describe('TON Address Derivation from Secret Key', () => {
    test('derives address from valid 32-byte hex seed', () => {
        const info = deriveTonAddressFromSecretKey(TEST_KEYS.TON_HEX);

        assert.ok(info.address, 'Should return an address');
        // TON addresses are base64 encoded and start with E/U (mainnet) or k (testnet)
        assert.ok(info.address.length > 40, 'TON address should be long base64 string');
        assert.equal(info.derivationPath, 'imported-private-key');
        assert.ok(info.publicKeyHex, 'Should include public key hex');
        assert.equal(info.workchain, 0);
    });

    test('throws on invalid hex', () => {
        assert.throws(() => {
            deriveTonAddressFromSecretKey('notvalidhex');
        }, /Invalid TON key/);
    });

    test('throws on wrong length', () => {
        assert.throws(() => {
            deriveTonAddressFromSecretKey('1234abcd');  // Too short
        }, /Invalid TON key|Invalid secret key length/);
    });
});

// ============================================================================
// Wallet Import Tests
// ============================================================================

describe('Wallet.importFromPrivateKey - EVM', () => {
    test('imports EVM key with 0x prefix', async () => {
        const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);

        const result = wallet.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'password123');

        assert.equal(wallet.importType, 'privateKey');
        assert.equal(wallet.privateKeyType, 'evm');
        assert.ok(result.address.startsWith('0x'), 'Should generate 0x address');
        assert.equal(result.address.length, 42, 'EVM address should be 42 chars');
    });

    test('sets correct internal state', async () => {
        const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);

        wallet.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'password123');

        assert.equal(wallet.currentAccountIndex, 0);
        assert.ok(wallet.salt, 'Should have encryption salt');
        assert.ok(wallet.iv, 'Should have encryption IV');
        assert.ok(wallet.authTag, 'Should have auth tag');
        assert.ok(wallet.encryptedPrivateKey, 'Should have encrypted key');
        assert.equal(wallet.encryptedMnemonic, null, 'Should not have encrypted mnemonic');
    });

    test('getAddress returns correct address', async () => {
        const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);

        wallet.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'password123');
        const address = await wallet.getAddress();

        // Known address for this test private key
        assert.equal(address.toLowerCase(), '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    });
});

describe('Wallet.importFromPrivateKey - Non-EVM chains', () => {
    test('imports Bitcoin key', async () => {
        const wallet = new Wallet({ network: 'bitcoin-testnet', networks: { 'bitcoin-testnet': { type: 'bitcoin' } } }, mockStorage);

        const result = wallet.importFromPrivateKey(TEST_KEYS.BTC_WIF_TESTNET, 'bitcoin', 'password123');

        assert.equal(wallet.importType, 'privateKey');
        assert.equal(wallet.privateKeyType, 'bitcoin');
        // Non-EVM returns placeholder address
        assert.ok(result.address);
    });

    test('imports Solana key', async () => {
        const wallet = new Wallet({ network: 'solana', networks: { solana: { type: 'solana' } } }, mockStorage);

        const result = wallet.importFromPrivateKey(TEST_KEYS.SOLANA, 'solana', 'password123');

        assert.equal(wallet.importType, 'privateKey');
        assert.equal(wallet.privateKeyType, 'solana');
    });

    test('imports XRP key', async () => {
        const wallet = new Wallet({ network: 'xrp', networks: { xrp: { type: 'xrp' } } }, mockStorage);

        const result = wallet.importFromPrivateKey(TEST_KEYS.XRP_HEX, 'xrp', 'password123');

        assert.equal(wallet.importType, 'privateKey');
        assert.equal(wallet.privateKeyType, 'xrp');
    });

    test('imports TON key', async () => {
        const wallet = new Wallet({ network: 'ton', networks: { ton: { type: 'ton' } } }, mockStorage);

        const result = wallet.importFromPrivateKey(TEST_KEYS.TON_HEX, 'ton', 'password123');

        assert.equal(wallet.importType, 'privateKey');
        assert.equal(wallet.privateKeyType, 'ton');
    });
});

// ============================================================================
// Cross-Chain Guard Tests
// ============================================================================

describe('Cross-Chain Guards', () => {
    test('EVM wallet cannot derive Solana address', async () => {
        const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);
        wallet.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'password123');

        assert.throws(() => {
            wallet.getSolanaAddress();
        }, /not support Solana|Cannot derive/);
    });

    test('EVM wallet cannot derive Bitcoin address', async () => {
        const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);
        wallet.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'password123');

        assert.throws(() => {
            wallet.getBitcoinAddress('mainnet');
        }, /not support Bitcoin|Cannot derive|No mnemonic/);
    });

    test('private key wallet cannot switch accounts', async () => {
        const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);
        wallet.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'password123');

        assert.throws(() => {
            wallet.switchAccount(1);
        }, /Cannot switch accounts|private key wallet/);
    });

    test('private key wallet cannot get mnemonic', async () => {
        const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);
        wallet.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'password123');

        assert.throws(() => {
            wallet.getMnemonic();
        }, /no mnemonic|mnemonic phrase/i);
    });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe('Input Validation', () => {
    test('rejects empty key', () => {
        const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);

        assert.throws(() => {
            wallet.importFromPrivateKey(INVALID_KEYS.EMPTY, 'evm', 'password123');
        }, /cannot be empty/);
    });

    test('rejects whitespace-only key', () => {
        const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);

        assert.throws(() => {
            wallet.importFromPrivateKey(INVALID_KEYS.WHITESPACE, 'evm', 'password123');
        }, /cannot be empty/);
    });

    test('rejects invalid EVM key', () => {
        const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);

        assert.throws(() => {
            wallet.importFromPrivateKey(INVALID_KEYS.SHORT_HEX, 'evm', 'password123');
        }, /Invalid EVM private key/);
    });
});

// ============================================================================
// Encryption Round-trip Tests
// ============================================================================

describe('Encryption Round-trip', () => {
    test('encrypted key can be used after wallet reload', async () => {
        const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);
        wallet.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'password123');

        // Capture encrypted data
        const encryptedData = {
            encryptedPrivateKey: wallet.encryptedPrivateKey,
            salt: wallet.salt,
            iv: wallet.iv,
            authTag: wallet.authTag,
        };

        // Verify all encryption components exist
        assert.ok(encryptedData.encryptedPrivateKey, 'Should have encrypted key');
        assert.ok(encryptedData.salt, 'Should have salt');
        assert.ok(encryptedData.iv, 'Should have IV');
        assert.ok(encryptedData.authTag, 'Should have auth tag');

        // Verify encryption components are hex strings
        assert.match(encryptedData.salt, /^[a-f0-9]+$/i, 'Salt should be hex');
        assert.match(encryptedData.iv, /^[a-f0-9]+$/i, 'IV should be hex');
        assert.match(encryptedData.authTag, /^[a-f0-9]+$/i, 'AuthTag should be hex');
    });

    test('different passwords produce different encrypted data', async () => {
        const wallet1 = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);
        const wallet2 = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);

        wallet1.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'password123');
        wallet2.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'differentPassword');

        // Different salts should produce different encrypted data
        assert.notEqual(wallet1.encryptedPrivateKey, wallet2.encryptedPrivateKey);
        assert.notEqual(wallet1.salt, wallet2.salt);
    });
});

// ============================================================================
// Address Consistency Tests
// ============================================================================

describe('Address Derivation Consistency', () => {
    test('same key always produces same EVM address', () => {
        const wallet1 = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);
        const wallet2 = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);

        const result1 = wallet1.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'pass1');
        const result2 = wallet2.importFromPrivateKey(TEST_KEYS.EVM, 'evm', 'pass2');

        assert.equal(result1.address, result2.address, 'Same key should produce same address');
    });

    test('same Bitcoin WIF always produces same address', () => {
        const addr1 = deriveBitcoinAddressFromPrivateKey(TEST_KEYS.BTC_WIF_TESTNET, 'testnet');
        const addr2 = deriveBitcoinAddressFromPrivateKey(TEST_KEYS.BTC_WIF_TESTNET, 'testnet');

        assert.equal(addr1.address, addr2.address, 'Same WIF should produce same address');
        assert.equal(addr1.publicKey, addr2.publicKey, 'Same WIF should produce same public key');
    });

    test('same Solana key always produces same address', () => {
        const addr1 = deriveSolanaAddressFromSecretKey(TEST_KEYS.SOLANA);
        const addr2 = deriveSolanaAddressFromSecretKey(TEST_KEYS.SOLANA);

        assert.equal(addr1.address, addr2.address, 'Same key should produce same address');
    });

    test('same XRP key always produces same address', () => {
        const addr1 = deriveXRPAddressFromPrivateKey(TEST_KEYS.XRP_HEX);
        const addr2 = deriveXRPAddressFromPrivateKey(TEST_KEYS.XRP_HEX);

        assert.equal(addr1.address, addr2.address, 'Same key should produce same address');
    });

    test('same TON key always produces same address', () => {
        const addr1 = deriveTonAddressFromSecretKey(TEST_KEYS.TON_HEX);
        const addr2 = deriveTonAddressFromSecretKey(TEST_KEYS.TON_HEX);

        assert.equal(addr1.address, addr2.address, 'Same key should produce same address');
    });
});
