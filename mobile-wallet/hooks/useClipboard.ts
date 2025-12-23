/**
 * @fileoverview Hook for clipboard operations with feedback.
 *
 * @responsibilities
 * - Provide a consistent clipboard helper for the UI
 * - Offer optional haptic feedback on copy for improved UX
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

interface ClipboardState {
  copied: boolean;
  value: string | null;
}

/**
 * Hook for clipboard operations with visual feedback.
 *
 * @returns Clipboard state (`copied`, `value`) plus `copy/paste/hasContent` helpers.
 */
export function useClipboard() {
  const [state, setState] = useState<ClipboardState>({
    copied: false,
    value: null,
  });
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Copy text to clipboard with haptic feedback.
   *
   * @param text - Text to copy.
   * @returns True if copied successfully; false otherwise.
   */
  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      await Clipboard.setStringAsync(text);
      
      // Haptic feedback
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // Haptics may not be available on all devices
      }

      setState({ copied: true, value: text });

      // Reset copied state after 2 seconds
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        setState((prev) => ({ ...prev, copied: false }));
      }, 2000);

      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return false;
    }
  }, []);

  /**
   * Read text from clipboard.
   *
   * @returns Clipboard string or null if empty/unavailable.
   */
  const paste = useCallback(async (): Promise<string | null> => {
    try {
      const text = await Clipboard.getStringAsync();
      return text || null;
    } catch (error) {
      console.error('Failed to read clipboard:', error);
      return null;
    }
  }, []);

  /**
   * Check if clipboard has content.
   *
   * @returns True if clipboard currently contains a string.
   */
  const hasContent = useCallback(async (): Promise<boolean> => {
    try {
      const hasString = await Clipboard.hasStringAsync();
      return hasString;
    } catch {
      return false;
    }
  }, []);

  const isCopied = useCallback(
    (text: string) => state.copied && state.value === text,
    [state.copied, state.value]
  );

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    copy,
    paste,
    hasContent,
    isCopied,
  };
}
