import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TransactionHistoryManager, TransactionStatus, TransactionType } from '../dist/transaction-history.js';
import { MemoryStorage } from '../dist/storage.js';

test('TransactionHistoryManager adds and retrieves transactions', () => {
  const storage = new MemoryStorage();
  const manager = new TransactionHistoryManager(storage, 'test-wallet');

  const tx = {
    hash: '0xabc123',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.CONFIRMED,
    type: TransactionType.SEND,
    timestamp: Date.now()
  };

  manager.addTransaction(tx);

  const retrieved = manager.getTransaction('0xabc123');
  assert.ok(retrieved);
  assert.equal(retrieved.hash, '0xabc123');
  assert.equal(retrieved.status, TransactionStatus.CONFIRMED);
});

test('TransactionHistoryManager updates existing transaction by hash', () => {
  const storage = new MemoryStorage();
  const manager = new TransactionHistoryManager(storage, 'test-wallet');

  const tx = {
    hash: '0xabc123',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.PENDING,
    type: TransactionType.SEND,
    timestamp: Date.now()
  };

  manager.addTransaction(tx);
  
  // Update the same transaction
  tx.status = TransactionStatus.CONFIRMED;
  tx.blockNumber = 12345;
  manager.addTransaction(tx);

  const all = manager.getAllTransactions();
  assert.equal(all.length, 1, 'should not duplicate');
  assert.equal(all[0].status, TransactionStatus.CONFIRMED);
  assert.equal(all[0].blockNumber, 12345);
});

test('TransactionHistoryManager filters by network', () => {
  const storage = new MemoryStorage();
  const manager = new TransactionHistoryManager(storage, 'test-wallet');

  manager.addTransaction({
    hash: '0x111',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.CONFIRMED,
    type: TransactionType.SEND,
    timestamp: Date.now()
  });

  manager.addTransaction({
    hash: '0x222',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'polygon',
    status: TransactionStatus.CONFIRMED,
    type: TransactionType.SEND,
    timestamp: Date.now()
  });

  const mainnetTxs = manager.getTransactionsByNetwork('mainnet');
  assert.equal(mainnetTxs.length, 1);
  assert.equal(mainnetTxs[0].hash, '0x111');

  const polygonTxs = manager.getTransactionsByNetwork('polygon');
  assert.equal(polygonTxs.length, 1);
  assert.equal(polygonTxs[0].hash, '0x222');
});

test('TransactionHistoryManager filters by address', () => {
  const storage = new MemoryStorage();
  const manager = new TransactionHistoryManager(storage, 'test-wallet');

  const myAddress = '0x1111111111111111111111111111111111111111';
  const otherAddress = '0x2222222222222222222222222222222222222222';
  const thirdAddress = '0x3333333333333333333333333333333333333333';

  manager.addTransaction({
    hash: '0x111',
    from: myAddress,
    to: otherAddress,
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.CONFIRMED,
    type: TransactionType.SEND,
    timestamp: Date.now()
  });

  manager.addTransaction({
    hash: '0x222',
    from: thirdAddress,
    to: otherAddress,
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.CONFIRMED,
    type: TransactionType.SEND,
    timestamp: Date.now()
  });

  const myTxs = manager.getTransactionsByAddress(myAddress);
  assert.equal(myTxs.length, 1);
  assert.equal(myTxs[0].hash, '0x111');
});

test('TransactionHistoryManager getPendingTransactions returns only pending', () => {
  const storage = new MemoryStorage();
  const manager = new TransactionHistoryManager(storage, 'test-wallet');

  manager.addTransaction({
    hash: '0x111',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.PENDING,
    type: TransactionType.SEND,
    timestamp: Date.now()
  });

  manager.addTransaction({
    hash: '0x222',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.CONFIRMED,
    type: TransactionType.SEND,
    timestamp: Date.now()
  });

  const pending = manager.getPendingTransactions();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].hash, '0x111');
});

