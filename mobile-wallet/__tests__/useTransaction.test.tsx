/**
 * @fileoverview Hook tests for transaction send/estimate helpers.
 */

import { renderHook, act } from '@testing-library/react-native';
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

describe('useTransaction', () => {
  beforeEach(() => {
    mockGetGasEstimate.mockClear();
    mockSendTransaction.mockClear();
    mockRefreshBalances.mockClear();
    jest.useFakeTimers();
  });

  test('estimateGas returns null for invalid inputs', async () => {
    const { result } = renderHook(() => useTransaction());
    const token = { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18 };
    
    let estimate: any;
    await act(async () => {
      estimate = await result.current.estimateGas(token as any, '', '0');
    });
    
    expect(estimate).toBeNull();
    expect(mockGetGasEstimate).not.toHaveBeenCalled();
  });

  test('send delegates to store and schedules balance refresh', async () => {
    const { result } = renderHook(() => useTransaction());
    const token = { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18 };

    let sendResult: any;
    await act(async () => {
      sendResult = await result.current.send(token as any, '0xto', '1');
    });
    
    expect(sendResult.hash).toBe('0xhash');
    expect(mockSendTransaction).toHaveBeenCalled();
    
    // timers scheduled
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockRefreshBalances).toHaveBeenCalled();
  });
});


