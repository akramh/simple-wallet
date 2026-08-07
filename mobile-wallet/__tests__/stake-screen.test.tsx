/**
 * @fileoverview Component tests for the staking screen.
 *
 * Renders app/stake.tsx with the store selector and WalletBridge mocked
 * (send-screen.test.tsx idiom): positions render with validator, amount,
 * state and epoch context; actions are gated by lifecycle state; unstake
 * confirms through Alert and dispatches the store action.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockLoadStakePositions = jest.fn(async () => {});
const mockStake = jest.fn(async () => ({ txId: 'stake_sig', feeFormatted: '0.000005' }));
const mockUnstake = jest.fn(async () => ({ txId: 'unstake_sig', feeFormatted: '0.000005' }));
const mockWithdrawStake = jest.fn(async () => ({ txId: 'withdraw_sig', feeFormatted: '0.000005' }));

const activePosition = {
  networkKey: 'solana-mainnet',
  chain: 'solana',
  positionId: 'StakeAccount1111111111111111111111111111111',
  validator: {
    id: 'Vote111111111111111111111111111111111111111',
    name: 'Validator A',
    commissionPercent: 5,
    apyPercent: 7.2,
    activatedStakeFormatted: null,
    delinquent: false,
  },
  amountFormatted: '1.500000000',
  amountBaseUnits: '1500000000',
  reserveFormatted: '0.002282880',
  totalFormatted: '268.369720970',
  state: 'active',
  activationEpoch: 823,
  deactivationEpoch: null,
  currentEpoch: 825,
  usdValue: 19851.31,
};

const mockState: any = {
  isUnlocked: true,
  network: 'solana-mainnet',
  networks: { 'solana-mainnet': { name: 'Solana', type: 'solana', nativeSymbol: 'SOL' } },
  balances: [{ token: { symbol: 'SOL', type: 'native', decimals: 9 }, balance: '10.5' }],
  stakePositions: [] as any[],
  isLoadingStakePositions: false,
  stakePositionsLastUpdated: null,
  loadStakePositions: mockLoadStakePositions,
  stake: mockStake,
  unstake: mockUnstake,
  withdrawStake: mockWithdrawStake,
};

jest.mock('../store', () => ({
  __esModule: true,
  useStakingScreenSelector: () => mockState,
}));

const mockRouter = { back: jest.fn(), replace: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => mockRouter,
}));

jest.mock('../services', () => ({
  __esModule: true,
  walletBridge: {
    isStakingSupported: jest.fn(() => true),
    getStakingCapabilities: jest.fn(() => ({
      canStake: true,
      canUnstake: true,
      canWithdraw: true,
      minStakeFormatted: '0.01',
      activationNote: 'Stake activates at the next epoch boundary.',
      deactivationNote: 'Unstaking completes at the next epoch boundary.',
    })),
    getStakeValidators: jest.fn(async () => [
      { id: 'Vote111111111111111111111111111111111111111', name: 'Validator A', commissionPercent: 5, apyPercent: 7.2, activatedStakeFormatted: '430,800', delinquent: false },
    ]),
    estimateStakeFee: jest.fn(async () => '0.000005000'),
  },
}));

import StakeScreen from '../app/stake';

describe('StakeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.stakePositions = [];
    mockState.isLoadingStakePositions = false;
  });

  test('renders empty state and loads positions on mount', () => {
    const { getByText } = render(<StakeScreen />);
    expect(getByText('No staking positions yet')).toBeTruthy();
    expect(mockLoadStakePositions).toHaveBeenCalled();
  });

  test('renders a position with validator, rounded amount, state, and epoch context', () => {
    mockState.stakePositions = [activePosition];
    const { getByText } = render(<StakeScreen />);

    expect(getByText('Validator A')).toBeTruthy();
    // 9-decimal amount is rounded for display
    expect(getByText('268.3697 SOL')).toBeTruthy();
    expect(getByText('active')).toBeTruthy();
    expect(getByText('Staked at epoch')).toBeTruthy();
    expect(getByText('823 (2 epochs ago)')).toBeTruthy();
    expect(getByText('Current epoch')).toBeTruthy();
    // Active positions offer Unstake, not Withdraw
    expect(getByText('Unstake')).toBeTruthy();
  });

  test('unstake confirms via Alert then dispatches the store action', async () => {
    mockState.stakePositions = [activePosition];
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByText } = render(<StakeScreen />);

    fireEvent.press(getByText('Unstake'));
    expect(alertSpy).toHaveBeenCalled();
    const [, message, buttons] = alertSpy.mock.calls[0] as any;
    expect(String(message)).toMatch(/268.3697 SOL/);
    expect(String(message)).toMatch(/epoch boundary/);

    // Simulate the user tapping the confirm button in the Alert.
    const confirmButton = buttons.find((b: any) => b.text === 'Unstake');
    await act(async () => {
      await confirmButton.onPress();
    });
    expect(mockUnstake).toHaveBeenCalledWith(activePosition.positionId);

    alertSpy.mockRestore();
  });

  test('withdrawable positions offer Withdraw instead of Unstake', () => {
    mockState.stakePositions = [
      { ...activePosition, state: 'withdrawable', deactivationEpoch: 824 },
    ];
    const { getByText, queryByText } = render(<StakeScreen />);

    expect(getByText('Withdraw')).toBeTruthy();
    expect(queryByText('Unstake')).toBeNull();
    expect(getByText('Unstaked at epoch')).toBeTruthy();
  });

  test('deactivating positions offer neither action and explain the cooldown', () => {
    mockState.stakePositions = [
      { ...activePosition, state: 'deactivating', deactivationEpoch: 825 },
    ];
    const { getByText, queryByText } = render(<StakeScreen />);

    expect(queryByText('Unstake')).toBeNull();
    expect(queryByText('Withdraw')).toBeNull();
    expect(getByText('Withdraw unlocks after the next epoch boundary')).toBeTruthy();
  });

  test('stake wizard: validator list renders after opening the flow', async () => {
    const { getByText, findByText } = render(<StakeScreen />);

    fireEvent.press(getByText('Stake SOL'));
    expect(await findByText('Validator A')).toBeTruthy();
    expect(getByText('7.2% APY')).toBeTruthy();
    // Activated-stake display string rendered verbatim (main's convention).
    expect(getByText('430,800 SOL')).toBeTruthy();
  });
});