test('TransactionHistoryManager updateTransactionStatus updates status', () => {
  const storage = new MemoryStorage();
  const manager = new TransactionHistoryManager(storage, 'test-wallet');

  manager.addTransaction({
    hash: '0x111',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.PENDING,
    type: TransactionType.SEND,
    timestamp: Date.now()
  });

  manager.updateTransactionStatus('0x111', TransactionStatus.CONFIRMED, 12345);

  const tx = manager.getTransaction('0x111');
  assert.equal(tx.status, TransactionStatus.CONFIRMED);
  assert.equal(tx.blockNumber, 12345);
});

test('TransactionHistoryManager updateTransactionStatus with error', () => {
  const storage = new MemoryStorage();
  const manager = new TransactionHistoryManager(storage, 'test-wallet');

  manager.addTransaction({
    hash: '0x111',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.PENDING,
    type: TransactionType.SEND,
    timestamp: Date.now()
  });

  manager.updateTransactionStatus('0x111', TransactionStatus.FAILED, undefined, 'Out of gas');

  const tx = manager.getTransaction('0x111');
  assert.equal(tx.status, TransactionStatus.FAILED);
  assert.equal(tx.error, 'Out of gas');
});

test('TransactionHistoryManager clearHistory removes all transactions', () => {
  const storage = new MemoryStorage();
  const manager = new TransactionHistoryManager(storage, 'test-wallet');

  manager.addTransaction({
    hash: '0x111',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.CONFIRMED,
    type: TransactionType.SEND,
    timestamp: Date.now()
  });

  manager.clearHistory();

  const all = manager.getAllTransactions();
  assert.equal(all.length, 0);
});

test('TransactionHistoryManager getAllTransactions sorts by timestamp descending', () => {
  const storage = new MemoryStorage();
  const manager = new TransactionHistoryManager(storage, 'test-wallet');

  const now = Date.now();

  manager.addTransaction({
    hash: '0x111',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.CONFIRMED,
    type: TransactionType.SEND,
    timestamp: now - 1000 // older
  });

  manager.addTransaction({
    hash: '0x222',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.CONFIRMED,
    type: TransactionType.SEND,
    timestamp: now // newer
  });

  const all = manager.getAllTransactions();
  assert.equal(all[0].hash, '0x222', 'newest transaction should be first');
  assert.equal(all[1].hash, '0x111', 'older transaction should be second');
});

test('TransactionHistoryManager getExplorerUrl returns correct URLs', () => {
  assert.ok(TransactionHistoryManager.getExplorerUrl('mainnet', '0xabc').includes('etherscan.io'));
  assert.ok(TransactionHistoryManager.getExplorerUrl('polygon', '0xabc').includes('polygonscan.com'));
  assert.ok(TransactionHistoryManager.getExplorerUrl('base', '0xabc').includes('basescan.org'));
  assert.ok(TransactionHistoryManager.getExplorerUrl('unknown', '0xabc').includes('etherscan.io')); // defaults to mainnet
});

test('TransactionHistoryManager uses wallet-specific storage key', () => {
  const storage = new MemoryStorage();
  const manager1 = new TransactionHistoryManager(storage, 'wallet-1');
  const manager2 = new TransactionHistoryManager(storage, 'wallet-2');

  manager1.addTransaction({
    hash: '0x111',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    value: '1000000000000000000',
    network: 'mainnet',
    status: TransactionStatus.CONFIRMED,
    type: TransactionType.SEND,
    timestamp: Date.now()
  });

  // Wallet 2 should have no transactions
  const wallet2Txs = manager2.getAllTransactions();
  assert.equal(wallet2Txs.length, 0, 'wallet-2 should have no transactions');

  // Wallet 1 should have its transaction
  const wallet1Txs = manager1.getAllTransactions();
  assert.equal(wallet1Txs.length, 1, 'wallet-1 should have one transaction');
});
