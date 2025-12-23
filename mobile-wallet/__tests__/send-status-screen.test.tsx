/**
 * @fileoverview Unit tests for the Send status screen.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { jest } from '@jest/globals';

const mockRouter = {
  back: jest.fn(),
  replace: jest.fn(),
};

const baseParams = {
  hash: '0xabc123',
  status: 'pending',
  amount: '0.25',
  symbol: 'ETH',
  recipient: '0x1234567890abcdef1234567890abcdef12345678',
  network: 'sepolia',
  fee: '0.0001',
  feeSymbol: 'ETH',
};
const mockParams = { ...baseParams };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../store', () => ({
  useNetworksSelector: () => ({
    sepolia: {
      name: 'Sepolia',
      blockExplorer: 'https://sepolia.etherscan.io',
    },
  }),
}));

jest.mock('../hooks', () => ({
  useClipboard: () => ({
    copy: jest.fn(async () => true),
    isCopied: () => false,
  }),
}));

import SendStatusScreen from '../app/send-status';

describe('SendStatusScreen', () => {
  beforeEach(() => {
    mockRouter.back.mockClear();
    mockRouter.replace.mockClear();
    Object.assign(mockParams, baseParams);
  });

  test('renders transaction details and explorer action', () => {
    const { getByText, getAllByText } = render(<SendStatusScreen />);

    expect(getByText('Transaction')).toBeTruthy();
    expect(getByText('Pending')).toBeTruthy();
    expect(getByText('0.25 ETH')).toBeTruthy();
    expect(getAllByText('Sepolia').length).toBeGreaterThan(0);
    expect(getByText('View on Explorer')).toBeTruthy();
    expect(getByText('Done')).toBeTruthy();
  });

  test('formats long amount and fee values', () => {
    mockParams.amount = '0.123456789';
    mockParams.fee = '0.0000000009123';

    const { getByText } = render(<SendStatusScreen />);

    expect(getByText('0.12345679 ETH')).toBeTruthy();
    expect(getByText('<0.00000001 ETH')).toBeTruthy();
  });
});
