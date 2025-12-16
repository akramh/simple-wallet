/**
 * @fileoverview Activity screen interaction tests (filters).
 *
 * Note: This test is intentionally `.ts` (not `.tsx`) and avoids JSX to prevent
 * NativeWind JSX transforms from interacting with Jest mock hoisting.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { jest, describe, test, expect } from '@jest/globals';

const mockSetTransactionFilter = jest.fn();

jest.mock('../store', () => ({
  __esModule: true,
  useWalletStore: () => ({
    isUnlocked: true,
    network: 'sepolia',
    transactions: [],
    isLoadingTransactions: false,
    transactionFilter: 'all',
    loadTransactions: jest.fn(async () => {}),
    setTransactionFilter: mockSetTransactionFilter,
    getFilteredTransactions: () => [
      {
        hash: '0x1',
        from: '0xfrom',
        to: '0xto',
        value: '1',
        network: 'sepolia',
        status: 'confirmed',
        type: 'send',
        timestamp: Date.now(),
        tokenSymbol: 'ETH',
      },
    ],
  }),
}));

jest.mock('../components/TransactionDetailsModal', () => ({
  __esModule: true,
  TransactionDetailsModal: () => null,
}));

import ActivityScreen from '../app/(tabs)/activity';

describe('ActivityScreen', () => {
  test('tapping filter chips calls setTransactionFilter', () => {
    const { getByText } = render(React.createElement(ActivityScreen));
    fireEvent.press(getByText('Sent'));
    expect(mockSetTransactionFilter).toHaveBeenCalledWith('sent');
    fireEvent.press(getByText('Received'));
    expect(mockSetTransactionFilter).toHaveBeenCalledWith('received');
  });
});


