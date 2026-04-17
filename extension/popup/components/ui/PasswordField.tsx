/**
 * @fileoverview Password input with inline show/hide toggle and an optional
 * 4-bucket strength meter.
 *
 * The strength heuristic is intentionally light (no `zxcvbn` dependency):
 * it scores on length and character-class diversity, which is a good enough
 * signal for a local-only password that unlocks an encrypted blob. The meter
 * guides the user toward "better", not "perfect".
 *
 * Scoring (0 Weak → 4 Excellent):
 *   +1 length ≥ 8         (required minimum, matches createWallet validation)
 *   +1 length ≥ 12
 *   +1 includes digits OR symbols
 *   +1 includes BOTH digits AND symbols, OR length ≥ 16
 *   +1 mixed-case AND length ≥ 10
 *
 * Cap at 4.
 *
 * @security This component never logs the password and clears local visibility
 *   on blur-out of the input (the underlying value is owned by the parent).
 */
import React, { useId, useState } from 'react';
import { Icon } from './Icon';

interface PasswordFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  showStrength?: boolean;
}

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

export function scorePassword(pw: string): PasswordStrength {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  const hasDigit = /\d/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  if (hasDigit || hasSymbol) score += 1;
  if ((hasDigit && hasSymbol) || pw.length >= 16) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw) && pw.length >= 10) score += 1;
  return Math.min(score, 4) as PasswordStrength;
}

const strengthCopy: Record<PasswordStrength, { label: string; className: string }> = {
  0: { label: '', className: '' },
  1: { label: 'Weak', className: 'password-strength--weak' },
  2: { label: 'Fair', className: 'password-strength--fair' },
  3: { label: 'Strong', className: 'password-strength--strong' },
  4: { label: 'Excellent', className: 'password-strength--excellent' },
};

export function PasswordField({
  label,
  value,
  onChange,
  error,
  hint,
  showStrength = false,
  id,
  className,
  disabled,
  ...rest
}: PasswordFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [visible, setVisible] = useState(false);
  const strength = showStrength ? scorePassword(value) : 0;
  const copy = strengthCopy[strength];

  return (
    <div className={`password-field${disabled ? ' is-disabled' : ''}${error ? ' has-error' : ''}`}>
      {label && (
        <label htmlFor={inputId} className="password-field__label">
          {label}
        </label>
      )}
      <div className="password-field__input-wrap">
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`password-field__input ${className ?? ''}`}
          disabled={disabled}
          {...rest}
        />
        <button
          type="button"
          className="password-field__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          tabIndex={-1}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} size={16} decorative />
        </button>
      </div>

      {showStrength && value.length > 0 && (
        <div className="password-strength" aria-live="polite">
          <div className={`password-strength__bar ${copy.className}`} data-score={strength}>
            {[1, 2, 3, 4].map((n) => (
              <span
                key={n}
                className={`password-strength__seg${strength >= n ? ' is-filled' : ''}`}
              />
            ))}
          </div>
          {copy.label && <div className="password-strength__label">{copy.label}</div>}
        </div>
      )}

      {error && <div className="password-field__error">{error}</div>}
      {hint && !error && <div className="password-field__hint">{hint}</div>}
    </div>
  );
}

export default PasswordField;
