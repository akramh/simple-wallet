/**
 * @fileoverview Unit tests for the Send screen fee display.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { jest } from '@jest/globals';

const mockGetGasEstimate = jest.fn();
const mockSendTransaction = jest.fn(async () => ({ hash: 'ton_hash_123', status: 'pending' }));

jest.mock('../store', () => ({
  useSendScreenSelector: () => ({
    balances: [
      {
        token: { symbol: 'TON', name: 'Toncoin', type: 'native', decimals: 9, address: '' },
        balance: '1.0',
        lastUpdated: Date.now(),
        isLoading: false,
      },
    ],
    network: 'ton-mainnet',
    networks: {
      'ton-mainnet': {
        name: 'TON Mainnet',
        type: 'ton',
        nativeSymbol: 'TON',
        blockExplorer: 'https://tonscan.org',
      },
    },
    getGasEstimate: mockGetGasEstimate,
    sendTransaction: mockSendTransaction,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

import SendScreen from '../app/send';

describe('SendScreen fee estimate display', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGasEstimate.mockResolvedValue({
      gasLimit: '1',
      gasPrice: '0',
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      estimatedCostWei: '0',
      estimatedCostNative: '0',
      nativeSymbol: 'TON',
      supportsEIP1559: false,
      network: 'ton-mainnet',
      error: 'Failed to estimate',
    });
  });

  test('shows fallback text when gas estimate fails', async () => {
    jest.useFakeTimers();
    const { getByPlaceholderText, findByText } = render(<SendScreen />);

    fireEvent.changeText(getByPlaceholderText('EQ... or UQ...'), 'UQDDUPkLgldV0UNxXgW94J8V09fB46TIkNrxBH8JpSiFylZw');
    fireEvent.changeText(getByPlaceholderText('0.0'), '0.15');

    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    expect(await findByText('Unable to estimate')).toBeTruthy();
    jest.useRealTimers();
  });

  test('shows explorer button after successful send with hash', async () => {
    jest.useFakeTimers();
    const { getByPlaceholderText, getByText, findByText } = render(<SendScreen />);

    fireEvent.changeText(getByPlaceholderText('EQ... or UQ...'), 'UQDDUPkLgldV0UNxXgW94J8V09fB46TIkNrxBH8JpSiFylZw');
    fireEvent.changeText(getByPlaceholderText('0.0'), '0.15');

    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    fireEvent.press(getByText('Review Transaction'));
    fireEvent.press(getByText('Confirm'));

    expect(await findByText('View in Explorer')).toBeTruthy();
    jest.useRealTimers();
  });
});
