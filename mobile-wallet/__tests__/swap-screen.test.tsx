/**
 * @fileoverview Component tests for the swap screen.
 *
 * Renders app/swap.tsx with the store selector and WalletBridge mocked
 * (stake-screen.test.tsx idiom): the wizard advances source → destination →
 * amount → confirm, quoting is debounced, the approval notice is surfaced,
 * confirm dispatches the store action and routes to the status screen, and
 * an unsupported network explains itself instead of offering a quote.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockLoadSwapQuote = jest.fn(async () => {});
const mockClearSwapQuote = jest.fn(() => {});
const mockExecuteSwap = jest.fn(async () => ({
  provider: 'oneinch',
  txId: '0xswap',
  approvalTxId: '0xapproval',
  fromNetworkKey: 'mainnet',
  toNetworkKey: 'mainnet',
}));

const ETH = { symbol: 'ETH', name: 'Ether', type: 'native', address: '', decimals: 18 };
const USDC = {
  symbol: 'USDC',
  name: 'USD Coin',
  type: 'erc20',
  address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6,
};

const quote = {
  provider: 'oneinch',
  fromNetworkKey: 'mainnet',
  toNetworkKey: 'mainnet',
  fromTokenSymbol: 'ETH',
  toTokenSymbol: 'USDC',
  amountInFormatted: '1',
  amountOutFormatted: '3412.55',
  minAmountOutFormatted: '3378.42',
  rateFormatted: '1 ETH ≈ 3412.5500 USDC',
  feeFormatted: '~0.0012 ETH',
  needsApproval: true,
  approvalSpender: '0x1111111254eeb25477b68fb85ed929f73a960582',
  expiresAt: Date.now() + 45_000,
  raw: {},
  request: {
    fromNetworkKey: 'mainnet',
    fromToken: ETH,
    toNetworkKey: 'mainnet',
    toToken: USDC,
    amount: '1',
    slippagePercent: 1,
  },
};

const mockState: any = {
  isUnlocked: true,
  network: 'mainnet',
  networks: {
    mainnet: { name: 'Ethereum', chainId: 1, nativeSymbol: 'ETH' },
    polygon: { name: 'Polygon', chainId: 137, nativeSymbol: 'POL' },
  },
  balances: [{ token: ETH, balance: '2.5' }],
  swapQuote: null as any,
  isLoadingSwapQuote: false,
  swapQuoteError: null as string | null,
  swapPhase: null as string | null,
  loadSwapQuote: mockLoadSwapQuote,
  clearSwapQuote: mockClearSwapQuote,
  executeSwap: mockExecuteSwap,
};

jest.mock('../store', () => ({
  __esModule: true,
  useSwapScreenSelector: () => mockState,
}));

const mockRouter = { back: jest.fn(), replace: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => mockRouter,
}));

const mockCapabilities = jest.fn(() => ({
  canSwap: true,
  sameChain: true,
  crossChain: true,
  destinationNetworkKeys: ['mainnet', 'polygon'],
  unsupportedReason: undefined as string | undefined,
}));

jest.mock('../services', () => ({
  __esModule: true,
  walletBridge: {
    isSwapSupported: jest.fn(() => true),
    getSwapCapabilities: (...args: any[]) => (mockCapabilities as any)(...args),
    getSwapDestTokens: jest.fn(() => [ETH, USDC]),
  },
}));

import SwapScreen from '../app/swap';

/** Drive the wizard to the confirm step with ETH → USDC on the same chain. */
function advanceToConfirm(screen: ReturnType<typeof render>) {
  fireEvent.press(screen.getByTestId('swap-source-ETH'));
  fireEvent.press(screen.getByTestId('swap-dest-network-mainnet'));
  fireEvent.press(screen.getByTestId('swap-dest-token-USDC'));
  fireEvent.changeText(screen.getByTestId('swap-amount-input'), '1');
  fireEvent.press(screen.getByTestId('swap-get-quote'));
}

