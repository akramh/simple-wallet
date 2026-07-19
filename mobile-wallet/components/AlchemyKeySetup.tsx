/**
 * @fileoverview Shared UI for entering / managing the Alchemy API key.
 * Rendered by the (auth)/alchemy-setup onboarding route and the
 * /alchemy-key settings screen. Copy mirrors the CLI and extension flows.
 *
 * @security The raw key lives only in transient input state here; display
 * always uses the masked form. Persistence goes through
 * walletBridge.reconfigureAlchemyKey → SecureStore.
 */

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  looksLikeAlchemyKey,
  maskAlchemyKey,
  validateAlchemyKey,
  ALCHEMY_SIGNUP_URL,
} from '@wallet/alchemy-key';
import Constants from 'expo-constants';
import { getStoredAlchemyKey } from '../services/alchemyKeyStore';
import { walletBridge } from '../services/WalletBridge';

const FAILURE_MESSAGES: Record<string, string> = {
  'invalid-format': 'That does not look like an API key — paste just the key, not the URL.',
  unauthorized: 'Alchemy rejected this key — check for typos.',
  'bad-response': 'Alchemy returned an unexpected response — the key may be wrong.',
  'network-error': 'Could not reach Alchemy — check your connection.',
  timeout: 'Validation timed out — check your connection.',
};

interface Props {
  /** Onboarding shows the pitch + Skip; settings shows status + Remove. */
  variant: 'onboarding' | 'settings';
  /** Called after a key is saved successfully. */
  onSaved?: () => void;
  /** Onboarding only: called when the user confirms skipping. */
  onSkip?: () => void;
}

type StoredState = { hasStored: boolean; masked?: string; buildTime: boolean };

export default function AlchemyKeySetup({ variant, onSaved, onSkip }: Props) {
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offerSaveAnyway, setOfferSaveAnyway] = useState(false);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [stored, setStored] = useState<StoredState>({ hasStored: false, buildTime: false });

  const refreshStored = async () => {
    const storedKey = await getStoredAlchemyKey();
    const buildTimeKey = Constants.expoConfig?.extra?.alchemyApiKey as string | undefined;
    const effective = storedKey ?? buildTimeKey;
    setStored({
      hasStored: storedKey !== null,
      masked: effective ? maskAlchemyKey(effective) : undefined,
      buildTime: !storedKey && Boolean(buildTimeKey),
    });
  };

  useEffect(() => {
    refreshStored();
  }, []);

  const handleSave = async (allowUnvalidated = false) => {
    const trimmed = keyInput.trim();
    if (!looksLikeAlchemyKey(trimmed)) {
      setError(FAILURE_MESSAGES['invalid-format']);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!allowUnvalidated) {
        const result = await validateAlchemyKey(trimmed);
        if (!result.ok) {
          setError(FAILURE_MESSAGES[result.reason] ?? 'Something went wrong — try again.');
          setOfferSaveAnyway(result.reason === 'network-error' || result.reason === 'timeout');
          return;
        }
      }
      await walletBridge.reconfigureAlchemyKey(trimmed);
      setKeyInput('');
      setOfferSaveAnyway(false);
      await refreshStored();
      onSaved?.();
    } catch {
      setError('Could not save the key — try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    setError('');
    try {
      await walletBridge.reconfigureAlchemyKey(null);
      await refreshStored();
    } catch {
      setError('Could not remove the key — try again.');
    } finally {
      setBusy(false);
    }
  };

  // Skip confirmation: make the degraded-mode trade-off explicit (same
  // message as the CLI and extension flows).
  if (variant === 'onboarding' && confirmingSkip) {
    return (
      <View>
        <View className="bg-gray-900 rounded-xl p-4 mb-4">
          <Text className="text-white font-medium mb-2">Running without an Alchemy key</Text>
          <Text className="text-gray-400 text-sm">
            The wallet still works using public RPC endpoints, but they are slower and
            rate-limited, transaction history is reduced, and prices come from fallback
            sources.
          </Text>
          <Text className="text-gray-500 text-sm mt-2">
            You can add a key any time in Profile → Alchemy API Key.
          </Text>
        </View>
        <TouchableOpacity onPress={onSkip} className="bg-gray-800 rounded-xl py-4 mb-3">
          <Text className="text-white font-semibold text-center">Continue without a key</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setConfirmingSkip(false)}
          className="bg-purple-600 rounded-xl py-4"
        >
          <Text className="text-white font-semibold text-center">Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      {variant === 'onboarding' && (
        <View className="bg-gray-900 rounded-xl p-4 mb-4">
          <Text className="text-white text-sm">
            This wallet runs on Alchemy: <Text className="font-semibold">one free API key</Text>{' '}
            unlocks fast RPC on all EVM networks and Solana, full transaction history, live
            prices, and the unified portfolio view.
          </Text>
          <Text className="text-gray-400 text-sm mt-2">
            Without a key the wallet still works, but degrades: slower public RPCs, limited
            history, and fallback price sources.
          </Text>
        </View>
      )}

      {variant === 'settings' && (
        <Text className="text-gray-400 text-sm mb-3">
          {stored.hasStored
            ? `Active key: ${stored.masked} (entered on this device)`
            : stored.buildTime
              ? `Active key: ${stored.masked} (bundled at build time — enter a key below to override)`
              : 'No key configured — the wallet is running in degraded mode.'}
        </Text>
      )}

      <TextInput
        value={keyInput}
        onChangeText={(text) => {
          setKeyInput(text);
          setError('');
          setOfferSaveAnyway(false);
        }}
        placeholder="Paste your Alchemy API key"
        placeholderTextColor="#6b7280"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        className="bg-gray-900 text-white rounded-xl px-4 py-4 mb-3"
      />

      {error !== '' && <Text className="text-red-400 text-sm mb-3">{error}</Text>}

      <TouchableOpacity
        onPress={() => handleSave(false)}
        disabled={busy || keyInput.trim() === ''}
        className={`rounded-xl py-4 mb-3 ${busy || keyInput.trim() === '' ? 'bg-purple-600/40' : 'bg-purple-600'}`}
      >
        {busy ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white font-semibold text-center">Validate & Save</Text>
        )}
      </TouchableOpacity>

      {offerSaveAnyway && (
        <TouchableOpacity
          onPress={() => handleSave(true)}
          disabled={busy}
          className="bg-gray-800 rounded-xl py-4 mb-3"
        >
          <Text className="text-white font-semibold text-center">Save without validating</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        onPress={() => Linking.openURL(ALCHEMY_SIGNUP_URL)}
        disabled={busy}
        className="bg-gray-800 rounded-xl py-4 mb-3 flex-row items-center justify-center"
      >
        <Ionicons name="open-outline" size={18} color="white" style={{ marginRight: 8 }} />
        <Text className="text-white font-semibold text-center">Get a free key from Alchemy</Text>
      </TouchableOpacity>

      <Text className="text-gray-500 text-xs mb-3">
        Sign in at dashboard.alchemy.com, create an app, copy its API key, and paste it above.
      </Text>

      {variant === 'settings' && stored.hasStored && (
        <TouchableOpacity
          onPress={handleRemove}
          disabled={busy}
          className="bg-gray-900 border border-red-500/40 rounded-xl py-4 mb-3"
        >
          <Text className="text-red-400 font-semibold text-center">Remove stored key</Text>
        </TouchableOpacity>
      )}

      {variant === 'onboarding' && (
        <TouchableOpacity
          onPress={() => setConfirmingSkip(true)}
          disabled={busy}
          className="py-3"
        >
          <Text className="text-gray-400 text-center">Skip for now</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
