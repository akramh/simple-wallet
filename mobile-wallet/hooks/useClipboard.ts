/**
 * @fileoverview Hook for clipboard operations with feedback.
 */

import { useState, useCallback } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

interface ClipboardState {
  copied: boolean;
  value: string | null;
}

/**
 * Hook for clipboard operations with visual feedback.
 */
export function useClipboard() {
  const [state, setState] = useState<ClipboardState>({
    copied: false,
    value: null,
  });

  /**
   * Copy text to clipboard with haptic feedback.
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
      setTimeout(() => {
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
   */
  const hasContent = useCallback(async (): Promise<boolean> => {
    try {
      const hasString = await Clipboard.hasStringAsync();
      return hasString;
    } catch {
      return false;
    }
  }, []);

  return {
    ...state,
    copy,
    paste,
    hasContent,
  };
}
