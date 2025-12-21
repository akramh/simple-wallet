/**
 * @fileoverview Keyboard-aware scroll wrapper for form screens.
 */

import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, ScrollView, ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  extraBottomPadding?: number;
}

export function KeyboardAwareScrollView({
  contentContainerStyle,
  keyboardShouldPersistTaps,
  keyboardDismissMode,
  extraBottomPadding = 0,
  ...props
}: KeyboardAwareScrollViewProps) {
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(SHOW_EVENT, (event) => {
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(HIDE_EVENT, () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const mergedContainerStyle = useMemo(
    () => [
      { paddingBottom: keyboardHeight + insets.bottom + 24 + extraBottomPadding, flexGrow: 1 },
      contentContainerStyle,
    ],
    [keyboardHeight, insets.bottom, extraBottomPadding, contentContainerStyle]
  );

  return (
    <ScrollView
      {...props}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? 'handled'}
      keyboardDismissMode={keyboardDismissMode ?? 'on-drag'}
      contentContainerStyle={mergedContainerStyle}
    />
  );
}
