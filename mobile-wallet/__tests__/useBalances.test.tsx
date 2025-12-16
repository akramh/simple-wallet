/**
 * @fileoverview Hook tests for balances + pricing helpers.
 */

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

const mockRefreshBalances = jest.fn(async () => {});
const mockRefreshPrices = jest.fn(async () => {});

jest.mock('../store', () => ({
  __esModule: true,
  useWalletStore: () => ({
    isUnlocked: true,
    balances: [{ token: { symbol: 'ETH' }, balance: '1.5' }],
    isRefreshingBalances: false,
    balancesLastUpdated: null,
    refreshBalances: mockRefreshBalances,
    prices: { ETH: 2000 },
    totalValue: 3000,
    formattedTotal: '$3000.00',
    isLoadingPrices: false,
    refreshPrices: mockRefreshPrices,
  }),
}));

import { useBalances } from '../hooks/useBalances';

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useBalances>) => void }) {
  const api = useBalances();
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return <Text testID="ready">ready</Text>;
}

describe('useBalances', () => {
  beforeEach(() => {
    mockRefreshBalances.mockClear();
    mockRefreshPrices.mockClear();
  });

  test('auto-refreshes balances on mount when unlocked and no lastUpdated', async () => {
    let api: any;
    render(<Harness onReady={(a) => { api = a; }} />);
    await waitFor(() => expect(mockRefreshBalances).toHaveBeenCalled());
    expect(api.getBalance('ETH')).toBe('1.5');
    expect(api.getPrice('ETH')).toBe(2000);
    expect(api.calculateFiatValue('ETH', '1')).toContain('$2,000');
  });
});


