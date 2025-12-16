/**
 * @fileoverview Hook tests for balances + pricing helpers.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
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

describe('useBalances', () => {
  beforeEach(() => {
    mockRefreshBalances.mockClear();
    mockRefreshPrices.mockClear();
  });

  test('auto-refreshes balances on mount when unlocked and no lastUpdated', async () => {
    const { result } = renderHook(() => useBalances());
    
    await waitFor(() => expect(mockRefreshBalances).toHaveBeenCalled());
    expect(result.current.getBalance('ETH')).toBe('1.5');
    expect(result.current.getPrice('ETH')).toBe(2000);
    expect(result.current.calculateFiatValue('ETH', '1')).toContain('$2,000');
  });
});


