/**
 * @fileoverview Hook tests for clipboard helpers.
 */

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { useClipboard } from '../hooks/useClipboard';

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useClipboard>) => void }) {
  const api = useClipboard();
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return <Text testID="ready">ready</Text>;
}

describe('useClipboard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  test('copy writes clipboard, triggers haptics, and toggles copied state', async () => {
    let api: any;
    render(<Harness onReady={(a) => { api = a; }} />);

    await act(async () => {
      const ok = await api.copy('hello');
      expect(ok).toBe(true);
    });

    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('hello');
    expect(Haptics.notificationAsync).toHaveBeenCalled();
    expect(api.copied).toBe(true);

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(api.copied).toBe(false);
  });
});


