/**
 * @fileoverview Unit tests for the Send screen fee display.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { jest } from '@jest/globals';

const mockGetGasEstimate = jest.fn<() => Promise<any>>();
const mockSendTransaction = jest.fn(async () => ({ hash: 'ton_hash_123', status: 'pending' }));
const mockState: any = {
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
};
let fakeTimersEnabled = false;

const enableFakeTimers = () => {
  jest.useFakeTimers();
  fakeTimersEnabled = true;
};

jest.mock('../store', () => ({
  useSendScreenSelector: () => mockState,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-camera', () => ({
  CameraView: (props: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return <View testID="camera-view" {...props} />;
  },
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

import SendScreen from '../app/send';

describe('SendScreen fee estimate display', () => {
  afterEach(() => {
    if (fakeTimersEnabled) {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
      fakeTimersEnabled = false;
    }
    jest.clearAllTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockState.balances = [
      {
        token: { symbol: 'TON', name: 'Toncoin', type: 'native', decimals: 9, address: '' },
        balance: '1.0',
        lastUpdated: Date.now(),
        isLoading: false,
      },
    ];
    mockState.network = 'ton-mainnet';
    mockState.networks = {
      'ton-mainnet': {
        name: 'TON Mainnet',
        type: 'ton',
        nativeSymbol: 'TON',
        blockExplorer: 'https://tonscan.org',
      },
    };
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
    enableFakeTimers();
    const { getByPlaceholderText, findByText } = render(<SendScreen />);

    fireEvent.changeText(getByPlaceholderText('EQ... or UQ...'), 'UQDDUPkLgldV0UNxXgW94J8V09fB46TIkNrxBH8JpSiFylZw');
    fireEvent.changeText(getByPlaceholderText('0.0'), '0.15');

    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    expect(await findByText('Unable to estimate')).toBeTruthy();
  });

  test('shows explorer button after successful send with hash', async () => {
    enableFakeTimers();
    mockGetGasEstimate.mockResolvedValueOnce({
      gasLimit: '1',
      gasPrice: '1',
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      estimatedCostWei: '1000000000',
      estimatedCostNative: '0.001',
      nativeSymbol: 'TON',
      supportsEIP1559: false,
      network: 'ton-mainnet',
    });
    const { getByPlaceholderText, getByText, findByText } = render(<SendScreen />);

    fireEvent.changeText(getByPlaceholderText('EQ... or UQ...'), 'UQDDUPkLgldV0UNxXgW94J8V09fB46TIkNrxBH8JpSiFylZw');
    fireEvent.changeText(getByPlaceholderText('0.0'), '0.15');

    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    fireEvent.press(getByText('Review Transaction'));
    fireEvent.press(getByText('Confirm'));

    expect(await findByText('View in Explorer')).toBeTruthy();
  });

  test('scans QR and auto-copies address to clipboard', async () => {
    const Clipboard = jest.requireMock('expo-clipboard') as { setStringAsync: jest.Mock };
    const { getByTestId, getByDisplayValue, getByText } = render(<SendScreen />);

    fireEvent.press(getByTestId('open-qr-scanner'));

    const camera = getByTestId('camera-view');
    await act(async () => {
      await camera.props.onBarcodeScanned({ data: '0x1234567890abcdef1234567890abcdef12345678' });
    });

    expect(getByDisplayValue('0x1234567890abcdef1234567890abcdef12345678')).toBeTruthy();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
      '0x1234567890abcdef1234567890abcdef12345678'
    );
    expect(getByText('Copied to clipboard')).toBeTruthy();
  });

  test('blocks ENS names on EVM networks', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    enableFakeTimers();

    mockState.balances = [
      {
        token: { symbol: 'ETH', name: 'Ether', type: 'native', decimals: 18, address: 'native' },
        balance: '1.0',
        lastUpdated: Date.now(),
        isLoading: false,
      },
    ];
    mockState.network = 'sepolia';
    mockState.networks = {
      sepolia: {
        name: 'Sepolia',
        type: 'evm',
        nativeSymbol: 'ETH',
        chainId: 11155111,
      },
    };
    mockGetGasEstimate.mockResolvedValueOnce({
      gasLimit: '21000',
      gasPrice: '1',
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      estimatedCostWei: '21000',
      estimatedCostNative: '0.000021',
      nativeSymbol: 'ETH',
      supportsEIP1559: false,
      network: 'sepolia',
    });

    const { getByPlaceholderText, getByText } = render(<SendScreen />);

    fireEvent.changeText(getByPlaceholderText('0x...'), 'vitalik.eth');
    fireEvent.changeText(getByPlaceholderText('0.0'), '0.1');

    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    fireEvent.press(getByText('Review Transaction'));

    expect(alertSpy).toHaveBeenCalledWith(
      'ENS Unsupported',
      'ENS names are not supported yet. Please enter a 0x address.'
    );

    alertSpy.mockRestore();
  });
});
