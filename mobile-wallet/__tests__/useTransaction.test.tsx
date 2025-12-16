/**
 * @fileoverview Hook tests for transaction send/estimate helpers.
 */

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

const mockGetGasEstimate = jest.fn(async () => ({ gasLimit: '21000', gasPrice: '1', network: 'sepolia' }));
const mockSendTransaction = jest.fn(async () => ({ hash: '0xhash' }));
const mockRefreshBalances = jest.fn(async () => {});

jest.mock('../store', () => ({
  __esModule: true,
  useWalletStore: () => ({
    getGasEstimate: mockGetGasEstimate,
    sendTransaction: mockSendTransaction,
    refreshBalances: mockRefreshBalances,
  }),
}));

import { useTransaction } from '../hooks/useTransaction';

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useTransaction>) => void }) {
  const api = useTransaction();
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return <Text testID="ready">ready</Text>;
}

describe('useTransaction', () => {
  beforeEach(() => {
    mockGetGasEstimate.mockClear();
    mockSendTransaction.mockClear();
    mockRefreshBalances.mockClear();
    jest.useFakeTimers();
  });

  test('estimateGas returns null for invalid inputs', async () => {
    let api: any;
    render(<Harness onReady={(a) => { api = a; }} />);
    const token = { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18 };
    const result = await act(async () => await api.estimateGas(token, '', '0'));
    expect(result).toBeNull();
    expect(mockGetGasEstimate).not.toHaveBeenCalled();
  });

  test('send delegates to store and schedules balance refresh', async () => {
    let api: any;
    render(<Harness onReady={(a) => { api = a; }} />);
    const token = { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18 };

    await act(async () => {
      const result = await api.send(token, '0xto', '1');
      expect(result.hash).toBe('0xhash');
    });

    expect(mockSendTransaction).toHaveBeenCalled();
    // timers scheduled
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockRefreshBalances).toHaveBeenCalled();
  });
});


