/**
 * @fileoverview Unit tests for TransactionDetailsModal explorer links.
 */

import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

import TransactionDetailsModal from '../components/TransactionDetailsModal';
import type { Transaction } from '../services';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => {}),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

describe('TransactionDetailsModal explorer links', () => {
  const baseTransaction: Transaction = {
    hash: 'tx_hash_123',
    from: 'EQFrom',
    to: 'EQTo',
    value: '1.5',
    network: 'ton-mainnet',
    status: 'confirmed',
    type: 'send',
    timestamp: Date.now(),
    tokenSymbol: 'TON',
  };

  test('opens TON mainnet explorer link', () => {
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
    const { getByText } = render(
      <TransactionDetailsModal
        visible
        transaction={baseTransaction}
        onClose={jest.fn()}
      />
    );

    fireEvent.press(getByText('View in Explorer'));

    expect(openUrlSpy).toHaveBeenCalledWith('https://tonscan.org/tx/tx_hash_123');
    openUrlSpy.mockRestore();
  });

  test('opens TON testnet explorer link', () => {
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
    const { getByText } = render(
      <TransactionDetailsModal
        visible
        transaction={{ ...baseTransaction, network: 'ton-testnet' }}
        onClose={jest.fn()}
      />
    );

    fireEvent.press(getByText('View in Explorer'));

    expect(openUrlSpy).toHaveBeenCalledWith('https://testnet.tonscan.org/tx/tx_hash_123');
    openUrlSpy.mockRestore();
  });
});
