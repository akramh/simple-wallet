/**
 * @file AlchemyKeySetup.tsx
 * @description Shared UI for entering / managing the Alchemy API key. Used
 * as the first onboarding step in WelcomeScreen and inside SettingsView's
 * "Network & API" section. Talks to the service worker via
 * GET_ALCHEMY_KEY_STATUS / SET_ALCHEMY_KEY / CLEAR_ALCHEMY_KEY — the raw
 * key is only held transiently in the input state here and never comes
 * back from the worker (masked status only).
 */
import React, { useEffect, useState } from 'react';
import { sendMessageWithRetry } from '../utils/messaging';
import { ALCHEMY_SIGNUP_URL } from '../../../src/alchemy-key.js';

export interface AlchemyKeyStatus {
  hasKey: boolean;
  source: 'stored' | 'buildtime' | null;
  masked?: string;
}

interface Props {
  /** Onboarding shows the pitch + Skip; settings shows status + Remove. */
  variant: 'onboarding' | 'settings';
  /** Called after a key is saved successfully. */
  onSaved?: () => void;
  /** Onboarding only: called when the user skips. */
  onSkip?: () => void;
}

const FAILURE_MESSAGES: Record<string, string> = {
  'invalid-format': 'That does not look like an API key — paste just the key, not the URL.',
  unauthorized: 'Alchemy rejected this key — check for typos.',
  'bad-response': 'Alchemy returned an unexpected response — the key may be wrong.',
  'network-error': 'Could not reach Alchemy — check your connection.',
  timeout: 'Validation timed out — check your connection.',
};

function AlchemyKeySetup({ variant, onSaved, onSkip }: Props) {
  const [status, setStatus] = useState<AlchemyKeyStatus | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offerSaveAnyway, setOfferSaveAnyway] = useState(false);
  // Two-stage skip: first click shows the degraded-mode warning (mirrors
  // the CLI's skip warning), second click confirms.
  const [confirmingSkip, setConfirmingSkip] = useState(false);

  const refreshStatus = async () => {
    try {
      const result = await sendMessageWithRetry<AlchemyKeyStatus>({ type: 'GET_ALCHEMY_KEY_STATUS' });
      setStatus(result);
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const handleSave = async (allowUnvalidated = false) => {
    setBusy(true);
    setError('');
    try {
      const result = await sendMessageWithRetry<{ ok: boolean; reason?: string }>({
        type: 'SET_ALCHEMY_KEY',
        payload: { key: keyInput.trim(), allowUnvalidated },
      });
      if (result?.ok) {
        setKeyInput('');
        setOfferSaveAnyway(false);
        await refreshStatus();
        onSaved?.();
      } else {
        const reason = result?.reason ?? 'bad-response';
        setError(FAILURE_MESSAGES[reason] ?? 'Something went wrong — try again.');
        setOfferSaveAnyway(reason === 'network-error' || reason === 'timeout');
      }
    } catch {
      setError('Could not reach the wallet service — try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await sendMessageWithRetry<AlchemyKeyStatus>({ type: 'CLEAR_ALCHEMY_KEY' });
      setStatus(result);
    } catch {
      setError('Could not reach the wallet service — try again.');
    } finally {
      setBusy(false);
    }
  };

  // Skip confirmation screen: make the trade-off explicit (same message
  // the CLI shows) and tell the user where to add a key later.
  if (variant === 'onboarding' && confirmingSkip) {
    return (
      <div className="alchemy-key-setup">
        <div className="info-box">
          <p>
            <strong>Running without an Alchemy key:</strong> the wallet still works using
            public RPC endpoints, but they are slower and rate-limited, transaction history
            is reduced, and prices come from fallback sources.
          </p>
          <p className="text-sm text-text-secondary mt-2">
            You can add a key any time in Settings → Network &amp; API.
          </p>
        </div>
        <div className="action-buttons">
          <button className="btn btn-secondary" onClick={onSkip}>
            Continue without a key
          </button>
          <button className="btn btn-primary" onClick={() => setConfirmingSkip(false)}>
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="alchemy-key-setup">
      {variant === 'onboarding' && (
        <div className="info-box">
          <p>
            This wallet runs on Alchemy: <strong>one free API key</strong> unlocks fast RPC on
            all EVM networks and Solana, full transaction history, live prices, and the
            unified portfolio view.
          </p>
          <p className="text-sm text-text-secondary mt-2">
            Without a key the wallet still works, but degrades: slower public RPCs, limited
            history, and fallback price sources.
          </p>
        </div>
      )}

      {variant === 'settings' && status && (
        <div className="text-sm text-text-secondary" style={{ marginBottom: 8 }}>
          {status.hasKey
            ? status.source === 'stored'
              ? `Active key: ${status.masked} (entered in this extension)`
              : `Active key: ${status.masked} (configured at build time — enter a key below to override)`
            : 'No key configured — the wallet is running in degraded mode.'}
        </div>
      )}

      <div className="form-group">
        <input
          type="password"
          value={keyInput}
          onChange={(e) => {
            setKeyInput(e.target.value);
            setError('');
            setOfferSaveAnyway(false);
          }}
          placeholder="Paste your Alchemy API key"
          autoComplete="off"
          disabled={busy}
        />
      </div>

      {error && <div className="error">{error}</div>}

      <div className="action-buttons">
        <button
          className="btn btn-primary"
          onClick={() => handleSave(false)}
          disabled={busy || keyInput.trim() === ''}
        >
          {busy ? 'Validating…' : 'Validate & save'}
        </button>
        {offerSaveAnyway && (
          <button className="btn btn-secondary" onClick={() => handleSave(true)} disabled={busy}>
            Save without validating
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={() => chrome.tabs.create({ url: ALCHEMY_SIGNUP_URL })}
          disabled={busy}
        >
          Get a free key from Alchemy
        </button>
        {variant === 'settings' && status?.source === 'stored' && (
          <button className="btn btn-secondary" onClick={handleRemove} disabled={busy}>
            Remove stored key
          </button>
        )}
      </div>

      <p className="text-sm text-text-secondary mt-2">
        Sign in at dashboard.alchemy.com, create an app, copy its API key, and paste it above.
      </p>

      {variant === 'onboarding' && (
        <div className="action-buttons" style={{ marginTop: 12 }}>
          <button
            className="btn btn-secondary"
            onClick={() => setConfirmingSkip(true)}
            disabled={busy}
          >
            Skip for now
          </button>
        </div>
      )}
    </div>
  );
}

export default AlchemyKeySetup;
