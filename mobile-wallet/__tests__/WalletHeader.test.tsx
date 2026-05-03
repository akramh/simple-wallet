/**
 * @fileoverview Tests for the WalletHeader components — NetworkChip / NetworkStrip
 * / AccountChip / Blockie palette logic. The full WalletHeader integration is
 * exercised separately via the recentNetworks store tests; these target the
 * leaf components and their pure logic.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { NetworkStrip } from '../components/WalletHeader/NetworkStrip';
import { NetworkChip } from '../components/WalletHeader/NetworkChip';
import { AccountChip } from '../components/WalletHeader/AccountChip';
import {
  paletteIndexForSeed,
  networkDotColor,
  BLOCKIE_PALETTES,
  NETWORK_DOT_DEFAULT,
} from '../components/WalletHeader/constants';

describe('paletteIndexForSeed', () => {
  test('returns deterministic index for the same seed', () => {
    expect(paletteIndexForSeed('Aurora Main')).toBe(paletteIndexForSeed('Aurora Main'));
  });

  test('formula matches design: (charCode0 + charCode1) % palettes.length', () => {
    const seed = 'Trading';
    const expected = (seed.charCodeAt(0) + seed.charCodeAt(1)) % BLOCKIE_PALETTES.length;
    expect(paletteIndexForSeed(seed)).toBe(expected);
  });

  test('handles single-character seed without throwing', () => {
    expect(() => paletteIndexForSeed('A')).not.toThrow();
    expect(paletteIndexForSeed('A')).toBeGreaterThanOrEqual(0);
    expect(paletteIndexForSeed('A')).toBeLessThan(BLOCKIE_PALETTES.length);
  });

  test('handles empty seed', () => {
    expect(paletteIndexForSeed('')).toBe(0);
  });
});

describe('networkDotColor', () => {
  test('returns a brand color for known keys', () => {
    expect(networkDotColor('ethereum')).toBe('#627EEA');
    expect(networkDotColor('polygon')).toBe('#8247E5');
    expect(networkDotColor('solana')).toBe('#14F195');
  });

  test('falls back to default for unknown keys', () => {
    expect(networkDotColor('unknown-chain')).toBe(NETWORK_DOT_DEFAULT);
  });

  test('matches against lowercased key when not found', () => {
    expect(networkDotColor('ETHEREUM')).toBe('#627EEA');
  });
});

describe('NetworkChip', () => {
  test('renders the network name', () => {
    const { getByText } = render(
      <NetworkChip networkKey="ethereum" name="Ethereum" active onPress={jest.fn()} />,
    );
    expect(getByText('Ethereum')).toBeTruthy();
  });

  test('does not fire onPress when chip is already active (no-op guard)', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <NetworkChip networkKey="ethereum" name="Ethereum" active onPress={onPress} />,
    );
    fireEvent.press(getByTestId('network-chip-ethereum'));
    expect(onPress).not.toHaveBeenCalled();
  });

  test('fires onPress with the key when the chip is inactive', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <NetworkChip networkKey="polygon" name="Polygon" active={false} onPress={onPress} />,
    );
    fireEvent.press(getByTestId('network-chip-polygon'));
    expect(onPress).toHaveBeenCalledWith('polygon');
  });
});

describe('NetworkStrip', () => {
  const pinned = [
    { key: 'ethereum', name: 'Ethereum' },
    { key: 'polygon', name: 'Polygon' },
    { key: 'arbitrum', name: 'Arbitrum' },
  ];

  test('renders all pinned networks', () => {
    const { getByTestId } = render(
      <NetworkStrip
        pinned={pinned}
        activeKey="ethereum"
        onSelect={jest.fn()}
        onOverflow={jest.fn()}
      />,
    );
    expect(getByTestId('network-chip-ethereum')).toBeTruthy();
    expect(getByTestId('network-chip-polygon')).toBeTruthy();
    expect(getByTestId('network-chip-arbitrum')).toBeTruthy();
  });

  test('renders the overflow button even with a single pinned network', () => {
    const { getByTestId } = render(
      <NetworkStrip
        pinned={[{ key: 'bitcoin', name: 'Bitcoin' }]}
        activeKey="bitcoin"
        onSelect={jest.fn()}
        onOverflow={jest.fn()}
      />,
    );
    expect(getByTestId('network-strip-overflow')).toBeTruthy();
  });

  test('overflow button calls onOverflow', () => {
    const onOverflow = jest.fn();
    const { getByTestId } = render(
      <NetworkStrip
        pinned={pinned}
        activeKey="ethereum"
        onSelect={jest.fn()}
        onOverflow={onOverflow}
      />,
    );
    fireEvent.press(getByTestId('network-strip-overflow'));
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });

  test('selecting an inactive chip calls onSelect with that key', () => {
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <NetworkStrip
        pinned={pinned}
        activeKey="ethereum"
        onSelect={onSelect}
        onOverflow={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('network-chip-polygon'));
    expect(onSelect).toHaveBeenCalledWith('polygon');
  });
});

describe('AccountChip', () => {
  test('renders wallet name, account index, and short address (4…6)', () => {
    const { getByText } = render(
      <AccountChip
        walletName="Aurora Main"
        accountNumber={1}
        address="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0"
        onPress={jest.fn()}
      />,
    );
    expect(getByText('Aurora Main')).toBeTruthy();
    expect(getByText('#1')).toBeTruthy();
    expect(getByText('0x74…f0bEb0')).toBeTruthy();
  });

  test('omits the address segment when address is null', () => {
    const { queryByText, getByText } = render(
      <AccountChip
        walletName="Aurora Main"
        accountNumber={1}
        address={null}
        onPress={jest.fn()}
      />,
    );
    expect(getByText('Aurora Main')).toBeTruthy();
    expect(queryByText('·')).toBeNull();
  });

  test('preserves a short address (<= 12 chars) without truncation', () => {
    const shortAddr = 'rEXAMPLE123';
    const { getByText } = render(
      <AccountChip
        walletName="XRP wallet"
        accountNumber={1}
        address={shortAddr}
        onPress={jest.fn()}
      />,
    );
    expect(getByText(shortAddr)).toBeTruthy();
  });

  test('press fires onPress', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <AccountChip
        walletName="Aurora Main"
        accountNumber={1}
        address="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0"
        onPress={onPress}
      />,
    );
    fireEvent.press(getByTestId('account-chip'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('renders a 32-char wallet name without crashing', () => {
    const longName = 'Hardware — Treasury Multisig 02';
    const { getByText } = render(
      <AccountChip
        walletName={longName}
        accountNumber={2}
        address="0x91Ab19A8b9c2D38c5BcD6f99d72c11C6E822ed91"
        onPress={jest.fn()}
      />,
    );
    expect(getByText(longName)).toBeTruthy();
    expect(getByText('#2')).toBeTruthy();
  });
});
