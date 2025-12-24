import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from '../dist/wallet.js';

// Mock dependencies
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

// Valid Private Keys for testing (Do not use these on mainnet)
const KEYS = {
    EVM: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    BTC_WIF: 'cTj8Ydq9LhZLLrBeHpZAalyztwlTZe4PHn46L86T55Fj3W96VTq6', // Valid Testnet WIF
};

test('Private Key Import - EVM', async () => {
    const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);
    
    await wallet.importFromPrivateKey(KEYS.EVM, 'evm', 'password123');
    
    assert.equal(wallet.importType, 'privateKey');
    assert.equal(wallet.privateKeyType, 'evm');
    
    const evmAddr = await wallet.getAddress();
    assert.ok(evmAddr.startsWith('0x'), 'Should generate 0x address');
});

/*
test('Private Key Import - Bitcoin', async () => {
    const wallet = new Wallet({ network: 'bitcoin', networks: { bitcoin: { type: 'bitcoin' } } }, mockStorage);

    await wallet.importFromPrivateKey(KEYS.BTC_WIF, 'bitcoin', 'password123');
    
    assert.equal(wallet.privateKeyType, 'bitcoin');
    const btcAddr = wallet.getBitcoinAddress('testnet').address;
    assert.ok(btcAddr.length > 20, 'Should generate BTC address');
});
*/

test('Cross-Chain Guard', async () => {
    const wallet = new Wallet({ network: 'mainnet', networks: { mainnet: { chainId: 1 } } }, mockStorage);

    await wallet.importFromPrivateKey(KEYS.EVM, 'evm', 'password123');
    
    // Attempting to get Solana address from EVM wallet should throw
    try {
        wallet.getSolanaAddress();
        assert.fail('Should have thrown error for cross-chain derivation');
    } catch (err) {
        assert.ok(err.message.includes('not support Solana') || err.message.includes('Cannot derive'), 'Caught expected error: ' + err.message);
    }
});