describe('SwapScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockState.swapQuote = null;
    mockState.isLoadingSwapQuote = false;
    mockState.swapQuoteError = null;
    mockState.swapPhase = null;
    mockCapabilities.mockReturnValue({
      canSwap: true,
      sameChain: true,
      crossChain: true,
      destinationNetworkKeys: ['mainnet', 'polygon'],
      unsupportedReason: undefined,
    });
  });

  test('wizard advances through source, destination, and amount steps', () => {
    const screen = render(<SwapScreen />);

    expect(screen.getByText('Swap from')).toBeTruthy();
    fireEvent.press(screen.getByTestId('swap-source-ETH'));

    expect(screen.getByText('Swap to')).toBeTruthy();
    fireEvent.press(screen.getByTestId('swap-dest-network-mainnet'));
    // Same-network swaps must not offer the source token as a destination.
    expect(screen.queryByTestId('swap-dest-token-ETH')).toBeNull();
    fireEvent.press(screen.getByTestId('swap-dest-token-USDC'));

    expect(screen.getByTestId('swap-amount-input')).toBeTruthy();
  });

  test('quoting is debounced and runs with the collected request', () => {
    const screen = render(<SwapScreen />);
    advanceToConfirm(screen);

    // Debounce window has not elapsed yet.
    expect(mockLoadSwapQuote).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(600); });

    expect(mockLoadSwapQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        fromNetworkKey: 'mainnet',
        toNetworkKey: 'mainnet',
        amount: '1',
        fromToken: expect.objectContaining({ symbol: 'ETH' }),
        toToken: expect.objectContaining({ symbol: 'USDC' }),
      })
    );
  });

  test('an invalid amount never reaches the confirm step or the quote API', () => {
    const screen = render(<SwapScreen />);
    fireEvent.press(screen.getByTestId('swap-source-ETH'));
    fireEvent.press(screen.getByTestId('swap-dest-network-mainnet'));
    fireEvent.press(screen.getByTestId('swap-dest-token-USDC'));
    fireEvent.changeText(screen.getByTestId('swap-amount-input'), 'abc');
    fireEvent.press(screen.getByTestId('swap-get-quote'));

    act(() => { jest.advanceTimersByTime(600); });

    expect(screen.getByText('Enter a valid numeric amount')).toBeTruthy();
    expect(mockLoadSwapQuote).not.toHaveBeenCalled();
  });

  test('the approval requirement is surfaced before confirming', () => {
    mockState.swapQuote = quote;
    const screen = render(<SwapScreen />);
    advanceToConfirm(screen);

    expect(
      screen.getByText('Requires a token approval first — 2 transactions will be sent.')
    ).toBeTruthy();
    expect(screen.getByText('~3412.55 USDC')).toBeTruthy();
  });

  test('confirming executes the quote and routes to the status screen', async () => {
    mockState.swapQuote = quote;
    const screen = render(<SwapScreen />);
    advanceToConfirm(screen);

    await act(async () => {
      fireEvent.press(screen.getByTestId('swap-confirm'));
    });

    expect(mockExecuteSwap).toHaveBeenCalledWith(quote);
    expect(mockRouter.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/swap-status',
        params: expect.objectContaining({
          txId: '0xswap',
          approvalTxId: '0xapproval',
          fromSymbol: 'ETH',
          toSymbol: 'USDC',
        }),
      })
    );
  });

  test('confirm is disabled until a quote is available', () => {
    mockState.swapQuote = null;
    mockState.isLoadingSwapQuote = true;
    const screen = render(<SwapScreen />);
    advanceToConfirm(screen);

    fireEvent.press(screen.getByTestId('swap-confirm'));
    expect(mockExecuteSwap).not.toHaveBeenCalled();
  });

  test('an unsupported network explains itself instead of quoting', () => {
    mockCapabilities.mockReturnValue({
      canSwap: false,
      sameChain: false,
      crossChain: false,
      destinationNetworkKeys: [],
      unsupportedReason: 'Swaps are not available on test networks',
    });

    const screen = render(<SwapScreen />);
    expect(screen.getByText('Swaps are not available on test networks')).toBeTruthy();
    expect(mockLoadSwapQuote).not.toHaveBeenCalled();
  });
});
