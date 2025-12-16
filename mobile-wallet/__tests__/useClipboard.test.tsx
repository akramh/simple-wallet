/**
 * @fileoverview Hook tests for clipboard helpers.
 */

import { renderHook, act } from '@testing-library/react-native';
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { useClipboard } from '../hooks/useClipboard';

describe('useClipboard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  test('copy writes clipboard, triggers haptics, and toggles copied state', async () => {
    const { result } = renderHook(() => useClipboard());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.copy('hello');
    });
    
    expect(ok).toBe(true);
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('hello');
    expect(Haptics.notificationAsync).toHaveBeenCalled();
    expect(result.current.copied).toBe(true);

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(false);
  });
});


