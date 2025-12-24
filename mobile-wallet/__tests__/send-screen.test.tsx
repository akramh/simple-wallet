/**
 * @fileoverview Unit tests for the Send screen fee display.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { jest } from '@jest/globals';

const mockGetGasEstimate = jest.fn<() => Promise<any>>();
const mockSendTransaction = jest.fn(async () => ({ hash: 'ton_hash_123', status: 'pending' }));
const mockRouter = {
  back: jest.fn(),
  replace: jest.fn(),
};

const mockState: any = {
  balances: [
    {
      token: { symbol: 'TON', name: 'Toncoin', type: 'native', decimals: 9, address: '' },
      balance: '1.0',
      lastUpdated: Date.now(),
      isLoading: false,
    },
  ],
  prices: {
    TON: 1.23,
  },
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
  useRouter: () => mockRouter,
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock(
  '@wallet/bitcoin/index.js',
  () => ({
    isValidBitcoinAddress: () => true,
  }),
  { virtual: true }
);

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
    mockRouter.back.mockClear();
    mockRouter.replace.mockClear();
    mockState.balances = [
      {
        token: { symbol: 'TON', name: 'Toncoin', type: 'native', decimals: 9, address: '' },
        balance: '1.0',
        lastUpdated: Date.now(),
        isLoading: false,
      },
    ];
    mockState.prices = {
      TON: 1.23,
    };
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
    const { getByPlaceholderText, getByText, findByText } = render(<SendScreen />);

    fireEvent.changeText(getByPlaceholderText('EQ... or UQ...'), 'UQDDUPkLgldV0UNxXgW94J8V09fB46TIkNrxBH8JpSiFylZw');
    fireEvent.press(getByText('Next'));
    fireEvent.changeText(getByPlaceholderText('0'), '0.15');

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
    const { getByPlaceholderText, getByText } = render(<SendScreen />);

    fireEvent.changeText(getByPlaceholderText('EQ... or UQ...'), 'UQDDUPkLgldV0UNxXgW94J8V09fB46TIkNrxBH8JpSiFylZw');
    fireEvent.press(getByText('Next'));
    fireEvent.changeText(getByPlaceholderText('0'), '0.15');

    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    fireEvent.press(getByText('Continue'));

    await act(async () => {
      fireEvent.press(getByText('Send'));
    });

    expect(mockRouter.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/send-status',
        params: expect.objectContaining({
          hash: 'ton_hash_123',
          status: 'pending',
        }),
      })
    );
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
    mockState.prices = {
      ETH: 1234,
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
    fireEvent.press(getByText('Next'));

    expect(alertSpy).toHaveBeenCalledWith(
      'ENS Unsupported',
      'ENS names are not supported yet. Please enter a 0x address.'
    );

    alertSpy.mockRestore();
  });

  test('allows Bitcoin send flow on mobile', async () => {
    enableFakeTimers();
    mockSendTransaction.mockResolvedValueOnce({ hash: 'btc_hash_123', status: 'pending' });

    mockState.balances = [
      {
        token: { symbol: 'BTC', name: 'Bitcoin', type: 'native', decimals: 8, address: '' },
        balance: '0.01',
        lastUpdated: Date.now(),
        isLoading: false,
      },
    ];
    mockState.network = 'bitcoin-mainnet';
    mockState.networks = {
      'bitcoin-mainnet': {
        name: 'Bitcoin Mainnet',
        type: 'bitcoin',
        nativeSymbol: 'BTC',
        bitcoinNetwork: 'mainnet',
      },
    };
    mockState.prices = {
      BTC: 50000,
    };
    mockGetGasEstimate.mockResolvedValueOnce({
      gasLimit: '140',
      gasPrice: '5',
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      estimatedCostWei: '700',
      estimatedCostNative: '0.000007',
      nativeSymbol: 'BTC',
      supportsEIP1559: false,
      network: 'bitcoin-mainnet',
    });

    const { getByPlaceholderText, getByText } = render(<SendScreen />);

    fireEvent.changeText(
      getByPlaceholderText('bc1... or 1.../3...'),
      'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
    );
    fireEvent.press(getByText('Next'));
    fireEvent.changeText(getByPlaceholderText('0'), '0.001');

    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    fireEvent.press(getByText('Continue'));

    await act(async () => {
      fireEvent.press(getByText('Send'));
    });

    expect(mockSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'BTC' }),
      'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      '0.001',
      undefined,
      undefined
    );
    expect(mockRouter.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/send-status',
        params: expect.objectContaining({
          hash: 'btc_hash_123',
          status: 'pending',
        }),
      })
    );
  });
});
