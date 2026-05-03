/**
 * @fileoverview Unit tests for the pure {@link computePinnedNetworks} helper.
 * No store or RN involvement — exercises the precedence rules
 * (current > recents > config order) and the compatibility filter.
 */

import { describe, test, expect } from '@jest/globals';
import { computePinnedNetworks } from '../store/walletStore';

const networks = {
  ethereum: { name: 'Ethereum', type: 'evm' },
  polygon: { name: 'Polygon', type: 'evm' },
  arbitrum: { name: 'Arbitrum', type: 'evm' },
  base: { name: 'Base', type: 'evm' },
  bitcoin: { name: 'Bitcoin', type: 'bitcoin' },
  solana: { name: 'Solana', type: 'solana' },
} as any;

const allEnabled = ['ethereum', 'polygon', 'arbitrum', 'base', 'bitcoin', 'solana'];

describe('computePinnedNetworks', () => {
  test('current is always at index 0', () => {
    const result = computePinnedNetworks({
      current: 'polygon',
      recents: ['ethereum', 'base'],
      networks,
      enabledNetworks: allEnabled,
      importType: 'mnemonic',
    });
    expect(result[0]).toBe('polygon');
  });

  test('fills slots 1 and 2 from recents in order, excluding current', () => {
    const result = computePinnedNetworks({
      current: 'polygon',
      recents: ['ethereum', 'polygon', 'arbitrum'],
      networks,
      enabledNetworks: allEnabled,
      importType: 'mnemonic',
    });
    expect(result).toEqual(['polygon', 'ethereum', 'arbitrum']);
  });

  test('backfills from config order when recents are empty (first launch)', () => {
    const result = computePinnedNetworks({
      current: 'ethereum',
      recents: [],
      networks,
      enabledNetworks: allEnabled,
      importType: 'mnemonic',
    });
    // Object.keys preserves insertion order: polygon and arbitrum follow ethereum.
    expect(result).toEqual(['ethereum', 'polygon', 'arbitrum']);
  });

  test('partial backfill when recents has 1 entry', () => {
    const result = computePinnedNetworks({
      current: 'ethereum',
      recents: ['solana'],
      networks,
      enabledNetworks: allEnabled,
      importType: 'mnemonic',
    });
    expect(result).toEqual(['ethereum', 'solana', 'polygon']);
  });

  test('drops disabled networks from recents and from backfill', () => {
    const result = computePinnedNetworks({
      current: 'ethereum',
      recents: ['polygon'],
      networks,
      enabledNetworks: ['ethereum', 'arbitrum'], // polygon disabled
      importType: 'mnemonic',
    });
    expect(result).toEqual(['ethereum', 'arbitrum']);
  });

  test('private-key bitcoin wallet keeps only bitcoin (length 1)', () => {
    const result = computePinnedNetworks({
      current: 'bitcoin',
      recents: ['ethereum', 'polygon', 'solana'],
      networks,
      enabledNetworks: allEnabled,
      importType: 'privateKey',
      privateKeyType: 'bitcoin',
    });
    expect(result).toEqual(['bitcoin']);
  });

  test('private-key evm wallet allows EVM networks only', () => {
    const result = computePinnedNetworks({
      current: 'ethereum',
      recents: ['solana', 'polygon', 'bitcoin'],
      networks,
      enabledNetworks: allEnabled,
      importType: 'privateKey',
      privateKeyType: 'evm',
    });
    // solana and bitcoin filtered out; polygon kept; backfill from arbitrum.
    expect(result).toEqual(['ethereum', 'polygon', 'arbitrum']);
  });

  test('drops stale recents that no longer exist in networks config', () => {
    const result = computePinnedNetworks({
      current: 'ethereum',
      recents: ['ghostchain', 'polygon'],
      networks,
      enabledNetworks: allEnabled,
      importType: 'mnemonic',
    });
    expect(result).toEqual(['ethereum', 'polygon', 'arbitrum']);
  });

  test('dedupes when current is also in recents', () => {
    const result = computePinnedNetworks({
      current: 'polygon',
      recents: ['polygon', 'ethereum'],
      networks,
      enabledNetworks: allEnabled,
      importType: 'mnemonic',
    });
    expect(result).toEqual(['polygon', 'ethereum', 'arbitrum']);
  });
});
